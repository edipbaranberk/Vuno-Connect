// Vuno Connect - Bildirim İkonları & Avatar Yöneticisi
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SERVICES_DIR = path.join(__dirname, '..', '..', 'assets', 'services');

let iconsDir = null;

function getIconsDir() {
  if (!iconsDir) {
    iconsDir = path.join(app.getPath('userData'), 'notification_icons');
    if (!fs.existsSync(iconsDir)) {
      try { fs.mkdirSync(iconsDir, { recursive: true }); } catch (_) {}
    }
  }
  return iconsDir;
}

function getServiceIconPath(serviceId) {
  if (!serviceId) return null;
  const filePath = path.join(SERVICES_DIR, `${String(serviceId).toLowerCase()}.png`);
  if (fs.existsSync(filePath)) return filePath;
  return null;
}

async function resolveNotificationIcon(payload, defaultIconPath) {
  const dir = getIconsDir();
  const rawIcon = payload.icon;

  // 1. Profil fotoğrafı varsa (DOM'dan yakalanan avatar)
  if (rawIcon && typeof rawIcon === 'string') {
    if (rawIcon.startsWith('data:image/')) {
      try {
        const matches = rawIcon.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
          const buf = Buffer.from(matches[2], 'base64');
          const ext = matches[1].includes('jpeg') ? 'jpg' : 'png';
          const tmpFile = path.join(dir, `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
          fs.writeFileSync(tmpFile, buf);
          // 45 saniye sonra geçici avatar dosyasını temizle
          setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch (_) {} }, 45000);
          return tmpFile;
        }
      } catch (e) {
        console.error('Avatar kaydedilemedi:', e);
      }
    } else if (rawIcon.startsWith('http://') || rawIcon.startsWith('https://')) {
      try {
        const res = await fetch(rawIcon);
        if (res.ok) {
          const arrBuffer = await res.arrayBuffer();
          const buf = Buffer.from(arrBuffer);
          const tmpFile = path.join(dir, `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
          fs.writeFileSync(tmpFile, buf);
          setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch (_) {} }, 45000);
          return tmpFile;
        }
      } catch (_) {}
    } else if (fs.existsSync(rawIcon)) {
      return rawIcon;
    }
  }

  // 2. Profil fotoğrafı yoksa: İlgili servisin (WhatsApp, Gmail, Instagram, Telegram vb.) ikonunu kullan!
  const svcFile = getServiceIconPath(payload.serviceId);
  if (svcFile && fs.existsSync(svcFile)) {
    return svcFile;
  }

  // 3. Hiçbiri yoksa varsayılan Vuno ikonu
  return defaultIconPath;
}

module.exports = {
  getServiceIconPath,
  resolveNotificationIcon
};
