// Vuno Messenger - Ana süreç (main process)
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, session,
  screen, powerMonitor, nativeTheme, Notification
} = require('electron');
const path = require('path');
const crypto = require('crypto');
const Store = require('./store');

// Servislerin "desteklenmeyen tarayıcı" uyarısı vermemesi için Electron izi olmayan bir Chrome UA kullanılır.
const CHROME_VERSION = process.versions.chrome || '130.0.0.0';
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
app.userAgentFallback = USER_AGENT;

const ROOT = path.join(__dirname, '..', '..');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.png');
const TRAY_PATH = path.join(ROOT, 'assets', 'tray.png');
const WEBVIEW_PRELOAD = path.join(__dirname, '..', 'preload', 'webview-preload.js');

let store;
let mainWindow = null;
let popupWindow = null;
let tray = null;
let isQuitting = false;
let totalUnread = 0;
let popupQueue = [];
let idleTimer = null;

app.setAppUserModelId('com.vuno.messenger');
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

/* ----------------------------- Yardımcılar ----------------------------- */

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

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function applyLoginItem() {
  const s = settings();
  if (!app.isPackaged) return; // Geliştirme modunda electron.exe'yi başlangıca eklemeyelim
  app.setLoginItemSettings({
    openAtLogin: !!s.startWithWindows,
    args: ['--hidden']
  });
}

/* ----------------------------- Ana pencere ----------------------------- */

function createMainWindow() {
  const w = store.get('window');
  const colors = themeColors();
  const startHidden = process.argv.includes('--hidden') || settings().startMinimized;

  mainWindow = new BrowserWindow({
    width: w.width,
    height: w.height,
    x: w.x,
    y: w.y,
    minWidth: 900,
    minHeight: 600,
    show: true,
    title: 'Vuno Messenger',
    icon: ICON_PATH,
    backgroundColor: colors.bg,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (w.maximized) mainWindow.maximize();
    if (!startHidden) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Windows'ta bazen ready-to-show geç tetiklenebilir veya arka planda kalabilir
  if (!startHidden) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, 500);
  }

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const b = maximized ? store.get('window') : mainWindow.getBounds();
    store.set('window', { ...b, maximized });
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  mainWindow.on('close', (e) => {
    if (!isQuitting && settings().closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('focus', () => sendToMain('vuno:window-focus', true));
  mainWindow.on('blur', () => sendToMain('vuno:window-focus', false));
}

/* ----------------------------- Bildirim pop-up ----------------------------- */

function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 400,
    height: 10,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'popup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  popupWindow.setAlwaysOnTop(true, 'screen-saver');
  popupWindow.loadFile(path.join(__dirname, '..', 'popup', 'popup.html'));
  popupWindow.webContents.once('did-finish-load', () => {
    popupWindow.webContents.send('popup:theme', settings().theme);
    for (const n of popupQueue) popupWindow.webContents.send('popup:add', n);
    popupQueue = [];
  });
  popupWindow.on('closed', () => { popupWindow = null; });
}

function pushPopup(n) {
  if (!popupWindow) createPopupWindow();
  if (popupWindow.webContents.isLoading()) {
    popupQueue.push(n);
  } else {
    popupWindow.webContents.send('popup:add', n);
  }
}

function resizePopup(height) {
  if (!popupWindow) return;
  if (height <= 0) {
    popupWindow.hide();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const width = 400;
  const h = Math.min(Math.ceil(height), workArea.height - 20);
  popupWindow.setBounds({
    x: workArea.x + workArea.width - width - 8,
    y: workArea.y + workArea.height - h - 8,
    width,
    height: h
  });
  if (!popupWindow.isVisible()) popupWindow.showInactive();
}

/* ----------------------------- Sistem tepsisi ----------------------------- */

function buildTrayMenu() {
  const s = settings();
  return Menu.buildFromTemplate([
    { label: 'Vuno Messenger\'ı Aç', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Rahatsız Etme',
      type: 'checkbox',
      checked: !!s.dnd,
      click: (item) => {
        s.dnd = item.checked;
        store.save();
        sendToMain('vuno:settings-changed', s);
        updateTray();
      }
    },
    {
      label: 'Uygulamayı Kilitle',
      enabled: !!(s.lock && s.lock.enabled),
      click: () => sendToMain('vuno:lock')
    },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => { isQuitting = true; app.quit(); }
    }
  ]);
}

function updateTray() {
  if (!tray) return;
  const dnd = isDndActive() ? ' • Rahatsız Etme açık' : '';
  tray.setToolTip(totalUnread > 0
    ? `Vuno Messenger — ${totalUnread} okunmamış mesaj${dnd}`
    : `Vuno Messenger${dnd}`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const img = nativeImage.createFromPath(TRAY_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showMainWindow();
  });
  updateTray();
}

/* ----------------------------- Uygulama kilidi ----------------------------- */

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

function startIdleWatcher() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    const lock = settings().lock;
    if (!lock || !lock.enabled || !lock.autoLockMinutes) return;
    if (powerMonitor.getSystemIdleTime() >= lock.autoLockMinutes * 60) {
      sendToMain('vuno:lock');
    }
  }, 20000);
}

/* ----------------------------- Webview güvenliği ----------------------------- */

function setupWebContentsHandling() {
  // Renderer'ın ekleyeceği her <webview> için güvenli ayarları zorla
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (_ev, webPreferences, params) => {
      delete webPreferences.preloadURL;
      webPreferences.preload = WEBVIEW_PRELOAD;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = false;
      webPreferences.spellcheck = true;
      if (!/^https:\/\//.test(params.src || '')) {
        _ev.preventDefault();
      }
    });

    if (contents.getType() === 'webview') {
      contents.setUserAgent(USER_AGENT);
      // Harici bağlantıları varsayılan tarayıcıda aç
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
    }
  });

  // Her yeni oturum (her hesap ayrı bir "persist:" bölümü) için izinler
  app.on('session-created', (ses) => configureSession(ses));
  configureSession(session.defaultSession);
}

function configureSession(ses) {
  ses.setUserAgent(USER_AGENT);
  const allowed = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

/* ----------------------------- IPC ----------------------------- */

function setupIpc() {
  ipcMain.handle('store:get', () => {
    const data = JSON.parse(JSON.stringify(store.get()));
    // Kilit hash'ini renderer'a gönderme
    if (data.settings.lock) {
      data.settings.lock.hash = null;
      data.settings.lock.salt = null;
    }
    return data;
  });

  ipcMain.handle('accounts:save', (_e, accounts, activeAccountId) => {
    store.set('accounts', accounts);
    store.set('activeAccountId', activeAccountId);
    return true;
  });

  ipcMain.handle('templates:save', (_e, templates) => {
    store.set('templates', templates);
    return true;
  });

  ipcMain.handle('workspace:save', (_e, ws) => {
    store.set('activeWorkspace', ws);
    return true;
  });

  // Gemini API çoklu model çağrıcı (3.1 Flash-Lite ve 3.8 Flash)
  async function callGemini(apiKey, prompt, chosenModel) {
    if (!apiKey) return null;
    const s = settings();
    const modelToUse = chosenModel || s.aiModel || 'gemini-3.1-flash-lite';
    const models = [modelToUse, 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i);

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[Gemini] ${model} HTTP ${res.status}:`, errText);
          continue;
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      } catch (err) {
        console.warn(`[Gemini] ${model} hatası:`, err.message || err);
      }
    }
    return null;
  }

  // Gemini API Anahtarı Test Etme (Doğrudan seçilen modeli test eder)
  ipcMain.handle('gemini:test', async (_e, { apiKey, model }) => {
    if (!apiKey || !apiKey.trim()) return { ok: false, error: 'API anahtarı boş' };
    const key = apiKey.trim();
    const targetModel = model || 'gemini-3.1-flash-lite';

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Ping' }] }] })
      });
      if (res.ok) {
        return { ok: true, model: targetModel };
      }
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    } catch (e) {
      return { ok: false, error: e.message || 'Bağlantı kurulamadı' };
    }
  });

  // Güvenli ve çoklu kaynaklı Çeviri (Gemini AI + Ücretsiz Google Translate + MyMemory)
  ipcMain.handle('translate:text', async (_e, { text, targetLang = 'tr', sourceLang = 'auto' }) => {
    if (!text || !text.trim()) return { text: '', provider: '', detectedLang: '' };
    const s = settings();
    const apiKey = s.aiKey ? s.aiKey.trim() : '';
    const engine = s.translationEngine || (apiKey ? 'gemini' : 'google-free');

    const langNames = {
      tr: 'Turkish', pl: 'Polish', en: 'English', de: 'German',
      fr: 'French', es: 'Spanish', it: 'Italian', ru: 'Russian', ar: 'Arabic'
    };
    const targetName = langNames[targetLang] || targetLang;

    // 1. Yol: Gemini seçilmişse ve API anahtarı varsa
    if (apiKey && engine === 'gemini') {
      const prompt = `Translate the following text into ${targetName}. Respond ONLY with the direct translation, nothing else, no markdown, no quotes:\n\n${text}`;
      const geminiRes = await callGemini(apiKey, prompt, s.aiModel);
      if (geminiRes) {
        return { text: geminiRes.text, provider: `Google Gemini AI (${geminiRes.model})`, detectedLang: sourceLang === 'auto' ? '' : sourceLang };
      }
    }

    // 2. Yol: MyMemory seçilmişse
    if (engine === 'mymemory-free') {
      try {
        const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;
        const mRes = await fetch(mUrl);
        const mData = await mRes.json();
        if (mData && mData.responseData && mData.responseData.translatedText) {
          return { text: mData.responseData.translatedText, provider: 'MyMemory (Ücretsiz)', detectedLang: '' };
        }
      } catch (err) {
        console.error('MyMemory error:', err);
      }
    }

    // 3. Yol (Varsayılan Ücretsiz): Google Translate GTX API
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const gRes = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const gData = await gRes.json();
      if (gData && gData[0]) {
        const trans = gData[0].map((item) => item[0]).filter(Boolean).join('');
        const detected = gData[2] || '';
        if (trans) return { text: trans, provider: 'Google Translate (Ücretsiz)', detectedLang: detected };
      }
    } catch (err) {
      console.error('Google GTX error:', err);
    }

    // Yedek Motor: MyMemory
    try {
      const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;
      const mRes = await fetch(mUrl);
      const mData = await mRes.json();
      if (mData && mData.responseData && mData.responseData.translatedText) {
        return { text: mData.responseData.translatedText, provider: 'MyMemory (Ücretsiz)', detectedLang: '' };
      }
    } catch (_) {}

    return { text: 'Çeviri yapılamadı (Bağlantı hatası)', provider: 'Hata', detectedLang: '' };
  });

  // Gelişmiş Özetleme (Gemini AI + Akıllı Türkçe Çevirili Özetleme)
  ipcMain.handle('summarize:text', async (_e, { text, history = [] }) => {
    const allMsgs = [...history, text].filter(Boolean);
    const fullConversation = allMsgs.join('\n');
    const s = settings();
    const apiKey = s.aiKey ? s.aiKey.trim() : '';

    if (apiKey) {
      const prompt = `Aşağıdaki mesajları ve konuşma geçmişini analiz et. Kimin ne yazdığını, ana konuyu ve amacını Türkçe olarak 1 veya 2 akıcı, net cümleyle özetle. Yanıt olarak yalnızca Türkçe özeti ver, tırnak işareti koyma:\n\n${fullConversation}`;
      const geminiRes = await callGemini(apiKey, prompt, s.aiModel);
      if (geminiRes) {
        return { summary: geminiRes.text, provider: `Google Gemini AI (${geminiRes.model})` };
      }
    }

    // Gemini yoksa veya hata verdiyse: Tüm konuşmayı Google Translate ile Türkçe'ye çevirip özet sun!
    try {
      const combined = allMsgs.join(' /// ');
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(combined)}`;
      const gRes = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const gData = await gRes.json();
      if (gData && gData[0]) {
        const translatedAll = gData[0].map((item) => item[0]).filter(Boolean).join('');
        const parts = translatedAll.split('///').map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          const last = parts[parts.length - 1];
          const prev = parts.slice(0, -1).join(' / ');
          return {
            summary: `Son mesaj: "${last}" (Önceki akış: ${prev})`,
            provider: 'Google Translate (Ücretsiz)'
          };
        } else if (parts.length === 1) {
          return { summary: parts[0], provider: 'Google Translate (Ücretsiz)' };
        }
      }
    } catch (e) {
      console.error('Fallback translation summary error:', e);
    }

    if (allMsgs.length > 1) {
      return { summary: `Gelen ${allMsgs.length} mesajlık konuşma: "${text}"`, provider: 'Yerel' };
    }
    return { summary: `Mesaj: "${text}"`, provider: 'Yerel' };
  });

  ipcMain.handle('settings:save', (_e, partial) => {
    const s = settings();
    const { lock, ...rest } = partial || {};
    Object.assign(s, rest);
    if (lock && typeof lock.autoLockMinutes === 'number') s.lock.autoLockMinutes = lock.autoLockMinutes;
    store.save();
    applyLoginItem();
    updateTray();
    if (mainWindow) {
      const c = themeColors();
      try { mainWindow.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor }); } catch (_) { /* yoksay */ }
      mainWindow.setBackgroundColor(c.bg);
    }
    if (popupWindow) popupWindow.webContents.send('popup:theme', s.theme);
    return true;
  });

  ipcMain.handle('lock:set', (_e, pin) => {
    const s = settings();
    if (!pin) {
      s.lock = { ...s.lock, enabled: false, hash: null, salt: null };
    } else {
      const salt = crypto.randomBytes(16).toString('hex');
      s.lock = { ...s.lock, enabled: true, salt, hash: hashPin(pin, salt) };
    }
    store.saveNow();
    updateTray();
    return s.lock.enabled;
  });

  ipcMain.handle('lock:verify', (_e, pin) => {
    const { lock } = settings();
    if (!lock || !lock.enabled || !lock.hash) return true;
    const a = Buffer.from(hashPin(pin, lock.salt), 'hex');
    const b = Buffer.from(lock.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });

  ipcMain.handle('dnd:active', () => isDndActive());

  ipcMain.handle('session:clear', async (_e, partition) => {
    if (typeof partition !== 'string' || !partition.startsWith('persist:vuno-')) return false;
    const ses = session.fromPartition(partition);
    await ses.clearStorageData();
    await ses.clearCache();
    return true;
  });

  // Renderer'dan gelen yeni mesaj bildirimi
  ipcMain.on('notify', (_e, n) => {
    const s = settings();
    if (!s.notifications || isDndActive()) return;
    const focusedOnIt = mainWindow && mainWindow.isVisible() && mainWindow.isFocused() && n.isActiveAccount;
    if (focusedOnIt) return;

    let payload = s.showPreview ? n : { ...n, body: 'Yeni mesaj', icon: null };
    if (n.locked) payload = { ...n, title: n.serviceName, body: 'Yeni mesaj (Vuno kilitli)', icon: null, noReply: true };
    if (s.popup) {
      pushPopup(payload);
    } else if (Notification.isSupported()) {
      const toast = new Notification({
        title: `${n.title} • ${n.accountName}`,
        body: payload.body,
        icon: ICON_PATH,
        silent: true
      });
      toast.on('click', () => {
        showMainWindow();
        sendToMain('vuno:open-notification', { accountId: n.accountId, notifId: n.notifId });
      });
      toast.show();
    }
    if (s.sound) sendToMain('vuno:play-sound');
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  });

  ipcMain.on('badge', (_e, count, dataUrl) => {
    totalUnread = count;
    updateTray();
    if (!mainWindow) return;
    if (count > 0 && dataUrl) {
      mainWindow.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} okunmamış`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  });

  ipcMain.on('app:quit', () => { isQuitting = true; app.quit(); });
  ipcMain.on('app:show', () => showMainWindow());

  // Pop-up olayları
  ipcMain.on('popup:resize', (_e, h) => resizePopup(h));
  ipcMain.on('popup:reply', (_e, data) => sendToMain('vuno:reply', data));
  ipcMain.on('popup:open', (_e, data) => {
    showMainWindow();
    sendToMain('vuno:open-notification', data);
  });
  ipcMain.on('popup:focus', () => { if (popupWindow) popupWindow.focus(); });
}

/* ----------------------------- Yaşam döngüsü ----------------------------- */

app.whenReady().then(() => {
  store = new Store();
  setupWebContentsHandling();
  setupIpc();
  createMainWindow();
  createTray();
  applyLoginItem();
  startIdleWatcher();

  powerMonitor.on('lock-screen', () => {
    if (settings().lock && settings().lock.enabled) sendToMain('vuno:lock');
  });

  // Zamanlanmış Rahatsız Etme modunun tepsiye yansıması için periyodik güncelleme
  setInterval(updateTray, 60000);

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
    pushPopup({
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
    fs.mkdirSync(outDir, { recursive: true });
    const img = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'main.png'), img.toPNG());
    if (popupWindow) {
      const p = await popupWindow.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'popup.png'), p.toPNG());
    }
    console.log('SMOKE_OK');
    isQuitting = true;
    app.quit();
  }, Number(process.env.VUNO_SMOKE_WAIT || 5000));
}

app.on('before-quit', () => {
  isQuitting = true;
  if (store) store.saveNow();
});

app.on('window-all-closed', () => {
  // Tepside çalışmaya devam et
});
