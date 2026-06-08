import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../renderer/types'
import { SessionScanner } from './modules/session-scanner'
import { CommandSender } from './modules/command-sender'
import { ConfigManager } from './modules/config-manager'
import { HookInstaller } from './modules/hook-installer'

const scanner = new SessionScanner()
const sender = new CommandSender()
const configManager = new ConfigManager()
const hookInstaller = new HookInstaller()

export function registerIpcHandlers() {
  // 启动时自动检测空闲 session
  autoDetect()

  // 配置管理
  ipcMain.handle(IPC_CHANNELS.CONFIG_LIST, () => configManager.loadAll())
  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_e, config) => configManager.save(config))
  ipcMain.handle(IPC_CHANNELS.CONFIG_DELETE, (_e, id) => configManager.remove(id))
  ipcMain.handle(IPC_CHANNELS.CONFIG_IMPORT, () => configManager.importExisting())

  // 会话管理
  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, () => scanner.listSessions())

  ipcMain.handle(IPC_CHANNELS.SESSION_SWITCH, async (_e, _sessionId: string, shortName: string, tty: string) => {
    sender.updateStatusOptimistically(shortName, tty)

    const sessions = await scanner.listSessions()
    const session = sessions.find((s) => s.tty === tty)
    if (!session) return

    // SIGWINCH 方案：无需区分 busy/idle
    // - 空闲时：trap 立即执行
    // - claude 运行中：bash 自动排队 trap，claude 退出后执行
    await sender.sendSwitchCommand(session, shortName)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_DETECT, async () => {
    const sessions = await scanner.listSessions()
    for (const s of sessions) {
      if (!s.isBusy) {
        await sender.sendDetectCommand(s)
      }
    }
  })

  // Hook
  ipcMain.handle(IPC_CHANNELS.HOOK_CHECK, () => hookInstaller.isInstalled())
  ipcMain.handle(IPC_CHANNELS.HOOK_INSTALL, () => hookInstaller.install())
  ipcMain.handle(IPC_CHANNELS.HOOK_UNINSTALL, () => hookInstaller.uninstall())
}

async function autoDetect() {
  try {
    const sessions = await scanner.listSessions()
    for (const s of sessions) {
      if (!s.isBusy) {
        await sender.sendDetectCommand(s)
      }
    }
  } catch { /* ignore */ }
}
