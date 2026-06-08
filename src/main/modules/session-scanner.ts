import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { TerminalSession } from '../../renderer/types'

const execFileAsync = promisify(execFile)

/** 已知终端应用映射 */
const APP_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /iTerm/i, name: 'iTerm2' },
  { match: /Terminal/i, name: 'Terminal' },
  { match: /IntelliJ|idea/i, name: 'IDEA' },
  { match: /Cursor/i, name: 'Cursor' },
  { match: /Code Helper|Code/i, name: 'VS Code' },
  { match: /Warp/i, name: 'Warp' },
  { match: /login/i, name: '系统终端' }
]

/** 通过 ppid 链追溯宿主应用 */
async function traceHostApp(pid: number): Promise<string> {
  let current = pid
  for (let i = 0; i < 15; i++) {
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(current)], { timeout: 3000 })
      const ppid = parseInt(stdout.trim(), 10)
      if (isNaN(ppid) || ppid <= 1) break

      const { stdout: comm } = await execFileAsync('ps', ['-o', 'comm=', '-p', String(ppid)], { timeout: 3000 })
      const name = comm.trim()

      for (const pattern of APP_PATTERNS) {
        if (pattern.match.test(name)) return pattern.name
      }
      current = ppid
    } catch {
      break
    }
  }
  return '未知'
}

/**
 * 系统级会话扫描器
 * 通过 ps 枚举所有 TTY 上的 shell 会话，追溯宿主应用
 */
export class SessionScanner {
  /** 扫描所有 shell 会话 */
  async listSessions(): Promise<TerminalSession[]> {
    const ttys = await this.getAllTtys()
    const sessions: TerminalSession[] = []

    for (const tty of ttys) {
      const session = await this.buildSession(tty)
      if (session) sessions.push(session)
    }

    return sessions
  }

  /** 获取所有活跃的 TTY */
  private async getAllTtys(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('ps', ['-eo', 'tty'], { timeout: 5000 })
      const ttys = new Set<string>()
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('ttys')) {
          ttys.add(`/dev/${trimmed}`)
        }
      }
      return [...ttys].sort()
    } catch {
      return []
    }
  }

  /** 为单个 TTY 构建 Session */
  private async buildSession(tty: string): Promise<TerminalSession | null> {
    const ttyName = tty.replace('/dev/', '')
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'pid,ppid,comm=', '-t', ttyName], { timeout: 3000 })
      const processes = stdout.trim().split('\n').filter(Boolean)
      if (processes.length === 0) return null

      // 找到主 shell 进程（bash/zsh）
      const shellLine = processes.find((p) => /bash|zsh|sh/.test(p))
      if (!shellLine) return null

      const parts = shellLine.trim().split(/\s+/)
      const shellPid = parseInt(parts[0], 10)
      const shellPpid = parseInt(parts[1], 10)
      const shellComm = parts.slice(2).join(' ')

      // 检测是否在运行 claude
      const isBusy = processes.some((p) => {
        const comm = p.trim().split(/\s+/).slice(2).join(' ')
        return comm === 'claude' || comm === 'claude.exe'
      })

      // 追溯宿主应用
      const appName = await traceHostApp(shellPpid)

      // 获取当前工作目录（帮助用户识别 session）
      let cwd = ''
      try {
        const { stdout } = await execFileAsync('lsof', ['-p', String(shellPid)], { timeout: 3000 })
        const lines = stdout.split('\n')
        for (const line of lines) {
          const cols = line.trim().split(/\s+/)
          // lsof 输出: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
          // cwd 行的 FD 列是 "cwd"
          if (cols[3] === 'cwd') {
            cwd = cols[cols.length - 1].replace(process.env.HOME || '', '~')
            break
          }
        }
      } catch { /* ignore */ }

      // 尝试从状态文件读取当前模型
      const statusFile = tty.replace(/\//g, '_')
      let currentModel: string | undefined
      let currentBaseUrl: string | undefined
      const statusPath = join('/tmp/cc-status', statusFile)
      if (existsSync(statusPath)) {
        try {
          const content = readFileSync(statusPath, 'utf-8').trim()
          const modelMatch = content.match(/MODEL=(\S+)/)
          const urlMatch = content.match(/URL=(\S+)/)
          if (modelMatch && modelMatch[1] !== 'unknown') currentModel = modelMatch[1]
          if (urlMatch) currentBaseUrl = urlMatch[1]
        } catch { /* ignore */ }
      }

      return {
        sessionId: tty,
        windowId: 0,
        windowIndex: 0,
        tabIndex: 0,
        tty,
        name: cwd || `${appName} - ${shellComm}`,
        columns: 0,
        rows: 0,
        profileName: appName,
        appName,
        shellPid,
        isBusy,
        currentModel,
        currentBaseUrl
      }
    } catch {
      return null
    }
  }

  /** 检测指定 TTY 上是否有 claude 进程 */
  async isClaudeRunning(tty: string): Promise<boolean> {
    const ttyName = tty.replace('/dev/', '')
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'comm=', '-t', ttyName], { timeout: 3000 })
      return stdout.trim().split('\n').some((p) => p.trim() === 'claude' || p.trim() === 'claude.exe')
    } catch {
      return false
    }
  }

  /** 查找指定 TTY 上运行的 claude 进程 PID（用于热切换时直接发信号退出） */
  async findClaudePid(tty: string): Promise<number | null> {
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
}
