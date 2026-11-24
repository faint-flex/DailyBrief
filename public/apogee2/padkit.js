// APOGEE pad kit (window.APOGEE_PADKIT): launch pad types and customisable launch towers.
// - Pad types (Light, Standard, Heavy, Sea platform): max liftoff mass, turnaround, reliability bonus, pad wear.
// - Integrated tower per pad: height, crew access arm, catch arms, lightning masts, colour.
// - Launch sheet: pick the pad, block launches no pad can take, show "ready in N days".
// - 3D: dresses the flight's launch scene (3d-env.js launchSite) and the Base map pad model (campus-view.js).
// State lives on each pad building: b.pk = { kind, tw: {h, crew, arms, masts, finish}, turnUntil, repairUntil, worksUntil, conv }.
// Old saves: pads without b.pk become Standard pads with a tall tower (the old look) on first use.
(function (root) {
  'use strict';

  // ---------- Data ----------
  const KINDS = {
    light: { name: 'Light pad', short: 'LIGHT', icon: '🛬', max: [150, 300, 500], cost: 4, days: 12, mulC: 0.6, mulD: 0.7, turn: 0.6, rel: 0.005, wear: 1.3, maxH: 'tall', arms: false,
      desc: 'Cheap and quick. A flat pad with no flame trench, for small rockets only. Fast turnaround.' },
    standard: { name: 'Standard pad', short: 'STANDARD', icon: '🚀', max: [1000, 2500, 5000], cost: 6, days: 20, mulC: 1, mulD: 1, turn: 1, rel: 0.01, wear: 1, maxH: 'mega', arms: true,
      desc: 'A raised pad with a flame trench. Good for most rockets.' },
    heavy: { name: 'Heavy pad', short: 'HEAVY', icon: '🌊', max: [4000, 9000, 20000], cost: 14, days: 34, mulC: 1.8, mulD: 1.5, turn: 0.85, rel: 0.02, wear: 0.35, maxH: 'mega', arms: true, deluge: true,
      desc: 'Water deluge and a big flame trench. Needed for the biggest rockets. Takes much less damage and turns around faster.' },
    sea: { name: 'Sea platform', short: 'SEA', icon: '⚓', max: [20000, 20000, 20000], cost: 22, days: 40, mulC: 2.2, mulD: 1.6, turn: 1.8, rel: 0.005, wear: 0.6, maxH: 'mega', arms: true, coastal: true, sea: true,
      desc: 'A launch platform out at sea. Takes any size of rocket, but every launch needs a long trip out and back. Must touch the ocean.' },
  };
  const KIND_ORDER = ['light', 'standard', 'heavy', 'sea'];
  const HEIGHTS = {
    short: { name: 'Short', m: 60, cost: 0, days: 0, turn: 1, note: 'Included' },
    tall: { name: 'Tall', m: 100, cost: 4, days: 6, turn: 0.9, note: '−10% turnaround' },
    mega: { name: 'Mega', m: 150, cost: 10, days: 10, turn: 0.8, note: '−20% turnaround' },
  };
  const H_ORDER = ['short', 'tall', 'mega'];
  const PARTS = {
    crew: { name: 'Crew access arm', icon: '🧑‍🚀', cost: 2, days: 4, note: 'Needed to fly people.' },
    arms: { name: 'Catch arms', icon: '🦾', cost: 15, days: 10, note: 'Catch boosters right on this pad (needs Tower Catch research and a tall tower).' },
    masts: { name: 'Lightning masts', icon: '⚡', cost: 1.5, days: 3, note: 'Fewer launch delays from storms.' },
  };
  const FINISH = {
    steel: { name: 'Steel grey', hex: 0x7d8288, css: '#7d8288' },
    white: { name: 'White', hex: 0xd8d6d0, css: '#e8e6e0' },
    black: { name: 'Black', hex: 0x2a2c30, css: '#2a2c30' },
  };
  const FINISH_COST = 0.5, FINISH_DAYS = 2;
  const TOO_SHORT_PENALTY = 0.02;

  const r2 = (n) => Math.round(n * 100) / 100;
  const C = () => root.APOGEE_CAMPUS;
  const G = () => root.APOGEE_GAME;
  const fmtT = (t) => `${Math.round(t).toLocaleString()} t`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (G() && G().money ? G().money(n) : `$${n.toFixed(1)}M`);

  // ---------- State ----------
  function defaults(kind, legacy, st) {
    // Old pads keep the look they had: a tall tower with lightning masts (and a crew arm once crew flights were possible).
    return { kind, tw: { h: legacy ? 'tall' : 'short', crew: !!(legacy && st && st.techs && st.techs.capsule), arms: false, masts: !!legacy, finish: 'steel' }, turnUntil: 0, repairUntil: 0, worksUntil: 0, launches: 0 };
  }
  function pads(st) { return st && st.campus && st.campus.b ? st.campus.b.filter((b) => b.type === 'pad') : []; }
  function settle(st, b) {
    if (!b.pk) b.pk = defaults('standard', true, st);
    const pk = b.pk;
    if (!KINDS[pk.kind]) pk.kind = 'standard';
    if (!pk.tw) pk.tw = defaults(pk.kind, true, st).tw;
    if (pk.conv && st && st.day >= pk.conv.until) {
      pk.kind = pk.conv.to; delete pk.conv;
      limitTower(pk);
    }
    return pk;
  }
  function limitTower(pk) {
    const K = KINDS[pk.kind];
    if (H_ORDER.indexOf(pk.tw.h) > H_ORDER.indexOf(K.maxH)) pk.tw.h = K.maxH;
    if (!K.arms) pk.tw.arms = false;
  }
  function ensure(st) { for (const b of pads(st)) settle(st, b); }
  function padById(st, id) {
    const b = pads(st).find((o) => o.id === id);
    if (b) settle(st, b);
    return b || null;
  }

  // ---------- Rules ----------
  function maxLiftoff(b) { const K = KINDS[b.pk.kind]; return b.lvl > 0 ? K.max[Math.min(3, b.lvl) - 1] : 0; }
  function towerM(b) { return HEIGHTS[b.pk.tw.h].m; }
  function turnMul(st, b) { const pk = settle(st, b); return KINDS[pk.kind].turn * HEIGHTS[pk.tw.h].turn; }
  function mul(st, b) { const pk = settle(st, b); return { c: KINDS[pk.kind].mulC, d: KINDS[pk.kind].mulD }; }
  function hasArms(st, b) { const pk = settle(st, b); return b.lvl > 0 && !!pk.tw.arms && !(pk.worksUntil > (st.day || 0)); }
  function catchTowerNext(st, b) {
    // A separate Catch tower building touching this pad still works.
    return st.campus.b.some((o) => o.type === 'tower' && o.lvl > 0 && o.site === b.site && touches(o, b));
  }
  function touches(a, b) {
    const ox = a.x < b.x + b.w && b.x < a.x + a.w, oy = a.y < b.y + b.h && b.y < a.y + a.h;
    return (ox && (a.y + a.h === b.y || b.y + b.h === a.y)) || (oy && (a.x + a.w === b.x || b.x + b.w === a.x));
  }
  function canCatch(st, b) { return hasArms(st, b) || catchTowerNext(st, b); }
  function turnDays(st, b) {
    try { const bo = C().bonus(st); if (bo.padTurn && bo.padTurn[b.id]) return bo.padTurn[b.id]; } catch (e) { /* ignore */ }
    return Math.max(2, Math.round([12, 7, 4][Math.max(0, Math.min(2, b.lvl - 1))] * turnMul(st, b)));
  }
  function repairDays(b, liftoff) {
    const k = KINDS[b.pk.kind], cap = maxLiftoff(b) || 1;
    return Math.max(0, Math.round((liftoff / cap - 0.4) * 25 * k.wear));
  }
  function status(st, b) {
    const pk = settle(st, b), day = st.day || 0;
    if (b.lvl <= 0) return { ok: false, days: b.days, icon: '🏗️', text: `Being built · ready in ${plural(b.days, 'day')}` };
    const parts = [];
    if (pk.conv && pk.conv.until > day) parts.push([pk.conv.until, `Rebuilding as ${KINDS[pk.conv.to].name.toLowerCase()}`, '🏗️']);
    if (pk.worksUntil > day) parts.push([pk.worksUntil, 'Tower works', '🔩']);
    if (pk.repairUntil > day && pk.repairUntil > pk.turnUntil) parts.push([pk.repairUntil, 'Turnaround and repairs', '🔧']);
    else if (pk.turnUntil > day) parts.push([pk.turnUntil, 'Turnaround', '⏳']);
    if (!parts.length) return { ok: true, days: 0, icon: '✓', text: 'Ready' };
    parts.sort((a, c) => c[0] - a[0]);
    const d = parts[0][0] - day;
    return { ok: false, days: d, icon: parts[0][2], text: `${parts[0][1]} · ready in ${plural(d, 'day')}` };
  }
  function padName(st, b) {
    const site = C() && C().SITE[b.site];
    const same = pads(st).filter((o) => o.site === b.site);
    const n = same.length > 1 ? ` ${same.indexOf(b) + 1}` : '';
    return `${site ? site.name : b.site} pad${n}`;
  }

  // ---------- Public API for other features ----------
  // Crew feature: true if this pad (or, with no padId, any finished pad) has a crew access arm.
  function padHasCrewArm(st, padId) {
    const list = padId ? [padById(st, padId)].filter(Boolean) : pads(st).filter((b) => b.lvl > 0);
    return list.some((b) => settle(st, b).tw.crew && b.lvl > 0);
  }
  // Weather feature: 0..0.75, the share of lightning/storm scrubs this pad avoids (best pad if no padId).
  function padLightningProtection(st, padId) {
    const val = (b) => { const pk = settle(st, b); if (b.lvl <= 0) return 0; return (pk.tw.masts ? 0.6 : 0) + (pk.tw.h === 'mega' ? 0.15 : pk.tw.h === 'tall' ? 0.05 : 0); };
    if (padId) { const b = padById(st, padId); return b ? val(b) : 0; }
    return Math.max(0, ...pads(st).map(val));
  }

  // ---------- Base map hooks (campus.js) ----------
  let buildKind = 'standard';
  function placeCost() { return KINDS[buildKind].cost; }
  function placeDays() { return KINDS[buildKind].days; }
  function placeWhy(st, site, r) {
    const K = KINDS[buildKind];
    if (K.coastal) {
      const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let sea = false;
      for (let y = r.y; y < r.y + r.h && !sea; y++) for (let x = r.x; x < r.x + r.w && !sea; x++) for (const [dx, dy] of N4) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < site.h && xx >= 0 && xx < site.w && site.map[yy][xx] === 'S') { sea = true; break; } }
      if (!sea) return 'A sea platform must touch the ocean';
    }
    return '';
  }
  function onPlaced(st, b) {
    b.pk = defaults(buildKind, false, st);
    b.days = b.total = KINDS[buildKind].days;
  }
  function kindPickerHTML(st) {
    return `<div class="pk-kwrap"><div class="small"><b>Pad type:</b></div><div class="pk-kinds" role="group" aria-label="Pad type">${KIND_ORDER.map((k) => {
      const K = KINDS[k];
      return `<button class="pk-kind ${k === buildKind ? 'on' : ''}" data-pk="kind" data-v="${k}" aria-pressed="${k === buildKind}">${k === buildKind ? '● ' : '○ '}${K.icon} <b>${K.name}</b><br><span>${money(K.cost)} · ${K.days}d · max ${fmtT(K.max[0])}${K.coastal ? ' · on the coast' : ''}</span></button>`;
    }).join('')}</div><div class="small dim">${escH(KINDS[buildKind].desc)}</div></div>`;
  }
  function panelHTML(st, b) {
    const pk = settle(st, b), K = KINDS[pk.kind], s = status(st, b), lv = Math.max(1, b.lvl);
    const tw = pk.tw, H = HEIGHTS[tw.h];
    const parts = [`${H.name} tower ${H.m} m`, tw.crew && '🧑‍🚀 crew arm', tw.arms && '🦾 catch arms', tw.masts && '⚡ masts', `${FINISH[tw.finish].name.toLowerCase()}`].filter(Boolean);
    return `<div class="pk-box"><div><b>${K.icon} ${K.name}</b> · max liftoff <b>${fmtT(K.max[lv - 1])}</b>${b.lvl < 3 && K.max[lv] !== K.max[lv - 1] ? ` <span class="dim">(${fmtT(K.max[lv])} at level ${lv + 1})</span>` : ''}</div>
      <div class="${s.ok ? 'cp-ok' : 'cp-no'}">${s.icon} ${escH(s.text)}</div>
      <div class="small dim">🗼 ${parts.join(' · ')} · ${b.lvl > 0 ? `${plural(turnDays(st, b), 'day')} turnaround` : `turnaround ×${r2(turnMul(st, b))}`} · +${Math.round(K.rel * 1000) / 10}% launch success</div>
      <button class="btn sm" data-pk="open" data-v="${b.id}">🗼 Tower &amp; pad type</button></div>`;
  }
  function viewKey(b) {
    const pk = b.pk; if (!pk) return '';
    return [pk.kind, pk.tw.h, pk.tw.crew ? 1 : 0, pk.tw.arms ? 1 : 0, pk.tw.masts ? 1 : 0, pk.tw.finish].join('.');
  }
  function kindName(b) { return b.pk && KINDS[b.pk.kind] ? KINDS[b.pk.kind].name : 'Launch pad'; }
  function badge(b) { return b.pk && KINDS[b.pk.kind] ? KINDS[b.pk.kind].short : ''; }

  // ---------- Tower panel (own overlay, styled like the game's sheets) ----------
  let pane = null; // { wrap, id }
  function tallestRocket(st) {
    const D = root.APOGEE_DRAW;
    let h = 0;
    if (!D || !D.geometry) return 0;
    for (const v of st.vehicles || []) { try { h = Math.max(h, D.geometry(v.design, st.techs).total); } catch (e) { /* ignore */ } }
    return h;
  }
  function previewSVG(st, b) {
    const pk = b.pk, tw = pk.tw, K = KINDS[pk.kind];
    const rk = tallestRocket(st);
    const W = 300, Hh = 170, gy = 150, sc = 120 / 160;
    const th = HEIGHTS[tw.h].m * sc, rh = (rk || 50) * sc;
    const col = FINISH[tw.finish].css;
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" role="img" aria-label="${escH(`${K.name} with a ${HEIGHTS[tw.h].name.toLowerCase()} ${HEIGHTS[tw.h].m} metre tower`)}">`;
    s += `<rect x="0" y="${gy}" width="${W}" height="${Hh - gy}" fill="${K.sea ? '#1f6090' : '#3a4030'}"/>`;
    if (K.sea) s += `<rect x="70" y="${gy - 6}" width="170" height="8" fill="#5b616b"/>`;
    else s += `<rect x="60" y="${gy - (pk.kind === 'light' ? 3 : 8)}" width="190" height="${pk.kind === 'light' ? 3 : 8}" fill="#8a8a84"/>`;
    if (K.deluge) s += `<rect x="168" y="${gy - 8}" width="60" height="8" fill="#2b2e35"/><circle cx="262" cy="${gy - 46}" r="12" fill="#e8e6e0"/><rect x="259" y="${gy - 36}" width="6" height="36" fill="#7d8288"/>`;
    else if (pk.kind !== 'light') s += `<rect x="168" y="${gy - 8}" width="40" height="8" fill="#2b2e35"/>`;
    const tx = 110, top = gy - 8 - th;
    s += `<rect x="${tx}" y="${top}" width="16" height="${th}" fill="${col}" stroke="#11141a" stroke-width="1"/>`;
    for (let y = top + 8; y < gy - 8; y += 10) s += `<line x1="${tx}" y1="${y}" x2="${tx + 16}" y2="${y + 8}" stroke="#11141a" stroke-width="0.8"/>`;
    const rx = 150, rtop = gy - 8 - rh;
    s += `<rect x="${rx - 7}" y="${rtop + 6}" width="14" height="${rh - 6}" fill="#f2f4f8" stroke="#555" stroke-width="0.6"/><path d="M${rx - 7} ${rtop + 6} L${rx} ${rtop - 4} L${rx + 7} ${rtop + 6}Z" fill="#ff7a1a"/>`;
    if (tw.crew) { const y = Math.max(top + 4, rtop + rh * 0.14); s += `<rect x="${tx + 16}" y="${y}" width="${rx - 7 - tx - 16}" height="4" fill="#d9b23a"/>`; }
    if (tw.arms) { const y = Math.max(top + 6, gy - 8 - rh * 0.6); s += `<rect x="${tx + 16}" y="${y}" width="34" height="5" fill="#4a4e54"/><rect x="${tx + 16}" y="${y + 7}" width="34" height="5" fill="#4a4e54"/>`; }
    if (tw.masts) for (const mx of [30, 280]) s += `<line x1="${mx}" y1="${gy}" x2="${mx}" y2="${Math.max(6, top - 16)}" stroke="#aab" stroke-width="2"/><polygon points="${mx - 4},${Math.max(6, top - 16)} ${mx + 4},${Math.max(6, top - 16)} ${mx},${Math.max(0, top - 24)}" fill="#ffd54a"/>`;
    s += `<text x="${tx - 4}" y="${top - 4}" fill="#e9ecf4" font-size="11" text-anchor="end">${HEIGHTS[tw.h].m} m</text>`;
    if (rk) s += `<text x="${rx + 10}" y="${rtop + 8}" fill="#e9ecf4" font-size="11">rocket ${Math.round(rk)} m</text>`;
    return s + '</svg>';
  }
  function paneHTML(st, b) {
    const pk = settle(st, b), K = KINDS[pk.kind], tw = pk.tw, cash = st.cash, s = status(st, b), lv = Math.max(1, b.lvl);
    const rk = tallestRocket(st);
    let h = `<div class="head"><h3>🗼 ${escH(padName(st, b))}</h3><button class="x" data-pk="close" aria-label="Close">✕</button></div>`;
    h += `<div class="small"><b>${K.icon} ${K.name}</b> · level ${b.lvl || 0} · <span class="${s.ok ? 'good' : 'bad'}">${s.icon} ${escH(s.text)}</span></div>`;
    h += `<div class="pk-prev">${previewSVG(st, b)}</div>`;
    // Pad type
    h += '<h2>Pad type</h2><div class="pk-grid">';
    for (const k of KIND_ORDER) {
      const Q = KINDS[k], cur = k === pk.kind, conv = pk.conv && pk.conv.to === k;
      const cost = r2(Q.cost * (1 + 0.6 * (lv - 1)) * 0.8), days = Math.round(Q.days * 0.8);
      let why = '';
      if (Q.coastal && C()) { const site = C().SITE[b.site]; const old = buildKind; buildKind = k; why = placeWhy(st, site, b); buildKind = old; }
      if (!why && b.lvl <= 0) why = 'Finish building first';
      if (!why && pk.conv) why = 'Already rebuilding';
      if (!why && cash < cost) why = 'Not enough cash';
      h += `<button class="pk-opt ${cur ? 'on' : ''}" data-pk="conv" data-id="${b.id}" data-v="${k}" ${cur || conv || why ? 'disabled' : ''} aria-pressed="${cur}">
        <b>${cur ? '● ' : '○ '}${Q.icon} ${Q.name}</b><span>max ${fmtT(Q.max[lv - 1])} · turnaround ×${Q.turn} · +${Q.rel * 100}%</span>
        <span>${cur ? '✓ Current type' : conv ? `🏗️ Rebuilding: ${plural(pk.conv.until - st.day, 'day')}` : why ? `✕ ${escH(why)}` : `Rebuild · ${money(cost)} · ${days}d`}</span></button>`;
    }
    h += `</div><p class="small dim">${escH(K.desc)} Rebuilding closes the pad until it is done.</p>`;
    // Tower height
    h += '<h2>Tower height</h2><div class="pk-grid">';
    for (const k of H_ORDER) {
      const Q = HEIGHTS[k], cur = tw.h === k, up = H_ORDER.indexOf(k) > H_ORDER.indexOf(tw.h);
      const tooBig = H_ORDER.indexOf(k) > H_ORDER.indexOf(K.maxH);
      const why = tooBig ? `Too big for a ${K.name.toLowerCase()}` : !up ? '' : cash < Q.cost ? 'Not enough cash' : '';
      h += `<button class="pk-opt ${cur ? 'on' : ''}" data-pk="height" data-id="${b.id}" data-v="${k}" ${cur || why ? 'disabled' : ''} aria-pressed="${cur}">
        <b>${cur ? '● ' : '○ '}${Q.name} · ${Q.m} m</b><span>${Q.note}</span><span>${cur ? '✓ Current' : why ? `✕ ${escH(why)}` : up ? `Build · ${money(Q.cost)} · ${Q.days}d` : 'Cut down · free · 2d'}</span></button>`;
    }
    h += '</div>';
    if (rk > HEIGHTS[tw.h].m) h += `<p class="small bad">⚠ Your tallest rocket is ${Math.round(rk)} m, taller than this ${HEIGHTS[tw.h].m} m tower. Crews can't reach the top: −${TOO_SHORT_PENALTY * 100}% launch success.</p>`;
    else if (rk) h += `<p class="small good">✓ Tall enough for your tallest rocket (${Math.round(rk)} m).</p>`;
    // Parts
    h += '<h2>Tower parts</h2><div class="pk-parts">';
    for (const k of Object.keys(PARTS)) {
      const P = PARTS[k], on = !!tw[k];
      let why = '';
      if (k === 'arms') {
        if (!K.arms) why = `A ${K.name.toLowerCase()} can't hold catch arms`;
        else if (!(st.techs && st.techs.tower)) why = 'Research Tower Catch first';
        else if (tw.h === 'short') why = 'Needs a tall or mega tower';
      }
      if (!why && !on && cash < P.cost) why = 'Not enough cash';
      h += `<div class="pk-part"><div class="grow"><b>${P.icon} ${P.name}</b> <span class="${on ? 'good' : 'dim'}">${on ? '✓ Fitted' : '○ Not fitted'}</span><div class="small dim">${escH(P.note)}</div></div>
        ${on ? `<button class="btn sm" data-pk="part" data-id="${b.id}" data-v="${k}" data-on="0">Remove</button>` : `<button class="btn primary sm" data-pk="part" data-id="${b.id}" data-v="${k}" data-on="1" ${why ? 'disabled' : ''}>${why ? `✕ ${escH(why)}` : `Add · ${money(P.cost)} · ${P.days}d`}</button>`}</div>`;
    }
    h += '</div>';
    // Finish
    h += '<h2>Colour</h2><div class="seg">';
    for (const k of Object.keys(FINISH)) {
      const F = FINISH[k], cur = tw.finish === k;
      h += `<button data-pk="finish" data-id="${b.id}" data-v="${k}" class="${cur ? 'on' : ''}" ${cur || cash < FINISH_COST ? 'disabled' : ''} aria-pressed="${cur}"><span class="pk-sw" style="background:${F.css}"></span>${cur ? '✓ ' : ''}${F.name}${cur ? '' : ` · ${money(FINISH_COST)}`}</button>`;
    }
    h += `</div><p class="small dim">Tower work closes the pad for a few days. Changes show up in the 3D launch and on the Base map.</p>`;
    return h;
  }
  function openPane(id) {
    if (!pane) {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-wrap pk-wrap';
      wrap.innerHTML = '<div class="sheet pk-sheet" role="dialog" aria-modal="true" aria-label="Launch tower"></div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) closePane(); });
      pane = { wrap, id };
    }
    pane.id = id; pane.wrap.hidden = false;
    renderPane();
  }
  function closePane() { if (pane) { pane.wrap.hidden = true; pane.id = null; } }
  function renderPane() {
    if (!pane || !pane.id || !G()) return;
    const st = G().state, b = padById(st, pane.id);
    if (!b) { closePane(); return; }
    const box = pane.wrap.firstElementChild, sc = box.scrollTop;
    box.innerHTML = paneHTML(st, b);
    box.scrollTop = sc;
  }
  function works(st, b, days) { const pk = b.pk; pk.worksUntil = Math.max(pk.worksUntil || 0, st.day + days); } // jobs run side by side
  function act(a, el) {
    const g = G(); if (!g) return;
    const st = g.state, b = el.dataset.id ? padById(st, el.dataset.id) : null, v = el.dataset.v;
    let msg = '';
    if (a === 'kind') { if (KINDS[v]) buildKind = v; }
    else if (a === 'open') { openPane(v); return; }
    else if (a === 'close') { closePane(); return; }
    else if (b && a === 'conv' && KINDS[v] && !b.pk.conv && b.lvl > 0) {
      const lv = b.lvl, Q = KINDS[v], cost = r2(Q.cost * (1 + 0.6 * (lv - 1)) * 0.8), days = Math.round(Q.days * 0.8);
      if (st.cash < cost) { g.toast('✕ Not enough cash'); return; }
      st.cash -= cost; b.spent = r2((b.spent || 0) + cost);
      b.pk.conv = { to: v, until: st.day + days };
      msg = `Rebuilding ${padName(st, b)} as a <b>${Q.name.toLowerCase()}</b> (${days} days, ${money(cost)}).`;
    } else if (b && a === 'height' && HEIGHTS[v]) {
      const Q = HEIGHTS[v], up = H_ORDER.indexOf(v) > H_ORDER.indexOf(b.pk.tw.h);
      if (H_ORDER.indexOf(v) > H_ORDER.indexOf(KINDS[b.pk.kind].maxH)) return;
      if (up && st.cash < Q.cost) { g.toast('✕ Not enough cash'); return; }
      if (up) { st.cash -= Q.cost; b.spent = r2((b.spent || 0) + Q.cost); }
      b.pk.tw.h = v; if (v === 'short') b.pk.tw.arms = false;
      works(st, b, up ? Q.days : 2);
      msg = `${padName(st, b)}: tower ${up ? 'raised' : 'cut down'} to <b>${Q.name.toLowerCase()} (${Q.m} m)</b>.`;
    } else if (b && a === 'part' && PARTS[v]) {
      const P = PARTS[v], on = el.dataset.on === '1';
      if (on) {
        if (st.cash < P.cost) { g.toast('✕ Not enough cash'); return; }
        if (v === 'arms' && (!KINDS[b.pk.kind].arms || !(st.techs && st.techs.tower) || b.pk.tw.h === 'short')) return;
        st.cash -= P.cost; b.spent = r2((b.spent || 0) + P.cost); works(st, b, P.days);
      }
      b.pk.tw[v] = on;
      msg = `${padName(st, b)}: ${on ? 'fitted' : 'removed'} the <b>${P.name.toLowerCase()}</b>.`;
    } else if (b && a === 'finish' && FINISH[v]) {
      if (st.cash < FINISH_COST) { g.toast('✕ Not enough cash'); return; }
      st.cash -= FINISH_COST; b.pk.tw.finish = v; works(st, b, FINISH_DAYS);
      msg = `${padName(st, b)}: tower painted <b>${FINISH[v].name.toLowerCase()}</b>.`;
    } else return;
    if (msg) { g.log(msg); g.toast('🗼 ' + msg.replace(/<[^>]+>/g, '')); }
    g.save(); g.refresh();
    renderPane();
  }
  function onDocClick(e) {
    const el = e.target.closest && e.target.closest('[data-pk]');
    if (!el || el.disabled) return;
    e.stopPropagation();
    act(el.dataset.pk, el);
  }

  // ---------- Launch sheet (game.js) ----------
  // info = { design, liftoff, recovery, crew }. Picks sheet.padId if needed. Returns { ok, why, padId, html, adj(odds), flight }.
  function launchInfo(st, sheet, info) {
    ensure(st);
    const all = pads(st).filter((b) => b.lvl > 0 || b.days > 0);
    const done = all.filter((b) => b.lvl > 0);
    const D = root.APOGEE_DRAW;
    let rkH = 0; try { rkH = D && D.geometry ? D.geometry(info.design, st.techs).total : 0; } catch (e) { rkH = 0; }
    const lift = info.liftoff || 0;
    const fits = (b) => maxLiftoff(b) >= lift;
    const needCatch = info.recovery === 'catch', needCrew = !!info.crew;
    const why = (b) => {
      if (b.lvl <= 0) return 'Still being built';
      if (!fits(b)) return `Too small: takes up to ${fmtT(maxLiftoff(b))}`;
      if (needCatch && !canCatch(st, b)) return 'No catch arms here';
      if (needCrew && !b.pk.tw.crew) return 'No crew access arm';
      const s = status(st, b); if (!s.ok) return s.text;
      return '';
    };
    const score = (b) => (why(b) ? 1000 : 0) + (fits(b) ? 0 : 500) + status(st, b).days + (needCatch && !canCatch(st, b) ? 100 : 0) + (needCrew && !b.pk.tw.crew ? 100 : 0) + (b.pk.kind === 'sea' ? 0.5 : 0);
    let b = sheet.padId ? done.find((o) => o.id === sheet.padId) : null;
    if (!b || (sheet.padAuto && why(b))) { b = done.slice().sort((x, y) => score(x) - score(y))[0] || null; sheet.padAuto = true; }
    if (b) sheet.padId = b.id;
    const res = { ok: true, why: '', padId: b ? b.id : null, html: '', rel: 0, flight: null, repair: 0, turn: 0 };
    const biggest = Math.max(0, ...done.map(maxLiftoff));
    if (!b) { res.ok = false; res.why = 'You have no finished launch pad. Build one on the Base tab.'; }
    else if (lift > biggest) { res.ok = false; res.why = `Too heavy for your pads: liftoff ${fmtT(lift)}, your biggest pad takes ${fmtT(biggest)}. Build a Heavy pad or upgrade a pad on the Base tab.`; }
    else if (why(b)) {
      const w = why(b);
      res.ok = false;
      res.why = !fits(b) ? `This pad takes up to ${fmtT(maxLiftoff(b))}, the rocket weighs ${fmtT(lift)} at liftoff. Pick a bigger pad.`
        : w === 'No catch arms here' ? 'A tower catch needs a pad with catch arms or a catch tower next to it. Pick another pad, or add catch arms on Base.'
        : w === 'No crew access arm' ? 'Crewed flights need a crew access arm on the pad tower. Add one on the Base tab (pad → 🗼 Tower).'
        : `This pad is busy: ${w.toLowerCase()}.`;
    }
    let h = `<h2>Launch pad</h2>`;
    if (done.length > 1 || all.length > 1) {
      h += `<div class="pk-pads">${all.map((o) => {
        const pk = settle(st, o), K = KINDS[pk.kind], w = why(o), s = status(st, o);
        return `<button data-act="l-pad" data-id="${o.id}" class="pk-pad ${b && o.id === b.id ? 'on' : ''}" ${o.lvl > 0 ? '' : 'disabled'} aria-pressed="${!!(b && o.id === b.id)}">
          <b>${b && o.id === b.id ? '● ' : '○ '}${K.icon} ${K.name}</b><span class="dim">${escH(padName(st, o))} · max ${fmtT(maxLiftoff(o) || K.max[0])}</span>
          <span class="${w ? 'bad' : 'good'}">${w ? (s.ok ? '✕ ' : s.icon + ' ') + escH(w) : '✓ Ready'}</span></button>`;
      }).join('')}</div>`;
    } else if (b) {
      const s = status(st, b);
      h += `<div class="small">${KINDS[b.pk.kind].icon} <b>${KINDS[b.pk.kind].name}</b> · ${escH(padName(st, b))} · <span class="${s.ok ? 'good' : 'bad'}">${s.icon} ${escH(s.text)}</span></div>`;
    }
    if (b) {
      const pk = b.pk, K = KINDS[pk.kind];
      res.turn = turnDays(st, b); res.repair = repairDays(b, lift);
      res.rel = K.rel;
      const short = rkH > HEIGHTS[pk.tw.h].m;
      if (short) res.rel -= TOO_SHORT_PENALTY;
      h += `<div class="small dim">Liftoff mass <b>${fmtT(lift)}</b> of ${fmtT(maxLiftoff(b))} max · turnaround ${plural(res.turn, 'day')} after launch · pad bonus +${r2(K.rel * 100)}% success</div>`;
      if (res.repair > 0 && fits(b)) h += `<div class="small bad">🔧 A launch this big damages the pad: about ${plural(res.repair, 'extra day')} of repairs.${pk.kind !== 'heavy' ? ' A Heavy pad takes much less damage.' : ''}</div>`;
      if (short) h += `<div class="small bad">⚠ The ${HEIGHTS[pk.tw.h].m} m tower is shorter than this ${Math.round(rkH)} m rocket: −${TOO_SHORT_PENALTY * 100}% launch success. Make it taller on Base (pad → 🗼 Tower).</div>`;
      res.flight = flightCfg(st, b);
    }
    res.html = h;
    res.adj = (odds) => Math.max(0, Math.min(0.995, odds + res.rel));
    return res;
  }
  // Called once when a launch really happens: starts turnaround and repairs. Returns a short note for the log.
  function onLaunch(st, padId, liftoff) {
    const b = padById(st, padId);
    if (!b) return '';
    const turn = turnDays(st, b), rep = repairDays(b, liftoff || 0);
    b.pk.turnUntil = st.day + turn;
    b.pk.repairUntil = st.day + turn + rep;
    b.pk.launches = (b.pk.launches || 0) + 1;
    return `${padName(st, b)} is ready again in ${plural(turn + rep, 'day')}${rep ? ` (${rep} of them repairs)` : ''}.`;
  }
  function flightCfg(st, b) {
    const pk = settle(st, b), K = KINDS[pk.kind];
    return { kind: pk.kind, sea: !!K.sea, trench: pk.kind === 'light' ? 0 : pk.kind === 'heavy' ? 1.45 : 1, deluge: !!K.deluge,
      towerH: HEIGHTS[pk.tw.h].m, crew: !!pk.tw.crew, arms: !!pk.tw.arms, masts: !!pk.tw.masts, finish: FINISH[pk.tw.finish].hex };
  }

  // ---------- 3D launch scene (called by 3d-env.js launchSite with its helpers in A._env) ----------
  function dress3D(props, geo, P, cfg) {
    const A = root.APOGEE_3D, E = A && A._env, T = root.THREE;
    if (!E || !T) return null;
    const em = E.emats(), small = E.small();
    const fin = finishMat(cfg) || em.steel;
    const { top, padTop } = P;
    // sea platform: steel deck on legs over open water
    if (cfg.sea) {
      const half = 46;
      E.box(props, half * 2, 3, half * 2, em.steelDark, 0, top - 1.5, 0);
      E.box(props, half * 2 + 2, 0.4, half * 2 + 2, em.concrete, 0, top - 0.2, 0, false);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) E.cyl(props, 3.2, 3.6, top + 14, em.steel, sx * (half - 6), (top - 14) / 2 - 1, sz * (half - 6), 12);
      for (const sz of [-1, 1]) E.box(props, half * 2 + 10, 6, 9, em.steelDark, 0, E.SEA - 1, sz * (half - 6));
      E.box(props, 14, 6, 10, em.white, -half + 10, top, half - 9);
      for (let k = 0; k < 8; k++) E.box(props, 0.5, 1.2, 0.5, em.yellow, -half + k * (half / 4) + 4, top + 0.6, -half + 1, false);
    }
    // tower
    const towW = Math.max(8, geo.d * 1.05);
    const towX = -(geo.d / 2 + towW / 2 + Math.max(4, geo.d * 0.9));
    const towH = Math.max(20, cfg.towerH || 100);
    const tower = E.latticeTower(towH, towW, fin);
    tower.position.set(towX, top, 0); props.add(tower);
    const towTop = top + towH;
    const reach = -towX - towW / 2 - geo.d / 2 - 0.6;
    const armAt = (y, w, h, room, mat) => {
      if (y > towTop - 2) return;
      const a = E.trussArm(reach, h, w, mat || fin, em.steelDark);
      a.position.set(towX + towW / 2, y, 0); props.add(a);
      if (room) E.box(props, Math.min(4, reach * 0.4), h + 1.2, w + 0.6, em.white, towX + towW / 2 + reach - Math.min(2, reach * 0.2), y + 0.3, 0);
    };
    const boost = geo.stages && geo.stages[0] ? geo.stages[0].h : geo.total * 0.6;
    if (cfg.crew) armAt(padTop + geo.total * 0.86, 2.6, 2.8, true, em.yellow);
    armAt(padTop + boost * 0.98, 2.0, 2.0, false);
    armAt(padTop + boost * 0.45, 1.6, 1.6, false);
    // catch arms: carriage plus two big arms swung open, above the booster
    if (cfg.arms) {
      const ay = Math.min(towTop - 5, padTop + boost + 3);
      E.box(props, towW + 2.4, 6, towW + 2.4, em.steelDark, towX, ay - 3, 0);
      const len = 6 + geo.d + 4, gap = geo.d / 2 + 1.4;
      for (const side of [-1, 1]) {
        const pv = new T.Group(); pv.position.set(towX + towW / 2 + 0.6, ay, side * gap);
        const arm = E.trussArm(len, 3.2, 1.8, fin, em.steelDark); pv.add(arm);
        const rail = new T.Mesh(new T.BoxGeometry(len * 0.5, 1, 0.6), em.yellow); rail.position.set(len * 0.7, 1.2, -side * 1.1); pv.add(rail);
        pv.rotation.y = -side * 0.75; props.add(pv);
      }
    }
    // lightning masts with catenary wires
    if (cfg.masts) {
      const mastH = Math.max(towH, padTop - top + geo.total) * 1.2 + 10;
      const R = cfg.sea ? 40 : 76;
      const tops = [];
      for (const [x, z] of [[-R, -R], [R, -R], [R, R], [-R, R]]) {
        E.cyl(props, 0.45, 1.2, mastH, em.steel, x, top + mastH / 2, z, 8);
        tops.push(new T.Vector3(x, top + mastH, z));
      }
      const pts = [];
      const cat = (a, b, sag) => { for (let k = 0; k < 16; k++) for (const t of [k / 16, (k + 1) / 16]) { const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p.x, p.y, p.z); } };
      for (let k = 0; k < 4; k++) cat(tops[k], tops[(k + 1) % 4], mastH * 0.12);
      const wg = new T.BufferGeometry(); wg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      props.add(new T.LineSegments(wg, new T.LineBasicMaterial({ color: 0x2a2c30, transparent: true, opacity: 0.55 })));
    }
    // heavy pad: extra deluge pipes along the trench, and a water spray at liftoff
    if (!cfg.deluge) return { tick() {} };
    const tw = P.tw || 12;
    for (const s of [-1, 1]) E.pipe(props, new T.Vector3(-tw * 0.7, top - 1.2, s * (tw / 2 - 0.6)), new T.Vector3(P.half || 60, top - 1.2, s * (tw / 2 - 0.6)), 0.5, em.pipe);
    const N = small ? 240 : 560;
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N);
    for (let i = 0; i < N; i++) { life[i] = -1; pos[i * 3 + 1] = -999; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const cx = cv.getContext('2d'), gr = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(235,245,255,.6)'); gr.addColorStop(1, 'rgba(235,245,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 32, 32);
    const mat = new T.PointsMaterial({ size: small ? 3.4 : 2.8, map: new T.CanvasTexture(cv), color: 0xe6f0ff, transparent: true, opacity: 0.85, depthWrite: false });
    const pts = new T.Points(g, mat); pts.frustumCulled = false; props.add(pts);
    const ringR = geo.d * 0.5 + Math.max(0.8, geo.d * 0.12) + Math.max(1, geo.d * 0.16) * 0.5;
    const ringY = padTop - 0.6;
    // water fans: cheap translucent cones that read well even at low frame rates
    const fanMat = new T.MeshBasicMaterial({ color: 0xeef5ff, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide });
    const fanGeo = new T.CylinderGeometry(0.3, 3.2, 9, 10, 1, true); fanGeo.translate(0, 4.5, 0);
    const fans = new T.Group(); fans.visible = false; props.add(fans);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, f = new T.Mesh(fanGeo, fanMat);
      f.position.set(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR);
      f.rotation.set(0, -a, -0.95); fans.add(f);
    }
    for (const sz of [-0.25, 0.25]) { // trench jets toward the trench mouth
      const f = new T.Mesh(fanGeo, fanMat); f.position.set(-tw * 0.4, top - 6, sz * tw); f.rotation.set(0, 0, -1.25); f.scale.set(1.4, 2.6, 1.4); fans.add(f);
    }
    let acc = 0, next = 0;
    function spawn(i, trench) {
      life[i] = 1.2 + Math.random() * 0.9;
      if (trench) { // jets along the trench floor, pushed out by the exhaust
        pos[i * 3] = -tw * 0.5 + Math.random() * tw * 0.6; pos[i * 3 + 1] = top - 7 + Math.random() * 2; pos[i * 3 + 2] = (Math.random() - 0.5) * tw * 0.8;
        vel[i * 3] = 18 + Math.random() * 22; vel[i * 3 + 1] = 6 + Math.random() * 10; vel[i * 3 + 2] = (Math.random() - 0.5) * 8;
      } else { // ring nozzles on the launch table
        const a = Math.random() * Math.PI * 2;
        pos[i * 3] = Math.cos(a) * ringR; pos[i * 3 + 1] = ringY; pos[i * 3 + 2] = Math.sin(a) * ringR;
        const sp = 7 + Math.random() * 8;
        vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = 5 + Math.random() * 9; vel[i * 3 + 2] = Math.sin(a) * sp;
      }
    }
    return {
      // tau: seconds after ignition (T-0). Spray runs from just before ignition until the rocket is well clear.
      tick(tau, dt) {
        if (!(dt > 0)) return;
        dt = Math.min(dt, 0.05);
        const on = tau > -1.3 && tau < 7, k = on ? Math.min(1, (tau + 1.3) / 0.8) * (tau > 5 ? Math.max(0, (7 - tau) / 2) : 1) : 0;
        if (!on && acc <= 0) { if (pts.visible && tau > 7 + 3) pts.visible = false; }
        fans.visible = k > 0.02; fanMat.opacity = 0.42 * k;
        if (fans.visible) for (const f of fans.children) f.scale.y = (f.scale.x > 1 ? 2.6 : 1) * (0.85 + 0.25 * Math.sin(tau * 23 + f.position.x));
        acc += k * N * dt / 1.6;
        for (let i = 0; i < N; i++) {
          if (life[i] > 0) {
            life[i] -= dt;
            vel[i * 3 + 1] -= 9.8 * dt;
            pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
            if (life[i] <= 0 || pos[i * 3 + 1] < top - 9) { life[i] = -1; pos[i * 3 + 1] = -999; }
          } else if (acc >= 1) { acc -= 1; spawn(i, (next++ % 3) === 0); }
        }
        acc = Math.min(acc, 4);
        g.attributes.position.needsUpdate = true;
      },
    };
  }
  function finishMat(cfg) {
    const A = root.APOGEE_3D, E = A && A._env;
    if (!E || !cfg || !cfg.finish) return null;
    const blk = cfg.finish === FINISH.black.hex, wht = cfg.finish === FINISH.white.hex;
    return E.stdMat({ color: cfg.finish, roughness: blk ? 0.7 : 0.5, metalness: wht ? 0.15 : blk ? 0.25 : 0.6 });
  }

  // ---------- Base map pad model (campus-view.js MODELS.pad hands over when b.pk exists) ----------
  function campusPad(B, L, Dd, lv, M, X) {
    const pk = X.pk, kind = pk.kind, tw = pk.tw;
    const fin = tw.finish === 'white' ? M.white : tw.finish === 'black' ? M.black : M.steel;
    const sea = kind === 'sea', heavy = kind === 'heavy', light = kind === 'light';
    const base = sea ? 3 : 0;
    if (sea) { // water under a platform on legs
      B.box(M.pool || M.blue, L - 2, 0.3, Dd - 2, 0, 0, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(M.steelDark, 1.6, base, sx * (L / 2 - 8), 0, sz * (Dd / 2 - 8), 10);
      B.box(M.steelDark, L - 8, 1.2, Dd - 8, 0, base - 1.2, 0);
      B.box(M.deck || M.concDark, L - 9, 0.3, Dd - 9, 0, base, 0);
    } else B.box(M.conc, L - 2, 0.4, Dd - 2, 0, 0, 0);
    const mx = -4, mz = -2, mh = light ? 4 : heavy ? 10 : 8, ms = light ? 11 : heavy ? 22 : 18;
    if (!light) { // flame trench toward -x (wider and deeper for heavy pads)
      const tl = L / 2 + mx - 4 - (sea ? 6 : 0), tw2 = heavy ? 15 : 10;
      B.box(M.scorch, tl, 0.42, tw2, mx - 8 - tl / 2 + 4, base, mz);
      B.box(M.concDark, tl, 2.2, 1.4, mx - 8 - tl / 2 + 4, base, mz - tw2 / 2 - 0.7); B.box(M.concDark, tl, 2.2, 1.4, mx - 8 - tl / 2 + 4, base, mz + tw2 / 2 + 0.7);
    } else B.cyl(M.scorch, 9, 0.45, mx, base, mz, 20);
    B.box(M.conc, ms, mh, ms, mx, base, mz);
    if (!light) B.box(M.scorch, 0.3, mh - 1.5, 10, mx - ms / 2 - 0.05, base, mz);
    B.cyl(M.steelDark, light ? 4 : 5.5, 1.2, mx, base + mh, mz, 20);
    const rH = (light ? 26 : 40) + (light ? 6 : 15) * lv, r = light ? 1.2 + 0.3 * lv : 1.7 + 0.55 * lv;
    if (X.rocket) { const rb = new X.Bld(); X.rocket(rb, M, rH, r, { fins: lv >= 2 }); B.sub(rb, mx, base + mh + 1.2, mz); }
    // integrated tower: height, crew arm, catch arms
    const tx = mx + r + 8, th = { short: 48, tall: 78, mega: 112 }[tw.h] || 78;
    B.lattice(fin, tx, mz, 7, th, 4, base, 0.35);
    B.box(M.steelDark, 7.6, 2, 7.6, tx, base + th, mz);
    X.lights.push([tx, base + th + 2.5, mz]);
    const ok = (y) => y < base + th - 2;
    if (tw.crew && ok(base + mh + rH * 0.88)) {
      B.beam(M.yellow, [tx - 3.5, base + mh + rH * 0.88, mz], [mx + r + 0.4, base + mh + rH * 0.88, mz], 1.6);
      B.box(M.white, 3, 2.4, 2.6, mx + r + 1.6, base + mh + rH * 0.88 - 1.2, mz);
    }
    if (ok(base + mh + rH * 0.5)) B.beam(M.steelDark, [tx - 3.5, base + mh + rH * 0.5, mz], [mx + r + 0.4, base + mh + rH * 0.5, mz], 1.2);
    if (tw.arms) {
      const ay = Math.min(base + th - 6, base + mh + rH * 0.66);
      B.box(M.steelDark, 9, 5, 9, tx, ay - 2.5, mz);
      for (const s of [-1, 1]) {
        B.beam(fin, [tx - 3, ay, mz + s * 3.5], [mx - 6, ay, mz + s * 9], 2.2);
        B.beam(M.steelDark, [tx - 3, ay + 1.8, mz + s * 3.5], [mx - 6, ay + 0.6, mz + s * 9], 0.6);
      }
    }
    if (tw.masts) for (const [px, pz] of [[-34, -34], [34, -32], [-30, 34]]) { B.cyl(M.steel, 0.55, th + 22, px, base, pz, 8, 0.25); B.cyl(M.conc, 1.6, 1, px, base, pz, 10); X.lights.push([px, base + th + 22.5, pz]); }
    if (sea) return;
    // propellant tanks
    B.sph(M.white, light ? 3 : 4.2, 28, light ? 5 : 6.8, -26, 18); B.cyl(M.steelDark, light ? 2 : 3, light ? 1.8 : 2.6, 28, 0, -26, 12);
    B.beam(M.pipe, [24, 1.2, -16], [mx + ms / 2, 1.2, mz - 6], 0.9);
    if (heavy) { // water tower for the deluge, plus water feed pipes
      for (const [a, b] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) B.beam(M.steel, [30 + a, 0, 26 + b], [30 + a * 0.4, 24, 26 + b * 0.4], 0.5);
      B.sph(M.white, 6.5, 30, 29, 26, 18);
      B.beam(M.pipe, [30, 1, 22], [mx + ms / 2, 1, mz + 6], 1.1);
      B.beam(M.pipe, [30, 1.8, 20], [mx - ms / 2 - 8, 1.8, mz + 9], 0.8);
    }
  }

  // ---------- CSS ----------
  function injectCSS() {
    if (typeof document === 'undefined' || document.getElementById('pk-style')) return;
    const s = document.createElement('style'); s.id = 'pk-style';
    s.textContent = `
.pk-wrap{z-index:25}
.pk-sheet h2{margin-top:14px}
.pk-prev{background:#0f1626;border:1px solid var(--line);border-radius:12px;margin:10px 0 4px;padding:4px;overflow:hidden}
.pk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.pk-opt,.pk-pad,.pk-kind{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;min-height:44px;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:8px 10px;font-size:12px;color:var(--text)}
.pk-opt b,.pk-pad b,.pk-kind b{font-size:13px}
.pk-opt.on,.pk-pad.on,.pk-kind.on{border:2px solid var(--accent);padding:7px 9px;background:rgba(255,122,26,.12)}
.pk-opt:disabled:not(.on){opacity:.55}
.pk-opt.on:disabled{opacity:1}
.pk-pads{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px;margin-bottom:6px}
.pk-pad:disabled{opacity:.5}
.pk-kwrap{flex:1 1 100%;min-width:0}
.pk-kinds{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;width:100%;margin-top:6px}
.pk-kind{display:block}
.pk-parts{display:flex;flex-direction:column;gap:6px}
.pk-part{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.pk-part .btn{min-height:40px}
.pk-sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid #9aa3b8;margin-right:6px;vertical-align:-1px}
.pk-box{margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel2)}
.pk-box .btn{margin-top:6px;min-height:40px}
.seg button[data-pk]{min-height:40px}
@media (max-width:760px){.pk-kinds{grid-template-columns:repeat(2,minmax(0,1fr))}.pk-grid{grid-template-columns:1fr 1fr}}
`;
    document.head.appendChild(s);
  }

  if (typeof document !== 'undefined') {
    injectCSS();
    document.addEventListener('click', onDocClick, true);
  }
  // 3D hooks used by 3d-env.js (launch scene) and flight.js
  if (root.APOGEE_3D) { root.APOGEE_3D.padKit3D = dress3D; root.APOGEE_3D.padKitMat = finishMat; }

  root.APOGEE_PADKIT = {
    KINDS, HEIGHTS, PARTS, FINISH,
    ensure, status, maxLiftoff, turnMul, mul, hasArms, canCatch, padName,
    padHasCrewArm, padLightningProtection,
    placeCost, placeDays, placeWhy, onPlaced, kindPickerHTML, panelHTML, viewKey, badge, kindName, campusPad,
    launchInfo, onLaunch, flightCfg, openPane, closePane,
    get buildKind() { return buildKind; }, set buildKind(k) { if (KINDS[k]) buildKind = k; },
  };
  // Short global names for the crew and weather features.
  root.padHasCrewArm = padHasCrewArm;
  root.padLightningProtection = padLightningProtection;
})(typeof window !== 'undefined' ? window : globalThis);
