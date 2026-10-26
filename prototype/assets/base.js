/* ===== shared behaviour: header menus, design notes, app handoff stage ===== */
window.Concept = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const motionMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionMQ.matches; // gates large movement only
  const tallFrame = () => window.self !== window.top && innerHeight > Math.max(screen.height || 0, 900) * 1.15;
  const onPhone = () => matchMedia('(pointer:coarse) and (max-width:980px)').matches;

  /* header */
  const menu = $('#siteMenu'), menuBtn = $('#menuBtn'), head = $('#siteHead');
  const setMenu = open => {
    if (!menu) return;
    if (open) document.documentElement.style.setProperty('--menu-top', head.getBoundingClientRect().bottom + 'px');
    menu.hidden = !open; head.classList.toggle('menu-open', open); document.body.classList.toggle('menu-lock', open);
    menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) { pickTab(tabs[0]); tabs[0]?.focus(); } else menuBtn.focus();
  };
  menuBtn?.addEventListener('click', () => setMenu(menu.hidden));
  document.addEventListener('keydown', e => {
    if (!menu || menu.hidden) return;
    if (e.key === 'Escape') return setMenu(false);
    if (e.key === 'Tab') { // keep focus inside the open menu (header controls stay reachable)
      const f = $$('a,button', head).filter(x => x.offsetParent !== null);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  menu?.addEventListener('click', e => { if (e.target.closest('a[href^="#"],a[href*=".html#"]')) setMenu(false); });
  const tabs = $$('.menu-tabs [role="tab"]');
  function pickTab(t) { if (!t) return; tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; $('#' + x.getAttribute('aria-controls')).hidden = !on; }); }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pickTab(t));
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
      e.preventDefault(); const n = tabs[(i + d + tabs.length) % tabs.length]; pickTab(n); n.focus();
    });
  });

  /* header over a dark hero: transparent until the hero has scrolled under it */
  { const over = $('[data-head-over]'), head = $('#siteHead');
    if (over && head) { document.body.classList.add('head-over');
      const io = new IntersectionObserver(([e]) => head.classList.toggle('solid', !e.isIntersecting), { rootMargin: `-${head.offsetHeight}px 0px 0px 0px` });
      io.observe(over); } }

  /* rails: mouse drag (touch scrolls natively), arrow buttons, end states */
  $$('.rail').forEach(r => {
    let x0 = 0, s0 = 0, moved = false, id = null;
    r.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0) return; id = e.pointerId; x0 = e.clientX; s0 = r.scrollLeft; moved = false; });
    r.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return; const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) > 5) { moved = true; r.classList.add('dragging'); r.setPointerCapture(id); }
      if (moved) r.scrollLeft = s0 - dx;
    });
    const end = () => {
      if (id === null) return; id = null; if (!moved) return;
      const kids = [...r.children], pad = parseFloat(getComputedStyle(r).paddingLeft) || 0;
      const near = kids.reduce((b, k) => Math.abs(k.offsetLeft - pad - r.scrollLeft) < Math.abs(b.offsetLeft - pad - r.scrollLeft) ? k : b, kids[0]);
      r.classList.remove('dragging'); r.scrollTo({ left: near.offsetLeft - pad, behavior: reduced() ? 'auto' : 'smooth' });
    };
    r.addEventListener('pointerup', end); r.addEventListener('pointercancel', end); r.addEventListener('lostpointercapture', end);
    r.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    r.addEventListener('dragstart', e => e.preventDefault());
    const btns = $$(`[data-rail="${r.id}"]`);
    const sync = () => btns.forEach(b => { b.disabled = +b.dataset.d < 0 ? r.scrollLeft < 4 : r.scrollLeft > r.scrollWidth - r.clientWidth - 4; });
    btns.forEach(b => b.addEventListener('click', () => { const k = r.children[0]; r.scrollBy({ left: +b.dataset.d * ((k?.offsetWidth || 300) + 20), behavior: reduced() ? 'auto' : 'smooth' }); }));
    r.addEventListener('scroll', sync, { passive: true }); addEventListener('resize', sync); sync();
  });

  /* design notes */
  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; };
  { const t = $('#notesToggle'), n = $$('.pin').length; if (t && n) t.textContent = `Design notes · ${n}`; }
  $('#notesToggle')?.addEventListener('click', e => { const on = document.body.classList.toggle('notes'); e.currentTarget.setAttribute('aria-pressed', String(on)); if (!on) closePop(); });
  $$('.pin').forEach((p, i) => {
    const text = p.textContent.trim(); p.textContent = i + 1; p.setAttribute('aria-label', `Design note ${i + 1}: ${p.dataset.note}`); p.setAttribute('aria-expanded', 'false');
    p.addEventListener('click', e => {
      e.stopPropagation();
      if (pop && pop.dataset.for === String(i)) return closePop();
      closePop();
      pop = document.createElement('div'); pop.className = 'pin-pop'; pop.dataset.for = i; pop.setAttribute('role', 'note');
      pop.innerHTML = '<b></b>'; pop.querySelector('b').textContent = p.dataset.note;
      text.split(/\n+/).map(l => l.trim()).filter(Boolean).forEach(l => { const m = l.match(/^(Why|Kept|Changed|Build|Test|A11y|Data):\s*(.*)$/); const row = document.createElement('p'); if (m) { const k = document.createElement('i'); k.textContent = m[1]; row.append(k, document.createTextNode(m[2])); } else row.textContent = l; pop.appendChild(row); });
      p.parentElement.appendChild(pop);
      const pr = p.getBoundingClientRect(), par = p.parentElement.getBoundingClientRect();
      let left = pr.left - par.left + 34;
      const maxLeft = Math.min(window.innerWidth - 16, par.right) - par.left - pop.offsetWidth;
      if (left > maxLeft) left = Math.max(-par.left + 16, pr.left - par.left - pop.offsetWidth - 8);
      pop.style.left = left + 'px'; pop.style.top = (pr.top - par.top) + 'px';
    });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.pin-pop')) closePop(); });

  /* decorative QR-style code (demo, not scannable) */
  function drawQR(text, el = $('#qr')) {
    if (!el) return;
    let h = 2166136261; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
    const N = 29, cells = [];
    const finder = (x, y) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) { const e = i === 0 || i === 6 || j === 0 || j === 6, c = i >= 2 && i <= 4 && j >= 2 && j <= 4; if (e || c) cells.push([x + i, y + j]); } };
    const inF = (x, y) => (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (!inF(x, y) && rnd() > .52) cells.push([x, y]);
    el.innerHTML = '<rect width="29" height="29" fill="#fff"/>' + cells.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#0E1010"/>`).join('');
  }

  /* handoff stage */
  const stage = $('#stage');
  let current = 0, timer = null, playing = true, opener = null, opts = {};
  const views = () => $$('#stage .view');
  function showView(i) {
    views().forEach((v, k) => { v.classList.toggle('on', k === i); v.classList.toggle('left', k < i); });
    $('#stage .screen')?.classList.toggle('dark', !!opts.darkViews?.includes(i));
    current = i;
    $$('#steps button').forEach((b, k) => {
      if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      const p = b.querySelector('.prog'); p.classList.remove('run'); void p.offsetWidth;
      if (k === i && playing && views().length > 1) p.classList.add('run');
    });
    opts.onView?.(i);
  }
  function schedule() { clearTimeout(timer); if (!playing || views().length < 2) return; timer = setTimeout(() => { showView((current + 1) % views().length); schedule(); }, 2800); }
  function open(e, startAt = 0) {
    if (!stage || !stage.hidden) return;
    opener = e?.currentTarget || document.activeElement;
    const phone = onPhone();
    stage.classList.toggle('on-phone', phone);
    $('#handoffTitle').textContent = phone ? 'Continue in the app' : 'Point your phone camera at the code';
    $('#handoffText').textContent = phone ? opts.phoneText : opts.desktopText;
    stage.classList.toggle('inline', tallFrame());
    if (stage.classList.contains('inline')) {
      const r = opener?.getBoundingClientRect ? opener.getBoundingClientRect() : { top: 0 };
      stage.style.setProperty('--stage-top', Math.max(16, r.top + scrollY - 320) + 'px');
    }
    stage.hidden = false; if (!stage.classList.contains('inline')) document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('in')));
    playing = true; $('#pauseBtn').textContent = 'Pause walkthrough'; $('#pauseBtn').setAttribute('aria-pressed', 'false');
    $('#pauseBtn').hidden = views().length < 2; stage.classList.toggle('single', views().length < 2);
    showView(startAt); stage.scrollTop = 0; $('#stageTitle').focus({ preventScroll: true }); schedule();
  }
  function close() {
    if (!stage || stage.hidden) return;
    clearTimeout(timer); stage.classList.remove('in');
    setTimeout(() => { stage.hidden = true; document.body.style.overflow = ''; opener?.focus?.(); }, 200);
  }
  function init(o) {
    opts = o || {};
    drawQR(opts.qr || 'bolt-concept');
    $$('[data-handoff]').forEach(b => b.addEventListener('click', e => open(e)));
    $$('[data-close]').forEach(b => b.addEventListener('click', close));
    // footer: columns open on desktop, accordions on phones
    const fq = matchMedia('(min-width:861px)'), fset = () => $$('.fcol').forEach(d => { d.open = fq.matches; });
    fset(); fq.addEventListener('change', fset);
    $$('svg[data-qr]').forEach(el => drawQR(el.dataset.qr, el));
    // Explore apps: every Bolt app in one list (Food is a separate app, so it lives here instead of competing with Get Bolt)
    const apps = $('#apps');
    if (apps) {
      $$('.apps-open').forEach(b => b.addEventListener('click', () => apps.showModal()));
      $('.apps-x', apps).addEventListener('click', () => apps.close());
      apps.addEventListener('click', e => { if (e.target === apps || e.target.closest('.app')) apps.close(); });
    }
    $$('#steps button').forEach(b => b.addEventListener('click', () => { showView(+b.dataset.step); schedule(); }));
    $('#pauseBtn')?.addEventListener('click', e => {
      playing = !playing; e.currentTarget.textContent = playing ? 'Pause walkthrough' : 'Play walkthrough';
      e.currentTarget.setAttribute('aria-pressed', String(!playing)); showView(current); schedule();
    });
    $('#sendLink')?.addEventListener('click', () => { $('#sendMsg').textContent = 'In the live product this asks for your phone number and texts you a link that opens this trip. This concept collects nothing.'; });
    $('#openApp')?.addEventListener('click', e => { e.currentTarget.textContent = 'Concept demo: this would open the app'; });
  }
  document.addEventListener('keydown', e => {
    if (stage && !stage.hidden) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        const f = $$('button, input, [href]', stage).filter(x => x.offsetParent !== null);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  });
  return { $, $$, reduced, init, open, close, showView, drawQR };
})();
