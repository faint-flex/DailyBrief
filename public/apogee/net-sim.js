// APOGEE: "Halo" satellite internet business simulation. Pure logic, no DOM (testable in Node).
// Load order: after sim.js, before game.js. Exposes window.APOGEE_NET.
// Money is $M (like the rest of the game). Plan / dish prices are in plain dollars per customer.
(function (root) {
  'use strict';

  // ---------- Data ----------
  // Satellite generations. mass t, cost $M per sat, gbps raw bandwidth, life days, covW = coverage weight
  // (bigger antennas cover more), speed = nominal Mbps a customer sees on an uncongested network.
  const GENS = {
    v1: { id: 'v1', name: 'Halo V1', icon: '🛰️', mass: 0.30, cost: 0.24, gbps: 18,  life: 1500, covW: 1.0, speed: 110, lasers: false, research: null, desc: 'Flat-packed starter sat. Light and cheap, short life.' },
    v2: { id: 'v2', name: 'Halo V2', icon: '🛰️', mass: 0.80, cost: 0.45, gbps: 90,  life: 1800, covW: 1.3, speed: 150, lasers: false, research: 'v2',  desc: 'Bigger phased arrays: 5x the bandwidth of V1.' },
    v3: { id: 'v3', name: 'Halo V3', icon: '🛰️', mass: 1.25, cost: 0.70, gbps: 260, life: 2100, covW: 1.6, speed: 220, lasers: false, research: 'v3',  desc: 'E-band backhaul and huge antennas. Huge Gbps per ton.' },
    v4: { id: 'v4', name: 'Halo V4 Laser', icon: '🔆', mass: 1.50, cost: 0.90, gbps: 520, life: 2500, covW: 2.0, speed: 300, lasers: true, research: 'v4', desc: 'Laser links between sats: covers oceans and poles with no ground station under it.' },
  };
  const GEN_ORDER = ['v1', 'v2', 'v3', 'v4'];

  // Regions. pop = addressable homes (millions), income 0..1 (sets what people can pay).
  // need = effective sats for 50% coverage there (mid latitudes are easiest).
  const REGIONS = [
    { id: 'na', name: 'North America', icon: '🌎', pop: 7.0, income: 1.00, need: 120, license: 0,  licDays: 0,   station: 2.5, lat: 42,  lon: -100 },
    { id: 'eu', name: 'Europe',        icon: '🌍', pop: 6.0, income: 0.85, need: 120, license: 6,  licDays: 45,  station: 3.0, lat: 50,  lon: 12 },
    { id: 'ea', name: 'East Asia',     icon: '🌏', pop: 5.0, income: 0.70, need: 140, license: 14, licDays: 90,  station: 3.0, lat: 36,  lon: 125 },
    { id: 'me', name: 'Middle East',   icon: '🕌', pop: 2.5, income: 0.60, need: 150, license: 8,  licDays: 75,  station: 2.5, lat: 27,  lon: 45 },
    { id: 'sa', name: 'South America', icon: '🌎', pop: 5.0, income: 0.45, need: 180, license: 4,  licDays: 40,  station: 2.0, lat: -15, lon: -58 },
    { id: 'af', name: 'Africa',        icon: '🌍', pop: 7.0, income: 0.25, need: 200, license: 3,  licDays: 60,  station: 2.0, lat: 3,   lon: 22 },
    { id: 'as', name: 'South Asia',    icon: '🌏', pop: 8.0, income: 0.22, need: 180, license: 10, licDays: 120, station: 2.0, lat: 20,  lon: 80 },
    { id: 'oc', name: 'Oceania',       icon: '🏝️', pop: 1.8, income: 0.90, need: 160, license: 2,  licDays: 30,  station: 2.5, lat: -27, lon: 140 },
  ];
  const REGION = {}; REGIONS.forEach((r) => { REGION[r.id] = r; });

  // Customer tiers. price/dish defaults in $, ref = price people find fair in a rich region,
  // kit = cost to make one terminal ($), load = busy-hour Gbps per customer, pot = share of region homes,
  // take = share of the potential that buys at a fair price with full coverage.
  const TIERS = {
    home:     { id: 'home',     name: 'Home',     icon: '🏠', price: 99,    dish: 499,   ref: 110,   dishRef: 600,    kit: 800,   load: 0.006, pot: 1,      take: 0.30, ocean: false, needs: null },
    business: { id: 'business', name: 'Business', icon: '🏢', price: 250,   dish: 1500,  ref: 300,   dishRef: 2500,   kit: 1800,  load: 0.02,  pot: 0.08,   take: 0.30, ocean: false, needs: null },
    maritime: { id: 'maritime', name: 'Maritime', icon: '🚢', price: 1000,  dish: 2500,  ref: 1300,  dishRef: 5000,   kit: 4000,  load: 0.08,  pot: 0.006,  take: 0.40, ocean: true,  needs: null, needsDish: 2 },
    aviation: { id: 'aviation', name: 'Aviation', icon: '✈️', price: 15000, dish: 50000, ref: 20000, dishRef: 120000, kit: 90000, load: 0.5,   pot: 0.0007, take: 0.45, ocean: true,  needs: null, needsDish: 3 },
  };
  const TIER_IDS = ['home', 'business', 'maritime', 'aviation'];

  // Research / upgrades, paid in $M, takes days, one at a time.
  const UPGRADES = [
    { id: 'v2',       name: 'Halo V2 Satellite',     icon: '🛰️', cost: 18,  days: 40, req: [],                desc: 'Unlocks V2 sats: 3.6x the bandwidth, longer life.' },
    { id: 'localprice', name: 'Local Pricing',       icon: '🏷️', cost: 4,   days: 20, req: [],                desc: 'Plans cost less in poorer regions (scaled by income). Big demand boost in Africa, South Asia, South America.' },
    { id: 'autoops',  name: 'Autonomous Operations', icon: '🤖', cost: 12,  days: 35, req: [],                desc: 'Collision avoidance and self-healing network: sat and gateway upkeep -40%.' },
    { id: 'beam',     name: 'Beam Forming',          icon: '🔦', cost: 30,  days: 45, req: ['v2'],            desc: 'Smarter beams: +30% usable capacity from every sat.' },
    { id: 'polar',    name: 'Polar Shell',           icon: '🧭', cost: 25,  days: 40, req: ['v2'],            desc: 'Plan polar orbits so coverage reaches the poles and far north. Needed for true global coverage.' },
    { id: 'v3',       name: 'Halo V3 Satellite',     icon: '🛰️', cost: 55,  days: 60, req: ['v2'],            desc: 'Unlocks V3 sats: 260 Gbps each.' },
    { id: 'v4',       name: 'Laser Links (Halo V4)', icon: '🔆', cost: 140, days: 90, req: ['v3'],            desc: 'Unlocks V4 laser sats: oceans and poles covered, no ground station needed under each region.' },
  ];
  // Ground hardware the player designs: user dish and Wi-Fi router. Level 1 is owned at founding.
  // kitMult scales the terminal cost to make, speed multiplies max user speed, sat adds satisfaction.
  const DISHES = [
    { level: 1, id: 'dish1', name: 'Dish Gen1 "Round Dish"',  icon: '📡', cost: 0,  days: 0,  kitMult: 1.00, speed: 1.00, sat: 0,    unlocks: null,       desc: 'Motorized round dish. Works, but pricey to make.' },
    { level: 2, id: 'dish2', name: 'Dish Gen2 "Flat Panel"',  icon: '📡', cost: 7,  days: 25, kitMult: 0.70, speed: 1.10, sat: 0.03, unlocks: 'maritime', desc: 'Electronically steered flat panel: 30% cheaper, faster. Rugged enough for ships: unlocks Maritime plans.' },
    { level: 3, id: 'dish3', name: 'Dish Gen3 "Aero Panel"',  icon: '📡', cost: 28, days: 45, kitMult: 0.50, speed: 1.20, sat: 0.05, unlocks: 'aviation', desc: 'Low-profile panel certified for aircraft: unlocks Aviation plans. Half the first dish cost.' },
    { level: 4, id: 'dish4', name: 'Dish Gen4 "Mini"',        icon: '📡', cost: 60, days: 60, kitMult: 0.33, speed: 1.30, sat: 0.07, unlocks: null,       desc: 'Backpack-size mass-made dish: a third of the first dish cost, best speeds.' },
  ];
  const ROUTERS = [
    { level: 1, id: 'router1', name: 'Router Basic', icon: '📶', cost: 0,  days: 0,  unit: 40,  speed: 1.00, sat: 0,    desc: 'One Wi-Fi box. Dead spots in big homes.' },
    { level: 2, id: 'router2', name: 'Router Mesh',  icon: '📶', cost: 5,  days: 20, unit: 90,  speed: 1.05, sat: 0.04, desc: 'Mesh nodes cover the whole house: happier customers.' },
    { level: 3, id: 'router3', name: 'Router Pro',   icon: '📶', cost: 20, days: 35, unit: 160, speed: 1.10, sat: 0.07, desc: 'Wi-Fi 7 with smart traffic shaping: best experience, lower churn.' },
  ];
  // In-place upgrades for sats already in orbit (software pushes and a laser retrofit).
  const SAT_UPGRADES = [
    { id: 'sw1',      name: 'Smart scheduling update', icon: '💾', cost: 4,  perSat: 0,    days: 10, cap: 0.10, req: null, desc: 'Software push to every sat: +10% usable capacity.' },
    { id: 'sw2',      name: 'Beam hopping update',     icon: '💾', cost: 12, perSat: 0,    days: 20, cap: 0.12, req: 'v2', desc: 'Software push: beams hop to where users are. +12% usable capacity.' },
    { id: 'laserfit', name: 'Laser link retrofit',     icon: '🔆', cost: 5,  perSat: 0.04, days: 30, cap: 0.05, req: 'v4', desc: 'Upload laser routing to every non-laser sat in orbit (they relay via V4s): ocean and pole coverage, +5% capacity. Cost per sat in orbit.' },
  ];
  const UPG = {}; UPGRADES.forEach((u) => { UPG[u.id] = u; });

  // Sat factory: sats built per day at each level, cost to reach the next level ($M).
  const FACTORY_RATE = [0, 2, 4, 7, 12, 20, 32];
  const FACTORY_COST = [0, 5, 14, 32, 70, 140];   // index = current level → cost to go up
  const FACTORY_MAX = 6;
  const SUPPORT = [
    { name: 'Bare minimum', mult: 0,   sat: -0.16 },
    { name: 'Small team',   mult: 0.6, sat: -0.06 },
    { name: 'Standard',     mult: 1,   sat: 0 },
    { name: 'Great',        mult: 1.7, sat: 0.05 },
    { name: 'Legendary',    mult: 2.6, sat: 0.09 },
  ];
  const FOUND_COST = 15;
  const STATION_GBPS = 320;          // usable Gbps one gateway can handle
  const STATION_UPKEEP = 0.25;       // $M per month
  const STATION_DAYS = 7;
  const SERVICE = 0.35;              // share of raw sat bandwidth over paying customers
  const SAT_OPS = 0.003;             // $M per sat per month
  const RIVAL = 'Orbitline';
  const IPO_SHARE = 0.12;            // share of Halo sold at the IPO
  const OVERSELL = 1.12;             // sales stop when the network is 12% over capacity (then it gets slow)

  const GOALS = [
    { id: 'subs1k',   name: '1,000 subscribers',        icon: '👥', reward: 2,   val: (n, s) => s.subs, goal: 1e3 },
    { id: 'profit1',  name: 'First profitable month',   icon: '📈', reward: 5,   val: (n) => (n.goals.profit1 ? 1 : 0), goal: 1 },
    { id: 'subs100k', name: '100,000 subscribers',      icon: '👥', reward: 10,  val: (n, s) => s.subs, goal: 1e5 },
    { id: 'sats1k',   name: '1,000 sats in orbit',      icon: '🛰️', reward: 20,  val: (n, s) => s.sats.orbit, goal: 1000 },
    { id: 'subs1m',   name: '1 million subscribers',    icon: '🎉', reward: 40,  val: (n, s) => s.subs, goal: 1e6 },
    { id: 'global',   name: '90% global coverage',      icon: '🌐', reward: 30,  val: (n, s) => s.coverage, goal: 0.9 },
    { id: 'rev1b',    name: '$1B yearly revenue',       icon: '💰', reward: 50,  val: (n, s) => s.revenueYear, goal: 1000 },
    { id: 'ipo',      name: 'Take Halo public (IPO)',   icon: '🔔', reward: 0,   val: (n) => (n.ipo ? 1 : 0), goal: 1 },
    { id: 'subs10m',  name: '10 million subscribers',   icon: '🏆', reward: 100, val: (n, s) => s.subs, goal: 1e7 },
  ];

  const DEAL_KINDS = [
    { kind: 'gov',      icon: '🏛️', label: 'Government network',  names: ['Allied Defense Network', 'Civil Emergency Service', 'Polar Research Agency', 'Border Patrol Agency'], cov: 'global', need: [0.3, 0.75], m: [1.2, 4.5] },
    { kind: 'rural',    icon: '🏫', label: 'Rural schools program', names: ['Rural Connect Program', 'Schools Online Fund', 'Village Link Initiative'], cov: 'region', need: [0.4, 0.8], m: [0.8, 2.5] },
    { kind: 'shipping', icon: '🚢', label: 'Shipping fleet',       names: ['Meridian Shipping', 'Bluefin Cruises', 'Northsea Freight', 'Coral Line'], cov: 'ocean', need: [0.2, 0.5], m: [0.8, 2.8] },
    { kind: 'airline',  icon: '✈️', label: 'Airline fleet Wi-Fi',  names: ['Skyward Airlines', 'Pacifica Air', 'Aurora Jet', 'Lark Regional'], cov: 'ocean', need: [0.35, 0.7], m: [1.5, 5] },
    { kind: 'telco',    icon: '📶', label: 'Cell tower backhaul',  names: ['Bluewave Telecom', 'Meridian Mobile', 'Highland Cellular'], cov: 'region', need: [0.5, 0.85], m: [1, 3.5] },
  ];

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const scurve = (x, need, k) => { if (x <= 0) return 0; const r = Math.pow(x / need, k || 2.5); return r / (1 + r); };
  const fmtM = (m) => { const a = Math.abs(m); const s = a >= 1000 ? `$${(a / 1000).toFixed(2)}B` : a >= 100 ? `$${Math.round(a)}M` : `$${a.toFixed(1)}M`; return (m < 0 ? '-' : '') + s; };
  const fmtN = (n) => { n = Math.round(n); if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'; if (n >= 1e4) return Math.round(n / 1e3) + 'k'; return n.toLocaleString('en-US'); };
  const has = (net, id) => !!(net && net.research && net.research[id]);
  function campusBonus(state) {
    try {
      const C = root.APOGEE_CAMPUS;
      if (C && typeof C.bonus === 'function') { const b = C.bonus(state) || {}; return { satFactory: num(b.satFactory, 0), groundStations: num(b.groundStations, 0) }; }
    } catch (e) { /* ignore */ }
    return { satFactory: 0, groundStations: 0 };
  }

  function emptySubs() { return { home: 0, business: 0, maritime: 0, aviation: 0 }; }
  function newNet(state) {
    const regions = {};
    for (const r of REGIONS) regions[r.id] = { lic: r.id === 'na', licDone: 0, stations: 0, building: [], subs: emptySubs(), wait: 0 };
    const prices = {};
    for (const t of TIER_IDS) prices[t] = { monthly: TIERS[t].price, dish: TIERS[t].dish };
    return {
      v: 1, founded: state.day, gen: 'v1', factory: 1, queue: [], buildAcc: 0, ready: {}, cohorts: [],
      research: {}, lab: null, regions, prices, marketing: 0.3, support: 2,
      awareness: 0.12, rep: 0.5, usage: 1, outage: 0, lostTotal: 0, deorbited: 0, launched: 0,
      deals: [], active: [], goals: {}, ipo: null, own: 1,
      rival: { on: false, sats: 0, cov: 0, price: 95 },
      month: { rev: 0, cost: 0, capex: 0, subsidy: 0, start: state.day },
      last: { rev: 0, cost: 0, capex: 0, profit: 0 }, profitMonth: 0, cashToDate: 0,
      history: [{ day: state.day, subs: 0, profit: 0, revenue: 0, sats: 0, coverage: 0 }],
      events: [], day: { rev: 0, cost: 0 }, nextDealDay: state.day + 25,
      hw: { dish: 1, router: 1 }, hwLab: null, satUp: {}, satLab: null, autoReplace: false, replaceDebt: 0,
    };
  }

  // Make sure state.net exists and has every field (old saves, older net versions).
  function ensure(state) {
    if (!state) return null;
    if (state.net === undefined) state.net = null;
    const n = state.net;
    if (!n) return null;
    const base = newNet({ day: num(n.founded, state.day || 1) });
    for (const k of Object.keys(base)) if (n[k] === undefined || (n[k] === null && base[k] !== null)) n[k] = base[k];
    for (const r of REGIONS) {
      const x = n.regions[r.id] || (n.regions[r.id] = base.regions[r.id]);
      if (!x.subs) x.subs = emptySubs();
      for (const t of TIER_IDS) x.subs[t] = Math.max(0, num(x.subs[t], 0));
      if (!Array.isArray(x.building)) x.building = [];
      x.stations = Math.max(0, num(x.stations, 0));
    }
    for (const t of TIER_IDS) if (!n.prices[t]) n.prices[t] = base.prices[t];
    if (!GENS[n.gen]) n.gen = 'v1';
    n.factory = clamp(Math.round(num(n.factory, 1)), 1, FACTORY_MAX);
    n.support = clamp(Math.round(num(n.support, 2)), 0, 4);
    n.marketing = Math.max(0, num(n.marketing, 0.3));
    n.cohorts = (n.cohorts || []).filter((c) => c && GENS[c.gen] && c.n > 0);
    return n;
  }

  // ---------- Derived numbers ----------
  function bestGen(net) { let g = 'v1'; for (const id of GEN_ORDER) if (!GENS[id].research || has(net, GENS[id].research)) g = id; return g; }
  function satCost(net, gen) { return GENS[gen].cost * (1 - 0.05 * (net.factory - 1)); }
  function dishOf(net) { return DISHES[clamp((net.hw && net.hw.dish) || 1, 1, DISHES.length) - 1]; }
  function routerOf(net) { return ROUTERS[clamp((net.hw && net.hw.router) || 1, 1, ROUTERS.length) - 1]; }
  function dishFactor(net) { return dishOf(net).kitMult; }
  function kitCost(net, tid) { return TIERS[tid].kit * dishFactor(net) + (tid === 'home' || tid === 'business' ? routerOf(net).unit : 0); }
  function swCap(net) { let m = 1; for (const u of SAT_UPGRADES) if (net.satUp && net.satUp[u.id]) m += u.cap; return m; }
  function tierOpen(net, tid) { const T = TIERS[tid]; return (!T.needs || has(net, T.needs)) && (!T.needsDish || dishOf(net).level >= T.needsDish); }
  function factoryRate(state) { const n = state.net; return FACTORY_RATE[n.factory] + campusBonus(state).satFactory; }
  function lasers(net) { return net.cohorts.some((c) => GENS[c.gen].lasers && c.n >= 1); }
  function orbitCount(net) { return net.cohorts.reduce((s, c) => s + c.n, 0); }
  function readyCount(net) { return Object.values(net.ready).reduce((s, v) => s + (v || 0), 0); }

  function network(state) {
    const net = state.net;
    let eff = 0, raw = 0, laserEff = 0, aging = 0, speed = 0;
    for (const c of net.cohorts) {
      const g = GENS[c.gen];
      eff += c.n * g.covW; raw += c.n * g.gbps;
      if (g.lasers || c.laser) laserEff += c.n * g.covW;
      if (state.day - c.day > g.life * 0.8) aging += c.n;
      if (c.n >= 10) speed = Math.max(speed, g.speed);
    }
    if (!speed) speed = net.cohorts.length ? GENS[net.cohorts[net.cohorts.length - 1].gen].speed : GENS.v1.speed;
    speed *= dishOf(net).speed * routerOf(net).speed;
    const polar = has(net, 'polar') || laserEff > 50;
    const regCov = {};
    let land = 0, landW = 0;
    for (const r of REGIONS) {
      let c = scurve(eff, r.need);
      if (!polar && (r.id === 'na' || r.id === 'eu' || r.id === 'oc')) c *= 0.92;
      regCov[r.id] = c; land += c * r.pop; landW += r.pop;
    }
    const polarCov = polar ? scurve(eff, 900) : 0;
    const coverage = clamp(0.8 * (land / landW) + 0.2 * polarCov, 0, 1);
    const laserShare = eff > 0 ? laserEff / eff : 0;
    const ocean = clamp(scurve(eff, 160) * (0.4 + 0.6 * Math.min(1, laserShare * 3)), 0, 1);
    const satCap = raw * SERVICE * (has(net, 'beam') ? 1.3 : 1) * swCap(net);
    let stations = campusBonus(state).groundStations;
    for (const r of REGIONS) stations += net.regions[r.id].stations;
    const stationCap = stations * STATION_GBPS * (laserShare > 0.02 ? 1.5 : 1);
    const capacity = Math.min(satCap, stationCap);
    return { eff, raw, satCap, stationCap, capacity, stations, regCov, coverage, ocean, polar, laser: laserShare > 0.02, aging, speedNominal: speed, polarCov };
  }

  function usedGbps(net) {
    let u = 0;
    for (const r of REGIONS) for (const t of TIER_IDS) u += net.regions[r.id].subs[t] * TIERS[t].load;
    u *= net.usage;
    for (const d of net.active) if (d.running) u += d.load;
    return u;
  }

  function canSell(net, nw, rid, anyStation) {
    const x = net.regions[rid];
    if (!x.lic) return 'No license yet';
    if (x.stations < 1 && !(nw.laser && anyStation)) return 'Needs a ground station';
    if (nw.regCov[rid] < 0.04) return 'Not enough satellites overhead';
    return '';
  }

  function regionPrice(net, rid, tid) {
    const p = num(net.prices[tid].monthly, TIERS[tid].price);
    return has(net, 'localprice') ? p * Math.max(0.3, REGION[rid].income) : p;
  }

  function rivalFactor(net, nw, sat) {
    if (!net.rival.on) return 1;
    const ours = Math.max(0.01, nw.coverage * (0.4 + sat) * TIERS.home.ref / Math.max(20, net.prices.home.monthly));
    const theirs = net.rival.cov * 0.95 * TIERS.home.ref / Math.max(20, net.rival.price);
    return 1 - 0.45 * theirs / (theirs + ours);
  }

  // Customers who would buy right now in region rid, tier tid.
  function demandFor(net, nw, rid, tid, sat) {
    const R = REGION[rid], T = TIERS[tid];
    if (!tierOpen(net, tid)) return 0;
    const cov = T.ocean ? nw.ocean : nw.regCov[rid];
    const inc = tid === 'home' ? R.income : Math.sqrt(R.income);
    const price = regionPrice(net, rid, tid);
    const refP = has(net, 'localprice') ? T.ref * Math.max(0.3, R.income) * Math.min(1, inc / Math.max(0.3, R.income) + 0.25) : T.ref * inc;
    const pf = 2 / (1 + Math.pow(Math.max(1, price) / Math.max(1, refP), 2.2));
    const dish = Math.max(0, num(net.prices[tid].dish, T.dish));
    const df = 1.6 / (1 + 0.6 * Math.pow(dish / (T.dishRef * Math.max(0.2, inc)), 1.3));
    const mkt = 0.45 + 0.75 * net.awareness;
    const qual = 0.45 + 0.55 * net.rep;
    return R.pop * 1e6 * T.pot * T.take * Math.pow(cov, 1.2) * pf * df * mkt * qual * rivalFactor(net, nw, sat);
  }

  function satisfactionOf(net, nw, used) {
    const cap = nw.capacity;
    const speed = used <= 0 ? nw.speedNominal * 1.3 : used <= cap ? nw.speedNominal * (1 + 0.3 * (1 - used / Math.max(1e-9, cap))) : nw.speedNominal * cap / used;
    let subs = 0, covQ = 0;
    for (const r of REGIONS) { const s = sumSubs(net.regions[r.id].subs); subs += s; covQ += s * nw.regCov[r.id]; }
    covQ = subs > 0 ? covQ / subs : nw.coverage;
    const p = net.prices.home.monthly / TIERS.home.ref;
    const fair = p > 1 ? -0.15 * Math.min(2, p - 1) : 0.05 * (1 - p);
    const sat = clamp(0.15 + 0.4 * Math.min(1, speed / 200) + 0.2 * covQ + fair + SUPPORT[net.support].sat + dishOf(net).sat + routerOf(net).sat - (net.outage > 0 ? 0.2 : 0) + (nw.laser ? 0.04 : 0), 0, 1);
    return { speed, sat };
  }
  function sumSubs(s) { return s.home + s.business + s.maritime + s.aviation; }
  function totalSubs(net) { let t = 0; for (const r of REGIONS) t += sumSubs(net.regions[r.id].subs); return t; }

  // ---------- Daily tick ----------
  function pushEvent(net, state, text, out, toast) {
    net.events.unshift({ day: state.day, text });
    net.events = net.events.slice(0, 30);
    out.events.push(text);
    if (toast) out.toasts.push(text);
  }

  function tick(state, rng) {
    const out = { events: [], toasts: [] };
    ensure(state);
    const net = state.net;
    if (!net) return out;
    rng = typeof rng === 'function' ? rng : Math.random;
    const day = state.day;

    // Factory output.
    let rate = factoryRate(state) + net.buildAcc;
    let built = 0;
    while (net.queue.length && rate >= 1) {
      const q = net.queue[0];
      const k = Math.min(q.n, Math.floor(rate));
      q.n -= k; rate -= k; built += k;
      net.ready[q.gen] = (net.ready[q.gen] || 0) + k;
      if (q.n <= 0) net.queue.shift();
    }
    net.buildAcc = net.queue.length ? rate : 0;
    if (built && !net.queue.length) pushEvent(net, state, `🏭 Sat order finished: ${fmtN(readyCount(net))} Halo sats ready to launch.`, out, true);

    // Research.
    if (net.lab && day >= net.lab.done) {
      const u = UPG[net.lab.id];
      net.research[net.lab.id] = day; net.lab = null;
      const g = bestGen(net); if (GEN_ORDER.indexOf(g) > GEN_ORDER.indexOf(net.gen)) net.gen = g;
      pushEvent(net, state, `🔬 Research done: ${u ? u.name : 'upgrade'}.`, out, true);
    }
    if (net.hwLab && day >= net.hwLab.done) {
      const L = net.hwLab; net.hwLab = null;
      net.hw[L.kind] = Math.max(net.hw[L.kind], L.level);
      const it = (L.kind === 'dish' ? DISHES : ROUTERS)[L.level - 1];
      pushEvent(net, state, `🔧 New hardware ready: ${it.name}.${it.unlocks ? ` ${TIERS[it.unlocks].name} plans unlocked.` : ''} New customers get it from today.`, out, true);
    }
    if (net.satLab && day >= net.satLab.done) {
      const u = SAT_UPGRADES.find((x) => x.id === net.satLab.id); net.satLab = null;
      if (u) {
        net.satUp[u.id] = day;
        if (u.id === 'laserfit') for (const c of net.cohorts) c.laser = true;
        pushEvent(net, state, `💾 Sat upgrade done: ${u.name}.`, out, true);
      }
    }
    // Licenses and stations.
    for (const r of REGIONS) {
      const x = net.regions[r.id];
      if (!x.lic && x.licDone && day >= x.licDone) { x.lic = true; x.licDone = 0; pushEvent(net, state, `📜 License approved in ${r.name}. You can sell there once a ground station is up.`, out, true); }
      const done = x.building.filter((d) => day >= d).length;
      if (done) { x.stations += done; x.building = x.building.filter((d) => day < d); pushEvent(net, state, `📡 Ground station online in ${r.name} (${x.stations} total).`, out, false); }
    }

    // Aging, failures, deorbits.
    for (const c of net.cohorts) {
      const g = GENS[c.gen], age = day - c.day;
      let p = 0.00003;
      if (age > g.life) p = 0.03; else if (age > g.life * 0.9) p = 0.003;
      const lost = Math.min(c.n, c.n * p);
      c.n -= lost; net.deorbited += lost; net.replaceDebt += lost;
    }
    // Refit path: replace deorbited sats with the newest generation automatically (paid when ordered).
    if (net.autoReplace && net.replaceDebt >= 10) {
      const k = Math.floor(net.replaceDebt), cost = k * satCost(net, net.gen);
      if (state.cash - cost > 5) {
        spend(state, cost, true); net.replaceDebt -= k;
        const last = net.queue[net.queue.length - 1]; if (last && last.gen === net.gen) last.n += k; else net.queue.push({ gen: net.gen, n: k });
        pushEvent(net, state, `♻️ Auto-replace: ordered ${k} ${GENS[net.gen].name} sats for ${fmtM(cost)} to replace retired ones.`, out, false);
      }
    } else if (!net.autoReplace) net.replaceDebt = Math.min(net.replaceDebt, 0);
    net.cohorts = net.cohorts.filter((c) => c.n >= 0.5);

    // Network and customers.
    const nw = network(state);
    net.usage = Math.min(3, net.usage * 1.0004);
    if (net.outage > 0) net.outage--;
    let used = usedGbps(net);
    const sv = satisfactionOf(net, nw, used);
    net.rep += (sv.sat - net.rep) * 0.01;
    const subsNow = totalSubs(net);
    const revMonthEst = (net.last.rev || 0);
    const k = 1.2 + revMonthEst * 0.02;
    const awTarget = clamp(0.1 + 0.55 * net.marketing / (net.marketing + k) + 0.3 * Math.min(1, subsNow / 3e6), 0, 1);
    net.awareness += (awTarget - net.awareness) * 0.02;

    const anyStation = nw.stations > 0;
    const churnBase = 0.01 + 0.09 * Math.pow(1 - sv.sat, 2);
    let headroom = nw.capacity - used;
    const wants = [];
    let wantLoad = 0, subsidy = 0, revenue = 0;
    for (const r of REGIONS) {
      const x = net.regions[r.id];
      const why = canSell(net, nw, r.id, anyStation);
      for (const t of TIER_IDS) {
        const T = TIERS[t];
        const target = why ? 0 : demandFor(net, nw, r.id, t, sv.sat);
        let s = x.subs[t];
        const p = regionPrice(net, r.id, t);
        const over = Math.max(0, p / (T.ref * Math.max(0.3, r.income)) - 1.3) * 0.03;
        let churn = s * (churnBase + over) / 30;
        if (s > target) churn += (s - target) * 0.01;
        if (why && s > 0) churn += s * 0.02;
        s = Math.max(0, s - churn);
        x.subs[t] = s;
        const gap = target - s;
        if (gap > 0) {
          const add = gap * (0.012 + 0.03 * net.awareness);
          wants.push({ x, t, add, gap });
          wantLoad += add * T.load * net.usage;
        }
      }
    }
    headroom = nw.capacity * OVERSELL - usedGbps(net);
    let scale = wantLoad <= 0 ? 0 : clamp(headroom / wantLoad, 0, 1);
    // Cash guard: when the company is nearly broke, dish shipments (which are subsidised) slow down.
    const subsidised = TIER_IDS.some((t) => kitCost(net, t) > num(net.prices[t].dish, 0));
    if (subsidised && state.cash < 5 && scale > 0) {
      scale *= clamp((state.cash + 10) / 15, 0, 1);
      if (!net.cashGuard) { net.cashGuard = true; pushEvent(net, state, '💸 Cash is low: Halo slowed dish shipments (they are sold below cost). Raise the dish price or wait for revenue.', out, true); }
    } else if (state.cash > 20) net.cashGuard = false;
    for (const r of REGIONS) net.regions[r.id].wait = 0;
    for (const w of wants) {
      const add = w.add * scale;
      w.x.subs[w.t] += add;
      if (scale < 1) w.x.wait += (w.gap - add);
      const kit = kitCost(net, w.t);
      const dish = Math.max(0, num(net.prices[w.t].dish, TIERS[w.t].dish));
      subsidy += add * (kit - dish) / 1e6;
    }
    // Revenue.
    let subsAll = 0;
    for (const r of REGIONS) {
      const x = net.regions[r.id];
      for (const t of TIER_IDS) { revenue += x.subs[t] * regionPrice(net, r.id, t) / 1e6 / 30; subsAll += x.subs[t]; }
    }
    // Dishes sold above their making cost count as hardware revenue, not negative cost.
    let hwSales = 0;
    if (subsidy < 0) { hwSales = -subsidy; revenue += hwSales; subsidy = 0; }
    // Deals.
    for (const d of net.active) {
      d.running = dealMet(net, nw, d);
      if (d.running) revenue += d.monthly / 30;
      if (day >= d.end) { d.done = true; pushEvent(net, state, `${d.icon} ${d.name} deal finished.`, out, false); }
    }
    net.active = net.active.filter((d) => !d.done);
    net.deals = net.deals.filter((d) => d.expires > day);
    if (day >= net.nextDealDay) {
      net.nextDealDay = day + 18 + Math.floor(rng() * 25);
      if (nw.coverage > 0.12 && net.deals.length < 3) {
        const d = makeDeal(net, nw, state, rng);
        if (d) { net.deals.push(d); pushEvent(net, state, `${d.icon} New deal offer: ${d.name} (${fmtM(d.monthly)}/month).`, out, true); }
      }
    }

    // Costs.
    const sats = orbitCount(net);
    const auto = has(net, 'autoops') ? 0.6 : 1;
    const licensed = REGIONS.filter((r) => net.regions[r.id].lic).length;
    const stationsOwn = REGIONS.reduce((s, r) => s + net.regions[r.id].stations, 0);
    let cost = 0;
    cost += sats * SAT_OPS * auto / 30;
    cost += stationsOwn * STATION_UPKEEP * auto / 30;
    cost += (0.1 + subsAll * 0.0000025) * SUPPORT[net.support].mult / 30;
    cost += (0.35 + 0.12 * licensed) / 30;
    cost += net.marketing / 30;
    cost += revenue * 0.07;     // payments, backhaul, taxes
    cost += subsidy;

    let profit = revenue - cost;
    const toCompany = profit > 0 ? profit * net.own : profit;
    state.cash += toCompany;
    net.cashToDate += toCompany;
    net.day = { rev: revenue, cost, subsidy, profit };
    net.month.rev += revenue; net.month.cost += cost; net.month.subsidy += subsidy;

    // Rival.
    rivalTick(net, state, nw, rng, out);
    // Random events.
    randomEvents(net, state, nw, sv, rng, out);
    // Month end.
    if ((day - net.founded) % 30 === 0 && day > net.founded) closeMonth(net, state, nw, out);
    // Goals.
    checkGoals(state, out);
    return out;
  }

  function dealMet(net, nw, d) {
    if (d.cov === 'global') return nw.coverage >= d.need;
    if (d.cov === 'ocean') return nw.ocean >= d.need;
    const x = net.regions[d.region];
    return !!(x && x.lic && nw.regCov[d.region] >= d.need);
  }

  function makeDeal(net, nw, state, rng) {
    const kinds = DEAL_KINDS.filter((k) => (k.kind !== 'airline' || nw.ocean > 0.15));
    const k = kinds[Math.floor(rng() * kinds.length)];
    const need = Math.round((k.need[0] + (k.need[1] - k.need[0]) * rng()) * 20) / 20;
    const scale = 1 + Math.min(12, totalSubs(net) / 400000);
    const monthly = Math.round((k.m[0] + (k.m[1] - k.m[0]) * rng()) * scale * 10) / 10;
    const months = 12 + Math.floor(rng() * 4) * 6;
    let region = null;
    if (k.cov === 'region') { const lic = REGIONS.filter((r) => net.regions[r.id].lic); region = (lic.length ? lic : REGIONS)[Math.floor(rng() * (lic.length || REGIONS.length))].id; }
    const name = k.names[Math.floor(rng() * k.names.length)] + (region ? ` (${REGION[region].name})` : '');
    return {
      id: 'deal-' + state.day + '-' + Math.floor(rng() * 1e6).toString(36), kind: k.kind, icon: k.icon, label: k.label, name,
      cov: k.cov, need, region, monthly, months, upfront: Math.round(monthly * (1 + rng() * 2) * 10) / 10,
      load: Math.round(monthly * 12), expires: state.day + 30 + Math.floor(rng() * 20),
      needText: k.cov === 'global' ? `${Math.round(need * 100)}% global coverage` : k.cov === 'ocean' ? `${Math.round(need * 100)}% ocean coverage` : `licensed + ${Math.round(need * 100)}% coverage in ${REGION[region].name}`,
    };
  }

  function rivalTick(net, state, nw, rng, out) {
    const rv = net.rival;
    const since = state.day - net.founded;
    if (!rv.on) {
      if (since > 240 || (since > 120 && totalSubs(net) > 300000)) {
        rv.on = true; rv.sats = 120;
        pushEvent(net, state, `⚔️ Rival ${RIVAL} launched its own constellation. Expect price fights.`, out, true);
      }
      return;
    }
    rv.sats += 2 + Math.min(10, since / 200);
    rv.cov = scurve(rv.sats, 450) * 0.9;
    if (rng() < 1 / 120) {
      rv.price = Math.max(55, Math.round(rv.price * 0.88));
      pushEvent(net, state, `⚔️ ${RIVAL} cut its home price to $${rv.price}/month.`, out, true);
    } else if (rng() < 1 / 150) {
      rv.price = Math.min(120, Math.round(rv.price * 1.08));
    }
  }

  function randomEvents(net, state, nw, sv, rng, out) {
    if (!net.cohorts.length || rng() > 1 / 40) return;
    const roll = rng();
    const sats = orbitCount(net);
    if (roll < 0.18) {
      // Solar storm: hurts the newest (low) batch most.
      const c = net.cohorts[net.cohorts.length - 1];
      const fresh = state.day - c.day < 10;
      const lost = Math.max(1, Math.round(c.n * (fresh ? 0.1 + rng() * 0.25 : 0.01 + rng() * 0.02)));
      c.n = Math.max(0, c.n - lost); net.lostTotal += lost;
      pushEvent(net, state, `☀️ Solar storm! ${lost} sats ${fresh ? 'from the newest batch ' : ''}dragged down and lost.`, out, true);
    } else if (roll < 0.32) {
      const pend = REGIONS.filter((r) => !net.regions[r.id].lic && net.regions[r.id].licDone);
      if (pend.length) {
        const r = pend[Math.floor(rng() * pend.length)], x = net.regions[r.id];
        if (rng() < 0.6) { x.licDone = state.day; pushEvent(net, state, `📜 Regulator win! ${r.name} fast-tracked your license.`, out, true); }
        else { x.licDone += 30; pushEvent(net, state, `📜 ${r.name} regulators want more paperwork: license delayed 30 days.`, out, true); }
      }
    } else if (roll < 0.5) {
      if (sv.sat > 0.62) { net.awareness = Math.min(1, net.awareness + 0.12); pushEvent(net, state, '⭐ Viral review: a famous streamer loves Halo. Awareness up!', out, true); }
      else if (sv.sat < 0.45) { net.rep = Math.max(0, net.rep - 0.08); pushEvent(net, state, '👎 Viral complaint: slow speeds trending online. Reputation down.', out, true); }
    } else if (roll < 0.64) {
      if (net.support < 3) { net.outage = 5; pushEvent(net, state, '⚠️ Network outage! Customers are angry for a few days. Better support makes this rarer.', out, true); }
      else pushEvent(net, state, '🛠️ A software fault was fixed by your support team before customers noticed.', out, false);
    } else if (roll < 0.76) {
      if (sats > 20) { const c = net.cohorts[Math.floor(rng() * net.cohorts.length)]; c.n = Math.max(0, c.n - 1); net.lostTotal++; pushEvent(net, state, '☄️ A sat was hit by space debris and lost.', out, false); }
    } else if (roll < 0.88) {
      const live = REGIONS.filter((r) => net.regions[r.id].lic && sumSubs(net.regions[r.id].subs) > 1000);
      if (live.length) {
        const r = live[Math.floor(rng() * live.length)];
        const grant = Math.round(Math.min(30, 0.5 + sumSubs(net.regions[r.id].subs) * 0.000004) * 10) / 10;
        state.cash += grant; net.cashToDate += grant;
        pushEvent(net, state, `🏛️ ${r.name} rural broadband grant: +${fmtM(grant)}.`, out, true);
      }
    } else if (net.rival.on) {
      net.rival.sats += 150;
      pushEvent(net, state, `⚔️ ${RIVAL} launched 150 more sats.`, out, false);
    }
  }

  function closeMonth(net, state, nw, out) {
    const m = net.month;
    const profit = m.rev - m.cost;
    net.last = { rev: m.rev, cost: m.cost, capex: m.capex, subsidy: m.subsidy, profit };
    net.profitMonth = profit;
    net.history.push({ day: state.day, subs: Math.round(totalSubs(net)), profit: r1(profit), revenue: r1(m.rev), cost: r1(m.cost), capex: r1(m.capex), sats: Math.round(orbitCount(net)), coverage: Math.round(nw.coverage * 1000) / 1000 });
    if (net.history.length > 60) net.history = net.history.slice(-60);
    net.month = { rev: 0, cost: 0, capex: 0, subsidy: 0, start: state.day };
    if (profit > 0 && !net.goals.profit1) net.goals.profit1pending = true;
    pushEvent(net, state, `📊 Halo month closed: revenue ${fmtM(m.rev)}, costs ${fmtM(m.cost)}, ${profit >= 0 ? 'profit' : 'loss'} ${fmtM(profit)}.`, out, false);
  }
  const r1 = (v) => Math.round(v * 100) / 100;

  function checkGoals(state, out) {
    const net = state.net;
    let s = null;
    for (const g of GOALS) {
      if (net.goals[g.id]) continue;
      if (g.id === 'profit1') {
        if (!net.goals.profit1pending) continue;
      } else {
        s = s || quick(state);
        if (g.val(net, s) < g.goal) continue;
      }
      net.goals[g.id] = state.day;
      if (g.reward) { state.cash += g.reward; }
      pushEvent(net, state, `🏆 Halo goal: ${g.name}${g.reward ? ` (+${fmtM(g.reward)} bonus)` : ''}!`, out, true);
    }
  }
  function quick(state) {
    const net = state.net, nw = network(state);
    return { subs: totalSubs(net), sats: { orbit: orbitCount(net) }, coverage: nw.coverage, revenueYear: revenueYear(net) };
  }
  function revenueYear(net) { return net.history.slice(-12).reduce((s, h) => s + (h.revenue || 0), 0); }

  // ---------- Valuation / IPO ----------
  function valuation(net) {
    const h = net.history;
    const revM = net.last.rev || 0;
    const prev = h.length > 3 ? h[h.length - 4].subs : 0;
    const now = totalSubs(net);
    const growth = prev > 0 ? clamp((now - prev) / prev / 3, 0, 0.5) : (now > 0 ? 0.3 : 0);
    const mult = clamp(3 + growth * 25, 3, 10);
    return Math.max(0, revM * 12 * mult + orbitCount(net) * 0.15);
  }
  function ipoCheck(net) {
    if (net.ipo) return { ok: false, why: 'Halo is already public.' };
    const subs = totalSubs(net);
    if (subs < 250000) return { ok: false, why: `Needs 250k subscribers (now ${fmtN(subs)}).` };
    if (!(net.last.profit > 0)) return { ok: false, why: 'Needs a profitable last month.' };
    return { ok: true, why: '' };
  }

  // Research also costs science (late-game science sink).
  for (const u of UPGRADES) u.sci = Math.round((u.cost || 0) * 3);
  for (const x of DISHES.concat(ROUTERS)) x.sci = Math.round((x.cost || 0) * 5);
  function paySci(state, n, ok) { if (!ok || !n) return; state.rp = Math.max(0, (state.rp || 0) - n); }
  // ---------- Public API ----------
  function canFound(state) {
    ensure(state);
    if (state.net) return { ok: false, why: 'Halo is already running.' };
    if (!state.milestones || !state.milestones.firstOrbit) return { ok: false, why: 'Reach orbit first, then you can start Halo.' };
    if (state.cash < FOUND_COST) return { ok: false, why: `Founding Halo costs ${fmtM(FOUND_COST)}.` };
    return { ok: true, why: '' };
  }
  function found(state) {
    const c = canFound(state);
    if (!c.ok) return { ok: false, msg: c.why };
    state.cash -= FOUND_COST;
    state.net = newNet(state);
    state.net.events.unshift({ day: state.day, text: '🛰️ Halo founded! North America license included. Build sats, add a ground station, launch.' });
    return { ok: true, msg: `Halo founded for ${fmtM(FOUND_COST)}. Next: order sats and build a ground station in North America.`, cost: FOUND_COST };
  }

  function spend(state, cost, capex) {
    state.cash -= cost;
    state.net.month.capex += capex ? cost : 0;
    state.net.cashToDate -= cost;
  }

  function act(state, action, args) {
    ensure(state);
    const net = state.net;
    args = args || {};
    if (action === 'found') return found(state);
    if (!net) return { ok: false, msg: 'Found Halo first.', cost: 0 };
    const fail = (msg) => ({ ok: false, msg, cost: 0 });
    const pay = (cost, msg) => { if (state.cash < cost) return fail(`Not enough cash: needs ${fmtM(cost)}.`); spend(state, cost, true); return { ok: true, msg, cost }; };
    switch (action) {
      case 'buildSats': {
        const n = Math.floor(num(args.n, 0));
        if (n < 1) return fail('Pick how many sats to build.');
        const gen = GENS[args.gen] && (!GENS[args.gen].research || has(net, GENS[args.gen].research)) ? args.gen : net.gen;
        const cost = r1(n * satCost(net, gen));
        const r = pay(cost, `Ordered ${n} ${GENS[gen].name} sats for ${fmtM(cost)}. The factory makes ${factoryRate(state)} a day.`);
        if (r.ok) { const last = net.queue[net.queue.length - 1]; if (last && last.gen === gen) last.n += n; else net.queue.push({ gen, n }); }
        return r;
      }
      case 'gen': {
        const g = GENS[args.gen];
        if (!g || (g.research && !has(net, g.research))) return fail('Research that generation first.');
        net.gen = g.id; return { ok: true, msg: `New orders use ${g.name}.`, cost: 0 };
      }
      case 'factoryUp': {
        if (net.factory >= FACTORY_MAX) return fail('Sat factory is at max level.');
        const cost = FACTORY_COST[net.factory];
        const r = pay(cost, `Sat factory upgraded to level ${net.factory + 1}: ${FACTORY_RATE[net.factory + 1]} sats a day, sats 5% cheaper.`);
        if (r.ok) net.factory++;
        return r;
      }
      case 'research': {
        const u = UPG[args.id];
        if (!u) return fail('Unknown research.');
        if (has(net, u.id)) return fail('Already researched.');
        if (net.lab) return fail(`The lab is busy with ${UPG[net.lab.id].name}.`);
        const miss = u.req.filter((q) => !has(net, q));
        if (miss.length) return fail(`Needs ${miss.map((q) => UPG[q].name).join(', ')} first.`);
        if ((state.rp || 0) < u.sci) return fail(`Needs ${u.sci} science.`);
        const r = pay(u.cost, `Researching ${u.name}: ready in ${u.days} days.`);
        paySci(state, u.sci, r.ok);
        if (r.ok) net.lab = { id: u.id, done: state.day + u.days, start: state.day };
        return r;
      }
      case 'station': {
        const R = REGION[args.region];
        if (!R) return fail('Unknown region.');
        const x = net.regions[R.id];
        if (!x.lic && !x.licDone) return fail(`Apply for a license in ${R.name} first.`);
        if (x.stations + x.building.length >= 200) return fail('That region is full of gateways.');
        const r = pay(R.station, `Building a ground station in ${R.name}: online in ${STATION_DAYS} days.`);
        if (r.ok) x.building.push(state.day + STATION_DAYS);
        return r;
      }
      case 'license': {
        const R = REGION[args.region];
        if (!R) return fail('Unknown region.');
        const x = net.regions[R.id];
        if (x.lic) return fail('Already licensed.');
        if (x.licDone) return fail(`Already applied: decision in ${x.licDone - state.day} days.`);
        const r = pay(R.license, `Applied for a license in ${R.name}: about ${R.licDays} days.`);
        if (r.ok) { x.licDone = state.day + Math.max(1, R.licDays); }
        return r;
      }
      case 'price': {
        const t = TIERS[args.tier];
        if (!t) return fail('Unknown plan.');
        const p = net.prices[t.id];
        if (args.monthly !== undefined) p.monthly = clamp(Math.round(num(+args.monthly, p.monthly)), 1, t.price * 5);
        if (args.dish !== undefined) p.dish = clamp(Math.round(num(+args.dish, p.dish)), 0, t.kit * 4);
        return { ok: true, msg: `${t.name} plan: $${p.monthly}/month, dish $${p.dish}.`, cost: 0 };
      }
      case 'marketing': {
        net.marketing = clamp(r1(num(+args.perMonth, net.marketing)), 0, 500);
        return { ok: true, msg: `Marketing set to ${fmtM(net.marketing)} a month.`, cost: 0 };
      }
      case 'support': {
        net.support = clamp(Math.round(num(+args.level, net.support)), 0, 4);
        return { ok: true, msg: `Customer support: ${SUPPORT[net.support].name}.`, cost: 0 };
      }
      case 'researchHw': {
        const kind = args.kind === 'router' ? 'router' : args.kind === 'dish' ? 'dish' : null;
        if (!kind) return fail('Pick dish or router.');
        const list = kind === 'dish' ? DISHES : ROUTERS;
        const nx = list[net.hw[kind]];
        if (!nx) return fail(`Best ${kind} already designed.`);
        if (net.hwLab) return fail('The hardware lab is busy.');
        if ((state.rp || 0) < nx.sci) return fail(`Needs ${nx.sci} science.`);
        const r = pay(nx.cost, `Designing ${nx.name}: ready in ${nx.days} days.`);
        paySci(state, nx.sci, r.ok);
        if (r.ok) net.hwLab = { kind, level: nx.level, done: state.day + nx.days, start: state.day };
        return r;
      }
      case 'upgradeSats': {
        const u = args.id ? SAT_UPGRADES.find((x) => x.id === args.id) : SAT_UPGRADES.find((x) => !net.satUp[x.id] && (!x.req || has(net, x.req)));
        if (!u) return fail('No sat upgrade available right now.');
        if (net.satUp[u.id]) return fail('Already done.');
        if (u.req && !has(net, u.req)) return fail(`Needs ${UPG[u.req].name} first.`);
        if (net.satLab) return fail('A sat upgrade is already rolling out.');
        const cost = r1(u.cost + u.perSat * orbitCount(net));
        const r = pay(cost, `Rolling out ${u.name} to the constellation: ${u.days} days.`);
        if (r.ok) net.satLab = { id: u.id, done: state.day + u.days, start: state.day };
        return r;
      }
      case 'autoReplace': {
        net.autoReplace = !!args.on; net.replaceDebt = 0;
        return { ok: true, msg: net.autoReplace ? `Auto-replace on: retired sats are re-ordered as ${GENS[net.gen].name}.` : 'Auto-replace off.', cost: 0 };
      }
      case 'acceptDeal': {
        const d = net.deals.find((x) => x.id === args.id);
        if (!d) return fail('That offer is gone.');
        const nw = network(state);
        if (!dealMet(net, nw, d)) return fail(`Needs ${d.needText}.`);
        net.deals = net.deals.filter((x) => x !== d);
        d.start = state.day; d.end = state.day + d.months * 30; d.running = true;
        net.active.push(d);
        state.cash += d.upfront; net.cashToDate += d.upfront; net.month.rev += d.upfront;
        return { ok: true, msg: `Signed ${d.name}: +${fmtM(d.upfront)} now and ${fmtM(d.monthly)}/month for ${d.months} months.`, cost: -d.upfront };
      }
      case 'declineDeal': {
        net.deals = net.deals.filter((x) => x.id !== args.id);
        return { ok: true, msg: 'Offer declined.', cost: 0 };
      }
      case 'ipo': {
        const c = ipoCheck(net);
        if (!c.ok) return fail(c.why);
        const val = valuation(net), share = IPO_SHARE, raise = r1(val * share);
        net.ipo = { day: state.day, valuation: r1(val), share, raised: raise };
        net.own = 1 - share;
        state.cash += raise;
        net.goals.ipo = state.day;
        pushEvent(net, state, `🔔 Halo IPO! Sold ${Math.round(IPO_SHARE * 100)}% at a ${fmtM(val)} valuation and raised ${fmtM(raise)}.`, { events: [], toasts: [] }, false);
        return { ok: true, msg: `IPO done: raised ${fmtM(raise)} (Halo valued at ${fmtM(val)}). You keep ${Math.round((1 - IPO_SHARE) * 100)}% of Halo profit.`, cost: -raise };
      }
      default: return fail('Unknown action.');
    }
  }

  // Sats per launch: largest whole number that fits the payload, newest generation first.
  function takeSats(net, n) {
    const take = {}; let left = n, mass = 0, count = 0;
    for (const g of GEN_ORDER.slice().reverse()) {
      const k = Math.min(left, Math.floor(net.ready[g] || 0));
      if (k > 0) { take[g] = k; left -= k; mass += k * GENS[g].mass; count += k; }
    }
    return { take, mass, count };
  }
  function batchContract(state, n) {
    ensure(state);
    const net = state.net;
    if (!net) return null;
    n = Math.min(Math.floor(num(n, 0)), Math.floor(readyCount(net)));
    if (n < 1) return null;
    const t = takeSats(net, n);
    return {
      id: 'halo-' + state.day + '-' + Math.floor(Math.random() * 1e6).toString(36), kind: 'halo', label: 'Halo batch',
      client: 'Halo (your network)', target: 'LEO', mass: Math.round(t.mass * 100) / 100, reward: 0, rep: 2,
      expires: state.day + 9999, count: t.count, sats: t.take,
    };
  }
  // Most sats of the ready stock that fit in payload tons.
  function maxBatch(state, payloadT) {
    const net = state.net; if (!net) return 0;
    let left = num(payloadT, 0), n = 0;
    for (const g of GEN_ORDER.slice().reverse()) {
      const k = Math.min(Math.floor(net.ready[g] || 0), Math.floor(left / GENS[g].mass + 1e-9));
      n += k; left -= k * GENS[g].mass;
    }
    return n;
  }

  function onBatchResult(state, contract, ok) {
    ensure(state);
    const net = state.net;
    if (!net || !contract) return [];
    const want = contract.sats || takeSats(net, contract.count || 0).take;
    let n = 0;
    const got = {};
    for (const g of Object.keys(want)) {
      const k = Math.min(want[g], Math.floor(net.ready[g] || 0));
      if (k > 0) { net.ready[g] -= k; got[g] = k; n += k; }
    }
    const lines = [];
    if (ok) {
      for (const g of Object.keys(got)) net.cohorts.push({ gen: g, n: got[g], day: state.day });
      net.launched += n;
      const nw = network(state);
      lines.push(['🛰️ Halo sats deployed', `${n} into orbit`]);
      lines.push(['Constellation', `${fmtN(orbitCount(net))} sats · ${Math.round(nw.coverage * 100)}% global coverage`]);
      lines.push(['Usable capacity', `${fmtN(nw.capacity)} Gbps${nw.stationCap < nw.satCap ? ' (limited by ground stations)' : ''}`]);
      net.events.unshift({ day: state.day, text: `🚀 ${n} Halo sats reached orbit.` });
    } else {
      net.lostTotal += n;
      lines.push(['🛰️ Halo sats', `✖ ${n} lost with the rocket`]);
      net.events.unshift({ day: state.day, text: `💥 Launch failure: ${n} Halo sats lost.` });
    }
    net.events = net.events.slice(0, 30);
    return lines;
  }

  function hardwareInfo(state, net) {
    const d = dishOf(net), r = routerOf(net);
    const nd = DISHES[d.level] || null, nr = ROUTERS[r.level] || null;
    const sl = net.satLab ? SAT_UPGRADES.find((x) => x.id === net.satLab.id) : null;
    return {
      dish: d, router: r, nextDish: nd, nextRouter: nr,
      lab: net.hwLab ? { kind: net.hwLab.kind, level: net.hwLab.level, name: (net.hwLab.kind === 'dish' ? DISHES : ROUTERS)[net.hwLab.level - 1].name, daysLeft: Math.max(0, net.hwLab.done - state.day) } : null,
      kitCost: { home: Math.round(kitCost(net, 'home')), business: Math.round(kitCost(net, 'business')), maritime: Math.round(kitCost(net, 'maritime')), aviation: Math.round(kitCost(net, 'aviation')) },
      tiersOpen: TIER_IDS.filter((t) => tierOpen(net, t)),
      satUpgrades: SAT_UPGRADES.map((u) => ({ id: u.id, name: u.name, icon: u.icon, desc: u.desc, days: u.days, cap: u.cap, done: !!net.satUp[u.id], available: !net.satUp[u.id] && (!u.req || has(net, u.req)), needs: u.req ? UPG[u.req].name : null, cost: r1(u.cost + u.perSat * orbitCount(net)) })),
      satLab: sl ? { id: sl.id, name: sl.name, daysLeft: Math.max(0, net.satLab.done - state.day) } : null,
      capacityBoost: swCap(net), autoReplace: net.autoReplace,
    };
  }

  function offersDeals(state) { ensure(state); return state.net ? state.net.deals : []; }

  function summary(state) {
    ensure(state);
    const net = state.net;
    if (!net) return { founded: false, canFound: canFound(state), foundCost: FOUND_COST, subs: 0, coverage: 0, sats: { ready: 0, orbit: 0, aging: 0, lostTotal: 0 }, history: [], regions: [], events: [], nextGoals: [] };
    const nw = network(state);
    const used = usedGbps(net);
    const sv = satisfactionOf(net, nw, used);
    const anyStation = nw.stations > 0;
    const subsByTier = emptySubs();
    const regions = REGIONS.map((R) => {
      const x = net.regions[R.id];
      const why = canSell(net, nw, R.id, anyStation);
      let subs = 0, demand = 0;
      const tiers = {};
      for (const t of TIER_IDS) {
        subsByTier[t] += x.subs[t]; subs += x.subs[t];
        const d = why ? 0 : demandFor(net, nw, R.id, t, sv.sat);
        demand += d;
        tiers[t] = { subs: Math.round(x.subs[t]), demand: Math.round(d), price: Math.round(regionPrice(net, R.id, t)) };
      }
      return {
        id: R.id, name: R.name, icon: R.icon, lat: R.lat, lon: R.lon, income: R.income,
        coverage: nw.regCov[R.id], licensed: !!x.lic, licensePending: !x.lic && !!x.licDone, licenseDays: x.licDone ? Math.max(0, x.licDone - state.day) : 0,
        licenseCost: R.license, licenseTime: R.licDays, stationCost: R.station,
        stations: x.stations, stationsBuilding: x.building.length, subs: Math.round(subs), potential: Math.round(R.pop * 1e6 * 1.09),
        demand: Math.round(demand), waitlist: Math.round(x.wait), selling: !why, why, tiers,
      };
    });
    for (const t of TIER_IDS) subsByTier[t] = Math.round(subsByTier[t]);
    const subs = totalSubs(net);
    const d = net.day || { rev: 0, cost: 0 };
    const goals = GOALS.filter((g) => !net.goals[g.id]).slice(0, 3).map((g) => {
      const s = { subs, sats: { orbit: orbitCount(net) }, coverage: nw.coverage, revenueYear: revenueYear(net) };
      const v = g.val(net, s);
      return { id: g.id, name: g.name, icon: g.icon, reward: g.reward, progress: clamp(v / g.goal, 0, 1) };
    });
    const ipoC = ipoCheck(net);
    const val = valuation(net);
    const lab = net.lab ? { id: net.lab.id, name: UPG[net.lab.id].name, daysLeft: Math.max(0, net.lab.done - state.day), days: UPG[net.lab.id].days } : null;
    return {
      founded: true, foundedDay: net.founded, gen: net.gen, genInfo: GENS[net.gen], bestGen: bestGen(net),
      sats: { ready: Math.floor(readyCount(net)), readyByGen: Object.assign({}, net.ready), queued: net.queue.reduce((s, q) => s + q.n, 0), orbit: Math.round(orbitCount(net)), aging: Math.round(nw.aging), lostTotal: Math.round(net.lostTotal), deorbited: Math.round(net.deorbited), launched: net.launched,
        byGen: GEN_ORDER.map((g) => ({ gen: g, n: Math.round(net.cohorts.filter((c) => c.gen === g).reduce((s, c) => s + c.n, 0)) })).filter((x) => x.n > 0) },
      factory: { level: net.factory, max: FACTORY_MAX, rate: factoryRate(state), nextCost: net.factory < FACTORY_MAX ? FACTORY_COST[net.factory] : null, nextRate: net.factory < FACTORY_MAX ? FACTORY_RATE[net.factory + 1] : null, satCost: satCost(net, net.gen), queue: net.queue.map((q) => ({ gen: q.gen, n: q.n })) },
      coverage: nw.coverage, oceanCoverage: nw.ocean, polar: nw.polar, lasers: nw.laser,
      regions,
      capacityGbps: nw.capacity, satCapacityGbps: nw.satCap, stationCapacityGbps: nw.stationCap, stationsTotal: nw.stations, usedGbps: used,
      speedMbps: sv.speed, satisfaction: sv.sat, reputation: net.rep, awareness: net.awareness, outage: net.outage > 0,
      subs: Math.round(subs), subsByTier, waitlist: regions.reduce((s, r) => s + r.waitlist, 0),
      revenueDay: d.rev, costDay: d.cost, subsidyDay: d.subsidy || 0, profitDay: (d.rev || 0) - (d.cost || 0),
      profitMonth: net.history.length > 1 ? net.profitMonth : ((d.rev || 0) - (d.cost || 0)) * 30,
      lastMonth: net.last, monthSoFar: Object.assign({}, net.month), revenueYear: revenueYear(net),
      cashToDate: net.cashToDate, valuation: val, ownership: net.own,
      ipo: net.ipo, ipoCheck: ipoC, ipoRaise: ipoC.ok ? r1(val * IPO_SHARE) : 0, ipoShare: IPO_SHARE,
      prices: JSON.parse(JSON.stringify(net.prices)), marketing: net.marketing, support: net.support, supportInfo: SUPPORT[net.support],
      research: Object.assign({}, net.research), lab,
      deals: net.deals.map((x) => Object.assign({ canAccept: dealMet(net, nw, x), daysLeft: x.expires - state.day }, x)),
      activeDeals: net.active.map((x) => Object.assign({ daysLeft: x.end - state.day }, x)),
      hardware: hardwareInfo(state, net),
      rival: { name: RIVAL, active: net.rival.on, sats: Math.round(net.rival.sats), coverage: net.rival.cov, price: net.rival.price },
      history: net.history.slice(-60),
      nextGoals: goals, goalsDone: Object.assign({}, net.goals),
      events: net.events.slice(0, 12).map((e) => e.text), eventLog: net.events.slice(0, 30),
    };
  }

  root.APOGEE_NET = {
    DISHES, ROUTERS, SAT_UPGRADES,
    GENS, GEN_ORDER, REGIONS, TIERS, TIER_IDS, UPGRADES, RESEARCH: UPGRADES, SUPPORT, GOALS, FACTORY_RATE, FACTORY_COST, FACTORY_MAX,
    FOUND_COST, STATION_GBPS, STATION_DAYS, RIVAL,
    ensure, canFound, found, act, summary, tick, batchContract, onBatchResult, offersDeals, maxBatch,
    satMass: (state) => GENS[(state.net && state.net.gen) || 'v1'].mass,
    _network: network,
  };
})(typeof window !== 'undefined' ? window : globalThis);
