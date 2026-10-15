// Hızlı cevap pop-up'ı
(() => {
  const stack = document.getElementById('stack');
  const LIFETIME = 9000;
  const MAX_CARDS = 4;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const report = () => window.popup.resize(stack.children.length ? stack.getBoundingClientRect().height : 0);
  new ResizeObserver(report).observe(stack);

  window.popup.onTheme((t) => {
    const theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    document.documentElement.dataset.theme = theme;
  });

  function dismiss(card) {
    if (card.classList.contains('out')) return;
    clearTimeout(card._timer);
    card.classList.add('out');
    setTimeout(() => { card.remove(); report(); }, 280);
  }

  function startTimer(card, ms) {
    clearTimeout(card._timer);
    card._timer = setTimeout(() => dismiss(card), ms);
  }

  window.popup.onAdd((n) => {
    // Aynı kişiden yeni mesaj gelirse eski kartı değiştir
    for (const c of stack.children) {
      if (c.dataset.acc === n.accountId && c.dataset.title === n.title && !c.contains(document.activeElement)) dismiss(c);
    }
    while (stack.children.length >= MAX_CARDS) stack.firstElementChild.remove();

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.acc = n.accountId;
    card.dataset.title = n.title;
    card.style.setProperty('--svc', n.gradient);

    const svcInner = n.serviceIcon
      ? `<img src="https://cdn.simpleicons.org/${esc(n.serviceIcon)}/ffffff" alt="" />`
      : esc(n.serviceLetter);
    const avatar = n.icon
      ? `<img class="avatar" src="${esc(n.icon)}" alt="" />`
      : `<div class="avatar">${esc((n.title || '?').trim()[0] || '?')}</div>`;

    card.innerHTML = `
      <div class="head">
        <span class="svc" style="background:${esc(n.gradient)}">${svcInner}</span>
        <span class="grow">${esc(n.serviceName)} • ${esc(n.accountName)}</span>
        <span>şimdi</span>
        <button class="x" title="Kapat"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="body" title="Sohbeti aç">
        ${avatar}
        <div class="txt"><div class="title">${esc(n.title)}</div><div class="msg">${esc(n.body)}</div></div>
      </div>
      ${n.noReply ? '' : `<form class="reply">
        <input placeholder="Cevap yaz ve Enter'a bas..." autocomplete="off" />
        <button class="send" type="submit" title="Gönder"><svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
      </form>`}
      <div class="progress" style="animation: shrink ${LIFETIME}ms linear forwards"></div>`;

    card.querySelector('.x').addEventListener('click', () => dismiss(card));
    card.querySelector('.body').addEventListener('click', () => {
      window.popup.open({ accountId: n.accountId, notifId: n.notifId });
      dismiss(card);
    });

    const form = card.querySelector('form');
    if (form) {
      const input = form.querySelector('input');
      input.addEventListener('mousedown', () => window.popup.focus());
      input.addEventListener('focus', () => { card.classList.add('paused'); clearTimeout(card._timer); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(card); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        window.popup.reply({ key: n.key, accountId: n.accountId, notifId: n.notifId, text });
        form.outerHTML = `<div class="status"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Gönderiliyor: “${esc(text.length > 40 ? text.slice(0, 40) + '…' : text)}”</div>`;
        card.querySelector('.progress')?.remove();
        startTimer(card, 1800);
      });
    }

    card.addEventListener('mouseenter', () => { card.classList.add('paused'); clearTimeout(card._timer); });
    card.addEventListener('mouseleave', () => {
      if (card.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      card.classList.remove('paused');
      startTimer(card, 4000);
    });

    stack.appendChild(card);
    startTimer(card, LIFETIME);
    report();
  });
})();
