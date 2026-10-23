// Vuno Connect - Webview güvenliği & oturum yapılandırması
// NOT: Bu sürümde CDP (debugger) tabanlı maske KULLANILMIYOR — Electron 44'te
// webview üzerinde debugger.attach ana süreci sessizce öldürebiliyor.
// Maskeleme webview-preload.js üzerinden webFrame.executeJavaScript ile yapılıyor.
const { app, shell, session } = require('electron');
const {
  buildChromeUserAgent,
  chromelessUserAgent,
  isGoogleAccountsUrl,
  secChUaHeaders
} = require('./userAgent');

// Chromium sürümüyle eşleşen UA (userAgent.js sabit dışa aktarmaz, burada üretilir)
const CHROME_UA = buildChromeUserAgent();

const EXTERNAL_ALLOW = /accounts\.google\.com|login\.live\.com|login\.microsoftonline\.com|appleid\.apple\.com|account\.proton\.me/i;

module.exports = function createSecurityModule(ctx) {
  function applyWebviewUserAgent(contents, url) {
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview') return;
    // Google oturum sayfalarında sürümsüz ("chromeless") UA — Ferdium yaklaşımı
    const ua = isGoogleAccountsUrl(url) ? chromelessUserAgent(CHROME_UA) : CHROME_UA;
    try {
      // DİKKAT: setUserAgent yalnızca did-navigate (gezinti bittikten) sonra çağrılmalı.
      // Devam eden bir gezinti sırasında çağrılırsa Electron gezintiyi iptal eder ve
      // Electron 44'te ana süreç sessizce çökebiliyor.
      if (contents.getUserAgent() !== ua) contents.setUserAgent(ua);
    } catch (_) {}
  }

  function setupWebContentsHandling() {
    // Renderer'ın ekleyeceği her <webview> için güvenli ayarları zorla
    app.on('web-contents-created', (_e, contents) => {
      contents.on('will-attach-webview', (_ev, webPreferences, params) => {
        delete webPreferences.preloadURL;
        webPreferences.preload = ctx.paths.WEBVIEW_PRELOAD;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = false;
        webPreferences.spellcheck = true;
        if (!/^https:\/\//.test(params.src || '')) {
          _ev.preventDefault();
        }
      });

      if (contents.getType() === 'webview') {
        // UA sadece did-navigate (gezinti tamamlandıktan) sonra değiştirilir.
        // did-start-loading / will-navigate sırasında setUserAgent gezintiyi iptal eder
        // ve Electron 44'te ana süreci çökertebilir.
        contents.on('did-navigate', (_ev, url) => applyWebviewUserAgent(contents, url));

        // Harici bağlantıları varsayılan tarayıcıda aç (Giriş/OAuth hariç)
        contents.setWindowOpenHandler(({ url }) => {
          // Microsoft, Google vb. giriş veya servis içi yönlendirmeleri webview içinde aç
          if (/microsoft|live\.com|office\.com|outlook|accounts\.google|appleid\.apple|account\.proton\.me|login|auth|signin|signup|oauth/i.test(url)) {
            setImmediate(() => {
              if (!contents.isDestroyed()) contents.loadURL(url);
            });
            return { action: 'deny' };
          }
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
    ses.setUserAgent(CHROME_UA);
    const allowed = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    // Giden isteklerde UA / Client Hints — Google oturumunda chromeless UA (Ferdium yaklaşımı)
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const googleAuth = isGoogleAccountsUrl(details.url || '');

      if (googleAuth) {
        details.requestHeaders['User-Agent'] = chromelessUserAgent(CHROME_UA);
        delete details.requestHeaders['sec-ch-ua'];
        delete details.requestHeaders['Sec-CH-UA'];
        delete details.requestHeaders['sec-ch-ua-mobile'];
        delete details.requestHeaders['Sec-CH-UA-Mobile'];
        delete details.requestHeaders['sec-ch-ua-platform'];
        delete details.requestHeaders['Sec-CH-UA-Platform'];
        delete details.requestHeaders['sec-ch-ua-full-version-list'];
        delete details.requestHeaders['Sec-CH-UA-Full-Version-List'];
      } else {
        details.requestHeaders['User-Agent'] = CHROME_UA;
        delete details.requestHeaders['sec-ch-ua'];
        delete details.requestHeaders['sec-ch-ua-mobile'];
        delete details.requestHeaders['sec-ch-ua-platform'];
        delete details.requestHeaders['sec-ch-ua-full-version-list'];
        Object.assign(details.requestHeaders, secChUaHeaders());
      }

      delete details.requestHeaders['X-Electron-Version'];
      delete details.requestHeaders['x-electron-version'];

      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
  }

  return { setupWebContentsHandling, applyWebviewUserAgent };
};
