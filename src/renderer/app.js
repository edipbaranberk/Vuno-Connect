/* ===================== Vuno Connect — Arayüz mantığı ===================== */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const state = {
    accounts: [],          // { id, service, name, muted, workspace: 'personal'|'work', lastActive }
    activeId: 'inbox',     // 'inbox' veya hesap id'si
    activeWorkspace: 'all',// 'all', 'personal', 'work'
    templates: [],         // [{ id, title, text }]
    settings: {},
    unread: {},            // accountId -> sayı
    inbox: [],             // gelen mesajlar
    filter: 'all',
    unreadOnly: false,     // 'sadece okunmamış' filtresi
    locked: false,
    windowFocused: true,
    snoozed: new Map(),    // item.key -> setTimeout timer
    summaries: new Map(),  // item.key -> summary string
    translations: new Map()// item.key -> translated string
  };

  const webviews = new Map(); // accountId -> { wrap, wv, ready, hibernating: boolean }

  /* ----------------------------- Yardımcılar ----------------------------- */

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const accountById = (id) => state.accounts.find((a) => a.id === id);

  function svcIconHtml(svc, size = '') {
    const inner = svc.icon
      ? `<img src="https://cdn.simpleicons.org/${svc.icon}/ffffff" alt="" data-letter="${escapeHtml((svc.letter || svc.name[0]))}" />`
      : escapeHtml(svc.letter || svc.name[0]);
    return `<div class="svc-icon ${size}" style="background:${svc.gradient}">${inner}</div>`;
  }

  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.letter && img.parentElement) {
      img.parentElement.textContent = img.dataset.letter;
    }
  }, true);

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 45) return 'şimdi';
    if (diff < 3600) return `${Math.floor(diff / 60)} dk`;
    if (diff < 86400) return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  }

  function persistAccounts() {
    window.vuno.saveAccounts(state.accounts, state.activeId);
  }

  async function saveSettings(partial) {
    Object.assign(state.settings, partial);
    await window.vuno.saveSettings(partial);
    applySettingsToUi();
  }

  /* ----------------------------- Ses ----------------------------- */

  let audioCtx = null;
  function playChime() {
    try {
      audioCtx = audioCtx || new AudioContext();
      const now = audioCtx.currentTime;
      [[880, 0], [1318.5, 0.11]].forEach(([freq, delay]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.45);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.5);
      });
    } catch (_) {}
  }

  /* ----------------------------- Tema & Ayarlar ----------------------------- */

  function resolvedTheme() {
    const t = state.settings.theme || 'dark';
    if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t;
  }

  async function applySettingsToUi() {
    document.documentElement.dataset.theme = resolvedTheme();
    const dnd = await window.vuno.isDndActive();
    $('#dnd-pill').hidden = !dnd;
    $('#btn-dnd').classList.toggle('on', dnd);
    $('#btn-lock').hidden = !(state.settings.lock && state.settings.lock.enabled);
    for (const [id, entry] of webviews) {
      const acc = accountById(id);
      try { entry.wv.setAudioMuted(!!(dnd || (acc && acc.muted))); } catch (_) {}
    }
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettingsToUi);

  /* ----------------------------- Çalışma Alanları (Workspaces) ----------------------------- */

  function visibleAccounts() {
    if (state.activeWorkspace === 'all') return state.accounts;
    return state.accounts.filter((a) => (a.workspace || 'personal') === state.activeWorkspace);
  }

  function setWorkspace(ws) {
    state.activeWorkspace = ws;
    $$('.ws-btn').forEach((b) => b.classList.toggle('active', b.dataset.ws === ws));
    window.vuno.saveWorkspace(ws);
    renderSidebar();
    renderInbox();
    toast(`Çalışma Alanı: ${ws === 'all' ? 'Tümü' : ws === 'personal' ? 'Kişisel' : 'İş'}`);
  }

  $$('.ws-btn').forEach((b) => b.addEventListener('click', () => setWorkspace(b.dataset.ws)));

  /* ----------------------------- Kenar Çubuğu & Uçan Tooltip ----------------------------- */

  let tooltipEl = null;
  function getTooltipEl() {
    if (!tooltipEl) {
      tooltipEl = $('#floating-tooltip');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'floating-tooltip';
        tooltipEl.className = 'floating-tooltip';
        document.body.appendChild(tooltipEl);
      }
    }
    return tooltipEl;
  }

  function bindTooltip(el, getHtml) {
    if (!el) return;
    el.addEventListener('mouseenter', () => {
      const tt = getTooltipEl();
      const rect = el.getBoundingClientRect();
      const content = typeof getHtml === 'function' ? getHtml() : getHtml;
      if (!content) return;
      tt.innerHTML = content;
      tt.style.top = `${rect.top + rect.height / 2}px`;
      tt.style.left = `${rect.right + 12}px`;
      tt.classList.add('visible');
    });
    el.addEventListener('mouseleave', () => {
      if (tooltipEl) tooltipEl.classList.remove('visible');
    });
    el.addEventListener('click', () => {
      if (tooltipEl) tooltipEl.classList.remove('visible');
    });
  }

  function renderSidebar() {
    const list = $('#account-list');
    list.innerHTML = '';
    const accs = visibleAccounts();
    for (const acc of accs) {
      const svc = window.getService(acc.service);
      if (!svc) continue;
      const btn = document.createElement('button');
      btn.className = 'side-btn account-btn';
      btn.dataset.id = acc.id;
      const isHib = !!(state.settings.ramSaver && webviews.get(acc.id)?.hibernating);
      btn.classList.toggle('hibernating', isHib);
      btn.dataset.tip = `${svc.name} • ${acc.name}${isHib ? ' (Uykuda 💤)' : ''}`;
      btn.id = `acc-${acc.id}`;
      btn.classList.toggle('active', state.activeId === acc.id);
      btn.classList.toggle('muted-acc', !!acc.muted);
      const count = state.unread[acc.id] || 0;
      btn.innerHTML = svcIconHtml(svc) +
        (isHib ? '<span class="hibernating-badge">💤</span>' : '') +
        (count && !acc.muted ? `<span class="badge">${count > 99 ? '99+' : count}</span>` : '') +
        (acc.muted ? '<span class="muted-dot"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg></span>' : '') +
        (webviews.get(acc.id)?.loading ? '<span class="loading-ring"></span>' : '');
      btn.addEventListener('click', () => activate(acc.id));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(acc, e.clientX, e.clientY); });

      // Üstüne gelindiğinde hesabı net gösteren uçan etiket (Tooltip)
      bindTooltip(btn, () => `
        <div class="tip-header">
          <span class="tip-badge" style="background:${svc.gradient}">${escapeHtml(svc.name)}</span>
          ${acc.muted ? '<span class="tip-muted">🔕 Sessizde</span>' : ''}
          ${count ? `<span class="tip-count">${count} yeni</span>` : ''}
        </div>
        <div class="tip-acc-name">${escapeHtml(acc.name)}</div>
      `);

      list.appendChild(btn);
    }
    $('#btn-inbox').classList.toggle('active', state.activeId === 'inbox');
    updateBadges();
  }

  function updateBadges() {
    const inboxUnread = state.inbox.filter((m) => !m.read).length;
    const ib = $('#inbox-badge');
    ib.hidden = inboxUnread === 0;
    ib.textContent = inboxUnread > 99 ? '99+' : inboxUnread;

    let total = 0;
    for (const acc of state.accounts) if (!acc.muted) total += state.unread[acc.id] || 0;
    if (total === 0) total = inboxUnread;
    window.vuno.setBadge(total, total ? badgeDataUrl(total) : null);
    document.title = total ? `(${total}) Vuno Connect` : 'Vuno Connect';
  }

  function badgeDataUrl(count) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff3b5c';
    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${count > 9 ? 16 : 20}px Segoe UI`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count > 99 ? '99+' : String(count), 16, 17);
    return c.toDataURL();
  }

  /* ----------------------------- RAM Tasarrufu & Sekme Uyku Modu (Hibernation) ----------------------------- */

  function checkTabHibernation() {
    if (!state.settings.ramSaver) return;
    const maxInactive = (state.settings.ramSaverMinutes || 30) * 60 * 1000;
    const now = Date.now();
    for (const acc of state.accounts) {
      if (acc.id === state.activeId) continue;
      const entry = webviews.get(acc.id);
      if (!entry || entry.hibernating) continue;
      const lastActive = acc.lastActive || entry.createdTime || now;
      if (now - lastActive > maxInactive) {
        hibernateAccount(acc.id);
      }
    }
  }

  function hibernateAccount(id) {
    const entry = webviews.get(id);
    if (!entry || entry.hibernating) return;
    entry.hibernating = true;
    try {
      // Not: webview'i DOM'dan silmiyoruz! DOM'dan silinirse WhatsApp/Instagram WebSocket bağlantısı kopar
      // ve arka planda yeni mesaj/bildirim alınamaz. Sadece ses ve arka plan tasarrufu uyguluyoruz.
      if (entry.wv && typeof entry.wv.setAudioMuted === 'function') {
        entry.wv.setAudioMuted(true);
      }
    } catch (_) {}
    renderSidebar();
  }

  let CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  function chromelessUa(full) {
    return full.replace(/Chrome\/[\d.]+/, 'Chrome');
  }

  function userAgentForService(acc, url) {
    const target = url || window.getService(acc.service)?.url || '';
    if (/accounts\.google\.com/i.test(target)) return chromelessUa(CHROME_USER_AGENT);
    return CHROME_USER_AGENT;
  }

  function wakeAccount(acc) {
    const entry = webviews.get(acc.id);
    if (!entry) return;
    entry.hibernating = false;
    try {
      if (entry.wv && typeof entry.wv.setAudioMuted === 'function') {
        entry.wv.setAudioMuted(false);
      }
      // Eğer webview herhangi bir nedenle DOM'da yoksa yeniden bağla
      if (!entry.wv || !entry.wrap.contains(entry.wv)) {
        const svc = window.getService(acc.service);
        entry.wv = document.createElement('webview');
        entry.wv.setAttribute('partition', `persist:vuno-${acc.id}`);
        entry.wv.setAttribute('src', svc.url);
        entry.wv.setAttribute('useragent', userAgentForService(acc));
        entry.wv.setAttribute('webpreferences', 'spellcheck=yes,backgroundThrottling=no');
        entry.wrap.appendChild(entry.wv);
        entry.ready = false;
        entry.loading = true;
        bindWebviewEvents(acc, entry);
      }
    } catch (_) {}
    renderSidebar();
  }

  setInterval(checkTabHibernation, 60000);

  /* ----------------------------- Görünüm Değiştirme ----------------------------- */

  function activate(id) {
    state.activeId = id;
    $('#view-inbox').classList.toggle('active', id === 'inbox');
    for (const [accId, entry] of webviews) entry.wrap.classList.toggle('active', accId === id);
    if (id !== 'inbox') {
      const acc = accountById(id);
      if (acc) {
        acc.lastActive = Date.now();
        if (!webviews.has(id)) {
          createWebview(acc);
        } else if (webviews.get(id)?.hibernating) {
          wakeAccount(acc);
        }
        // Eğer Gmail daha önce reddedilmiş/takılmış sayfadaysa çerezleri temizleyip taze giriş ekranına yönlendir
        const entry = webviews.get(id);
        if (entry?.wv && acc.service === 'gmail') {
          try {
            const curUrl = entry.wv.getURL();
            if (curUrl && (curUrl.includes('/about/') || curUrl.includes('google.com/intl/') || curUrl.includes('rejected') || curUrl.includes('denied'))) {
              window.vuno.clearGoogleCookies(`persist:vuno-${acc.id}`).catch(() => {});
              entry.wv.loadURL('https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/u/0/');
            }
          } catch (_) {}
        }
      }
      webviews.get(id)?.wrap.classList.add('active');
      const svc = acc && window.getService(acc.service);
      $('#titlebar-title').textContent = svc ? `${svc.name} — ${acc.name}` : '';
      state.inbox.forEach((m) => { if (m.accountId === id) m.read = true; });
      setTimeout(() => { try { webviews.get(id)?.wv.focus(); } catch (_) {} }, 50);
    } else {
      $('#titlebar-title').textContent = '';
      renderInbox();
    }
    renderSidebar();
    persistAccounts();
  }

  /* ----------------------------- Webview Yönetimi ----------------------------- */

  function bindWebviewEvents(acc, entry) {
    const wv = entry.wv;
    wv.addEventListener('dom-ready', () => {
      entry.ready = true;
      applySettingsToUi();
    });
    wv.addEventListener('did-start-loading', () => { entry.loading = true; renderSidebar(); });
    wv.addEventListener('did-stop-loading', () => {
      entry.loading = false;
      renderSidebar();
      hideError(entry);
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3 || !e.isMainFrame) return;
      showError(entry, acc, e.errorDescription);
    });

    wv.addEventListener('page-title-updated', (e) => {
      const m = /\((\d+)\)/.exec(e.title) || /^(\d+)\s/.exec(e.title);
      const count = m ? parseInt(m[1], 10) : 0;
      const prev = state.unread[acc.id] || 0;

      // Yedek bildirim: servis sayfası Notification API'sini çağırmadıysa (ör. Facebook/Messenger
      // hesap ayarında web bildirimleri kapalıysa) sekme başlığındaki okunmamış sayı artışından
      // sentetik bildirim üret — böylece birleşik gelen kutusu ve Windows bildirimi kaçmaz.
      // NOT: Başlıkta gönderen adı yazamaz (sekme başlığı sadece sayı verir); servis adı kullanılır,
      // hesap adı açıklamaya konur — kendi adınızı gönderen gibi görmeyesiniz.
      if (count > prev && count > 0 && acc.service !== 'gmail') {
        const recentRealNotif = entry.lastNotif && (Date.now() - entry.lastNotif.at < 15000);
        if (!recentRealNotif) {
          handleIncoming(acc, {
            id: 'title-fallback-' + Date.now(),
            title: '',
            body: `${acc.name} hesabında ${count} okunmamış mesaj`,
            icon: ''
          });
        }
      }

      if (state.unread[acc.id] !== count) {
        state.unread[acc.id] = count;
        renderSidebar();
      }
    });

    wv.addEventListener('ipc-message', (e) => {
      if (e.channel === 'vuno:notification') handleIncoming(acc, e.args[0]);
    });
  }

  function createWebview(acc) {
    const svc = window.getService(acc.service);
    if (!svc || !svc.url) return;

    const wrap = document.createElement('div');
    wrap.className = 'webview-wrap';
    wrap.dataset.id = acc.id;

    const wv = document.createElement('webview');
    wv.setAttribute('partition', `persist:vuno-${acc.id}`);
    wv.setAttribute('src', svc.url);
    wv.setAttribute('useragent', userAgentForService(acc, svc.url));
    // backgroundThrottling=no: arka plandaki sekmeler kısalmasın; Messenger/WhatsApp gibi
    // servisler bildirimleri zamanlayıcılarla planlıyor, kısalma mesaj/bildirim kaçırıyor.
    wv.setAttribute('webpreferences', 'spellcheck=yes,backgroundThrottling=no');
    wrap.appendChild(wv);
    $('#webviews').appendChild(wrap);

    const entry = { wrap, wv, ready: false, loading: true, lastNotif: null, hibernating: false, createdTime: Date.now() };
    webviews.set(acc.id, entry);
    bindWebviewEvents(acc, entry);
  }

  function showError(entry, acc, desc) {
    hideError(entry);
    const el = document.createElement('div');
    el.className = 'webview-error';
    el.innerHTML = `<div class="box">
      <h2>Bağlanılamadı</h2>
      <p class="muted">${escapeHtml(desc || 'İnternet bağlantını kontrol et.')}</p>
      <button class="btn primary">Tekrar dene</button></div>`;
    el.querySelector('button').addEventListener('click', () => { hideError(entry); entry.wv.reload(); });
    entry.wrap.appendChild(el);
    entry.errorEl = el;
  }
  function hideError(entry) {
    if (entry.errorEl) { entry.errorEl.remove(); entry.errorEl = null; }
  }

  function destroyWebview(id) {
    const entry = webviews.get(id);
    if (!entry) return;
    entry.wrap.remove();
    webviews.delete(id);
  }

  /* ----------------------------- Gelen Mesajlar & AI Akıllı Cevap Motoru ----------------------------- */

  function generateSmartReplies(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('nerede') || lower.includes('geldin mi') || lower.includes('konum')) {
      return ['Yoldayım, 10 dakikaya oradayım 🚗', 'Henüz çıkamadım, biraz gecikeceğim.', 'Geldim, kapıdayım!'];
    }
    if (lower.includes('müsait') || lower.includes('uygun musun') || lower.includes('konuşabilir miyiz')) {
      return ['Evet, müsaitim konuşabiliriz 👍', 'Şu an toplantıdayım, birazdan arayayım.', 'Biraz yoğunum, mesajla iletebilirsin.'];
    }
    if (lower.includes('fiyat') || lower.includes('ne kadar') || lower.includes('ücret') || lower.includes('hesap')) {
      return ['Hemen detaylı fiyat tablosunu iletiyorum.', 'Teklifimizi hazırlayıp gönderiyorum.', 'Fiyat bilgisini kontrol edip yazacağım.'];
    }
    if (lower.includes('merhaba') || lower.includes('selam') || lower.includes('günaydın') || lower.includes('iyi günler')) {
      return ['Selamlar, nasılsın? 👋', 'Merhaba! Nasıl yardımcı olabilirim?', 'Günaydın, iyi çalışmalar! ✨'];
    }
    if (lower.includes('teşekkür') || lower.includes('sağol') || lower.includes('eyvallah')) {
      return ['Rica ederim, her zaman! 😊', 'Ne demek, kolay gelsin!', 'Görüşmek üzere, iyi günler!'];
    }
    if (lower.includes('tamam') || lower.includes('olur') || lower.includes('anlaştık')) {
      return ['Harika, anlaştık! 👍', 'Süper, haberleşiriz.', 'Tamamdır, iyi günler.'];
    }
    return ['Tamamdır, teşekkürler! 👍', 'İnceliyorum, en kısa sürede döneceğim.', 'Müsait olduğumda yazacağım.'];
  }

  async function translateText(text, targetLang = 'tr') {
    if (!text) return '';
    try {
      const res = await window.vuno.translate(text, targetLang);
      if (res && res !== 'Çeviri yapılamadı (Bağlantı hatası)') return res;
    } catch (_) {}
    return 'Çeviri yapılamadı (Bağlantı hatası)';
  }

  function summarizeText(text) {
    if (!text) return 'Boş mesaj';
    if (text.length <= 80) return `Özet: ${text}`;
    const sentences = text.split(/[.!?\n]+/).filter(Boolean);
    if (sentences.length > 1) {
      return `📌 Özet: ${sentences[0].trim()} (${sentences.length} cümlelik mesaj)`;
    }
    return `📌 Özet: ${text.slice(0, 75).trim()}...`;
  }

  function handleIncoming(acc, n) {
    if (!n || (!n.title && !n.body)) return;
    const entry = webviews.get(acc.id);

    const sig = `${n.tag}|${n.title}|${n.body}`;
    if (entry && entry.lastNotif && entry.lastNotif.sig === sig && Date.now() - entry.lastNotif.at < 2500) return;
    if (entry) entry.lastNotif = { sig, at: Date.now() };

    const svc = window.getService(acc.service);
    const isActive = state.activeId === acc.id;
    const item = {
      key: uid(),
      accountId: acc.id,
      notifId: n.id,
      title: n.title || svc.name,
      body: n.body || '',
      icon: n.icon || '',
      time: Date.now(),
      read: isActive && state.windowFocused,
      replies: []
    };

    const prevIdx = state.inbox.findIndex((m) => m.accountId === acc.id && m.title === item.title);
    if (prevIdx !== -1) {
      const prev = state.inbox[prevIdx];
      item.history = [...(prev.history || []), prev.body].slice(-3);
      item.replies = [];
      if (!item.icon && prev.icon) item.icon = prev.icon;
      state.inbox.splice(prevIdx, 1);
    }
    state.inbox.unshift(item);
    if (state.inbox.length > 200) state.inbox.length = 200;
    persistInbox();

    if (state.activeId === 'inbox') renderInbox();
    updateBadges();

    if (acc.muted) return;
    window.vuno.notify({
      key: item.key,
      accountId: acc.id,
      notifId: n.id,
      accountName: acc.name,
      serviceName: svc.name,
      serviceId: svc.id,
      serviceIcon: svc.icon,
      serviceLetter: svc.letter || svc.name[0],
      gradient: svc.gradient,
      title: item.title,
      body: item.body,
      icon: item.icon,
      isActiveAccount: isActive,
      locked: state.locked
    });
  }

  async function sendReply(accountId, notifId, text) {
    let entry = webviews.get(accountId);
    const acc = accountById(accountId);
    if (!entry && acc) {
      createWebview(acc);
      entry = webviews.get(accountId);
    }
    if (!entry) throw new Error('Hesap bulunamadı');

    // Eğer sekme uyutulmuşsa hemen uyandır
    if (entry.hibernating) {
      wakeAccount(acc);
    }

    // Webview yükleniyorsa veya henüz hazır değilse bekle (en fazla 12 sn)
    if (!entry.ready || entry.loading || !entry.wv) {
      toast(`${acc ? acc.name : 'Sekme'} hazırlanıyor, mesaj gönderiliyor... ⏳`);
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const timer = setTimeout(finish, 12000);
        if (entry.wv) {
          entry.wv.addEventListener('dom-ready', finish, { once: true });
          entry.wv.addEventListener('did-stop-loading', finish, { once: true });
        } else {
          finish();
        }
      });
    }

    const wv = entry.wv;
    if (!wv) throw new Error('Servis penceresi hazır değil');

    // WhatsApp / Instagram / Telegram içine mesajı yazmak için dene (hazır olana kadar döngü)
    let prep = null;
    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      try {
        prep = await wv.executeJavaScript(
          `window.__vunoPrepareReply ? window.__vunoPrepareReply(${JSON.stringify(notifId)}, ${JSON.stringify(text)}) : { ok: false, reason: 'no-hook' }`,
          true
        );
        if (prep && prep.ok) break;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 450));
    }

    if (!prep || !prep.ok) {
      throw new Error('Sohbet otomatik açılamadı — sekmeden doğrudan cevaplayabilirsin');
    }

    wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });

    const fin = await wv.executeJavaScript('window.__vunoFinishReply ? window.__vunoFinishReply() : { ok: true }', true);
    if (!fin || !fin.ok) throw new Error('Mesaj gönderilemedi');
    return true;
  }

  async function replyToItem(item, text) {
    try {
      await sendReply(item.accountId, item.notifId, text);
      // Başarılı olduğunda önceki hata mesajını temizle ve başarılıyı ekle
      item.replies = item.replies.filter((r) => r.ok);
      item.replies.push({ text, ok: true });
      item.read = true;
      toast('Mesaj iletildi! 🚀');
      return true;
    } catch (err) {
      item.replies.push({ text, ok: false });
      toast(err.message, 'error');
      return false;
    } finally {
      if (state.activeId === 'inbox') renderInbox();
      updateBadges();
    }
  }

  function openItem(accountId, notifId) {
    activate(accountId);
    const entry = webviews.get(accountId);
    if (entry && entry.ready && notifId) {
      entry.wv.executeJavaScript(`window.__vunoOpen && window.__vunoOpen(${JSON.stringify(notifId)})`, true).catch(() => {});
    }
  }

  /* ----------------------------- Gelen kutusu kalıcılığı ----------------------------- */
  // Son 30 mesaj diske yazılır; uygulama kapansa bile birleşik kutu korunur.
  function persistInbox() {
    try { window.vuno.saveInbox(state.inbox.slice(0, 30)); } catch (_) {}
  }
  setInterval(persistInbox, 15000);
  window.addEventListener('beforeunload', persistInbox);

  /* ----------------------------- Erteleme (Snooze) ----------------------------- */

  let snoozeTargetItem = null;
  function openSnoozeModal(item) {
    snoozeTargetItem = item;
    $('#snooze-target-desc').textContent = `"${item.title}" kişisinden gelen mesaj ne zaman tekrar hatırlatılsın?`;
    $('#snooze-modal').hidden = false;
  }

  $$('[data-snooze-min]').forEach((b) => b.addEventListener('click', () => {
    if (!snoozeTargetItem) return;
    const mins = parseInt(b.dataset.snoozeMin, 10);
    const item = snoozeTargetItem;
    // Gelen kutusundan geçici olarak gizle
    const idx = state.inbox.indexOf(item);
    if (idx !== -1) state.inbox.splice(idx, 1);
    renderInbox();
    updateBadges();
    $('#snooze-modal').hidden = true;
    toast(`Mesaj ${mins >= 60 ? (mins / 60) + ' saat' : mins + ' dakika'} sonrasına ertelendi 🕒`);

    // Süre dolunca tekrar en başa ekle ve bildirim patlat
    // (Kullanıcı bu arada kartı Kapat'a basarsa timer iptal edilir — state.snoozed)
    const snoozeTimer = setTimeout(() => {
      state.snoozed.delete(item.key);
      if (item.__dismissed) return; // kapatılmış, tekrar gösterme
      item.time = Date.now();
      item.read = false;
      state.inbox.unshift(item);
      renderInbox();
      updateBadges();
      const acc = accountById(item.accountId);
      const svc = acc && window.getService(acc.service);
      if (acc && svc) {
        window.vuno.notify({
          key: item.key,
          accountId: acc.id,
          notifId: item.notifId,
          accountName: acc.name,
          serviceName: svc.name,
          serviceIcon: svc.icon,
          serviceLetter: svc.letter || svc.name[0],
          gradient: svc.gradient,
          title: `[Hatırlatma] ${item.title}`,
          body: item.body,
          icon: item.icon
        });
      }
    }, mins * 60 * 1000);
    state.snoozed.set(item.key, snoozeTimer);
  }));

  /* ----------------------------- Birleşik Gelen Kutusu ----------------------------- */

  function renderFilterChips() {
    const chips = $('#filter-chips');
    const counts = {};
    const accs = visibleAccounts();
    const accIds = new Set(accs.map((a) => a.id));

    state.inbox.forEach((m) => {
      if (!m.read && accIds.has(m.accountId)) counts[m.accountId] = (counts[m.accountId] || 0) + 1;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    let html = `<button class="chip no-icon ${state.filter === 'all' ? 'active' : ''}" data-filter="all">Tümü ${total ? `<span class="count">${total}</span>` : ''}</button>`;
    for (const acc of accs) {
      const svc = window.getService(acc.service);
      if (!svc || !svc.url) continue;
      html += `<button class="chip ${state.filter === acc.id ? 'active' : ''}" data-filter="${acc.id}">
        ${svcIconHtml(svc, 'xs')} ${escapeHtml(acc.name)} ${counts[acc.id] ? `<span class="count">${counts[acc.id]}</span>` : ''}</button>`;
    }
    chips.innerHTML = html;
    chips.hidden = accs.length === 0;
    $$('.chip', chips).forEach((c) => c.addEventListener('click', () => { state.filter = c.dataset.filter; renderInbox(); }));
  }

  function renderInbox() {
    renderFilterChips();
    const list = $('#inbox-list');
    const drafts = {};
    $$('.reply-input', list).forEach((i) => { if (i.value) drafts[i.dataset.key] = i.value; });
    const focusedKey = document.activeElement?.classList.contains('reply-input') ? document.activeElement.dataset.key : null;

    const accIds = new Set(visibleAccounts().map((a) => a.id));
    const items = state.inbox.filter((m) => accIds.has(m.accountId)
      && (state.filter === 'all' || m.accountId === state.filter)
      && (!state.unreadOnly || !m.read));
    list.innerHTML = '';

    const empty = $('#empty-state');
    const noAccounts = state.accounts.length === 0;
    empty.hidden = items.length > 0;
    $('#empty-title').textContent = noAccounts ? 'Vuno Connect\'a hoş geldin 👋' : (state.unreadOnly ? 'Okunmamış mesaj yok 🎉' : 'Henüz mesaj yok');
    $('#empty-text').textContent = noAccounts
      ? 'Başlamak için bir servis ekle. Giriş yaptıktan sonra gelen tüm mesajlar burada toplanır ve tek yerden cevaplayabilirsin.'
      : (state.unreadOnly
        ? 'Yeni mesaj geldiğinde burada belirecek. Tüm mesajları görmek için "Sadece okunmamış" filtresini kaldır.'
        : 'Yeni mesajlar geldiğinde burada görünecek. Servislerin arka planda açık kalması yeterli — buradan veya bildirim kartından cevap verebilirsin.');
    renderWelcomeGrid(noAccounts);
    $('#inbox-subtitle').textContent = state.inbox.length
      ? `${state.inbox.filter((m) => !m.read && accIds.has(m.accountId)).length} okunmamış • ${visibleAccounts().length} hesap bağlı`
      : 'Tüm servislerden gelen mesajlar tek yerde.';

    for (const item of items) {
      const acc = accountById(item.accountId);
      if (!acc) continue;
      const svc = window.getService(acc.service);
      const card = document.createElement('article');
      card.className = `msg-card ${item.read ? '' : 'unread'}`;
      const avatar = item.icon
        ? `<img class="avatar" src="${escapeHtml(item.icon)}" alt="" />`
        : `<div class="avatar">${escapeHtml((item.title || '?').trim()[0] || '?')}</div>`;
      const history = (item.history || []).map((h) => `<div class="msg-body" style="opacity:.6">${escapeHtml(h)}</div>`).join('');
      const rawTranslation = state.translations.get(item.key);
      const trProvider = (typeof rawTranslation === 'object' && rawTranslation?.provider) ? rawTranslation.provider : '';
      const trText = (typeof rawTranslation === 'object' && rawTranslation?.text) ? rawTranslation.text : (rawTranslation || '');

      const rawSummary = state.summaries.get(item.key);
      const sumProvider = (typeof rawSummary === 'object' && rawSummary?.provider) ? rawSummary.provider : '';
      const sumText = (typeof rawSummary === 'object' && rawSummary?.text) ? rawSummary.text : (rawSummary || '');
      const smartReplies = generateSmartReplies(item.body);
      const historyItems = item.history || [];

      const hasGemini = !!(state.settings.aiKey && state.settings.aiKey.trim());

      card.innerHTML = `
        <div class="msg-avatar" data-open title="Sohbeti Aç">${avatar}${svcIconHtml(svc, 'xs')}</div>
        <div class="msg-main">
          <div class="msg-top">
            <span class="msg-title" data-open title="Sohbeti Aç">${escapeHtml(item.title)}</span>
            <span class="msg-acc">${escapeHtml(svc.name)} • ${escapeHtml(acc.name)}</span>
            ${historyItems.length ? `<span class="history-pill" title="Önceki mesajlar">📜 ${historyItems.length + 1} mesaj</span>` : ''}
          </div>
          ${historyItems.length ? `<div class="msg-history-box">
            ${historyItems.map((h) => `<div class="history-item">↳ ${escapeHtml(h)}</div>`).join('')}
          </div>` : ''}
          <div class="msg-body">${escapeHtml(item.body)}</div>
          ${sumText ? `<div class="ai-summary-box">📝 <b>Özet:</b> ${escapeHtml(sumText)} ${sumProvider ? `<span class="provider-badge">${escapeHtml(sumProvider)}</span>` : ''}</div>` : ''}
          ${trText ? `<div class="ai-summary-box translation-box">🌐 <b>Türkçe Çeviri:</b> ${escapeHtml(trText)} ${trProvider ? `<span class="provider-badge">${escapeHtml(trProvider)}</span>` : ''}</div>` : ''}

          <!-- AI Akıllı Öneriler, Çeviri & Şablonlar -->
          <div class="ai-actions-row">
            ${hasGemini && smartReplies.length ? `<span class="ai-badge-label">✨ AI Önerileri:</span>` : ''}
            ${hasGemini ? smartReplies.map((r) => `<button class="ai-chip" data-reply-text="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('') : ''}
            ${state.templates.slice(0, 3).map((t) => `<button class="canned-chip" data-reply-text="${escapeHtml(t.text)}" title="${escapeHtml(t.text)}">${escapeHtml(t.title)}</button>`).join('')}
            <button class="canned-chip" data-act-translate title="Kendi Diline (Türkçe'ye) Çevir">🌐 Çevir</button>
            ${hasGemini ? `<button class="canned-chip" data-act-summarize title="Konuşmayı Özetle">📝 Özetle</button>` : ''}
          </div>

          ${item.replies.length ? `<div class="msg-replies">${item.replies.map((r) =>
            `<div class="msg-reply-sent ${r.ok ? '' : 'failed'}">
               <span>${escapeHtml(r.text)}${r.ok ? '' : ' — gönderilemedi'}</span>
               ${!r.ok ? `<button type="button" class="retry-reply-btn" data-retry-text="${escapeHtml(r.text)}" title="Metni kutuya tekrar yapıştır">Tekrar dene</button>` : ''}
             </div>`).join('')}</div>` : ''}
          <form class="reply-row">
            <input class="reply-input" data-key="${item.key}" id="reply-${item.key}" placeholder="${escapeHtml(item.title)} kişisine cevap yaz..." autocomplete="off" />
            <button type="button" class="reply-tr-btn" data-act-tr-reply title="Yazdığın Türkçe metni karşı tarafın diline çevir">🌐 ${item.detectedLang ? item.detectedLang.toUpperCase() : 'Çevir'}</button>
            <button class="send-btn" type="submit" aria-label="Gönder"><svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
          </form>
        </div>
        <div class="msg-side">
          <span class="msg-time" data-time="${item.time}">${timeAgo(item.time)}</span>
          <button class="mini-btn" data-open title="Doğrudan bu sohbete gir"><svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>Aç</button>
          <button class="mini-btn" data-snooze><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Ertele</button>
          ${item.read ? '' : '<button class="mini-btn" data-read><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Okundu</button>'}
          <button class="mini-btn" data-dismiss title="Kapat — aynı kişiden yeni mesaj gelirse kart yeniden görünür"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>Kapat</button>
        </div>`;

      const input = $('.reply-input', card);
      if (drafts[item.key]) input.value = drafts[item.key];

      // Başarısız olan cevabı tekrar kutucuğa al
      $$('.retry-reply-btn', card).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          input.value = btn.dataset.retryText || '';
          input.focus();
        });
      });

      // Akıllı çiplere tıklayınca kutuya yaz
      $$('[data-reply-text]', card).forEach((chip) => {
        chip.addEventListener('click', () => {
          input.value = chip.dataset.replyText;
          input.focus();
        });
      });

      // Çevir butonu
      $('[data-act-translate]', card)?.addEventListener('click', async () => {
        const trBtn = $('[data-act-translate]', card);
        trBtn.disabled = true;
        trBtn.textContent = 'Çevriliyor...';
        state.translations.delete(item.key);
        try {
          const res = await window.vuno.translate(item.body, 'tr', 'auto');
          if (res && res.detectedLang) item.detectedLang = res.detectedLang;
          state.translations.set(item.key, res);
        } catch (_) {
          state.translations.set(item.key, { text: 'Çeviri yapılamadı', provider: 'Hata' });
        }
        renderInbox();
      });

      // Giden cevabı karşı tarafın diline çevir (Tersine Çeviri)
      $('[data-act-tr-reply]', card)?.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) {
          toast('Önce kutuya Türkçe cevabını yaz ✨');
          input.focus();
          return;
        }
        const targetLang = item.detectedLang || 'pl';
        const trReplyBtn = $('[data-act-tr-reply]', card);
        trReplyBtn.disabled = true;
        const oldHtml = trReplyBtn.innerHTML;
        trReplyBtn.textContent = '⏳';
        try {
          const res = await window.vuno.translate(text, targetLang, 'tr');
          if (res && res.text) {
            input.value = res.text;
            toast(`${targetLang.toUpperCase()} diline çevrildi! Gönderebilirsin 🚀`);
          }
        } catch (e) {
          toast('Çeviri yapılamadı');
        } finally {
          trReplyBtn.disabled = false;
          trReplyBtn.innerHTML = oldHtml;
          input.focus();
        }
      });

      // Özetle butonu
      $('[data-act-summarize]', card)?.addEventListener('click', async () => {
        const sumBtn = $('[data-act-summarize]', card);
        sumBtn.disabled = true;
        sumBtn.textContent = 'Özetleniyor...';
        state.summaries.delete(item.key);
        try {
          const res = await window.vuno.summarize(item.body, item.history || []);
          state.summaries.set(item.key, { text: res.summary, provider: res.provider });
        } catch (_) {
          state.summaries.set(item.key, { text: item.body, provider: 'Yerel' });
        }
        renderInbox();
      });

      // Erteleme butonu
      $('[data-snooze]', card)?.addEventListener('click', () => openSnoozeModal(item));

      // Kapat (X) butonu — kartı listeden kaldır; ertelenmişse zamanlayıcıyı iptal et.
      // Aynı kişiden YENİ mesaj gelirse handleIncoming yeni kart oluşturur, yani tekrar görünür.
      $('[data-dismiss]', card)?.addEventListener('click', () => {
        item.__dismissed = true;
        const pendingTimer = state.snoozed.get(item.key);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          state.snoozed.delete(item.key);
        }
        const idx = state.inbox.indexOf(item);
        if (idx !== -1) state.inbox.splice(idx, 1);
        persistInbox();
        renderInbox();
        updateBadges();
      });

      $('form', card).addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const btn = $('.send-btn', card);
        btn.disabled = true;
        input.disabled = true;
        input.value = '';
        await replyToItem(item, text);
      });
      $$('[data-open]', card).forEach((el) => el.addEventListener('click', () => openItem(item.accountId, item.notifId)));
      $('[data-read]', card)?.addEventListener('click', () => { item.read = true; persistInbox(); renderInbox(); updateBadges(); });
      list.appendChild(card);
    }
    if (focusedKey) document.getElementById(`reply-${focusedKey}`)?.focus();
  }

  function renderWelcomeGrid(show) {
    const grid = $('#welcome-grid');
    grid.hidden = !show;
    if (!show) return;
    grid.innerHTML = '';
    for (const svc of window.VUNO_SERVICES.filter((s) => !s.unavailable).slice(0, 6)) {
      const card = document.createElement('button');
      card.className = 'svc-card';
      card.id = `welcome-${svc.id}`;
      card.innerHTML = `${svcIconHtml(svc, 'lg')}<b>${svc.name}</b><span>${svc.description}</span>`;
      card.addEventListener('click', () => openAddModal(svc.id));
      grid.appendChild(card);
    }
  }

  setInterval(() => $$('.msg-time').forEach((el) => { el.textContent = timeAgo(+el.dataset.time); }), 30000);

  /* ----------------------------- Evrensel Arama (Universal Search) ----------------------------- */

  function openSearchModal() {
    $('#search-modal').hidden = false;
    const input = $('#global-search-input');
    input.value = '';
    input.focus();
    renderSearchResults('');
  }

  function renderSearchResults(query) {
    const list = $('#search-results-list');
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      list.innerHTML = `<div style="text-align:center; padding:30px 10px; color:var(--text-3); font-size:13px;">
        Aramak istediğin kelimeyi veya kişi adını yazmaya başla...</div>`;
      return;
    }

    const matched = state.inbox.filter((m) =>
      (m.title && m.title.toLowerCase().includes(q)) ||
      (m.body && m.body.toLowerCase().includes(q))
    );

    if (!matched.length) {
      list.innerHTML = `<div style="text-align:center; padding:30px 10px; color:var(--text-3); font-size:13px;">
        "${escapeHtml(query)}" ile eşleşen mesaj bulunamadı.</div>`;
      return;
    }

    list.innerHTML = matched.map((m) => {
      const acc = accountById(m.accountId);
      const svc = acc && window.getService(acc.service);
      return `<div class="search-item" data-key="${m.key}">
        ${svc ? svcIconHtml(svc, 'sm') : ''}
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(m.title)} <span style="font-weight:400; font-size:12px; color:var(--text-3)">(${escapeHtml(svc?.name || '')})</span></div>
          <div class="search-item-body">${escapeHtml(m.body)}</div>
        </div>
        <span style="font-size:11px; color:var(--text-3)">${timeAgo(m.time)}</span>
      </div>`;
    }).join('');

    $$('.search-item', list).forEach((el) => {
      el.addEventListener('click', () => {
        const item = state.inbox.find((m) => m.key === el.dataset.key);
        if (item) {
          $('#search-modal').hidden = true;
          openItem(item.accountId, item.notifId);
        }
      });
    });
  }

  $('#btn-search-trigger').addEventListener('click', openSearchModal);
  $('#global-search-input').addEventListener('input', (e) => renderSearchResults(e.target.value));

  /* ----------------------------- Hazır Şablonlar (Canned Responses) ----------------------------- */

  function renderTemplatesList() {
    const list = $('#templates-list');
    if (!state.templates.length) {
      list.innerHTML = '<div style="color:var(--text-3); font-size:13px; text-align:center; padding:20px;">Henüz kaydedilmiş hazır şablon yok.</div>';
      return;
    }
    list.innerHTML = state.templates.map((t) => `
      <div class="template-item">
        <div class="grow min-w-0">
          <b>${escapeHtml(t.title)}</b>
          <div><span>${escapeHtml(t.text)}</span></div>
        </div>
        <button class="icon-btn" data-del-template="${t.id}" title="Sil">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    `).join('');

    $$('[data-del-template]', list).forEach((b) => {
      b.addEventListener('click', () => {
        state.templates = state.templates.filter((x) => x.id !== b.dataset.delTemplate);
        window.vuno.saveTemplates(state.templates);
        renderTemplatesList();
        renderInbox();
        toast('Şablon silindi');
      });
    });
  }

  $('#btn-open-templates').addEventListener('click', () => {
    renderTemplatesList();
    $('#templates-modal').hidden = false;
  });

  $('#btn-add-template').addEventListener('click', () => {
    const title = $('#new-template-title').value.trim();
    const text = $('#new-template-text').value.trim();
    if (!title || !text) return toast('Lütfen başlık ve metin girin', 'error');
    state.templates.push({ id: uid(), title, text });
    window.vuno.saveTemplates(state.templates);
    $('#new-template-title').value = '';
    $('#new-template-text').value = '';
    renderTemplatesList();
    renderInbox();
    toast('Yeni şablon eklendi ✨', 'success');
  });

  /* ----------------------------- Ses Metne Dökücü / Dikte (Speech to Text) ----------------------------- */

  let recognition = null;
  let isRecording = false;

  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'tr-TR';

    rec.onresult = (e) => {
      let finalTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
      }
      if (finalTranscript) {
        const area = $('#transcribed-text');
        area.value = (area.value ? area.value + ' ' : '') + finalTranscript.trim();
      }
    };

    rec.onerror = (e) => {
      stopRecording();
      toast(`Mikrofon hatası: ${e.error || 'Bağlantı kesildi'}`, 'error');
    };

    rec.onend = () => {
      if (isRecording) stopRecording();
    };

    return rec;
  }

  function startRecording() {
    if (!recognition) recognition = initSpeechRecognition();
    if (!recognition) return toast('Tarayıcınız ses tanımayı desteklemiyor', 'error');
    try {
      recognition.start();
      isRecording = true;
      $('#btn-toggle-mic').classList.add('recording');
      $('#mic-status').textContent = 'Dinleniyor... Konuşun 🎙️';
    } catch (_) {}
  }

  function stopRecording() {
    if (recognition && isRecording) {
      try { recognition.stop(); } catch (_) {}
    }
    isRecording = false;
    $('#btn-toggle-mic').classList.remove('recording');
    $('#mic-status').textContent = 'Kayıt durdu. Mikrofona basarak devam edebilirsin.';
  }

  $('#btn-audio-tool').addEventListener('click', () => {
    $('#audio-modal').hidden = false;
  });

  $('#btn-toggle-mic').addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });

  $('#btn-clear-audio-text').addEventListener('click', () => {
    $('#transcribed-text').value = '';
  });

  $('#btn-copy-audio-text').addEventListener('click', () => {
    const text = $('#transcribed-text').value.trim();
    if (!text) return toast('Kopyalanacak metin yok');
    navigator.clipboard.writeText(text);
    toast('Metin panoya kopyalandı! Yapıştırabilirsin 📋', 'success');
  });

  /* ----------------------------- Servis Ekleme ----------------------------- */

  let pendingService = null;
  let activeAddCat = 'all';

  function renderAddServiceGrid() {
    const grid = $('#service-grid');
    grid.innerHTML = '';
    const filtered = window.VUNO_SERVICES.filter((svc) => {
      if (activeAddCat === 'all') return true;
      return (svc.category || 'messaging') === activeAddCat;
    });

    for (const svc of filtered) {
      const card = document.createElement('button');
      card.className = `svc-card ${svc.unavailable ? 'unavailable' : ''}`;
      card.id = `add-${svc.id}`;
      const existing = state.accounts.filter((a) => a.service === svc.id).length;
      card.innerHTML = `${svcIconHtml(svc, 'lg')}<b>${svc.name}</b><span>${existing ? `${existing} hesap bağlı` : svc.description}</span>`;
      card.addEventListener('click', () => selectService(svc));
      grid.appendChild(card);
    }
  }

  function openAddModal(preselect) {
    activeAddCat = 'all';
    $$('#service-cat-tabs .cat-pill').forEach((b) => b.classList.toggle('active', b.dataset.cat === 'all'));
    renderAddServiceGrid();
    $('#add-step').hidden = true;
    $('#add-notice').hidden = true;
    $('#service-cat-tabs').hidden = false;
    $('#service-grid').hidden = false;
    $('#add-modal').hidden = false;
    if (preselect) selectService(window.getService(preselect));
  }

  function selectService(svc) {
    if (svc.unavailable) {
      const n = $('#add-notice');
      n.innerHTML = `<b>${escapeHtml(svc.name)}:</b> ${escapeHtml(svc.note)}`;
      n.hidden = false;
      return;
    }
    pendingService = svc;
    $('#service-grid').hidden = true;
    $('#service-cat-tabs').hidden = true;
    $('#add-notice').hidden = true;
    $('#add-step').hidden = false;
    $('#add-step-icon').outerHTML = `<div class="svc-icon lg" id="add-step-icon" style="background:${svc.gradient}">${svc.icon ? `<img src="https://cdn.simpleicons.org/${svc.icon}/ffffff" alt="" data-letter="${escapeHtml(svc.letter || svc.name[0])}"/>` : escapeHtml(svc.letter || svc.name[0])}</div>`;
    const count = state.accounts.filter((a) => a.service === svc.id).length;
    const input = $('#add-name');
    input.value = count ? `${svc.name} ${count + 1}` : 'Kişisel';
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  function confirmAdd() {
    if (!pendingService) return;
    const wsGroup = $('#add-workspace-group')?.value || 'personal';
    const acc = {
      id: uid(),
      service: pendingService.id,
      name: $('#add-name').value.trim() || pendingService.name,
      muted: false,
      workspace: wsGroup,
      lastActive: Date.now()
    };
    state.accounts.push(acc);
    $('#add-modal').hidden = true;
    createWebview(acc);
    activate(acc.id);
    toast(`${pendingService.name} eklendi (${wsGroup === 'work' ? 'İş' : 'Kişisel'})`, 'success');
    pendingService = null;
  }

  $('#btn-add').addEventListener('click', () => openAddModal());
  $('#add-back').addEventListener('click', () => {
    $('#add-step').hidden = true;
    $('#service-cat-tabs').hidden = false;
    $('#service-grid').hidden = false;
  });
  $('#add-confirm').addEventListener('click', confirmAdd);
  $('#add-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAdd(); });

  $$('#service-cat-tabs .cat-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeAddCat = btn.dataset.cat;
      $$('#service-cat-tabs .cat-pill').forEach((b) => b.classList.toggle('active', b === btn));
      renderAddServiceGrid();
    });
  });

  /* ----------------------------- Bağlam Menüsü ----------------------------- */

  function openContextMenu(acc, x, y) {
    const menu = $('#context-menu');
    const svc = window.getService(acc.service);
    const idx = state.accounts.indexOf(acc);
    menu.innerHTML = `
      <div class="cm-head">${escapeHtml(svc.name)} • ${escapeHtml(acc.name)} (${acc.workspace === 'work' ? 'İş' : 'Kişisel'})</div>
      <button data-act="reload"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>Yeniden yükle</button>
      <button data-act="reset-url"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5"/></svg>Giriş sayfasına dön</button>
      <button data-act="toggle-ws"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>Grubu Değiştir: ${acc.workspace === 'work' ? 'Kişisel Yap' : 'İş Yap'}</button>
      <button data-act="mute"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z${acc.muted ? 'M15.5 8.5a5 5 0 0 1 0 7' : 'M23 9l-6 6M17 9l6 6'}"/></svg>${acc.muted ? 'Sesi aç' : 'Sessize al'}</button>
      <button data-act="rename"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>Yeniden adlandır</button>
      ${idx > 0 ? '<button data-act="up"><svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>Yukarı taşı</button>' : ''}
      ${idx < state.accounts.length - 1 ? '<button data-act="down"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>Aşağı taşı</button>' : ''}
      <hr/>
      <button data-act="remove" class="danger"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>Kaldır</button>`;
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;

    $$('button', menu).forEach((b) => b.addEventListener('click', () => {
      menu.hidden = true;
      const act = b.dataset.act;
      const entry = webviews.get(acc.id);
      if (act === 'reload') entry ? entry.wv.reload() : activate(acc.id);
      if (act === 'reset-url') {
        const target = svc.url;
        if (acc.service === 'gmail') {
          window.vuno.clearGoogleCookies(`persist:vuno-${acc.id}`).catch(() => {});
        }
        if (entry?.wv) {
          entry.wv.loadURL(target);
          toast(`${svc.name} giriş sayfası temizlenerek yükleniyor...`);
        }
      }
      if (act === 'toggle-ws') {
        acc.workspace = acc.workspace === 'work' ? 'personal' : 'work';
        toast(`Hesap "${acc.workspace === 'work' ? 'İş' : 'Kişisel'}" grubuna taşındı`);
      }
      if (act === 'mute') { acc.muted = !acc.muted; applySettingsToUi(); }
      if (act === 'rename') {
        const btn = document.getElementById(`acc-${acc.id}`);
        startRename(acc, btn);
        return;
      }
      if (act === 'up' || act === 'down') {
        const i = state.accounts.indexOf(acc);
        const j = act === 'up' ? i - 1 : i + 1;
        [state.accounts[i], state.accounts[j]] = [state.accounts[j], state.accounts[i]];
      }
      if (act === 'remove') {
        if (!confirm(`"${acc.name}" (${svc.name}) kaldırılsın mı? Bu hesabın oturumu kapanır.`)) return;
        destroyWebview(acc.id);
        window.vuno.clearSession(`persist:vuno-${acc.id}`);
        state.accounts = state.accounts.filter((a) => a.id !== acc.id);
        state.inbox = state.inbox.filter((m) => m.accountId !== acc.id);
        delete state.unread[acc.id];
        if (state.activeId === acc.id) { activate('inbox'); return; }
      }
      renderSidebar();
      persistAccounts();
      if (state.activeId === 'inbox') renderInbox();
    }));
  }

  function startRename(acc, anchor) {
    const r = anchor.getBoundingClientRect();
    const menu = $('#context-menu');
    menu.innerHTML = `<div class="cm-head">Yeni ad</div>
      <div style="padding:4px"><input class="input" id="rename-input" maxlength="32" value="${escapeHtml(acc.name)}"/></div>`;
    menu.hidden = false;
    menu.style.left = `${r.right + 12}px`;
    menu.style.top = `${r.top}px`;
    const input = $('#rename-input');
    input.focus();
    input.select();
    const done = (save) => {
      if (save && input.value.trim()) acc.name = input.value.trim();
      menu.hidden = true;
      renderSidebar();
      persistAccounts();
      if (state.activeId === acc.id) activate(acc.id);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
  }

  document.addEventListener('mousedown', (e) => {
    const menu = $('#context-menu');
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });

  /* ----------------------------- Ayarlar ----------------------------- */

  function openSettings() {
    const s = state.settings;
    $$('[data-setting]').forEach((el) => { el.checked = !!s[el.dataset.setting]; });
    $$('#seg-theme button').forEach((b) => b.classList.toggle('active', b.dataset.value === s.theme));
    $('#dnd-schedule-enabled').checked = !!s.dndSchedule?.enabled;
    $('#dnd-from').value = s.dndSchedule?.from || '23:00';
    $('#dnd-to').value = s.dndSchedule?.to || '08:00';
    $('#auto-lock').value = String(s.lock?.autoLockMinutes || 0);
    $('#ram-saver-minutes').value = String(s.ramSaverMinutes || 20);
    $('#ai-key-input').value = s.aiKey || '';
    if ($('#ai-model-select')) $('#ai-model-select').value = s.aiModel || 'gemini-3.1-flash-lite';
    if ($('#tr-engine-select')) $('#tr-engine-select').value = s.translationEngine || (s.aiKey ? 'gemini' : 'google-free');
    if ($('#ai-test-status')) $('#ai-test-status').style.display = 'none';
    refreshLockUi();
    $('#settings-modal').hidden = false;
  }

  function refreshLockUi() {
    const enabled = !!state.settings.lock?.enabled;
    $('#lock-status').textContent = enabled ? 'PIN etkin — uygulama korunuyor' : 'PIN ile uygulamayı koru';
    $('#btn-set-pin').textContent = enabled ? 'PIN değiştir' : 'PIN belirle';
    $('#btn-remove-pin').hidden = !enabled;
    $('#pin-setup').hidden = true;
  }

  $('#btn-settings').addEventListener('click', openSettings);
  $$('#settings-tabs .tab').forEach((t) => t.addEventListener('click', () => {
    $$('#settings-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
  }));
  $$('[data-setting]').forEach((el) => el.addEventListener('change', () => saveSettings({ [el.dataset.setting]: el.checked })));
  $$('#seg-theme button').forEach((b) => b.addEventListener('click', () => {
    $$('#seg-theme button').forEach((x) => x.classList.toggle('active', x === b));
    saveSettings({ theme: b.dataset.value });
  }));
  const saveSchedule = () => saveSettings({
    dndSchedule: { enabled: $('#dnd-schedule-enabled').checked, from: $('#dnd-from').value || '23:00', to: $('#dnd-to').value || '08:00' }
  });
  ['#dnd-schedule-enabled', '#dnd-from', '#dnd-to'].forEach((s) => $(s).addEventListener('change', saveSchedule));
  $('#auto-lock').addEventListener('change', (e) => {
    const minutes = parseInt(e.target.value, 10);
    state.settings.lock = { ...state.settings.lock, autoLockMinutes: minutes };
    window.vuno.saveSettings({ lock: { autoLockMinutes: minutes } });
  });
  $('#ram-saver-minutes')?.addEventListener('change', (e) => {
    saveSettings({ ramSaverMinutes: parseInt(e.target.value, 10) });
  });

  $('#btn-save-ai-key')?.addEventListener('click', () => {
    const key = $('#ai-key-input').value.trim();
    const model = $('#ai-model-select')?.value || 'gemini-3.1-flash-lite';
    const trEngine = $('#tr-engine-select')?.value || 'google-free';
    saveSettings({ aiKey: key, aiModel: model, translationEngine: trEngine });
    toast(`Ayarlar kaydedildi ✨`, 'success');
    renderInbox();
  });

  $('#ai-key-input')?.addEventListener('change', () => {
    const key = $('#ai-key-input').value.trim();
    saveSettings({ aiKey: key });
    renderInbox();
  });

  $('#ai-model-select')?.addEventListener('change', (e) => {
    saveSettings({ aiModel: e.target.value });
    toast(`Model: ${e.target.value}`);
  });

  $('#tr-engine-select')?.addEventListener('change', (e) => {
    saveSettings({ translationEngine: e.target.value });
    toast(`Çeviri Motoru: ${e.target.options[e.target.selectedIndex].text}`);
  });

  $('#btn-test-ai-key')?.addEventListener('click', async () => {
    const key = $('#ai-key-input').value.trim();
    const model = $('#ai-model-select')?.value || 'gemini-3.1-flash-lite';
    const statusEl = $('#ai-test-status');
    const btn = $('#btn-test-ai-key');
    if (!key) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#ef4444';
      statusEl.textContent = 'Lütfen önce kutuya bir Gemini API anahtarı yapıştırın.';
      return;
    }
    btn.disabled = true;
    btn.textContent = '⏳ Test ediliyor...';
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--text-2)';
    statusEl.textContent = 'Google sunucularına bağlanılıyor...';
    try {
      const res = await window.vuno.testGemini(key, model);
      if (res && res.ok) {
        statusEl.style.color = '#10b981';
        statusEl.innerHTML = `✅ <b>Bağlantı Başarılı!</b> Google <b>${escapeHtml(res.model)}</b> modeli doğrulandı.`;
        saveSettings({ aiKey: key, aiModel: model });
        toast('Gemini 3.1 Flash-Lite bağlantısı doğrulandı! 🚀', 'success');
      } else {
        statusEl.style.color = '#ef4444';
        statusEl.innerHTML = `❌ <b>Bağlantı Hatası:</b> ${escapeHtml(res.error || 'Google isteği reddetti')}`;
      }
    } catch (err) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `❌ Hata: ${err.message || 'Bilinmeyen hata'}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Bağlantıyı Test Et';
    }
  });

  $('#btn-test-sound').addEventListener('click', playChime);

  $('#btn-set-pin').addEventListener('click', () => {
    $('#pin-setup').hidden = false;
    $('#pin-new').value = '';
    $('#pin-confirm').value = '';
    $('#pin-new').focus();
  });
  $('#btn-save-pin').addEventListener('click', async () => {
    const a = $('#pin-new').value.trim();
    const b = $('#pin-confirm').value.trim();
    if (!/^\d{4,12}$/.test(a)) return toast('PIN 4-12 haneli rakamlardan oluşmalı', 'error');
    if (a !== b) return toast('PIN\'ler eşleşmiyor', 'error');
    await window.vuno.setPin(a);
    state.settings.lock = { ...state.settings.lock, enabled: true };
    refreshLockUi();
    applySettingsToUi();
    toast('Uygulama kilidi etkinleştirildi', 'success');
  });
  $('#btn-remove-pin').addEventListener('click', async () => {
    await window.vuno.setPin(null);
    state.settings.lock = { ...state.settings.lock, enabled: false };
    refreshLockUi();
    applySettingsToUi();
    toast('Uygulama kilidi kaldırıldı');
  });

  /* ----------------------------- Diğer Düğmeler ----------------------------- */

  $('#btn-inbox').addEventListener('click', () => activate('inbox'));
  $('#btn-dnd').addEventListener('click', async () => {
    await saveSettings({ dnd: !state.settings.dnd });
    toast(state.settings.dnd ? 'Rahatsız Etme açıldı 🔕' : 'Rahatsız Etme kapatıldı 🔔');
  });
  $('#btn-theme').addEventListener('click', () => saveSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }));
  $('#btn-lock').addEventListener('click', lock);
  $('#btn-mark-all').addEventListener('click', () => { state.inbox.forEach((m) => { m.read = true; }); persistInbox(); renderInbox(); updateBadges(); });
  $('#btn-clear-inbox').addEventListener('click', () => { state.inbox = []; persistInbox(); renderInbox(); updateBadges(); });

  // 'Sadece okunmamış' filtresi
  $('#btn-unread-only').addEventListener('click', () => {
    state.unreadOnly = !state.unreadOnly;
    $('#btn-unread-only').classList.toggle('active', state.unreadOnly);
    renderInbox();
  });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => { $(`#${b.dataset.close}`).hidden = true; }));
  $$('.modal-backdrop').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-backdrop').forEach((m) => { m.hidden = true; });
    }
    // Ctrl+K -> Evrensel Arama
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openSearchModal();
    }
    // Ctrl+R veya F5 -> Yenile
    if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
      location.reload();
      return;
    }
    // Ctrl+0..9
    if (e.ctrlKey && /^[0-9]$/.test(e.key) && !state.locked) {
      const n = parseInt(e.key, 10);
      if (n === 0) activate('inbox');
      else if (state.accounts[n - 1]) activate(state.accounts[n - 1].id);
    }
  });

  /* ----------------------------- Kilit Ekranı ----------------------------- */

  let pinBuffer = '';
  function renderPinDots() {
    $('#pin-dots').innerHTML = '<i></i>'.repeat(pinBuffer.length);
  }

  function lock() {
    if (!state.settings.lock?.enabled || state.locked) return;
    state.locked = true;
    pinBuffer = '';
    renderPinDots();
    $('#lock-error').textContent = '';
    $('#lock-screen').hidden = false;
    $$('.modal-backdrop').forEach((m) => { m.hidden = true; });
    $('#webviews').style.visibility = 'hidden';
    setTimeout(() => $('#lock-input').focus(), 50);
  }

  async function tryUnlock() {
    if (!pinBuffer) return;
    const ok = await window.vuno.verifyPin(pinBuffer);
    if (ok) {
      state.locked = false;
      $('#lock-screen').hidden = true;
      $('#webviews').style.visibility = '';
    } else {
      $('#lock-error').textContent = 'Hatalı PIN';
      const dots = $('#pin-dots');
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
      pinBuffer = '';
      setTimeout(renderPinDots, 350);
    }
  }

  function buildKeypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    $('#keypad').innerHTML = keys.map((k) => {
      if (k === 'del') return '<button class="k-fn" data-k="del">Sil</button>';
      if (k === 'ok') return '<button class="k-fn" data-k="ok">Aç</button>';
      return `<button data-k="${k}">${k}</button>`;
    }).join('');
    $$('#keypad button').forEach((b) => b.addEventListener('click', () => pressKey(b.dataset.k)));
  }

  function pressKey(k) {
    $('#lock-error').textContent = '';
    if (k === 'del') pinBuffer = pinBuffer.slice(0, -1);
    else if (k === 'ok') return tryUnlock();
    else if (pinBuffer.length < 12) pinBuffer += k;
    renderPinDots();
    $('#lock-input').focus();
  }

  document.addEventListener('keydown', (e) => {
    if (!state.locked) return;
    if (/^[0-9]$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') pressKey('del');
    else if (e.key === 'Enter') pressKey('ok');
    e.preventDefault();
  });
  $('#lock-screen').addEventListener('mousedown', () => setTimeout(() => $('#lock-input').focus(), 0));

  /* ----------------------------- Ana Süreçten Gelen Olaylar ----------------------------- */

  window.vuno.onReply(async ({ key, accountId, notifId, text }) => {
    if (state.locked) return;
    let item = state.inbox.find((m) => m.key === key);
    if (!item) {
      item = { key, accountId, notifId, replies: [] };
    }
    const ok = await replyToItem(item, text);
    if (ok && !state.windowFocused) {}
  });
  window.vuno.onOpenNotification(({ accountId, notifId }) => openItem(accountId, notifId));
  window.vuno.onLock(lock);
  window.vuno.onPlaySound(playChime);
  window.vuno.onSettingsChanged((s) => { state.settings = s; applySettingsToUi(); });
  window.vuno.onWindowFocus((f) => {
    state.windowFocused = f;
    if (f && state.activeId !== 'inbox') {
      state.inbox.forEach((m) => { if (m.accountId === state.activeId) m.read = true; });
      updateBadges();
    }
  });
  setInterval(applySettingsToUi, 60000);

  /* ----------------------------- Başlat ----------------------------- */

  async function init() {
    try {
      CHROME_USER_AGENT = await window.vuno.getUserAgent() || CHROME_USER_AGENT;
    } catch (_) {}
    const data = await window.vuno.getStore();
    state.accounts = data.accounts || [];
    state.settings = data.settings || {};
    state.templates = data.templates || [
      { id: 't1', title: 'Tamamdır', text: 'Tamamdır, anlaştık! 👍' },
      { id: 't2', title: 'Toplantıdayım', text: 'Şu an toplantıdayım, bitince dönüş yapacağım. ⏳' },
      { id: 't3', title: 'İnceliyorum', text: 'Mesajınızı aldım, inceliyorum. En kısa sürede yazacağım.' }
    ];
    state.activeWorkspace = data.activeWorkspace || 'all';
    state.inbox = Array.isArray(data.inbox) ? data.inbox.slice(0, 30) : []; // kayıtlı gelen kutusunu geri yükle
    $$('.ws-btn').forEach((b) => b.classList.toggle('active', b.dataset.ws === state.activeWorkspace));

    buildKeypad();
    // Statik kenar çubuğu butonlarına uçan tooltip bağla
    $$('.sidebar [data-tip]').forEach((b) => {
      if (b.classList.contains('account-btn')) return;
      bindTooltip(b, () => `<div class="tip-acc-name">${escapeHtml(b.dataset.tip)}</div>`);
    });
    await applySettingsToUi();

    for (const acc of state.accounts) createWebview(acc);

    const startId = data.activeAccountId && accountById(data.activeAccountId) ? data.activeAccountId : 'inbox';
    activate(startId);

    if (state.settings.lock?.enabled) lock();
  }

  /* ── Oto-güncelleme UI ────────────────────────────────────── */
  const updateStatusEl = $('#update-status');
  const updateProgressEl = $('#update-progress');
  const updateProgressBarEl = $('#update-progress-bar');
  const btnCheckUpdate = $('#btn-check-update');

  function setUpdateStatus(text) { if (updateStatusEl) updateStatusEl.textContent = text; }

  window.vuno.onUpdateStatus((u) => {
    if (u.type === 'available') {
      setUpdateStatus(`Yeni sürüm v${u.version} mevcut! Yüklemek için "Şimdi Güncelle"ye bas.`);
      btnCheckUpdate.textContent = 'Şimdi Güncelle';
      btnCheckUpdate.dataset.install = '1';
      toast(`Vuno Connect v${u.version} çıktı 🎉`, 'success');
    } else if (u.type === 'downloading') {
      updateProgressEl.hidden = false;
      updateProgressBarEl.style.width = `${u.percent || 0}%`;
      setUpdateStatus(`İndiriliyor… %${u.percent || 0}`);
    } else if (u.type === 'verifying') {
      setUpdateStatus('Doğrulanıyor…');
    } else if (u.type === 'installing') {
      updateProgressEl.hidden = false;
      updateProgressBarEl.style.width = '100%';
      setUpdateStatus('Kuruluyor… Uygulama birkaç saniye içinde yeniden başlayacak.');
    } else if (u.type === 'error') {
      updateProgressEl.hidden = true;
      setUpdateStatus(`Güncelleme hatası: ${u.message}`);
      toast('Güncelleme indirilemedi', 'error');
    }
  });

  btnCheckUpdate?.addEventListener('click', async () => {
    if (btnCheckUpdate.dataset.install) {
      btnCheckUpdate.disabled = true;
      await window.vuno.installUpdate();
      return;
    }
    btnCheckUpdate.disabled = true;
    btnCheckUpdate.textContent = 'Kontrol ediliyor…';
    const r = await window.vuno.checkForUpdates();
    btnCheckUpdate.disabled = false;
    if (r.error) { setUpdateStatus(`Kontrol başarısız: ${r.error}`); return; }
    if (r.available) {
      setUpdateStatus(`Yeni sürüm v${r.remote} mevcut!`);
      btnCheckUpdate.textContent = 'Şimdi Güncelle';
      btnCheckUpdate.dataset.install = '1';
    } else {
      setUpdateStatus('Son sürümü kullanıyorsun ✨');
      btnCheckUpdate.textContent = 'Kontrol Et';
    }
  });

  window.vuno.getLocalVersion().then((v) => {
    const el = $('#about-version');
    if (el && v) el.textContent = `v${v}`;
  }).catch(() => {});

  init();
})();
