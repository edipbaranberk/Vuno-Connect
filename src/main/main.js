// Vuno Connect - Ana süreç (main process) — orkestratör
// Detaylı modüller: windows.js, tray.js, security.js, ai.js, ipc.js, logger.js, userAgent.js, store.js
const { app, ipcMain, powerMonitor, nativeTheme } = require('electron');
const path = require('path');
const crypto = require('crypto');
const Store = require('./store');
const { logToFile, attachConsoleHooks } = require('./logger');
const {
  buildChromeUserAgent,
  chromelessUserAgent,
  isGoogleAccountsUrl
} = require('./userAgent');

// Modüller
const createWindowsModule = require('./windows');
const createTrayModule = require('./tray');
const createSecurityModule = require('./security');
const createAiModule = require('./ai');
const createIpcModule = require('./ipc');
const createUpdaterModule = require('./updater');

// Electron Chromium sürümüyle eşleşen UA (sabit sürüm spoof'u Google tarafından reddediliyordu)
const CHROME_UA = buildChromeUserAgent();
app.userAgentFallback = CHROME_UA;

const ROOT = path.join(__dirname, '..', '..');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.png');
const TRAY_PATH = path.join(ROOT, 'assets', 'tray.png');
const WEBVIEW_PRELOAD = path.join(__dirname, '..', 'preload', 'webview-preload.js');

attachConsoleHooks();

let store;
let mainWindow = null;
let popupWindow = null;
let tray = null;
let isQuitting = false;
let totalUnread = 0;
let idleTimer = null;

app.setAppUserModelId('com.vuno.connect');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Windows konsolunda "crashpad ... not connected" uyarisi (çoğu zaman zararsiz)
app.commandLine.appendSwitch('disable-breakpad');
if (process.env.VUNO_SMOKE_USERDATA) app.setPath('userData', process.env.VUNO_SMOKE_USERDATA);

// Tek örnek kilidi: ikinci kez açılırsa mevcut pencereyi öne getir, yenisini anında kapat
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ----------------------------- Paylaşılan yardımcılar ----------------------------- */

function settings() {
  return store.get('settings');
}

function timeToMinutes(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isDndActive() {
  const s = settings();
  if (s.dnd) return true;
  if (s.dndSchedule && s.dndSchedule.enabled) {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const from = timeToMinutes(s.dndSchedule.from);
    const to = timeToMinutes(s.dndSchedule.to);
    return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
  }
  return false;
}

function themeColors() {
  const dark = settings().theme === 'dark' ||
    (settings().theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark
    ? { color: '#0b0b14', symbolColor: '#c9c9e0', bg: '#0b0b14' }
    : { color: '#f4f4fa', symbolColor: '#3a3a55', bg: '#f4f4fa' };
}

function applyLoginItem() {
  const s = settings();
  if (!app.isPackaged) return; // Geliştirme modunda electron.exe'yi başlangıca eklemeyelim
  app.setLoginItemSettings({
    openAtLogin: !!s.startWithWindows,
    args: ['--hidden']
  });
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

function startIdleWatcher() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    const lock = settings().lock;
    if (!lock || !lock.enabled || !lock.autoLockMinutes) return;
    if (powerMonitor.getSystemIdleTime() >= lock.autoLockMinutes * 60) {
      ctx.sendToMain('vuno:lock');
    }
  }, 20000);
}

/* ----------------------------- Modül kurulumu (ctx köprüsü) ----------------------------- */

const ctx = {
  app,
  paths: { ROOT, ICON_PATH, TRAY_PATH, WEBVIEW_PRELOAD },
  CHROME_UA,
  chromelessUserAgent,
  isGoogleAccountsUrl,
  get store() { return store; },
  get mainWindow() { return mainWindow; },
  set mainWindow(v) { mainWindow = v; },
  get popupWindow() { return popupWindow; },
  set popupWindow(v) { popupWindow = v; },
  get isQuitting() { return isQuitting; },
  set isQuitting(v) { isQuitting = v; },
  get totalUnread() { return totalUnread; },
  set totalUnread(v) { totalUnread = v; },
  settings, timeToMinutes, isDndActive, themeColors, hashPin, applyLoginItem
};

const windows = createWindowsModule(ctx);
const trayModule = createTrayModule(ctx);
const security = createSecurityModule(ctx);
const ai = createAiModule(ctx);
const ipcModule = createIpcModule(ctx);
const updater = createUpdaterModule(ctx);

// Çapraz modül referansları
ctx.sendToMain = windows.sendToMain;
ctx.showMainWindow = windows.showMainWindow;
ctx.pushPopup = windows.pushPopup;
ctx.resizePopup = windows.resizePopup;
ctx.updateTray = trayModule.updateTray;
ctx.getAiKey = ai.getAiKey;

/* ----------------------------- Yaşam döngüsü ----------------------------- */

app.whenReady().then(() => {
  store = new Store();
  logToFile('[BOOT] Vuno Connect başladı, chrome ' + process.versions.chrome);

  // Eski kayıtlarda düz metin duran Gemini anahtarını safeStorage'a taşı
  try {
    const s = settings();
    if (s.aiKey && s.aiKey.trim() && require('electron').safeStorage.isEncryptionAvailable()) {
      s.aiKeyEnc = require('electron').safeStorage.encryptString(s.aiKey.trim()).toString('base64');
      s.aiKey = '';
      store.saveNow();
      logToFile('[BOOT] Gemini anahtarı safeStorage ile şifrelendi');
    }
  } catch (_) {}

  security.setupWebContentsHandling();
  ipcModule.setupIpc();
  ai.setupAiIpc();
  updater.setupIpc();
  windows.createMainWindow();
  trayModule.createTray();

  process.on('uncaughtException', (e) => console.error('[vuno] beklenmeyen hata:', e));
  app.on('child-process-gone', (_e, details) => {
    console.error('[vuno] child-process-gone:', JSON.stringify(details));
  });
  app.on('render-process-gone', (_e, wc, details) => {
    console.error('[vuno] render-process-gone:', JSON.stringify(details));
  });
  app.on('gpu-process-gone', (_e, details) => {
    console.error('[vuno] gpu-process-gone:', JSON.stringify(details));
  });

  applyLoginItem();
  startIdleWatcher();
  updater.startAutoCheck();

  powerMonitor.on('lock-screen', () => {
    if (settings().lock && settings().lock.enabled) ctx.sendToMain('vuno:lock');
  });

  // Zamanlanmış Rahatsız Etme modunun tepsiye yansıması için periyodik güncelleme
  setInterval(trayModule.updateTray, 60000);

  if (process.env.VUNO_SMOKE) runSmokeTest(process.env.VUNO_SMOKE);
});

// Geliştirici duman testi: VUNO_SMOKE=<klasör> ile ekran görüntüsü alır ve çıkar
function runSmokeTest(outDir) {
  const fs = require('fs');
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });
  mainWindow.show();
  setTimeout(() => {
    windows.pushPopup({
      key: 'demo', accountId: 'demo', notifId: 'demo', accountName: 'Kişisel', serviceName: 'WhatsApp',
      serviceIcon: 'whatsapp', serviceLetter: 'W', gradient: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
      title: 'Ayşe Yılmaz', body: 'Akşam yemeğe geliyor musun? 🍝 Saat 8 gibi buluşalım.', icon: null
    });
  }, 1500);
  setTimeout(async () => {
    const { webContents } = require('electron');
    for (const wc of webContents.getAllWebContents()) {
      if (wc.getType() !== 'webview') continue;
      console.log('[webview]', wc.getURL(), '| title:', wc.getTitle());
      try {
        const r = await wc.executeJavaScript(`(() => { const n = new Notification('Test Kişi', { body: 'Vuno bildirim testi ✅' }); return typeof window.__vunoPrepareReply + '|' + Notification.permission; })()`);
        console.log('[webview hook]', r);
      } catch (err) { console.log('[webview hook error]', err.message); }
    }
  }, 9000);
  setTimeout(async () => {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'main.png'), img.toPNG());
      if (popupWindow) {
        const p = await popupWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'popup.png'), p.toPNG());
      }
    } catch (err) {
      console.error('[smoke] ekran görüntüsü alınamadı:', err.message);
    }
    console.log('SMOKE_OK');
    ctx.isQuitting = true;
    app.quit();
  }, Number(process.env.VUNO_SMOKE_WAIT || 5000));
}

app.on('before-quit', () => {
  ctx.isQuitting = true;
  if (store) store.saveNow();
});

app.on('window-all-closed', () => {
  // Tepside çalışmaya devam et
});
