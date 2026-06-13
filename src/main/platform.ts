import { homedir } from 'os'
import { join } from 'path'

/** 平台检测 */
export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

export const HOME = homedir()
/** 应用数据目录（跨平台：mac/win 都用 ~/.cc-switch-plus） */
export const APP_DATA_DIR = join(HOME, '.cc-switch-plus')

/** Windows 配置 profile 目录 */
export const WIN_PROFILES_DIR = join(APP_DATA_DIR, 'profiles')
/** Windows 运行时 pending 目录（PowerShell prompt hook 读取） */
export const WIN_PENDING_DIR = join(APP_DATA_DIR, 'pending')
/** Windows 状态上报目录 */
export const WIN_STATUS_DIR = join(APP_DATA_DIR, 'status')

/**
 * Windows 会话标识：无 tty 概念，用 shell 进程 PID 作为唯一标识。
 * status/pending 文件名用 PID。
 */
export function winSessionKey(shellPid: number): string {
  return `pid_${shellPid}`
}
