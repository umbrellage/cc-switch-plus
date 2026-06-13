import { app, Tray, Menu, nativeImage } from 'electron'

let tray: Tray | null = null

/** template 图标（双弧箭头，与 Logo 同构）。@1x 22 / @2x 44。 */
const TRAY_ICON_1X =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAfElEQVR4nGNgGAXDGhQwMDCcZ2Bg+A/F56FiZAMBJANBdAMUI4sJkGMwSON7BgYGByxyDlC586QaWgB1VQAeNQFQNSQFC8y7yK51wML/T6yrDRgYGPYjRRTMIAcCYvuheulvMM2CAgZoFnkMtEpuDLTMIDBA9Sw9CgY5AACroD+J87hEiAAAAABJRU5ErkJggg=='
const TRAY_ICON_2X =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAA/0lEQVR4nO2XgQ2EIAxF/wiMwAiO4AiO4CiO4QgoOI5j+A/F56kUl6TkJWmYD8Co5S5Mywd1Vf+J8r9nGe5RkPR3lCb7nOf5R6oCeiG9q4u+qzT0V0Uf4j9K8x9V8Z8qj6+qDhU92FNVdEUdYqMqVu0qS6paNUvFW1Wfrqp9TNU//KuqP1X1r6r6V1W9Uup/D6p8VOV/lPUPqgqYhmEYhmEYxh/9H4fTMHf3MNRTAAAAAElFTkSuQmCC'

function loadTrayIcon(): nativeImage {
  const img = nativeImage.createEmpty()
  img.addRepresentation({ width: 22, height: 22, scaleFactor: 1, dataURL: TRAY_ICON_1X })
  img.addRepresentation({ width: 44, height: 44, scaleFactor: 2, dataURL: TRAY_ICON_2X })
  img.setTemplateImage(true)
  return img
}

/** 创建菜单栏常驻 Tray */
export function createTray(onShowMain: () => void, onQuickSwitch: () => void): void {
  if (tray) return
  tray = new Tray(loadTrayIcon())
  tray.setToolTip('CC Switch Plus')

  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => onShowMain() },
    { label: '快速切换模型  ⌘⇧M', click: () => onQuickSwitch() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}
