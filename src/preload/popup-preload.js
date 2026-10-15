// Bildirim pop-up penceresi için köprü
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popup', {
  onAdd: (cb) => ipcRenderer.on('popup:add', (_e, n) => cb(n)),
  onTheme: (cb) => ipcRenderer.on('popup:theme', (_e, t) => cb(t)),
  resize: (h) => ipcRenderer.send('popup:resize', h),
  reply: (data) => ipcRenderer.send('popup:reply', data),
  open: (data) => ipcRenderer.send('popup:open', data),
  focus: () => ipcRenderer.send('popup:focus')
});
