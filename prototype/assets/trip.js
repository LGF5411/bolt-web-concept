/* Shared trip search: two comboboxes (pickup / destination) over places and real street names,
   swap button, popular destinations, map-tap target. Used by Home, Rides, Scooters and Drive. */
window.TripSearch = function (o) {
  const { $, $$ } = Concept, P = CityMap.data.places, st = o.state;
  const STREETS = CityMap.streets(), placeList = Object.values(P);
  st.focus = st.focus || 'to';
  function suggestions(qs) {
    const t = qs.trim().toLowerCase(); if (!t) return placeList.slice(0, 8).map(p => ({ kind: 'place', ...p }));
    const pl = placeList.filter(p => p.name.toLowerCase().includes(t) || p.local.toLowerCase().includes(t)).map(p => ({ kind: 'place', ...p }));
    const sts = STREETS.filter(s => s.name.toLowerCase().startsWith(t)).concat(STREETS.filter(s => !s.name.toLowerCase().startsWith(t) && s.name.toLowerCase().includes(t))).slice(0, 8).map(s => ({ kind: 'street', name: s.name, x: s.x, y: s.y }));
    return [...pl, ...sts].slice(0, 9);
  }
  // an open suggestion list may reach past the panel: let the panel grow under it instead of clipping it
  function fitPanel(list) { const pn = o.panel; if (!pn) return; pn.style.minHeight = ''; if (!list || list.hidden || matchMedia('(max-width:860px)').matches) return;
    pn.style.minHeight = `${Math.ceil(list.getBoundingClientRect().bottom - pn.getBoundingClientRect().top + pn.scrollTop + 16)}px`; }
  function combo(which) {
    const input = $('#' + which); if (!input) return;
    const list = $(which === 'from' ? '#listFrom' : '#listTo'), field = input.closest('.field');
    let items = [], sel = -1;
    const render = () => {
      items = suggestions(input.value);
      list.innerHTML = items.map((it, i) => `<li role="option" id="${which}-o${i}" aria-selected="${i === sel}"><i aria-hidden="true">${it.kind === 'place' ? '★' : '⌖'}</i><span><b>${it.name}</b><span>${it.kind === 'place' ? it.local : 'Street · Tallinn'}</span></span></li>`).join('');
      list.hidden = !items.length; input.setAttribute('aria-expanded', String(!list.hidden)); fitPanel(list);
      $$('li', list).forEach((li, i) => li.addEventListener('mousedown', e => { e.preventDefault(); choose(i); }));
    };
    const choose = i => { const it = items[i]; if (!it) return; input.value = it.name; list.hidden = true; input.setAttribute('aria-expanded', 'false'); fitPanel(); api.set(which, { x: it.x, y: it.y, label: it.name, k: it.k }); st.focus = 'to'; input.blur(); };
    input.addEventListener('focus', () => { st.focus = which; sel = -1; input.select(); render(); });
    input.addEventListener('input', () => { sel = -1; field.classList.toggle('has', !!input.value); render(); });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); fitPanel(); const cur = st[which]; if (input.value !== (cur ? cur.label : '')) { input.value = cur ? cur.label : ''; field.classList.toggle('has', !!cur); } }, 120));
    input.addEventListener('keydown', e => {
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); input.setAttribute('aria-activedescendant', `${which}-o${sel}`); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel < 0 ? 0 : sel); }
      else if (e.key === 'Escape') { list.hidden = true; fitPanel(); input.blur(); }
    });
    field.querySelector('.clear')?.addEventListener('click', () => { input.value = ''; field.classList.remove('has'); st[which] = null; o.onClear?.(which); input.focus(); });
  }
  const api = {
    set(which, p) {
      if (o.locked?.()) return;
      st[which] = p; const input = $('#' + which); if (input) { input.value = p.label; input.closest('.field')?.classList.add('has'); }
      o.onSet(which, p);
    },
    tap(x, y) { const s = CityMap.streetAt(x, y); api.set(st.focus === 'from' ? 'from' : 'to', { x, y, label: s ? `Pin on ${s}` : 'Dropped pin' }); st.focus = 'to'; },
    fill() { for (const w of ['from', 'to']) { const input = $('#' + w); if (input) { input.value = st[w] ? st[w].label : ''; input.closest('.field')?.classList.toggle('has', !!st[w]); } } },
  };
  combo('from'); combo('to');
  const pop = $(o.popular || '#popular');
  if (pop) { pop.innerHTML = (o.popularKeys || ['airport', 'telliskivi', 'kadriorg', 'pirita', 'seaplane', 'ulemiste']).map(k => `<button type="button" data-k="${k}">${P[k].name}</button>`).join('');
    $$('button', pop).forEach(b => b.addEventListener('click', () => { const p = P[b.dataset.k]; api.set(st.from ? 'to' : 'from', { ...p, label: p.name }); })); }
  $('#swap')?.addEventListener('click', e => { if (!st.to || !st.from || o.locked?.()) return; [st.from, st.to] = [st.to, st.from]; api.fill(); e.currentTarget.classList.toggle('spin'); o.onSwap ? o.onSwap() : o.onSet('to', st.to); });
  // deep links: ?from=oldtown&to=airport
  const q = new URLSearchParams(location.search);
  for (const w of ['from', 'to']) { const v = q.get(w); if (!v) continue;
    if (P[v]) st[w] = { ...P[v], label: P[v].name };
    else { const m = v.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(.+)$/); if (m) st[w] = { x: +m[1], y: +m[2], label: m[3] }; } }
  api.fill();
  // a link that carries this trip to another page (place key when there is one, otherwise coordinates)
  api.link = (page, extra = '') => { const enc = p => p ? (p.k || `${Math.round(p.x)},${Math.round(p.y)},${p.label}`) : ''; const u = new URLSearchParams(); if (st.from) u.set('from', enc(st.from)); if (st.to) u.set('to', enc(st.to)); return `${page}?${u}${extra}`; };
  return api;
};
