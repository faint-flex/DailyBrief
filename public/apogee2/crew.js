// APOGEE 2.0: crewed spaceflight. Astronauts (hire, train, fly), the player's crew capsule,
// and Tranquil Station (crew rotations, cargo restocks, splashdowns).
// Exposes window.APOGEE_CREW. game.js calls it from renderOps, renderContracts, launchSheet,
// launch, afterFlight and dayTick. State lives in state.crew (added lazily by ensure()).
(function () {
  'use strict';
  const G = () => window.APOGEE_GAME || null;

  const STATION = 'Tranquil Station';
  const ROLES = {
    commander:  { name: 'Commander',  icon: '⭐', cost: 2.0, days: 24 },
    pilot:      { name: 'Pilot',      icon: '🕹️', cost: 1.6, days: 20 },
    specialist: { name: 'Specialist', icon: '🔬', cost: 1.2, days: 16 },
  };
  const CFG = {
    salary: 0.05,        // $M per astronaut per 30 days
    maxRoster: 8,
    crewSize: 4,
    restDays: 5,         // rest after splashdown
    abortRestDays: 7,    // rest after a launch abort
    stationStay: 30,     // days at Tranquil Station
    tourStay: 4,         // days for a short orbit trip
    cargoSupplies: 35,   // % supplies added by a station cargo run
    offerEvery: 18,      // days between Tranquil Station rotation offers
  };
  const FIRST = ['Ada', 'Bram', 'Cleo', 'Dario', 'Esme', 'Farid', 'Greta', 'Hugo', 'Ines', 'Jonah', 'Kaia', 'Lior', 'Mara', 'Niko', 'Oona', 'Pavel', 'Quinn', 'Rhea', 'Soren', 'Tamsin', 'Uma', 'Vikram', 'Wren', 'Yara', 'Zeno', 'Selma', 'Theo', 'Amara'];
  const LAST = ['Vale', 'Moreno', 'Lindqvist', 'Achterberg', 'Tamura', 'Kowal', 'Reyes', 'Novak', 'Haddad', 'Brightwater', 'Okoro', 'Ferreira', 'Halloran', 'Duval', 'Ishikawa', 'Marsh', 'Petrov', 'Quist', 'Sandoval', 'Thorne', 'Ulloa', 'Weller', 'Castell', 'Nakamura'];
  const CAPSULE_NAMES = ['Wayfarer', 'Lantern', 'Kestrel', 'Meridian', 'Driftwood', 'Halcyon'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (m) => (G() ? G().money(m) : `$${m.toFixed(1)}M`);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const r1 = (x) => Math.round(x * 10) / 10;

  // ---------- State ----------
  function ensure(st) {
    if (!st) return null;
    if (!st.crew) {
      st.crew = {
        roster: [], pool: [], poolDay: 0, nextId: 1,
        capsule: { name: pick(CAPSULE_NAMES), flights: 0 },
        station: { name: STATION, supplies: 40, visits: 0 },
        mission: null, last: null, nextOffer: 0,
      };
    }
    const c = st.crew;
    c.roster = c.roster || []; c.pool = c.pool || [];
    c.capsule = c.capsule || { name: 'Wayfarer', flights: 0 };
    c.station = c.station || { name: STATION, supplies: 40, visits: 0 };
    if (!c.nextId) c.nextId = 1;
    if (c.pool.length < 4 || st.day - (c.poolDay || 0) >= 45) refreshPool(st);
    return c;
  }
  function usedNames(st) {
    return new Set(st.crew.roster.concat(st.crew.pool).map((a) => a.name));
  }
  function newPerson(st, role) {
    const used = usedNames(st);
    let name = '';
    for (let k = 0; k < 30; k++) { name = `${pick(FIRST)} ${pick(LAST)}`; if (!used.has(name)) break; }
    const hue = Math.floor(Math.random() * 360);
    return { id: 'a' + st.crew.nextId++, name, role, hue, status: 'cand', train: 0, flights: 0, spaceDays: 0, rest: 0 };
  }
  // Candidate pool always has a commander, a pilot and two specialists.
  function refreshPool(st) {
    const c = st.crew;
    c.pool = ['commander', 'pilot', 'specialist', 'specialist'].map((r) => newPerson(st, r));
    c.poolDay = st.day;
  }
  function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }

  // ---------- Crew readiness ----------
  const ready = (st) => st.crew.roster.filter((a) => a.status === 'ready');
  function pickCrew(st) {
    const rd = ready(st).slice().sort((a, b) => b.flights - a.flights);
    const out = [];
    const take = (pred) => { const a = rd.find((x) => pred(x) && !out.includes(x)); if (a) out.push(a); return a; };
    const cmd = take((a) => a.role === 'commander');
    const plt = take((a) => a.role === 'pilot');
    while (out.length < CFG.crewSize && take((a) => a.role === 'specialist'));
    while (out.length < CFG.crewSize && take(() => true));
    return { crew: out, cmd: !!cmd, plt: !!plt, ok: !!cmd && !!plt && out.length >= CFG.crewSize };
  }
  // Why the next crewed flight can't go (or '' if it can).
  function blocker(st) {
    ensure(st);
    if (!st.techs.capsule) return 'Research Crew Capsule first';
    if (st.crew.mission) return `${esc(st.crew.capsule.name)} is still in orbit`;
    const p = pickCrew(st);
    if (p.ok) return '';
    const n = ready(st).length;
    if (n < CFG.crewSize) return `Needs 4 trained astronauts (${n} ready)`;
    return !p.cmd ? 'Needs a trained commander' : 'Needs a trained pilot';
  }

  // Crew contracts from sim.js get a stay length and destination (old saves too).
  function decorate(c) {
    if (!c || !c.crew || c.stay != null) return c;
    const tour = /tourism/i.test(c.client || '');
    c.stay = tour ? CFG.tourStay : CFG.stationStay;
    c.station = !tour;
    if (tour) c.label = 'Orbit trip';
    else if (c.label === 'Crew to orbit') c.label = 'Crew rotation';
    c.bonus = r1(c.reward * (tour ? 0.1 : 0.2));
    return c;
  }

  // ---------- Daily tick ----------
  function tick(st) {
    const C = ensure(st);
    const events = [], toasts = [];
    for (const a of C.roster) {
      if (a.status === 'training') {
        a.train++;
        if (a.train >= ROLES[a.role].days) {
          a.status = 'ready';
          events.push(`👩‍🚀 <b>${esc(a.name)}</b> finished training and is ready to fly.`);
          toasts.push(`👩‍🚀 ${esc(a.name)} is ready to fly`);
        }
      } else if (a.status === 'rest') {
        a.rest--;
        if (a.rest <= 0) a.status = 'ready';
      }
    }
    if (st.day % 30 === 0 && C.roster.length) {
      const pay = C.roster.length * CFG.salary;
      st.cash -= pay;
      events.push(`Paid astronaut salaries: <b>${money(pay)}</b>.`);
    }
    const m = C.mission;
    if (m) {
      if (m.station) C.station.supplies = Math.max(0, C.station.supplies - 1);
      if (st.day - m.start >= m.stay) splashdown(st, events, toasts);
    }
    // Tranquil Station asks for a crew rotation now and then once you have a capsule.
    for (const c of st.contracts) decorate(c);
    const open = st.contracts.some((c) => c.crew);
    if (st.techs.capsule && !open && !C.mission && st.day >= (C.nextOffer || 0)) {
      st.contracts.push(rotationOffer(st));
      C.nextOffer = st.day + CFG.offerEvery;
      events.push(`🛰️ ${STATION} wants a new crew. See Contracts.`);
    }
    return { events, toasts };
  }
  // Pays about 1.5 to 2.5 times the cost of a rocket that lifts a 12 t capsule (~$9-15M).
  function rotationOffer(st) {
    const reward = r1(18 + Math.random() * 8);
    return {
      id: 'cr' + Math.floor(Math.random() * 1e9).toString(36), kind: 'crew', label: 'Crew rotation',
      client: 'Tranquil Station Co.', target: 'LEO', mass: 12, reward, expires: st.day + 70, rep: 8,
      crew: true, stay: CFG.stationStay, station: true, bonus: r1(reward * 0.2),
    };
  }
  function splashdown(st, events, toasts) {
    const C = st.crew, m = C.mission;
    const crew = C.roster.filter((a) => m.ids.includes(a.id));
    const vets = crew.filter((a) => a.flights >= 2).length;
    let sci = (m.station ? 12 : 4) + vets * 2;
    if (m.station && C.station.supplies > 0) sci = Math.round(sci * 1.5);
    const rep = m.station ? 5 : 3;
    for (const a of crew) { a.flights++; a.spaceDays += m.stay; a.status = 'rest'; a.rest = CFG.restDays; }
    st.cash += m.bonus || 0; st.rep += rep; st.rp += sci;
    if (st.stats) st.stats.earned += m.bonus || 0;
    if (m.station) C.station.visits++;
    C.last = { day: st.day, text: `${esc(C.capsule.name)} splashed down after ${m.stay} days${m.station ? ` at ${STATION}` : ''}. +${money(m.bonus || 0)}, +${rep} rep, +${sci} science.` };
    C.mission = null;
    events.push(`🪂 <b>Splashdown!</b> ${C.last.text} Crew: ${crew.map((a) => esc(a.name)).join(', ')}.`);
    toasts.push(`🪂 Splashdown! ${esc(C.capsule.name)} is home`);
  }

  // ---------- Launch hooks ----------
  // Card shown in the launch sheet for crew contracts. Returns { ok, html, abort }.
  function check(st, c) {
    ensure(st); decorate(c);
    const why = blocker(st);
    const p = pickCrew(st);
    const dest = c.station ? `Dock at ${STATION} for ${c.stay} days` : `${c.stay} days in orbit, then home`;
    let html = `<h2>Crew</h2><div class="card"><div class="small">🛸 Capsule <b>${esc(st.crew.capsule.name)}</b> · ${dest}</div>`;
    if (why) {
      html += `<p class="small bad">✕ ${why}.</p><div class="btns"><button class="btn sm" data-act="close" data-cact="open">Open Crew ▸</button></div>`;
    } else {
      html += `<div class="crew-row">${p.crew.map((a) => badge(a, true)).join('')}</div>`;
    }
    html += `<p class="small dim" style="margin:6px 0 0">Pays ${money(c.reward)} at launch${c.bonus ? ` + ${money(c.bonus)} at splashdown` : ''}.</p></div>`;
    const abort = '<p class="small good" style="margin:8px 0 0">🛟 Crew safe even if the rocket fails: launch abort system.</p>';
    return { ok: !why, html, abort };
  }
  // Board the crew when the launch button is pressed. Returns astronaut ids.
  function board(st) {
    ensure(st);
    const p = pickCrew(st);
    for (const a of p.crew) a.status = 'flying';
    return p.crew.map((a) => a.id);
  }
  function flightText(st, c) {
    ensure(st); decorate(c);
    return {
      orbitText: 'CREW IN ORBIT ✓',
      orbitSub: c.station ? `${st.crew.capsule.name} heading for ${STATION}` : `${st.crew.capsule.name} on a ${c.stay}-day orbit trip`,
      failText: 'Abort system fired · crew safe',
    };
  }
  // After any contract flight. lines: result rows [label, value].
  function onFlight(st, ctx, ok, lines) {
    const C = ensure(st);
    const c = ctx.c;
    if (!c) return;
    if (!c.crew) {
      if (ok && c.kind === 'cargo') {
        const before = C.station.supplies;
        C.station.supplies = Math.min(100, before + CFG.cargoSupplies);
        lines.push([`🛰️ ${STATION}`, `Supplies ${before}% → ${C.station.supplies}%`]);
      }
      return;
    }
    decorate(c);
    const crew = C.roster.filter((a) => (ctx.crewIds || []).includes(a.id));
    if (ok) {
      for (const a of crew) a.status = 'orbit';
      C.capsule.flights++;
      C.mission = { ids: crew.map((a) => a.id), start: st.day, stay: c.stay, station: !!c.station, bonus: c.bonus || 0, client: c.client, label: c.label };
      lines.push(['👩‍🚀 Crew', crew.map((a) => esc(a.name.split(' ')[0])).join(', ')]);
      lines.push([c.station ? `Docked at ${STATION}` : 'In orbit', `Home in ${c.stay} days`]);
    } else {
      for (const a of crew) { a.status = 'rest'; a.rest = CFG.abortRestDays; }
      lines.push(['🛟 Launch abort', '<span class="good">Crew safe</span>']);
      if (G()) G().log(`🛟 The launch abort system pulled <b>${esc(C.capsule.name)}</b> clear. The crew is safe.`);
    }
  }

  // ---------- UI ----------
  let view = 'rockets';
  function statusText(st, a) {
    if (a.status === 'training') return `Training ${Math.round(a.train / ROLES[a.role].days * 100)}%`;
    if (a.status === 'ready') return '✓ Ready';
    if (a.status === 'flying') return 'Launching';
    if (a.status === 'orbit') {
      const m = st.crew.mission;
      return m ? `In orbit · day ${Math.min(m.stay, st.day - m.start)}/${m.stay}` : 'In orbit';
    }
    if (a.status === 'rest') return `Resting · ${a.rest} day${a.rest === 1 ? '' : 's'}`;
    return '';
  }
  function rank(a) { return a.flights >= 3 ? 'Veteran' : a.flights >= 1 ? 'Flown' : 'Rookie'; }
  function portrait(a) {
    return `<div class="cw-face" style="background:hsl(${a.hue} 45% 32%)" aria-hidden="true">${esc(initials(a.name))}<span class="cw-role">${ROLES[a.role].icon}</span></div>`;
  }
  function badge(a) {
    return `<div class="cw-chip">${portrait(a)}<div><b>${esc(a.name)}</b><div class="small dim">${ROLES[a.role].name} · ${rank(a)}</div></div></div>`;
  }
  function subnav() {
    return `<div class="seg cw-sub" role="tablist"><button data-cact="view" data-id="rockets" class="${view === 'rockets' ? 'on' : ''}">🚀 Rockets</button><button data-cact="view" data-id="crew" class="${view === 'crew' ? 'on' : ''}">👩‍🚀 Crew</button></div>`;
  }
  // Small card for the Launch tab's right column.
  function opsCard(st) {
    const C = ensure(st);
    if (!st.techs.capsule && !C.roster.length) return '';
    const m = C.mission;
    let body;
    if (m) {
      const d = Math.min(m.stay, st.day - m.start);
      body = `<b>🛸 ${esc(C.capsule.name)} · In orbit: day ${d}/${m.stay}</b><div class="small dim">${m.station ? `Docked at ${STATION}` : 'Orbit trip'}</div><div class="bar good"><i style="width:${Math.round(d / m.stay * 100)}%"></i></div>`;
    } else {
      const why = blocker(st);
      body = `<b>🛸 ${esc(C.capsule.name)} · ${why ? 'Not ready' : '✓ Crew ready'}</b><div class="small dim">${why || 'Pick a crew contract to fly.'}</div>`;
    }
    return `<h2>👩‍🚀 Crew</h2><div class="card tap" data-cact="open">${body}<div class="btns"><button class="btn sm" data-cact="open">Open Crew ▸</button></div></div>`;
  }
  // The Crew sub-view of the Launch tab.
  function render(el, game) {
    const st = game.state;
    const C = ensure(st);
    // Don't wipe the capsule name while the player is typing it.
    const inp = document.getElementById('cw-cap');
    if (inp && document.activeElement === inp && el.contains(inp)) return;
    const m = C.mission;
    let html = subnav();
    if (!st.techs.capsule) {
      html += `<div class="card locked"><b>🔒 Research Crew Capsule to fly people</b><div class="small dim">It needs Landing Legs and costs ${window.APOGEE_SIM.TECHS.capsule.rp} science (🔬 Research). You can hire and train astronauts now, so they are ready when it is.</div></div>`;
    }
    html += `<div class="cols"><div>`;
    // Roster
    const p = pickCrew(st);
    const nReady = ready(st).length;
    html += `<h2>Astronauts <span class="dim">(${C.roster.length}/${CFG.maxRoster})</span></h2>`;
    html += `<div class="card small">A crew is 4 trained astronauts: at least one ⭐ commander and one 🕹️ pilot.
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill ${nReady >= 4 ? 'good' : 'bad'}">${nReady >= 4 ? '✓' : '✕'} ${nReady}/4 ready</span><span class="pill ${p.cmd ? 'good' : 'bad'}">${p.cmd ? '✓' : '✕'} Commander</span><span class="pill ${p.plt ? 'good' : 'bad'}">${p.plt ? '✓' : '✕'} Pilot</span></div></div>`;
    if (!C.roster.length) html += `<div class="empty">No astronauts yet. Hire some below.</div>`;
    html += `<div class="grid">`;
    for (const a of C.roster) {
      const tr = a.status === 'training';
      const cls = a.status === 'ready' ? 'good' : a.status === 'orbit' || a.status === 'flying' ? 'blue' : '';
      html += `<div class="card cw-card">${portrait(a)}<div class="grow"><b>${esc(a.name)}</b>
        <div class="small dim">${ROLES[a.role].icon} ${ROLES[a.role].name} · ${rank(a)}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill ${cls}">${statusText(st, a)}</span><span class="pill">Flights: ${a.flights}</span>${a.spaceDays ? `<span class="pill">${a.spaceDays} days in space</span>` : ''}</div>
        ${tr ? `<div class="bar"><i style="width:${Math.round(a.train / ROLES[a.role].days * 100)}%"></i></div><div class="small dim">${ROLES[a.role].days - a.train} days to go</div>` : ''}</div>
        ${a.status === 'ready' || a.status === 'training' ? `<button class="btn sm cw-x" data-cact="fire" data-id="${a.id}" aria-label="Let ${esc(a.name)} go">Let go</button>` : ''}</div>`;
    }
    html += `</div>`;
    // Recruits
    html += `<h2>Hire astronauts</h2><p class="small dim" style="margin:-4px 2px 8px">Hiring pays for training. Each astronaut costs ${Math.round(CFG.salary * 1000)}k dollars a month. New candidates every 45 days.</p><div class="grid">`;
    const full = C.roster.length >= CFG.maxRoster;
    for (const a of C.pool) {
      const R = ROLES[a.role];
      html += `<div class="card cw-card">${portrait(a)}<div class="grow"><b>${esc(a.name)}</b><div class="small dim">${R.icon} ${R.name} · trains ${R.days} days</div></div>
        <button class="btn primary sm" data-cact="hire" data-id="${a.id}" ${full || st.cash < R.cost ? 'disabled' : ''}>Hire · ${money(R.cost)}</button></div>`;
    }
    html += `</div>${full ? '<p class="small dim">Your astronaut office is full (8).</p>' : ''}</div><div>`;
    // Capsule
    html += `<h2>Capsule</h2><div class="card"><label class="small dim" for="cw-cap">Name your capsule</label>
      <div style="display:flex;gap:6px;margin-top:4px"><input type="text" id="cw-cap" maxlength="20" value="${esc(C.capsule.name)}"><button class="btn sm" data-cact="cap-name">Save</button></div>
      <div class="kv"><div><small>Status</small><b>${!st.techs.capsule ? '🔒 Locked' : m ? '🛰️ In orbit' : '✓ On the ground'}</b></div><div><small>Flights</small><b>${C.capsule.flights}</b></div><div><small>Mass</small><b>12 t</b></div></div>
      <p class="small dim" style="margin:8px 0 0">🛟 Launch abort system: if the rocket fails, the capsule pulls the crew clear.</p></div>`;
    // Mission
    html += `<h2>In space</h2><div class="card">`;
    if (m) {
      const d = Math.min(m.stay, st.day - m.start);
      const crew = C.roster.filter((a) => m.ids.includes(a.id));
      html += `<b>In orbit: day ${d}/${m.stay}</b><div class="small dim">${esc(m.label || 'Crew flight')} · ${m.station ? `docked at ${STATION}` : 'free flight'}</div>
        <div class="bar good"><i style="width:${Math.round(d / m.stay * 100)}%"></i></div>
        <div class="small" style="margin-top:6px">🪂 Splashdown in ${m.stay - d} day${m.stay - d === 1 ? '' : 's'}${m.bonus ? ` · bonus ${money(m.bonus)}` : ''}</div>
        <div class="crew-row">${crew.map((a) => badge(a)).join('')}</div>`;
    } else html += `<div class="small dim">No crew in space right now.</div>`;
    if (C.last) html += `<div class="small" style="margin-top:8px">🪂 Last splashdown, day ${C.last.day}: ${C.last.text}</div>`;
    html += `</div>`;
    // Station
    const sup = C.station.supplies;
    html += `<h2>🛰️ ${STATION}</h2><div class="card"><div class="small dim">A research outpost in low orbit. Crew rotations stay ${CFG.stationStay} days, then come home with science.</div>
      <div style="display:flex;justify-content:space-between;margin-top:8px"><span class="small">Supplies</span><b>${sup}% · ${sup >= 30 ? 'Well stocked' : sup > 0 ? 'Running low' : 'Empty'}</b></div>
      <div class="bar ${sup >= 30 ? 'good' : 'bad'}"><i style="width:${sup}%"></i></div>
      <div class="kv"><div><small>Crew visits</small><b>${C.station.visits}</b></div><div><small>Crew aboard</small><b>${m && m.station ? 4 : 0}</b></div></div>
      <p class="small dim" style="margin:8px 0 0">Station cargo runs (📋 Contracts) add ${CFG.cargoSupplies}% supplies. A stocked station gives 50% more science per visit.</p></div>`;
    html += `</div></div>`;
    el.innerHTML = html;
  }

  function onClick(e) {
    const el = e.target.closest('[data-cact]');
    if (!el) return;
    const game = G();
    if (!game) return;
    const st = game.state;
    const C = ensure(st);
    const act = el.dataset.cact, id = el.dataset.id;
    if (act === 'view') { view = id === 'crew' ? 'crew' : 'rockets'; game.refresh(); }
    else if (act === 'open') { view = 'crew'; game.goTab('ops'); }
    else if (act === 'hire') {
      const a = C.pool.find((x) => x.id === id);
      if (!a || C.roster.length >= CFG.maxRoster) return;
      const R = ROLES[a.role];
      if (st.cash < R.cost) { game.toast('Not enough cash.'); return; }
      st.cash -= R.cost;
      C.pool = C.pool.filter((x) => x !== a);
      a.status = 'training'; a.train = 0;
      C.roster.push(a);
      C.pool.push(newPerson(st, a.role));
      game.log(`Hired ${R.name.toLowerCase()} <b>${esc(a.name)}</b> for ${money(R.cost)}. Training takes ${R.days} days.`);
      game.toast(`👩‍🚀 ${esc(a.name)} starts training`);
      game.save(); game.refresh();
    } else if (act === 'fire') {
      const a = C.roster.find((x) => x.id === id);
      if (!a || !(a.status === 'ready' || a.status === 'training')) return;
      if (!window.confirm(`Let ${a.name} go?`)) return;
      C.roster = C.roster.filter((x) => x !== a);
      game.log(`<b>${esc(a.name)}</b> left the astronaut office.`);
      game.save(); game.refresh();
    } else if (act === 'cap-name') {
      const inp = document.getElementById('cw-cap');
      const v = inp ? inp.value.trim().slice(0, 20) : '';
      if (!v) return;
      C.capsule.name = v;
      inp.blur();
      game.toast(`🛸 Capsule named ${esc(v)}`);
      game.save(); game.refresh();
    }
  }
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'cw-cap') { e.preventDefault(); const b = document.querySelector('[data-cact="cap-name"]'); if (b) b.click(); }
  });

  // Styles for the crew view (kept here so style.css stays untouched).
  const css = document.createElement('style');
  css.textContent = `
  .cw-sub { margin-bottom: 12px; }
  .cw-sub button { min-height: 40px; padding: 8px 16px; }
  .cw-card { display: flex; gap: 10px; align-items: flex-start; }
  .cw-face { position: relative; flex: none; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
    font-weight: 800; font-size: 16px; letter-spacing: .04em; color: #fff; border: 2px solid var(--line); }
  .cw-role { position: absolute; right: -5px; bottom: -5px; width: 22px; height: 22px; border-radius: 50%; background: var(--panel2);
    border: 1px solid var(--line); display: grid; place-items: center; font-size: 12px; }
  .cw-x { flex: none; min-height: 40px; }
  .cw-card .btn.primary { flex: none; min-height: 40px; }
  .crew-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr)); gap: 8px; margin-top: 8px; }
  .cw-chip { display: flex; gap: 8px; align-items: center; background: var(--panel2); border-radius: 10px; padding: 6px 8px; min-width: 0; }
  .cw-chip b { font-size: 13px; }
  .cw-chip .cw-face { width: 36px; height: 36px; font-size: 13px; }
  .cw-chip .cw-role { width: 16px; height: 16px; font-size: 9px; right: -6px; bottom: -6px; }
  `;
  document.head.appendChild(css);

  window.APOGEE_CREW = {
    ROLES, CFG, STATION,
    ensure, tick, decorate, blocker, pickCrew, check, board, flightText, onFlight,
    subnav, opsCard, render,
    get view() { return view; }, set view(v) { view = v; },
    contractPill(st, c) {
      if (!c.crew || !st.techs.capsule) return '';
      decorate(c);
      const why = blocker(st);
      const where = c.station ? `🛰️ ${c.stay} days at ${STATION}` : `${c.stay}-day orbit trip`;
      return `<span class="pill blue">${where}</span>${why ? `<span class="pill bad">✕ ${why}</span>` : '<span class="pill good">👩‍🚀 Crew ready</span>'}`;
    },
  };
})();
