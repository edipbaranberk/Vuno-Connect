// Vuno Connect - IPC kanalları (store, ayarlar, kilit, bildirim, pop-up köprüsü)
const {
  ipcMain, session, Notification, nativeImage, safeStorage, app
} = require('electron');
const crypto = require('crypto');
const { chromelessUserAgent } = require('./userAgent');
const { resolveNotificationIcon } = require('./notificationIcons');

module.exports = function createIpcModule(ctx) {
  function setupIpc() {
    ipcMain.handle('app:userAgent', () => ctx.CHROME_UA);
    ipcMain.handle('app:chromelessUserAgent', () => chromelessUserAgent(ctx.CHROME_UA));

    ipcMain.handle('store:get', () => {
      const data = JSON.parse(JSON.stringify(ctx.store.get()));
      // Kilit hash'ini renderer'a gönderme
      if (data.settings.lock) {
        data.settings.lock.hash = null;
        data.settings.lock.salt = null;
      }
      // Şifrelenmiş Gemini anahtarını renderer için çöz (diskte düz metin tutulmaz)
      try {
        if (!data.settings.aiKey && data.settings.aiKeyEnc && safeStorage.isEncryptionAvailable()) {
          data.settings.aiKey = safeStorage.decryptString(Buffer.from(data.settings.aiKeyEnc, 'base64'));
        }
      } catch (_) {}
      delete data.settings.aiKeyEnc;
      return data;
    });

    // Gelen kutusunu diske yaz (uygulama kapansa da mesajlar kaybolmasın)
    ipcMain.handle('inbox:save', (_e, items) => {
      if (!Array.isArray(items)) return false;
      const clean = items.slice(0, 30).map((m) => ({
        key: String(m.key || '').slice(0, 40),
        accountId: m.accountId,
        notifId: m.notifId,
        title: String(m.title || '').slice(0, 120),
        body: String(m.body || '').slice(0, 500),
        icon: (typeof m.icon === 'string' && m.icon.length < 100000) ? m.icon : '',
        time: Number(m.time) || Date.now(),
        read: !!m.read,
        replies: [],
        history: (Array.isArray(m.history) ? m.history : []).slice(-3).map((h) => String(h).slice(0, 500))
      }));
      ctx.store.set('inbox', clean);
      return true;
    });

    ipcMain.handle('accounts:save', (_e, accounts, activeAccountId) => {
      ctx.store.set('accounts', accounts);
      ctx.store.set('activeAccountId', activeAccountId);
      return true;
    });

    ipcMain.handle('templates:save', (_e, templates) => {
      ctx.store.set('templates', templates);
      return true;
    });

    ipcMain.handle('workspace:save', (_e, ws) => {
      ctx.store.set('activeWorkspace', ws);
      return true;
    });

    ipcMain.handle('settings:save', (_e, partial) => {
      const s = ctx.settings();
      const { lock, ...rest } = partial || {};
      // Gemini anahtarını safeStorage ile şifreleyip diskte düz metin olarak TUTMA
      if (typeof rest.aiKey === 'string') {
        const plainKey = rest.aiKey.trim();
        if (plainKey && safeStorage.isEncryptionAvailable()) {
          try {
            s.aiKeyEnc = safeStorage.encryptString(plainKey).toString('base64');
            rest.aiKey = ''; // düz metin diske yazılmaz
          } catch (_) { s.aiKeyEnc = null; }
        } else if (!plainKey) {
          s.aiKeyEnc = null; // anahtar temizlendiyse şifreyi de sil
        }
      }
      Object.assign(s, rest);
      if (lock && typeof lock.autoLockMinutes === 'number') s.lock.autoLockMinutes = lock.autoLockMinutes;
      ctx.store.save();
      ctx.applyLoginItem();
      ctx.updateTray();
      if (ctx.mainWindow) {
        const c = ctx.themeColors();
        try { ctx.mainWindow.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor }); } catch (_) { /* yoksay */ }
        ctx.mainWindow.setBackgroundColor(c.bg);
      }
      if (ctx.popupWindow) ctx.popupWindow.webContents.send('popup:theme', s.theme);
      // Renderer'ın AI özellikleri çalışmaya devam etsin: anahtarı çözüp gönder
      ctx.sendToMain('vuno:settings-changed', { ...s, aiKey: ctx.getAiKey() });
      return true;
    });

    ipcMain.handle('lock:set', (_e, pin) => {
      const s = ctx.settings();
      if (!pin) {
        s.lock = { ...s.lock, enabled: false, hash: null, salt: null };
      } else {
        const salt = crypto.randomBytes(16).toString('hex');
        s.lock = { ...s.lock, enabled: true, salt, hash: ctx.hashPin(pin, salt) };
      }
      ctx.store.saveNow();
      ctx.updateTray();
      return s.lock.enabled;
    });

    ipcMain.handle('lock:verify', (_e, pin) => {
      const { lock } = ctx.settings();
      if (!lock || !lock.enabled || !lock.hash) return true;
      const a = Buffer.from(ctx.hashPin(pin, lock.salt), 'hex');
      const b = Buffer.from(lock.hash, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });

    ipcMain.handle('dnd:active', () => ctx.isDndActive());

    ipcMain.handle('session:clear', async (_e, partition) => {
      if (typeof partition !== 'string' || !partition.startsWith('persist:vuno-')) return false;
      const ses = session.fromPartition(partition);
      await ses.clearStorageData();
      await ses.clearCache();
      return true;
    });

    // Google tarafından şüpheli olarak damgalanmış eski auth ve domain çerezlerini tamamen sıfırla
    ipcMain.handle('session:clear-google-cookies', async (_e, partition) => {
      if (typeof partition !== 'string' || !partition.startsWith('persist:vuno-')) return false;
      const ses = session.fromPartition(partition);
      await ses.clearStorageData();
      await ses.clearCache();
      return true;
    });

    // Renderer'dan gelen yeni mesaj bildirimi
    ipcMain.on('notify', async (_e, n) => {
      const s = ctx.settings();
      if (!s.notifications || ctx.isDndActive()) return;
      const mw = ctx.mainWindow;
      const focusedOnIt = mw && mw.isVisible() && mw.isFocused() && n.isActiveAccount;
      if (focusedOnIt) return;

      let payload = s.showPreview ? n : { ...n, body: 'Yeni mesaj', icon: null };
      if (n.locked) payload = { ...n, title: n.serviceName, body: 'Yeni mesaj (Vuno kilitli)', icon: null, noReply: true };

      const notifIcon = await resolveNotificationIcon(payload, ctx.paths.ICON_PATH);

      if (Notification.isSupported()) {
        const toast = new Notification({
          title: `${n.title} • ${n.accountName}`,
          body: payload.body,
          icon: notifIcon,
          silent: true
        });
        toast.on('click', () => {
          ctx.showMainWindow();
          ctx.sendToMain('vuno:open-notification', { accountId: n.accountId, notifId: n.notifId });
        });
        toast.show();
      }
      if (s.sound) ctx.sendToMain('vuno:play-sound');
      if (mw && !mw.isFocused()) mw.flashFrame(true);
    });

    ipcMain.on('badge', (_e, count, dataUrl) => {
      ctx.totalUnread = count;
      ctx.updateTray();
      const mw = ctx.mainWindow;
      if (!mw) return;
      if (count > 0 && dataUrl) {
        mw.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} okunmamış`);
      } else {
        mw.setOverlayIcon(null, '');
      }
    });

    ipcMain.on('app:quit', () => { ctx.isQuitting = true; app.quit(); });
    ipcMain.on('app:show', () => ctx.showMainWindow());

    // Pop-up olayları
    ipcMain.on('popup:resize', (_e, h) => ctx.resizePopup(h));
    ipcMain.on('popup:reply', (_e, data) => ctx.sendToMain('vuno:reply', data));
    ipcMain.on('popup:open', (_e, data) => {
      ctx.showMainWindow();
      ctx.sendToMain('vuno:open-notification', data);
    });
    ipcMain.on('popup:focus', () => { if (ctx.popupWindow) ctx.popupWindow.focus(); });
  }

  return { setupIpc };
};
