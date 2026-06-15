import { ipcMain, app } from 'electron'
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
  autoInstallHook()
  autoDetect()

  // 配置管理
  ipcMain.handle(IPC_CHANNELS.CONFIG_LIST, () => configManager.loadAll())
  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_e, config) => configManager.save(config))
  ipcMain.handle(IPC_CHANNELS.CONFIG_DELETE, (_e, id) => configManager.remove(id))
  ipcMain.handle(IPC_CHANNELS.CONFIG_IMPORT, () => configManager.importExisting())

  // 会话管理
  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, () => scanner.listSessions())

  ipcMain.handle(IPC_CHANNELS.SESSION_SWITCH, async (_e, sessionId: string, shortName: string, _tty: string, hotSwitch: boolean) => {
    const sessions = await scanner.listSessions()
    // mac 用 tty 匹配，win 用 sessionId(pid_X) 匹配；两者择一
    const session = sessions.find((s) => s.sessionId === sessionId || (_tty && s.tty === _tty))
    if (!session) return

    sender.updateStatusOptimistically(shortName, session)

    // 热切换：写 pending(source 新 env + claude -c 续接)，mac 额外发 SIGINT 中断当前 claude。
    // Windows 无跨 console 信号，interruptClaude 为空操作 → claude 需用户手动 Ctrl+C 退出后 prompt hook 续接。
    if (hotSwitch) {
      await sender.sendWarmSwitchCommand(session, shortName)
      const claudePid = await scanner.findClaudePid(session.sessionId)
      if (claudePid) await sender.interruptClaude(claudePid)
    } else {
      await sender.sendSwitchCommand(session, shortName)
    }
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
  ipcMain.handle(IPC_CHANNELS.HOOK_NEEDS_UPGRADE, () => hookInstaller.needsUpgrade())
  ipcMain.handle(IPC_CHANNELS.HOOK_UPGRADE, () => hookInstaller.upgrade())

  // App
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())
}

async function autoInstallHook() {
  try {
    const installed = await hookInstaller.isInstalled()
    if (!installed) {
      await hookInstaller.install()
    } else if (await hookInstaller.needsUpgrade()) {
      await hookInstaller.upgrade()
    }
  } catch { /* ignore */ }
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
