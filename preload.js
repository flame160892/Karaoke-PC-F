'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flame', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openPlayer: (url, title) => ipcRenderer.invoke('open-player', url, title),
  getConfig: () => ipcRenderer.invoke('get-config'),
  appInfo: () => ipcRenderer.invoke('app-info'),
  firewallStatus: () => ipcRenderer.invoke('fw-status'),
  firewallFix: () => ipcRenderer.invoke('fw-fix'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, v) => cb(v)),
});
