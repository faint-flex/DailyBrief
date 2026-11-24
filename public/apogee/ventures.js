/* Apogee Ventures: side businesses (pure logic, no DOM).
 * Voltline Motors (electric cars) and Apogee Orbital Compute (space data center).
 * window.APOGEE_VENTURES. Money in $M, time in game days. Car prices/costs in $k. */
(function (root) {
  'use strict';
  const VERSION = 1;
  const MONTH = 30;
  const HIST_MAX = 60;

  // ---------------------------------------------------------------- Voltline Motors
  const EV_FOUND_COST = 45;
  const EV_FOUND_REP = 20;
  // eff = kWh per 100 km, base = non-battery build cost $k, market = cars/day at brand 50, ref price/range.
  const CAR_TYPES = {
    sedan:    { id: 'sedan', name: 'Sedan', icon: '🚗', eff: 15, base: 17, market: 60, refPrice: 45, refRange: 450, bat: [50, 110], price: [28, 90], dev: 18, devDays: 55 },
    suv:      { id: 'suv', name: 'SUV', icon: '🚙', eff: 19, base: 21, market: 70, refPrice: 55, refRange: 430, bat: [60, 130], price: [35, 110], dev: 24, devDays: 65 },
    pickup:   { id: 'pickup', name: 'Pickup', icon: '🛻', eff: 25, base: 26, market: 40, refPrice: 62, refRange: 420, bat: [80, 200], price: [40, 130], dev: 30, devDays: 75 },
    semi:     { id: 'semi', name: 'Semi truck', icon: '🚛', eff: 125, base: 90, market: 4, refPrice: 220, refRange: 600, bat: [400, 1000], price: [140, 400], dev: 55, devDays: 110 },
    roadster: { id: 'roadster', name: 'Roadster', icon: '🏎️', eff: 14, base: 55, market: 6, refPrice: 130, refRange: 520, bat: [60, 200], price: [70, 250], dev: 35, devDays: 80 },
  };
  const EV_RESEARCH = [
    { id: 'cells1', name: 'Dense cells', desc: 'Battery cost $130 → $105 per kWh.', cost: 22, days: 55 },
    { id: 'cells2', name: 'Dry-electrode cells', desc: 'Battery cost → $80 per kWh.', cost: 55, days: 85, req: 'cells1' },
    { id: 'cells3', name: 'Solid-state pack', desc: 'Battery cost → $58 per kWh, +10% range. Rocket perk: lighter avionics batteries (−3% rocket build cost).', cost: 130, days: 120, req: 'cells2' },
    { id: 'motor1', name: 'Carbon-sleeve motors', desc: '+8% range on all models.', cost: 18, days: 45 },
    { id: 'motor2', name: 'Axial-flux motors', desc: '+8% more range.', cost: 45, days: 75, req: 'motor1' },
    { id: 'cast', name: 'Giga casting', desc: 'Body build cost −10%.', cost: 35, days: 65 },
    { id: 'quality', name: 'Quality program', desc: 'Recall risk halved, review scores +0.3★.', cost: 15, days: 40 },
    { id: 'pilot1', name: 'Lane Pilot', desc: 'Driver assist. Demand +8%.', cost: 28, days: 70 },
    { id: 'pilot2', name: 'Full Pilot (supervised)', desc: 'Demand +15% more. Slightly higher recall risk.', cost: 75, days: 110, req: 'pilot1' },
    { id: 'robotaxi', name: 'Robotaxi network', desc: 'Cars on the road earn ride income every day.', cost: 180, days: 150, req: 'pilot2' },
  ];
  const FACTORY = { cost: 90, days: 75, capPerLevel: 25, maxLevel: 5, upCost: 55, upDays: 40, maxCount: 4, upkeep: 0.08 };
  const PILOT_LINE = 6; // cars/day from the founding pilot line
  const STATION_BATCH = { n: 25, cost: 4, days: 20, upkeep: 0.0008 };
  const MODEL_NAMES = { sedan: ['Arc', 'Volta', 'Spark'], suv: ['Ridge', 'Summit', 'Terra'], pickup: ['Hauler', 'Bison', 'Forge'], semi: ['Longhaul', 'Atlas'], roadster: ['Comet', 'Bolt', 'Flare'] };

  // ---------------------------------------------------------------- Orbital Compute
  const DC_FOUND_COST = 40;
  const DC_FOUND_REP = 60;
  const MOD_GENS = {
    R1: { id: 'R1', name: 'Rack Pod Mk1', mass: 2.5, cost: 5, units: 8, life: 1400 },
    R2: { id: 'R2', name: 'Rack Pod Mk2', mass: 3.0, cost: 7, units: 22, life: 1600, req: 'chip2' },
    R3: { id: 'R3', name: 'Tensor Pod Mk3', mass: 4.0, cost: 11, units: 60, life: 1800, req: 'chip3' },
  };
  const DC_RESEARCH = [
    { id: 'chip2', name: 'Rad-hard accelerators', desc: 'Unlocks Rack Pod Mk2 (22 PF per module).', cost: 40, days: 80 },
    { id: 'chip3', name: 'Tensor Pod Mk3', desc: 'Unlocks Tensor Pod Mk3 (60 PF per module).', cost: 110, days: 120, req: 'chip2' },
    { id: 'shield', name: 'Debris shielding', desc: 'Module failures −60%.', cost: 20, days: 50 },
  ];
  const DC_UPGRADES = {
    cooling: { name: 'Radiators', max: 3, cost: [14, 32, 65], desc: 'Bigger radiator wings: more usable compute and uptime.' },
    power: { name: 'Solar arrays', max: 3, cost: [12, 28, 58], desc: 'Bigger arrays: more usable compute.' },
    line: { name: 'Assembly line', max: 3, cost: [10, 24, 50], desc: 'Build modules faster.' },
    laser: { name: 'Halo laser links', max: 1, cost: [25], desc: 'Low-latency links through Halo: +20% spot price, unlocks inference deals.' },
  };
  const LINE_RATE = [0.25, 0.5, 1, 2]; // modules per day by line level
  const DC_CLIENTS = ['Cortexa Labs', 'Northwind Cloud', 'Helix AI', 'Quanta Render', 'Meridian Bank', 'Lumen Weather', 'Synapse Bio', 'Kite Robotics'];

  // ---------------------------------------------------------------- helpers
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r2 = (x) => Math.round(x * 100) / 100;
  const pushRing = (arr, v, max) => { arr.push(v); while (arr.length > max) arr.shift(); };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  function haloOn(state) {
    if (!state || !state.net) return false;
    if (state.net.founded === false) return false;
    return true;
  }
  function netSum(state) {
    const N = root.APOGEE_NET;
    if (!N || !N.summary || !state.net) return null;
    try { return N.summary(state); } catch (e) { return null; }
  }

  function ensure(state) {
    if (!state.ventures || typeof state.ventures !== 'object') state.ventures = { v: VERSION, ev: null, dc: null, log: [] };
    const V = state.ventures;
    if (!Array.isArray(V.log)) V.log = [];
    if (V.ev) {
      const e = V.ev;
      e.models = e.models || []; e.factories = e.factories || []; e.research = e.research || {};
      e.stations = e.stations || 0; e.stationJobs = e.stationJobs || []; e.history = e.history || [];
      e.m = e.m || { rev: 0, cost: 0, cars: 0 }; e.d30 = e.d30 || []; e.mods = e.mods || [];
      if (e.marketing == null) e.marketing = 0;
      if (e.brand == null) e.brand = 20;
      e.totals = e.totals || { delivered: 0, rev: 0, profit: 0, recalls: 0 };
    }
    if (V.dc) {
      const d = V.dc;
      d.ready = d.ready || { R1: 0, R2: 0, R3: 0 }; d.queue = d.queue || [];
      d.orbit = d.orbit || []; d.up = d.up || { cooling: 0, power: 0, line: 0, laser: 0 };
      d.research = d.research || {}; d.deals = d.deals || []; d.offers = d.offers || [];
      d.history = d.history || []; d.m = d.m || { rev: 0, cost: 0 }; d.d30 = d.d30 || []; d.mods = d.mods || [];
      d.totals = d.totals || { launched: 0, lost: 0, rev: 0, profit: 0 };
      if (d.index == null) d.index = 1;
    }
    return V;
  }
  function addLog(state, text) {
    const V = state.ventures;
    V.log.unshift({ day: state.day, text });
    if (V.log.length > 40) V.log.length = 40;
  }
  function modActive(list, id, day) { return list.some((m) => m.id === id && m.until > day); }
  function modVal(list, id, day, dflt) { const m = list.find((x) => x.id === id && x.until > day); return m ? m.v : dflt; }

  // ---------------------------------------------------------------- EV maths
  function batCost(e) { // $k per kWh
    const r = e.research;
    return r.cells3 ? 0.058 : r.cells2 ? 0.080 : r.cells1 ? 0.105 : 0.130;
  }
  function rangeMult(e) { const r = e.research; return (r.motor1 ? 1.08 : 1) * (r.motor2 ? 1.08 : 1) * (r.cells3 ? 1.1 : 1); }
  function modelStats(state, spec) {
    const V = ensure(state); const e = V.ev || { research: {}, brand: 20, stations: 0, models: [] };
    const T = CAR_TYPES[spec.type] || CAR_TYPES.sedan;
    const battery = clamp(Math.round(+spec.battery || T.bat[0]), T.bat[0], T.bat[1]);
    const price = clamp(Math.round(+spec.price || T.refPrice), T.price[0], T.price[1]);
    const range = Math.round(battery / T.eff * 100 * rangeMult(e));
    const pilotHw = e.research.pilot1 ? 1.5 : 0;
    const buildCost = r2(T.base * (e.research.cast ? 0.9 : 1) + battery * batCost(e) + pilotHw);
    let stars = 3 + 1.4 * Math.log2(range / T.refRange) - 1.6 * Math.log2(price / T.refPrice) + (e.research.quality ? 0.3 : 0) + (e.research.pilot2 ? 0.3 : e.research.pilot1 ? 0.15 : 0);
    stars = Math.round(clamp(stars, 1, 5) * 10) / 10;
    const demand = typeDemand(state, e, T, price, range, stars);
    return { type: T.id, battery, price, range, buildCost, margin: r2(price - buildCost), stars, demand: Math.round(demand * 10) / 10, devCost: T.dev, devDays: T.devDays };
  }
  function demandMult(state, e) {
    const brandF = 0.35 + e.brand / 70;
    const charging = 0.6 + 0.6 * (1 - Math.exp(-(e.stations || 0) / 400));
    const pilot = (e.research.pilot1 ? 1.08 : 1) * (e.research.pilot2 ? 1.15 : 1);
    const halo = haloOn(state) ? 1.04 : 1;
    const adoption = Math.min(2.0, 0.7 * (1 + state.day / 1000));
    const mkt = 1 + 0.25 * Math.log10(1 + (e.marketing || 0)); // marketing $M/month
    const credit = modVal(e.mods, 'credit', state.day, 1);
    const rival = modVal(e.mods, 'rival', state.day, 1);
    const viral = modVal(e.mods, 'viral', state.day, 1);
    return { total: brandF * charging * pilot * halo * adoption * mkt * credit * rival * viral, brandF, charging, pilot, halo, adoption, mkt };
  }
  // EVs get cheaper industry-wide: buyers expect lower prices as years pass (down to −15%).
  function marketPrice(state) { return 1 - Math.min(0.15, state.day / 5000); }
  function typeDemand(state, e, T, price, range, stars) {
    const dm = demandMult(state, e).total;
    const priceF = Math.pow(T.refPrice * marketPrice(state) / price, 2.1);
    const rangeF = clamp(Math.pow(range / T.refRange, 0.8), 0.3, 1.6);
    const starF = 0.6 + stars * 0.12;
    return T.market * dm * priceF * rangeF * starF;
  }
  function evCapacity(state, e) {
    let cap = PILOT_LINE;
    for (const f of e.factories) if (f.status === 'online' || f.status === 'upgrading') cap += f.level * FACTORY.capPerLevel * (f.status === 'upgrading' ? 0.5 : 1);
    return cap * modVal(e.mods, 'chips', state.day, 1);
  }

  // ---------------------------------------------------------------- DC maths
  function dcEff(d) { return Math.min(0.7 + 0.1 * d.up.power, 0.7 + 0.1 * d.up.cooling); }
  function dcUptime(state, d) { return clamp(0.94 + 0.015 * d.up.cooling + 0.008 * d.up.power - modVal(d.mods, 'storm', state.day, 0), 0.5, 0.99); }
  function cohortHealth(c, day) {
    const G = MOD_GENS[c.gen]; const age = day - c.day; const f = age / G.life;
    return f < 0.7 ? 1 : clamp(1 - (f - 0.7) / 0.3 * 0.4, 0.6, 1);
  }
  function dcUnits(state, d) { // usable PF after efficiency, aging and uptime
    let raw = 0, eff = 0, mods = 0;
    for (const c of d.orbit) { const G = MOD_GENS[c.gen]; raw += c.n * G.units; eff += c.n * G.units * cohortHealth(c, state.day); mods += c.n; }
    const usable = eff * dcEff(d) * dcUptime(state, d);
    return { raw, usable, mods };
  }
  function spotBase(state, d) { return 0.0055 * d.index * (d.up.laser ? 1.2 : 1); }
  function spotDepth(state) { return 250 * (1 + state.day / 1000); }
  function spotPriceFor(state, d, units) { return spotBase(state, d) / (1 + Math.max(0, units) / spotDepth(state)); }

  // ---------------------------------------------------------------- unlocks
  function canFoundEV(state) {
    const V = ensure(state);
    if (V.ev) return { ok: false, why: 'Already founded.' };
    if ((state.rep || 0) < EV_FOUND_REP) return { ok: false, why: `Needs ${EV_FOUND_REP} reputation (you have ${Math.round(state.rep || 0)}).` };
    if (state.cash < EV_FOUND_COST) return { ok: false, why: `Needs $${EV_FOUND_COST}M cash.` };
    return { ok: true, why: '' };
  }
  function canFoundDC(state) {
    const V = ensure(state);
    if (V.dc) return { ok: false, why: 'Already founded.' };
    if (!haloOn(state) && (state.rep || 0) < DC_FOUND_REP) return { ok: false, why: `Found Halo first (or reach ${DC_FOUND_REP} reputation).` };
    if (state.cash < DC_FOUND_COST) return { ok: false, why: `Needs $${DC_FOUND_COST}M cash.` };
    return { ok: true, why: '' };
  }

  // ---------------------------------------------------------------- actions
  function pay(state, cost) {
    if (state.cash < cost) return false;
    state.cash = r2(state.cash - cost); return true;
  }
  function act(state, action, args) {
    const V = ensure(state); args = args || {};
    const e = V.ev, d = V.dc;
    const no = (msg) => ({ ok: false, msg });
    const yes = (msg, cost) => ({ ok: true, msg, cost: cost || 0 });
    switch (action) {
      case 'foundEV': {
        const c = canFoundEV(state); if (!c.ok) return no(c.why);
        pay(state, EV_FOUND_COST);
        V.ev = { name: args.name || 'Voltline Motors', founded: state.day, brand: 20, models: [], factories: [], research: {}, lab: null,
          stations: 0, stationJobs: [], marketing: 0, history: [], m: { rev: 0, cost: 0, cars: 0 }, d30: [], mods: [],
          totals: { delivered: 0, rev: 0, profit: 0, recalls: 0 }, last: null };
        ensure(state);
        addLog(state, `Founded <b>${V.ev.name}</b> with a small pilot line (${PILOT_LINE} cars/day).`);
        return yes(`${V.ev.name} founded`, EV_FOUND_COST);
      }
      case 'foundDC': {
        const c = canFoundDC(state); if (!c.ok) return no(c.why);
        pay(state, DC_FOUND_COST);
        V.dc = { name: args.name || 'Apogee Orbital Compute', founded: state.day, ready: { R1: 0, R2: 0, R3: 0 }, queue: [], orbit: [],
          up: { cooling: 0, power: 0, line: 0, laser: 0 }, research: {}, lab: null, deals: [], offers: [], index: 1,
          history: [], m: { rev: 0, cost: 0 }, d30: [], mods: [], totals: { launched: 0, lost: 0, rev: 0, profit: 0 }, last: null };
        ensure(state);
        addLog(state, `Founded <b>${V.dc.name}</b>. Build compute modules and launch them to LEO.`);
        return yes(`${V.dc.name} founded`, DC_FOUND_COST);
      }
      // ---- cars
      case 'designModel': {
        if (!e) return no('Found Voltline Motors first.');
        const T = CAR_TYPES[args.type]; if (!T) return no('Unknown car type.');
        if (e.models.filter((m) => m.status !== 'retired').length >= 8) return no('Max 8 active models. Retire one first.');
        const s = modelStats(state, args);
        if (!pay(state, s.devCost)) return no(`Needs $${s.devCost}M for development.`);
        const name = String(args.name || '').trim().slice(0, 18) || (MODEL_NAMES[T.id][e.models.filter((m) => m.type === T.id).length % MODEL_NAMES[T.id].length]);
        const m = { id: 'm' + state.day + '-' + e.models.length, name, type: T.id, battery: s.battery, price: s.price, status: 'dev', devLeft: s.devDays,
          backlog: 0, delivered: 0, stars: s.stars, built: 0, lastOrders: 0, lastBuilt: 0 };
        e.models.push(m);
        addLog(state, `Started developing the <b>${name}</b> ${T.name.toLowerCase()} (${s.devDays} days).`);
        return yes(`${name} in development`, s.devCost);
      }
      case 'setPrice': {
        if (!e) return no('No car company.');
        const m = e.models.find((x) => x.id === args.id); if (!m) return no('No such model.');
        const T = CAR_TYPES[m.type];
        m.price = clamp(Math.round(+args.price), T.price[0], T.price[1]);
        m.stars = modelStats(state, m).stars;
        return yes(`${m.name} now $${m.price}k`);
      }
      case 'retireModel': {
        if (!e) return no('No car company.');
        const m = e.models.find((x) => x.id === args.id); if (!m) return no('No such model.');
        m.status = 'retired'; m.backlog = 0;
        return yes(`${m.name} retired`);
      }
      case 'buildFactory': {
        if (!e) return no('No car company.');
        if (e.factories.length >= FACTORY.maxCount) return no(`Max ${FACTORY.maxCount} gigafactories.`);
        const cost = FACTORY.cost * (1 + 0.25 * e.factories.length);
        if (!pay(state, cost)) return no(`Needs $${r2(cost)}M.`);
        const names = ['Giga Mesa', 'Giga Harbor', 'Giga North', 'Giga Delta'];
        e.factories.push({ id: 'f' + e.factories.length, name: names[e.factories.length], level: 1, status: 'building', left: FACTORY.days });
        addLog(state, `Breaking ground on <b>${names[e.factories.length - 1]}</b> (${FACTORY.days} days).`);
        return yes('Gigafactory construction started', cost);
      }
      case 'factoryUp': {
        if (!e) return no('No car company.');
        const f = e.factories.find((x) => x.id === args.id); if (!f) return no('No such factory.');
        if (f.status !== 'online') return no('Factory is busy.');
        if (f.level >= FACTORY.maxLevel) return no('Max level.');
        const cost = FACTORY.upCost * f.level;
        if (!pay(state, cost)) return no(`Needs $${cost}M.`);
        f.status = 'upgrading'; f.left = FACTORY.upDays;
        return yes(`${f.name} expanding to level ${f.level + 1}`, cost);
      }
      case 'stations': {
        if (!e) return no('No car company.');
        const n = clamp(Math.round(args.n || 1), 1, 10);
        const cost = STATION_BATCH.cost * n;
        if (e.stations + sum(e.stationJobs.map((j) => j.n)) + n * STATION_BATCH.n > 3000) return no('Charging network is complete (3000 stations).');
        if (!pay(state, cost)) return no(`Needs $${cost}M.`);
        e.stationJobs.push({ n: n * STATION_BATCH.n, left: STATION_BATCH.days });
        return yes(`${n * STATION_BATCH.n} Volt Stations under construction`, cost);
      }
      case 'marketing': {
        if (!e) return no('No car company.');
        e.marketing = clamp(+args.perMonth || 0, 0, 60);
        return yes(`Marketing $${e.marketing}M per month`);
      }
      case 'research': {
        const line = args.line === 'dc' ? d : e; if (!line) return no('Found the venture first.');
        const list = args.line === 'dc' ? DC_RESEARCH : EV_RESEARCH;
        const R = list.find((x) => x.id === args.id); if (!R) return no('Unknown research.');
        if (line.research[R.id]) return no('Already done.');
        if (line.lab) return no('Lab busy with another project.');
        if (R.req && !line.research[R.req]) return no('Needs earlier research.');
        if (!pay(state, R.cost)) return no(`Needs $${R.cost}M.`);
        line.lab = { id: R.id, left: R.days, total: R.days };
        return yes(`Researching ${R.name}`, R.cost);
      }
      // ---- compute
      case 'buildModules': {
        if (!d) return no('Found Orbital Compute first.');
        const G = bestGen(d); const n = clamp(Math.round(args.n || 1), 1, 50);
        const cost = G.cost * n;
        if (!pay(state, cost)) return no(`Needs $${r2(cost)}M.`);
        d.queue.push({ gen: G.id, n, prog: 0 });
        return yes(`${n} × ${G.name} queued`, cost);
      }
      case 'dcUpgrade': {
        if (!d) return no('No compute venture.');
        const U = DC_UPGRADES[args.id]; if (!U) return no('Unknown upgrade.');
        const lvl = d.up[args.id] || 0;
        if (lvl >= U.max) return no('Max level.');
        if (args.id === 'laser' && !haloOn(state)) return no('Needs the Halo network.');
        const cost = U.cost[lvl];
        if (!pay(state, cost)) return no(`Needs $${cost}M.`);
        d.up[args.id] = lvl + 1;
        addLog(state, `Orbital Compute: <b>${U.name}</b> level ${lvl + 1}.`);
        return yes(`${U.name} upgraded`, cost);
      }
      case 'acceptCompute': {
        if (!d) return no('No compute venture.');
        const o = d.offers.find((x) => x.id === args.id); if (!o) return no('Offer gone.');
        if (o.laser && !d.up.laser) return no('Needs Halo laser links.');
        d.offers = d.offers.filter((x) => x !== o);
        d.deals.push(Object.assign({}, o, { left: o.days, shortfall: 0 }));
        addLog(state, `Signed <b>${o.client}</b>: ${o.units} PF for ${o.days} days.`);
        return yes(`Deal signed with ${o.client}`);
      }
      case 'declineCompute': {
        if (!d) return no('No compute venture.');
        d.offers = d.offers.filter((x) => x.id !== args.id);
        return yes('Offer declined');
      }
    }
    return no('Unknown action ' + action);
  }
  function bestGen(d) { return d.research.chip3 ? MOD_GENS.R3 : d.research.chip2 ? MOD_GENS.R2 : MOD_GENS.R1; }

  // ---------------------------------------------------------------- launch hooks
  function readyCount(d) { return d ? sum(Object.values(d.ready)) : 0; }
  function pickModules(d, n) { // newest gens first
    const out = []; let left = n;
    for (const g of ['R3', 'R2', 'R1']) { const k = Math.min(left, d.ready[g] || 0); if (k > 0) { out.push({ gen: g, n: k }); left -= k; } }
    return out;
  }
  function dcContract(state, n) {
    const V = ensure(state); const d = V.dc; if (!d) return null;
    n = clamp(Math.round(n || 0), 1, readyCount(d)); if (!readyCount(d)) return null;
    const mods = pickModules(d, n);
    const mass = Math.round(sum(mods.map((m) => m.n * MOD_GENS[m.gen].mass)) * 10) / 10;
    return { id: 'dc-' + state.day + '-' + Math.floor(Math.random() * 1e6).toString(36), kind: 'dc', label: 'Compute modules', client: 'Orbital Compute (yours)',
      target: 'LEO', mass, reward: 0, rep: 2, expires: state.day + 9999, count: n, mods };
  }
  function onDcResult(state, contract, ok) {
    const V = ensure(state); const d = V.dc; const lines = [];
    if (!d || !contract) return lines;
    const mods = contract.mods || pickModules(d, contract.count || 0);
    let n = 0;
    for (const m of mods) {
      const k = Math.min(m.n, d.ready[m.gen] || 0); if (!k) continue;
      d.ready[m.gen] -= k; n += k;
      if (ok) d.orbit.push({ gen: m.gen, n: k, day: state.day });
    }
    if (ok) {
      d.totals.launched += n;
      const u = dcUnits(state, d);
      lines.push(['Compute modules', `+${n} in orbit (${u.mods} total)`]);
      lines.push(['Orbital compute', `${Math.round(u.usable)} PF usable`]);
      addLog(state, `🛰️ ${n} compute modules reached orbit. Fleet: ${u.mods}.`);
    } else {
      d.totals.lost += n;
      lines.push(['Compute modules', `${n} lost`]);
      addLog(state, `✖ Lost ${n} compute modules in a launch failure.`);
    }
    return lines;
  }

  // ---------------------------------------------------------------- daily tick
  function tick(state, rng) {
    rng = rng || Math.random;
    const V = ensure(state); const out = { events: [], toasts: [] };
    const ev = (t, toast) => { out.events.push(t); addLog(state, t); if (toast) out.toasts.push(t); };
    if (V.ev) tickEV(state, V.ev, rng, ev);
    if (V.dc) tickDC(state, V.dc, rng, ev);
    return out;
  }
  function rollMonth(state, x, extra) {
    x.d30.push(x.lastProfit || 0); if (x.d30.length > 30) x.d30.shift();
    if ((state.day - x.founded) > 0 && (state.day - x.founded) % MONTH === 0) {
      pushRing(x.history, Object.assign({ day: state.day, rev: r2(x.m.rev), cost: r2(x.m.cost), profit: r2(x.m.rev - x.m.cost) }, extra()), HIST_MAX);
      for (const k in x.m) x.m[k] = 0;
    }
  }
  function tickLab(state, line, list, ev, prefix) {
    if (!line.lab) return;
    line.lab.left -= 1;
    if (line.lab.left <= 0) {
      const R = list.find((x) => x.id === line.lab.id);
      line.research[line.lab.id] = state.day; line.lab = null;
      ev(`${prefix}: research done: <b>${R ? R.name : ''}</b>.`, true);
    }
  }
  function tickEV(state, e, rng, ev) {
    const day = state.day;
    e.mods = e.mods.filter((m) => m.until > day);
    tickLab(state, e, EV_RESEARCH, ev, 'Voltline');
    for (const f of e.factories) {
      if (f.status === 'building' || f.status === 'upgrading') {
        f.left -= 1;
        if (f.left <= 0) {
          if (f.status === 'upgrading') f.level += 1;
          f.status = 'online';
          ev(`🏭 <b>${f.name}</b> is online at level ${f.level} (${f.level * FACTORY.capPerLevel} cars/day).`, true);
        }
      }
    }
    for (const j of e.stationJobs) j.left -= 1;
    const doneSt = e.stationJobs.filter((j) => j.left <= 0);
    if (doneSt.length) { const n = sum(doneSt.map((j) => j.n)); e.stations += n; e.stationJobs = e.stationJobs.filter((j) => j.left > 0); ev(`⚡ ${n} Volt Stations opened (${e.stations} total).`); }

    // models in development
    for (const m of e.models) {
      if (m.status === 'dev') {
        m.devLeft -= 1;
        if (m.devLeft <= 0) {
          m.status = 'production';
          const s = modelStats(state, m); m.stars = s.stars;
          const word = s.stars >= 4.3 ? 'rave reviews' : s.stars >= 3.4 ? 'good reviews' : s.stars >= 2.5 ? 'mixed reviews' : 'harsh reviews';
          e.brand = clamp(e.brand + (s.stars - 3) * 3, 0, 100);
          ev(`🚗 The <b>${m.name}</b> launched to ${word} (${s.stars.toFixed(1)}★).`, true);
        }
      }
    }
    const live = e.models.filter((m) => m.status === 'production');
    // orders
    const typeCount = {};
    for (const m of live) typeCount[m.type] = (typeCount[m.type] || 0) + 1;
    let orders = 0;
    for (const m of live) {
      const s = modelStats(state, m); m.stars = s.stars;
      let o = s.demand / Math.sqrt(typeCount[m.type]);
      const wait = m.lastBuilt > 0 ? m.backlog / m.lastBuilt : (m.backlog > 0 ? 99 : 0);
      if (wait > 45) o *= 45 / wait; // buyers give up on long waits
      o *= 0.85 + rng() * 0.3;
      m.lastOrders = o; m.backlog += o; orders += o;
      m.backlog *= 0.995; // a few cancellations
    }
    // production
    const cap = evCapacity(state, e);
    const totalBack = sum(live.map((m) => m.backlog));
    let built = 0, rev = 0, cogs = 0;
    for (const m of live) {
      const share = totalBack > 0 ? m.backlog / totalBack : 0;
      const b = Math.min(m.backlog, cap * share);
      m.backlog -= b; m.built += b; m.delivered += b; m.lastBuilt = b;
      const s = modelStats(state, m);
      built += b; rev += b * m.price / 1000; cogs += b * s.buildCost / 1000;
    }
    e.totals.delivered += built;
    // fixed costs
    const fac = sum(e.factories.map((f) => f.level * FACTORY.upkeep));
    const fixed = 0.04 + fac + e.stations * STATION_BATCH.upkeep + (e.marketing || 0) / MONTH;
    // robotaxi
    const taxi = e.research.robotaxi ? e.totals.delivered * 0.000004 : 0;
    const revenue = rev + taxi; const cost = cogs + fixed;
    state.cash = r2(state.cash + revenue - cost);
    e.last = { orders, built, cap, revenue, cost, taxi, fixed, profit: revenue - cost };
    e.lastProfit = revenue - cost;
    e.m.rev += revenue; e.m.cost += cost; e.m.cars += built;
    e.totals.rev += revenue; e.totals.profit += revenue - cost;
    // brand drift
    const avgStars = live.length ? sum(live.map((m) => m.stars * (m.delivered + 10))) / sum(live.map((m) => m.delivered + 10)) : 3;
    const target = clamp(8 + (avgStars - 1) * 13 + Math.log10(1 + e.totals.delivered) * 5 + Math.log10(1 + (e.marketing || 0)) * 8, 0, 100);
    e.brand = clamp(e.brand + (target - e.brand) * 0.01, 0, 100);

    // events
    if (live.length && e.totals.delivered > 2000) {
      const risk = 0.0012 * (e.research.quality ? 0.5 : 1) * (e.research.pilot2 ? 1.3 : 1);
      if (rng() < risk) {
        const m = live[Math.floor(rng() * live.length)];
        const cost = r2(m.delivered * 0.0006 + 2);
        state.cash = r2(state.cash - cost); e.m.cost += cost; e.totals.recalls += 1;
        e.brand = clamp(e.brand - 4, 0, 100);
        const why = ['a seat-belt anchor', 'a charge-port latch', 'a steering sensor', 'cell coolant lines', 'a software update'][Math.floor(rng() * 5)];
        ev(`⚠ Recall: ${fmtN(m.delivered)} <b>${m.name}</b> cars for ${why}. Cost $${cost}M, brand −4.`, true);
      }
    }
    if (live.length && rng() < 0.004) {
      const k = rng();
      if (k < 0.3) { e.mods.push({ id: 'credit', v: 1.2, until: day + 60 }); ev('💵 EV tax credit passed: car demand +20% for 60 days.', true); }
      else if (k < 0.5) { e.mods.push({ id: 'chips', v: 0.7, until: day + 30 }); ev('⚠ Chip shortage: car output −30% for 30 days.', true); }
      else if (k < 0.75) { e.mods.push({ id: 'rival', v: 0.85, until: day + 90 }); ev('▼ Rival carmaker Ampere launches a cheap EV: demand −15% for 90 days.'); }
      else { e.mods.push({ id: 'viral', v: 1.15, until: day + 45 }); e.brand = clamp(e.brand + 3, 0, 100); ev('▲ A viral road-trip video stars a Voltline car: demand +15%.', true); }
    }
    rollMonth(state, e, () => ({ cars: Math.round(e.m.cars), brand: Math.round(e.brand) }));
  }
  function tickDC(state, d, rng, ev) {
    const day = state.day;
    d.mods = d.mods.filter((m) => m.until > day);
    tickLab(state, d, DC_RESEARCH, ev, 'Orbital Compute');
    // assembly line
    let rate = LINE_RATE[d.up.line || 0];
    while (rate > 0 && d.queue.length) {
      const q = d.queue[0];
      const take = Math.min(rate, q.n - q.prog);
      q.prog += take; rate -= take;
      const whole = Math.floor(q.prog + 1e-9) - (q.done || 0);
      if (whole > 0) { d.ready[q.gen] = (d.ready[q.gen] || 0) + whole; q.done = (q.done || 0) + whole; }
      if (q.prog >= q.n - 1e-9) { d.queue.shift(); ev(`🧩 ${q.n} × ${MOD_GENS[q.gen].name} ready to launch.`, true); }
    }
    // aging and failures
    const keep = [];
    for (const c of d.orbit) {
      const G = MOD_GENS[c.gen];
      if (day - c.day >= G.life) { ev(`⤵ ${c.n} ${G.name} modules reached end of life and deorbited.`); continue; }
      if (c.n > 0 && rng() < 0.0004 * c.n * (d.research.shield ? 0.4 : 1)) { c.n -= 1; d.totals.lost += 1; ev(`✖ A ${G.name} module was hit by debris and lost.`, true); }
      if (c.n > 0) keep.push(c);
    }
    d.orbit = keep;
    // market index random walk with gentle growth
    d.index = clamp(d.index * (1 + (rng() - 0.5) * 0.02) + 0.0003, 0.6, 2.2);
    if (rng() < 0.004) {
      const k = rng();
      if (k < 0.4) { d.mods.push({ id: 'storm', v: 0.12, until: day + 5 }); ev('☀ Solar storm: compute uptime −12% for 5 days.', true); }
      else if (k < 0.7) { d.index = clamp(d.index * 1.25, 0.6, 2.2); ev('▲ AI boom: compute spot prices jump 25%.', true); }
      else { d.index = clamp(d.index * 0.82, 0.6, 2.2); ev('▼ Chip glut on the ground: spot prices fall 18%.'); }
    }
    // offers
    const u = dcUnits(state, d);
    d.offers = d.offers.filter((o) => o.expires > day);
    const committedNow = sum(d.deals.map((k) => k.units));
    if (d.offers.length < 3 && committedNow < spotDepth(state) * 0.8 && rng() < 0.04) {
      const laser = !!d.up.laser && rng() < 0.4;
      const scale = Math.max(20, u.raw + readyCount(d) * bestGen(d).units);
      const units = Math.max(10, Math.round(Math.min(scale * (0.15 + rng() * 0.35), spotDepth(state) * (0.15 + rng() * 0.2)) / 5) * 5);
      const days = [90, 120, 180, 270, 360][Math.floor(rng() * 5)];
      const price = r2(spotBase(state, d) * (1.15 + rng() * 0.3 + (laser ? 0.3 : 0)) * 1000) / 1000; // $M per PF-day
      d.offers.push({ id: 'o' + day + '-' + Math.floor(rng() * 1e5), client: DC_CLIENTS[Math.floor(rng() * DC_CLIENTS.length)], units, days, price, laser,
        kind: laser ? 'Low-latency inference' : (rng() < 0.5 ? 'Model training' : 'Cloud burst'), expires: day + 25 });
    }
    // sell compute: deals first, rest on spot
    let avail = u.usable, dealRev = 0, penalty = 0;
    for (const k of d.deals) {
      const give = Math.min(avail, k.units); avail -= give;
      dealRev += give * k.price;
      if (give < k.units) { const p = (k.units - give) * k.price * 1.5; penalty += p; k.shortfall += 1; }
      k.left -= 1;
    }
    const finished = d.deals.filter((k) => k.left <= 0);
    for (const k of finished) ev(`✓ Compute deal with <b>${k.client}</b> completed${k.shortfall ? ` (${k.shortfall} short days)` : ''}.`);
    d.deals = d.deals.filter((k) => k.left > 0);
    const spotUnits = Math.max(0, avail);
    const spotP = spotPriceFor(state, d, spotUnits);
    const spotRev = spotUnits * spotP;
    const ops = 0.05 + u.mods * 0.01;
    const revenue = dealRev + spotRev; const cost = ops + penalty;
    state.cash = r2(state.cash + revenue - cost);
    d.last = { revenue, cost, profit: revenue - cost, dealRev, spotRev, spotUnits, spotP, penalty, ops, usable: u.usable, raw: u.raw };
    d.lastProfit = revenue - cost;
    d.m.rev += revenue; d.m.cost += cost; d.totals.rev += revenue; d.totals.profit += revenue - cost;
    rollMonth(state, d, () => ({ units: Math.round(u.usable), mods: u.mods }));
  }
  function fmtN(n) { n = Math.round(n); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(n); }

  // ---------------------------------------------------------------- summary
  function summary(state) {
    const V = ensure(state); const e = V.ev, d = V.dc;
    const out = { canFoundEV: canFoundEV(state), canFoundDC: canFoundDC(state), evCost: EV_FOUND_COST, dcCost: DC_FOUND_COST, halo: haloOn(state), ev: null, dc: null, log: V.log.slice(0, 12) };
    if (e) {
      const dm = demandMult(state, e);
      const live = e.models.filter((m) => m.status !== 'retired');
      out.ev = {
        name: e.name, founded: e.founded, brand: Math.round(e.brand), stations: e.stations, stationsBuilding: sum(e.stationJobs.map((j) => j.n)),
        capacity: Math.round(evCapacity(state, e)), carsDay: e.last ? e.last.built : 0, ordersDay: e.last ? e.last.orders : 0,
        backlog: Math.round(sum(live.map((m) => m.backlog))), revenueDay: e.last ? e.last.revenue : 0, costDay: e.last ? e.last.cost : 0,
        profitDay: e.last ? e.last.profit : 0, profitMonth: sum(e.d30), delivered: Math.round(e.totals.delivered), recalls: e.totals.recalls,
        marketing: e.marketing, demandMult: dm, batCost: Math.round(batCost(e) * 1000), lab: e.lab, research: e.research,
        models: e.models.map((m) => Object.assign({}, m, { stats: modelStats(state, m), waitDays: m.lastBuilt > 0.05 ? Math.round(m.backlog / m.lastBuilt) : (m.backlog > 1 ? 99 : 0) })),
        factories: e.factories.map((f) => Object.assign({}, f, { cap: f.level * FACTORY.capPerLevel, upCost: FACTORY.upCost * f.level })),
        nextFactoryCost: e.factories.length < FACTORY.maxCount ? FACTORY.cost * (1 + 0.25 * e.factories.length) : null,
        history: e.history.slice(), taxiDay: e.last ? e.last.taxi : 0, mods: e.mods.slice(),
      };
    }
    if (d) {
      const u = dcUnits(state, d);
      const committed = sum(d.deals.map((k) => k.units));
      const G = bestGen(d);
      out.dc = {
        name: d.name, founded: d.founded, ready: Object.assign({}, d.ready), readyCount: readyCount(d), queue: d.queue.map((q) => Object.assign({}, q)),
        modules: u.mods, rawPF: u.raw, usablePF: u.usable, eff: dcEff(d), uptime: dcUptime(state, d), committed,
        spotPrice: spotPriceFor(state, d, d.last ? d.last.spotUnits : 0), spotIndex: d.index, up: Object.assign({}, d.up), lineRate: LINE_RATE[d.up.line || 0],
        gen: G, revenueDay: d.last ? d.last.revenue : 0, costDay: d.last ? d.last.cost : 0, profitDay: d.last ? d.last.profit : 0, profitMonth: sum(d.d30),
        deals: d.deals.map((k) => Object.assign({}, k)), offers: d.offers.map((k) => Object.assign({}, k)), lab: d.lab, research: d.research,
        cohorts: d.orbit.map((c) => ({ gen: c.gen, n: c.n, age: state.day - c.day, life: MOD_GENS[c.gen].life, health: cohortHealth(c, state.day) })),
        history: d.history.slice(), totals: Object.assign({}, d.totals), last: d.last, mods: d.mods.slice(),
      };
    }
    out.profitDay = (out.ev ? out.ev.profitDay : 0) + (out.dc ? out.dc.profitDay : 0);
    return out;
  }
  // Optional perks other systems may read.
  function perks(state) {
    const V = ensure(state);
    const cells = V.ev && V.ev.research.cells3;
    return { rocketCostMult: cells ? 0.97 : 1, carConnectivity: !!(V.ev && haloOn(state)) };
  }

  root.APOGEE_VENTURES = {
    VERSION, CAR_TYPES, EV_RESEARCH, FACTORY, STATION_BATCH, PILOT_LINE, MOD_GENS, DC_RESEARCH, DC_UPGRADES, LINE_RATE,
    EV_FOUND_COST, DC_FOUND_COST, EV_FOUND_REP, DC_FOUND_REP,
    ensure, tick, summary, act, dcContract, onDcResult, modelStats, canFoundEV, canFoundDC, perks, haloOn, netSum,
  };
})(typeof window !== 'undefined' ? window : globalThis);
