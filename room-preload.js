'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roomApp', {
  discover: (deep) => ipcRenderer.invoke('room:discover', deep),
  check: (address) => ipcRenderer.invoke('room:check', address),
  pair: (server, pin) => ipcRenderer.invoke('room:pair', server, pin),
  save: (cfg) => ipcRenderer.invoke('room:save', cfg),
  config: () => ipcRenderer.invoke('room:config'),
  retry: () => ipcRenderer.invoke('room:retry'),
  setup: (reason) => ipcRenderer.invoke('room:setup', reason),
  quit: () => ipcRenderer.invoke('room:quit'),
  firewallStatus: () => ipcRenderer.invoke('room:fw-status'),
  firewallFix: () => ipcRenderer.invoke('room:fw-fix'),
  onOfflineTick: (cb) => ipcRenderer.on('offline-tick', (_e, n) => cb(n)),
});
