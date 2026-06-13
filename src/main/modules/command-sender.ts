import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { TerminalSession } from '../../renderer/types'
import { IS_WIN, WIN_PENDING_DIR, WIN_STATUS_DIR, winSessionKey } from '../platform'

// mac 运行时目录（保持原版，不改）
const PENDING_DIR = '/tmp/cc-pending'
const STATUS_DIR = '/tmp/cc-status'

/**
 * 通用命令发送器
 * mac：写 pending + SIGWINCH 信号
 * win：写 pending（PowerShell prompt hook 在下次提示符时读取，无信号）
 */
export class CommandSender {
  /** 向 session 发送切换命令 */
  async sendSwitchCommand(session: TerminalSession, shortName: string): Promise<void> {
    const command = IS_WIN
      ? `. (Join-Path $env:USERPROFILE '.cc-switch-plus\\profiles\\${shortName}.ps1')`
      : `source ~/.bashrc_${shortName}`
    await this.sendToSession(session, command)
  }

  /** 向 session 发送检测命令 */
  async sendDetectCommand(session: TerminalSession): Promise<void> {
    const command = IS_WIN
      ? `__cc_update_status`
      : 'mkdir -p /tmp/cc-status && echo "MODEL=${ANTHROPIC_DEFAULT_OPUS_MODEL:-unknown} URL=${ANTHROPIC_BASE_URL:-unknown}" > "/tmp/cc-status/$(tty | tr \\"/\\" \\\"_\\")"'
    await this.sendToSession(session, command)
  }

  /** 向 session 发送命令：写 pending 文件 + (mac) SIGWINCH 信号 */
  async sendToSession(session: TerminalSession, command: string): Promise<void> {
    if (IS_WIN) {
      // Windows：写 pending，PowerShell prompt hook 在 claude 退出后下次提示符读取
      const key = winSessionKey(session.shellPid)
      if (!existsSync(WIN_PENDING_DIR)) mkdirSync(WIN_PENDING_DIR, { recursive: true })
      writeFileSync(join(WIN_PENDING_DIR, key), command, 'utf-8')
      // 无信号可发；pending 靠 prompt 轮询（claude 运行时不触发，故 Windows 不支持热切换）
      return
    }

    // mac：写 pending + 发 SIGWINCH
    const ttyFile = session.tty.replace(/\//g, '_')
    if (!existsSync(PENDING_DIR)) mkdirSync(PENDING_DIR, { recursive: true })
    writeFileSync(join(PENDING_DIR, ttyFile), command, 'utf-8')
    try {
      process.kill(session.shellPid, 'SIGWINCH')
    } catch {
      // 进程可能已退出
    }
  }

  /**
   * 向 claude 进程发送两次 SIGINT（mac 热切换用）。
   * Windows 不支持热切换（无信号、无法跨 console 发 Ctrl+C），此方法在 win 上为空操作。
   */
  async interruptClaude(claudePid: number): Promise<void> {
    if (IS_WIN) return // Windows 不支持
    try {
      process.kill(claudePid, 'SIGINT')
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
    try {
      process.kill(claudePid, 'SIGINT')
    } catch {
      // ignore
    }
  }

  /** 更新状态文件（乐观） */
  updateStatusOptimistically(shortName: string, session: TerminalSession): void {
    if (IS_WIN) {
      this.updateStatusWin(shortName, session.shellPid)
      return
    }
    this.updateStatusMac(shortName, session.tty)
  }

  private updateStatusMac(shortName: string, tty: string): void {
    if (!existsSync(STATUS_DIR)) mkdirSync(STATUS_DIR, { recursive: true })
    const statusFile = tty.replace(/\//g, '_')

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

    writeFileSync(join(STATUS_DIR, statusFile), `MODEL=${modelValue} URL=${urlValue}`, 'utf-8')
  }

  private updateStatusWin(shortName: string, shellPid: number): void {
    if (!existsSync(WIN_STATUS_DIR)) mkdirSync(WIN_STATUS_DIR, { recursive: true })

    // 从 profile ps1 读模型/url
    let modelValue = shortName
    let urlValue = ''
    try {
      const { readFileSync: rf } = require('fs')
      const profilePath = join(homedir(), '.cc-switch-plus', 'profiles', `${shortName}.ps1`)
      const content = rf(profilePath, 'utf-8')
      const modelMatch = content.match(/ANTHROPIC_DEFAULT_OPUS_MODEL'\s*=\s*'([^']*)'/)
      const urlMatch = content.match(/ANTHROPIC_BASE_URL'\s*=\s*'([^']*)'/)
      if (modelMatch) modelValue = modelMatch[1]
      if (urlMatch) urlValue = urlMatch[1]
    } catch { /* fallback */ }

    writeFileSync(join(WIN_STATUS_DIR, winSessionKey(shellPid)), `MODEL=${modelValue} URL=${urlValue}`, 'utf-8')
  }
}
