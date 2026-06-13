import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'

let quickWin: BrowserWindow | null = null
let isQuitting = false

app.on('before-quit', () => {
  isQuitting = true
})

/** 解析快速窗入口：dev 走 vite dev server，prod 走 resources/renderer */
function resolveEntry(name: string): { isUrl: boolean; target: string } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { isUrl: true, target: `${process.env.ELECTRON_RENDERER_URL}/${name}` }
  }
  return { isUrl: false, target: join(process.resourcesPath, 'renderer', name) }
}

/** 创建快速切换窗（不显示） */
export function createQuickWindow(): void {
  if (quickWin && !quickWin.isDestroyed()) return

  quickWin = new BrowserWindow({
    width: 440,
    height: 380,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: true,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  quickWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      quickWin?.hide()
    }
  })

  quickWin.on('blur', () => {
    if (quickWin && quickWin.isVisible()) quickWin.hide()
  })

  const entry = resolveEntry('quick.html')
  if (entry.isUrl) {
    quickWin.loadURL(entry.target)
  } else {
    quickWin.loadFile(entry.target)
  }
}

/** 切换快速窗显隐 */
export function toggleQuickWindow(): void {
  if (!quickWin || quickWin.isDestroyed()) {
    createQuickWindow()
  }
  if (!quickWin) return
  if (quickWin.isVisible()) {
    quickWin.hide()
  } else {
    quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    quickWin.setAlwaysOnTop(true, 'floating')
    quickWin.show()
    quickWin.focus()
  }
}

/** 注册全局快捷键 ⌘⇧M */
export function registerQuickShortcut(): boolean {
  const ok = globalShortcut.register('Shift+CommandOrControl+M', toggleQuickWindow)
  if (!ok) {
    console.error('[cc-switch-plus] 快捷键 ⌘⇧M 注册失败（可能被占用）')
  }
  return ok
}
