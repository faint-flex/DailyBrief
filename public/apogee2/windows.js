// APOGEE: launch windows and deep-space transit for Moon and Mars missions.
// Mars windows open every ~780 days (synodic period). Moon windows open every 27 days.
// Deep-space contracts pay when the craft arrives, not at launch.
(function (root) {
  'use strict';

  const MARS = { syn: 780, len: 35, first: 320 }; // window k opens on day first + k*syn and stays open len days
  const MOON = { syn: 27, len: 5, first: 3, penalty: 500 }; // outside the window: +500 m/s
  const BODY = { LLO: 'moon', LUN: 'moon', MTO: 'mars', MARS: 'mars' };
  const BODY_NAME = { moon: 'Moon', mars: 'Mars' };
  const ICON = { LLO: '🌙', LUN: '🌙', MTO: '🔴', MARS: '🔴' };
  const PHASE = 44; // Mars leads Earth by ~44° at the best launch time
  let rngFn = Math.random;

  const S = () => root.APOGEE_SIM;
  const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moneyF = (m) => (root.APOGEE_GAME && root.APOGEE_GAME.money ? root.APOGEE_GAME.money(m) : `$${m.toFixed(1)}M`);

  function bodyOf(target) { return BODY[target] || null; }
  function cfg(body) { return body === 'mars' ? MARS : MOON; }

  // The window open now, or the next one. end is the first day it is closed again.
  function windowAt(body, day) {
    const w = cfg(body);
    const k = Math.floor((day - w.first) / w.syn);
    let start = w.first + k * w.syn;
    const open = day >= start && day < start + w.len;
    if (!open) start += w.syn;
    if (start + w.len <= day) start += w.syn;
    const end = start + w.len;
    return { body, open, start, end, daysLeft: open ? end - day : 0, daysAway: open ? 0 : start - day, len: w.len, syn: w.syn };
  }
  // The window after the given one.
  function nextAfter(win) { return { ...win, open: false, start: win.start + win.syn, end: win.end + win.syn }; }

  // Window status for a launch target on a day.
  function check(target, day) {
    const body = bodyOf(target);
    if (!body) return null;
    const w = windowAt(body, day);
    const r = { body, target, win: w, open: w.open, blocked: false, penalty: 0, reason: '' };
    if (body === 'mars' && !w.open) {
      r.blocked = true;
      r.reason = `Next Mars window opens in ${w.daysAway} day${w.daysAway === 1 ? '' : 's'} (day ${w.start}).`;
    } else if (body === 'moon' && !w.open) {
      r.penalty = MOON.penalty;
      r.reason = `Moon window opens in ${w.daysAway} day${w.daysAway === 1 ? '' : 's'}. Launching now costs +${MOON.penalty} m/s.`;
    }
    return r;
  }

  function ensure(state) {
    if (!state) return;
    state.transits = state.transits || [];
    state.arrivals = state.arrivals || {};
    // Old saves: give Mars offers a deadline that reaches the end of a Mars window.
    for (const c of state.contracts || []) {
      if (bodyOf(c.target) === 'mars' && !c.win) align(c, state, true);
    }
  }

  // Line a Mars contract's deadline up with a window. Returns false if the offer is too far off to make sense.
  function align(c, state, keep) {
    if (!c || bodyOf(c.target) !== 'mars') return true;
    let w = windowAt('mars', state.day);
    if (w.open && w.daysLeft < 8) w = nextAfter(w);
    if (!keep && !w.open && w.start - state.day > 360) return false;
    c.expires = keep ? Math.max(c.expires, w.end) : w.end;
    c.win = w.start;
    return true;
  }

  // Make a contract offer; re-roll Mars offers that are too far from a window (up to 4 tries).
  function offer(make, state) {
    for (let i = 0; i < 4; i++) { const c = make(); if (align(c, state)) return c; }
    return null;
  }

  // Adjust a S.mission() result for the window. Returns the window check (or null for near-Earth targets).
  function apply(m, target, state) {
    const r = check(target, state.day);
    if (!r) return null;
    if (r.penalty) {
      m.need += r.penalty;
      m.ok = !!m.canLift && m.have >= m.need;
    }
    m.window = r;
    return r;
  }

  function transitDays(target, rng) {
    rng = rng || rngFn;
    if (bodyOf(target) === 'moon') return 3 + Math.floor(rng() * 3); // 3–5 days
    return 180 + Math.floor(rng() * 81); // 180–260 days
  }

  // Chance the craft makes it at the far end (orbit insertion or landing). Grows with experience.
  function arrivalOdds(target, state) {
    const n = (state.arrivals && state.arrivals[target]) || 0;
    const T = state.techs || {};
    let p;
    if (target === 'LLO') p = 0.95 + 0.01 * n;
    else if (target === 'MTO') p = 0.9 + 0.015 * n;
    else if (target === 'LUN') p = 0.8 + 0.03 * n + (T.rapid ? 0.03 : 0);
    else p = 0.72 + 0.04 * n + (T.habitat ? 0.05 : 0) + (T.rapid ? 0.02 : 0);
    return Math.min(0.97, p);
  }
  const isLanding = (target) => target === 'LUN' || target === 'MARS';

  function takesTime(c) { return !!(c && bodyOf(c.target) && !c.crew); }

  // Text for the flight's orbit card.
  function orbitSub(target, days) {
    const b = BODY_NAME[bodyOf(target)] || 'deep space';
    return `On its way to ${b} · arrives in about ${days} day${days === 1 ? '' : 's'}`;
  }

  // Called by afterFlight on a good launch of a deep-space contract. Adds result lines.
  function depart(state, ctx, lines, api) {
    ensure(state);
    const c = ctx.c, v = ctx.v;
    const days = ctx.transitDays || transitDays(c.target);
    const odds = arrivalOdds(c.target, state);
    const t = {
      id: 't' + Math.floor(rngFn() * 1e9).toString(36),
      kind: c.kind, label: c.label, client: c.client, target: c.target, mass: c.mass, reward: c.reward, rep: c.rep,
      serial: v.serial, launched: state.day, arrive: state.day + days, odds,
    };
    state.transits.push(t);
    state.contracts = state.contracts.filter((x) => x.id !== c.id);
    state.rp += 4;
    const b = BODY_NAME[bodyOf(c.target)];
    ctx.transit = t;
    lines.push(['In transit', `${ICON[c.target]} ${days} days to ${b} · arrives day ${t.arrive}`]);
    lines.push(['Payment', `Paid on arrival: <span class="money">${moneyF(c.reward)}</span>`]);
    lines.push([isLanding(c.target) ? 'Landing odds' : 'Arrival odds', `${Math.round(odds * 100)}%`]);
    lines.push(['Science', '+4']);
    api.log(`<b>${escH(v.serial)}</b> is on its way to ${b} with ${escH(c.client)}'s ${escH(String(c.label).toLowerCase())}. Arrives day ${t.arrive}.`);
  }

  // Daily: resolve arrivals. api = { log, toast, award(id, lines), money }.
  function tick(state, api) {
    ensure(state);
    const due = state.transits.filter((t) => t.arrive <= state.day);
    if (!due.length) return;
    state.transits = state.transits.filter((t) => t.arrive > state.day);
    for (const t of due) {
      const b = BODY_NAME[bodyOf(t.target)];
      const good = rngFn() < (t.odds || arrivalOdds(t.target, state));
      state.arrivals[t.target] = (state.arrivals[t.target] || 0) + 1;
      const what = isLanding(t.target) ? 'landed on' : 'arrived at';
      if (good) {
        state.cash += t.reward;
        state.stats.earned += t.reward;
        state.rep += t.rep || 0;
        const sci = 4 + Math.round((t.rep || 0) / 2);
        state.rp += sci;
        const lines = [];
        if (bodyOf(t.target) === 'moon') api.award('firstMoon', lines);
        else api.award('firstMars', lines);
        let extra = '';
        if (t.kind === 'marscity') {
          state.marsCity = (state.marsCity || 0) + 1;
          extra = ` Mars city: <b>${state.marsCity}/5</b> cargo ships landed.`;
          if (state.marsCity >= 5 && !state.milestones.marsCity) { api.award('marsCity', lines); state.won = true; }
        }
        api.log(`✅ <b>${escH(t.serial)}</b> ${what} ${b}! ${escH(t.client)} paid <b>${api.money(t.reward)}</b> (+${t.rep} rep, +${sci} science).${extra}`);
        api.toast(`${ICON[t.target]} ${escH(t.serial)} ${what} ${b} · +${api.money(t.reward)}`);
      } else {
        state.rep = Math.max(0, state.rep - 4);
        state.rp += 3;
        const how = isLanding(t.target) ? 'crashed while landing on' : 'was lost going into orbit around';
        api.log(`💥 <b>${escH(t.serial)}</b> ${how} ${b}. ${escH(t.client)} will not pay. Reputation −4, +3 science.`);
        api.toast(`💥 ${escH(t.serial)} ${how} ${b}`);
      }
    }
  }

  // ---------- UI ----------
  function statusLine(body, day) {
    const w = windowAt(body, day);
    const n = BODY_NAME[body];
    if (w.open) return `<div class="wnd-line"><span class="wnd-ic" aria-hidden="true">🟢</span><span><b>${n} window: OPEN now</b> · ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left <span class="dim">(closes day ${w.end})</span></span></div>`;
    if (body === 'moon') return `<div class="wnd-line"><span class="wnd-ic" aria-hidden="true">🟠</span><span><b>${n} window: closed</b> · opens day ${w.start}, ${w.daysAway} day${w.daysAway === 1 ? '' : 's'} away <span class="dim">(launch now: +${MOON.penalty} m/s)</span></span></div>`;
    return `<div class="wnd-line"><span class="wnd-ic" aria-hidden="true">🔴</span><span><b>${n} window: closed</b> · opens day ${w.start}, ${w.daysAway} days away</span></div>`;
  }

  // A strip showing the next ~900 days with Mars windows marked.
  function timeline(day) {
    const span = 900;
    let w = windowAt('mars', day);
    let html = '<div class="wnd-tl" role="img" aria-label="Mars windows over the next 900 days">';
    for (let i = 0; i < 3 && w.start < day + span; i++) {
      const a = Math.max(0, w.start - day), bEnd = Math.min(span, w.end - day);
      html += `<i style="left:${(a / span) * 100}%;width:${Math.max(1.2, ((bEnd - a) / span) * 100)}%"></i><span class="wnd-tl-lab" style="left:${Math.min(84, (a / span) * 100)}%">day ${w.start}</span>`;
      w = nextAfter(w);
    }
    html += '<b class="wnd-now" style="left:0"></b></div><div class="wnd-tl-axis small dim"><span>▲ Today (day ' + day + ')</span><span>+900 days</span></div>';
    return html;
  }

  // Earth–Mars orbit diagram (SVG). Earth and Mars move at their real rates; phases line up with the windows.
  const R_E = 46, R_M = 70;
  function earthAng(d) { return (d / 365) * 360 + 90; }
  function phaseAng(d) {
    let w = windowAt('mars', d);
    if (!w.open && w.start - d > MARS.syn / 2) w = { start: w.start - MARS.syn }; // nearest window centre
    const centre = w.start + MARS.len / 2;
    return PHASE - (360 * (d - centre)) / MARS.syn;
  }
  function marsAng(d) { return earthAng(d) + phaseAng(d); }
  function xy(r, deg) { const a = (deg * Math.PI) / 180; return [r * Math.cos(a), -r * Math.sin(a)]; }
  function arcPath(t0, t1, aE, aM) {
    let a1 = aM;
    while (a1 < aE) a1 += 360;
    while (a1 - aE > 360) a1 -= 360;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const s = i / 24, r = R_E + (R_M - R_E) * (1 - Math.cos(Math.PI * s)) / 2;
      const p = xy(r, aE + (a1 - aE) * s);
      pts.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`);
    }
    return { d: 'M' + pts.join(' L'), at: (s) => xy(R_E + (R_M - R_E) * (1 - Math.cos(Math.PI * s)) / 2, aE + (a1 - aE) * s) };
  }
  function diagram(state) {
    const day = state.day;
    const e = xy(R_E, earthAng(day)), m = xy(R_M, marsAng(day));
    let arcs = '';
    for (const t of state.transits || []) {
      if (bodyOf(t.target) !== 'mars') continue;
      const p = arcPath(t.launched, t.arrive, earthAng(t.launched), marsAng(t.arrive));
      const s = Math.max(0, Math.min(1, (day - t.launched) / Math.max(1, t.arrive - t.launched)));
      const c = p.at(s);
      arcs += `<path d="${p.d}" class="wnd-arc"/><g class="wnd-craft"><polygon points="${c[0]},${c[1] - 4} ${c[0] - 3.5},${c[1] + 3} ${c[0] + 3.5},${c[1] + 3}"/><text x="${c[0] + 5}" y="${c[1] - 4}">${escH(t.serial)}</text></g>`;
    }
    const w = windowAt('mars', day);
    if (w.open && !arcs) {
      const p = arcPath(day, day + 220, earthAng(day), marsAng(day + 220));
      arcs += `<path d="${p.d}" class="wnd-arc ghost"/>`;
    }
    return `<svg class="wnd-svg" viewBox="-90 -90 180 180" role="img" aria-label="Orbit map: Earth, Mars and transfer paths">
      <circle r="${R_E}" class="wnd-orb"/><circle r="${R_M}" class="wnd-orb"/>
      <circle r="6" class="wnd-sun"/>
      ${arcs}
      <circle cx="${e[0]}" cy="${e[1]}" r="5" class="wnd-earth"/><text x="${e[0] + 7}" y="${e[1] + 3}" class="wnd-t">Earth</text>
      <rect x="${m[0] - 4}" y="${m[1] - 4}" width="8" height="8" rx="1.5" class="wnd-mars"/><text x="${m[0] + 7}" y="${m[1] + 3}" class="wnd-t">Mars</text>
    </svg>`;
  }

  function transitRows(state) {
    const list = (state.transits || []).slice().sort((a, b) => a.arrive - b.arrive);
    if (!list.length) return '';
    return list.map((t) => {
      const total = Math.max(1, t.arrive - t.launched), done = Math.max(0, Math.min(total, state.day - t.launched));
      const left = t.arrive - state.day, b = BODY_NAME[bodyOf(t.target)];
      return `<div class="wnd-tr"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${ICON[t.target]} ${escH(t.serial)} → ${b}</b><span class="small">${left <= 0 ? 'Arriving today' : `ETA day ${t.arrive} · ${left} day${left === 1 ? '' : 's'} left`}</span></div>
        <div class="small dim">${escH(t.label)} for ${escH(t.client)} · pays ${moneyF(t.reward)} on arrival · ${isLanding(t.target) ? 'landing' : 'arrival'} odds ${Math.round((t.odds || 0) * 100)}%</div>
        <div class="bar" role="progressbar" aria-valuenow="${Math.round((done / total) * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${(done / total) * 100}%"></i></div></div>`;
    }).join('');
  }

  function relevant(state) {
    return (state.transits && state.transits.length) || state.rep >= 30 || (state.contracts || []).some((c) => bodyOf(c.target));
  }

  // Launch tab card: transits, windows, timeline, orbit map.
  function opsCard(state) {
    ensure(state);
    if (!relevant(state)) return '';
    const tr = transitRows(state);
    return `<h2>🪐 Deep space</h2><div class="card wnd-card">
      ${tr ? `<div class="small dim" style="margin-bottom:4px">In transit</div>${tr}` : ''}
      <div class="wnd-flex"><div class="grow">
        ${statusLine('mars', state.day)}${statusLine('moon', state.day)}
        ${timeline(state.day)}
        <p class="small dim">Mars launches only work inside a window. Missions pay when they arrive.</p>
      </div>${diagram(state)}</div></div>`;
  }

  // Contracts tab: short window card, shown when deep-space offers are on the list.
  function contractsCard(state) {
    ensure(state);
    if (!(state.contracts || []).some((c) => bodyOf(c.target)) && !(state.transits || []).length) return '';
    return `<div class="card wnd-card">${statusLine('mars', state.day)}${statusLine('moon', state.day)}${timeline(state.day)}</div>`;
  }

  // Pill for a contract card.
  function contractPill(c, state) {
    const r = check(c.target, state.day);
    if (!r) return '';
    const days = BODY[c.target] === 'mars' ? 'Arrives in 180–260 days' : 'Arrives in 3–5 days';
    if (r.open) return `<span class="pill good">🟢 Window open · ${r.win.daysLeft}d left</span><span class="pill">⏳ ${days}</span>`;
    if (r.blocked) return `<span class="pill bad">🔴 Window opens in ${r.win.daysAway}d</span><span class="pill">⏳ ${days}</span>`;
    return `<span class="pill acc">🟠 Moon window in ${r.win.daysAway}d</span><span class="pill">⏳ ${days}</span>`;
  }

  // Extra block for the launch sheet's flight check.
  function launchHtml(r, state, target) {
    if (!r) return '';
    const b = BODY_NAME[r.body];
    const odds = arrivalOdds(target, state);
    const time = r.body === 'mars' ? '180–260 days' : '3–5 days';
    let html = `<div class="card wnd-card">`;
    html += r.blocked ? `<p class="bad"><b>🔴 Can't launch to Mars now.</b> ${r.reason}</p>`
      : r.penalty ? `<p class="acc"><b>🟠 Outside the Moon window.</b> ${r.reason} <span class="dim">(included above)</span></p>`
      : `<p class="good"><b>🟢 ${b} window open</b> · ${r.win.daysLeft} day${r.win.daysLeft === 1 ? '' : 's'} left</p>`;
    html += `<div class="kv"><div><small>Trip time</small><b>${time}</b></div><div><small>${isLanding(target) ? 'Landing odds' : 'Arrival odds'}</small><b>${Math.round(odds * 100)}%</b></div><div><small>Payment</small><b>On arrival</b></div></div></div>`;
    return html;
  }

  // Styles live here so shared style.css stays untouched.
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('wnd-css')) return;
    const st = document.createElement('style');
    st.id = 'wnd-css';
    st.textContent = `
.wnd-card .wnd-line { display:flex; gap:8px; align-items:flex-start; font-size:13px; padding:3px 0; }
.wnd-ic { flex:none; width:18px; text-align:center; }
.wnd-flex { display:flex; gap:12px; align-items:center; }
.wnd-flex > .grow { flex:1; min-width:0; }
.wnd-svg { width:170px; height:170px; flex:none; }
.wnd-orb { fill:none; stroke:var(--line); stroke-width:1; }
.wnd-sun { fill:#f2d14b; }
.wnd-earth { fill:var(--blue); stroke:#fff; stroke-width:1; }
.wnd-mars { fill:var(--accent); stroke:#fff; stroke-width:1; }
.wnd-t { fill:var(--text); font-size:9px; font-weight:700; }
.wnd-arc { fill:none; stroke:var(--accent2); stroke-width:1.5; stroke-dasharray:3 2; }
.wnd-arc.ghost { stroke:var(--dim); opacity:.7; }
.wnd-craft polygon { fill:#fff; } .wnd-craft text { fill:var(--accent2); font-size:8px; font-weight:700; }
.wnd-tl { position:relative; height:12px; background:var(--panel2); border-radius:99px; margin:22px 0 2px; }
.wnd-tl > i { position:absolute; top:0; bottom:0; background:repeating-linear-gradient(45deg, var(--good) 0 4px, rgba(61,220,151,.45) 4px 8px); border-radius:99px; }
.wnd-tl-lab { position:absolute; top:-18px; font-size:11px; color:var(--good); white-space:nowrap; font-weight:700; }
.wnd-now { position:absolute; top:-3px; bottom:-3px; width:3px; background:#fff; border-radius:2px; }
.wnd-tl-axis { display:flex; justify-content:space-between; }
.wnd-tr { padding:6px 0 8px; border-bottom:1px solid var(--line); margin-bottom:6px; }
@media (max-width: 520px) { .wnd-flex { flex-direction:column; align-items:stretch; } .wnd-svg { align-self:center; width:200px; height:200px; } }
`;
    document.head.appendChild(st);
  }
  injectCss();

  root.APOGEE_WINDOWS = {
    MARS, MOON, bodyOf, windowAt, check, ensure, align, offer, apply, transitDays, arrivalOdds, takesTime, orbitSub,
    depart, tick, opsCard, contractsCard, contractPill, launchHtml, diagram,
    setRng(fn) { rngFn = fn || Math.random; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
