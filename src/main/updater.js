// Vuno Connect — hafif oto-güncelleme modülü (Vuno Çeviri updater.py ile aynı akış)
//
// Akış:
//   1) R2 (pub-...r2.dev) üzerindeki sabit "version.json" manifesti çekilir.
//   2) Yerel sürüm (package.json -> app.getVersion()) ile karşılaştırılır.
//   3) Yeni sürüm varsa kurulum (.exe) indirilir ve SHA-256 doğrulanır.
//   4) Kurulum sessiz modda (/S) başlatılır; uygulama kendini kapatır.
// Yayın tarafı: release/publish.ps1 (electron-builder + wrangler R2 upload)
const { app, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// R2 public bucket üzerindeki SABİT manifest adresi (uygulama hep buna bakar)
const MANIFEST_URL = 'https://pub-2579a8d7f18148d39d5d10db5046ddfe.r2.dev/vuno-connect/version.json';
// Yedek: sitedeki kopya (302 ile aynı dosyaya gider)
const MANIFEST_FALLBACK_URL = 'https://vunera.info/dl/vuno-connect/version.json';

const USER_AGENT = 'VunoConnect-Updater';
const AUTO_CHECK_DELAY_MS = 20000;   // açılıştan sonra ilk kontrol
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 saat

module.exports = function createUpdaterModule(ctx) {
  let latestManifest = null;
  let installing = false;

  function sendStatus(payload) {
    ctx.sendToMain('vuno:update-status', payload);
  }

  function versionTuple(version) {
    const parts = String(version || '').trim().replace(/^v/, '').split('.').map((chunk) => {
      const m = String(chunk).match(/^\d+/);
      return m ? parseInt(m[0], 10) : 0;
    });
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
  }

  function isNewer(remote, local) {
    const a = versionTuple(remote);
    const b = versionTuple(local);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }

  function fetchJson(url, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache' },
        timeout
      }, (res) => {
        // R2 pub URL doğrudan döner; yedek adres 302 verebilir
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJson(res.headers.location, timeout).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Zaman aşımı')); });
      req.on('error', reject);
    });
  }

  async function fetchManifest() {
    let lastErr = null;
    for (const url of [MANIFEST_URL, MANIFEST_FALLBACK_URL]) {
      try {
        const data = await fetchJson(url);
        if (data && data.version) return data;
      } catch (err) { lastErr = err; } // yedek adrese geç
    }
    throw lastErr || new Error('Güncelleme manifesti okunamadı');
  }

  async function checkForUpdate() {
    const manifest = await fetchManifest();
    latestManifest = manifest;
    const local = app.getVersion();
    return {
      local,
      remote: String(manifest.version),
      available: isNewer(manifest.version, local),
      notes: manifest.notes || '',
      mandatory: !!manifest.mandatory,
      size: manifest.size || 0
    };
  }

  function sha256(file) {
    return new Promise((resolve, reject) => {
      const hasher = crypto.createHash('sha256');
      const stream = fs.createReadStream(file);
      stream.on('data', (c) => hasher.update(c));
      stream.on('end', () => resolve(hasher.digest('hex')));
      stream.on('error', reject);
    });
  }

  function downloadFile(url, dest, progressCb) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 30000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadFile(res.headers.location, dest, progressCb).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`İndirme başarısız: HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => {
          done += c.length;
          out.write(c);
          if (progressCb && total) progressCb(done, total);
        });
        res.on('end', () => out.end(() => resolve(dest)));
        res.on('error', reject);
        out.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(new Error('İndirme zaman aşımı')); });
      req.on('error', reject);
    });
  }

  // İndir -> doğrula -> sessiz kur. Hata durumunda durumu renderer'a bildirir.
  async function downloadAndInstall() {
    if (installing) return false;
    installing = true;
    let tempFile = null;
    try {
      const manifest = latestManifest || (await (async () => {
        const r = await checkForUpdate();
        return r.available ? latestManifest : null;
      })());
      if (!manifest || !manifest.url) throw new Error('Güncelleme bilgisi bulunamadı');

      const filename = path.basename(String(manifest.url).split('?')[0]) || 'Vuno-Connect-Setup.exe';
      tempFile = path.join(os.tmpdir(), filename);
      sendStatus({ type: 'downloading', percent: 0 });
      await downloadFile(manifest.url, tempFile, (done, total) => {
        sendStatus({ type: 'downloading', percent: Math.round((done / total) * 100), received: done, total });
      });

      sendStatus({ type: 'verifying' });
      const expected = String(manifest.sha256 || '').trim().toLowerCase();
      if (expected) {
        const actual = (await sha256(tempFile)).toLowerCase();
        if (actual !== expected) throw new Error('İndirilen dosya bozuk (SHA-256 doğrulaması başarısız)');
      }

      sendStatus({ type: 'installing' });
      // NSIS sessiz kurulum; kurulum sırasında uygulama kendini kapatır
      spawn(tempFile, ['/S'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => { ctx.isQuitting = true; app.quit(); }, 1200);
      return true;
    } catch (err) {
      if (tempFile) { try { fs.unlinkSync(tempFile); } catch (_) {} }
      console.error('[vuno updater]', err.message);
      sendStatus({ type: 'error', message: err.message });
      return false;
    } finally {
      installing = false;
    }
  }

  function setupIpc() {
    ipcMain.handle('update:check', async () => {
      try { return await checkForUpdate(); }
      catch (err) { return { local: app.getVersion(), available: false, error: err.message }; }
    });
    ipcMain.handle('update:install', () => downloadAndInstall());
    ipcMain.handle('update:get-local-version', () => app.getVersion());
  }

  // Paketlenmiş kurulumda açılıştan kısa süre sonra ve 6 saatte bir kontrol et
  function startAutoCheck() {
    if (!app.isPackaged) return; // geliştirme modunda (electron .) kontrol yok
    const run = async () => {
      try {
        const result = await checkForUpdate();
        if (result.available) {
          sendStatus({ type: 'available', version: result.remote, notes: result.notes, size: result.size });
          const s = ctx.settings();
          // Zorunlu güncelleme veya "otomatik kur" açıksa kullanıcıya sormadan devam
          if (result.mandatory || s.autoUpdate) await downloadAndInstall();
        }
      } catch (_) { /* sessiz geç: bağlantı yoksa kullanıcıyı rahatsız etme */ }
    };
    setTimeout(run, AUTO_CHECK_DELAY_MS);
    setInterval(run, AUTO_CHECK_INTERVAL_MS);
  }

  return { setupIpc, startAutoCheck, checkForUpdate };
};
