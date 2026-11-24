// APOGEE: company game state, screens and launch flow.
(function () {
  'use strict';
  const S = window.APOGEE_SIM;
  const D = window.APOGEE_DRAW;
  const F = window.APOGEE_FLIGHT;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'apogee-save-v1';
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
    return st;
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; }
    } catch (e) { /* ignore */ }
    return newGame();
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
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Time ----------
  function dayTick() {
    state.day++;
    state.rp += state.engineers * S.FACILITY.rpPerEngineerDay;
    if (state.day % 30 === 0) {
      const bill = state.engineers * S.FACILITY.engineerSalary + 0.1 * state.factory + (state.owned.barge ? 0.2 : 0) + (state.owned.tower ? 0.3 : 0);
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
    const before = state.contracts.length;
    state.contracts = state.contracts.filter((c) => c.expires > state.day);
    if (state.contracts.length < before) log('A contract offer expired.');
    const cap = 7;
    if (state.contracts.length < cap && Math.random() < (state.contracts.length < 3 ? 0.35 : 0.14)) {
      const c = S.makeContract(Math.random, state);
      state.contracts.push(c);
    }
    if (state.cash < -15 && !sheet) openSheet({ kind: 'bankrupt' });
    save();
  }

  let acc = 0, last = performance.now();
  function clock(now) {
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!flying && !(sheet && sheet.kind === 'intro') && state.speed > 0 && !state.won) {
      acc += dt * state.speed;
      let changed = false;
      while (acc >= 1) { acc -= 1; dayTick(); changed = true; }
      if (changed) refresh();
    }
    requestAnimationFrame(clock);
  }

  // ---------- Header ----------
  function header() {
    $('s-day').textContent = state.day;
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
    return d.stages.map((s) => `${s.count}× ${S.ENGINES[s.engine].name}`).join(' / ');
  }
  function sameBooster(a, b) { return a.engine === b.engine && a.count === b.count && a.prop === b.prop; }
  function boostersFor(design) { return state.boosters.filter((b) => sameBooster(b.stage, design.stages[0])); }

  // ---------- Ops tab ----------
  function renderOps() {
    const el = $('tab-ops');
    const r = ready();
    const b = building();
    const show = r[0] ? r[0].design : (b[0] ? b[0].design : state.designs[0]);
    const heroTitle = r[0] ? `${esc(r[0].serial)} is on the pad` : b[0] ? `${esc(b[0].serial)} is being built` : 'No rocket on the pad';
    const heroSub = r[0] ? esc(r[0].design.name) + (r[0].booster ? ` · flown booster (${r[0].booster.flights} flight${r[0].booster.flights > 1 ? 's' : ''})` : '') : b[0] ? `${b[0].days} days to go` : 'Build one in the Hangar';
    let html = `<div class="hero"><canvas id="hero-canvas"></canvas><div class="over"><h3>${heroTitle}</h3><div class="small dim">${heroSub}</div></div></div>`;
    if (state.won) html += `<div class="card done"><h3>🏆 Mars city founded!</h3><p class="small">You did it on day ${state.day}. Keep flying, or start a new company on the Base tab.</p></div>`;

    html += `<div class="cols"><div><h2>Ready to fly</h2>`;
    if (!r.length) html += `<div class="empty">No rockets ready. ${b.length ? 'One is in the factory.' : `<br><button class="btn primary sm" data-act="go-hangar" style="margin-top:8px">Build a rocket</button>`}</div>`;
    for (const v of r) {
      html += `<div class="card"><div style="display:flex;gap:8px;align-items:center"><div class="grow"><h3>${esc(v.serial)} <span class="dim small">${esc(v.design.name)}</span></h3>
        <div class="small dim">${stagesLabel(v.design)}${v.booster ? ` · <span class="acc">flown booster ×${v.booster.flights}</span>` : ''}</div></div></div>
        <div class="btns"><button class="btn primary sm" data-act="go-contracts">Pick a contract</button><button class="btn sm" data-act="test" data-id="${v.id}">Test flight</button></div></div>`;
    }
    if (b.length) {
      html += `<h2>In the factory <span class="dim">(${state.factory} line${state.factory > 1 ? 's' : ''})</span></h2>`;
      b.forEach((v, i) => {
        const p = 1 - v.days / v.total;
        html += `<div class="card"><div style="display:flex;justify-content:space-between"><b>${esc(v.serial)} <span class="dim small">${esc(v.design.name)}</span></b><span class="small ${i < state.factory ? '' : 'dim'}">${i < state.factory ? `${v.days} days` : 'Waiting for a line'}</span></div><div class="bar"><i style="width:${pct(p)}"></i></div></div>`;
      });
    }
    if (state.boosters.length) {
      html += `<h2>Landed boosters</h2><div class="card small">${state.boosters.map((x) => `<span class="pill acc">${esc(x.id)} · ${x.flights} flight${x.flights > 1 ? 's' : ''}</span>`).join(' ')}<p class="dim">Build the same design in the Hangar to reuse one.</p></div>`;
    }
    html += `</div><div><h2>Goals</h2><div class="card">`;
    for (const m of MILESTONES) {
      const done = state.milestones[m.id];
      const extra = m.id === 'marsCity' ? ` (${state.marsCity}/5)` : '';
      html += `<div class="small" style="padding:4px 0">${done ? '✅' : '⬜'} ${m.name}${extra}${!done && m.cash ? ` <span class="dim">· bonus ${money(m.cash)}, ${m.rp} science</span>` : ''}</div>`;
    }
    html += `</div><h2>Mission log</h2><div class="card log">${state.log.slice(0, 14).map((l) => `<div>Day ${l.day} · ${l.text}</div>`).join('')}</div></div></div>`;
    el.innerHTML = html;
    D.drawPadScene($('hero-canvas'), r[0] ? show : null, state.techs);
  }

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
  function renderContracts() {
    const el = $('tab-contracts');
    const list = state.contracts.slice().sort((a, b) => b.reward - a.reward);
    let html = `<h2>Open contracts</h2><p class="small dim" style="margin:-4px 2px 10px">New offers arrive every few days. Higher reputation unlocks bigger jobs.</p>`;
    if (!list.length) html += `<div class="empty">No offers right now. Check back in a few days.</div>`;
    html += '<div class="grid">';
    for (const c of list) {
      const fit = contractFit(c);
      const t = S.TARGETS[c.target];
      const days = c.expires - state.day;
      const needsCapsule = c.crew && !state.techs.capsule;
      html += `<div class="card tap" data-act="contract" data-id="${c.id}">
        <div style="display:flex;gap:10px;align-items:flex-start"><div class="grow">
          <h3>${esc(c.label)}</h3><div class="small dim">${esc(c.client)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill blue">${t.short}</span><span class="pill">${c.crew ? '4 crew · 12 t' : tons(c.mass)}</span><span class="pill ${days < 15 ? 'bad' : ''}">${days} days left</span>
          ${fit ? `<span class="pill good">✓ ${esc(fit.v.serial)} can fly it</span>` : needsCapsule ? '<span class="pill bad">Needs Crew Capsule</span>' : ''}</div>
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
      const cost = S.designCost(d, state.techs);
      const days = S.buildDays(d, state.factory);
      const errs = S.validate(d, state.techs);
      const leoX = S.capacity(d, 'LEO', 'expend', state.techs);
      const leoR = reuse ? S.capacity(d, 'LEO', reuse, state.techs) : 0;
      const gto = S.capacity(d, 'GTO', 'expend', state.techs);
      const fb = boostersFor(d);
      html += `<div class="card"><div style="display:flex;gap:10px"><div class="grow"><h3><span style="color:${d.color}">■</span> ${esc(d.name)}</h3>
        <div class="small dim">${stagesLabel(d)}</div></div><button class="btn sm" data-act="edit" data-id="${d.id}">Edit</button></div>
        <div class="kv"><div><small>To LEO</small><b>${tons(leoX)}</b></div>${reuse ? `<div><small>LEO, reusable</small><b>${tons(leoR)}</b></div>` : ''}<div><small>To GTO</small><b>${tons(gto)}</b></div><div><small>Cost</small><b>${money(cost)}</b></div><div><small>Build</small><b>${days} days</b></div></div>
        ${errs.length ? `<p class="small bad">${errs.map(esc).join('<br>')}</p>` : ''}
        <div class="btns"><button class="btn primary sm" data-act="build" data-id="${d.id}" ${errs.length || state.cash < cost ? 'disabled' : ''}>Build new · ${money(cost)}</button>
        ${fb.length ? `<button class="btn go sm" data-act="build-reuse" data-id="${d.id}">Reuse ${esc(fb[0].id)} · ${money(reuseCost(d, fb[0]))}</button>` : ''}</div></div>`;
    }
    html += `</div><button class="btn big" data-act="new-design" style="max-width:340px">+ New rocket design</button>`;
    html += `<p class="small dim" style="margin-top:12px">Tip: a booster that lands keeps its slot here. Build the same design again and you only pay to refurbish it.</p>`;
    el.innerHTML = html;
  }

  function reuseCost(d, b) {
    const s0 = S.stageCost(d.stages[0], state.techs, 0);
    return S.designCost(d, state.techs) - s0 + s0 * b.refurb;
  }

  function build(designId, reuse) {
    const d = state.designs.find((x) => x.id === designId);
    if (!d) return;
    let cost = S.designCost(d, state.techs);
    let days = S.buildDays(d, state.factory);
    let booster = null;
    if (reuse) {
      booster = boostersFor(d)[0];
      if (!booster) return;
      cost = reuseCost(d, booster);
      days = Math.max(booster.days, Math.round(days * 0.45));
      state.boosters = state.boosters.filter((x) => x !== booster);
    }
    if (state.cash < cost) { toast('Not enough cash.'); return; }
    state.cash -= cost;
    const prefix = d.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'RK';
    const serial = `${prefix}-${++state.serial}`;
    state.vehicles.push({ id: 'v' + state.nextId++, design: clone(d), designId: d.id, serial, status: 'building', days, total: days, booster: booster ? { id: booster.id, flights: booster.flights } : null });
    log(`Started building <b>${serial}</b> (${esc(d.name)})${booster ? ` on flown booster ${esc(booster.id)}` : ''} for <b>${money(cost)}</b>.`);
    toast(`🛠️ Building ${serial} · ${days} days`);
    save(); refresh();
  }

  // ---------- Research tab ----------
  function renderResearch() {
    const el = $('tab-research');
    let html = `<h2>Research</h2><div class="card row"><div class="grow"><b>${Math.floor(state.rp)} science</b><div class="small dim">+${(state.engineers * S.FACILITY.rpPerEngineerDay).toFixed(2)} a day from ${state.engineers} engineers, plus every launch. Hire more on the Base tab.</div></div></div>`;
    html += '<div class="grid">';
    const ids = Object.keys(S.TECHS);
    const order = ids.sort((a, b) => (state.techs[a] ? 1 : 0) - (state.techs[b] ? 1 : 0) || S.TECHS[a].rp - S.TECHS[b].rp);
    for (const id of order) {
      const t = S.TECHS[id];
      const done = state.techs[id];
      const reqOk = t.req.every((r) => state.techs[r]);
      const can = !done && reqOk && state.rp >= t.rp;
      html += `<div class="card ${done ? 'done' : reqOk ? '' : 'locked'}"><div class="tech"><div class="ic">${TECH_ICONS[id] || '🔬'}</div><div class="grow">
        <b>${t.name}</b><div class="small dim">${t.desc}</div>
        ${!reqOk ? `<div class="small bad">Needs: ${t.req.filter((r) => !state.techs[r]).map((r) => S.TECHS[r].name).join(', ')}</div>` : ''}</div>
        ${done ? '<span class="pill good">Done</span>' : `<button class="btn sm ${can ? 'primary' : ''}" data-act="research" data-id="${id}" ${can ? '' : 'disabled'}>${t.rp} 🔬</button>`}</div></div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ---------- Base tab ----------
  function renderBase() {
    const el = $('tab-base');
    const f = state.factory;
    const st = state.stats;
    const monthly = state.engineers * S.FACILITY.engineerSalary + 0.1 * f + (state.owned.barge ? 0.2 : 0) + (state.owned.tower ? 0.3 : 0);
    let html = `<h2>Team</h2><div class="card"><div style="display:flex;align-items:center;gap:10px"><div class="grow"><b>👷 ${state.engineers} engineers</b><div class="small dim">Each makes ${S.FACILITY.rpPerEngineerDay} science a day and costs ${money(S.FACILITY.engineerSalary)} a month.</div></div></div>
      <div class="btns"><button class="btn primary sm" data-act="hire" ${state.cash < S.FACILITY.engineerHire ? 'disabled' : ''}>Hire · ${money(S.FACILITY.engineerHire)}</button><button class="btn sm" data-act="fire" ${state.engineers <= 1 ? 'disabled' : ''}>Let one go</button></div></div>`;
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
    const s = { kind: 'launch', contractId, vehicleId: vid, recovery: null, landing: 'auto', upperReuse: false };
    s.recovery = pickRecovery(s);
    openSheet(s);
  }
  function launchCtx(s) {
    const c = s.contractId ? state.contracts.find((x) => x.id === s.contractId) : null;
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
    return cost;
  }
  function launchSheet() {
    const s = sheet;
    const { c, v, payload, target } = launchCtx(s);
    const t = S.TARGETS[target];
    let html = `<div class="head"><h3>${c ? esc(c.label) : 'Test flight'}</h3><button class="x" data-act="close">✕</button></div>`;
    html += c ? `<div class="small dim">${esc(c.client)} · ${t.name} · ${c.crew ? '4 crew in a 12 t capsule' : tons(c.mass)} · pays <span class="money">${money(c.reward)}</span></div>`
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
    if (s.recovery !== 'expend') {
      html += `<h2>Landing</h2><div class="seg"><button data-act="l-land" data-id="auto" class="${s.landing === 'auto' ? 'on' : ''}">Autopilot</button><button data-act="l-land" data-id="manual" class="${s.landing === 'manual' ? 'on' : ''}">🎮 Fly it myself</button></div>`;
    }
    if (state.techs.shipreuse && v.design.stages.length > 1) {
      html += `<h2>Upper stage</h2><div class="seg"><button data-act="l-up" data-id="0" class="${!s.upperReuse ? 'on' : ''}">Expend</button><button data-act="l-up" data-id="1" class="${s.upperReuse ? 'on' : ''}">Bring it home (refund 90%)</button></div>`;
    }
    const m = S.mission(v.design, payload, target, s.recovery, state.techs, { upperReuse: s.upperReuse });
    const odds = S.launchOdds(v.design, state.heritage, state.designFlights[v.designId] || 0);
    const lodds = S.landingOdds(s.recovery, state.landings, state.techs);
    const tankCost = m.tankers ? m.tankers * tankerUnit(v.design, s.recovery, s.upperReuse) : 0;
    const ratio = Math.min(1.4, m.have / m.need);
    html += `<h2>Flight check</h2><div class="card">
      <div style="display:flex;justify-content:space-between"><span class="small">Delta-v ${m.refilled ? '(after refilling)' : ''}</span><b class="${m.ok ? 'good' : 'bad'}">${Math.round(m.have).toLocaleString()} / ${m.need.toLocaleString()} m/s</b></div>
      <div class="bar ${m.ok ? 'good' : 'bad'}"><i style="width:${Math.min(100, ratio / 1.4 * 100)}%"></i><span class="mark" style="left:${100 / 1.4}%"></span></div>
      <div class="kv"><div><small>Liftoff TWR</small><b class="${m.twr >= 1.2 ? '' : 'bad'}">${m.twr.toFixed(2)}</b></div><div><small>Launch success</small><b>${pct(odds)}</b></div>
      ${s.recovery !== 'expend' ? `<div><small>Landing (auto)</small><b>${pct(lodds)}</b></div>` : ''}
      ${m.tankers ? `<div><small>Tanker flights</small><b>${m.tankers} · ${money(tankCost)}</b></div>` : ''}</div>
      ${!m.canLift ? '<p class="small bad">Too heavy to leave the pad. Add engines or remove fuel.</p>' : !m.ok ? `<p class="small bad">Not enough delta-v${s.recovery !== 'expend' ? '. Try expending the booster, or' : '. Try'} a bigger rocket.${S.TARGETS[target].deep && !state.techs.refill ? ' Orbital Refilling research helps for Moon and Mars.' : ''}</p>` : ''}
      </div>`;
    const canPay = state.cash >= tankCost;
    html += `<button class="btn primary big" data-act="launch" ${m.ok && canPay ? '' : 'disabled'}>🚀 Launch ${esc(v.serial)}</button>`;
    if (!canPay) html += `<p class="small bad">Not enough cash for the tanker flights.</p>`;
    return html;
  }

  async function launch() {
    const s = sheet;
    const { c, v, payload, target } = launchCtx(s);
    if (!v) return;
    const m = S.mission(v.design, payload, target, s.recovery, state.techs, { upperReuse: s.upperReuse });
    if (!m.ok) return;
    const tankCost = m.tankers ? m.tankers * tankerUnit(v.design, s.recovery, s.upperReuse) : 0;
    state.cash -= tankCost;
    const design = v.design;
    const odds = S.launchOdds(design, state.heritage, state.designFlights[v.designId] || 0);
    let fail = null;
    if (Math.random() > odds) {
      const weights = design.stages.map((st) => st.count + 1);
      let pick = Math.random() * weights.reduce((a, b) => a + b, 0), i = 0;
      while (pick > weights[i]) { pick -= weights[i]; i++; }
      fail = { stage: Math.min(i, design.stages.length - 1), t: 0.15 + Math.random() * 0.75 };
    }
    const autoLand = Math.random() < S.landingOdds(s.recovery, state.landings, state.techs);
    state.vehicles = state.vehicles.filter((x) => x !== v);
    const ctx = { c, v, recovery: s.recovery, landing: s.landing, upperReuse: s.upperReuse, tankers: m.tankers, tankCost, fail, target };
    closeSheet();
    flying = true;
    save();
    const t = S.TARGETS[target];
    const res = await F.run({
      design, techs: state.techs, target, fail, recovery: s.recovery, landing: s.landing, autoLand, crew: c && c.crew,
      title: c ? `${c.label} · ${c.client}` : 'Test flight',
      failText: fail ? `Engine failure on stage ${fail.stage + 1}` : '',
      orbitText: !c ? 'ORBIT ✓' : t.deep ? 'ON ITS WAY ✓' : 'PAYLOAD DEPLOYED ✓',
      orbitSub: c ? (m.refilled ? `Refilled by ${m.tankers} tanker flight${m.tankers > 1 ? 's' : ''}, heading for ${t.name}` : `${t.name}`) : 'Test flight complete',
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
    if (ok) {
      state.stats.successes++;
      if (c) {
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
      state.rep = Math.max(0, state.rep - 6);
      state.rp += 3;
      lines.push(['Result', '<span class="bad">Vehicle lost</span>']);
      lines.push(['Reputation', '−6']);
      lines.push(['Science (lessons learned)', '+3']);
      log(`<b>${esc(v.serial)}</b> was lost: ${esc(fail ? `engine failure on stage ${fail.stage + 1}` : 'failure')}.${c ? ' The customer will wait for another try.' : ''}`);
    }
    // Booster
    if (recovery !== 'expend') {
      if (res.stage1Ok !== false && (ok || (fail && fail.stage > 0))) {
        state.landings[recovery] = (state.landings[recovery] || 0) + 1;
        if (res.landed) {
          state.stats.landings++;
          const flights = (v.booster ? v.booster.flights : 0) + 1;
          const id = v.booster ? v.booster.id : `B${1000 + state.stats.landings}`;
          state.boosters.push({ id, stage: clone(design.stages[0]), flights, refurb: S.refurbFrac(state.techs, recovery), days: S.refurbDays(state.techs, recovery) });
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
    save();
    const box = $('result');
    box.innerHTML = `<h3>${ok ? (c ? '✅ Mission success' : '✅ Test flight success') : '💥 Mission failed'}</h3>
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
    html += `<div class="editor"><div class="preview"><canvas id="ed-canvas"></canvas></div><div>`;
    html += `<input type="text" id="ed-name" maxlength="24" value="${esc(d.name)}" aria-label="Rocket name">`;
    html += `<div class="seg" style="margin:8px 0">${COLORS.map((c) => `<button data-act="ed-color" data-id="${c}" class="${d.color === c ? 'on' : ''}" style="color:${c}" aria-label="Stripe color">■</button>`).join('')}</div>`;
    d.stages.forEach((st, i) => {
      const eng = S.ENGINES[st.engine];
      html += `<div class="stage"><div class="st-head"><b>Stage ${i + 1}${i === 0 ? ' · booster' : ''}</b>${i > 0 && i === d.stages.length - 1 ? `<button class="btn sm danger" data-act="ed-rm">Remove</button>` : ''}</div>
        <div class="seg">${engineChoices(i).map((k) => `<button data-act="ed-eng" data-i="${i}" data-id="${k}" class="${st.engine === k ? 'on' : ''}">${S.ENGINES[k].name}</button>`).join('')}</div>
        <div class="small dim" style="margin-top:6px">${eng.fuel} · ${i === 0 && !eng.vac ? eng.thrustSL : eng.thrustVac} kN · Isp ${i === 0 && !eng.vac ? eng.ispSL + '–' + eng.ispVac : eng.ispVac} s · ${money(eng.cost)} each</div>
        <div class="field"><label>Engines</label><div class="stepper"><button data-act="ed-cnt" data-i="${i}" data-id="-1">−</button><span>${st.count}</span><button data-act="ed-cnt" data-i="${i}" data-id="1">+</button></div></div>
        <div class="field"><label>Propellant</label><input type="range" data-ed-prop="${i}" min="5" max="${lim.maxProp}" step="${lim.maxProp > 1000 ? 10 : 5}" value="${st.prop}"><span class="val" id="ed-prop-${i}">${st.prop} t</span></div></div>`;
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
    for (const r of document.querySelectorAll('[data-ed-prop]')) {
      r.addEventListener('input', () => {
        const i = +r.dataset.edProp;
        sheet.draft.stages[i].prop = +r.value;
        $('ed-prop-' + i).textContent = r.value + ' t';
        editorStats();
      });
    }
    editorStats();
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
    $('ed-stats').innerHTML = html;
    $('ed-save').disabled = S.validate(d, state.techs).length > 0 || p.twr < 1.05;
    D.drawPreview($('ed-canvas'), d, state.techs);
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
      case 'contract': startLaunch(id); break;
      case 'test': startLaunch(null, id); break;
      case 'l-veh': sheet.vehicleId = id; sheet.recovery = pickRecovery(sheet); renderSheet(); break;
      case 'l-rec': sheet.recovery = id; renderSheet(); break;
      case 'l-land': sheet.landing = id; renderSheet(); break;
      case 'l-up': sheet.upperReuse = id === '1'; renderSheet(); break;
      case 'launch': launch(); break;
      case 'flight-done': F.close(); flying = false; last = performance.now(); refresh(); break;
      case 'build': build(id, false); break;
      case 'build-reuse': build(id, true); break;
      case 'edit': openEditor(id); break;
      case 'new-design': openEditor(null); break;
      case 'ed-color': sheet.draft.color = id; renderSheet(); break;
      case 'ed-eng': sheet.draft.stages[+el.dataset.i].engine = id; renderSheet(); break;
      case 'ed-cnt': {
        const st = sheet.draft.stages[+el.dataset.i];
        st.count = Math.max(1, Math.min(lim.maxEngines, st.count + +id));
        renderSheet(); break;
      }
      case 'ed-add': {
        const top = sheet.draft.stages[sheet.draft.stages.length - 1];
        const vac = Object.keys(S.ENGINES).filter((k) => S.ENGINES[k].vac && (!S.ENGINES[k].tech || state.techs[S.ENGINES[k].tech]));
        sheet.draft.stages.push({ engine: vac[vac.length - 1] || 'emberv', count: 1, prop: Math.max(5, Math.round(top.prop / 4 / 5) * 5) });
        renderSheet(); break;
      }
      case 'ed-rm': sheet.draft.stages.pop(); renderSheet(); break;
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
        if (state.cash < S.FACILITY.engineerHire) break;
        state.cash -= S.FACILITY.engineerHire; state.engineers++; save(); refresh(); break;
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
      const tabs = ['ops', 'contracts', 'hangar', 'research', 'base'];
      if (e.key >= '1' && e.key <= '5') { tab = tabs[+e.key - 1]; refresh(); }
      else if (e.key === 'p' || e.key === 'P') { state.speed = state.speed ? 0 : 1; save(); header(); }
    });
    window.addEventListener('resize', () => { if (tab === 'ops') renderOps(); if (sheet && sheet.kind === 'editor') editorStats(); });
    refresh();
    if (state.intro) openSheet({ kind: 'intro' });
    requestAnimationFrame(clock);
  }
  init();
})();
