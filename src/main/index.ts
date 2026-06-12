import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { createTray } from './tray'
import { createQuickWindow, registerQuickShortcut, toggleQuickWindow } from './quick-window'

let mainWindow: BrowserWindow | null = null

function getRendererPath(): string {
  // 开发模式：从 vite dev server 加载
  if (process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL
  }

  // 生产模式：renderer 被 extraResources 打包到 Resources/renderer/ (asar 外)
  // __dirname = app.asar/out/main（仍在 asar 内，无法通过 .. 跳出）
  // 必须用 process.resourcesPath 定位 Resources 目录
  return join(process.resourcesPath, 'renderer', 'index.html')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'CC Switch Plus',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 主窗销毁后清空引用（不依赖 getAllWindows——快速窗常驻会污染它）
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const rendererPath = getRendererPath()
  if (rendererPath.startsWith('http')) {
    mainWindow.loadURL(rendererPath)
  } else {
    mainWindow.loadFile(rendererPath)
  }
}

/** 显示或重建主窗口（供 Tray 菜单 / dock activate 复用） */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  // 菜单栏常驻 + 快速切换窗 + 全局快捷键（纯叠加，不影响主窗口逻辑）
  createQuickWindow()
  registerQuickShortcut()
  createTray(showMainWindow, toggleQuickWindow)

  app.on('activate', () => {
    // 基于主窗引用判断，不受常驻快速窗影响
    if (!mainWindow) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
