// Vuno Connect - Pencere yönetimi (ana pencere, bildirim pop-up'ı)
const { BrowserWindow, screen } = require('electron');
const path = require('path');

module.exports = function createWindowsModule(ctx) {
  const { app } = require('electron');

  function sendToMain(channel, payload) {
    const mw = ctx.mainWindow;
    if (mw && !mw.isDestroyed()) mw.webContents.send(channel, payload);
  }

  function showMainWindow() {
    const mw = ctx.mainWindow;
    if (!mw) return;
    if (mw.isMinimized()) mw.restore();
    mw.show();
    mw.focus();
  }

  /* ----------------------------- Ana pencere ----------------------------- */

  function createMainWindow() {
    const w = ctx.store.get('window');
    const colors = ctx.themeColors();
    const startHidden = process.argv.includes('--hidden') || ctx.settings().startMinimized;

    const mw = new BrowserWindow({
      width: w.width,
      height: w.height,
      x: w.x,
      y: w.y,
      minWidth: 900,
      minHeight: 600,
      show: true,
      title: 'Vuno Connect',
      icon: ctx.paths.WINDOW_ICON || ctx.paths.ICON_PATH,
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
    ctx.mainWindow = mw;
    if (process.platform === 'win32' && ctx.paths.WINDOW_ICON) {
      try { mw.setIcon(ctx.paths.WINDOW_ICON); } catch (_) {}
    }

    mw.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    mw.once('ready-to-show', () => {
      if (w.maximized) mw.maximize();
      if (!startHidden) {
        mw.show();
        mw.focus();
      }
    });

    // Windows'ta bazen ready-to-show geç tetiklenebilir veya arka planda kalabilir
    if (!startHidden) {
      setTimeout(() => {
        if (mw && !mw.isDestroyed()) {
          mw.show();
          mw.focus();
        }
      }, 500);
    }

    const saveBounds = () => {
      if (!mw || mw.isDestroyed()) return;
      const maximized = mw.isMaximized();
      const b = maximized ? ctx.store.get('window') : mw.getBounds();
      ctx.store.set('window', { ...b, maximized });
    };
    mw.on('resize', saveBounds);
    mw.on('move', saveBounds);

    mw.on('close', (e) => {
      if (!ctx.isQuitting && ctx.settings().closeToTray) {
        e.preventDefault();
        mw.hide();
      }
    });

    mw.on('focus', () => sendToMain('vuno:window-focus', true));
    mw.on('blur', () => sendToMain('vuno:window-focus', false));
  }

  /* ----------------------------- Bildirim pop-up ----------------------------- */

  let popupQueue = [];

  function createPopupWindow() {
    const pw = new BrowserWindow({
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
    pw.setAlwaysOnTop(true, 'screen-saver');
    pw.loadFile(path.join(__dirname, '..', 'popup', 'popup.html'));
    pw.webContents.once('did-finish-load', () => {
      pw.webContents.send('popup:theme', ctx.settings().theme);
      for (const n of popupQueue) pw.webContents.send('popup:add', n);
      popupQueue = [];
    });
    pw.on('closed', () => { ctx.popupWindow = null; });
    ctx.popupWindow = pw;
  }

  function pushPopup(n) {
    if (!ctx.popupWindow) createPopupWindow();
    if (ctx.popupWindow.webContents.isLoading()) {
      popupQueue.push(n);
    } else {
      ctx.popupWindow.webContents.send('popup:add', n);
    }
  }

  function resizePopup(height) {
    if (!ctx.popupWindow) return;
    if (height <= 0) {
      ctx.popupWindow.hide();
      return;
    }
    const { workArea } = screen.getPrimaryDisplay();
    const width = 400;
    const h = Math.min(Math.ceil(height), workArea.height - 20);
    ctx.popupWindow.setBounds({
      x: workArea.x + workArea.width - width - 8,
      y: workArea.y + workArea.height - h - 8,
      width,
      height: h
    });
    if (!ctx.popupWindow.isVisible()) ctx.popupWindow.showInactive();
  }

  return { sendToMain, showMainWindow, createMainWindow, createPopupWindow, pushPopup, resizePopup };
};
