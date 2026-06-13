import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { createTray } from './tray'
import { createQuickWindow, registerQuickShortcut, toggleQuickWindow } from './quick-window'

let mainWindow: BrowserWindow | null = null

function getRendererPath(name = 'index.html'): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}/${name}`
  }
  return join(process.resourcesPath, 'renderer', name)
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

/** 显示或重建主窗口（Tray 菜单 / dock activate 复用） */
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

  // 菜单栏常驻 + 快速切换窗 + 全局快捷键（纯叠加）
  createQuickWindow()
  registerQuickShortcut()
  createTray(showMainWindow, toggleQuickWindow)

  app.on('activate', () => {
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
