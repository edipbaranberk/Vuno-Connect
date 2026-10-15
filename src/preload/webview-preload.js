// Her servis (<webview>) içine yüklenen preload.
const { contextBridge, ipcRenderer, webFrame } = require('electron');



// Google / Microsoft / Proton oturum açma sayfaları kontrolü
const isAuthHost = typeof location !== 'undefined' && /accounts\.google\.com|login\.live\.com|login\.microsoftonline\.com|account\.proton\.me/i.test(location.hostname || '');

// Tarayıcı parmak izi maskesi — ana dünyada, tüm sayfalarda (CDP kullanılmıyor!)
const MASK_WORLD = `(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    delete Object.getPrototypeOf(navigator).webdriver;
  } catch (_) {}
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
      };
    }
  } catch (_) {}
})();`;

try {
  webFrame.executeJavaScript(MASK_WORLD).catch(() => {});
} catch (_) {}

if (!isAuthHost) {
  try {
    contextBridge.exposeInMainWorld('__vunoBridge', {
      notify: (data) => ipcRenderer.sendToHost('vuno:notification', data),
      log: (msg) => ipcRenderer.sendToHost('vuno:log', String(msg))
    });
  } catch (_) {}
}

// Sayfanın kendi dünyasında (main world) çalışacak kod
const MAIN_WORLD = `(() => {
  if (window.__vunoPatched) return;
  window.__vunoPatched = true;

  const registry = new Map();
  let seq = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getImgSrcOrData(img) {
    if (!img) return '';
    try {
      const c = document.createElement('canvas');
      const w = img.naturalWidth || img.width || 64;
      const h = img.naturalHeight || img.height || 64;
      if (w > 0 && h > 0) {
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = c.toDataURL('image/jpeg', 0.85);
        if (data && data.length > 200) return data;
      }
    } catch (_) {}
    return img.src || '';
  }

  async function toDataUrl(src) {
    if (!src || typeof src !== 'string') return '';
    if (src.startsWith('data:')) return src;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(src, { signal: ctrl.signal, credentials: 'include' });
      clearTimeout(t);
      const blob = await res.blob();
      if (blob.size > 1024 * 1024) return src;
      const dataUri = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(src);
        fr.readAsDataURL(blob);
      });
      return dataUri || src;
    } catch (_) {
      return src; // Asla boş string dönme, URL'i koru
    }
  }

  function findDomAvatar(senderName) {
    try {
      if (!senderName) return '';
      const cleanName = senderName.trim().toLowerCase();

      // 1. WhatsApp Web / Instagram / Telegram sohbet listesindeki kişi satırını bul
      const titleEls = Array.from(document.querySelectorAll('#pane-side span[title], #pane-side div[title], [role="gridcell"] span[title], .chat-list span, header span[title]'));
      for (const el of titleEls) {
        const t = (el.getAttribute('title') || el.innerText || '').trim().toLowerCase();
        if (t && (t === cleanName || t.includes(cleanName) || cleanName.includes(t))) {
          const row = el.closest('[role="row"], [role="listitem"], [role="gridcell"], div[tabindex="-1"], header') || el.parentElement?.parentElement?.parentElement;
          if (row) {
            const img = row.querySelector('img[src]');
            if (img && img.src && !img.src.includes('data:image/svg') && !img.src.includes('default-user')) {
              const res = getImgSrcOrData(img);
              if (res) return res;
            }
          }
        }
      }

      // 2. WhatsApp sol paneldeki ilk sohbet satırı (en yeni gelen mesaj)
      const firstRow = document.querySelector('#pane-side [role="listitem"], #pane-side [role="row"], #pane-side [role="gridcell"]');
      if (firstRow && firstRow.innerText && firstRow.innerText.toLowerCase().includes(cleanName)) {
        const img = firstRow.querySelector('img[src]');
        if (img && img.src && !img.src.includes('default-user')) {
          const res = getImgSrcOrData(img);
          if (res) return res;
        }
      }

      // 3. Header içindeki açık sohbet fotoğrafı
      const hTitle = document.querySelector('header span[title], header div[title], #main header span');
      if (hTitle && (hTitle.innerText || '').toLowerCase().includes(cleanName)) {
        const hImg = document.querySelector('header img[src*="pps.whatsapp.net"], header img[src*="blob:"], header img[src]');
        if (hImg && hImg.src && !hImg.src.includes('default-user')) {
          const res = getImgSrcOrData(hImg);
          if (res) return res;
        }
      }

      // 4. Genel sayfa içi profil resimleri (pps.whatsapp.net veya alt metni eşleşen)
      const allImgs = Array.from(document.querySelectorAll('img[src]'));
      for (const img of allImgs) {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const src = img.src || '';
        if (alt.includes(cleanName) && !src.includes('default-user')) {
          const res = getImgSrcOrData(img);
          if (res) return res;
        }
      }
      for (const img of allImgs) {
        const src = img.src || '';
        if ((src.includes('pps.whatsapp.net') || src.includes('cdninstagram')) && (img.width > 25 || img.height > 25)) {
          const res = getImgSrcOrData(img);
          if (res) return res;
        }
      }
    } catch (_) {}
    return '';
  }

  class VunoNotification extends EventTarget {
    constructor(title, options) {
      super();
      options = options || {};
      this.title = String(title || '');
      this.body = String(options.body || '');

      // Servislerin generic simgelerini (favicon, varsayılan logo) filtrele
      const optIcon = (typeof options.icon === 'string') ? options.icon : '';
      const isGenericIcon = !optIcon ||
        optIcon.includes('favicon') ||
        optIcon.includes('apple-touch') ||
        optIcon.includes('default-user') ||
        optIcon.includes('web.whatsapp.com/img') ||
        optIcon.startsWith('data:image/svg');

      // Önce DOM'dan gerçek profil fotoğrafını ara, yoksa ve optIcon generic değilse optIcon'u al
      const domAvatar = findDomAvatar(this.title);
      this.icon = domAvatar || (!isGenericIcon ? optIcon : '');
      this.tag = options.tag || '';
      this.data = options.data;
      this.silent = !!options.silent;
      this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;
      const id = 'n' + (++seq) + '_' + Date.now();
      Object.defineProperty(this, '__vunoId', { value: id });
      registry.set(id, this);
      if (registry.size > 300) registry.delete(registry.keys().next().value);

      const resolvedIcon = this.icon || findDomAvatar(this.title);
      toDataUrl(typeof resolvedIcon === 'string' ? resolvedIcon : '').then((icon) => {
        window.__vunoBridge.notify({ id, title: this.title, body: this.body, icon, tag: String(this.tag) });
      });
      setTimeout(() => this._fire('show'), 0);
    }
    _fire(type) {
      const ev = new Event(type, { cancelable: true });
      this.dispatchEvent(ev);
      const h = this['on' + type];
      if (typeof h === 'function') { try { h.call(this, ev); } catch (e) { console.error(e); } }
    }
    close() { this._fire('close'); }
    static get permission() { return 'granted'; }
    static requestPermission(cb) {
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    }
  }
  VunoNotification.maxActions = 2;

  Object.defineProperty(window, 'Notification', { value: VunoNotification, writable: true, configurable: true });

  // Service Worker üzerinden gösterilen bildirimler
  try {
    if (window.ServiceWorkerRegistration) {
      ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
        new VunoNotification(title, options);
        return Promise.resolve();
      };
    }
  } catch (_) {}

  // İzin sorgularını "granted" olarak yanıtla
  try {
    const origQuery = navigator.permissions && navigator.permissions.query.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (p) => (p && p.name === 'notifications')
        ? Promise.resolve({ state: 'granted', onchange: null })
        : origQuery(p);
    }
  } catch (_) {}

  /* ---------- Hızlı cevap ---------- */

  const COMPOSER_SELECTORS = [
    // WhatsApp
    '#main footer div[contenteditable="true"]',
    'footer div[contenteditable="true"][role="textbox"]',
    // Telegram Web A / K
    '#editable-message-text',
    '.input-message-input[contenteditable="true"]',
    // Messenger / Facebook / Instagram (Lexical editör)
    'div[contenteditable="true"][role="textbox"][aria-label]',
    'div[contenteditable="true"][role="textbox"]',
    // Genel
    'textarea[placeholder]',
    'div[contenteditable="true"]'
  ];

  const SEND_SELECTORS = [
    'button[aria-label="Send"]', 'button[aria-label="Gönder"]',
    'div[aria-label="Send"][role="button"]', 'div[aria-label="Gönder"][role="button"]',
    'div[aria-label="Press enter to send"]', 'div[aria-label="Göndermek için Enter\\'a bas"]',
    'span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]',
    'button.send', 'button.btn-send', '.main-button.send'
  ];

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findComposer() {
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === 'TEXTAREA') && visible(active)) return active;
    for (const sel of COMPOSER_SELECTORS) {
      const list = Array.from(document.querySelectorAll(sel)).filter(visible);
      if (list.length) return list[list.length - 1];
    }
    return null;
  }

  function composerText(el) {
    if (!el) return '';
    return (el.tagName === 'TEXTAREA' ? el.value : el.innerText || '').trim();
  }

  window.__vunoOpen = (id) => {
    const n = registry.get(id);
    if (!n) return false;
    try { window.focus(); } catch (_) {}
    n._fire('click');
    return true;
  };

  // 1. adım: sohbeti aç, metni yaz. (Enter tuşu host tarafından güvenilir olay olarak gönderilir.)
  window.__vunoPrepareReply = async (id, text) => {
    const opened = window.__vunoOpen(id);
    let box = null;
    for (let i = 0; i < 20; i++) {
      await sleep(opened && i === 0 ? 700 : 150);
      box = findComposer();
      if (box) break;
    }
    if (!box) return { ok: false, reason: 'composer-not-found' };
    box.focus();
    if (box.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
    }
    window.__vunoLastComposer = box;
    await sleep(120);
    return { ok: composerText(box).length > 0 };
  };

  // 3. adım: Enter işe yaramadıysa gönder butonuna tıkla
  window.__vunoFinishReply = async () => {
    await sleep(350);
    const box = window.__vunoLastComposer;
    if (!box || !composerText(box)) return { ok: true, via: 'enter' };
    for (const sel of SEND_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && visible(btn)) {
        (btn.closest('button,[role="button"]') || btn).click();
        await sleep(250);
        return { ok: !composerText(box), via: 'button' };
      }
    }
    return { ok: false, reason: 'not-sent' };
  };
})();`;

function inject() {
  if (!isAuthHost) {
    webFrame.executeJavaScript(MAIN_WORLD).catch(() => {});
  }
}

inject();
window.addEventListener('DOMContentLoaded', inject);
