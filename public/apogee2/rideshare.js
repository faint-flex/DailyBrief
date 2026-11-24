// APOGEE 2.0: rideshare missions and fairing recovery at sea.
// window.APOGEE_RIDESHARE. Pure-ish logic plus small HTML builders; game.js calls in with a few hooks.
//
// Rideshare: small-sat customers (0.05-0.5 t, each paying separately) wait in a pool per orbit
// (LEO, SSO). The player bundles some of them into one flight, up to the rocket's capacity.
// Balance: per customer pay = (0.35 + 6.0 * t) $M (SSO x1.2). Each pool holds at most 12
// customers and 1.5 t, so a full rideshare tops out near $11-13M. A small rocket earns about
// 1.1-1.3x its build cost; a dedicated contract for the same rocket pays 1.5-2.5x. Big rockets
// get far more from big dedicated contracts.
//
// Fairing recovery: with the 'fairing' tech, both fairing halves parachute down after each flight
// and a ship tries to catch them (net) or fish them out (sea). Recovered halves go into
// state.fairings.stock; the next build uses up to 2 halves and its fairing costs much less.
(function () {
  'use strict';
  const S = () => (typeof window !== 'undefined' ? window : globalThis).APOGEE_SIM;

  const TARGETS = ['LEO', 'SSO'];
  const POOL_MAX = 12;          // customers waiting per orbit
  const POOL_MASS = 1.5;        // t waiting per orbit
  const DISPENSER = 0.05;       // t, the ring the small sats ride on
  const SSO_REP = 8;            // reputation to unlock SSO rideshares (same as imaging sats)
  const STOCK_MAX = 6;          // fairing halves kept in the hangar

  const PRE = ['Pico', 'Nimbus', 'Quark', 'Tern', 'Wren', 'Lattice', 'Kite', 'Mote', 'Sparrow', 'Cobalt', 'Fjord', 'Ion', 'Pixel', 'Zephyr', 'Juniper', 'Atlas Ridge', 'Moth', 'Prism', 'Beacon', 'Lark'];
  const SUF = ['Sat', 'Orbital', 'Labs', 'Space', 'Systems', 'Aero', 'Sensing', 'Works'];
  const UNIS = ['Ridgeway University', 'Lakeshore Tech', 'Harbor Polytechnic', 'Ashford College', 'Northfield Institute'];
  const JOBS = [
    { id: 'iot', icon: '📡', text: 'IoT relay' }, { id: 'img', icon: '📷', text: 'Imaging' },
    { id: 'wx', icon: '🌦️', text: 'Weather' }, { id: 'ship', icon: '🚢', text: 'Ship tracking' },
    { id: 'sci', icon: '🔭', text: 'Science' }, { id: 'radio', icon: '📻', text: 'Radio test' },
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;

  function ensure(st) {
    if (!st.rideshare || typeof st.rideshare !== 'object') st.rideshare = {};
    const R = st.rideshare;
    R.pool = R.pool || {};
    for (const t of TARGETS) if (!Array.isArray(R.pool[t])) R.pool[t] = [];
    R.flights = R.flights || 0;
    R.served = R.served || 0;
    if (!R.seeded) {
      // A few customers are waiting from day one.
      R.seeded = true;
      for (let i = 0; i < 4; i++) addCustomer(st, 'LEO', Math.random);
    }
    if (!st.fairings || typeof st.fairings !== 'object') {
      // Old saves with the tech had cheap fairings already: start them with one full set.
      st.fairings = { stock: S() && S().has(st.techs, 'fairing') ? 2 : 0, tries: 0, caught: 0, lost: 0 };
    }
    return R;
  }

  function poolMass(st, t) { return ensure(st).pool[t].reduce((s, c) => s + c.mass, 0); }
  function unlocked(st, t) { return t === 'LEO' || (st.rep || 0) >= SSO_REP; }

  function makeName(rng, taken) {
    for (let k = 0; k < 8; k++) {
      const n = rng() < 0.18
        ? `${UNIS[Math.floor(rng() * UNIS.length)]} CubeSat`
        : `${PRE[Math.floor(rng() * PRE.length)]} ${SUF[Math.floor(rng() * SUF.length)]}`;
      if (!taken.has(n)) return n;
    }
    return `${PRE[Math.floor(rng() * PRE.length)]} ${Math.floor(rng() * 90 + 10)}`;
  }

  function addCustomer(st, t, rng) {
    const R = st.rideshare;
    const pool = R.pool[t];
    if (pool.length >= POOL_MAX) return null;
    // Mostly small sats: 0.05-0.5 t, skewed light.
    const mass = r2(0.05 + 0.45 * Math.pow(rng(), 1.6));
    if (poolMass(st, t) + mass > POOL_MASS) return null;
    const taken = new Set(TARGETS.flatMap((x) => R.pool[x].map((c) => c.name)));
    const pay = r1((0.35 + 6.0 * mass) * (t === 'SSO' ? 1.2 : 1) * (0.9 + rng() * 0.2));
    const c = {
      id: 'r' + Math.floor(rng() * 1e9).toString(36), name: makeName(rng, taken), job: JOBS[Math.floor(rng() * JOBS.length)].id,
      mass, pay, target: t, expires: st.day + 25 + Math.round(rng() * 35),
    };
    pool.push(c);
    return c;
  }

  // Daily: customers arrive and give up. Returns { events: [] }.
  function tick(st, rng) {
    ensure(st);
    rng = rng || Math.random;
    const events = [];
    for (const t of TARGETS) {
      const pool = st.rideshare.pool[t];
      const before = pool.length;
      st.rideshare.pool[t] = pool.filter((c) => c.expires > st.day);
      const gone = before - st.rideshare.pool[t].length;
      if (gone) events.push(`${gone} rideshare customer${gone > 1 ? 's' : ''} to ${t} found another ride.`);
      if (!unlocked(st, t)) continue;
      const n = st.rideshare.pool[t].length;
      const p = (t === 'LEO' ? 0.3 : 0.2) * (n < 3 ? 1.6 : 1);
      if (rng() < p) addCustomer(st, t, rng);
    }
    return { events };
  }

  function waiting(st, t) { return ensure(st).pool[t] || []; }

  // Best set of customers (max pay) that fits in cap (t, including the dispenser). Up to 12 items: brute force.
  function fill(st, t, cap) {
    const list = waiting(st, t);
    const room = cap - DISPENSER;
    if (room <= 0 || !list.length) return [];
    let best = 0, bestMask = 0;
    const n = list.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let m = 0, p = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) { m += list[i].mass; p += list[i].pay; }
      if (m <= room + 1e-9 && p > best) { best = p; bestMask = mask; }
    }
    return list.filter((_, i) => bestMask & (1 << i)).map((c) => c.id);
  }

  // A contract-like object for the launch flow. ride = { target, picks: [ids] }.
  function contract(st, ride) {
    const list = waiting(st, ride.target).filter((c) => ride.picks.includes(c.id));
    const mass = r2(DISPENSER + list.reduce((s, c) => s + c.mass, 0));
    const reward = r1(list.reduce((s, c) => s + c.pay, 0));
    return {
      id: 'ride-' + ride.target, kind: 'rideshare', label: `Rideshare to ${ride.target}`,
      client: `${list.length} customer${list.length === 1 ? '' : 's'}`, target: ride.target, mass, reward,
      rep: list.length ? 2 + Math.floor(list.length / 3) : 0, count: list.length,
      riders: list.map((c) => ({ id: c.id, name: c.name, job: c.job, mass: c.mass, pay: c.pay })),
    };
  }

  const jobOf = (id) => JOBS.find((j) => j.id === id) || JOBS[0];

  // ---------- Contracts tab cards ----------
  // G: { money, tons, fit(target) -> { v, cap } | null }
  function contractCards(st, G) {
    ensure(st);
    let html = '';
    for (const t of TARGETS) {
      if (!unlocked(st, t)) continue;
      const list = waiting(st, t);
      if (!list.length) continue;
      const mass = list.reduce((s, c) => s + c.mass, 0);
      const pay = list.reduce((s, c) => s + c.pay, 0);
      const soon = Math.min(...list.map((c) => c.expires)) - st.day;
      const fit = G.fit(t);
      let fitPill;
      if (!fit) fitPill = '<span class="pill bad">✕ No rocket ready</span>';
      else {
        const ids = fill(st, t, fit.cap);
        fitPill = ids.length ? `<span class="pill good">✓ ${esc(fit.v.serial)} fits ${ids.length} of ${list.length}</span>` : `<span class="pill bad">✕ ${esc(fit.v.serial)} can't fit any</span>`;
      }
      html += `<div class="card tap rs-card" data-act="ride-open" data-id="${t}">
        <div style="display:flex;gap:10px;align-items:flex-start"><div class="grow">
          <h3>🚌 Rideshare to ${t}</h3><div class="small dim">${list.length} small-sat customer${list.length > 1 ? 's' : ''} waiting · each pays separately</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill blue">${t}</span><span class="pill">${G.tons(mass)} waiting</span>
          <span class="pill ${soon < 8 ? 'bad' : ''}">next leaves in ${soon} days</span>${fitPill}</div>
        </div><div style="text-align:right"><div class="money" style="font-size:17px">up to ${G.money(pay)}</div><div class="small dim">pick who flies</div></div></div></div>`;
    }
    return html;
  }

  // ---------- Launch sheet picker ----------
  // cap: rocket's payload capacity (t) to this orbit with the chosen booster mode.
  function pickerHtml(st, ride, cap, G) {
    const list = waiting(st, ride.target).slice().sort((a, b) => b.pay / b.mass - a.pay / a.mass);
    const c = contract(st, ride);
    const over = c.mass > cap + 1e-9;
    const room = cap - c.mass;
    let html = `<h2>Customers on this flight</h2>
      <div class="card rs-sum"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span class="small">Payload <b class="${over ? 'bad' : ''}">${G.tons(c.mass)}</b> of <b>${G.tons(Math.max(0, cap))}</b> ${over ? '<b class="bad">⚠ too heavy</b>' : ''}</span>
        <span class="small">${c.count} on board · pays <b class="money">${G.money(c.reward)}</b></span></div>
        <div class="bar ${over ? 'bad' : 'good'}"><i style="width:${Math.min(100, cap > 0 ? c.mass / cap * 100 : 100)}%"></i></div>
        <div class="small dim" style="margin-top:4px">Includes the ${G.tons(DISPENSER)} dispenser ring.</div>
        <div class="btns"><button class="btn sm primary" data-act="ride-fill">⚡ Fill for best pay</button><button class="btn sm" data-act="ride-clear" ${c.count ? '' : 'disabled'}>Clear</button></div></div>
      <div class="rs-list">`;
    for (const x of list) {
      const on = ride.picks.includes(x.id);
      const fits = on || x.mass <= room + 1e-9;
      const j = jobOf(x.job);
      const days = x.expires - st.day;
      html += `<button class="rs-row ${on ? 'on' : ''}" data-act="ride-pick" data-id="${x.id}" ${fits ? '' : 'disabled'} aria-pressed="${on}">
        <span class="rs-box" aria-hidden="true">${on ? '☑' : '☐'}</span>
        <span class="grow"><b>${esc(x.name)}</b><span class="small dim"> · ${j.icon} ${j.text} · ${days} days left</span>${fits ? '' : '<span class="small bad"> · won\'t fit</span>'}</span>
        <span class="rs-num">${G.tons(x.mass)}</span><span class="rs-num money">${G.money(x.pay)}</span></button>`;
    }
    html += '</div>';
    if (!list.length) html += '<div class="empty">Nobody is waiting for this orbit right now.</div>';
    return html;
  }

  // ---------- Flight result ----------
  // Pays each customer on success. Returns result lines [label, value].
  function onResult(st, c, ok, G) {
    ensure(st);
    const lines = [];
    if (!c || !c.riders) return lines;
    if (!ok) {
      lines.push(['🚌 Rideshare', `${c.riders.length} customers will wait for another try`]);
      return lines;
    }
    const pool = st.rideshare.pool[c.target] || [];
    const ids = new Set(c.riders.map((r) => r.id));
    st.rideshare.pool[c.target] = pool.filter((x) => !ids.has(x.id));
    st.rideshare.flights++;
    st.rideshare.served += c.riders.length;
    lines.push(['🚌 Customers paid', `${c.riders.length} · <span class="money">+${G.money(c.reward)}</span>`]);
    for (const r of c.riders) lines.push([`<span class="rs-paid">✓ ${jobOf(r.job).icon} ${esc(r.name)} <span class="dim">${G.tons(r.mass)}</span></span>`, `<span class="money">+${G.money(r.pay)}</span>`]);
    return lines;
  }

  // ---------- Fairing recovery ----------
  function fairingOdds(st) {
    const tries = (st.fairings && st.fairings.tries) || 0;
    return Math.min(0.85, 0.6 + 0.02 * tries);
  }
  function fairingDiscount(st) {
    ensure(st);
    const sim = S();
    if (!sim.has(st.techs, 'fairing')) return 0;
    return Math.max(0, sim.fairingCost(st.techs, 0) - sim.fairingCost(st.techs, st.fairings.stock));
  }
  function useFairings(st) {
    ensure(st);
    const used = Math.min(2, st.fairings.stock);
    st.fairings.stock -= used;
    return used;
  }

  const ICON = {
    net: '🥅', fish: '🎣', lost: '🌊',
  };
  // Small inline picture: a fairing half hanging under a parafoil over the sea.
  function parafoilSvg() {
    return `<svg class="rs-foil" viewBox="0 0 120 70" width="120" height="70" role="img" aria-label="Fairing half under a parafoil">
      <rect x="0" y="54" width="120" height="16" fill="#123257"/><path d="M0 58 q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="#5aa9ff" stroke-width="1.5" fill="none"/>
      <path d="M30 16 Q60 2 90 16 L86 20 Q60 8 34 20 Z" fill="#ff7a1a"/>
      <g stroke="#8f9ab5" stroke-width="0.8"><line x1="34" y1="20" x2="56" y2="38"/><line x1="48" y1="13" x2="58" y2="38"/><line x1="72" y1="13" x2="62" y2="38"/><line x1="86" y1="20" x2="64" y2="38"/></g>
      <path d="M54 38 Q60 34 66 38 L66 52 Q60 50 54 52 Z" fill="#e9ecf4"/></svg>`;
  }

  // After each flight that reached fairing separation. Returns result lines.
  function fairingAfterFlight(st, ctx, ok) {
    ensure(st);
    const sim = S();
    if (!sim.has(st.techs, 'fairing')) return [];
    const c = ctx && ctx.c;
    if (!ok || (c && c.crew)) return []; // no fairing came off (lost early, or a crew capsule)
    const F = st.fairings;
    const p = fairingOdds(st);
    const halves = [0, 1].map(() => {
      if (Math.random() >= p) return 'lost';
      return Math.random() < 0.55 ? 'net' : 'fish';
    });
    F.tries++;
    const got = halves.filter((h) => h !== 'lost').length;
    F.caught += got; F.lost += 2 - got;
    const kept = Math.min(got, Math.max(0, STOCK_MAX - F.stock));
    F.stock += kept;
    const caught = halves.filter((h) => h === 'net').length, fished = halves.filter((h) => h === 'fish').length, lost = 2 - got;
    const parts = [];
    if (caught) parts.push(`${ICON.net} ${caught} caught in the net`);
    if (fished) parts.push(`${ICON.fish} ${fished} fished out`);
    if (lost) parts.push(`${ICON.lost} ${lost} lost in the sea`);
    const after = fairingOdds(st);
    const lines = [];
    lines.push([`<span class="rs-fair">${parafoilSvg()}<span>Fairing halves</span></span>`, `<span class="${got === 2 ? 'good' : got ? '' : 'bad'}">${parts.join(', ')}</span>`]);
    lines.push(['Fairing stock', `${F.stock} ${F.stock === 1 ? 'half' : 'halves'}${kept < got ? ' (hangar full)' : ''}${after > p ? ` · catch odds ${Math.round(p * 100)}% → ${Math.round(after * 100)}%` : ''}`]);
    return lines;
  }

  // Hangar tab card.
  function hangarCard(st, G) {
    ensure(st);
    const sim = S();
    if (!sim.has(st.techs, 'fairing')) return '';
    const F = st.fairings;
    const halves = Array.from({ length: STOCK_MAX }, (_, i) => `<span class="rs-half ${i < F.stock ? 'on' : ''}" aria-hidden="true">${i < F.stock ? '●' : '○'}</span>`).join('');
    const save = fairingDiscount(st);
    return `<h2>🎣 Fairing recovery</h2><div class="card"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <div class="grow"><b>${F.stock} fairing ${F.stock === 1 ? 'half' : 'halves'} in stock</b> <span class="small dim">(max ${STOCK_MAX})</span>
      <div class="rs-halves">${halves}</div>
      <div class="small dim">After each flight a ship tries to catch both halves. Catch odds now ${Math.round(fairingOdds(st) * 100)}%, better with practice.
      ${F.stock >= 2 ? `Your next rocket reuses 2 halves and saves ${G.money(save)}.` : F.stock === 1 ? `Your next rocket reuses 1 half and saves ${G.money(save)}.` : 'No halves in stock: the next fairing is built new.'}</div></div>
      <div class="kv" style="margin-top:0"><div><small>Recovered</small><b>${F.caught}</b></div><div><small>Lost</small><b>${F.lost}</b></div></div></div></div>`;
  }

  // Styles live here so shared style.css stays untouched.
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('rs-css')) return;
    const s = document.createElement('style');
    s.id = 'rs-css';
    s.textContent = `
.rs-card { border-style: dashed; }
.rs-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.rs-row { display: flex; align-items: center; gap: 10px; min-height: 48px; width: 100%; text-align: left; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 6px 12px; }
.rs-row .grow { flex: 1; min-width: 0; }
.rs-row.on { border-color: var(--good); background: rgba(61, 220, 151, .08); }
.rs-row:disabled { opacity: .5; cursor: default; }
.rs-box { font-size: 22px; line-height: 1; width: 24px; }
.rs-row.on .rs-box { color: var(--good); }
.rs-num { font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 700; white-space: nowrap; min-width: 52px; text-align: right; }
.rs-paid { font-size: 13px; padding-left: 10px; }
#result { max-height: 92vh; overflow-y: auto; }
.rs-fair { display: inline-flex; align-items: center; gap: 6px; }
.rs-foil { width: 54px; height: 32px; border-radius: 6px; flex: none; }
.rs-halves { display: flex; gap: 4px; margin: 6px 0; font-size: 20px; }
.rs-half { color: var(--dim); }
.rs-half.on { color: var(--accent2); }
@media (max-width: 520px) { .rs-row .small.dim { display: block; } }
`;
    document.head.appendChild(s);
  }
  injectCss();

  const API = {
    TARGETS, DISPENSER, POOL_MAX, POOL_MASS,
    ensure, tick, waiting, fill, contract, contractCards, pickerHtml, onResult,
    fairingOdds, fairingDiscount, useFairings, fairingAfterFlight, hangarCard, addCustomer,
  };
  if (typeof window !== 'undefined') window.APOGEE_RIDESHARE = API;
  else globalThis.APOGEE_RIDESHARE = API;
})();
