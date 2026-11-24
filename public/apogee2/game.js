// APOGEE: company game state, screens and launch flow.
(function () {
  'use strict';
  const S = window.APOGEE_SIM;
  const D = window.APOGEE_DRAW;
  const F = window.APOGEE_FLIGHT;
  // Halo network (optional modules: guard for their absence).
  const NET = () => window.APOGEE_NET || null;
  const NETUI = () => window.APOGEE_NETUI || null;
  const isHalo = (c) => !!(c && c.kind === 'halo');
  const isDc = (c) => !!(c && c.kind === 'dc');
  const isOwn = (c) => isHalo(c) || isDc(c);
  const VENT = () => window.APOGEE_VENTURES || null;
  const VENTUI = () => window.APOGEE_VENTURES_UI || null;
  const OPS = () => window.APOGEE_OPS || null; // launch ops: weather, static fires, investigations (launchops.js)
  // Launch windows + deep-space transit (windows.js, optional).
  const WND = () => window.APOGEE_WINDOWS || null;
  const CREW = () => window.APOGEE_CREW || null; // crew.js: astronauts, capsule, Tranquil Station
  // Rideshare missions + fairing recovery (rideshare.js, optional).
  const RS = () => window.APOGEE_RIDESHARE || null;
  const isRide = (c) => !!(c && c.kind === 'rideshare');
  const fairSave = () => { const R = RS(); try { return R ? R.fairingDiscount(state) : 0; } catch (e) { return 0; } };
  const EN = () => window.APOGEE_ENGINES || null; // engines & side boosters (optional module)
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'apogee2-save-v1';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const money = (m) => {
    const neg = m < 0; m = Math.abs(m);
    const s = m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : m >= 100 ? `$${Math.round(m)}M` : `$${m.toFixed(1)}M`;
    return neg ? '−' + s : s;
  };
  const tons = (t) => (t >= 100 ? `${Math.round(t)} t` : t >= 10 ? `${t.toFixed(1)} t` : `${t.toFixed(2)} t`);
  const pct = (p) => `${Math.round(p * 100)}%`;

  const COLORS = ['#ff7a1a', '#5aa9ff', '#3ddc97', '#ff5d6c', '#c58bff', '#f2d14b'];
  const TECH_ICONS = { legs: '🦿', fairing: '🎣', lighttanks: '🪶', barge: '🚢', rapid: '⏱️', comet: '☄️', capsule: '👩‍🚀', steel: '🛢️', nova: '💥', tower: '🦾', refill: '⛽', shipreuse: '♻️', habitat: '🏠' };
  const MILESTONES = [
    { id: 'firstOrbit',    name: 'Reach orbit',                cash: 3,  rp: 10 },
    { id: 'firstLanding',  name: 'Land a booster',             cash: 10, rp: 25 },
    { id: 'firstReflight', name: 'Fly a used booster',         cash: 10, rp: 20 },
    { id: 'firstGTO',      name: 'Deliver a satellite to GTO', cash: 5,  rp: 15 },
    { id: 'firstCrew',     name: 'Fly astronauts',             cash: 25, rp: 30 },
    { id: 'firstMoon',     name: 'Reach the Moon',             cash: 30, rp: 40 },
    { id: 'firstMars',     name: 'Reach Mars',                 cash: 40, rp: 50 },
    { id: 'marsCity',      name: 'Build a Mars city (5 cargo landings)', cash: 0, rp: 0 },
  ];

  let state = null;
  let tab = 'ops';
  let sheet = null; // { kind, ... }
  let flying = false;

  // ---------- State ----------
  function newGame() {
    const st = {
      v: 1, day: 1, cash: 40, rep: 0, rp: 0, engineers: 4, factory: 1,
      owned: { barge: false, tower: false }, techs: {}, heritage: {}, designFlights: {}, landings: {},
      designs: [
        { id: 'd1', name: 'Pathfinder', color: '#ff7a1a', stages: [{ engine: 'ember', count: 1, prop: 45 }, { engine: 'emberv', count: 1, prop: 9 }] },
      ],
      vehicles: [], boosters: [], contracts: [], log: [], milestones: {}, marsCity: 0,
      stats: { launches: 0, successes: 0, landings: 0, reflights: 0, earned: 0 },
      serial: 1, nextId: 2, speed: 1, intro: true, won: false,
    };
    st.vehicles.push({ id: 'v1', design: clone(st.designs[0]), designId: 'd1', serial: 'PF-1', status: 'ready', days: 0, total: 0, booster: null });
    // Two easy starter jobs the Pathfinder can fly.
    st.contracts.push({ id: 'c-start1', kind: 'smallsat', label: 'Small satellite', client: 'Kestrel University', target: 'LEO', mass: 0.4, reward: 6.5, expires: 90, rep: 5 });
    st.contracts.push({ id: 'c-start2', kind: 'smallsat', label: 'Small satellite', client: 'Pebble Sats', target: 'LEO', mass: 0.6, reward: 7.2, expires: 110, rep: 5 });
    for (let i = 0; i < 3; i++) st.contracts.push(S.makeContract(Math.random, st));
    st.log.unshift({ day: 1, text: 'Founded the company with <b>$40M</b> and one Pathfinder rocket.' });
    netEnsure(st);
    campusEnsure(st);
    ventEnsure(st);
    return st;
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) { netEnsure(s); campusEnsure(s); ventEnsure(s); if (WND()) WND().ensure(s); /* windows */ return s; } }
    } catch (e) { /* ignore */ }
    return newGame();
  }
  const CAMPUS = () => window.APOGEE_CAMPUS;
  function campusEnsure(st) {
    const C = CAMPUS();
    if (C && C.ensure) { try { C.ensure(st); } catch (e) { console.warn('Campus ensure failed', e); } }
  }
  // Global chip shortages: hit satellites, cars and compute modules. A chip fab on your campus covers part of it.
  function chipSelf() {
    const C = CAMPUS();
    try { return C && C.bonus && state.campus ? Math.min(1, C.bonus(state).chipSelf || 0) : 0; } catch (e) { return 0; }
  }
  function chipShortageTick() {
    const s = state.chipShortage;
    if (s && s.until === state.day) {
      log('✅ The global chip shortage is over.');
      toast('✅ Chip shortage over');
    }
    if (s && s.until > state.day) return;
    const busy = state.net || (state.ventures && (state.ventures.ev || state.ventures.dc));
    if (!busy || state.day < 120 || Math.random() > 1 / 260) return;
    const days = 45 + Math.round(Math.random() * 40), sev = Math.round((0.3 + Math.random() * 0.2) * 100) / 100;
    state.chipShortage = { start: state.day, until: state.day + days, sev };
    const self = chipSelf(), hit = Math.round(sev * (1 - self) * 100);
    log(`⚠ <b>Global chip shortage</b> for ${days} days: satellites, cars and compute modules cost up to ${Math.round(sev * 100)}% more and build that much slower.${self ? ` Your chip fab makes ${Math.round(self * 100)}% of your chips, so you only feel ${hit}%.` : ' Build a 💾 Chip fab on the Base tab to protect yourself.'}`);
    toast(self >= 1 ? '⚠ Chip shortage! Your own fab keeps you running ✓' : `⚠ Chip shortage: −${hit}% output for ${days} days`);
  }
  function ventEnsure(st) {
    const V = VENT();
    if (V && V.ensure) { try { V.ensure(st); } catch (e) { console.warn('Ventures ensure failed', e); } }
  }
  function campusSync() {
    const C = CAMPUS();
    if (!C || !C.bonus || !state.campus) return null;
    try {
      const bo = C.bonus(state);
      state.factory = Math.max(1, bo.factoryLines || 0);
      state.owned.barge = !!bo.bargePort;
      state.owned.tower = !!bo.catchTower;
      return bo;
    } catch (e) { return null; }
  }
  function netEnsure(st) {
    const N = NET();
    if (N && N.ensure) { try { N.ensure(st); } catch (e) { console.warn('Halo ensure failed', e); } }
  }
  function netSummary() {
    const N = NET();
    if (!N || !N.summary || !state.net) return null;
    try { return N.summary(state); } catch (e) { return null; }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }, 300);
  }
  function log(text) {
    state.log.unshift({ day: state.day, text });
    state.log = state.log.slice(0, 40);
  }
  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.innerHTML = text; t.hidden = false;
    t.classList.toggle('at-top', !!sheet); // playtest #24: keep toasts off sheet content
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Time ----------
  function dayTick() {
    state.day++;
    state.rp += state.engineers * S.FACILITY.rpPerEngineerDay;
    const C = CAMPUS();
    if (C && C.tick && state.campus) {
      try {
        const r = C.tick(state) || {};
        for (const ev of r.events || []) log(ev);
        if (r.toasts && r.toasts.length) toast(r.toasts[r.toasts.length - 1]);
      } catch (e) { console.warn('Campus tick failed', e); }
    }
    const hasCampus = !!campusSync();
    if (state.day % 30 === 0) {
      const bill = hasCampus ? state.engineers * S.FACILITY.engineerSalary : state.engineers * S.FACILITY.engineerSalary + 0.1 * state.factory + (state.owned.barge ? 0.2 : 0) + (state.owned.tower ? 0.3 : 0);
      state.cash -= bill;
      log(`Paid monthly costs: <b>${money(bill)}</b>.`);
    }
    let lines = state.factory;
    for (const v of state.vehicles) {
      if (v.status !== 'building') continue;
      if (lines <= 0) break;
      lines--;
      v.days--;
      if (v.days <= 0) {
        v.status = 'ready';
        log(`<b>${esc(v.serial)}</b> (${esc(v.design.name)}) rolled out and is ready to fly.`);
        toast(`🚀 ${esc(v.serial)} is ready to fly`);
      }
    }
    // Windows: deep-space craft arriving today get paid (or crash).
    if (WND()) { try { WND().tick(state, { log, toast, award, money }); } catch (e) { console.warn('Windows tick failed', e); } }
    const before = state.contracts.length;
    state.contracts = state.contracts.filter((c) => c.expires > state.day);
    if (state.contracts.length < before) log('A contract offer expired.');
    const cap = 7;
    const open = state.contracts.filter((c) => !isOwn(c)).length;
    if (open < cap && Math.random() < (open < 3 ? 0.35 : 0.14)) {
      // Windows: Mars offers expire when a Mars window closes; ones too far from a window are re-rolled.
      const c = WND() ? WND().offer(() => S.makeContract(Math.random, state), state) : S.makeContract(Math.random, state);
      if (c) state.contracts.push(c);
    }
    const N = NET();
    if (N && N.tick) {
      try {
        const r = N.tick(state, Math.random) || {};
        for (const ev of r.events || []) log(ev);
        const ts = r.toasts || [];
        if (ts.length) toast(ts[ts.length - 1]);
      } catch (e) { console.warn('Halo tick failed', e); }
    }
    // Crew: training, days in orbit, splashdowns, station crew offers.
    const CR = CREW();
    if (CR && CR.tick) {
      try {
        const r = CR.tick(state) || {};
        for (const ev of r.events || []) log(ev);
        if (r.toasts && r.toasts.length) toast(r.toasts[r.toasts.length - 1]);
      } catch (e) { console.warn('Crew tick failed', e); }
    }
    // Rideshare customers arrive and give up.
    if (RS()) { try { for (const ev of RS().tick(state, Math.random).events || []) log(ev); } catch (e) { console.warn('Rideshare tick failed', e); } }
    const V = VENT();
    if (V && V.tick) {
      try {
        const r = V.tick(state, Math.random) || {};
        for (const ev of r.events || []) log(ev);
        const ts = r.toasts || [];
        if (ts.length) toast(ts[ts.length - 1]);
      } catch (e) { console.warn('Ventures tick failed', e); }
    }
    // Launch ops: static fires and failure investigations count down.
    const O = OPS();
    if (O && O.tick) {
      try {
        const r = O.tick(state) || {};
        for (const ev of r.events || []) log(ev);
        const ts = r.toasts || [];
        if (ts.length) toast(ts[ts.length - 1]);
      } catch (e) { console.warn('Launch ops tick failed', e); }
    }
    if (!state.vehicles.length && !sheet && !state.won) {
      const cheapest = Math.min(...state.designs.map((d) => S.designCost(d, state.techs)), 99);
      if (state.cash < cheapest) {
        if ((state.bailouts || 0) < 2) {
          state.bailouts = (state.bailouts || 0) + 1;
          const amt = Math.round(cheapest * 1.6 + 4);
          state.cash += amt; state.rep = Math.max(0, state.rep - 5);
          log(`💼 Out of rockets and cash: investors put in <b>${money(amt)}</b> to keep you flying (reputation −5). They won't do this forever (${2 - state.bailouts} left).`);
          toast(`💼 Investors put in ${money(amt)}`);
        } else if (state.cash < 0) openSheet({ kind: 'bankrupt' });
      }
    }
    if (state.cash < -15 && !sheet) openSheet({ kind: 'bankrupt' });
    save();
  }

  let acc = -1, last = performance.now();
  const DAY_SEC = 3; // real seconds per game day at ▶ (▶▶ is 5× faster)
  // Weather watch: tell the player when launch weather changes, and drop out of fast speed so a good day isn't skipped.
  let wxLast = null;
  function wxWatch() {
    const O = OPS(); if (!O || !O.today) return;
    let w; try { w = O.today(state); } catch (e) { return; }
    const go = w.go || 'go';
    if (wxLast !== null && go !== wxLast) {
      const msg = go === 'go' ? `${w.icon || '☀️'} ✓ Launch weather is GO today` : go === 'risky' ? `${w.icon || '⚠️'} ⚠ Risky launch weather today: ${w.long}` : `${w.icon || '⛈️'} ✕ No launches today: ${w.long}`;
      toast(msg);
      if (go === 'go' && state.speed > 1) { state.speed = 1; save(); header(); }
    }
    wxLast = go;
  }
  function clock(now) {
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (acc < 0) acc = (state && state.tod) || 0; // day/night: resume the time of day from the save
    if (!flying && !(sheet && (sheet.kind === 'intro' || sheet.kind === 'editor' || sheet.kind === 'launch')) && state.speed > 0 && !state.won) {
      acc += dt * state.speed / DAY_SEC; // slower days so weather choices land (LyFe: days too fast)
      let changed = false;
      while (acc >= 1) { acc -= 1; dayTick(); changed = true; }
      if (changed) { wxWatch(); refresh(); }
      state.tod = acc; if (window.APOGEE_DAYNIGHT) window.APOGEE_DAYNIGHT.header(); // day/night clock
    }
    requestAnimationFrame(clock);
  }

  // ---------- Header ----------
  function header() {
    $('s-day').textContent = state.day;
    if (window.APOGEE_DAYNIGHT) window.APOGEE_DAYNIGHT.header(); // day/night clock
    $('s-cash').textContent = money(state.cash);
    $('s-cash').className = state.cash < 0 ? 'bad' : '';
    $('s-rep').textContent = Math.round(state.rep);
    $('s-rp').textContent = Math.floor(state.rp);
    for (const b of document.querySelectorAll('#speed button')) b.classList.toggle('on', +b.dataset.speed === state.speed);
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const s of document.querySelectorAll('.tab')) s.classList.toggle('on', s.id === 'tab-' + tab);
  }

  function refresh() {
    header();
    if (tab === 'ops') renderOps();
    else if (tab === 'contracts') renderContracts();
    else if (tab === 'hangar') renderHangar();
    else if (tab === 'research') renderResearch();
    else if (tab === 'base') renderBase();
    else if (tab === 'network') renderNetwork();
    else if (tab === 'ventures') renderVentures();
    if (tab !== 'network') { const U = NETUI(); if (U && U.hide) U.hide(); }
    if (tab !== 'base') { const C = CAMPUS(); if (C && C.dispose) { try { C.dispose(); } catch (e) { /* ignore */ } } }
    if (sheet && sheet.live) renderSheet();
  }

  // ---------- Helpers ----------
  const ready = () => state.vehicles.filter((v) => v.status === 'ready');
  const building = () => state.vehicles.filter((v) => v.status === 'building');
  function recoveryModes() {
    return Object.keys(S.RECOVERY).filter((k) => {
      const r = S.RECOVERY[k];
      if (r.tech && !state.techs[r.tech]) return false;
      if (r.needs && !state.owned[r.needs]) return false;
      return true;
    });
  }
  function bestReuse() {
    const m = recoveryModes().filter((k) => k !== 'expend');
    return m.includes('catch') ? 'catch' : m.includes('barge') ? 'barge' : m[0] || null;
  }
  function stagesLabel(d) {
    return d.stages.map((s) => `${s.count}× ${S.ENGINES[s.engine].name}`).join(' / ') + (EN() ? EN().srbLabel(d) : '');
  }
  function sameBooster(a, b) { return a.engine === b.engine && a.count === b.count && a.prop === b.prop; }
  function boostersFor(design) { return state.boosters.filter((b) => sameBooster(b.stage, design.stages[0])); }
  // playtest #15: which designs can fly a landed booster again, and what scrapping it pays.
  function designsForBooster(x) { return state.designs.filter((d) => sameBooster(x.stage, d.stages[0])); }
  function scrapValue(x) { return Math.round(S.stageCost(x.stage, state.techs, 0) * 0.1 * 100) / 100; }

  // ---------- Ops tab ----------
  function renderOps() {
    const el = $('tab-ops');
    const CR = CREW(); // Crew sub-view of the Launch tab
    if (CR && CR.view === 'crew') { try { CR.render(el, GAME); return; } catch (e) { console.warn('Crew render failed', e); } }
    const r = ready();
    const b = building();
    const show = r[0] ? r[0].design : (b[0] ? b[0].design : state.designs[0]);
    const heroTitle = r[0] ? `${esc(r[0].serial)} is on the pad` : b[0] ? `${esc(b[0].serial)} is being built` : 'No rocket on the pad';
    const heroSub = r[0] ? esc(r[0].design.name) + (r[0].booster ? ` · flown booster (${r[0].booster.flights} flight${r[0].booster.flights > 1 ? 's' : ''})` : '') : b[0] ? `${b[0].days} days to go` : 'Build one in the Hangar';
    let html = (CR ? CR.subnav() : '') + `<div class="hero"><canvas id="hero-canvas"></canvas><div class="over"><h3>${heroTitle}</h3><div class="small dim">${heroSub}</div></div></div>`;
    if (state.won) html += `<div class="card done"><h3>🏆 Mars city founded!</h3><p class="small">You did it on day ${state.day}. Keep flying, or start a new company on the Base tab.</p></div>`;

    html += `<div class="cols"><div><h2>Ready to fly</h2>`;
    if (!r.length) html += `<div class="empty">No rockets ready. ${b.length ? 'One is in the factory.' : `<br><button class="btn primary sm" data-act="go-hangar" style="margin-top:8px">Build a rocket</button>`}</div>`;
    for (const v of r) {
      html += `<div class="card"><div style="display:flex;gap:8px;align-items:center"><div class="grow"><h3>${esc(v.serial)} <span class="dim small">${esc(v.design.name)}</span></h3>
        <div class="small dim">${stagesLabel(v.design)}${v.booster ? ` · <span class="acc">flown booster ×${v.booster.flights}</span>` : ''}</div></div></div>
        <div class="btns"><button class="btn primary sm" data-act="go-contracts">Pick a contract</button><button class="btn sm" data-act="test" data-id="${v.id}">Test flight</button>${OPS() ? OPS().vehicleBtn(state, v) : ''}</div></div>`;
    }
    if (OPS()) html += OPS().opsLeftHtml(state); // launch ops: test stand + investigations
    if (b.length) {
      html += `<h2>In the factory <span class="dim">(${state.factory} line${state.factory > 1 ? 's' : ''})</span></h2>`;
      b.forEach((v, i) => {
        const p = 1 - v.days / v.total;
        html += `<div class="card"><div style="display:flex;justify-content:space-between"><b>${esc(v.serial)} <span class="dim small">${esc(v.design.name)}</span></b><span class="small ${i < state.factory ? '' : 'dim'}">${i < state.factory ? `${v.days} days` : 'Waiting for a line'}</span></div><div class="bar"><i style="width:${pct(p)}"></i></div></div>`;
      });
    }
    if (state.boosters.length) {
      // playtest #15: show which designs fit each booster, and let the player scrap orphans.
      html += `<h2>Landed boosters</h2><div class="card small">${state.boosters.map((x) => {
        const fits = designsForBooster(x);
        return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;flex-wrap:wrap"><span class="pill acc">${esc(x.id)} · ${x.flights} flight${x.flights > 1 ? 's' : ''}</span>
          <span class="grow ${fits.length ? '' : 'bad'}">${fits.length ? `✓ Fits ${fits.map((d) => esc(d.name)).join(', ')}` : '⚠ No design fits it any more'}</span>
          <button class="btn sm" data-act="scrap-booster" data-id="${esc(x.id)}">Scrap · +${money(scrapValue(x))}</button></div>`;
      }).join('')}<p class="dim">Build a design that fits in the Hangar to reuse one.</p></div>`;
    }
    html += `</div><div>${OPS() ? OPS().opsWeatherHtml(state) : ''}${haloOpsCard()}${CR ? CR.opsCard(state) : ''}${WND() ? WND().opsCard(state) : '' /* windows: transits + calendar */}<h2>Goals</h2><div class="card">`;
    for (const m of MILESTONES) {
      const done = state.milestones[m.id];
      const extra = m.id === 'marsCity' ? ` (${state.marsCity}/5)` : '';
      html += `<div class="small" style="padding:4px 0">${done ? '✅' : '⬜'} ${m.name}${extra}${!done && m.cash ? ` <span class="dim">· bonus ${money(m.cash)}, ${m.rp} science</span>` : ''}</div>`;
    }
    html += `</div><h2>Mission log</h2><div class="card log">${state.log.slice(0, 14).map((l) => `<div>Day ${l.day} · ${l.text}</div>`).join('')}</div></div></div>`;
    el.innerHTML = html;
    D.drawPadScene($('hero-canvas'), r[0] ? show : null, state.techs);
  }

  // ---------- Halo network ----------
  function haloOpsCard() {
    const N = NET();
    if (!N) return '';
    const sm = netSummary();
    if (!sm || !sm.founded) {
      if (!state.milestones.firstOrbit) return '';
      const can = N.canFound ? N.canFound(state) : { ok: false };
      return `<h2>🛰️ Halo internet</h2><div class="card tap" data-act="go-network"><b>Start your own satellite internet company</b>
        <div class="small dim">${can.ok ? 'Ready to found. Build a constellation and sell internet from space.' : esc(can.why || 'Not available yet.')}</div>
        <div class="btns"><button class="btn primary sm" data-act="go-network">Open Network ▸</button></div></div>`;
    }
    const pm = sm.profitMonth || 0;
    return `<h2>🛰️ Halo internet</h2><div class="card tap" data-act="go-network">
      <div class="kv" style="margin-top:0"><div><small>Subscribers</small><b>${fmtInt(sm.subs || 0)}</b></div>
      <div><small>Profit / month</small><b class="${pm >= 0 ? 'good' : 'bad'}">${pm >= 0 ? '▲' : '▼'} ${money(pm)}</b></div>
      <div><small>Sats in orbit</small><b>${fmtInt((sm.sats && sm.sats.orbit) || 0)}</b></div>
      <div><small>Coverage</small><b>${pct(sm.coverage || 0)}</b></div></div>
      <div class="btns"><button class="btn sm" data-act="go-network">Open Network ▸</button></div></div>`;
  }
  function fmtInt(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
    if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
    return n.toLocaleString();
  }
  function renderNetwork() {
    const el = $('tab-network');
    const U = NETUI();
    if (!U || !U.render) { el.innerHTML = '<div class="empty">The Network module did not load. Reload the page.</div>'; return; }
    try { U.render(el, GAME); } catch (e) { console.error(e); el.innerHTML = `<div class="empty">Network screen error: ${esc(e.message)}</div>`; }
  }
  function renderVentures() {
    const el = $('tab-ventures');
    const U = VENTUI();
    if (!U || !U.render) { el.innerHTML = '<div class="empty">The Ventures module did not load. Reload the page.</div>'; return; }
    try { U.render(el, GAME); } catch (e) { console.error(e); el.innerHTML = `<div class="empty">Ventures screen error: ${esc(e.message)}</div>`; }
  }
  // Network tab hands us a 'halo' batch contract; fly it with the normal launch sheet.
  function openLaunchFor(contract) {
    if (!contract) return;
    state.contracts = state.contracts.filter((x) => !isOwn(x) || x.kind !== contract.kind || x.id === contract.id);
    if (!state.contracts.some((x) => x.id === contract.id)) state.contracts.push(contract);
    save();
    startLaunch(contract.id);
  }
  const GAME = {
    get state() { return state; },
    save, refresh, log, toast, money, esc, openLaunchFor,
    pct, tons, fmtInt,
    goTab(t) { tab = t; window.scrollTo(0, 0); refresh(); },
    dayTick() { dayTick(); refresh(); },
    bestLift(target) {
      // Best payload any ready rocket can carry to target (reusable if possible, else expended).
      let best = { mass: 0, v: null, rec: null }, reuse = { mass: 0, v: null, rec: null };
      for (const v of ready()) {
        for (const rec of recoveryModes()) {
          const cap = S.capacity(v.design, target || 'LEO', rec, state.techs);
          if (cap > best.mass) best = { mass: cap, v, rec };
          if (rec !== 'expend' && cap > reuse.mass) reuse = { mass: cap, v, rec };
        }
      }
      return reuse.mass >= 1 ? Object.assign(reuse, { expendMass: best.mass }) : best;
    },
    readyCount() { return ready().length; },
    get tab() { return tab; },
  };
  window.APOGEE_GAME = GAME;

  // ---------- Contracts tab ----------
  function contractFit(c) {
    // Best ready vehicle and recovery that can fly it.
    let best = null;
    for (const v of ready()) {
      for (const rec of recoveryModes().slice().reverse()) {
        const m = S.mission(v.design, c.mass, c.target, rec, state.techs);
        if (m.ok) { if (!best || (rec !== 'expend' && best.rec === 'expend')) best = { v, rec, m }; break; }
      }
    }
    return best;
  }
  function bestDesignFor(c) {
    let best = null;
    for (const d of state.designs) {
      if (S.validate && S.validate(d, state.techs).length) continue;
      const cap = S.capacity(d, c.target, 'expend', state.techs);
      if (!best || cap > best.cap) best = { d, cap };
    }
    return best;
  }
  function renderContracts() {
    const el = $('tab-contracts');
    const list = state.contracts.filter((c) => !isOwn(c)).sort((a, b) => b.reward - a.reward);
    let html = `<h2>Open contracts</h2><p class="small dim" style="margin:-4px 2px 10px">New offers arrive every few days. Higher reputation unlocks bigger jobs.</p>`;
    if (WND()) html += WND().contractsCard(state); // windows: Mars/Moon calendar
    if (!list.length) html += `<div class="empty">No offers right now. Check back in a few days.</div>`;
    html += '<div class="grid">';
    // Rideshare cards (rideshare.js): best ready rocket's capacity to each orbit.
    if (RS()) {
      try {
        html += RS().contractCards(state, { money, tons, fit: (t) => { const b = rideBest(t); return b ? { v: b.v, cap: b.cap } : null; } });
      } catch (e) { console.warn('Rideshare cards failed', e); }
    }
    for (const c of list) {
      const fit = contractFit(c);
      const t = S.TARGETS[c.target];
      const days = c.expires - state.day;
      const needsCapsule = c.crew && !state.techs.capsule;
      html += `<div class="card tap" data-act="contract" data-id="${c.id}">
        <div style="display:flex;gap:10px;align-items:flex-start"><div class="grow">
          <h3>${esc(c.label)}</h3><div class="small dim">${esc(c.client)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill blue">${t.short}</span><span class="pill">${c.crew ? '4 crew · 12 t' : tons(c.mass)}</span><span class="pill ${days < 15 ? 'bad' : ''}">${days} days left</span>${WND() ? WND().contractPill(c, state) : ''}${c.crew && CREW() ? CREW().contractPill(state, c) : ''}
          ${fit ? `<span class="pill good">✓ ${esc(fit.v.serial)} can fly it</span>` : needsCapsule ? '<span class="pill bad">Needs Crew Capsule</span>' : (() => {
            const bd = bestDesignFor(c);
            if (bd && bd.cap >= c.mass) return `<span class="pill">◐ Build a ${esc(bd.d.name)} to fly it</span>`;
            return `<span class="pill bad">✕ Needs ${tons(c.mass)} to ${t.short} · your best design: ${tons(bd ? Math.max(0, bd.cap) : 0)}</span>`;
          })()}</div>
        </div><div class="money" style="font-size:17px">${money(c.reward)}</div></div></div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ---------- Hangar tab ----------
  function renderHangar() {
    const el = $('tab-hangar');
    let html = `<h2>Rocket designs</h2><div class="grid">`;
    const reuse = bestReuse();
    for (const d of state.designs) {
      const cost = S.designCost(d, state.techs) - fairSave(); // fairing halves in stock make it cheaper
      const days = S.buildDays(d, state.factory);
      const errs = S.validate(d, state.techs);
      const leoX = S.capacity(d, 'LEO', 'expend', state.techs);
      const leoR = reuse ? S.capacity(d, 'LEO', reuse, state.techs) : 0;
      const gto = S.capacity(d, 'GTO', 'expend', state.techs);
      const fb = boostersFor(d);
      // playtest #2: say what reuse is worth, or why this design can't land.
      const reflightSave = reuse && leoR > 0 ? S.stageCost(d.stages[0], state.techs, 0) * (1 - S.refurbFrac(state.techs, reuse)) : 0;
      const reuseNote = !reuse ? '' : leoR > 0 ? `<p class="small good">♻️ Saves ≈${money(reflightSave)} per reflight</p>` : `<p class="small bad">⚠ Too small to land: design a bigger booster</p>`;
      html += `<div class="card"><div style="display:flex;gap:10px"><div class="grow"><h3><span style="color:${d.color}">■</span> ${esc(d.name)}</h3>
        <div class="small dim">${stagesLabel(d)}</div></div><button class="btn sm" data-act="edit" data-id="${d.id}">Edit</button></div>
        <div class="kv"><div><small>To LEO</small><b>${tons(leoX)}</b></div>${reuse ? `<div><small>LEO, reusable</small><b>${tons(leoR)}</b></div>` : ''}<div><small>To GTO</small><b>${tons(gto)}</b></div><div><small>Cost</small><b>${money(cost)}</b></div><div><small>Build</small><b>${days} days</b></div></div>
        ${reuseNote}${errs.length ? `<p class="small bad">${errs.map(esc).join('<br>')}</p>` : ''}
        <div class="btns"><button class="btn primary sm" data-act="build" data-id="${d.id}" ${errs.length || state.cash < cost ? 'disabled' : ''}>Build new · ${money(cost)}</button>
        ${fb.length ? `<button class="btn go sm" data-act="build-reuse" data-id="${d.id}" ${state.cash < reuseCost(d, fb[0]) ? 'disabled' : ''}>Reuse ${esc(fb[0].id)} · ${money(reuseCost(d, fb[0]))}</button>` : ''}</div></div>`;
    }
    html += `</div><button class="btn big" data-act="new-design" style="max-width:340px">+ New rocket design</button>`;
    if (RS()) { try { html += RS().hangarCard(state, { money }); } catch (e) { console.warn(e); } } // fairing stock
    html += `<p class="small dim" style="margin-top:12px">Tip: a booster that lands keeps its slot here. Build the same design again and you only pay to refurbish it.</p>`;
    el.innerHTML = html;
  }

  function reuseCost(d, b) {
    const s0 = S.stageCost(d.stages[0], state.techs, 0);
    return S.designCost(d, state.techs) - s0 + s0 * b.refurb - fairSave();
  }

  function build(designId, reuse) {
    const d = state.designs.find((x) => x.id === designId);
    if (!d) return;
    let cost = S.designCost(d, state.techs) - fairSave(); // reuses recovered fairing halves
    let days = S.buildDays(d, state.factory);
    let booster = null;
    if (reuse) {
      booster = boostersFor(d)[0];
      if (!booster) return;
      cost = reuseCost(d, booster);
      days = Math.max(booster.days, Math.round(days * 0.45));
    }
    if (state.cash < cost) { toast('Not enough cash.'); return; }
    if (booster) state.boosters = state.boosters.filter((x) => x !== booster);
    state.cash -= cost;
    const usedHalves = fairSave() > 0 && RS() ? RS().useFairings(state) : 0; // take halves out of stock
    const prefix = d.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'RK';
    const serial = `${prefix}-${++state.serial}`;
    state.vehicles.push({ id: 'v' + state.nextId++, design: clone(d), designId: d.id, serial, status: 'building', days, total: days, cost, booster: booster ? { id: booster.id, flights: booster.flights } : null });
    log(`Started building <b>${serial}</b> (${esc(d.name)})${booster ? ` on flown booster ${esc(booster.id)}` : ''}${usedHalves ? ` with ${usedHalves} recovered fairing ${usedHalves > 1 ? 'halves' : 'half'}` : ''} for <b>${money(cost)}</b>.`);
    toast(`🛠️ Building ${serial} · ${days} days`);
    save(); refresh();
  }

  // ---------- Research tab ----------
  function renderResearch() {
    const el = $('tab-research');
    let html = `<h2>Research</h2><div class="card row"><div class="grow"><b>${Math.floor(state.rp)} science</b><div class="small dim">+${(state.engineers * S.FACILITY.rpPerEngineerDay).toFixed(2)} a day from ${state.engineers} engineers, plus every launch. Hire more on the Base tab.</div></div></div>`;
    // playtest #26: group by branch and point at a recommended next item.
    const ids = Object.keys(S.TECHS);
    const BRANCHES = [['♻️ Reuse', ['legs', 'fairing', 'barge', 'rapid', 'tower', 'shipreuse']], ['🔥 Engines', ['lighttanks', 'spark', 'srb', 'forge', 'srbheavy', 'frost', 'comet', 'aerospike', 'steel', 'nova']], ['🪐 Deep space & crew', ['capsule', 'refill', 'habitat']]];
    const known = new Set(BRANCHES.flatMap((x) => x[1]));
    const extra = ids.filter((id) => !known.has(id));
    if (extra.length) BRANCHES.push(['🧪 More', extra]);
    const avail = ids.filter((id) => !state.techs[id] && S.TECHS[id].req.every((r) => state.techs[r]));
    const PATH = ['legs', 'comet', 'rapid', 'barge', 'steel', 'capsule', 'refill', 'habitat']; // the road to Mars
    const rec = PATH.find((id) => avail.includes(id)) || avail.sort((a, b) => S.TECHS[a].rp - S.TECHS[b].rp)[0] || null;
    if (rec) {
      const t = S.TECHS[rec];
      html += `<div class="card rec-next"><div class="tech"><div class="ic">${TECH_ICONS[rec] || t.icon || '🔬'}</div><div class="grow"><div class="small acc">⭐ Recommended next</div><b>${t.name}</b><div class="small dim">${t.desc}</div>
        ${state.rp < t.rp ? `<div class="small dim">${Math.ceil(t.rp - state.rp)} more science needed</div>` : ''}</div>
        <button class="btn sm ${state.rp >= t.rp ? 'primary' : ''}" data-act="research" data-id="${rec}" ${state.rp >= t.rp ? '' : 'disabled'}>${t.rp} 🔬</button></div></div>`;
    }
    for (const [label, list] of BRANCHES) {
      const inTree = list.filter((id) => S.TECHS[id]);
      if (!inTree.length) continue;
      const nDone = inTree.filter((id) => state.techs[id]).length;
      html += `<h2>${label} <span class="dim small">${nDone}/${inTree.length} done</span></h2><div class="grid">`;
      for (const id of inTree) {
        const t = S.TECHS[id];
        const done = state.techs[id];
        const reqOk = t.req.every((r) => state.techs[r]);
        const can = !done && reqOk && state.rp >= t.rp;
        html += `<div class="card ${done ? 'done' : reqOk ? '' : 'locked'}"><div class="tech"><div class="ic">${TECH_ICONS[id] || t.icon || '🔬'}</div><div class="grow">
          <b>${t.name}</b>${id === rec ? ' <span class="pill acc">⭐ Recommended</span>' : ''}<div class="small dim">${t.desc}</div>
          ${!reqOk ? `<div class="small bad">🔒 Needs: ${t.req.filter((r) => !state.techs[r]).map((r) => S.TECHS[r] ? S.TECHS[r].name : r).join(', ')}</div>` : ''}</div>
          ${done ? '<span class="pill good">✓ Done</span>' : `<button class="btn sm ${can ? 'primary' : ''}" data-act="research" data-id="${id}" ${can ? '' : 'disabled'}>${t.rp} 🔬</button>`}</div></div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  }

  // ---------- Base tab ----------
  function renderBase() {
    const el = $('tab-base');
    const C = CAMPUS();
    if (C && C.render && state.campus) { try { C.render(el, GAME); return; } catch (e) { console.warn('Campus render failed', e); } }
    const f = state.factory;
    const st = state.stats;
    const monthly = state.engineers * S.FACILITY.engineerSalary + 0.1 * f + (state.owned.barge ? 0.2 : 0) + (state.owned.tower ? 0.3 : 0);
    let html = `<h2>Team</h2><div class="card"><div style="display:flex;align-items:center;gap:10px"><div class="grow"><b>👷 ${state.engineers} engineers</b><div class="small dim">Each makes ${S.FACILITY.rpPerEngineerDay} science a day and costs ${money(S.FACILITY.engineerSalary)} a month.</div></div></div>
      <div class="btns"><button class="btn primary sm" data-act="hire" ${state.cash < hireCost() ? 'disabled' : ''}>Hire · ${money(hireCost())}</button><button class="btn sm" data-act="fire" ${state.engineers <= 1 ? 'disabled' : ''}>Let one go</button></div></div>`;
    html += `<h2>Facilities</h2><div class="grid">`;
    html += `<div class="card"><b>🏭 Factory, level ${f}</b><div class="small dim">${f} build line${f > 1 ? 's' : ''} at ${(1 + 0.5 * (f - 1)).toFixed(1)}× speed.</div>
      ${f < 5 ? `<div class="btns"><button class="btn primary sm" data-act="factory" ${state.cash < S.FACILITY.factoryCost(f) ? 'disabled' : ''}>Upgrade · ${money(S.FACILITY.factoryCost(f))}</button></div>` : '<div class="small good">Max level</div>'}</div>`;
    html += facilityCard('barge', '🚢 Ocean landing barge', 'Land boosters at sea so you keep more fuel for the payload.', S.FACILITY.bargeCost);
    html += facilityCard('tower', '🦾 Catch tower', 'Mechanical arms catch boosters right out of the air. 2-day turnaround.', S.FACILITY.towerCost);
    html += `</div><h2>Company</h2><div class="card"><div class="kv">
      <div><small>Launches</small><b>${st.launches}</b></div><div><small>Successes</small><b>${st.successes}</b></div>
      <div><small>Landings</small><b>${st.landings}</b></div><div><small>Reflights</small><b>${st.reflights}</b></div>
      <div><small>Earned</small><b>${money(st.earned)}</b></div><div><small>Monthly costs</small><b>${money(monthly)}</b></div></div></div>`;
    html += `<h2>Game</h2><div class="card small dim">Your game saves on this device automatically.<div class="btns"><button class="btn sm" data-act="help">How to play</button><button class="btn sm danger" data-act="reset">Start a new company</button></div></div>`;
    el.innerHTML = html;
  }
  // playtest #4: hiring gets gently dearer as the team grows (same rule as campus.js hireCost).
  function hireCost() {
    const C = CAMPUS();
    if (C && C.hireCost && state.campus) return C.hireCost(state);
    return Math.round(S.FACILITY.engineerHire * (1 + 0.06 * Math.max(0, state.engineers - 5)) * 100) / 100;
  }
  function facilityCard(id, name, desc, cost) {
    const tech = S.RECOVERY[id === 'barge' ? 'barge' : 'catch'].tech;
    const have = state.owned[id];
    const unlocked = state.techs[tech];
    return `<div class="card ${unlocked ? '' : 'locked'}"><b>${name}</b><div class="small dim">${desc}</div>
      ${have ? '<div class="small good">Built</div>' : unlocked ? `<div class="btns"><button class="btn primary sm" data-act="buy" data-id="${id}" ${state.cash < cost ? 'disabled' : ''}>Build · ${money(cost)}</button></div>` : `<div class="small bad">Research ${S.TECHS[tech].name} first</div>`}</div>`;
  }

  // ---------- Sheets ----------
  function openSheet(s) { sheet = s; $('sheet-wrap').hidden = false; renderSheet(); }
  function closeSheet() { sheet = null; $('sheet-wrap').hidden = true; $('sheet').innerHTML = ''; refresh(); }

  function renderSheet() {
    if (!sheet) return;
    const el = $('sheet');
    el.classList.toggle('wide', sheet.kind === 'editor');
    if (sheet.kind === 'launch') el.innerHTML = launchSheet();
    else if (sheet.kind === 'editor') { el.innerHTML = editorSheet(); editorAfter(); }
    else if (sheet.kind === 'intro') el.innerHTML = introSheet();
    else if (sheet.kind === 'bankrupt') el.innerHTML = `<div class="head"><h3>💸 Out of money</h3></div><p>The bank has pulled the plug on day ${state.day}. Every great rocket company nearly went broke at least once.</p><button class="btn primary big" data-act="reset-now">Start a new company</button>`;
  }

  function introSheet() {
    return `<div class="head"><h3>🚀 Welcome to Apogee</h3></div>
      <p>You just founded a rocket company with <b>$40M</b>, four engineers and one small rocket, the <b>Pathfinder</b>.</p>
      <p class="small">• <b>Contracts</b>: customers pay you to put things in space. Pick one your rocket can lift.<br>
      • <b>Hangar</b>: design rockets stage by stage. Watch thrust-to-weight (above 1.2) and delta-v.<br>
      • <b>Research</b>: unlock landing legs, then land boosters and fly them again for a fraction of the price.<br>
      • You can fly the landings yourself. Hold BURN to slow down and touch down gently.<br>
      • The goal: build a city on Mars.</p>
      <p class="small dim">Time moves on its own. Use ❚❚ to pause and ▶▶ to speed up.</p>
      <button class="btn primary big" data-act="intro-done">Start the company</button>`;
  }

  // ----- Launch sheet -----
  function startLaunch(contractId, vehicleId) {
    const c = contractId ? state.contracts.find((x) => x.id === contractId) : null;
    const r = ready();
    let vid = vehicleId || null;
    if (!vid && c) { const fit = contractFit(c); vid = fit ? fit.v.id : (r[0] && r[0].id); }
    if (!vid && r[0]) vid = r[0].id;
    const s = { kind: 'launch', contractId, vehicleId: vid, recovery: null, landing: state.lastLanding || 'auto', upperReuse: false };
    s.recovery = pickRecovery(s);
    openSheet(s);
  }
  // Rideshare: the ready rocket with the most capacity to an orbit.
  function rideBest(target) {
    let best = null;
    for (const v of ready()) {
      const cap = S.capacity(v.design, target, 'expend', state.techs);
      if (!best || cap > best.cap) best = { v, cap };
    }
    return best;
  }
  function startRide(target) {
    const b = rideBest(target);
    const s = { kind: 'launch', contractId: null, ride: { target, picks: [] }, vehicleId: b ? b.v.id : null, recovery: null, landing: state.lastLanding || 'auto', upperReuse: false };
    s.recovery = pickRecovery(s);
    s.ride.picks = RS().fill(state, target, rideCap(s));
    openSheet(s);
  }
  function rideCap(s) {
    const v = state.vehicles.find((x) => x.id === s.vehicleId && x.status === 'ready');
    return v ? S.capacity(v.design, s.ride.target, s.recovery, state.techs, { upperReuse: s.upperReuse }) : 0;
  }
  function launchCtx(s) {
    const c = s.ride && RS() ? RS().contract(state, s.ride) : s.contractId ? state.contracts.find((x) => x.id === s.contractId) : null;
    const v = state.vehicles.find((x) => x.id === s.vehicleId && x.status === 'ready');
    const payload = c ? c.mass : 0;
    const target = c ? c.target : 'LEO';
    return { c, v, payload, target };
  }
  function pickRecovery(s) {
    const { v, payload, target } = launchCtx(s);
    if (!v) return 'expend';
    const modes = recoveryModes();
    for (const k of ['catch', 'barge', 'rtls']) {
      if (modes.includes(k) && S.mission(v.design, payload, target, k, state.techs, { upperReuse: s.upperReuse }).ok) return k;
    }
    return 'expend';
  }
  function tankerUnit(design, recovery, upperReuse) {
    const n = design.stages.length;
    let cost = 0;
    design.stages.forEach((st, i) => {
      const c = S.stageCost(st, state.techs, i);
      if (i === 0) cost += recovery === 'expend' ? c : c * S.refurbFrac(state.techs, recovery);
      else cost += upperReuse && i === n - 1 ? c * 0.1 : c;
    });
    return cost + S.srbCost(design); // side boosters are never reused
  }
  const PADKIT = () => window.APOGEE_PADKIT; // Pad kit (padkit.js): launch pad types and towers
  function launchSheet() {
    const s = sheet;
    const { c, v, payload, target } = launchCtx(s);
    const t = S.TARGETS[target];
    let html = `<div class="head"><h3>${c ? esc(c.label) : 'Test flight'}</h3><button class="x" data-act="close">✕</button></div>`;
    html += isDc(c) ? `<div class="small dim">🖥️ ${c.count || '?'} compute modules for your orbital data center · ${t.name} · ${tons(c.mass)} · no payment, the modules earn money in orbit</div>`
      : isHalo(c) ? `<div class="small dim">🛰️ ${c.count || '?'} Halo sats for your own network · ${t.name} · ${tons(c.mass)} · no payment, the sats earn money in orbit</div>`
      : c ? `<div class="small dim">${esc(c.client)} · ${t.name} · ${c.crew ? '4 crew in a 12 t capsule' : tons(c.mass)} · pays <span class="money">${money(c.reward)}</span></div>`
      : `<div class="small dim">No payload. Builds flight experience for your engines and earns science.</div>`;
    if (c && c.crew && !state.techs.capsule) {
      return html + `<div class="empty" style="margin-top:12px">You need the <b>Crew Capsule</b> research to fly people.</div>`;
    }
    const r = ready();
    if (!r.length) {
      return html + `<div class="empty" style="margin-top:12px">No rocket is ready.<br><button class="btn primary sm" data-act="go-hangar" style="margin-top:8px">Go to the Hangar</button></div>`;
    }
    html += `<h2>Rocket</h2><div class="seg">${r.map((x) => `<button data-act="l-veh" data-id="${x.id}" class="${v && x.id === v.id ? 'on' : ''}">${esc(x.serial)} · ${esc(x.design.name)}</button>`).join('')}</div>`;
    if (!v) return html;
    const modes = recoveryModes();
    html += `<h2>Booster</h2><div class="seg">${Object.keys(S.RECOVERY).map((k) => {
      const r2 = S.RECOVERY[k];
      const ok = modes.includes(k);
      return `<button data-act="l-rec" data-id="${k}" class="${s.recovery === k ? 'on' : ''}" ${ok ? '' : 'disabled'}>${r2.name}${ok ? '' : ' 🔒'}</button>`;
    }).join('')}</div>`;
    const lockHints = { rtls: 'Land back at the pad: research Landing Legs (🔬 Research tab)', barge: 'Ocean barge: research Ocean Landing Barge, then build a Drone ship port on Base', catch: 'Tower catch: research Tower Catch, then build a Catch tower next to a pad or add catch arms to a pad tower' };
    const locked = Object.keys(lockHints).filter((k) => !modes.includes(k));
    if (locked.length) html += `<p class="small dim">🔒 ${locked.map((k) => lockHints[k]).join('<br>🔒 ')}</p>`;
    if (s.recovery !== 'expend') {
      const opts = [['auto', 'Autopilot'], ['steer', s.recovery === 'barge' ? '🚢 Move the barge' : '🎯 Steer it'], ['manual', '🎮 Full manual']];
      const hint = { auto: 'Lands by itself, using the odds below.', steer: s.recovery === 'barge' ? 'The booster burns by itself. You slide the barge under it with ← →.' : 'The booster burns by itself. You steer it onto the target with ← →.', manual: 'You do everything: burn and steer.' }[s.landing];
      html += `<h2>Landing</h2><div class="seg">${opts.map(([k, l]) => `<button data-act="l-land" data-id="${k}" class="${s.landing === k ? 'on' : ''}">${l}</button>`).join('')}</div><p class="small dim">${hint}</p>`;
    }
    if (state.techs.shipreuse && v.design.stages.length > 1) {
      html += `<h2>Upper stage</h2><div class="seg"><button data-act="l-up" data-id="0" class="${!s.upperReuse ? 'on' : ''}">Expend</button><button data-act="l-up" data-id="1" class="${s.upperReuse ? 'on' : ''}">Bring it home (refund 90%)</button></div>`;
    }
    if (isRide(c)) html += RS().pickerHtml(state, s.ride, rideCap(s), { money, tons }); // pick rideshare customers
    const m = S.mission(v.design, payload, target, s.recovery, state.techs, { upperReuse: s.upperReuse });
    const wnd = c && !isOwn(c) && WND() ? WND().apply(m, target, state) : null; // windows: Moon penalty / Mars block
    const pk = PADKIT() ? PADKIT().launchInfo(state, s, { design: v.design, liftoff: m.perf.liftoff, recovery: s.recovery, crew: !!(c && c.crew) }) : null; // Pad kit: pick pad, check mass/tower
    if (pk) html += pk.html;
    // Launch ops: weather, static fire and investigations adjust the odds; Pad kit adds a small pad bonus.
    const odds0 = S.launchOdds(v.design, state.heritage, state.designFlights[v.designId] || 0, OPS() ? OPS().launchMod(state, v) : undefined), odds = pk ? pk.adj(odds0) : odds0;
    const lodds = S.landingOdds(s.recovery, state.landings, state.techs, OPS() ? OPS().landMod(state, s.recovery) : undefined);
    if (OPS()) html += OPS().sheetHtml(state, v, s);
    if (window.APOGEE_DAYNIGHT) html += window.APOGEE_DAYNIGHT.sheetLine(state); // day/night: launch time
    const tankCost = m.tankers ? m.tankers * tankerUnit(v.design, s.recovery, s.upperReuse) : 0;
    const ratio = Math.min(1.4, m.have / m.need);
    // Crew flights: show crew + capsule, add the abort-system note, block launch until a crew is ready.
    const crewChk = c && c.crew && CREW() ? CREW().check(state, c) : { ok: true, html: '', abort: '' };
    html += crewChk.html;
    html += `<h2>Flight check</h2><div class="card">
      <div style="display:flex;justify-content:space-between"><span class="small">Delta-v ${m.refilled ? '(after refilling)' : ''}</span><b class="${m.ok ? 'good' : 'bad'}">${Math.round(m.have).toLocaleString()} / ${m.need.toLocaleString()} m/s</b></div>
      <div class="bar ${m.ok ? 'good' : 'bad'}"><i style="width:${Math.min(100, ratio / 1.4 * 100)}%"></i><span class="mark" style="left:${100 / 1.4}%"></span></div>
      <div class="kv"><div><small>Liftoff TWR</small><b class="${m.twr >= 1.2 ? '' : 'bad'}">${m.twr.toFixed(2)}</b></div><div><small>Launch success</small><b>${pct(odds)}</b></div>
      ${s.recovery !== 'expend' && s.landing === 'auto' ? `<div><small>Landing (auto)</small><b>${pct(lodds)}</b></div>` : ''}
      ${m.tankers ? `<div><small>Tanker flights</small><b>${m.tankers} · ${money(tankCost)}</b></div>` : ''}
      ${c && !isOwn(c) ? `<div><small>Contract pays</small><b class="money">${money(c.reward)}</b></div><div><small>This rocket cost</small><b>${money(v.cost || S.designCost(v.design, state.techs))}</b></div>` : ''}
      ${s.recovery !== 'expend' ? `<div><small>Booster saved if it lands</small><b class="good">≈ ${money(S.stageCost(v.design.stages[0], state.techs, 0) * (1 - S.refurbFrac(state.techs, s.recovery)))}</b></div>` : ''}</div>
      ${crewChk.abort}
      ${!m.canLift ? '<p class="small bad">Too heavy to leave the pad. Add engines or remove fuel.</p>' : !m.ok ? `<p class="small bad">Not enough delta-v${s.recovery !== 'expend' ? '. Try expending the booster, or' : '. Try'} a bigger rocket.${S.TARGETS[target].deep && !state.techs.refill ? ' Orbital Refilling research helps for Moon and Mars.' : ''}</p>` : ''}
      </div>`;
    if (wnd) html += WND().launchHtml(wnd, state, target); // windows: status, trip time, arrival odds
    const canPay = state.cash >= tankCost && !(isRide(c) && !c.count); // a rideshare needs at least one customer
    const goOk = m.ok && canPay && !(wnd && wnd.blocked) && crewChk.ok && (!pk || pk.ok);
    const opsBtns = OPS() ? OPS().launchButtons(state, v, s, goOk, c) : null; // launch ops: no-go / risk it / scrub
    html += opsBtns || `<button class="btn primary big" data-act="launch" ${goOk ? '' : 'disabled'}>🚀 Launch ${esc(v.serial)}</button>`;
    if (pk && !pk.ok) html += `<p class="small bad">✕ ${esc(pk.why)}</p>`; // Pad kit: why the launch is blocked
    if (!canPay) html += `<p class="small bad">Not enough cash for the tanker flights.</p>`;
    return html;
  }

  async function launch() {
    const s = sheet;
    const { c, v, payload, target } = launchCtx(s);
    if (!v) return;
    const m = S.mission(v.design, payload, target, s.recovery, state.techs, { upperReuse: s.upperReuse });
    const wnd = c && !isOwn(c) && WND() ? WND().apply(m, target, state) : null; // windows
    if (!m.ok || (wnd && wnd.blocked) || (isRide(c) && !c.count)) return;
    if (OPS() && OPS().gate(state, v).block) return; // launch ops: storm no-go
    const pk = PADKIT() ? PADKIT().launchInfo(state, s, { design: v.design, liftoff: m.perf.liftoff, recovery: s.recovery, crew: !!(c && c.crew) }) : null; // Pad kit
    if (pk && !pk.ok) return;
    const tankCost = m.tankers ? m.tankers * tankerUnit(v.design, s.recovery, s.upperReuse) : 0;
    state.cash -= tankCost;
    const design = v.design;
    const odds0 = S.launchOdds(design, state.heritage, state.designFlights[v.designId] || 0, OPS() ? OPS().launchMod(state, v) : undefined), odds = pk ? pk.adj(odds0) : odds0; // Pad kit bonus
    if (pk) { const note = PADKIT().onLaunch(state, pk.padId, m.perf.liftoff); if (note) log(`🚀 ${note}`); } // Pad kit: turnaround + wear
    let fail = null;
    if (Math.random() > odds) {
      const weights = design.stages.map((st, i) => st.count + 1 + (i === 0 && S.srbOf(design) ? S.srbOf(design).count : 0)); // side boosters fail with stage 1
      let pick = Math.random() * weights.reduce((a, b) => a + b, 0), i = 0;
      while (pick > weights[i]) { pick -= weights[i]; i++; }
      fail = { stage: Math.min(i, design.stages.length - 1), t: 0.15 + Math.random() * 0.75 };
    }
    const autoLand = Math.random() < S.landingOdds(s.recovery, state.landings, state.techs, OPS() ? OPS().landMod(state, s.recovery) : undefined);
    state.vehicles = state.vehicles.filter((x) => x !== v);
    const ctx = { c, v, recovery: s.recovery, landing: s.landing, upperReuse: s.upperReuse, tankers: m.tankers, tankCost, fail, target };
    if (OPS()) ctx.ops = { wx: OPS().today(state).kind, sf: !!v.sfDone }; // launch ops: for the result screen
    if (WND() && WND().takesTime(c)) ctx.transitDays = WND().transitDays(target); // windows: trip length
    if (c && c.crew && CREW()) ctx.crewIds = CREW().board(state, c); // crew boards the capsule
    const crewTxt = c && c.crew && CREW() ? CREW().flightText(state, c) : null;
    closeSheet();
    flying = true;
    // If the page is closed mid-flight, the next load finishes this flight with the pre-rolled outcome.
    state.inFlight = { ctx, res: { dead: !!fail, stage1Ok: !fail || fail.stage > 0, landed: s.recovery !== 'expend' && autoLand && (!fail || fail.stage > 0) } };
    save();
    const t = S.TARGETS[target];
    const res = await F.run({
      design, techs: state.techs, target, fail, recovery: s.recovery, landing: s.landing, autoLand, crew: c && c.crew, pad: pk ? pk.flight : null, // pad: Pad kit 3D look
      payloadKind: isRide(c) ? 'halo' : c && c.kind, satCount: c && c.count, // rideshare reuses the Halo multi-sat deploy
      weather: OPS() ? OPS().flightWeather(state) : null, // launch ops: haze + wind in the 3D flight
      title: isHalo(c) ? `Halo batch · ${c.count} sats` : isDc(c) ? `Compute modules · ${c.count}` : c ? `${c.label} · ${c.client}` : 'Test flight',
      failText: fail ? `Engine failure on stage ${fail.stage + 1}` : '',
      orbitText: isHalo(c) ? 'HALO BATCH DEPLOYED ✓' : isDc(c) ? 'COMPUTE MODULES DEPLOYED ✓' : !c ? 'ORBIT ✓' : t.deep ? 'ON ITS WAY ✓' : 'PAYLOAD DEPLOYED ✓',
      orbitSub: isRide(c) ? `${c.count} rideshare sat${c.count > 1 ? 's' : ''} released to ${t.name}` : isHalo(c) ? `${c.count} sats joining the Halo network` : isDc(c) ? `${c.count} modules joining your orbital data center` : c ? (ctx.transitDays ? (m.refilled ? `Refilled by ${m.tankers} tanker${m.tankers > 1 ? 's' : ''} · ` : '') + WND().orbitSub(target, ctx.transitDays) /* windows */ : m.refilled ? `Refilled by ${m.tankers} tanker flight${m.tankers > 1 ? 's' : ''}, heading for ${t.name}` : `${t.name}`) : 'Test flight complete',
      ...(crewTxt || {}), // crew: orbit/abort banners
    });
    afterFlight(ctx, res);
  }

  function award(id, lines) {
    if (state.milestones[id]) return;
    const m = MILESTONES.find((x) => x.id === id);
    state.milestones[id] = state.day;
    state.cash += m.cash; state.rp += m.rp;
    lines.push([`🏅 ${m.name}`, m.cash ? `+${money(m.cash)} · +${m.rp} 🔬` : '']);
    log(`Milestone: <b>${m.name}</b>!`);
  }

  function afterFlight(ctx, res) {
    delete state.inFlight;
    const { c, v, recovery, fail } = ctx;
    const design = v.design;
    const ok = !res.dead;
    const lines = [];
    state.stats.launches++;
    state.designFlights[v.designId] = (state.designFlights[v.designId] || 0) + 1;
    design.stages.forEach((st, i) => {
      if (!fail || i < fail.stage) state.heritage[st.engine] = (state.heritage[st.engine] || 0) + 1;
    });
    if (ctx.tankCost) lines.push(['Tanker flights', `−${money(ctx.tankCost)}`]);
    const haloLines = (good) => {
      const N = NET();
      let out = [];
      const V = VENT();
      try {
        if (isDc(c)) out = (V && V.onDcResult) ? (V.onDcResult(state, c, good) || []) : [];
        else out = (N && N.onBatchResult) ? (N.onBatchResult(state, c, good) || []) : [];
      } catch (e) { console.warn(e); }
      for (const l of out) lines.push(Array.isArray(l) ? l : [isDc(c) ? '🖥️ Compute' : '🛰️ Halo', l]);
      state.contracts = state.contracts.filter((x) => x.id !== c.id);
    };
    if (ok) {
      state.stats.successes++;
      if (isOwn(c)) {
        state.rep += c.rep || 0;
        state.rp += 4;
        haloLines(true);
        lines.push(['Science', '+4']);
        log(`<b>${esc(v.serial)}</b> deployed <b>${c.count} ${isDc(c) ? 'compute modules' : 'Halo sats'}</b> to low orbit.`);
      } else if (c && WND() && WND().takesTime(c)) {
        // Windows: Moon/Mars craft fly for days; payment, milestones and Mars city count come on arrival.
        WND().depart(state, ctx, lines, { log });
      } else if (isRide(c)) {
        // Rideshare: each customer pays separately (rideshare.js removes them from the queue).
        state.cash += c.reward; state.stats.earned += c.reward;
        state.rep += c.rep;
        const sci = 4 + c.count;
        state.rp += sci;
        if (RS()) { try { for (const l of RS().onResult(state, c, true, { money, tons })) lines.push(l); } catch (e) { console.warn(e); } }
        lines.push(['Reputation', `+${c.rep}`]);
        lines.push(['Science', `+${sci}`]);
        log(`<b>${esc(v.serial)}</b> flew a rideshare to ${S.TARGETS[c.target].name} with ${c.count} small sats. +${money(c.reward)}`);
      } else if (c) {
        state.cash += c.reward; state.stats.earned += c.reward;
        state.rep += c.rep;
        const sci = 4 + Math.round(c.rep / 2);
        state.rp += sci;
        state.contracts = state.contracts.filter((x) => x.id !== c.id);
        lines.push(['Payment', `<span class="money">+${money(c.reward)}</span>`]);
        lines.push(['Reputation', `+${c.rep}`]);
        lines.push(['Science', `+${sci}`]);
        log(`<b>${esc(v.serial)}</b> delivered ${esc(c.client)}'s ${esc(c.label.toLowerCase())} to ${S.TARGETS[c.target].name}. +${money(c.reward)}`);
        if (c.target === 'GTO') award('firstGTO', lines);
        if (c.crew) award('firstCrew', lines);
        if (c.target === 'LLO' || c.target === 'LUN') award('firstMoon', lines);
        if (c.target === 'MTO' || c.target === 'MARS') award('firstMars', lines);
        if (c.kind === 'marscity') {
          state.marsCity++;
          lines.push(['Mars city', `${state.marsCity}/5 cargo ships landed`]);
          if (state.marsCity >= 5 && !state.milestones.marsCity) { award('marsCity', lines); state.won = true; }
        }
      } else {
        state.rp += 6;
        lines.push(['Science', '+6']);
        log(`<b>${esc(v.serial)}</b> test flight reached orbit.`);
      }
      award('firstOrbit', lines);
      if (v.booster) { state.stats.reflights++; award('firstReflight', lines); }
      if (ctx.upperReuse && design.stages.length > 1) {
        const up = S.stageCost(design.stages[design.stages.length - 1], state.techs, design.stages.length - 1) * 0.9;
        state.cash += up;
        lines.push(['Upper stage came home', `+${money(up)}`]);
      }
    } else {
      const repHit = c && c.crew ? 3 : 6; // crew flights: the launch abort system saves the crew
      state.rep = Math.max(0, state.rep - repHit);
      state.rp += 3;
      lines.push(['Result', '<span class="bad">Vehicle lost</span>']);
      lines.push(['Reputation', `−${repHit}`]);
      lines.push(['Science (lessons learned)', '+3']);
      log(`<b>${esc(v.serial)}</b> was lost: ${esc(fail ? `engine failure on stage ${fail.stage + 1}` : 'failure')}.${isHalo(c) ? ` ${c.count} Halo sats were lost with it.` : isDc(c) ? ` ${c.count} compute modules were lost with it.` : c ? ' The customer will wait for another try.' : ''}`);
      if (isOwn(c)) haloLines(false);
    }
    // Crew: dock/abort, station supplies from cargo runs.
    if (c && CREW()) { try { CREW().onFlight(state, ctx, ok, lines); } catch (e) { console.warn('Crew afterFlight failed', e); } }
    // Booster
    if (recovery !== 'expend') {
      if (res.stage1Ok !== false && (ok || (fail && fail.stage > 0))) {
        const before = S.landingOdds(recovery, state.landings, state.techs);
        state.landings[recovery] = (state.landings[recovery] || 0) + 1;
        const after = S.landingOdds(recovery, state.landings, state.techs);
        if (after > before) lines.push(['Autopilot landing odds', `${pct(before)} → ${pct(after)}`]);
        if (res.pinpoint) lines.push(['🎯 Pinpoint landing', 'refurbishing costs half']);
        if (res.landed) {
          state.stats.landings++;
          const flights = (v.booster ? v.booster.flights : 0) + 1;
          const id = v.booster ? v.booster.id : `B${1000 + state.stats.landings}`;
          state.boosters.push({ id, stage: clone(design.stages[0]), flights, refurb: S.refurbFrac(state.techs, recovery) * (res.pinpoint ? 0.5 : 1), days: S.refurbDays(state.techs, recovery) });
          lines.push(['Booster', `<span class="good">Landed · ${id} (${flights} flight${flights > 1 ? 's' : ''})</span>`]);
          log(`Booster <b>${id}</b> ${recovery === 'catch' ? 'was caught by the tower' : 'landed'}!`);
          award('firstLanding', lines);
        } else {
          lines.push(['Booster', '<span class="bad">Lost on landing</span>']);
          log('Booster lost on landing.');
        }
      } else if (!ok) {
        lines.push(['Booster', '<span class="bad">Lost</span>']);
      }
    } else {
      lines.push(['Booster', '<span class="dim">Expended</span>']);
    }
    // Launch ops: open failure investigations, note weather / static fire.
    if (OPS()) { try { for (const ev of OPS().afterFlight(state, ctx, res, lines) || []) log(ev); } catch (e) { console.warn('Launch ops afterFlight failed', e); } }
    // Fairing halves under parafoils: the recovery ship tries to catch them (rideshare.js).
    if (RS()) { try { for (const l of RS().fairingAfterFlight(state, ctx, ok)) lines.push(l); } catch (e) { console.warn('Fairing recovery failed', e); } }
    save();
    const box = $('result');
    box.innerHTML = `<h3>${ok ? (ctx.transit ? `🛰️ On its way · arrives day ${ctx.transit.arrive}` /* windows */ : isHalo(c) ? '✅ Halo batch in orbit' : isDc(c) ? '✅ Compute modules in orbit' : c ? '✅ Mission success' : '✅ Test flight success') : '💥 Mission failed'}</h3>
      ${lines.map(([k, val]) => `<div class="line"><span>${k}</span><b>${val}</b></div>`).join('')}
      <button class="btn primary big" style="margin-top:14px" data-act="flight-done">Continue</button>`;
    box.hidden = false;
  }

  // ----- Editor -----
  function openEditor(designId) {
    let d;
    if (designId) d = clone(state.designs.find((x) => x.id === designId));
    else {
      d = clone(state.designs[state.designs.length - 1]);
      d.id = null; d.name = 'New Rocket ' + (state.designs.length + 1);
      d.color = COLORS[state.designs.length % COLORS.length];
    }
    openSheet({ kind: 'editor', draft: d, origId: designId || null });
  }
  function engineChoices(i) {
    return Object.keys(S.ENGINES).filter((k) => {
      const e = S.ENGINES[k];
      if (e.tech && !state.techs[e.tech]) return false;
      if (i === 0 && e.vac) return false;
      return true;
    });
  }
  function editorSheet() {
    const d = sheet.draft;
    const lim = S.limits(state.techs);
    let html = `<div class="head"><h3>${sheet.origId ? 'Edit rocket' : 'New rocket'}</h3><button class="x" data-act="close">✕</button></div>`;
    html += '<div id="ed-mini" class="ed-mini" aria-live="polite"></div>';
    html += `<div class="editor"><div class="preview"><canvas id="ed-canvas"></canvas></div><div>`;
    html += `<input type="text" id="ed-name" maxlength="24" value="${esc(d.name)}" aria-label="Rocket name">`;
    if (state.techs.capsule) html += `<div class="seg" style="margin:8px 0"><button data-act="ed-nose" data-id="0" class="${sheet.capsule ? '' : 'on'}">Fairing</button><button data-act="ed-nose" data-id="1" class="${sheet.capsule ? 'on' : ''}">👩‍🚀 Crew capsule</button></div>`; // preview only
    html += `<div class="seg" style="margin:8px 0">${COLORS.map((c) => `<button data-act="ed-color" data-id="${c}" class="${d.color === c ? 'on' : ''}" style="color:${c}" aria-label="Stripe color">■</button>`).join('')}</div>`;
    d.stages.forEach((st, i) => {
      const eng = S.ENGINES[st.engine];
      html += `<div class="stage"><div class="st-head"><b>Stage ${i + 1}${i === 0 ? ' · booster' : ''}</b>${i > 0 && i === d.stages.length - 1 ? `<button class="btn sm danger" data-act="ed-rm">Remove</button>` : ''}</div>
        <div class="seg">${engineChoices(i).map((k) => `<button data-act="ed-eng" data-i="${i}" data-id="${k}" class="${st.engine === k ? 'on' : ''}">${S.ENGINES[k].name}</button>`).join('')}</div>
        <div class="small dim" style="margin-top:6px">${EN() ? EN().fuelTag(eng.fuel) : eng.fuel} · ${i === 0 && !eng.vac ? eng.thrustSL : eng.thrustVac} kN · Isp ${i === 0 && !eng.vac ? eng.ispSL + '–' + eng.ispVac : eng.ispVac} s · ${money(eng.cost)} each</div>
        ${EN() && EN().engineNote(st.engine) ? `<div class="small dim">${EN().engineNote(st.engine)}</div>` : ''}
        <div class="field"><label>Engines</label><div class="stepper"><button data-act="ed-cnt" data-i="${i}" data-id="-1">−</button><span>${st.count}</span><button data-act="ed-cnt" data-i="${i}" data-id="1">+</button></div></div>
        <div class="field"><label>Propellant</label><input type="range" data-ed-prop="${i}" min="0" max="1000" step="1" value="${propToPos(st.prop, lim.maxProp)}" aria-label="Stage ${i + 1} propellant">
          <input type="number" class="num" data-ed-num="${i}" min="${PROP_MIN}" max="${lim.maxProp}" step="0.5" value="${st.prop}" aria-label="Stage ${i + 1} propellant in tons"><span class="dim small">t</span></div>
        <div class="nudge">${[-10, -1, -0.5, 0.5, 1, 10].map((n) => `<button class="btn sm" data-act="ed-nudge" data-i="${i}" data-id="${n}">${n > 0 ? '+' : '−'}${Math.abs(n)}</button>`).join('')}</div></div>`;
      if (i === 0 && EN()) html += EN().srbEditorHtml(d, state.techs, money); // side boosters
    });
    if (d.stages.length < lim.maxStages) html += `<button class="btn sm" data-act="ed-add">+ Add a stage on top</button>`;
    html += `<div id="ed-stats"></div>`;
    html += `<div class="btns"><button class="btn primary" data-act="ed-save" id="ed-save">Save design</button>${sheet.origId && state.designs.length > 1 ? '<button class="btn danger" data-act="ed-del">Delete</button>' : ''}</div>`;
    html += `</div></div>`;
    return html;
  }
  function editorAfter() {
    const name = $('ed-name');
    name.addEventListener('input', () => { sheet.draft.name = name.value; });
    const max = S.limits(state.techs).maxProp;
    for (const r of document.querySelectorAll('[data-ed-prop]')) {
      r.addEventListener('input', () => {
        const i = +r.dataset.edProp;
        const v = posToProp(+r.value, max);
        sheet.draft.stages[i].prop = v;
        document.querySelector(`[data-ed-num="${i}"]`).value = v;
        editorStats();
      });
    }
    for (const n of document.querySelectorAll('[data-ed-num]')) {
      const apply = (final) => {
        const i = +n.dataset.edNum;
        let v = parseFloat(n.value);
        if (!isFinite(v)) { if (final) n.value = sheet.draft.stages[i].prop; return; }
        v = clampProp(v, max);
        sheet.draft.stages[i].prop = v;
        document.querySelector(`[data-ed-prop="${i}"]`).value = propToPos(v, max);
        if (final) n.value = v;
        editorStats();
      };
      n.addEventListener('input', () => apply(false));
      n.addEventListener('change', () => apply(true));
    }
    editorStats();
  }
  // Propellant slider is logarithmic so small upper stages and huge boosters both get fine control.
  const PROP_MIN = 1;
  function clampProp(v, max) { return Math.max(PROP_MIN, Math.min(max, Math.round(v * 2) / 2)); }
  function propToPos(v, max) { return Math.round(1000 * Math.log(Math.max(PROP_MIN, v) / PROP_MIN) / Math.log(max / PROP_MIN)); }
  function posToProp(p, max) {
    const raw = PROP_MIN * Math.pow(max / PROP_MIN, p / 1000);
    const step = raw < 20 ? 0.5 : raw < 200 ? 1 : 5;
    return clampProp(Math.round(raw / step) * step, max);
  }
  function editorStats() {
    const d = sheet.draft;
    const errs = S.validate(d, state.techs);
    const p = S.perf(d, 0, 'expend', state.techs);
    const reuse = bestReuse();
    const rows = [['LEO', 'Low orbit'], ['SSO', 'Polar orbit'], ['GTO', 'GTO'], ['LLO', 'Moon orbit'], ['LUN', 'Moon landing'], ['MTO', 'To Mars']];
    let html = `<div class="kv" style="margin-top:10px">
      <div><small>Liftoff mass</small><b>${tons(p.liftoff)}</b></div>
      <div><small>Liftoff TWR</small><b class="${p.twr >= 1.2 ? 'good' : 'bad'}">${p.twr.toFixed(2)}</b></div>
      <div><small>Delta-v (empty)</small><b>${Math.round(p.rawDv).toLocaleString()}</b></div>
      <div><small>Cost</small><b>${money(S.designCost(d, state.techs))}</b></div>
      <div><small>Build time</small><b>${S.buildDays(d, state.factory)} days</b></div></div>`;
    html += `<table class="cap" style="margin-top:10px"><tr><th>Payload to</th><th>Expend</th>${reuse ? `<th>${{ rtls: 'Land at pad', barge: 'Barge', catch: 'Catch' }[reuse]}</th>` : ''}</tr>`;
    for (const [k, label] of rows) {
      const a = S.capacity(d, k, 'expend', state.techs);
      const b = reuse ? S.capacity(d, k, reuse, state.techs) : 0;
      html += `<tr><td>${label}</td><td>${a > 0 ? tons(a) : '—'}</td>${reuse ? `<td>${b > 0 ? tons(b) : '—'}</td>` : ''}</tr>`;
    }
    html += `</table>`;
    if (p.twr < 1.2) errs.push(p.twr < 1.05 ? 'Too heavy to lift off: add engines or less propellant on stage 1.' : 'Low thrust: you lose a lot of delta-v fighting gravity.');
    if (errs.length) html += `<p class="small bad">${errs.map(esc).join('<br>')}</p>`;
    // playtest #15: warn before an edit strands landed boosters that only this design could use.
    const orig = sheet.origId && state.designs.find((x) => x.id === sheet.origId);
    const orphans = orig ? state.boosters.filter((b) => sameBooster(b.stage, orig.stages[0]) && !sameBooster(b.stage, d.stages[0]) && !state.designs.some((o) => o.id !== orig.id && sameBooster(b.stage, o.stages[0]))) : [];
    if (orphans.length) html += `<p class="small bad">⚠ ${orphans.length} landed booster${orphans.length > 1 ? 's' : ''} (${orphans.map((b) => esc(b.id)).join(', ')}) won't fit this change. Keep stage 1 as it was to reuse ${orphans.length > 1 ? 'them' : 'it'}, or make a new design instead.</p>`;
    $('ed-stats').innerHTML = html;
    const leo = S.capacity(d, 'LEO', 'expend', state.techs), gto = S.capacity(d, 'GTO', 'expend', state.techs);
    const lr = reuse ? S.capacity(d, 'LEO', reuse, state.techs) : 0;
    const mini = $('ed-mini');
    if (mini) mini.innerHTML = `<span>TWR <b class="${p.twr >= 1.2 ? 'good' : 'bad'}">${p.twr >= 1.2 ? '' : '⚠ '}${p.twr.toFixed(2)}</b></span><span>LEO <b>${leo > 0 ? tons(leo) : '—'}</b>${reuse ? ` · reuse <b>${lr > 0 ? tons(lr) : '—'}</b>` : ''}</span><span>GTO <b>${gto > 0 ? tons(gto) : '—'}</b></span><span>Cost <b>${money(S.designCost(d, state.techs))}</b></span>${orphans.length ? `<span class="bad">⚠ Strands ${orphans.length} booster${orphans.length > 1 ? 's' : ''}</span>` : ''}`;
    $('ed-save').disabled = S.validate(d, state.techs).length > 0 || p.twr < 1.05;
    D.drawPreview($('ed-canvas'), d, state.techs, { capsule: !!sheet.capsule });
  }

  // ---------- Events ----------
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target.id === 'sheet-wrap' && sheet && sheet.kind !== 'intro' && sheet.kind !== 'bankrupt') closeSheet();
      return;
    }
    const act = el.dataset.act, id = el.dataset.id;
    const lim = S.limits(state.techs);
    switch (act) {
      case 'close': closeSheet(); break;
      case 'go-hangar': if (sheet) closeSheet(); tab = 'hangar'; refresh(); break;
      case 'go-contracts': tab = 'contracts'; refresh(); break;
      case 'go-network': tab = 'network'; window.scrollTo(0, 0); refresh(); break;
      case 'contract': startLaunch(id); break;
      case 'test': startLaunch(null, id); break;
      // Rideshare picker (rideshare.js)
      case 'ride-open': if (RS()) startRide(id); break;
      case 'ride-pick': {
        const p = sheet.ride.picks, i = p.indexOf(id);
        if (i >= 0) p.splice(i, 1); else p.push(id);
        renderSheet(); break;
      }
      case 'ride-fill': sheet.ride.picks = RS().fill(state, sheet.ride.target, rideCap(sheet)); renderSheet(); break;
      case 'ride-clear': sheet.ride.picks = []; renderSheet(); break;
      case 'l-veh': sheet.vehicleId = id; sheet.recovery = pickRecovery(sheet); renderSheet(); break;
      case 'l-rec': sheet.recovery = id; renderSheet(); break;
      case 'l-land': sheet.landing = id; state.lastLanding = id; save(); renderSheet(); break;
      case 'l-up': sheet.upperReuse = id === '1'; renderSheet(); break;
      case 'l-pad': sheet.padId = id; sheet.padAuto = false; renderSheet(); break; // Pad kit: launch pad pick
      case 'launch': launch(); break;
      case 'ops-static': { // launch ops: static fire test
        const r = OPS() && OPS().startStatic(state, id);
        if (r) { if (r.log) log(r.log); toast(r.msg); save(); refresh(); }
        break;
      }
      case 'ops-scrub': { // launch ops: scrub and wait a day (vehicle stays ready, contracts keep ticking)
        if (!sheet || sheet.kind !== 'launch' || !OPS()) break;
        const lc = launchCtx(sheet);
        log(OPS().noteScrub(state, lc.v));
        dayTick();
        const after = sheet && sheet.kind === 'launch' ? launchCtx(sheet) : null;
        if (!after) { refresh(); break; }
        if (sheet.contractId && !after.c) { closeSheet(); toast('⏳ Scrubbed. The contract expired.'); break; }
        toast(`⏳ Scrubbed · day ${state.day}: ${OPS().today(state).icon} ${OPS().today(state).name}`);
        header(); renderSheet();
        break;
      }
      case 'flight-done': F.close(); flying = false; last = performance.now(); refresh(); break;
      case 'build': build(id, false); break;
      case 'build-reuse': build(id, true); break;
      case 'scrap-booster': { // playtest #15
        const x = state.boosters.find((b) => b.id === id);
        if (!x) break;
        if (designsForBooster(x).length && !window.confirm(`Scrap ${x.id}? A design can still reuse it.`)) break;
        const val = scrapValue(x);
        state.boosters = state.boosters.filter((b) => b !== x);
        state.cash += val;
        log(`Scrapped booster <b>${esc(x.id)}</b> for <b>${money(val)}</b>.`);
        toast(`♻️ Scrapped ${esc(x.id)} · +${money(val)}`);
        save(); refresh(); break;
      }
      case 'edit': openEditor(id); break;
      case 'new-design': openEditor(null); break;
      case 'ed-color': sheet.draft.color = id; renderSheet(); break;
      case 'ed-nose': sheet.capsule = id === '1'; renderSheet(); break; // crew capsule preview
      case 'ed-eng': sheet.draft.stages[+el.dataset.i].engine = id; renderSheet(); break;
      case 'ed-cnt': {
        const st = sheet.draft.stages[+el.dataset.i];
        st.count = Math.max(1, Math.min(lim.maxEngines, st.count + +id));
        renderSheet(); break;
      }
      case 'ed-add': {
        const top = sheet.draft.stages[sheet.draft.stages.length - 1];
        const vac = Object.keys(S.ENGINES).filter((k) => S.ENGINES[k].vac && (!S.ENGINES[k].tech || state.techs[S.ENGINES[k].tech]));
        sheet.draft.stages.push({ engine: vac[vac.length - 1] || 'emberv', count: 1, prop: Math.max(PROP_MIN, Math.round(top.prop / 4)) });
        renderSheet(); break;
      }
      case 'ed-rm': sheet.draft.stages.pop(); renderSheet(); break;
      case 'ed-srb-n': case 'ed-srb-t': if (EN() && EN().editorAct(act, id, sheet.draft, state.techs)) renderSheet(); break; // side boosters
      case 'ed-nudge': {
        const i = +el.dataset.i;
        const st = sheet.draft.stages[i];
        st.prop = clampProp(st.prop + +id, lim.maxProp);
        document.querySelector(`[data-ed-num="${i}"]`).value = st.prop;
        document.querySelector(`[data-ed-prop="${i}"]`).value = propToPos(st.prop, lim.maxProp);
        editorStats(); break;
      }
      case 'ed-save': {
        const d = sheet.draft;
        d.name = (d.name || '').trim() || 'Rocket';
        if (sheet.origId) { const i = state.designs.findIndex((x) => x.id === sheet.origId); state.designs[i] = d; }
        else { d.id = 'd' + state.nextId++; state.designs.push(d); }
        log(`Saved rocket design <b>${esc(d.name)}</b>.`);
        save(); closeSheet(); break;
      }
      case 'ed-del':
        state.designs = state.designs.filter((x) => x.id !== sheet.origId);
        save(); closeSheet(); break;
      case 'research': {
        const t = S.TECHS[id];
        if (state.rp < t.rp || state.techs[id]) break;
        state.rp -= t.rp; state.techs[id] = state.day;
        log(`Research done: <b>${t.name}</b>.`);
        toast(`🔬 ${t.name} unlocked`);
        save(); refresh(); break;
      }
      case 'hire':
        if (state.cash < hireCost()) break;
        state.cash -= hireCost(); state.engineers++; save(); refresh(); break;
      case 'fire': if (state.engineers > 1) { state.engineers--; save(); refresh(); } break;
      case 'factory': {
        const cost = S.FACILITY.factoryCost(state.factory);
        if (state.cash < cost || state.factory >= 5) break;
        state.cash -= cost; state.factory++;
        log(`Factory upgraded to level ${state.factory}.`); save(); refresh(); break;
      }
      case 'buy': {
        const cost = id === 'barge' ? S.FACILITY.bargeCost : S.FACILITY.towerCost;
        if (state.cash < cost) break;
        state.cash -= cost; state.owned[id] = true;
        log(id === 'barge' ? 'Bought the ocean landing barge <b>Second Chances</b>.' : 'Built the catch tower <b>Big Arms</b>.');
        save(); refresh(); break;
      }
      case 'help': openSheet({ kind: 'intro' }); break;
      case 'intro-done': state.intro = false; save(); closeSheet(); break;
      case 'reset':
        if (window.confirm('Start over? Your current company will be lost.')) { state = newGame(); save(); closeSheet(); openSheet({ kind: 'intro' }); }
        break;
      case 'reset-now': state = newGame(); save(); closeSheet(); openSheet({ kind: 'intro' }); break;
      default: break;
    }
  }

  function init() {
    state = load();
    document.addEventListener('click', onClick);
    for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => { tab = b.dataset.tab; window.scrollTo(0, 0); refresh(); });
    for (const b of document.querySelectorAll('#speed button')) b.addEventListener('click', () => { state.speed = +b.dataset.speed; save(); header(); });
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (!$('flight').hidden) {
        if ((e.key === 'Enter' || e.key === 'Escape') && !$('result').hidden) { e.preventDefault(); $('result').querySelector('[data-act=flight-done]').click(); }
        return;
      }
      if (e.key === 'Escape' && sheet && sheet.kind !== 'intro' && sheet.kind !== 'bankrupt') { closeSheet(); return; }
      if (sheet) return;
      const tabs = ['ops', 'contracts', 'hangar', 'research', 'base', 'network', 'ventures'];
      if (e.key >= '1' && e.key <= '7') { tab = tabs[+e.key - 1]; window.scrollTo(0, 0); refresh(); }
      else if (e.key === 'p' || e.key === 'P') { state.speed = state.speed ? 0 : 1; save(); header(); }
    });
    window.addEventListener('resize', () => { if (tab === 'ops') renderOps(); if (tab === 'network') renderNetwork(); if (sheet && sheet.kind === 'editor') editorStats(); });
    refresh();
    if (state.intro) openSheet({ kind: 'intro' });
    if (state.inFlight && state.inFlight.ctx) {
    const f = state.inFlight;
    log('Your last flight finished while the game was closed.');
    try { afterFlight(f.ctx, f.res); } catch (e) { console.warn('resume flight', e); delete state.inFlight; save(); }
  }
  requestAnimationFrame(clock);
  }
  init();
})();
