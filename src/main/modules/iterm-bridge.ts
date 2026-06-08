import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { TerminalSession } from '../../renderer/types'

const execFileAsync = promisify(execFile)
const PENDING_DIR = '/tmp/cc-pending'

/** AppleScript 命令队列，避免并发竞争 */
class ScriptQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  async enqueue<T>(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const { stdout } = await execFileAsync(
            'osascript',
            ['-e', script],
            { timeout: 10000 }
          )
          resolve(stdout.trim())
        } catch (err) {
          reject(err)
        }
      })
      this.process()
    })
  }

  private async process() {
    if (this.running || this.queue.length === 0) return
    this.running = true
    const task = this.queue.shift()!
    await task()
    this.running = false
    this.process()
  }
}

const queue = new ScriptQueue()

export class ITermBridge {
  /** 检查 iTerm2 是否在运行 */
  async isRunning(): Promise<boolean> {
    try {
      await execFileAsync('pgrep', ['-x', 'iTerm2'], { timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /** 枚举所有 iTerm2 窗口/tab/session */
  async listSessions(): Promise<TerminalSession[]> {
    if (!(await this.isRunning())) return []

    const script = `
tell application "iTerm2"
    set output to ""
    set winCount to count of windows
    repeat with i from 1 to winCount
        set w to window i
        set winId to id of w
        set tabCount to count of tabs of w
        repeat with j from 1 to tabCount
            set t to tab j of w
            set s to current session of t
            set output to output & winId & "|" & i & "|" & j & "|" & (id of s) & "|" & (tty of s) & "|" & (name of s) & "|" & (columns of s) & "|" & (rows of s) & "|" & (profile name of s) & linefeed
        end repeat
    end repeat
    return output
end tell`

    try {
      const raw = await queue.enqueue(script)
      if (!raw) return []

      return raw
        .split('\n')
        .filter((line) => line.includes('|'))
        .map((line) => {
          const parts = line.split('|')
          return {
            windowId: parseInt(parts[0], 10),
            windowIndex: parseInt(parts[1], 10),
            tabIndex: parseInt(parts[2], 10),
            sessionId: parts[3],
            tty: parts[4],
            name: parts[5],
            columns: parseInt(parts[6], 10),
            rows: parseInt(parts[7], 10),
            profileName: parts[8] || 'default'
          } satisfies TerminalSession
        })
    } catch (err) {
      console.error('[ITermBridge] listSessions failed:', err)
      return []
    }
  }

  /**
   * 切换模型
   * - shell 空闲：直接发送 source 命令（即时生效）
   * - claude 运行中：写 pending 文件（回到提示符后自动执行）
   */
  async switchModel(sessionId: string, shortName: string, tty: string): Promise<void> {
    const pendingFile = this.ttyToFileName(tty)

    // 更新状态文件（无论哪种方式都立即更新 UI）
    this.updateStatusOptimistically(shortName, pendingFile)

    const claudeRunning = await this.isClaudeRunning(tty)

    if (claudeRunning) {
      // Claude 在运行：写 pending 文件，不干扰
      if (!existsSync(PENDING_DIR)) {
        mkdirSync(PENDING_DIR, { recursive: true })
      }
      writeFileSync(join(PENDING_DIR, pendingFile), shortName, 'utf-8')
    } else {
      // Shell 空闲：直接发送 source 命令
      await this.sendCommand(sessionId, `source ~/.bashrc_${shortName}`)
    }
  }

  /** 检测指定 tty 上是否有 claude 进程 */
  private async isClaudeRunning(tty: string): Promise<boolean> {
    const ttyName = tty.replace('/dev/', '')
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'comm=', '-t', ttyName], { timeout: 3000 })
      const processes = stdout.trim().split('\n').map((p) => p.trim())
      return processes.some((p) => p === 'claude' || p === 'node')
    } catch {
      return false
    }
  }

  /** 乐观更新状态文件 */
  private updateStatusOptimistically(shortName: string, pendingFile: string): void {
    const statusDir = '/tmp/cc-status'
    if (!existsSync(statusDir)) {
      mkdirSync(statusDir, { recursive: true })
    }

    const bashrcPath = join(homedir(), `.bashrc_${shortName}`)
    let modelValue = shortName
    let urlValue = ''
    try {
      const content = readFileSync(bashrcPath, 'utf-8')
      const modelMatch = content.match(/ANTHROPIC_DEFAULT_OPUS_MODEL='?([^'\n]+)'?/)
      const urlMatch = content.match(/ANTHROPIC_BASE_URL=(\S+)/)
      if (modelMatch) modelValue = modelMatch[1]
      if (urlMatch) urlValue = urlMatch[1]
    } catch {
      // bashrc 文件不存在，用 shortName 作为 fallback
    }

    writeFileSync(
      join(statusDir, pendingFile),
      `MODEL=${modelValue} URL=${urlValue}`,
      'utf-8'
    )
  }

  /** 向空闲 session 发送状态检测命令，跳过 claude 运行中的 */
  async detectAll(): Promise<void> {
    const sessions = await this.listSessions()
    const cmd =
      'mkdir -p /tmp/cc-status && echo "MODEL=${ANTHROPIC_DEFAULT_OPUS_MODEL:-unknown} URL=${ANTHROPIC_BASE_URL:-unknown}" > "/tmp/cc-status/$(tty | tr \\"/\\" \\\"_\\")"'

    for (const s of sessions) {
      try {
        const busy = await this.isClaudeRunning(s.tty)
        if (busy) continue  // 跳过 claude 运行中的 session
        await this.sendCommand(s.sessionId, cmd)
      } catch {
        // 单个 session 失败不阻塞其他
      }
    }
  }

  /** 向指定 session 发送 source 切换命令（公开，供 PendingWatcher 调用） */
  async sendSwitchCommand(sessionId: string, shortName: string): Promise<void> {
    await this.sendCommand(sessionId, `source ~/.bashrc_${shortName}`)
  }

  /** 向指定 session 发送命令 */
  private async sendCommand(sessionId: string, command: string): Promise<void> {
    const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    const script = `
tell application "iTerm2"
    set winCount to count of windows
    repeat with i from 1 to winCount
        set w to window i
        set tabCount to count of tabs of w
        repeat with j from 1 to tabCount
            set t to tab j of w
            set s to current session of t
            if (id of s) is "${sessionId}" then
                write s text "${escaped}"
                write s text return
                return
            end if
        end repeat
    end repeat
end tell`

    try {
      await queue.enqueue(script)
    } catch (err) {
      console.error('[ITermBridge] sendCommand failed:', err)
      throw new Error(`发送命令失败: ${(err as Error).message}`)
    }
  }

  /** tty 路径 → 文件名 */
  private ttyToFileName(tty: string): string {
    return tty.replace(/\//g, '_')
  }
}
