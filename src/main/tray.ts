import { app, Tray, Menu, nativeImage } from 'electron'

let tray: Tray | null = null

/** 内嵌 template 图标（与 App Logo 同构：双弧箭头 + 中心点）。
 *  提供 @1x(22) 与 @2x(44)，retina 屏清晰；setTemplateImage 让 macOS 自适配深浅色。 */
const TRAY_ICON_1X =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAjElEQVR4nGNgGAXDGhQwMDCcZ2Bg+A/F56FiZAMBNAPR8XmoGpLBeSQDApDEA9DkSAIFBFyF7Jt+UgwGaUxgYGAwQBJTgGIYaEAKlgZSDYcZrIBkCMxwkGH3oQ4gGiRANcFcgs1gA1IjD5cX0YPCAOoAkgzvJyHySE7TNElu6K6iagaBAapn6VEwyAEA/Jc9yVUzaS4AAAAASUVORK5CYII='
const TRAY_ICON_2X =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAABFUlEQVR4nO2XgQ2EIAxF/wiOwAiO4Cg3Aps4gqM4giPcCIxwF5KaEKxH8UAk6UtIDEj5KS0FQFEURVGUNAaABbACcAA+1Bz1WfqnOV7EEghMtaWl8FfkTWlzNPd2sblC43ab6DOxG42FW26ob2sl2jBh4CipUtiTuVVjOk4wv+CYMX9kRC+1xBpmSyWejbGF7IjwHpoBvCkur8LFs7c5FdR64Cz2BvKYpW+OJoI5BqbScaKvJO1fGCq5MdL43MfmH7tQhIEW2Re8Kni9o0Rz52iMNCSqMlFCcInCIUm6qt7NFSxhI5tzZuHJotSBz9mp5vGuSjN6vPygt+tlSvQjL/Ch6G6eSDtdPUJDunnmK4qiKMqz+QLr3vlT3Z0WRQAAAABJRU5ErkJggg=='

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

