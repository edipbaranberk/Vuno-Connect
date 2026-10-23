/* ===================== Vuno Connect — Arayüz mantığı ===================== */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const state = {
    accounts: [],          // { id, service, name, muted, workspace: 'personal'|'work', lastActive }
    activeId: null,        // aktif hesap id'si veya null
    activeWorkspace: 'all',// 'all', 'personal', 'work'
    templates: [],         // [{ id, title, text }]
    settings: {},
    unread: {},            // accountId -> sayı
    locked: false,
    windowFocused: true
  };

  const webviews = new Map(); // accountId -> { wrap, wv, ready, hibernating: boolean }

  /* ----------------------------- Yardımcılar ----------------------------- */

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const accountById = (id) => state.accounts.find((a) => a.id === id);

  const KNOWN_SERVICES = new Set([
    'whatsapp', 'instagram', 'messenger', 'telegram', 'discord', 'x', 'slack', 'outlook', 'proton', 'gmail'
  ]);

  function svcIconHtml(svc, size = '') {
    const sId = (svc.id || '').toLowerCase();
    if (KNOWN_SERVICES.has(sId)) {
      return `<div class="svc-icon ${size} svc-img-tile"><img src="../../assets/services/${sId}.png" alt="${escapeHtml(svc.name)}" /></div>`;
    }
    const inner = svc.icon
      ? `<img src="https://cdn.simpleicons.org/${svc.icon}/ffffff" alt="" data-letter="${escapeHtml((svc.letter || svc.name[0]))}" />`
      : escapeHtml(svc.letter || svc.name[0]);
    return `<div class="svc-icon ${size}" style="background:${svc.gradient}">${inner}</div>`;
  }

  function accIconHtml(acc, svc, size = '') {
    if (acc && acc.customIcon) {
      return `<div class="svc-icon ${size} svc-img-tile"><img src="${acc.customIcon}" alt="${escapeHtml(acc.name)}" /></div>`;
    }
    return svcIconHtml(svc, size);
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

  const ACCENT_COLORS = {
    classic: { name: 'Vuno Moru',      color: '#7c4dff' },
    ocean:   { name: 'Okyanus Mavisi', color: '#0284c7' },
    emerald: { name: 'Zümrüt Yeşili',  color: '#10b981' },
    rose:    { name: 'Gül Pembesi',    color: '#ec4899' },
    sunset:  { name: 'Günbatımı',      color: '#f97316' },
    crimson: { name: 'Alev Kırmızısı',  color: '#ef4444' },
    indigo:  { name: 'Kozmik İndigo',  color: '#6366f1' },
    amber:   { name: 'Kehribar',       color: '#f59e0b' }
  };

  function resolvedTheme() {
    const t = state.settings.theme || 'dark';
    if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t;
  }

  async function applySettingsToUi() {
    const isDark = resolvedTheme() === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

    const accentKey = state.settings.accentColor || 'classic';
    const accent = ACCENT_COLORS[accentKey] || ACCENT_COLORS.classic;
    const rootStyle = document.documentElement.style;
    rootStyle.removeProperty('--bg');
    rootStyle.removeProperty('--bg-2');
    rootStyle.setProperty('--accent-1', accent.color);
    rootStyle.setProperty('--accent-2', accent.color);
    rootStyle.setProperty('--accent-3', accent.color);
    rootStyle.setProperty('--accent-grad', accent.color);
    rootStyle.setProperty('--glow', 'transparent');

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
    const visible = visibleAccounts();
    if (state.activeId && !visible.some((a) => a.id === state.activeId)) {
      activate(visible.length ? visible[0].id : null);
    }
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
    accs.forEach((acc, idx) => {
      const svc = window.getService(acc.service);
      if (!svc) return;
      const btn = document.createElement('button');
      btn.className = 'side-btn account-btn';
      btn.dataset.id = acc.id;
      btn.dataset.tip = `${svc.name} • ${acc.name}`;
      btn.id = `acc-${acc.id}`;
      btn.classList.toggle('active', state.activeId === acc.id);
      btn.classList.toggle('muted-acc', !!acc.muted);
      const count = state.unread[acc.id] || 0;
      btn.innerHTML = accIconHtml(acc, svc) +
        (count && !acc.muted ? `<span class="badge">${count > 99 ? '99+' : count}</span>` : '') +
        (acc.muted ? '<span class="muted-dot"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg></span>' : '') +
        (webviews.get(acc.id)?.loading ? '<span class="loading-ring"></span>' : '');
      btn.addEventListener('click', () => activate(acc.id));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(acc, e.clientX, e.clientY); });

      const shortcutHint = idx < 9 ? ` <kbd style="margin-left:6px; font-size:10px; opacity:0.75; padding:1px 5px; border:1px solid rgba(255,255,255,0.25); border-radius:4px;">Ctrl+${idx + 1}</kbd>` : '';
      bindTooltip(btn, () => `
        <div class="tip-header">
          <span class="tip-badge" style="background:${svc.gradient}">${escapeHtml(svc.name)}</span>
          ${acc.muted ? '<span class="tip-muted">🔕 Sessizde</span>' : ''}
          ${count ? `<span class="tip-count">${count} yeni</span>` : ''}
          ${shortcutHint}
        </div>
        <div class="tip-acc-name">${escapeHtml(acc.name)}</div>
      `);

      list.appendChild(btn);
    });
    updateBadges();
  }

  function updateBadges() {
    let total = 0;
    for (const acc of state.accounts) if (!acc.muted) total += state.unread[acc.id] || 0;
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

  /* ----------------------------- Kullanıcı Aracısı (User Agent) ----------------------------- */

  let CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  function chromelessUa(full) {
    return full.replace(/Chrome\/[\d.]+/, 'Chrome');
  }

  function userAgentForService(acc, url) {
    const target = url || window.getService(acc.service)?.url || '';
    if (/accounts\.google\.com/i.test(target)) return chromelessUa(CHROME_USER_AGENT);
    return CHROME_USER_AGENT;
  }

  /* ----------------------------- Görünüm Değiştirme ----------------------------- */

  function activate(id) {
    state.activeId = id;
    const hasAccount = !!id && !!accountById(id);
    const welcomeView = $('#view-welcome');
    if (welcomeView) {
      welcomeView.classList.toggle('active', !hasAccount);
    }

    for (const [accId, entry] of webviews) entry.wrap.classList.toggle('active', accId === id);

    if (hasAccount) {
      const acc = accountById(id);
      if (acc) {
        acc.lastActive = Date.now();
        if (state.unread[id]) {
          state.unread[id] = 0;
          renderSidebar();
        }

        let entry = webviews.get(id);
        if (entry) {
          entry.highestNotifiedCount = 0;
          if (entry.recentNotifSigs) entry.recentNotifSigs.clear();
        }

        if (!webviews.has(id)) {
          createWebview(acc);
          entry = webviews.get(id);
        }

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
      setTimeout(() => { try { webviews.get(id)?.wv.focus(); } catch (_) {} }, 50);
    } else {
      $('#titlebar-title').textContent = '';
      const emptyTitle = $('#view-welcome h2');
      const emptyDesc = $('#view-welcome p.muted');
      if (state.activeWorkspace === 'work') {
        if (emptyTitle) emptyTitle.textContent = 'İş Alanında Hesap Yok 💼';
        if (emptyDesc) emptyDesc.innerHTML = 'Bu alanda henüz bir hesap yok. Sol menüdeki <b>+</b> butonuna tıklayarak iş hesabı ekleyebilir veya mevcut bir hesaba sağ tıklayıp <b>"İş alanına taşı"</b> diyebilirsiniz.';
      } else if (state.activeWorkspace === 'personal') {
        if (emptyTitle) emptyTitle.textContent = 'Kişisel Alanda Hesap Yok 👤';
        if (emptyDesc) emptyDesc.innerHTML = 'Bu alanda henüz bir hesap yok. Aşağıdaki servislerden ekleyebilir veya mevcut bir hesaba sağ tıklayıp Kişisel alana taşıyabilirsiniz.';
      } else {
        if (emptyTitle) emptyTitle.textContent = 'Vuno Connect\'e Hoş Geldin 👋';
        if (emptyDesc) emptyDesc.innerHTML = 'Tüm mesajlaşma servislerini tek bir yerden kolayca yönet. Başlamak için popüler bir servise tıkla veya sol menüdeki <b>+</b> butonunu kullan.';
      }
      renderWelcomeGrid(true);
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
      const isFocused = state.activeId === acc.id && state.windowFocused;

      if (isFocused) {
        if (state.unread[acc.id]) {
          state.unread[acc.id] = 0;
          renderSidebar();
        }
        entry.highestNotifiedCount = 0;
        return;
      }

      // Sayfa başlığında okunmamış sayısı varsa
      if (m) {
        const count = parseInt(m[1], 10);
        if (state.unread[acc.id] !== count) {
          state.unread[acc.id] = count;
          renderSidebar();
        }

        // Title-fallback bildirimi:
        // Yalnızca okunmamış sayısı bu oturumda daha önce bildirdiğimiz sayıyı aştığında bildir!
        // Kullanıcı açmadığı sürece aynı sayı (örneğin 1) için ASLA tekrar bildirim atılmaz.
        if (count > (entry.highestNotifiedCount || 0)) {
          entry.highestNotifiedCount = count;
          // Eğer son 30 saniye içinde web servisin kendisinden bildirim geldiyse mükerrer olmasın
          const recentRealNotif = entry.lastNotif && (Date.now() - entry.lastNotif.at < 30000);
          if (!recentRealNotif) {
            const svc = window.getService(acc.service);
            handleIncoming(acc, {
              id: 'title-fallback-' + Date.now(),
              title: svc ? svc.name : 'Yeni Bildirim',
              body: `${acc.name} hesabında ${count} okunmamış yeni ileti`,
              icon: ''
            });
          }
        }
      }
    });

    wv.addEventListener('ipc-message', (e) => {
      if (e.channel === 'vuno:notification') handleIncoming(acc, e.args[0]);
    });

    wv.addEventListener('new-window', (e) => {
      const url = e.url;
      if (!url) return;
      if (/microsoft|live\.com|office\.com|outlook|accounts\.google|appleid\.apple|account\.proton\.me|login|auth|signin|signup|oauth/i.test(url)) {
        wv.loadURL(url);
      } else {
        window.vuno.openExternal(url);
      }
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
    wv.setAttribute('allowpopups', 'true');
    wrap.appendChild(wv);
    $('#webviews').appendChild(wrap);

    const entry = { wrap, wv, ready: false, loading: true, lastNotif: null, hibernating: false, createdTime: Date.now(), highestNotifiedCount: 0, recentNotifSigs: new Map() };
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

  /* ----------------------------- Gelen Mesajlar & Bildirimler ----------------------------- */

  function handleIncoming(acc, n) {
    if (!n || (!n.title && !n.body)) return;
    const entry = webviews.get(acc.id);

    const isCurrentActive = state.activeId === acc.id && state.windowFocused;
    if (isCurrentActive) return; // Kullanıcı zaten aktif olarak bu hesapta ve pencere odakta!

    const now = Date.now();
    const sig = `${n.tag || ''}|${n.title}|${n.body}`;

    if (entry) {
      if (!entry.recentNotifSigs) entry.recentNotifSigs = new Map();
      // 2 dakikadan eski imzaları temizle
      for (const [s, ts] of entry.recentNotifSigs) {
        if (now - ts > 120000) entry.recentNotifSigs.delete(s);
      }
      // Aynı bildirim (aynı tag veya başlık+metin) son 60 saniye içinde gösterildiyse mükerrer olarak engelle
      const lastSeen = entry.recentNotifSigs.get(sig);
      if (lastSeen && now - lastSeen < 60000) return;

      entry.recentNotifSigs.set(sig, now);
      entry.lastNotif = { sig, at: now };
      entry.highestNotifiedCount = Math.max(entry.highestNotifiedCount || 0, state.unread[acc.id] || 0);
    }

    // Title-fallback değilse ve gerçek bildirimse unread sayısını artır
    if (!n.id?.startsWith('title-fallback-')) {
      state.unread[acc.id] = (state.unread[acc.id] || 0) + 1;
      if (entry) {
        entry.highestNotifiedCount = Math.max(entry.highestNotifiedCount || 0, state.unread[acc.id]);
      }
      renderSidebar();
    }

    if (acc.muted) return;

    const svc = window.getService(acc.service);

    window.vuno.notify({
      key: uid(),
      accountId: acc.id,
      notifId: n.id,
      accountName: acc.name,
      serviceName: svc.name,
      serviceId: svc.id,
      serviceIcon: svc.icon,
      serviceLetter: svc.letter || svc.name[0],
      gradient: svc.gradient,
      title: n.title ? `${n.title} (${svc.name})` : `${acc.name} (${svc.name})`,
      body: n.body || 'Yeni mesaj',
      icon: acc.customIcon || n.icon || '',
      isActiveAccount: false
    });
  }

  function openItem(accountId) {
    if (accountId) activate(accountId);
  }

  function renderWelcomeGrid(show) {
    const grid = $('#welcome-grid');
    if (!grid) return;
    grid.hidden = !show;
    if (!show) return;
    grid.innerHTML = '';
    for (const svc of window.VUNO_SERVICES.filter((s) => !s.unavailable).slice(0, 8)) {
      const card = document.createElement('button');
      card.className = 'svc-card';
      card.id = `welcome-${svc.id}`;
      card.innerHTML = `${svcIconHtml(svc, 'lg')}<b>${svc.name}</b><span>${svc.description}</span>`;
      card.addEventListener('click', () => openAddModal(svc.id));
      grid.appendChild(card);
    }
  }

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

    const matchedAccounts = state.accounts.filter((a) => {
      const svc = window.getService(a.service);
      return !q || a.name.toLowerCase().includes(q) || (svc && svc.name.toLowerCase().includes(q));
    });

    const matchedServices = window.VUNO_SERVICES.filter((s) =>
      !s.unavailable && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    ).slice(0, 6);

    let html = '';

    if (matchedAccounts.length) {
      html += '<div style="padding:6px 12px; font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px;">Bağlı Hesaplar</div>';
      html += matchedAccounts.map((acc) => {
        const svc = window.getService(acc.service);
        const unread = state.unread[acc.id] || 0;
        return `<div class="search-item" data-acc-id="${acc.id}">
          ${svc ? accIconHtml(acc, svc, 'sm') : ''}
          <div class="search-item-info">
            <div class="search-item-title">${escapeHtml(acc.name)} <span style="font-weight:400; font-size:12px; color:var(--text-3)">(${escapeHtml(svc?.name || '')})</span></div>
            <div class="search-item-body">${acc.workspace === 'work' ? '💼 İş' : '👤 Kişisel'}${unread ? ` • <b style="color:#ff3b5c">${unread} okunmamış</b>` : ''}</div>
          </div>
          <span style="font-size:11px; color:var(--text-3); background:var(--surface-2); padding:2px 8px; border-radius:4px;">Aç ↵</span>
        </div>`;
      }).join('');
    }

    if (q && matchedServices.length) {
      html += '<div style="padding:10px 12px 6px; font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px;">Yeni Servis Ekle</div>';
      html += matchedServices.map((svc) => {
        return `<div class="search-item" data-svc-id="${svc.id}">
          ${svcIconHtml(svc, 'sm')}
          <div class="search-item-info">
            <div class="search-item-title">${escapeHtml(svc.name)}</div>
            <div class="search-item-body">${escapeHtml(svc.description)}</div>
          </div>
          <span style="font-size:11px; color:var(--text-3); background:var(--surface-2); padding:2px 8px; border-radius:4px;">Ekle +</span>
        </div>`;
      }).join('');
    }

    if (!matchedAccounts.length && !matchedServices.length) {
      html = `<div style="text-align:center; padding:30px 10px; color:var(--text-3); font-size:13px;">
        "${escapeHtml(query)}" ile eşleşen hesap veya servis bulunamadı.</div>`;
    }

    list.innerHTML = html;

    $$('.search-item[data-acc-id]', list).forEach((el) => {
      el.addEventListener('click', () => {
        $('#search-modal').hidden = true;
        activate(el.dataset.accId);
      });
    });

    $$('.search-item[data-svc-id]', list).forEach((el) => {
      el.addEventListener('click', () => {
        $('#search-modal').hidden = true;
        openAddModal(el.dataset.svcId);
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
        <button class="btn ghost btn-copy-tmpl" data-text="${escapeHtml(t.text)}" style="padding:4px 10px; font-size:12px;">Kopyala</button>
        <button class="icon-btn" data-del-template="${t.id}" title="Sil">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    `).join('');

    $$('.btn-copy-tmpl', list).forEach((b) => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.text).then(() => toast('Metin panoya kopyalandı! 📋'));
      });
    });

    $$('[data-del-template]', list).forEach((b) => {
      b.addEventListener('click', () => {
        state.templates = state.templates.filter((x) => x.id !== b.dataset.delTemplate);
        window.vuno.saveTemplates(state.templates);
        renderTemplatesList();
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
    toast('Yeni şablon eklendi ✨', 'success');
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
    const stepIconHtml = svcIconHtml(svc, 'lg').replace('class="svc-icon', 'id="add-step-icon" class="svc-icon');
    $('#add-step-icon').outerHTML = stepIconHtml;
    const count = state.accounts.filter((a) => a.service === svc.id).length;
    const input = $('#add-name');
    input.value = count ? `${svc.name} ${count + 1}` : (state.activeWorkspace === 'work' ? `${svc.name} (İş)` : `${svc.name} (Kişisel)`);
    const wsSelect = $('#add-workspace-group');
    if (wsSelect) wsSelect.value = state.activeWorkspace === 'work' ? 'work' : 'personal';
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
      <button data-act="change-logo"><svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>Simge / Logo Değiştir</button>
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
      if (act === 'change-logo') {
        openLogoModal(acc);
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
        delete state.unread[acc.id];
        if (state.activeId === acc.id) {
          const remaining = visibleAccounts();
          activate(remaining.length ? remaining[0].id : null);
          return;
        }
      }
      renderSidebar();
      persistAccounts();
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

  /* ----------------------------- Simge / Logo Değiştirme Modalı ----------------------------- */

  let logoModalAccount = null;
  let logoModalSelectedIcon = null;

  function openLogoModal(acc) {
    logoModalAccount = acc;
    const svc = window.getService(acc.service);
    logoModalSelectedIcon = acc.customIcon || null;

    $('#logo-modal-subtitle').textContent = `"${acc.name}" (${svc.name}) için kenar çubuğunda görünecek simgeyi özelleştirin.`;
    $('#logo-preview-title').textContent = acc.name;
    updateLogoPreview();

    // Hazır simgeler grid'ini oluştur
    const grid = $('#preset-icons-grid');
    grid.innerHTML = '';
    const presetServices = ['outlook', 'gmail', 'whatsapp', 'instagram', 'telegram', 'messenger', 'discord', 'slack', 'proton', 'x'];
    presetServices.forEach((sId) => {
      const presetSvc = window.getService(sId);
      if (!presetSvc) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-icon-btn';
      const iconPath = `../../assets/services/${sId}.png`;
      btn.innerHTML = `<div class="svc-icon svc-img-tile"><img src="${iconPath}" alt="${presetSvc.name}" /></div><span>${presetSvc.name}</span>`;
      btn.classList.toggle('selected', logoModalSelectedIcon === iconPath);
      btn.addEventListener('click', () => {
        logoModalSelectedIcon = iconPath;
        $$('.preset-icon-btn', grid).forEach((b) => b.classList.toggle('selected', b === btn));
        updateLogoPreview();
      });
      grid.appendChild(btn);
    });

    $('#logo-modal').hidden = false;
  }

  function updateLogoPreview() {
    if (!logoModalAccount) return;
    const svc = window.getService(logoModalAccount.service);
    const prevIconEl = $('#logo-preview-icon');
    if (logoModalSelectedIcon) {
      prevIconEl.innerHTML = `<div class="svc-icon svc-img-tile"><img src="${logoModalSelectedIcon}" alt="" /></div>`;
    } else {
      prevIconEl.innerHTML = svcIconHtml(svc);
    }
  }

  // Dosyadan resim / logo seçme
  $('#btn-select-logo-file')?.addEventListener('click', () => {
    $('#logo-file-input')?.click();
  });

  $('#logo-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 128, 128);
        logoModalSelectedIcon = canvas.toDataURL('image/png');
        $$('.preset-icon-btn', $('#preset-icons-grid')).forEach((b) => b.classList.remove('selected'));
        updateLogoPreview();
        toast('Özel resim yüklendi! "Kaydet" butonuna tıklayarak uygulayabilirsiniz.');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Varsayılan logoya sıfırlama
  $('#btn-reset-default-logo')?.addEventListener('click', () => {
    logoModalSelectedIcon = null;
    $$('.preset-icon-btn', $('#preset-icons-grid')).forEach((b) => b.classList.remove('selected'));
    updateLogoPreview();
    toast('Varsayılan servis logosuna sıfırlandı.');
  });

  // Kaydet
  $('#btn-save-logo')?.addEventListener('click', () => {
    if (!logoModalAccount) return;
    logoModalAccount.customIcon = logoModalSelectedIcon;
    persistAccounts();
    renderSidebar();
    $('#logo-modal').hidden = true;
    toast('Hesap simgesi başarıyla güncellendi ✨');
  });

  document.addEventListener('mousedown', (e) => {
    const menu = $('#context-menu');
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });

  /* ----------------------------- Ayarlar ----------------------------- */

  function renderAccentPalette() {
    const container = $('#accent-palette');
    if (!container) return;
    container.innerHTML = '';
    const currentKey = state.settings.accentColor || 'classic';
    Object.entries(ACCENT_COLORS).forEach(([key, conf]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'accent-swatch' + (key === currentKey ? ' active' : '');
      btn.style.background = conf.color;
      btn.style.setProperty('--swatch-color', conf.color);
      btn.title = conf.name;
      btn.setAttribute('aria-label', conf.name);
      btn.addEventListener('click', () => {
        $$('.accent-swatch', container).forEach((s) => s.classList.remove('active'));
        btn.classList.add('active');
        saveSettings({ accentColor: key });
        toast(`Tema rengi: ${conf.name}`);
      });
      container.appendChild(btn);
    });
  }

  function openSettings() {
    const s = state.settings;
    $$('[data-setting]').forEach((el) => { el.checked = !!s[el.dataset.setting]; });
    $$('#seg-theme button').forEach((b) => b.classList.toggle('active', b.dataset.value === s.theme));
    renderAccentPalette();
    $('#dnd-schedule-enabled').checked = !!s.dndSchedule?.enabled;
    $('#dnd-from').value = s.dndSchedule?.from || '23:00';
    $('#dnd-to').value = s.dndSchedule?.to || '08:00';
    $('#auto-lock').value = String(s.lock?.autoLockMinutes || 0);
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

  $('#btn-dnd')?.addEventListener('click', async () => {
    await saveSettings({ dnd: !state.settings.dnd });
    toast(state.settings.dnd ? 'Rahatsız Etme açıldı 🔕' : 'Rahatsız Etme kapatıldı 🔔');
  });
  $('#btn-theme')?.addEventListener('click', () => saveSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }));
  $('#btn-lock')?.addEventListener('click', lock);

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
    // Ctrl+1..9 -> Hızlı hesap geçişi
    if (e.ctrlKey && /^[1-9]$/.test(e.key) && !state.locked) {
      const n = parseInt(e.key, 10);
      const accs = visibleAccounts();
      if (accs[n - 1]) {
        e.preventDefault();
        activate(accs[n - 1].id);
      }
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

  window.vuno.onReply(async ({ accountId }) => {
    if (state.locked) return;
    if (accountId) activate(accountId);
  });
  window.vuno.onOpenNotification(({ accountId }) => openItem(accountId));
  window.vuno.onLock(lock);
  window.vuno.onPlaySound(playChime);
  window.vuno.onSettingsChanged((s) => { state.settings = s; applySettingsToUi(); });
  window.vuno.onWindowFocus((f) => {
    state.windowFocused = f;
    if (f && state.activeId) {
      if (state.unread[state.activeId]) {
        state.unread[state.activeId] = 0;
        renderSidebar();
      }
      const entry = webviews.get(state.activeId);
      if (entry) {
        entry.highestNotifiedCount = 0;
        if (entry.recentNotifSigs) entry.recentNotifSigs.clear();
      }
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
    
    $$('.ws-btn').forEach((b) => b.classList.toggle('active', b.dataset.ws === state.activeWorkspace));

    buildKeypad();
    // Statik kenar çubuğu butonlarına uçan tooltip bağla
    $$('.sidebar [data-tip]').forEach((b) => {
      if (b.classList.contains('account-btn')) return;
      bindTooltip(b, () => `<div class="tip-acc-name">${escapeHtml(b.dataset.tip)}</div>`);
    });
    await applySettingsToUi();

    for (const acc of state.accounts) createWebview(acc);

    const startId = data.activeAccountId && accountById(data.activeAccountId)
      ? data.activeAccountId
      : (state.accounts.length ? state.accounts[0].id : null);
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
