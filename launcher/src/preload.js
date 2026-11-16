const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gen', {
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openGameFolder: () => ipcRenderer.invoke('folder:open'),
  status: () => ipcRenderer.invoke('pack:status'),
  play: () => ipcRenderer.invoke('pack:play'),
  skin: () => ipcRenderer.invoke('skin:get'),
  skinFromFile: () => ipcRenderer.invoke('skin:file'),
  skinFromNick: nick => ipcRenderer.invoke('skin:nick', nick),
  setSkinModel: model => ipcRenderer.invoke('skin:model', model),
  setCape: id => ipcRenderer.invoke('skin:cape', id),
  serverStatus: () => ipcRenderer.invoke('server:status'),
  quit: () => ipcRenderer.invoke('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:fullscreen'),
  onProgress: cb => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onGameExit: cb => ipcRenderer.on('game:exit', (_e, code) => cb(code)),
});
