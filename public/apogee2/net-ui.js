// APOGEE: Halo network tab (tycoon dashboard). DOM only; logic lives in net-sim.js (window.APOGEE_NET).
(function () {
  'use strict';
  const NET = () => window.APOGEE_NET || null;

  // ---------- small helpers ----------
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (d || 0));
  const fmtInt = (n) => {
    n = Math.round(num(n));
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e4) return Math.round(n / 1e3) + 'k';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  };
  const pctTxt = (p) => `${Math.round(num(p) * 100)}%`;
  const asList = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).map((k) => Object.assign({ id: k }, x[k])) : []);
  const findIn = (list, id) => asList(list).find((g) => g.id === id) || (typeof id === 'number' ? asList(list)[id] : null);
  const usd = (v) => { v = num(v); return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`; };
  // $M with a $k fallback so small daily numbers do not read as $0.0M.
  const mny = (m) => { m = num(m); return Math.abs(m) > 0 && Math.abs(m) < 0.1 ? `${m < 0 ? '−' : ''}$${Math.round(Math.abs(m) * 1000)}k` : G.money(m); };
  const pick = (o, keys, d) => { if (o) for (const k of keys) if (o[k] != null) return o[k]; return d; };

  const REGION_ICONS = { na: '🗽', sa: '🌎', eu: '🏰', af: '🌍', me: '🕌', sas: '🛕', as: '🛕', ea: '🏯', oc: '🦘' };
  const TIER_ICONS = { home: '🏠', business: '🏢', maritime: '🚢', aviation: '✈️', gov: '🏛️' };

  // Rough lon/lat outlines for the map (equirectangular). Matched to regions by id or name.
  const SHAPES = [
    { key: /north|^na$/i, icon: '🗽', lab: [-100, 45], poly: [[-165, 68], [-140, 70], [-95, 72], [-62, 62], [-55, 50], [-70, 42], [-80, 26], [-97, 18], [-88, 15], [-80, 8], [-105, 20], [-117, 32], [-125, 42], [-125, 50], [-150, 58], [-165, 62]] },
    { key: /south am|^sa$/i, icon: '🌎', lab: [-60, -14], poly: [[-80, 8], [-60, 11], [-50, 0], [-35, -6], [-40, -22], [-55, -35], [-66, -55], [-74, -50], [-72, -30], [-81, -5]] },
    { key: /europe|^eu$/i, icon: '🏰', lab: [15, 52], poly: [[-10, 36], [-10, 44], [-5, 48], [-8, 58], [5, 62], [15, 70], [30, 70], [40, 66], [40, 45], [28, 41], [20, 38], [12, 38], [3, 42]] },
    { key: /africa|^af$/i, icon: '🌍', lab: [20, 4], poly: [[-17, 21], [-6, 35], [10, 37], [32, 31], [35, 25], [43, 12], [51, 11], [40, -15], [35, -25], [20, -35], [12, -18], [9, 4], [-8, 4], [-17, 14]] },
    { key: /middle|^me$/i, icon: '🕌', lab: [46, 28], poly: [[35, 33], [36, 37], [44, 38], [50, 37], [62, 34], [60, 25], [56, 22], [52, 16], [43, 12], [35, 25]] },
    { key: /south as|^sas$|^as$/i, icon: '🛕', lab: [78, 22], poly: [[62, 34], [66, 25], [73, 20], [77, 8], [81, 7], [87, 22], [92, 22], [97, 28], [80, 36], [70, 37]] },
    { key: /east as|^ea$/i, icon: '🏯', lab: [112, 36], poly: [[80, 36], [97, 28], [100, 12], [105, 2], [110, 10], [109, 20], [122, 30], [122, 40], [131, 34], [142, 40], [142, 46], [135, 55], [140, 60], [160, 62], [180, 66], [180, 72], [100, 76], [70, 72], [60, 62], [55, 50], [70, 45]] },
    { key: /ocean|^oc$/i, icon: '🦘', lab: [134, -24], poly: [[114, -22], [122, -17], [131, -11], [142, -11], [146, -19], [153, -26], [151, -34], [146, -39], [138, -35], [129, -32], [115, -34], [113, -26]] },
  ];
  const shapeFor = (r) => SHAPES.find((s) => s.key.test(r.id || '') || s.key.test(r.name || ''));

  // ---------- module state ----------
  let G = null;
  let root = null;          // tab element we built into
  let built = '';           // skeleton key ('pitch' | 'main')
  const cache = {};         // panel html cache
  let globe = null, globeCanvas = null;
  let busy = false, pending = false;
  let batchN = 0;
  let selRegion = null;
  const daily = [];         // in-memory day samples for trend arrows

  function hide() {
    if (globe) { try { globe.dispose(); } catch (e) { /* ignore */ } }
    if (globeCanvas && globeCanvas.parentNode) globeCanvas.remove(); // a disposed canvas shows as a blank white box: take it out
    globe = null; globeCanvas = null;
  }

  function mountGlobe(sm) {
    const GL = window.APOGEE_NETGLOBE;
    const slot = root && root.querySelector('.globe-slot');
    if (!slot) return;
    if (!GL || !GL.mount) { slot.classList.add('noglobe'); return; }
    for (const c of slot.querySelectorAll('canvas')) if (c !== globeCanvas) c.remove(); // drop stale (lost) canvases
    if (globe && (!globeCanvas || !globeCanvas.isConnected) && globeCanvas) slot.appendChild(globeCanvas);
    if (!globe) {
      globeCanvas = document.createElement('canvas');
      globeCanvas.className = 'net-globe';
      slot.appendChild(globeCanvas);
      try { globe = GL.mount(globeCanvas); } catch (e) { console.warn('Halo globe failed', e); globe = null; }
    }
    if (globe && globe.update && sm) { try { globe.update(sm); } catch (e) { /* ignore */ } }
  }

  function setPanel(name, html) {
    const node = root.querySelector(`[data-p="${name}"]`);
    if (!node) return;
    if (cache[name] === html && node.childElementCount + node.textContent.length > 0) return;
    cache[name] = html;
    node.innerHTML = html;
  }

  // ---------- main render ----------
  function render(el, g) {
    G = g;
    const N = NET();
    if (!N) { el.innerHTML = '<div class="empty">🛰️ The Halo network module is still loading. Reload the page if this stays.</div>'; built = ''; root = null; return; }
    const st = G.state;
    if (busy) { pending = true; return; }
    let sm = null;
    try { sm = N.summary(st); } catch (e) { sm = null; }
    const founded = !!(st.net && sm && sm.founded !== false);
    const key = founded ? 'main' : 'pitch';
    if (root !== el || built !== key || !el.querySelector('.net')) {
      hide();
      root = el; built = key;
      for (const k in cache) delete cache[k];
      el.innerHTML = founded ? skeletonMain() : skeletonPitch();
      bind(el);
    }
    if (founded) renderMain(sm); else renderPitch(sm);
    mountGlobe(sm || { founded: false, sats: { orbit: 0 }, coverage: 0, regions: [] });
  }

  function bind(el) {
    if (el._netBound) return;
    el._netBound = true;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button,[data-n]')) busy = true; });
    const release = () => { if (!busy) return; setTimeout(() => { busy = false; if (pending) { pending = false; again(); } }, 60); };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    el.addEventListener('click', onClick);
  }
  function again() { if (G && root && G.tab === 'network') render(root, G); }

  function hero(title, sub) {
    return `<div class="hero net-hero"><div class="globe-slot"></div><div class="over"><h3 data-p="hero-t">${title}</h3><div class="small dim" data-p="hero-s">${sub}</div></div></div>`;
  }

  // ---------- pitch (before founding) ----------
  function skeletonPitch() {
    return `<div class="net">${hero('🛰️ Halo internet', 'Your own satellite internet company')}<div data-p="pitch"></div></div>`;
  }
  function renderPitch() {
    const N = NET(), st = G.state;
    let can = { ok: false, why: '' };
    try { can = N.canFound(st) || can; } catch (e) { /* ignore */ }
    const gens = asList(N.GENS);
    const g0 = gens[0];
    const cost = pick(N, ['FOUND_COST', 'foundCost'], 15);
    let html = `<div class="cols"><div><div class="card net-pitch"><h3>Build the internet in the sky</h3>
      <p class="small">Launch your own constellation of <b>Halo sats</b> and sell fast internet anywhere on Earth: homes, businesses, ships and planes. Every satellite you fly with your own rockets turns into monthly income.</p>
      <ul class="net-steps small">
        <li>🏭 Build Halo sats in your sat factory</li>
        <li>🚀 Launch them in batches on your rockets</li>
        <li>📡 Buy landing rights and ground stations per region</li>
        <li>💵 Set prices, market, and watch subscribers grow</li>
        <li>📈 Grow to millions of users, then take Halo public (IPO)</li>
      </ul>
      ${g0 ? `<div class="kv"><div><small>First sat</small><b>${esc(g0.name || 'Halo V1')}</b></div><div><small>Mass</small><b>${G.tons ? G.tons(num(g0.mass)) : num(g0.mass) + ' t'}</b></div><div><small>Build cost</small><b>${G.money(num(g0.cost))}</b></div><div><small>Speed</small><b>${num(pick(g0, ['gbps', 'bandwidth'], 0))} Gbps</b></div></div>` : ''}
      <div class="btns"><button class="btn primary big" data-n="found" ${can.ok ? '' : 'disabled'}>🛰️ Found Halo · ${G.money(num(cost, 15))}</button></div>
      ${can.ok ? '<p class="small good">✓ Ready. Contracts keep paying on the side.</p>' : `<p class="small bad">🔒 ${G.esc(can.why || 'Not available yet.')}</p>`}
      </div></div><div><h2>Why do it</h2><div class="card small"><p>Launch contracts pay once. A network pays <b>every day</b>.</p><p class="dim">Expect a few lean months while the first few hundred sats go up, then Halo should out-earn your contracts many times over and fund the Mars plan.</p></div></div></div>`;
    setPanel('pitch', html);
  }
  const esc = (s) => (G ? G.esc(s) : String(s));

  // ---------- main dashboard ----------
  function skeletonMain() {
    return `<div class="net">${hero('🛰️ Halo', '')}
      <div class="net-kpis" data-p="kpi"></div>
      <div class="net-alerts" data-p="alerts"></div>
      <div class="net-cols">
        <div>
          <h2>🌍 World</h2><div class="card"><canvas class="net-map" data-c="map"></canvas><div class="small dim net-legend">Shade = coverage. 📡 ground stations · ✅ licensed · ⏳ waiting for approval · 🔒 no license. Tap a region.</div><div data-p="regions"></div></div>
          <h2>🛰️ Constellation</h2><div data-p="const"></div>
          <h2>💵 Plans &amp; pricing</h2><div data-p="pricing"></div>
        </div>
        <div>
          <h2>📈 Growth</h2><div class="card net-charts"><div><div class="small dim">Subscribers</div><canvas data-c="subs"></canvas></div><div><div class="small dim">Monthly profit</div><canvas data-c="profit"></canvas></div></div>
          <h2>🔧 Hardware</h2><div data-p="hw"></div>
          <h2>📣 Marketing &amp; support</h2><div data-p="mkt"></div>
          <h2>🤝 Deals</h2><div data-p="deals"></div>
          <h2>🏆 Goals</h2><div data-p="goals"></div>
          <h2>🔔 IPO</h2><div data-p="ipo"></div>
          <h2>📰 Network news</h2><div data-p="news"></div>
        </div>
      </div></div>`;
  }

  function sample(sm) {
    const d = G.state.day;
    const last = daily[daily.length - 1];
    const row = { day: d, subs: num(sm.subs), rev: num(sm.revenueDay), profit: num(sm.profitMonth), sats: num(sm.sats && sm.sats.orbit), cov: num(sm.coverage), sat: num(sm.satisfaction) };
    if (last && last.day === d) daily[daily.length - 1] = row;
    else { if (last && d < last.day) daily.length = 0; daily.push(row); }
    if (daily.length > 120) daily.shift();
  }
  function prevSample(sm) {
    const d = G.state.day;
    // Compare with about a month ago (or the oldest sample we have, if at least a week old).
    for (let i = daily.length - 1; i >= 0; i--) if (daily[i].day <= d - 30) return daily[i];
    if (daily[0] && daily[0].day <= d - 7) return daily[0];
    const h = sm.history || [];
    const p = h.length > 1 ? h[h.length - 2] : h[0];
    if (p) return { subs: num(p.subs), rev: null, profit: num(p.profit), sats: num(p.sats), cov: num(p.coverage), sat: null };
    return daily[0] && daily[0].day < d ? daily[0] : null;
  }
  function trend(now, before, goodUp) {
    if (before == null || !isFinite(before)) return '<span class="tr dim">▬ new</span>';
    const diff = now - before;
    const tol = Math.max(1e-6, Math.abs(before) * 0.005);
    if (Math.abs(diff) <= tol) return '<span class="tr dim">▬ flat</span>';
    const up = diff > 0;
    const good = goodUp === false ? !up : up;
    const rel = before !== 0 ? `${up ? '+' : '−'}${Math.min(999, Math.round(Math.abs(diff / before) * 100))}%` : up ? 'up' : 'down';
    return `<span class="tr ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${rel}</span>`;
  }

  function renderMain(sm) {
    const N = NET(), st = G.state, net = st.net || {};
    sample(sm);
    const pv = prevSample(sm);
    const sats = sm.sats || {};
    const gen = sm.genInfo || (N.GENS && N.GENS[sm.gen]) || {};

    setPanel('hero-t', `🛰️ Halo · ${fmtInt(sats.orbit)} sats in orbit`);
    setPanel('hero-s', `${esc(gen.name || '')} · ${pctTxt(sm.coverage)} of Earth covered · ${fmtInt(sm.subs)} subscribers`);

    // KPIs
    const sat = num(sm.satisfaction);
    const satTxt = sat >= 0.75 ? '😀 happy' : sat >= 0.5 ? '😐 okay' : '😠 unhappy';
    const kpis = [
      ['👥', 'Subscribers', fmtInt(sm.subs), trend(num(sm.subs), pv && pv.subs, true)],
      ['💵', 'Revenue / day', mny(sm.revenueDay), trend(num(sm.revenueDay), pv && pv.rev, true)],
      ['📊', 'Profit / month', `<span class="${num(sm.profitMonth) >= 0 ? 'good' : 'bad'}">${num(sm.profitMonth) >= 0 ? '' : '⚠ '}${mny(sm.profitMonth)}</span>`, trend(num(sm.profitMonth), pv && pv.profit, true)],
      ['🛰️', 'Sats in orbit', fmtInt(sats.orbit), trend(num(sats.orbit), pv && pv.sats, true)],
      ['🌐', 'Coverage', pctTxt(sm.coverage), trend(num(sm.coverage), pv && pv.cov, true)],
      ['⭐', 'Satisfaction', `${pctTxt(sat)} <small class="dim">${satTxt}</small>`, trend(sat, pv && pv.sat, true)],
    ];
    setPanel('kpi', kpis.map(([ic, k, v, t]) => `<div class="kpi"><small>${ic} ${k}</small><b>${v}</b>${t}</div>`).join(''));

    // Alerts
    const al = [];
    if (num(sm.profitMonth) < 0) al.push(['bad', '⚠️', `Halo is losing ${mny(-num(sm.profitMonth))} a month. More sats, coverage and customers fix that.`]);
    if (num(sats.aging) > 0) al.push(['acc', '⏳', `${fmtInt(sats.aging)} sats are near end of life and will deorbit soon. Launch replacements.`]);
    const used = num(sm.usedGbps), cap = num(sm.capacityGbps);
    if (cap > 0 && used / cap > 0.9) al.push(['bad', '🚦', `Network is congested (${Math.round(used / cap * 100)}% used, ${num(sm.speedMbps).toFixed(0)} Mbps per user). Launch more sats or raise prices.`]);
    if (sm.outage) al.push(['bad', '🔌', 'Network outage! Customers are offline until it is fixed.']);
    if (num(sm.stationsTotal) < 1 && !(sm.lasers)) al.push(['acc', '📡', 'No ground stations yet. Build one in a licensed region (North America is licensed) to start selling.']);
    if (num(sats.orbit) < 1) al.push(['acc', '🚀', 'No sats in orbit yet. Build a batch and launch it to start service.']);
    setPanel('alerts', al.map(([c, ic, t]) => `<div class="card net-alert ${c}"><span>${ic}</span><span class="small">${t}</span></div>`).join(''));

    renderRegions(sm);
    renderConst(sm, gen);
    renderHardware(sm, gen);
    renderPricing(sm);
    renderMkt(sm);
    renderDeals(sm);
    renderGoals(sm);
    renderIpo(sm);
    const ev = (sm.events || []).slice(0, 8);
    setPanel('news', `<div class="card log">${ev.length ? ev.map((t) => `<div>${typeof t === 'string' ? t : esc(t.text || '')}</div>`).join('') : '<div>No news yet.</div>'}</div>`);

    drawMap(sm);
    const h = (sm.history || []).slice(-60);
    drawLine(root.querySelector('[data-c=subs]'), h.map((p) => num(p.subs)), (v) => fmtInt(v), '#5aa9ff');
    drawLine(root.querySelector('[data-c=profit]'), h.map((p) => num(p.profit)), (v) => G.money(v), '#3ddc97', true);
  }

  // ----- regions -----
  function renderRegions(sm) {
    const regs = sm.regions || [];
    if (!selRegion && regs[0]) selRegion = regs[0].id;
    const st = G.state;
    let html = '<div class="net-regions">';
    for (const r of regs) {
      const lic = r.licensed ? '<span class="pill good">✅ Licensed</span>' : r.licensePending ? `<span class="pill acc">⏳ License in ${num(r.licenseDays)} d</span>` : '<span class="pill bad">🔒 No license</span>';
      const stn = num(r.stations), bld = num(r.stationsBuilding);
      const sel = r.id === selRegion;
      const sh = shapeFor(r);
      const status = r.selling ? '<span class="small good">● Selling</span>' : `<span class="small dim">○ ${esc(r.why || 'Not selling')}</span>`;
      html += `<div class="net-reg ${sel ? 'sel' : ''}" data-n="sel-region" data-id="${esc(r.id)}">
        <div class="net-reg-h"><b>${r.icon || (sh && sh.icon) || '🌐'} ${esc(r.name)}</b>${lic}<span class="pill ${stn ? 'blue' : ''}">📡 ${stn}${bld ? ` +${bld}🏗️` : ''}</span></div>
        <div class="net-reg-b small"><span>Coverage <b>${pctTxt(r.coverage)}</b></span><span>Subs <b>${fmtInt(r.subs)}</b> <span class="dim">/ ${fmtInt(r.potential)} homes</span></span>${num(r.waitlist) > 0 ? `<span class="acc">⏳ Waitlist ${fmtInt(r.waitlist)}</span>` : ''}</div>
        <div class="bar good"><i style="width:${Math.min(100, num(r.coverage) * 100)}%"></i></div>
        ${sel ? `<div style="margin-top:6px">${status}</div><div class="btns">${r.licensed || r.licensePending ? '' : `<button class="btn primary sm" data-n="license" data-id="${esc(r.id)}" ${st.cash < num(r.licenseCost) ? 'disabled' : ''}>📝 Apply for license · ${G.money(num(r.licenseCost))} · ${num(r.licenseTime)} d</button>`}
          <button class="btn sm ${(r.licensed || r.licensePending) && !stn && !bld ? 'primary' : ''}" data-n="station" data-id="${esc(r.id)}" ${(r.licensed || r.licensePending) && st.cash >= num(r.stationCost) ? '' : 'disabled'}>📡 + Ground station · ${G.money(num(r.stationCost))}</button></div>
          ${!r.licensed && !r.licensePending ? '<div class="small dim">Apply for a license first, then build at least one ground station to sell here.</div>' : ''}` : ''}
      </div>`;
    }
    html += '</div>';
    setPanel('regions', html);
  }

  function drawMap(sm) {
    const cv = root.querySelector('[data-c=map]');
    if (!cv) return;
    const w = cv.clientWidth || 600, h = Math.round(w * 0.5);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.height = h + 'px';
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const X = (lon) => (lon + 180) / 360 * w;
    const Y = (lat) => (78 - lat) / 140 * h; // show lat 78..-62
    g.fillStyle = '#0b1830'; g.fillRect(0, 0, w, h);
    // grid
    g.strokeStyle = 'rgba(120,150,210,.10)'; g.lineWidth = 1;
    for (let lon = -150; lon <= 150; lon += 30) { g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), h); g.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(w, Y(lat)); g.stroke(); }
    // coverage band (global coverage shown as a latitude band)
    const cov = num(sm.coverage);
    if (cov > 0) {
      const band = Math.min(78, 20 + cov * 60);
      g.fillStyle = 'rgba(90,169,255,.07)';
      g.fillRect(0, Y(band), w, Y(-band) - Y(band));
    }
    const fs = Math.max(10, Math.min(13, w / 60));
    for (const r of sm.regions || []) {
      const sh = shapeFor(r);
      if (!sh) continue;
      const c = num(r.coverage);
      const on = r.licensed && num(r.stations) > 0;
      g.beginPath();
      sh.poly.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la))));
      g.closePath();
      g.fillStyle = '#1f2a42'; g.fill();
      g.fillStyle = on ? `rgba(61,220,151,${0.12 + c * 0.7})` : `rgba(90,169,255,${0.06 + c * 0.35})`;
      g.fill();
      if (!r.licensed) { // hatch: not licensed
        g.save(); g.clip();
        g.strokeStyle = 'rgba(255,93,108,.35)'; g.lineWidth = 1;
        for (let x = -h; x < w; x += 7) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
        g.restore();
      }
      g.lineWidth = r.id === selRegion ? 2.5 : 1;
      g.strokeStyle = r.id === selRegion ? '#ffb347' : 'rgba(200,215,245,.35)';
      g.stroke();
      // label
      const lx = X(sh.lab[0]), ly = Y(sh.lab[1]);
      const st = r.licensed ? '✅' : r.licensePending ? '⏳' : '🔒';
      const l1 = `${sh.icon} ${pctTxt(c)}`;
      const l2 = `${st} 📡${num(r.stations)}`;
      g.font = `700 ${fs}px -apple-system, Segoe UI, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const bw = Math.max(g.measureText(l1).width, g.measureText(l2).width) + 10;
      g.fillStyle = 'rgba(8,12,22,.72)';
      roundRect(g, lx - bw / 2, ly - fs * 1.2, bw, fs * 2.5, 6); g.fill();
      g.fillStyle = '#e9ecf4'; g.fillText(l1, lx, ly - fs * 0.35);
      g.font = `600 ${fs - 1}px -apple-system, Segoe UI, sans-serif`;
      g.fillStyle = '#c9d1e6'; g.fillText(l2, lx, ly + fs * 0.75);
    }
    cv._regions = (sm.regions || []).map((r) => ({ id: r.id, sh: shapeFor(r) })).filter((x) => x.sh);
    cv._xy = { X, Y };
    if (!cv._bound) {
      cv._bound = true;
      cv.addEventListener('click', (e) => {
        const b = cv.getBoundingClientRect();
        const px = e.clientX - b.left, py = e.clientY - b.top;
        const gg = cv.getContext('2d');
        for (const rr of cv._regions || []) {
          gg.save(); gg.setTransform(1, 0, 0, 1, 0, 0);
          gg.beginPath();
          rr.sh.poly.forEach(([lo, la], i) => (i ? gg.lineTo(cv._xy.X(lo), cv._xy.Y(la)) : gg.moveTo(cv._xy.X(lo), cv._xy.Y(la))));
          gg.closePath();
          const hit = gg.isPointInPath(px, py);
          gg.restore();
          if (hit) { selRegion = rr.id; again(); return; }
        }
      });
    }
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawLine(cv, vals, fmt, color, zero) {
    if (!cv) return;
    const w = cv.clientWidth || 300, h = 110;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.height = h + 'px';
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pad = { l: 4, r: 4, t: 16, b: 14 };
    g.font = '600 11px -apple-system, Segoe UI, sans-serif';
    if (vals.length < 2) {
      g.fillStyle = '#8f9ab5'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(vals.length ? `${fmt(vals[0])} · chart fills in monthly` : 'Fills in after the first month', w / 2, h / 2);
      return;
    }
    let mn = Math.min(...vals), mx = Math.max(...vals);
    if (zero) { mn = Math.min(0, mn); mx = Math.max(0, mx); } else mn = Math.min(0, mn);
    if (mx === mn) mx = mn + 1;
    const X = (i) => pad.l + i / (vals.length - 1) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - mn) / (mx - mn)) * (h - pad.t - pad.b);
    if (zero && mn < 0) {
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(pad.l, Y(0)); g.lineTo(w - pad.r, Y(0)); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,93,108,.10)'; g.fillRect(pad.l, Y(0), w - pad.l - pad.r, Y(mn) - Y(0));
    }
    g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = color; g.lineWidth = 2.2; g.stroke();
    g.lineTo(X(vals.length - 1), Y(Math.max(mn, 0))); g.lineTo(X(0), Y(Math.max(mn, 0))); g.closePath();
    g.fillStyle = color + '22'; g.fill();
    // points below zero get a square marker (not colour alone)
    vals.forEach((v, i) => {
      if (!zero) return;
      g.fillStyle = v < 0 ? '#ff5d6c' : color;
      if (v < 0) g.fillRect(X(i) - 2.5, Y(v) - 2.5, 5, 5); else { g.beginPath(); g.arc(X(i), Y(v), 2.2, 0, 7); g.fill(); }
    });
    const last = vals[vals.length - 1];
    g.fillStyle = '#e9ecf4'; g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillText(`now ${fmt(last)}`, w - pad.r, 1);
    g.fillStyle = '#8f9ab5'; g.textAlign = 'left';
    g.fillText(`max ${fmt(Math.max(...vals))}`, pad.l, 1);
    g.textBaseline = 'bottom';
    g.fillText(`${vals.length} months`, pad.l, h);
  }

  // ----- constellation -----
  function genList() { const N = NET(); return (N.GEN_ORDER || Object.keys(N.GENS || {})).map((id) => N.GENS[id]).filter(Boolean); }
  function genUnlocked(sm, g) { return !g.research || !!(sm.research && sm.research[g.research]); }
  function maxLaunch(sm) {
    const N = NET(), st = G.state;
    const lift = G.bestLift ? G.bestLift('LEO') : { mass: 0 };
    let maxN;
    if (N.maxBatch) maxN = safe(() => N.maxBatch(st, num(lift.mass))) || 0;
    else { const m = num(sm.genInfo && sm.genInfo.mass, 0.3); maxN = Math.min(num(sm.sats && sm.sats.ready), Math.floor(num(lift.mass) / m)); }
    return { lift, maxN: Math.max(0, maxN) };
  }
  function renderConst(sm, gen) {
    const N = NET(), st = G.state;
    const sats = sm.sats || {};
    const ready = num(sats.ready);
    const fac = sm.factory || {};
    const { lift, maxN } = maxLaunch(sm);
    if (!batchN || batchN > maxN) batchN = maxN;
    const queued = num(sats.queued);
    let html = `<div class="card"><div class="kv" style="margin-top:0">
      <div><small>🛰️ In orbit</small><b>${fmtInt(sats.orbit)}</b></div>
      <div><small>📦 Ready to launch</small><b>${fmtInt(ready)}</b></div>
      <div><small>🏭 In production</small><b>${fmtInt(queued)}</b></div>
      <div><small>⏳ Aging out</small><b class="${num(sats.aging) ? 'acc' : ''}">${num(sats.aging) ? '⚠ ' : ''}${fmtInt(sats.aging)}</b></div>
      <div><small>💀 Lost / retired</small><b>${fmtInt(sats.lostTotal)} / ${fmtInt(sats.deorbited)}</b></div>
      <div><small>📡 Gateways</small><b>${fmtInt(sm.stationsTotal)}</b></div></div>`;
    if ((sats.byGen || []).length > 1) html += `<div class="small dim" style="margin-top:6px">${sats.byGen.map((x) => `${esc((N.GENS[x.gen] || {}).name || x.gen)}: <b>${fmtInt(x.n)}</b>`).join(' · ')}</div>`;
    const cap = num(sm.capacityGbps);
    const u = cap > 0 ? Math.min(1, num(sm.usedGbps) / cap) : 0;
    html += `<div class="small" style="margin-top:8px">⚡ Bandwidth: <b>${fmtInt(sm.usedGbps)}</b> of <b>${fmtInt(cap)} Gbps</b> used · 📶 ${Math.round(num(sm.speedMbps))} Mbps per user</div>
      <div class="bar ${u > 0.9 ? 'bad' : 'good'}"><i style="width:${u * 100}%"></i></div>
      <div class="small ${u > 0.9 ? 'bad' : 'dim'}">${cap <= 0 ? '○ No capacity yet: needs sats in orbit and a ground station' : u > 0.9 ? '🚦 Congested: customers get slow internet and cancel' : '✓ Headroom'}${num(sm.stationCapacityGbps) < num(sm.satCapacityGbps) && cap > 0 ? ' · 📡 limited by ground stations: build more gateways' : ''}</div></div>`;
    // Launch
    html += `<div class="card"><b>🚀 Launch a batch</b>`;
    if (!G.readyCount()) html += `<div class="small dim">No rocket is ready. Build one in the Hangar.</div><div class="btns"><button class="btn sm" data-n="go" data-id="hangar">🛠️ Go to the Hangar</button></div>`;
    else if (!ready) html += `<div class="small dim">○ No sats waiting on the ground. Order some below${queued ? ` (${fmtInt(queued)} in production)` : ''}.</div>`;
    else if (maxN < 1) html += `<div class="small bad">⚠ Your best ready rocket lifts ${G.tons(num(lift.mass))} to LEO, not enough for one sat. Build a bigger rocket.</div>`;
    else {
      html += `<div class="small dim">Best ready rocket <b>${esc(lift.v ? lift.v.serial : '')}</b> lifts ${G.tons(num(lift.mass))} to LEO: up to <b>${maxN}</b> of your ${fmtInt(ready)} ready sats.</div>
        <div class="field"><label>Sats</label><div class="stepper"><button data-n="bn" data-id="-10">−10</button><button data-n="bn" data-id="-1">−</button><span>${batchN}</span><button data-n="bn" data-id="1">+</button><button data-n="bn" data-id="10">+10</button></div><button class="btn sm" data-n="bn" data-id="max">Max</button></div>
        <div class="btns"><button class="btn primary" data-n="launch" ${batchN > 0 ? '' : 'disabled'}>🚀 Launch ${batchN} sats</button></div>`;
    }
    html += `<label class="small net-check"><input type="checkbox" data-n="autorep" ${sm.hardware && sm.hardware.autoReplace ? 'checked' : ''}> ♻️ Auto-order replacements when sats retire</label></div>`;
    // Factory
    const sc = num(fac.satCost, num(gen.cost));
    const gens = genList();
    html += `<div class="card"><b>🏭 Sat factory · level ${num(fac.level, 1)}${fac.max ? ` / ${fac.max}` : ''}</b>
      <div class="small dim">Builds <b>${num(fac.rate)}</b> sats a day · ${esc(gen.name || '')}: ${G.money(sc)} each, ${G.tons(num(gen.mass))}, ${num(gen.gbps)} Gbps, lasts ${Math.round(num(gen.life) / 36.5) / 10} years</div>
      ${gens.length > 1 ? `<div class="seg" style="margin-top:8px">${gens.map((g) => { const ok = genUnlocked(sm, g); const on = g.id === sm.gen; return `<button data-n="gen" data-id="${g.id}" class="${on ? 'on' : ''}" ${ok ? '' : 'disabled'}>${on ? '● ' : ok ? '' : '🔒 '}${esc(g.name)}</button>`; }).join('')}</div>` : ''}
      <div class="btns">${[1, 10, 30, 100].map((n) => `<button class="btn sm ${n === 10 ? 'primary' : ''}" data-n="build" data-id="${n}" ${st.cash < n * sc ? 'disabled' : ''}>+${n} sats · ${G.money(n * sc)}</button>`).join('')}</div>
      ${fac.nextCost != null ? `<div class="btns"><button class="btn sm" data-n="factory" ${st.cash < fac.nextCost ? 'disabled' : ''}>⬆ Factory level ${num(fac.level) + 1}: ${num(fac.nextRate)} a day · ${G.money(num(fac.nextCost))}</button></div>` : '<div class="small good">✓ Factory at max level</div>'}
      ${(fac.queue || []).length ? `<div class="small dim" style="margin-top:6px">Queue: ${fac.queue.map((q) => `${fmtInt(q.n)} × ${esc((N.GENS[q.gen] || {}).name || q.gen)}`).join(', ')}</div>` : ''}</div>`;
    html += researchHtml(sm);
    setPanel('const', html);
  }
  function safe(f) { try { return f(); } catch (e) { return null; } }

  function researchHtml(sm) {
    const N = NET(), st = G.state;
    const done = sm.research || {};
    const ups = asList(N.UPGRADES || N.RESEARCH);
    const lab = sm.lab;
    let html = `<div class="card"><b>🔬 Halo lab</b>`;
    if (lab) html += `<div class="small acc" style="margin-top:4px">⚙️ Researching <b>${esc(lab.name)}</b> · ${lab.daysLeft} days left</div><div class="bar"><i style="width:${lab.days ? (1 - lab.daysLeft / lab.days) * 100 : 50}%"></i></div>`;
    else html += `<div class="small dim">○ Lab is free: pick a project. One at a time, paid in cash.</div>`;
    for (const u of ups) {
      if (done[u.id]) continue;
      const miss = (u.req || []).filter((q) => !done[q]);
      const can = !lab && !miss.length && st.cash >= num(u.cost) && (st.rp || 0) >= num(u.sci);
      const inLab = lab && lab.id === u.id;
      html += `<div class="tech net-tech"><div class="ic">${u.icon || '🔬'}</div><div class="grow"><b class="small">${esc(u.name)}</b><div class="small dim">${esc(u.desc || '')}</div>${miss.length ? `<div class="small bad">🔒 Needs ${esc(miss.map((q) => (ups.find((x) => x.id === q) || { name: q }).name).join(', '))}</div>` : ''}</div>
        ${inLab ? '<span class="pill acc">⚙️ In lab</span>' : `<button class="btn sm ${can ? 'primary' : ''}" data-n="research" data-id="${esc(u.id)}" ${can ? '' : 'disabled'}>${G.money(num(u.cost))}${u.sci ? ` · ${num(u.sci)} 🔬` : ''} · ${num(u.days)} d</button>`}</div>`;
    }
    const dl = ups.filter((u) => done[u.id]);
    if (dl.length) html += `<div class="small good" style="margin-top:6px">✓ Done: ${dl.map((u) => esc(u.name)).join(', ')}</div>`;
    return html + '</div>';
  }

  // ----- hardware (dish, router, satellites) -----
  const mult = (x) => `×${num(x, 1).toFixed(2)}`;
  function renderHardware(sm, gen) {
    const hw = sm.hardware;
    const st = G.state;
    if (!hw) { setPanel('hw', '<div class="empty">Hardware upgrades are not available in this version.</div>'); return; }
    const lab = hw.lab;
    const hwBtn = (kind, nx) => {
      if (!nx) return '<div class="small good" style="margin-top:6px">✓ Best design available</div>';
      if (lab && lab.kind === kind) return `<div class="small acc" style="margin-top:6px">⚙️ Designing ${esc(lab.name)} · ${lab.daysLeft} days left</div>`;
      const can = !lab && st.cash >= num(nx.cost) && (st.rp || 0) >= num(nx.sci);
      return `<div class="net-hw-next small"><span class="acc">⬆ Next: <b>${esc(nx.name)}</b></span><div class="dim">${esc(nx.desc || '')}</div></div>
        <div class="btns"><button class="btn sm ${can ? 'primary' : ''}" data-n="hw" data-id="${kind}" ${can ? '' : 'disabled'}>⬆ Design it · ${G.money(num(nx.cost))}${nx.sci ? ` · ${num(nx.sci)} 🔬` : ''} · ${num(nx.days)} d</button></div>${lab ? '<div class="small dim">○ Hardware lab busy</div>' : ''}`;
    };
    const d = hw.dish || {}, r = hw.router || {};
    const kit = hw.kitCost || {};
    let html = '<div class="net-hw-grid">';
    html += `<div class="card net-hw"><div class="net-hw-h"><span class="net-hw-ic">📡</span><div class="grow"><small class="dim">User dish · Gen ${num(d.level, 1)}</small><b>${esc(d.name || '')}</b></div></div>
      <div class="small dim">${esc(d.desc || '')}</div>
      <div class="kv"><div><small>📶 Speed</small><b>${mult(d.speed)}</b></div><div><small>🏷️ Home kit cost</small><b>${usd(kit.home)}</b></div><div><small>🔓 Plans</small><b class="small">${(hw.tiersOpen || []).map((t) => TIER_ICONS[t] || t).join(' ')}</b></div></div>
      ${hwBtn('dish', hw.nextDish)}</div>`;
    html += `<div class="card net-hw"><div class="net-hw-h"><span class="net-hw-ic">📶</span><div class="grow"><small class="dim">Wi-Fi router · Gen ${num(r.level, 1)}</small><b>${esc(r.name || '')}</b></div></div>
      <div class="small dim">${esc(r.desc || '')}</div>
      <div class="kv"><div><small>📶 Speed</small><b>${mult(r.speed)}</b></div><div><small>🏷️ Unit cost</small><b>${usd(r.unit)}</b></div><div><small>⭐ Happiness</small><b>+${Math.round(num(r.sat) * 100)}%</b></div></div>
      ${hwBtn('router', hw.nextRouter)}</div>`;
    const ups = hw.satUpgrades || [];
    html += `<div class="card net-hw"><div class="net-hw-h"><span class="net-hw-ic">🛰️</span><div class="grow"><small class="dim">Satellite</small><b>${esc(gen.name || '')}</b></div></div>
      <div class="kv"><div><small>⚡ Bandwidth</small><b>${num(gen.gbps)} Gbps</b></div><div><small>📶 Top speed</small><b>${num(gen.speed)} Mbps</b></div><div><small>🏷️ Unit cost</small><b>${G.money(num((sm.factory || {}).satCost, gen.cost))}</b></div><div><small>🔧 Software boost</small><b>${mult(hw.capacityBoost)}</b></div></div>
      ${hw.satLab ? `<div class="small acc" style="margin-top:6px">⚙️ Rolling out ${esc(hw.satLab.name)} · ${hw.satLab.daysLeft} days left</div>` : ''}
      ${ups.map((u) => `<div class="tech net-tech"><div class="grow"><b class="small">${u.icon || '💾'} ${esc(u.name)}</b><div class="small dim">${esc(u.desc || '')}</div>${!u.done && !u.available && u.needs ? `<div class="small bad">🔒 Needs ${esc(u.needs)}</div>` : ''}</div>
        ${u.done ? '<span class="pill good">✓ Done</span>' : `<button class="btn sm ${u.available && !hw.satLab && st.cash >= u.cost ? 'primary' : ''}" data-n="upsats" data-id="${esc(u.id)}" ${u.available && !hw.satLab && st.cash >= u.cost ? '' : 'disabled'}>${G.money(num(u.cost))} · ${num(u.days)} d</button>`}</div>`).join('')}
      <div class="small dim" style="margin-top:6px">New generations (V2 to V4) are in the Halo lab above.</div></div>`;
    html += '</div>';
    setPanel('hw', html);
  }

  // ----- pricing -----
  const STEPS = { home: [5, 50], business: [25, 100], maritime: [100, 250], aviation: [1000, 5000] };
  function renderPricing(sm) {
    const N = NET();
    const tiers = (N.TIER_IDS || Object.keys(N.TIERS)).map((id) => N.TIERS[id]);
    const open = (sm.hardware && sm.hardware.tiersOpen) || tiers.map((t) => t.id);
    const kit = (sm.hardware && sm.hardware.kitCost) || {};
    let html = '<div class="card">';
    for (const t of tiers) {
      const p = (sm.prices && sm.prices[t.id]) || { monthly: t.price, dish: t.dish };
      const subs = num((sm.subsByTier || {})[t.id]);
      let demand = 0;
      for (const r of sm.regions || []) demand += num(r.tiers && r.tiers[t.id] && r.tiers[t.id].demand);
      const locked = !open.includes(t.id);
      const [sm1, sd] = STEPS[t.id] || [5, 50];
      const ref = num(t.ref, t.price);
      const vs = p.monthly > ref * 1.15 ? '<span class="pill bad">▲ pricey: fewer sign-ups</span>' : p.monthly < ref * 0.85 ? '<span class="pill good">▼ cheap: more sign-ups</span>' : '<span class="pill">● fair price</span>';
      const sub = num(kit[t.id]) - p.dish;
      html += `<div class="net-tier ${locked ? 'locked' : ''}"><div class="net-tier-h"><b>${t.icon || TIER_ICONS[t.id] || '•'} ${esc(t.name)}</b><span class="small"><b>${fmtInt(subs)}</b> subs${demand ? ` · demand ${fmtInt(demand)}` : ''}</span>${locked ? '' : vs}</div>
        ${locked ? `<div class="small dim">🔒 Needs Dish Gen${num(t.needsDish, 2)} (Hardware)</div>` : `<div class="net-tier-s">
          <div class="field"><label>Monthly</label><div class="stepper"><button data-n="price" data-id="${t.id}" data-k="monthly" data-d="${-sm1}" aria-label="Lower ${esc(t.name)} monthly price">−</button><span>${usd(p.monthly)}</span><button data-n="price" data-id="${t.id}" data-k="monthly" data-d="${sm1}" aria-label="Raise ${esc(t.name)} monthly price">+</button></div></div>
          <div class="field"><label>Dish</label><div class="stepper"><button data-n="price" data-id="${t.id}" data-k="dish" data-d="${-sd}" aria-label="Lower ${esc(t.name)} dish price">−</button><span>${usd(p.dish)}</span><button data-n="price" data-id="${t.id}" data-k="dish" data-d="${sd}" aria-label="Raise ${esc(t.name)} dish price">+</button></div></div></div>
          <div class="small dim">Fair price about ${usd(ref)}/mo · dish costs you ${usd(kit[t.id])} to make${sub > 0 ? ` · <span class="acc">you subsidise ${usd(sub)} per sign-up</span>` : sub < 0 ? ` · <span class="good">+${usd(-sub)} profit per dish</span>` : ''}</div>`}
      </div>`;
    }
    const wait = num(sm.waitlist);
    html += `<div class="small" style="margin-top:8px">${wait ? `<span class="acc">⏳ ${fmtInt(wait)} people on the waitlist: not enough bandwidth. Launch more sats, build gateways, or raise prices.</span>` : '<span class="dim">✓ No waitlist. Cheaper plans and dishes bring more sign-ups; higher prices earn more per user.</span>'}</div></div>`;
    setPanel('pricing', html);
  }

  // ----- marketing & support -----
  const MKT = [0, 0.1, 0.3, 1, 3, 10, 30, 100];
  function renderMkt(sm) {
    const N = NET();
    const mk = num(sm.marketing);
    const sup = num(sm.support, 2);
    const levels = N.SUPPORT || [];
    const s = num(sm.satisfaction);
    let html = `<div class="card"><b>📣 Marketing</b> <span class="small dim">per month · awareness ${pctTxt(sm.awareness)}</span>
      <div class="seg" style="margin-top:6px">${MKT.map((v) => { const on = Math.abs(v - mk) < 1e-6; return `<button data-n="mkt" data-id="${v}" class="${on ? 'on' : ''}">${on ? '● ' : ''}${v ? G.money(v) : 'None'}</button>`; }).join('')}</div>
      <b style="display:block;margin-top:12px">🎧 Customer support</b><div class="small dim">Better support keeps people happy and stops cancellations (costs more per customer).</div>
      <div class="seg" style="margin-top:6px">${levels.map((l, i) => { const on = i === sup; return `<button data-n="support" data-id="${i}" class="${on ? 'on' : ''}">${on ? '● ' : ''}${esc(l.name)}</button>`; }).join('')}</div>
      <div class="small" style="margin-top:10px">⭐ Satisfaction <b>${pctTxt(s)}</b> ${s >= 0.75 ? '😀 happy' : s >= 0.5 ? '😐 okay' : '😠 cancelling'} · 🏅 Reputation <b>${pctTxt(sm.reputation)}</b></div>
      ${sm.rival && sm.rival.active ? `<div class="small bad" style="margin-top:4px">⚔️ Rival ${esc(sm.rival.name)}: ${fmtInt(sm.rival.sats)} sats, ${pctTxt(sm.rival.coverage)} coverage, ${usd(sm.rival.price)}/mo</div>` : ''}
      <div class="small dim" style="margin-top:4px">Today: revenue ${mny(sm.revenueDay)} · costs ${mny(sm.costDay)}</div></div>`;
    setPanel('mkt', html);
  }

  // ----- deals -----
  function renderDeals(sm) {
    const deals = sm.deals || [];
    const act = sm.activeDeals || [];
    let html = '';
    for (const d of act) html += `<div class="card done small"><b>${d.icon || '🤝'} ${esc(d.name)}</b> <span class="pill good">● Active</span><div class="dim">${G.money(num(d.monthly))}/month · ${Math.max(0, num(d.daysLeft))} days left</div></div>`;
    if (!deals.length) html += '<div class="empty">○ No offers right now. Governments, airlines and shipping lines call as your coverage grows.</div>';
    for (const d of deals) {
      const ok = !!d.canAccept;
      const left = num(d.daysLeft);
      html += `<div class="card"><div style="display:flex;gap:10px;align-items:flex-start"><div class="grow"><b>${d.icon || '🤝'} ${esc(d.name)}</b><div class="small dim">${esc(d.label || '')} · ${num(d.months)} months</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill ${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'} needs ${esc(d.needText || '')}</span><span class="pill ${left < 10 ? 'bad' : ''}">⏱ ${left} days left</span></div></div>
        <div style="text-align:right"><div class="money">+${G.money(num(d.upfront))}</div><div class="small">${G.money(num(d.monthly))}/mo</div></div></div>
        <div class="btns"><button class="btn sm ${ok ? 'go' : ''}" data-n="deal" data-id="${esc(d.id)}" ${ok ? '' : 'disabled'}>${ok ? '✓ Accept' : '✗ Not enough coverage yet'}</button><button class="btn sm" data-n="decline" data-id="${esc(d.id)}">Decline</button></div></div>`;
    }
    setPanel('deals', html);
  }

  // ----- goals -----
  function renderGoals(sm) {
    const N = NET();
    const goals = sm.nextGoals || [];
    const doneMap = sm.goalsDone || {};
    let html = '<div class="card">';
    for (const g of N.GOALS || []) if (doneMap[g.id]) html += `<div class="small" style="padding:3px 0">✅ <span class="dim">${esc(g.name)}</span></div>`;
    if (!goals.length) html += '<div class="small good">🏆 Every goal reached. You run the sky.</div>';
    for (const g of goals) {
      const p = Math.max(0, Math.min(1, num(g.progress)));
      html += `<div class="small" style="padding:4px 0">⬜ ${g.icon || ''} ${esc(g.name)}${g.reward ? ` <span class="dim">· bonus ${G.money(g.reward)}</span>` : ''} <span class="dim">· ${Math.floor(p * 100)}%</span>
        <div class="bar"><i style="width:${p * 100}%"></i></div></div>`;
    }
    setPanel('goals', html + '</div>');
  }

  // ----- IPO -----
  function renderIpo(sm) {
    const ipo = sm.ipo;
    const c = sm.ipoCheck || { ok: false, why: '' };
    let html = `<div class="card"><div class="kv" style="margin-top:0"><div><small>💎 Valuation</small><b>${G.money(num(sm.valuation))}</b></div><div><small>💰 Net cash so far</small><b class="${num(sm.cashToDate) >= 0 ? 'good' : 'bad'}">${G.money(num(sm.cashToDate))}</b></div><div><small>📅 Revenue, 12 mo</small><b>${G.money(num(sm.revenueYear))}</b></div><div><small>🧾 You own</small><b>${pctTxt(num(sm.ownership, 1))}</b></div></div>`;
    if (ipo) html += `<p class="small good">✅ Halo is public since day ${ipo.day}: sold ${pctTxt(ipo.share)} for ${G.money(num(ipo.raised))}.</p>`;
    else html += `<p class="small dim">Sell 20% of Halo on the stock market for a big cash injection. The price follows revenue and growth.</p>
      ${c.ok ? `<p class="small good">✓ Ready: raises about ${G.money(num(sm.ipoRaise))}.</p>` : `<p class="small bad">🔒 ${esc(c.why)}</p>`}
      <div class="btns"><button class="btn sm ${c.ok ? 'primary' : ''}" data-n="ipo" ${c.ok ? '' : 'disabled'}>🔔 Ring the bell (IPO)</button></div>`;
    setPanel('ipo', html + '</div>');
  }

  // ---------- actions ----------
  function act(action, args) {
    const N = NET();
    let r = null;
    try { r = N.act(G.state, action, args || {}); } catch (e) { console.warn(e); r = { ok: false, msg: 'Something went wrong.' }; }
    if (r && r.msg) G.toast(`${r.ok ? '' : '⚠️ '}${r.msg}`);
    if (r && r.ok && r.log) G.log(r.log);
    G.save();
    G.refresh();
    return r;
  }

  function onClick(e) {
    const b = e.target.closest('[data-n]');
    if (!b || b.disabled) return;
    const N = NET(); if (!N) return;
    const st = G.state;
    const id = b.dataset.id;
    busy = false; pending = false;
    switch (b.dataset.n) {
      case 'found': {
        const r = safe(() => N.found(st)) || { ok: false, msg: 'Could not found Halo.' };
        G.toast(r.ok ? `🛰️ ${r.msg || 'Halo founded!'}` : `⚠️ ${r.msg || ''}`);
        if (r.ok) G.log(`Founded <b>Halo</b>, our satellite internet company.`);
        G.save(); G.refresh(); break;
      }
      case 'go': G.goTab(id); break;
      case 'sel-region': if (selRegion !== id) { selRegion = id; again(); } break;
      case 'license': act('license', { region: id }); break;
      case 'station': act('station', { region: id }); break;
      case 'build': act('buildSats', { n: +id }); break;
      case 'factory': act('factoryUp'); break;
      case 'hw': act('researchHw', { kind: id }); break;
      case 'upsats': act('upgradeSats', { id }); break;
      case 'gen': act('gen', { gen: id }); break;
      case 'decline': act('declineDeal', { id }); break;
      case 'autorep': act('autoReplace', { on: b.checked }); break;
      case 'research': act('research', { id }); break;
      case 'mkt': act('marketing', { perMonth: +id }); break;
      case 'support': act('support', { level: +id }); break;
      case 'deal': act('acceptDeal', { id }); break;
      case 'ipo':
        if (window.confirm('Take Halo public? You sell part of the company for a big cash payment.')) act('ipo');
        break;
      case 'price': {
        const cur = (st.net && st.net.prices && st.net.prices[id]) || { monthly: 0, dish: 0 };
        const p = { monthly: cur.monthly, dish: cur.dish };
        p[b.dataset.k] = Math.max(b.dataset.k === 'monthly' ? 1 : 0, p[b.dataset.k] + +b.dataset.d);
        act('price', { tier: id, monthly: p.monthly, dish: p.dish });
        break;
      }
      case 'bn': {
        const sm = safe(() => N.summary(st)) || {};
        const { maxN } = maxLaunch(sm);
        batchN = id === 'max' ? maxN : Math.max(1, Math.min(maxN, batchN + +id));
        again(); break;
      }
      case 'launch': {
        if (batchN < 1) break;
        const c = safe(() => N.batchContract(st, batchN));
        if (!c) { G.toast('⚠️ Could not prepare the batch.'); break; }
        G.openLaunchFor(c);
        break;
      }
      default: break;
    }
  }

  window.APOGEE_NETUI = { render, hide };
})();
