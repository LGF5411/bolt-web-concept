/* ===== CityMap: a small vector map engine for the Tallinn concept pages =====
   Data: OpenStreetMap extract (roads graph, coast, water, parks, rail, airport, central buildings).
   Units: metres, x east, y south. Canvas rendering with a cached base layer and a live effects layer. */
window.CityMap = (() => {
  let D = null;

  /* ---------- data ---------- */
  async function load(b64) {
    if (D) return D;
    // '@url' loads the packed dataset as a cached file (web build); otherwise it is inlined as base64 (single-file build)
    let bin;
    if (b64[0] === '@') { const res = await fetch(b64.slice(1)); if (!res.ok) throw new Error('map data ' + res.status); bin = new Uint8Array(await res.arrayBuffer()); }
    else bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    const j = JSON.parse(await new Response(stream).text());
    const dec = (flat, x0 = 0, y0 = 0) => { const a = new Float32Array(flat.length); let px = x0, py = y0; for (let i = 0; i < flat.length; i += 2) { px += flat[i]; py += flat[i + 1]; a[i] = px; a[i + 1] = py; } return a; };
    const N = j.n.length / 2;
    const nx = new Float32Array(N), ny = new Float32Array(N);
    for (let i = 0; i < N; i++) { nx[i] = j.n[2 * i]; ny[i] = j.n[2 * i + 1]; }
    const E = j.e.length;
    const eu = new Int32Array(E), ev = new Int32Array(E), ec = new Int8Array(E), eow = new Int8Array(E), enm = new Int32Array(E), elen = new Float32Array(E);
    const eg = new Array(E), ebb = new Float32Array(E * 4);
    const adj = Array.from({ length: N }, () => []);
    for (let k = 0; k < E; k++) {
      const [u, v, c, ow, nm, L, inner] = j.e[k];
      eu[k] = u; ev[k] = v; ec[k] = c; eow[k] = ow; enm[k] = nm; elen[k] = Math.max(1, L);
      const mid = inner.length ? dec(inner) : new Float32Array(0);
      const g = new Float32Array(mid.length + 4);
      g[0] = nx[u]; g[1] = ny[u]; g.set(mid, 2); g[g.length - 2] = nx[v]; g[g.length - 1] = ny[v];
      eg[k] = g;
      let a = 1e9, b = 1e9, c2 = -1e9, d = -1e9;
      for (let i = 0; i < g.length; i += 2) { a = Math.min(a, g[i]); b = Math.min(b, g[i + 1]); c2 = Math.max(c2, g[i]); d = Math.max(d, g[i + 1]); }
      ebb[4 * k] = a; ebb[4 * k + 1] = b; ebb[4 * k + 2] = c2; ebb[4 * k + 3] = d;
      adj[u].push(k); if (v !== u) adj[v].push(k);
    }
    const rings = arr => arr.map(f => dec(f));
    D = {
      o: j.o, bbox: j.bbox, N, nx, ny, nf: Int8Array.from(j.nf), E, eu, ev, ec, eow, enm, elen, eg, ebb, adj, names: j.names,
      sea: rings(j.sea), isl: rings(j.isl), water: rings(j.water), green: rings(j.green), bld: rings(j.bld),
      rail: j.rail.map(([t, g]) => [t, dec(g)]), aero: j.aero.map(([t, g]) => [t, dec(g)]),
      places: Object.fromEntries(j.places.map(([k, en, et, x, y]) => [k, { k, name: en, local: et, x, y }])),
    };
    const bbOf = r => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); b = Math.min(b, r[i + 1]); c = Math.max(c, r[i]); d = Math.max(d, r[i + 1]); } return [a, b, c, d]; };
    D.bldBB = D.bld.map(bbOf); D.greenBB = D.green.map(bbOf); D.waterBB = D.water.map(bbOf); D.islBB = D.isl.map(bbOf);
    for (const r of D.rail) r.push(bbOf(r[1])); for (const r of D.aero) r.push(bbOf(r[1]));
    buildIndex();
    return D;
  }
  const proj = (lat, lon) => [(lon - D.o[1]) * D.o[2], (D.o[0] - lat) * D.o[3]];

  /* spatial index on nodes and edge midpoints */
  const CELL = 250; let grid = null, egrid = null;
  function buildIndex() {
    grid = new Map(); egrid = new Map();
    const key = (x, y) => (Math.floor(x / CELL) + 1000) * 4000 + Math.floor(y / CELL) + 1000;
    D.key = key;
    for (let i = 0; i < D.N; i++) { const k = key(D.nx[i], D.ny[i]); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    for (let e = 0; e < D.E; e++) { const g = D.eg[e], m = (g.length / 2 | 0) & ~1; const k = key(g[m], g[m + 1]); (egrid.get(k) || egrid.set(k, []).get(k)).push(e); }
  }
  const MODE_OK = {
    car: c => c <= 5, bike: c => c >= 1, walk: c => c >= 2,
  };
  const MODE_FLAG = { car: 1, bike: 2, walk: 2 };
  function nearestNode(x, y, mode = 'car') {
    let best = -1, bd = Infinity;
    for (let r = 0; r < 6 && best < 0 || r < 2; r++) {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const list = grid.get((cx + i + 1000) * 4000 + cy + j + 1000); if (!list) continue;
        for (const n of list) {
          if (!(D.nf[n] & MODE_FLAG[mode])) continue;
          if (!D.adj[n].some(e => MODE_OK[mode](D.ec[e]))) continue;
          // nobody is picked up or dropped off on a highway: snap to a street when one is close
          const fast = mode === 'car' && !D.adj[n].some(e => D.ec[e] >= 2);
          const d = (Math.sqrt((D.nx[n] - x) ** 2 + (D.ny[n] - y) ** 2) + (fast ? 160 : 0)) ** 2; if (d < bd) { bd = d; best = n; }
        }
      }
      if (best >= 0 && r >= 2) break;
    }
    return best;
  }
  function streetAt(x, y) {
    let best = '', bd = Infinity; const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const list = egrid.get((cx + i + 1000) * 4000 + cy + j + 1000); if (!list) continue;
      for (const e of list) { const nm = D.names[D.enm[e]]; if (!nm) continue; const g = D.eg[e];
        for (let k = 0; k < g.length; k += 2) { const d = (g[k] - x) ** 2 + (g[k + 1] - y) ** 2; if (d < bd) { bd = d; best = nm; } } }
    }
    return best;
  }

  let streetIdx = null;
  function streets() {
    if (streetIdx) return streetIdx;
    const best = new Map();
    for (let e = 0; e < D.E; e++) { const nm = D.names[D.enm[e]]; if (!nm || D.ec[e] > 5) continue; const b = best.get(nm); if (!b || D.elen[e] > D.elen[b]) best.set(nm, e); }
    streetIdx = [...best.entries()].map(([name, e]) => { const g = D.eg[e], m = (g.length / 2 | 0) & ~1; return { name, x: g[m], y: g[m + 1] }; }).sort((a, b) => a.name.localeCompare(b.name));
    return streetIdx;
  }

  /* ---------- routing (A*) ---------- */
  const SPEED = {
    car: [19, 13, 11, 9.5, 7, 4, 0, 0],          // m/s by road class
    bike: [0, 4.2, 4.6, 5, 5, 4.5, 3, 5.4],       // scooters prefer cycleways, slow on busy roads
    walk: [0, 0, 1.35, 1.35, 1.4, 1.4, 1.4, 1.3],
  };
  function route(ax, ay, bx, by, mode = 'car') {
    const s = nearestNode(ax, ay, mode), t = nearestNode(bx, by, mode);
    if (s < 0 || t < 0) return null;
    const sp = SPEED[mode], vmax = Math.max(...sp);
    const g = new Float64Array(D.N).fill(Infinity), prevE = new Int32Array(D.N).fill(-1), done = new Uint8Array(D.N);
    const heap = []; const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = n => Math.hypot(D.nx[n] - D.nx[t], D.ny[n] - D.ny[t]) / vmax;
    g[s] = 0; push(s, h(s));
    while (heap.length) {
      const [, n] = pop(); if (done[n]) continue; done[n] = 1; if (n === t) break;
      for (const e of D.adj[n]) {
        const c = D.ec[e], v = sp[c]; if (!v) continue;
        const fwd = D.eu[e] === n; const m = fwd ? D.ev[e] : D.eu[e];
        if (mode === 'car' && D.eow[e] && ((D.eow[e] === 1) !== fwd)) continue;
        const ng = g[n] + D.elen[e] / v + (mode === 'car' ? 2 : 0.5);
        if (ng < g[m]) { g[m] = ng; prevE[m] = e; push(m, ng + h(m)); }
      }
    }
    if (!isFinite(g[t])) return null;
    const pts = []; let n = t, len = 0; const names = [], byName = {}, steps = [];
    while (n !== s) {
      const e = prevE[n], geo = D.eg[e], fwd = D.ev[e] === n;
      const seg = [];
      for (let i = 0; i < geo.length; i += 2) seg.push([geo[i], geo[i + 1]]);
      if (fwd) seg.reverse();               // walking backwards from t
      for (let i = pts.length ? 1 : 0; i < seg.length; i++) pts.push(seg[i]);
      len += D.elen[e]; const nm = D.names[D.enm[e]]; if (nm && names[names.length - 1] !== nm) names.push(nm);
      if (nm) byName[nm] = (byName[nm] || 0) + D.elen[e];
      steps.push({ len: D.elen[e], geo: seg.length, name: nm || '', cls: D.ec[e], t: D.elen[e] / sp[D.ec[e]] + (mode === 'car' ? 2 : .5) });
      n = fwd ? D.eu[e] : D.ev[e];
    }
    pts.reverse(); names.reverse(); steps.reverse();
    // cumulative distance (along the drawn geometry) and time for each edge, so animations can follow real speeds
    const cum = measure(pts); let gi = 0, tt = 0;
    for (const st of steps) { st.d0 = cum[gi]; gi += st.geo - 1; st.d1 = cum[Math.min(gi, cum.length - 1)]; st.t0 = tt; tt += st.t; st.kmh = Math.round(sp[st.cls] * 3.6); }
    const via = Object.entries(byName).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    return { pts, cum, len, time: g[t], names, via, steps, from: s, to: t };
  }
  /* path helpers */
  function distAtTime(r, f) { const T = r.time * f; let lo = 0, hi = r.steps.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (r.steps[m].t0 <= T) lo = m; else hi = m - 1; } const st = r.steps[lo]; if (!st) return 0; const k = Math.max(0, Math.min(1, (T - st.t0) / st.t)); return st.d0 + (st.d1 - st.d0) * k; }
  function stepAt(r, d) { let lo = 0, hi = r.steps.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (r.steps[m].d0 <= d) lo = m; else hi = m - 1; } return lo; }
  function measure(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }
  function along(pts, cum, d) {
    if (d <= 0) return [pts[0][0], pts[0][1], Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])];
    const L = cum[cum.length - 1]; if (d >= L) { const n = pts.length; return [pts[n - 1][0], pts[n - 1][1], Math.atan2(pts[n - 1][1] - pts[n - 2][1], pts[n - 1][0] - pts[n - 2][0])]; }
    let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1), a = pts[lo], b = pts[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }

  /* ---------- themes ---------- */
  const THEMES = {
    day: { land: '#EEF1EE', water: '#C3DCE8', green: '#D4E7D5', bld: '#E2E6E2', bldLine: '#D6DBD7', rail: '#C3C9C5', aero: '#E3E6E3', runway: '#D4D8D5',
      road: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#F6F7F6', '#E3F0E7'], casing: ['#C9CFCB', '#CDD3CF', '#D3D8D4', '#D6DBD7', '#DADFDB', '#DDE1DE', '#E0E4E1', '#CFE5D6'],
      label: '#5C6660', labelHalo: '#EEF1EE' },
    night: { land: '#0C100F', water: '#08141B', green: '#0D1813', bld: '#141A18', bldLine: '#141A18', rail: '#1A2421', aero: '#121816', runway: '#1C2321',
      road: ['#3D4946', '#33403C', '#2A3431', '#242D2A', '#1A2220', '#171E1C', '#151B19', '#14231B'], casing: null,
      label: '#5F6B66', labelHalo: '#0C100F' },
  };
  const ROADW = [22, 17, 14, 12, 8, 6, 5, 3];          // metres
  const ROADMIN = [1.8, 1.4, 1.15, 1, .55, .45, .4, .4]; // px

  /* ---------- map view ---------- */
  function create(container, opt = {}) {
    let th = THEMES[opt.theme || 'day'];
    const base = document.createElement('canvas'), fx = document.createElement('canvas');
    const layer = document.createElement('div');
    for (const c of [base, fx]) { c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; }
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    container.append(base, fx, layer);
    const bctx = base.getContext('2d'), ctx = fx.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const cam = { x: opt.x ?? 0, y: opt.y ?? 0, s: opt.s ?? .1 };          // s = px per metre
    let dirty = true, anim = null, raf = 0, visible = true;
    const hooks = [], markers = [];
    const view = {
      cam, container, ctx, theme: th,
      w2s: (x, y) => [(x - cam.x) * cam.s + W / 2, (y - cam.y) * cam.s + H / 2],
      s2w: (sx, sy) => [(sx - W / 2) / cam.s + cam.x, (sy - H / 2) / cam.s + cam.y],
      get W() { return W; }, get H() { return H; },
    };

    function resize() {
      const r = container.getBoundingClientRect(); if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, opt.maxDpr || 2);
      W = r.width; H = r.height;
      for (const c of [base, fx]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      dirty = true; firstPaint = true;
    }

    /* ---------- tiled base layer ----------
       The map is rendered into 256px tiles at discrete zoom levels (√2 apart) and cached, like a real map client.
       Panning or following a car only renders the few tiles that come into view, within a per-frame time budget;
       missing tiles are covered by coarser cached ones until they are ready. */
    const TS = 256, LV = L => .03 * Math.pow(2, L / 2), MAXL = 14;
    const levelFor = s => Math.max(0, Math.min(MAXL, Math.ceil(Math.log2(s / .03) * 2 - 1e-6)));
    const cache = new Map(); let useTick = 0, firstPaint = true, cacheDpr = 0;
    const hit = (bb, q) => !(bb[2] < q[0] || bb[0] > q[2] || bb[3] < q[1] || bb[1] > q[3]);
    function renderTile(L, tx, ty) {
      const cv = document.createElement('canvas'); cv.width = cv.height = TS;
      const c = cv.getContext('2d'), s = LV(L) * dpr, TW = TS / s, x0 = tx * TW, y0 = ty * TW, sc = LV(L);
      const pad = Math.max(30, 8 * dpr / s), q = [x0 - pad, y0 - pad, x0 + TW + pad, y0 + TW + pad];
      c.fillStyle = th.land; c.fillRect(0, 0, TS, TS);
      c.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      const ring = r => { c.moveTo(r[0], r[1]); for (let k = 2; k < r.length; k += 2) c.lineTo(r[k], r[k + 1]); c.closePath(); };
      const polys = (rs, bbs, fill) => { c.beginPath(); let any = false; rs.forEach((r, i) => { if (hit(bbs[i], q)) { ring(r); any = true; } }); if (any) { c.fillStyle = fill; c.fill('evenodd'); } };
      polys(D.green, D.greenBB, th.green);
      c.beginPath(); for (const r of D.sea) ring(r); c.fillStyle = th.water; c.fill('nonzero');
      polys(D.isl, D.islBB, th.land); polys(D.water, D.waterBB, th.water);
      for (const [t, g, bb] of D.aero) { if (!hit(bb, q)) continue; c.beginPath(); c.moveTo(g[0], g[1]); for (let k = 2; k < g.length; k += 2) c.lineTo(g[k], g[k + 1]);
        if (t === 2) { c.closePath(); c.fillStyle = th.aero; c.fill(); } else { c.strokeStyle = th.runway; c.lineWidth = t === 0 ? 45 : 18; c.lineCap = 'butt'; c.stroke(); } }
      if (sc > .28) { c.beginPath(); D.bld.forEach((r, i) => { if (hit(D.bldBB[i], q)) ring(r); }); c.fillStyle = th.bld; c.fill();
        if (th.casing && sc > .6) { c.lineWidth = .8 * dpr / s; c.strokeStyle = th.bldLine; c.stroke(); } }
      c.lineCap = 'butt';
      for (const [t, g, bb] of D.rail) { if (!hit(bb, q)) continue; c.beginPath(); c.moveTo(g[0], g[1]); for (let k = 2; k < g.length; k += 2) c.lineTo(g[k], g[k + 1]); c.strokeStyle = th.rail; c.lineWidth = Math.max(1.2 * dpr / s, 3); c.setLineDash(t ? [] : [6 * dpr / s, 4 * dpr / s]); c.stroke(); }
      c.setLineDash([]);
      c.lineCap = 'round'; c.lineJoin = 'round';
      const cls = [7, 6, 5, 4, 3, 2, 1, 0], paths = cls.map(() => new Path2D());
      const skipMinor = opt.hideMinor && sc < .2;
      for (let e = 0; e < D.E; e++) { const k = D.ec[e]; if (skipMinor && k >= 6) continue;
        if (D.ebb[4 * e + 2] < q[0] || D.ebb[4 * e] > q[2] || D.ebb[4 * e + 3] < q[1] || D.ebb[4 * e + 1] > q[3]) continue;
        const p = paths[7 - k], g = D.eg[e]; p.moveTo(g[0], g[1]); for (let i = 2; i < g.length; i += 2) p.lineTo(g[i], g[i + 1]); }
      const wpx = k => Math.max(ROADMIN[k] * (opt.roadScale || 1), ROADW[k] * sc) * dpr / s;
      if (th.casing) cls.forEach((k, i) => { c.strokeStyle = th.casing[k]; c.lineWidth = wpx(k) + 2 * dpr / s * (k <= 3 ? 1.2 : .9); c.stroke(paths[i]); });
      cls.forEach((k, i) => { c.strokeStyle = th.road[k]; c.lineWidth = wpx(k); if (k === 7 && th.casing) c.setLineDash([4 * dpr / s, 3 * dpr / s]); c.stroke(paths[i]); c.setLineDash([]); });
      return cv;
    }
    const DIST = [['KALAMAJA', 59.4475, 24.7300], ['KESKLINN', 59.4300, 24.7560], ['KADRIORG', 59.4410, 24.7930], ['PIRITA', 59.4640, 24.8420], ['LASNAMÄE', 59.4320, 24.8350], ['MUSTAMÄE', 59.4040, 24.6900], ['KRISTIINE', 59.4210, 24.7120], ['HAABERSTI', 59.4250, 24.6500], ['NÕMME', 59.3880, 24.7050], ['PÕHJA-TALLINN', 59.4560, 24.7000], ['ÜLEMISTE', 59.4060, 24.7680]];
    // returns true while tiles are still missing (so the frame loop repaints)
    function paintBase(budget) {
      if (cacheDpr !== dpr) { cache.clear(); cacheDpr = dpr; }
      const L = levelFor(cam.s), c = bctx; useTick++;
      const sx = x => Math.round(((x - cam.x) * cam.s + W / 2) * dpr), sy = y => Math.round(((y - cam.y) * cam.s + H / 2) * dpr);
      const wx0 = cam.x - W / 2 / cam.s, wy0 = cam.y - H / 2 / cam.s, wx1 = cam.x + W / 2 / cam.s, wy1 = cam.y + H / 2 / cam.s;
      const range = l => { const TW = TS / (LV(l) * dpr); return [Math.floor(wx0 / TW), Math.floor(wy0 / TW), Math.floor(wx1 / TW), Math.floor(wy1 / TW), TW]; };
      c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.fillStyle = th.land; c.fillRect(0, 0, base.width, base.height);
      const [a0, b0, a1, b1, TW] = range(L), missing = [];
      const t0 = performance.now();
      const todo = [];
      for (let ty = b0; ty <= b1; ty++) for (let tx = a0; tx <= a1; tx++) { const key = `${L}/${tx}/${ty}`; const t = cache.get(key); if (t) t.u = useTick; else todo.push([tx, ty, (tx + .5 - (a0 + a1 + 1) / 2) ** 2 + (ty + .5 - (b0 + b1 + 1) / 2) ** 2]); }
      todo.sort((p, q) => p[2] - q[2]);
      for (const [tx, ty] of todo) { if (performance.now() - t0 > budget) { missing.push([tx, ty]); continue; } cache.set(`${L}/${tx}/${ty}`, { cv: renderTile(L, tx, ty), u: useTick }); view.stats.tiles++; }
      if (missing.length) {   // cover the gaps with coarser (then finer) cached tiles, clipped to the gaps
        c.save(); c.beginPath(); for (const [tx, ty] of missing) { const X0 = sx(tx * TW), Y0 = sy(ty * TW); c.rect(X0, Y0, sx((tx + 1) * TW) - X0, sy((ty + 1) * TW) - Y0); } c.clip();
        for (const fl of [L - 4, L - 3, L - 2, L - 1, L + 1]) { if (fl < 0 || fl > MAXL) continue; const [f0, g0, f1, g1, FW] = range(fl);
          for (let ty = g0; ty <= g1; ty++) for (let tx = f0; tx <= f1; tx++) { const t = cache.get(`${fl}/${tx}/${ty}`); if (!t) continue; t.u = useTick; const X0 = sx(tx * FW), Y0 = sy(ty * FW); c.drawImage(t.cv, X0, Y0, sx((tx + 1) * FW) - X0, sy((ty + 1) * FW) - Y0); } }
        c.restore();
      }
      for (let ty = b0; ty <= b1; ty++) for (let tx = a0; tx <= a1; tx++) { const t = cache.get(`${L}/${tx}/${ty}`); if (!t) continue; const X0 = sx(tx * TW), Y0 = sy(ty * TW); c.drawImage(t.cv, X0, Y0, sx((tx + 1) * TW) - X0, sy((ty + 1) * TW) - Y0); }
      // evict least recently used tiles
      if (cache.size > 280) { const old = [...cache.entries()].sort((p, q) => p[1].u - q[1].u).slice(0, cache.size - 220); for (const [k] of old) cache.delete(k); }
      // district labels in screen space (so they never break across tiles)
      if (opt.districts !== false && cam.s < .55) {
        c.font = `600 ${11 * dpr}px Inter, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 3 * dpr;
        for (const [n, la, lo] of DIST) { const [x, y] = proj(la, lo), t = n.split('').join(String.fromCharCode(8202)); const X = sx(x), Y = sy(y); if (X < -200 || Y < -50 || X > base.width + 200 || Y > base.height + 50) continue;
          c.strokeStyle = th.labelHalo; c.strokeText(t, X, Y); c.fillStyle = th.label; c.fillText(t, X, Y); }
      }
      return missing.length > 0;
    }
    let lastMove = 0, lastPaint = '', pending = false;
    view.stats = { tiles: 0, frames: 0, get renders() { return this.tiles; }, renderMs: 0 };
    function frame(now) {
      raf = visible ? requestAnimationFrame(frame) : 0;   // schedule first, so kick() inside hooks never starts a second loop
      if (!W) return;
      if (anim) { const k = Math.min(1, (now - anim.t0) / anim.dur), e = anim.ease(k);
        // zoom out-and-in arc (like a camera flight)
        const s = anim.s0 * Math.pow(anim.s1 / anim.s0, e), arc = anim.arc ? 1 - Math.sin(Math.PI * k) * anim.arc : 1;
        cam.s = s * arc; cam.x = anim.x0 + (anim.x1 - anim.x0) * e; cam.y = anim.y0 + (anim.y1 - anim.y0) * e;
        lastMove = now; if (k >= 1) { const done = anim.done; anim = null; done && done(); } }
      const key = `${cam.x},${cam.y},${cam.s},${W},${H},${dirty}`;
      if (key !== lastPaint || pending) { const t = performance.now(); pending = paintBase(firstPaint ? 400 : 9); view.stats.renderMs = performance.now() - t; lastPaint = key; firstPaint = false; dirty = false; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      for (const h of hooks) h(ctx, now, view);
      for (const m of markers) { const [sx, sy] = view.w2s(m.x, m.y); m.el.style.transform = `translate(${sx}px,${sy}px)`; m.el.style.display = (sx < -200 || sy < -200 || sx > W + 200 || sy > H + 200) ? 'none' : '';
        // keep a marker's label inside the map instead of letting it run off the edge
        if (m.clamp) { const b = m.el.querySelector(m.clamp); if (b) { const hw = b.offsetWidth / 2, sh = Math.max(8 + hw, Math.min(W - 8 - hw, sx)) - sx; b.style.translate = sh ? `${Math.round(sh)}px 0` : ''; } } }
      view.stats.frames++;
    }
    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };

    /* camera */
    view.setView = (x, y, s) => { cam.x = x; cam.y = y; if (s) cam.s = s; dirty = true; kick(); };
    view.fit = (x0, y0, x1, y1, pad = 60, instant) => {
      const pl = typeof pad === 'object' ? pad : { l: pad, r: pad, t: pad, b: pad };
      const s = Math.min((W - pl.l - pl.r) / Math.max(50, x1 - x0), (H - pl.t - pl.b) / Math.max(50, y1 - y0));
      const cx = (x0 + x1) / 2 - (pl.l - pl.r) / 2 / s, cy = (y0 + y1) / 2 - (pl.t - pl.b) / 2 / s;
      return { x: cx, y: cy, s: Math.min(s, opt.maxZoom || 3) };
    };
    view.flyTo = (t, dur = 1400, arc = .35) => new Promise(res => {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { dur = Math.min(dur, 350); arc = 0; }
      anim = { t0: performance.now(), dur, x0: cam.x, y0: cam.y, s0: cam.s, x1: t.x, y1: t.y, s1: t.s, arc, done: res,
        ease: k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2 };
      kick();
    });
    view.onFrame = fn => { hooks.push(fn); kick(); };
    view.follow = (x, y, s) => { cam.x = x; cam.y = y; if (s) cam.s = s; anim = null; lastMove = performance.now(); kick(); };
    view.stop = () => { anim = null; };
    view.marker = (el, x, y, o = {}) => { el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.pointerEvents = o.events === false ? 'none' : 'auto'; layer.appendChild(el); const m = { el, x, y, clamp: o.clamp }; markers.push(m); kick(); return m; };
    view.removeMarker = m => { m.el.remove(); const i = markers.indexOf(m); if (i >= 0) markers.splice(i, 1); };
    view.redraw = () => { dirty = true; kick(); };
    view.setTheme = name => { th = THEMES[name]; view.theme = th; cache.clear(); firstPaint = true; dirty = true; kick(); };

    /* interaction: drag to pan, wheel/pinch to zoom, tap */
    let dragging = false; const ptrs = new Map(); let start = null, pinch0 = null, moved = 0;
    const clampS = s => Math.max(opt.minZoom || .05, Math.min(opt.maxZoom || 3, s));
    if (opt.interactive !== false) {
      fx.style.touchAction = 'pan-y';
      fx.style.cursor = 'grab';
      fx.addEventListener('pointerdown', e => {
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (e.pointerType !== 'touch' || ptrs.size >= 2) { try { fx.setPointerCapture(e.pointerId); } catch (_) {} }
        moved = 0; start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cy: cam.y }; }
        anim = null;
      });
      fx.addEventListener('pointermove', e => {
        if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          cam.s = clampS(pinch0.s * d / pinch0.d); cam.x = pinch0.cx - (mx - pinch0.mx) / cam.s; cam.y = pinch0.cy - (my - pinch0.my) / cam.s; dragging = true; moved = 99; lastMove = performance.now(); kick(); return; }
        if (e.pointerType === 'touch') return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y; moved = Math.max(moved, Math.hypot(dx, dy));
        if (moved > 4) { dragging = true; fx.style.cursor = 'grabbing'; cam.x = start.cx - dx / cam.s; cam.y = start.cy - dy / cam.s; lastMove = performance.now(); kick(); }
      });
      const up = e => {
        const was = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
        if (was && moved <= 4 && e.type === 'pointerup' && opt.onTap) { const r = fx.getBoundingClientRect(); const [wx, wy] = view.s2w(e.clientX - r.left, e.clientY - r.top); opt.onTap(wx, wy, e); }
        if (!ptrs.size) { dragging = false; fx.style.cursor = 'grab'; lastMove = performance.now(); kick(); }
      };
      fx.addEventListener('pointerup', up); fx.addEventListener('pointercancel', up);
      if (opt.wheel !== false) fx.addEventListener('wheel', e => {
        e.preventDefault(); const r = fx.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
        const [wx, wy] = view.s2w(mx, my); cam.s = clampS(cam.s * Math.exp(-e.deltaY * .0015));
        cam.x = wx - (mx - W / 2) / cam.s; cam.y = wy - (my - H / 2) / cam.s; anim = null; lastMove = performance.now(); kick();
      }, { passive: false });
    }
    view.zoomBy = f => view.flyTo({ x: cam.x, y: cam.y, s: clampS(cam.s * f) }, 380, 0);

    new ResizeObserver(() => { resize(); kick(); }).observe(container);
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) kick(); }).observe(container);
    resize();
    return view;
  }

  /* ---------- traffic agents that drive the real street graph ---------- */
  function agents(view, n, o = {}) {
    const mode = o.mode || 'car', ok = MODE_OK[mode], list = [];
    const near = o.area ? (e => { const g = D.eg[e]; return Math.hypot(g[0] - o.area.x, g[1] - o.area.y) < o.area.r; }) : () => true;
    const pool = []; for (let e = 0; e < D.E; e++) if (ok(D.ec[e]) && (o.classes ? o.classes.includes(D.ec[e]) : true) && near(e)) pool.push(e);
    const weightOf = e => (o.major ? [6, 5, 3.5, 2.5, 1, .6, .4, .4][D.ec[e]] : 1);
    function spawn(a) {
      a.e = pool[Math.random() * pool.length | 0]; a.dir = Math.random() < .5 ? 1 : -1;
      if (mode === 'car' && D.eow[a.e]) a.dir = D.eow[a.e];
      a.d = Math.random() * D.elen[a.e]; a.cum = null; return a;
    }
    const seg = a => { if (a.cum && a.ce === a.e) return; const g = D.eg[a.e]; const pts = []; for (let i = 0; i < g.length; i += 2) pts.push([g[i], g[i + 1]]); if (a.dir < 0) pts.reverse(); a.pts = pts; a.cum = measure(pts); a.ce = a.e; };
    function next(a) {
      const at = a.dir > 0 ? D.ev[a.e] : D.eu[a.e];
      const opts = D.adj[at].filter(e => e !== a.e && ok(D.ec[e]) && !(mode === 'car' && D.eow[e] && ((D.eow[e] === 1) !== (D.eu[e] === at))) && (!o.area || near(e)));
      if (!opts.length) { a.dir = -a.dir; a.d = 0; a.cum = null; return; }
      let tot = 0; for (const e of opts) tot += weightOf(e); let r = Math.random() * tot, pick = opts[0];
      for (const e of opts) { r -= weightOf(e); if (r <= 0) { pick = e; break; } }
      a.e = pick; a.dir = D.eu[pick] === at ? 1 : -1; a.d = 0; a.cum = null;
    }
    for (let i = 0; i < n; i++) list.push(spawn({ v: (o.speed || 10) * (.7 + Math.random() * .6), kind: o.kind?.(i) ?? 0, id: i }));
    let t0 = performance.now();
    const api = {
      list,
      step(now, frozen) {
        const dt = frozen ? 0 : Math.min(.05, (now - t0) / 1000) * (o.timeScale || 1); t0 = now;
        for (const a of list) {
          if (a.hold) continue;
          a.d += a.v * dt;
          while (a.d > D.elen[a.e]) { a.d -= D.elen[a.e]; next(a); }
          seg(a); const p = along(a.pts, a.cum, a.d * (a.cum[a.cum.length - 1] / D.elen[a.e])); a.x = p[0]; a.y = p[1]; a.h = p[2];
          if (o.tail) { const q = along(a.pts, a.cum, Math.max(0, a.d * (a.cum[a.cum.length - 1] / D.elen[a.e]) - o.tail)); a.tx = q[0]; a.ty = q[1]; }
        }
      },
    };
    return api;
  }

  /* car sprite drawn in screen space */
  function drawCar(ctx, sx, sy, h, sc = 1, body = '#fff', glow, win = '#1D2522') {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(h + Math.PI / 2); ctx.scale(sc, sc);
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 12; }
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.roundRect(-5.5, -9, 11, 19, 4); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = body; ctx.strokeStyle = 'rgba(14,16,16,.55)'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.roundRect(-5, -9.5, 10, 18, 3.6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = win; ctx.beginPath(); ctx.roundRect(-3.9, -5.2, 7.8, 3.6, 1.2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-3.6, 3.2, 7.2, 2.6, 1); ctx.fill();
    ctx.restore();
  }

  return { load, create, route, agents, measure, along, distAtTime, stepAt, drawCar, nearestNode, streetAt, streets, proj, get data() { return D; } };
})();
