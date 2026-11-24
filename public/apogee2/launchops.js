// APOGEE launch ops: launch-site weather and scrubs, static fire tests, failure investigations.
// Exposes window.APOGEE_OPS. Pure-ish game logic plus small HTML helpers; game.js calls it from
// renderOps, launchSheet, launch(), afterFlight and dayTick. All state lives in state.ops (added lazily)
// plus two optional fields on a vehicle: v.sf (static fire running) and v.sfDone (static fire passed).
(function () {
  'use strict';
  const S = window.APOGEE_SIM;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (p) => `${Math.round(p * 100)}%`;
  const money = (m) => (m >= 100 ? `$${Math.round(m)}M` : `$${m.toFixed(1)}M`);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // ---------- Weather ----------
  // launch: multiplies launch success. land: added to landing odds. go: 'go' | 'risky' | 'nogo'.
  const WEATHER = {
    clear: { icon: '☀️', name: 'Clear', long: 'Clear skies', launch: 1, land: 0, go: 'go',
      desc: 'Good launch weather.' },
    windy: { icon: '💨', name: 'Windy', long: 'Gusty winds at the pad', launch: 0.97, land: -0.15, landBarge: -0.1, go: 'risky',
      desc: 'Gusts at the pad and rough seas. Landings are much harder.' },
    upper: { icon: '🌬️', name: 'Upper winds', long: 'High upper winds', launch: 0.93, land: -0.05, go: 'risky',
      desc: 'Strong jet stream high up. More stress on the rocket at max-Q.' },
    storm: { icon: '⛈️', name: 'Storm', long: 'Thunderstorm', launch: 0, land: 0, go: 'nogo',
      desc: 'Lightning near the pad. No launches today.' },
  };
  const GO = {
    go: { mark: '✓', text: 'GO', cls: 'good' },
    risky: { mark: '⚠', text: 'RISKY', cls: 'acc' },
    nogo: { mark: '✕', text: 'NO-GO', cls: 'bad' },
  };

  function ensure(st) {
    if (!st) return null;
    const o = st.ops = st.ops || {};
    o.wx = o.wx || {};
    o.inv = o.inv || [];
    o.done = o.done || [];
    o.fixes = o.fixes || {};
    o.fixes.engine = o.fixes.engine || {};
    o.fixes.landing = o.fixes.landing || {};
    o.scrubs = o.scrubs || 0;
    o.statics = o.statics || 0;
    return o;
  }

  function roll(prev) {
    // Weather tends to stick around for a day or two.
    if (prev && Math.random() < 0.3) return prev === 'storm' && Math.random() < 0.5 ? 'windy' : prev;
    const r = Math.random();
    return r < 0.56 ? 'clear' : r < 0.76 ? 'windy' : r < 0.9 ? 'upper' : 'storm';
  }
  function wxOn(st, day) {
    const o = ensure(st);
    if (!o.wx[day]) {
      let from = day;
      while (from > st.day && !o.wx[from - 1]) from--;
      for (let d = from; d <= day; d++) {
        if (!o.wx[d]) o.wx[d] = d === 1 ? 'clear' : roll(o.wx[d - 1]);
      }
    }
    return o.wx[day];
  }
  function prune(st) {
    const o = ensure(st);
    for (const k of Object.keys(o.wx)) if (+k < st.day - 1) delete o.wx[k];
  }
  function today(st) { const k = wxOn(st, st.day); return Object.assign({ kind: k }, WEATHER[k]); }
  function forecast(st, n) {
    const out = [];
    for (let i = 0; i < (n || 3); i++) { const k = wxOn(st, st.day + i); out.push(Object.assign({ kind: k, day: st.day + i }, WEATHER[k])); }
    return out;
  }

  // ---------- Odds modifiers ----------
  const LAND_NAME = { rtls: 'pad landing', barge: 'barge landing', catch: 'tower catch' };
  function engineShares(design) {
    const tot = design.stages.reduce((a, s) => a + s.count, 0) || 1;
    const sh = {};
    for (const s of design.stages) {
      const base = s.engine.replace(/v$/, ''); // Ember Vac shares the Ember investigation
      sh[base] = (sh[base] || 0) + s.count / tot;
    }
    return sh;
  }
  const baseEngine = (id) => String(id).replace(/v$/, '');
  function openInv(st, kind, key) { return ensure(st).inv.find((x) => x.kind === kind && x.key === key); }
  function rtfFor(st, v) {
    const o = ensure(st);
    const sh = engineShares(v.design);
    return o.inv.filter((x) => x.kind === 'engine' && (x.designId === v.designId || sh[x.key]));
  }

  // Modifier for S.launchOdds: { failMul, mul }.
  function launchMod(st, v, opts) {
    opts = opts || {};
    const o = ensure(st);
    let failMul = 1, mul = 1;
    if (v.sfDone) failMul *= 0.5;
    const sh = engineShares(v.design);
    for (const k of Object.keys(sh)) {
      const n = Math.min(3, o.fixes.engine[k] || 0);
      if (n) failMul *= 1 - (1 - Math.pow(0.8, n)) * sh[k];
    }
    if (rtfFor(st, v).length) mul *= 0.96;
    if (!opts.noWeather) { const w = today(st); if (w.launch) mul *= w.launch; }
    return { failMul, mul };
  }
  // Modifier for S.landingOdds: { add }.
  function landMod(st, recovery, opts) {
    opts = opts || {};
    if (!recovery || recovery === 'expend') return { add: 0 };
    const o = ensure(st);
    let add = 0.04 * Math.min(3, o.fixes.landing[recovery] || 0);
    if (openInv(st, 'landing', recovery)) add -= 0.06;
    if (!opts.noWeather) {
      const w = today(st);
      add += (recovery === 'barge' && w.landBarge != null) ? w.landBarge : w.land;
    }
    return { add };
  }

  // Why the launch can't go today (null if it can).
  function gate(st, v, recovery) {
    const w = today(st);
    const rtf = v ? rtfFor(st, v) : [];
    const li = recovery && recovery !== 'expend' ? openInv(st, 'landing', recovery) : null;
    if (li) rtf.push(li);
    return {
      block: w.go === 'nogo' ? `${w.icon} ${w.long}: ${w.desc}` : null,
      risky: w.go === 'risky' || rtf.length > 0,
      weather: w, rtf,
    };
  }

  // ---------- Static fire ----------
  const ISSUES_MULTI = (st, i) => [`Engine ${1 + Math.floor(Math.random() * st.count)} on stage ${i + 1} swapped`, `Valve on engine ${1 + Math.floor(Math.random() * st.count)} replaced`];
  const ISSUES = ['Leaky fuel line clamp replaced', 'Faulty igniter replaced', 'Pressure sensor swapped', 'Loose wiring harness fixed', 'Stuck vent valve replaced'];
  function staticCost(st, v) { return Math.max(0.2, Math.round((v.cost || S.designCost(v.design, st.techs)) * 0.03 * 10) / 10); }
  function startStatic(st, id) {
    const o = ensure(st);
    const v = st.vehicles.find((x) => x.id === id);
    if (!v || v.status !== 'ready') return { ok: false, msg: 'That rocket is not ready.' };
    if (v.sfDone) return { ok: false, msg: 'Already static fired.' };
    const cost = staticCost(st, v);
    if (st.cash < cost) return { ok: false, msg: 'Not enough cash.' };
    st.cash -= cost;
    let issue = null;
    if (Math.random() < 0.3) {
      const i = Math.floor(Math.random() * v.design.stages.length);
      const sg = v.design.stages[i];
      issue = sg.count >= 3 ? pick(ISSUES_MULTI(sg, i)) : pick(ISSUES);
    }
    v.status = 'static';
    v.sf = { left: 2, total: 2, issue, shown: false, cost };
    o.statics++;
    return { ok: true, msg: `🔥 ${esc(v.serial)} rolled to the test stand · 2 days`, log: `🔥 Started a static fire test on <b>${esc(v.serial)}</b> for <b>${money(cost)}</b>.` };
  }

  // ---------- Investigations ----------
  const CAUSES = {
    engine: ['turbopump seal', 'helium bottle strut', 'main fuel valve actuator', 'igniter wiring harness', 'LOX dome weld', 'gas generator bracket',
      'engine controller software', 'cooling channel crack', 'turbine blade fatigue', 'propellant line bellows'],
    landing: ['grid fin hydraulics', 'landing leg damper', 'cold gas thruster valve', 'radar altimeter glitch', 'engine relight timing',
      'guidance software rounding error', 'leg latch pin'],
    catch: ['catch arm sensor timing', 'grid fin hydraulics', 'engine relight timing', 'guidance software rounding error'],
  };
  function invName(x) {
    return x.kind === 'engine' ? `${(S.ENGINES[x.key] || { name: x.key }).name} engine failure` : `${LAND_NAME[x.key] || x.key} failure`;
  }
  function open(st, kind, key, v, lines) {
    const o = ensure(st);
    const cur = openInv(st, kind, key);
    if (cur) {
      lines.push(['🔎 Investigation', `Added to the open one (${cur.left} days left)`]);
      return null;
    }
    const total = 10 + Math.round(Math.random() * 10);
    const list = kind === 'landing' && key === 'catch' ? CAUSES.catch : CAUSES[kind];
    const x = { id: 'i' + st.day + '-' + Math.floor(Math.random() * 1e6).toString(36), kind, key, designId: v.designId, designName: v.design.name,
      serial: v.serial, start: st.day, total, left: total, cause: pick(list) };
    o.inv.push(x);
    lines.push(['🔎 Investigation opened', `${esc(invName(x))} · about ${total} days`]);
    return x;
  }

  // Called by game.js afterFlight, before save().
  function afterFlight(st, ctx, res, lines) {
    ensure(st);
    const { v, recovery, fail } = ctx;
    const ok = !res.dead;
    const out = [];
    if (ctx.ops && ctx.ops.wx && ctx.ops.wx !== 'clear') {
      const w = WEATHER[ctx.ops.wx];
      if (w) lines.push(['Weather', `${w.icon} ${w.name} · you risked it`]);
    }
    if (ctx.ops && ctx.ops.sf) lines.push(['🔥 Static fire', 'Flew with lower risk']);
    if (!ok && fail && v.design.stages[fail.stage]) {
      const eng = baseEngine(v.design.stages[fail.stage].engine);
      const x = open(st, 'engine', eng, v, lines);
      if (x) out.push(`🔎 Opened a failure investigation into the <b>${esc(invName(x))}</b> on ${esc(v.serial)}. About ${x.total} days.`);
    }
    const reachedLanding = recovery && recovery !== 'expend' && res.stage1Ok !== false && (ok || (fail && fail.stage > 0));
    if (reachedLanding && !res.landed) {
      const x = open(st, 'landing', recovery, v, lines);
      if (x) out.push(`🔎 Opened an investigation into the failed <b>${esc(LAND_NAME[recovery] || recovery)}</b>. About ${x.total} days.`);
    }
    return out;
  }

  // Called by dayTick. Returns { events, toasts }.
  function tick(st) {
    const o = ensure(st);
    const events = [], toasts = [];
    prune(st);
    for (const v of st.vehicles) {
      if (v.status !== 'static' || !v.sf) continue;
      const sf = v.sf;
      sf.left--;
      if (sf.issue && !sf.shown && sf.left <= 1) {
        sf.shown = true; sf.left += 1; sf.total += 1;
        events.push(`🔧 Static fire on <b>${esc(v.serial)}</b> found a problem: ${esc(sf.issue)} (+1 day).`);
        toasts.push(`🔧 ${esc(v.serial)}: ${esc(sf.issue)} (+1 day)`);
      }
      if (sf.left <= 0) {
        v.status = 'ready';
        v.sfDone = { day: st.day, issue: sf.issue || null };
        delete v.sf;
        events.push(`🔥 <b>${esc(v.serial)}</b> passed its static fire${v.sfDone.issue ? ` after a fix (${esc(v.sfDone.issue.toLowerCase())})` : ''}. Its failure risk for the next flight is cut in half.`);
        toasts.push(`🔥 ${esc(v.serial)} static fire passed ✓`);
      }
    }
    for (const x of o.inv.slice()) {
      x.left--;
      if (x.left > 0) continue;
      o.inv = o.inv.filter((y) => y !== x);
      o.fixes[x.kind][x.key] = (o.fixes[x.kind][x.key] || 0) + 1;
      o.done.unshift({ kind: x.kind, key: x.key, cause: x.cause, day: st.day, name: invName(x) });
      o.done = o.done.slice(0, 6);
      const what = x.kind === 'engine' ? `${(S.ENGINES[x.key] || { name: x.key }).name} engines are now more reliable` : `${LAND_NAME[x.key] || x.key} odds go up`;
      events.push(`✅ Investigation closed: the ${esc(invName(x))} was caused by the <b>${esc(x.cause)}</b>. Fixed for good: ${what}.`);
      toasts.push(`✅ Root cause found: ${esc(x.cause)}`);
    }
    return { events, toasts };
  }

  // Scrub: just bookkeeping. game.js advances the day.
  function noteScrub(st, v) {
    const o = ensure(st);
    o.scrubs++;
    const w = today(st);
    return `⏳ Scrubbed the launch of <b>${esc(v ? v.serial : 'the rocket')}</b> (${w.icon} ${esc(w.long.toLowerCase())}). Waiting a day.`;
  }

  // Data for the 3D flight (plan.weather).
  function flightWeather(st) {
    const w = today(st);
    if (w.kind === 'windy') return { kind: w.kind, text: `${w.icon} ${w.long}`, haze: 0.32, aloft: false, tint: 'linear-gradient(180deg, rgba(150,160,175,.85), rgba(120,128,140,.55) 60%, rgba(90,95,105,.35))', wind: { x: 16, z: 6 } };
    if (w.kind === 'upper') return { kind: w.kind, text: `${w.icon} ${w.long}`, haze: 0.28, aloft: true, tint: 'repeating-linear-gradient(170deg, rgba(200,210,230,.0) 0 40px, rgba(200,210,230,.55) 40px 70px, rgba(200,210,230,.0) 70px 120px)', wind: { x: 8, z: 3 } };
    return { kind: w.kind, text: '', haze: 0, aloft: false, tint: 'none', wind: { x: 3.5, z: 1.5 } };
  }

  // ---------- HTML ----------
  let cssDone = false;
  function css() {
    if (cssDone || typeof document === 'undefined') return;
    cssDone = true;
    const s = document.createElement('style');
    s.textContent = `
.ops-wx { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.ops-wx > div { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 8px; text-align: center; min-width: 0; }
.ops-wx > div.now { border-color: var(--accent); }
.ops-wx .ic { font-size: 22px; line-height: 1.2; }
.ops-wx small { display: block; color: var(--dim); font-size: 11px; }
.ops-wx b { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ops-wx .pill { margin-top: 4px; }
.ops-note { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; padding: 6px 0; border-top: 1px solid var(--line); }
.ops-note:first-child { border-top: 0; }
.ops-note > span:first-child { flex: none; width: 22px; text-align: center; }
.ops-note .good { color: var(--good); } .ops-note .bad { color: var(--bad); } .ops-note .acc { color: var(--accent2, var(--accent)); }
.btn.ops-b { min-height: 40px; }
.ops-block { border: 1px solid var(--bad); border-radius: 12px; padding: 10px 12px; margin: 10px 0; font-size: 14px; }
.ops-risk { border: 1px dashed var(--accent); border-radius: 12px; padding: 10px 12px; margin: 10px 0; font-size: 14px; }
.ops-launch { display: grid; gap: 8px; }
`;
    document.head.appendChild(s);
  }

  function forecastHtml(st) {
    css();
    const names = ['Today', 'Tomorrow'];
    return `<div class="ops-wx">${forecast(st, 3).map((w, i) => {
      const g = GO[w.go];
      return `<div class="${i === 0 ? 'now' : ''}" title="${esc(w.desc)}"><small>${names[i] || 'Day ' + w.day}</small><div class="ic" aria-hidden="true">${w.icon}</div><b>${esc(w.name)}</b><span class="pill ${g.cls}">${g.mark} ${g.text}</span></div>`;
    }).join('')}</div>`;
  }

  function note(icon, html) { return `<div class="ops-note"><span aria-hidden="true">${icon}</span><span>${html}</span></div>`; }

  // Block for the launch sheet (above Flight check): forecast + what changes the odds.
  function sheetHtml(st, v, s) {
    css();
    if (!v) return '';
    const w = today(st);
    const design = v.design;
    const df = st.designFlights[v.designId] || 0;
    const base = S.launchOdds(design, st.heritage, df);
    const noWx = S.launchOdds(design, st.heritage, df, launchMod(st, v, { noWeather: true }));
    const full = S.launchOdds(design, st.heritage, df, launchMod(st, v));
    const rec = s.recovery;
    const notes = [];
    if (w.go === 'go') notes.push(note(w.icon, `<b>${esc(w.long)}</b>. <span class="good">✓ No effect on the odds.</span>`));
    else if (w.go === 'nogo') notes.push(note(w.icon, `<b>${esc(w.long)}</b>. <span class="bad">✕ ${esc(w.desc)}</span>`));
    else {
      const lw = rec && rec !== 'expend' ? ((rec === 'barge' && w.landBarge != null) ? w.landBarge : w.land) : 0;
      notes.push(note(w.icon, `<b>${esc(w.long)}</b>. <span class="acc">⚠ Launch −${pct(noWx - full)}${lw ? `, landing −${Math.round(-lw * 100)}%` : ''}.</span> ${esc(w.desc)}`));
    }
    if (v.sfDone) notes.push(note('🔥', `<b>Static fire passed</b>${v.sfDone.issue ? ` (${esc(v.sfDone.issue.toLowerCase())})` : ''}. <span class="good">✓ Failure risk cut in half.</span>`));
    const o = ensure(st);
    const fixed = Object.keys(engineShares(design)).filter((k) => o.fixes.engine[k]);
    if (fixed.length) notes.push(note('🛠️', `Fixes from past investigations make ${fixed.map((k) => esc((S.ENGINES[k] || { name: k }).name)).join(' and ')} engines more reliable.`));
    if (rec && rec !== 'expend' && o.fixes.landing[rec]) notes.push(note('🛠️', `Past fixes: ${esc(LAND_NAME[rec])} odds +${4 * Math.min(3, o.fixes.landing[rec])}%.`));
    for (const x of rtfFor(st, v)) notes.push(note('⚠', `<b>Return to flight</b>: the ${esc(invName(x))} investigation is still open (${x.left} day${x.left > 1 ? 's' : ''} left). <span class="acc">Launch odds a bit lower.</span> You can wait for the fix.`));
    if (rec && rec !== 'expend') {
      const li = openInv(st, 'landing', rec);
      if (li) notes.push(note('⚠', `<b>Return to flight</b>: the ${esc(invName(li))} investigation is still open (${li.left} days left). <span class="acc">Landing odds −6%.</span>`));
    }
    const sum = Math.abs(full - base) >= 0.005 ? `<p class="small dim" style="margin:6px 0 0">Launch success ${pct(base)} → <b>${pct(full)}</b> with all of the above.</p>` : '';
    return `<h2>Launch weather</h2>${forecastHtml(st)}<div class="card" style="margin-top:8px">${notes.join('')}${sum}</div>`;
  }

  // Replaces the launch button on the sheet. launchBtn is the normal button HTML.
  function launchButtons(st, v, s, canLaunch, c) {
    css();
    if (!v) return '';
    const g = gate(st, v, s && s.recovery);
    const serial = esc(v.serial);
    const left = c && c.expires ? c.expires - st.day : null;
    const clock = left != null ? ` The contract clock keeps ticking: ${left} day${left === 1 ? '' : 's'} left${left <= 1 ? ' (it expires if you wait!)' : ''}.` : '';
    if (g.block) {
      return `<div class="ops-block"><b>✕ No-go today.</b> ${esc(g.block)}</div>
        <div class="ops-launch"><button class="btn primary big" disabled>🚀 Launch ${serial} · no-go</button>
        <button class="btn big ops-b" data-act="ops-scrub">⏳ Scrub and wait a day</button></div>
        <p class="small dim">The rocket stays ready.${clock}</p>`;
    }
    if (g.risky) {
      const why = [];
      if (g.weather.go === 'risky') why.push(`${g.weather.icon} ${esc(g.weather.long.toLowerCase())}`);
      if (g.rtf.length) why.push('⚠ an open failure investigation');
      return `<div class="ops-risk"><b>⚠ Risky launch:</b> ${why.join(' and ')}.</div>
        <div class="ops-launch"><button class="btn primary big" data-act="launch" ${canLaunch ? '' : 'disabled'}>🚀 Launch anyway (risk it)</button>
        <button class="btn big ops-b" data-act="ops-scrub">⏳ Scrub and wait a day</button></div>
        <p class="small dim">Scrubbing keeps ${serial} ready.${clock}</p>`;
    }
    return null; // use the normal button
  }

  // Static fire button (or badge) for a ready vehicle card on the Launch tab.
  function vehicleBtn(st, v) {
    css();
    if (v.sfDone) return `<span class="pill good" style="align-self:center">🔥 Static fire ✓ · risk halved</span>`;
    const cost = staticCost(st, v);
    return `<button class="btn sm ops-b" data-act="ops-static" data-id="${v.id}" ${st.cash < cost ? 'disabled' : ''} title="Fire the engines on the pad. Cuts the failure risk for the next flight in half.">🔥 Static fire · ${money(cost)} · 2 days</button>`;
  }

  // Left column of the Launch tab: test stand and investigations.
  function opsLeftHtml(st) {
    css();
    const o = ensure(st);
    let html = '';
    const sf = st.vehicles.filter((v) => v.status === 'static' && v.sf);
    if (sf.length) {
      html += `<h2>🔥 On the test stand</h2>`;
      for (const v of sf) {
        const p = 1 - v.sf.left / v.sf.total;
        html += `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(v.serial)} <span class="dim small">${esc(v.design.name)}</span></b><span class="small">${v.sf.left} day${v.sf.left > 1 ? 's' : ''} left</span></div>
          <div class="bar"><i style="width:${pct(p)}"></i></div>
          <div class="small ${v.sf.shown ? 'acc' : 'dim'}" style="margin-top:6px">${v.sf.shown ? `🔧 Problem found: ${esc(v.sf.issue)} (+1 day)` : 'Static fire test. The rocket can\'t fly until it is done.'}</div></div>`;
      }
    }
    if (o.inv.length || o.done.length) {
      html += `<h2>🔎 Failure investigations</h2>`;
      for (const x of o.inv) {
        const p = 1 - x.left / x.total;
        html += `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(invName(x))}</b><span class="small">${x.left} day${x.left > 1 ? 's' : ''} left</span></div>
          <div class="small dim">${esc(x.serial)} · ${esc(x.designName)} · opened day ${x.start}</div>
          <div class="bar"><i style="width:${pct(p)}"></i></div>
          <div class="small acc" style="margin-top:6px">⚠ Return to flight: ${x.kind === 'engine' ? `rockets with ${esc((S.ENGINES[x.key] || { name: x.key }).name)} engines` : `the ${esc(LAND_NAME[x.key] || x.key)}`} fly with slightly lower odds until this is done.</div></div>`;
      }
      if (o.done.length) {
        html += `<div class="card small">${o.done.slice(0, 4).map((d) => `<div style="padding:3px 0">✅ Day ${d.day} · ${esc(d.name)}: <b>${esc(d.cause)}</b>. Fixed for good.</div>`).join('')}</div>`;
      }
    }
    return html;
  }

  // Right column card: forecast.
  function opsWeatherHtml(st) {
    css();
    const w = today(st);
    const g = GO[w.go];
    return `<h2>Launch weather</h2><div class="card">${forecastHtml(st)}<p class="small" style="margin:8px 0 0"><span class="${g.cls}">${g.mark} ${g.text}</span> today: ${esc(w.desc)}${w.go === 'risky' ? ' You can still launch, or wait for better weather.' : ''}</p></div>`;
  }

  window.APOGEE_OPS = {
    WEATHER, ensure, today, forecast, launchMod, landMod, gate,
    staticCost, startStatic, afterFlight, tick, noteScrub, flightWeather,
    forecastHtml, sheetHtml, launchButtons, vehicleBtn, opsLeftHtml, opsWeatherHtml,
  };
})();
