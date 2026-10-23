// Basit, bağımlılıksız JSON ayar deposu (userData/config.json)
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  accounts: [],
  activeAccountId: null,
  activeWorkspace: 'all', // 'all', 'personal', 'work'
  inbox: [],             // kalıcı gelen kutusu (son 30 mesaj)
  templates: [
    { id: 't1', title: 'Tamamdır', text: 'Tamamdır, anlaştık! 👍' },
    { id: 't2', title: 'Toplantıdayım', text: 'Şu an toplantıdayım, bitince dönüş yapacağım. ⏳' },
    { id: 't3', title: 'İnceliyorum', text: 'Mesajınızı aldım, inceliyorum. En kısa sürede yazacağım.' },
    { id: 't4', title: 'Görüşmek üzere', text: 'Teşekkürler, iyi çalışmalar dilerim! ✨' }
  ],
  settings: {
    theme: 'dark',
    accentColor: 'classic',
    notifications: true,
    sound: true,
    showPreview: true,
    dnd: false,
    dndSchedule: { enabled: false, from: '23:00', to: '08:00' },
    startWithWindows: false,
    startMinimized: false,
    closeToTray: true,
    lock: { enabled: false, hash: null, salt: null, autoLockMinutes: 0 },
    autoUpdate: false
  },
  window: { width: 1360, height: 860, x: undefined, y: undefined, maximized: false }
};

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return extra === undefined ? base : extra;
  }
  const out = { ...base };
  for (const key of Object.keys(extra || {})) {
    out[key] = key in base ? deepMerge(base[key], extra[key]) : extra[key];
  }
  return out;
}

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = DEFAULTS;
    try {
      if (fs.existsSync(this.file)) {
        this.data = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      }
    } catch (err) {
      console.error('Ayarlar okunamadı, varsayılanlar kullanılıyor:', err);
    }
        // Geriye dönük uyumluluk: Eğer Vuno Connect'te hesap yoksa ama eski Vuno Messenger'da varsa otomatik aktar
    if (!this.data.accounts || this.data.accounts.length === 0) {
      try {
        const legacyFile = path.join(app.getPath('appData'), 'Vuno Messenger', 'config.json');
        if (fs.existsSync(legacyFile)) {
          const legacyData = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
          if (legacyData.accounts && legacyData.accounts.length > 0) {
            this.data = deepMerge(this.data, legacyData);
            this.saveNow();

            const legacyPartitions = path.join(app.getPath('appData'), 'Vuno Messenger', 'Partitions');
            const targetPartitions = path.join(app.getPath('userData'), 'Partitions');
            if (fs.existsSync(legacyPartitions) && !fs.existsSync(targetPartitions)) {
              fs.cpSync(legacyPartitions, targetPartitions, { recursive: true });
            }
          }
        }
      } catch (e) { }
    }
    this._timer = null;
  }

  get(key) {
    return key ? this.data[key] : this.data;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 200);
  }

  saveNow() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Ayarlar kaydedilemedi:', err);
    }
  }
}

module.exports = Store;

