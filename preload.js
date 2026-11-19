'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flame', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openPlayer: (url, title) => ipcRenderer.invoke('open-player', url, title),
  launch: (mode, url, remember) => ipcRenderer.invoke('launch', mode, url, remember),
  getConfig: () => ipcRenderer.invoke('get-config'),
});
