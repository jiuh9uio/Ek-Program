'use strict';
// Sichere Brücke zwischen Programmfenster und Hauptprozess (nur wenige, feste Funktionen).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ekDesktop', {
  isDesktop: true,
  openDataFolder: () => ipcRenderer.invoke('ek:openDataFolder'),
  runUpdater: () => ipcRenderer.invoke('ek:runUpdater'),
});
