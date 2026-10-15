// Ana pencere için güvenli köprü
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('vuno', {
  getStore: () => ipcRenderer.invoke('store:get'),
  saveAccounts: (accounts, activeId) => ipcRenderer.invoke('accounts:save', accounts, activeId),
  saveTemplates: (templates) => ipcRenderer.invoke('templates:save', templates),
  saveWorkspace: (ws) => ipcRenderer.invoke('workspace:save', ws),
  translate: (text, targetLang = 'tr', sourceLang = 'auto') => ipcRenderer.invoke('translate:text', { text, targetLang, sourceLang }),
  summarize: (text, history) => ipcRenderer.invoke('summarize:text', { text, history }),
  testGemini: (apiKey, model) => ipcRenderer.invoke('gemini:test', { apiKey, model }),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  setPin: (pin) => ipcRenderer.invoke('lock:set', pin),
  verifyPin: (pin) => ipcRenderer.invoke('lock:verify', pin),
  isDndActive: () => ipcRenderer.invoke('dnd:active'),
  notify: (n) => ipcRenderer.send('notify', n),
  setBadge: (count, dataUrl) => ipcRenderer.send('badge', count, dataUrl),
  quit: () => ipcRenderer.send('app:quit'),
  clearSession: (partition) => ipcRenderer.invoke('session:clear', partition),
  openAuthWindow: (data) => ipcRenderer.invoke('vuno:open-auth-window', data),

  onReply: listen('vuno:reply'),
  onOpenNotification: listen('vuno:open-notification'),
  onLock: listen('vuno:lock'),
  onPlaySound: listen('vuno:play-sound'),
  onSettingsChanged: listen('vuno:settings-changed'),
  onWindowFocus: listen('vuno:window-focus')
});
