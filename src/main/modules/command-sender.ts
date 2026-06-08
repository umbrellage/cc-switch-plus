import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { TerminalSession } from '../../renderer/types'

const PENDING_DIR = '/tmp/cc-pending'

/**
 * 通用命令发送器
 * 通过 SIGWINCH 信号通知 shell 读取 pending 文件并执行命令
 *
 * SIGWINCH 的优势：
 * - 默认行为是忽略（不会杀掉未安装 hook 的 shell）
 * - bash 在前台进程运行时自动排队 trap，进程退出后执行
 * - 适用于所有终端应用（iTerm2/IDEA/Cursor/VS Code/Warp...）
 */
export class CommandSender {
  /** 向 session 发送切换命令 */
  async sendSwitchCommand(session: TerminalSession, shortName: string): Promise<void> {
    const command = `source ~/.bashrc_${shortName}`
    await this.sendToSession(session, command)
  }

  /** 向 session 发送检测命令 */
  async sendDetectCommand(session: TerminalSession): Promise<void> {
    const command = 'mkdir -p /tmp/cc-status && echo "MODEL=${ANTHROPIC_DEFAULT_OPUS_MODEL:-unknown} URL=${ANTHROPIC_BASE_URL:-unknown}" > "/tmp/cc-status/$(tty | tr \\"/\\" \\\"_\\")"'
    await this.sendToSession(session, command)
  }

  /** 向 session 发送命令：写 pending 文件 + SIGWINCH 信号 */
  async sendToSession(session: TerminalSession, command: string): Promise<void> {
    const ttyFile = session.tty.replace(/\//g, '_')

    // 写 pending 文件
    if (!existsSync(PENDING_DIR)) mkdirSync(PENDING_DIR, { recursive: true })
    writeFileSync(join(PENDING_DIR, ttyFile), command, 'utf-8')

    // 发送 SIGWINCH（安全：默认忽略，不会杀进程）
    try {
      process.kill(session.shellPid, 'SIGWINCH')
    } catch {
      // 进程可能已退出
    }
  }

  /** 更新状态文件（乐观） */
  updateStatusOptimistically(shortName: string, tty: string): void {
    const statusDir = '/tmp/cc-status'
    const pendingFile = tty.replace(/\//g, '_')
    if (!existsSync(statusDir)) mkdirSync(statusDir, { recursive: true })

    const bashrcPath = join(homedir(), `.bashrc_${shortName}`)
    let modelValue = shortName
    let urlValue = ''
    try {
      const content = readFileSync(bashrcPath, 'utf-8')
      const modelMatch = content.match(/ANTHROPIC_DEFAULT_OPUS_MODEL='?([^'\n]+)'?/)
      const urlMatch = content.match(/ANTHROPIC_BASE_URL=(\S+)/)
      if (modelMatch) modelValue = modelMatch[1]
      if (urlMatch) urlValue = urlMatch[1]
    } catch { /* fallback */ }

    writeFileSync(join(statusDir, pendingFile), `MODEL=${modelValue} URL=${urlValue}`, 'utf-8')
  }
}
