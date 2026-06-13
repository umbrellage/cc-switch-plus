import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { TerminalSession } from '../../renderer/types'
import { IS_WIN, WIN_STATUS_DIR, winSessionKey } from '../platform'

const execFileAsync = promisify(execFile)

/** mac 已知终端应用映射 */
const MAC_APP_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /iTerm/i, name: 'iTerm2' },
  { match: /Terminal/i, name: 'Terminal' },
  { match: /IntelliJ|idea/i, name: 'IDEA' },
  { match: /Cursor/i, name: 'Cursor' },
  { match: /Code Helper|Code/i, name: 'VS Code' },
  { match: /Warp/i, name: 'Warp' },
  { match: /login/i, name: '系统终端' }
]

/** win 已知终端应用映射 */
const WIN_APP_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /WindowsTerminal/i, name: 'Windows Terminal' },
  { match: /WezTerm/i, name: 'WezTerm' },
  { match: /Alacritty/i, name: 'Alacritty' },
  { match: /IntelliJ|idea/i, name: 'IDEA' },
  { match: /Cursor/i, name: 'Cursor' },
  { match: /Code\.exe/i, name: 'VS Code' },
  { match: /conhost/i, name: '控制台' }
]

/** Windows 进程表条目 */
interface WinProc {
  pid: number
  ppid: number
  name: string
  cmd: string
}

/**
 * 系统级会话扫描器
 * mac：ps 枚举 TTY；win：Get-CimInstance Win32_Process 进程树
 */
export class SessionScanner {
  /** 扫描所有 shell 会话 */
  async listSessions(): Promise<TerminalSession[]> {
    return IS_WIN ? this.listSessionsWin() : this.listSessionsMac()
  }

  // ============ macOS ============

  /** 通过 ppid 链追溯宿主应用（mac） */
  private async traceHostAppMac(pid: number): Promise<string> {
    let current = pid
    for (let i = 0; i < 15; i++) {
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(current)], { timeout: 3000 })
        const ppid = parseInt(stdout.trim(), 10)
        if (isNaN(ppid) || ppid <= 1) break
        const { stdout: comm } = await execFileAsync('ps', ['-o', 'comm=', '-p', String(ppid)], { timeout: 3000 })
        const name = comm.trim()
        for (const pattern of MAC_APP_PATTERNS) {
          if (pattern.match.test(name)) return pattern.name
        }
        current = ppid
      } catch {
        break
      }
    }
    return '未知'
  }

  private async listSessionsMac(): Promise<TerminalSession[]> {
    const ttys = await this.getAllTtysMac()
    const sessions: TerminalSession[] = []
    for (const tty of ttys) {
      const session = await this.buildSessionMac(tty)
      if (session) sessions.push(session)
    }
    return sessions
  }

  private async getAllTtysMac(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('ps', ['-eo', 'tty'], { timeout: 5000 })
      const ttys = new Set<string>()
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('ttys')) ttys.add(`/dev/${trimmed}`)
      }
      return [...ttys].sort()
    } catch {
      return []
    }
  }

  private async buildSessionMac(tty: string): Promise<TerminalSession | null> {
    const ttyName = tty.replace('/dev/', '')
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'pid,ppid,comm=', '-t', ttyName], { timeout: 3000 })
      const processes = stdout.trim().split('\n').filter(Boolean)
      if (processes.length === 0) return null

      const shellLine = processes.find((p) => /bash|zsh|sh/.test(p))
      if (!shellLine) return null

      const parts = shellLine.trim().split(/\s+/)
      const shellPid = parseInt(parts[0], 10)
      const shellPpid = parseInt(parts[1], 10)
      const shellComm = parts.slice(2).join(' ')

      const isBusy = processes.some((p) => {
        const comm = p.trim().split(/\s+/).slice(2).join(' ')
        return comm === 'claude' || comm === 'claude.exe'
      })

      const appName = await this.traceHostAppMac(shellPpid)

      let cwd = ''
      try {
        const { stdout } = await execFileAsync('lsof', ['-p', String(shellPid)], { timeout: 3000 })
        for (const line of stdout.split('\n')) {
          const cols = line.trim().split(/\s+/)
          if (cols[3] === 'cwd') {
            cwd = cols[cols.length - 1].replace(process.env.HOME || '', '~')
            break
          }
        }
      } catch { /* ignore */ }

      const status = this.readStatusMac(tty)

      return {
        sessionId: tty, windowId: 0, windowIndex: 0, tabIndex: 0, tty,
        name: cwd || `${appName} - ${shellComm}`,
        columns: 0, rows: 0, profileName: appName, appName,
        shellPid, isBusy, currentModel: status?.model, currentBaseUrl: status?.baseUrl
      }
    } catch {
      return null
    }
  }

  private readStatusMac(tty: string): { model?: string; baseUrl?: string } | undefined {
    const statusFile = tty.replace(/\//g, '_')
    const statusPath = join('/tmp/cc-status', statusFile)
    if (!existsSync(statusPath)) return undefined
    try {
      const content = readFileSync(statusPath, 'utf-8').trim()
      const modelMatch = content.match(/MODEL=(\S+)/)
      const urlMatch = content.match(/URL=(\S+)/)
      return {
        model: modelMatch && modelMatch[1] !== 'unknown' ? modelMatch[1] : undefined,
        baseUrl: urlMatch?.[1]
      }
    } catch {
      return undefined
    }
  }

  // ============ Windows ============

  /** 取 Windows 进程全表（一次 PowerShell 调用） */
  private async getWinProcessTable(): Promise<Map<number, WinProc>> {
    const table = new Map<number, WinProc>()
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-Command',
         'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
        { timeout: 8000 }
      )
      const data = JSON.parse(stdout.trim() || '[]')
      const arr = Array.isArray(data) ? data : [data]
      for (const p of arr) {
        if (p && typeof p.ProcessId === 'number') {
          table.set(p.ProcessId, {
            pid: p.ProcessId,
            ppid: p.ParentProcessId || 0,
            name: p.Name || '',
            cmd: p.CommandLine || ''
          })
        }
      }
    } catch {
      // PowerShell 失败则返回空表
    }
    return table
  }

  /** win：沿 ppid 链追溯宿主终端应用（内存遍历，无子进程） */
  private traceHostAppWin(shellPid: number, table: Map<number, WinProc>): string {
    let current: number | undefined = shellPid
    for (let i = 0; i < 15 && current !== undefined; i++) {
      const proc = table.get(current)
      if (!proc) break
      for (const pattern of WIN_APP_PATTERNS) {
        if (pattern.match.test(proc.name)) return pattern.name
      }
      current = proc.ppid
    }
    return '未知'
  }

  /** win：扫描所有 PowerShell/cmd 会话 */
  private async listSessionsWin(): Promise<TerminalSession[]> {
    const table = await this.getWinProcessTable()
    if (table.size === 0) return []

    const sessions: TerminalSession[] = []
    for (const proc of table.values()) {
      const baseName = proc.name.toLowerCase()
      // 仅 PowerShell 支持 hook 机制（cmd 无 profile，列出也无法切换，故排除）
      const isShell = baseName === 'powershell.exe' || baseName === 'pwsh.exe'
      if (!isShell) continue

      // 跳过无父进程（顶层系统 shell）
      if (proc.ppid <= 0) continue

      const appName = this.traceHostAppWin(proc.pid, table)
      const claude = this.findClaudeChildWin(proc.pid, table)
      const status = this.readStatusWin(proc.pid)

      sessions.push({
        sessionId: winSessionKey(proc.pid),
        windowId: 0, windowIndex: 0, tabIndex: 0,
        tty: '',  // Windows 无 tty
        name: `${appName} - ${baseName.replace('.exe', '')}`,
        columns: 0, rows: 0, profileName: appName, appName,
        shellPid: proc.pid,
        isBusy: !!claude,
        currentModel: status?.model,
        currentBaseUrl: status?.baseUrl
      })
    }
    return sessions
  }

  /** win：查找某 shell 进程树下的 claude 进程（返回 PID 或 null） */
  private findClaudeChildWin(shellPid: number, table: Map<number, WinProc>): number | null {
    // 收集 shell 子树所有 pid
    const childrenOf = new Map<number, number[]>()
    for (const p of table.values()) {
      const arr = childrenOf.get(p.ppid) || []
      arr.push(p.pid)
      childrenOf.set(p.ppid, arr)
    }
    const stack = [shellPid]
    const visited = new Set<number>()
    while (stack.length) {
      const cur = stack.pop()!
      if (visited.has(cur)) continue
      visited.add(cur)
      const proc = table.get(cur)
      if (!proc) continue
      // claude 检测：进程名或命令行含 claude（Windows 上 claude 是 node 跑的 .cmd）
      if (/claude/i.test(proc.name) || /claude/i.test(proc.cmd)) {
        return cur
      }
      for (const child of childrenOf.get(cur) || []) stack.push(child)
    }
    return null
  }

  private readStatusWin(shellPid: number): { model?: string; baseUrl?: string } | undefined {
    const statusPath = join(WIN_STATUS_DIR, winSessionKey(shellPid))
    if (!existsSync(statusPath)) return undefined
    try {
      const content = readFileSync(statusPath, 'utf-8').trim()
      const modelMatch = content.match(/MODEL=(\S+)/)
      const urlMatch = content.match(/URL=(\S+)/)
      return {
        model: modelMatch && modelMatch[1] !== 'unknown' ? modelMatch[1] : undefined,
        baseUrl: urlMatch?.[1]
      }
    } catch {
      return undefined
    }
  }

  /** win：查找指定 shell 会话下的 claude PID（用于热切换；Windows 不支持热切换，保留接口） */
  async findClaudePid(sessionKey: string): Promise<number | null> {
    if (!IS_WIN) {
      // mac 实现
      const tty = sessionKey
      const ttyName = tty.replace('/dev/', '')
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'pid,comm=', '-t', ttyName], { timeout: 3000 })
        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/)
          const pid = parseInt(parts[0], 10)
          const comm = parts.slice(1).join(' ')
          if (!isNaN(pid) && (comm === 'claude' || comm === 'claude.exe')) return pid
        }
        return null
      } catch {
        return null
      }
    }
    const table = await this.getWinProcessTable()
    const m = sessionKey.match(/^pid_(\d+)$/)
    const shellPid = m ? parseInt(m[1], 10) : NaN
    if (isNaN(shellPid)) return null
    return this.findClaudeChildWin(shellPid, table)
  }

  /** win：检测会话是否运行 claude */
  async isClaudeRunning(sessionKey: string): Promise<boolean> {
    const pid = await this.findClaudePid(sessionKey)
    return pid !== null
  }
}
