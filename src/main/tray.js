// Vuno Connect - Sistem tepsisi (Tray)
const { Tray, Menu, nativeImage } = require('electron');

module.exports = function createTrayModule(ctx) {
  const { app } = require('electron');
  let tray = null;

  function buildTrayMenu() {
    const s = ctx.settings();
    return Menu.buildFromTemplate([
      { label: 'Vuno Connect\'ı Aç', click: ctx.showMainWindow },
      { type: 'separator' },
      {
        label: 'Rahatsız Etme',
        type: 'checkbox',
        checked: !!s.dnd,
        click: (item) => {
          s.dnd = item.checked;
          ctx.store.save();
          ctx.sendToMain('vuno:settings-changed', s);
          updateTray();
        }
      },
      {
        label: 'Uygulamayı Kilitle',
        enabled: !!(s.lock && s.lock.enabled),
        click: () => ctx.sendToMain('vuno:lock')
      },
      { type: 'separator' },
      {
        label: 'Çıkış',
        click: () => { ctx.isQuitting = true; app.quit(); }
      }
    ]);
  }

  function updateTray() {
    if (!tray) return;
    const dnd = ctx.isDndActive() ? ' • Rahatsız Etme açık' : '';
    tray.setToolTip(ctx.totalUnread > 0
      ? `Vuno Connect — ${ctx.totalUnread} okunmamış mesaj${dnd}`
      : `Vuno Connect${dnd}`);
    tray.setContextMenu(buildTrayMenu());
  }

  function createTray() {
    const img = nativeImage.createFromPath(ctx.paths.TRAY_PATH).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.on('click', () => {
      const mw = ctx.mainWindow;
      if (mw.isVisible() && mw.isFocused()) mw.hide();
      else ctx.showMainWindow();
    });
    updateTray();
  }

  return { createTray, updateTray };
};
