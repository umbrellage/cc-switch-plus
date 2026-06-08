import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import type { TerminalSession, SessionModelStatus } from '../../renderer/types'

const STATUS_DIR = '/tmp/cc-status'

/** tty 路径 → 状态文件名：/dev/ttys001 → _dev_ttys001 */
function ttyToFileName(tty: string): string {
  return tty.replace(/\//g, '_')
}

export class StatusMonitor {
  /** 读取所有状态文件 */
  async readAll(): Promise<Record<string, SessionModelStatus>> {
    const result: Record<string, SessionModelStatus> = {}
    if (!existsSync(STATUS_DIR)) return result

    const files = readdirSync(STATUS_DIR)
    for (const file of files) {
      const filePath = join(STATUS_DIR, file)
      try {
        const content = readFileSync(filePath, 'utf-8').trim()
        const mtime = statSync(filePath).mtimeMs
        const status = this.parseStatus(content, mtime)
        if (status) {
          // file: _dev_ttys001 → /dev/ttys001
          const tty = file.replace(/_/g, '/').replace(/^\/dev\//, '/dev/')
          result[tty] = status
        }
      } catch {
        // 文件可能已被删除，忽略
      }
    }
    return result
  }

  /** 为 session 列表补充 currentModel 信息 */
  async enrichSessions(sessions: TerminalSession[]): Promise<TerminalSession[]> {
    const statusMap = await this.readAll()
    return sessions.map((session) => {
      const status = statusMap[session.tty]
      return {
        ...session,
        currentModel: status?.model,
        currentBaseUrl: status?.baseUrl
      }
    })
  }

  /** 解析状态文件内容 */
  private parseStatus(content: string, mtime: number): SessionModelStatus | null {
    // 格式: MODEL=xxx URL=xxx
    const modelMatch = content.match(/MODEL=(\S+)/)
    const urlMatch = content.match(/URL=(\S+)/)
    if (!modelMatch) return null
    return {
      model: modelMatch[1] === 'unknown' ? '' : modelMatch[1],
      baseUrl: urlMatch?.[1] || ''
    }
  }
}
