import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'

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

  const rendererPath = getRendererPath()
  if (rendererPath.startsWith('http')) {
    mainWindow.loadURL(rendererPath)
  } else {
    mainWindow.loadFile(rendererPath)
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
