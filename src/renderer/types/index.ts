/** 模型配置 */
export interface ModelConfig {
  id: string
  name: string
  shortName: string
  authToken: string
  baseUrl: string
  apiTimeout?: number
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  customVars?: Record<string, string>
  createdAt: number
  updatedAt: number
}

/** 终端会话（通用，支持所有终端应用） */
export interface TerminalSession {
  sessionId: string     // TTY 路径作为唯一标识
  windowIndex: number   // 兼容保留
  windowId: number      // 兼容保留
  tabIndex: number      // 兼容保留
  tty: string           // /dev/ttys00N
  name: string          // 显示名
  columns: number       // 兼容保留
  rows: number          // 兼容保留
  profileName: string   // 兼容保留，现在存宿主应用名
  appName: string       // 宿主应用：iTerm2 / Terminal / IDEA / Cursor / VS Code
  shellPid: number      // shell 进程 PID
  isBusy: boolean       // claude 是否在运行
  currentModel?: string
  currentBaseUrl?: string
}

/** Session 状态（从 /tmp/cc-status 读取） */
export interface SessionModelStatus {
  model: string
  baseUrl: string
}

/** IPC 通道名称 */
export const IPC_CHANNELS = {
  CONFIG_LIST: 'config:list',
  CONFIG_SAVE: 'config:save',
  CONFIG_DELETE: 'config:delete',
  CONFIG_IMPORT: 'config:import',
  SESSION_LIST: 'session:list',
  SESSION_SWITCH: 'session:switch',
  SESSION_DETECT: 'session:detect',
  STATUS_READ: 'status:read',
  HOOK_CHECK: 'hook:check',
  HOOK_INSTALL: 'hook:install',
  HOOK_UNINSTALL: 'hook:uninstall',
  HOOK_NEEDS_UPGRADE: 'hook:needsUpgrade',
  HOOK_UPGRADE: 'hook:upgrade'
} as const

/** Preload 暴露给渲染进程的 API */
export interface CCSwitchAPI {
  config: {
    list: () => Promise<ModelConfig[]>
    save: (config: ModelConfig) => Promise<void>
    delete: (id: string) => Promise<void>
    importExisting: () => Promise<ModelConfig[]>
  }
  session: {
    list: () => Promise<TerminalSession[]>
    switchModel: (sessionId: string, shortName: string, tty: string, hotSwitch: boolean) => Promise<void>
    detectModels: () => Promise<void>
  }
  status: {
    read: () => Promise<Record<string, SessionModelStatus>>
  }
  hook: {
    check: () => Promise<boolean>
    install: () => Promise<void>
    uninstall: () => Promise<void>
    needsUpgrade: () => Promise<boolean>
    upgrade: () => Promise<void>
  }
}

declare global {
  interface Window {
    ccSwitch: CCSwitchAPI
  }
}
