import { contextBridge, ipcRenderer } from 'electron'
import type { CCSwitchAPI } from '../renderer/types'

const api: CCSwitchAPI = {
  config: {
    list: () => ipcRenderer.invoke('config:list'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    delete: (id) => ipcRenderer.invoke('config:delete', id),
    importExisting: () => ipcRenderer.invoke('config:import')
  },
  session: {
    list: () => ipcRenderer.invoke('session:list'),
    switchModel: (sessionId, shortName, tty, hotSwitch) =>
      ipcRenderer.invoke('session:switch', sessionId, shortName, tty, hotSwitch),
    detectModels: () => ipcRenderer.invoke('session:detect')
  },
  status: {
    read: () => ipcRenderer.invoke('status:read')
  },
  hook: {
    check: () => ipcRenderer.invoke('hook:check'),
    install: () => ipcRenderer.invoke('hook:install'),
    uninstall: () => ipcRenderer.invoke('hook:uninstall'),
    needsUpgrade: () => ipcRenderer.invoke('hook:needsUpgrade'),
    upgrade: () => ipcRenderer.invoke('hook:upgrade')
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  }
}

contextBridge.exposeInMainWorld('ccSwitch', api)
