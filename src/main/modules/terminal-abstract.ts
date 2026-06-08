/** 终端后端抽象接口 - 预留扩展 */
export interface TerminalBackend {
  readonly name: string
  isAvailable(): Promise<boolean>
  listSessions(): Promise<import('../../renderer/types').TerminalSession[]>
  sendCommand(sessionId: string, text: string): Promise<void>
}
