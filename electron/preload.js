'use strict';
// Sichere Brücke zwischen Programmfenster und Hauptprozess (nur wenige, feste Funktionen).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ekDesktop', {
  isDesktop: true,
  openDataFolder: () => ipcRenderer.invoke('ek:openDataFolder'),
  runUpdater: () => ipcRenderer.invoke('ek:runUpdater'),
  checkUpdate: () => ipcRenderer.invoke('ek:updateCheck'),
  updateState: () => ipcRenderer.invoke('ek:updateState'),
  installUpdate: () => ipcRenderer.invoke('ek:updateInstall'),
  onUpdate: (cb) => { ipcRenderer.on('ek:update', (_e, msg) => cb(msg)); },
});
