// APOGEE campus: land plots and buildings across several sites (window.APOGEE_CAMPUS).
// Logic (ensure/tick/bonus) is DOM-free. render(el, G) draws the full Base screen; the map view lives in campus-view.js.
(function (root) {
  'use strict';

  // ---------- Terrain ----------
  // S sea, L river/lake, B beach, c scrub, g grass, t woods, d desert sand, r rock, w wetland, R road, C city block
  const TER = {
    S: { name: 'Ocean', water: true, why: 'Open water' },
    L: { name: 'River', water: true, why: 'River water' },
    B: { name: 'Beach', buy: true, mult: 1.35 },
    c: { name: 'Scrubland', buy: true, mult: 1 },
    g: { name: 'Grassland', buy: true, mult: 1.1 },
    t: { name: 'Woods', buy: true, mult: 0.9 },
    d: { name: 'Desert', buy: true, mult: 1 },
    r: { name: 'Rock outcrop', why: 'Solid rock: not for sale' },
    w: { name: 'Protected wetland', why: 'Protected wetland: not for sale, nothing can be built' },
    R: { name: 'Public road', road: true, why: 'Public road: gives road access to plots next to it' },
    C: { name: 'City block', why: 'Part of the city: not for sale' },
  };

  const REGION_NAMES = { namerica: 'North America', samerica: 'South America', europe: 'Europe', africa: 'Africa', mideast: 'Middle East', sasia: 'South Asia', easia: 'East Asia', oceania: 'Oceania' };

  const has = (st, k) => !!(st.milestones && st.milestones[k]);
  const netOn = (st) => !!(st.net && st.net.founded !== false);
  const SITES = [
    { id: 'cape', name: 'Cape Halcyon', icon: '🌴', sub: 'Coastal launch site', region: 'namerica', base: 0.35, permit: 0,
      desc: 'Your home base on a sunny barrier island. Ocean to the east for safe launches and barge landings.',
      unlock: () => ({ ok: true }),
      map: ['RcctcwwcBSS', 'RccccwccBSS', 'RctcccccBSS', 'RRRRRRRRBSS', 'RcccccccBSS', 'RcwccccccBS', 'RcwwcccccBS', 'RcccccccBSS', 'RctccccccBS'] },
    { id: 'mesa', name: 'Dry Mesa Range', icon: '🏜️', sub: 'Desert engine test site', region: 'namerica', base: 0.06, permit: 2,
      desc: 'Cheap, empty desert. Perfect for loud engine tests and big solar farms (test stands +25%, solar +50% here).',
      unlock: (st) => ({ ok: has(st, 'firstOrbit') || st.rep >= 8, need: 'Reach orbit once' }),
      map: ['Rddddrrddd', 'Rdddddrddd', 'Rddddddddr', 'RRRRRdddrr', 'Rddddddddd', 'Rdrddddddd', 'Rdrrdddddr', 'Rddddddddr', 'Rdddrrdddd', 'Rddddddddd'] },
    { id: 'solano', name: 'Port Solano', icon: '🌊', sub: 'Southern gulf coast', region: 'namerica', base: 0.16, permit: 5,
      desc: 'Wide, cheap tidal flats on the gulf. Room for giant pads, tank farms and a catch tower.',
      unlock: (st) => ({ ok: st.rep >= 20 || (st.stats && st.stats.successes >= 5), need: '20 reputation or 5 successful launches' }),
      map: ['cccwcccRcccc', 'ctcwwccRcctc', 'RRRRRRRRRRRR', 'ccccccccccwc', 'ccwcccccccww', 'cwwccccccccc', 'cccccccccccc', 'BBBBBBBBBBBB', 'SSSSSSSSSSSS'] },
    { id: 'works', name: 'Lakemont Works', icon: '🏙️', sub: 'Factory district by the city', region: 'namerica', base: 0.8, permit: 4,
      desc: 'Pricey land next to a big city. Housing +25% and visitor centers +25% here; satellite factories +10%.',
      unlock: (st) => ({ ok: (st.stats && st.stats.launches >= 4) && st.day >= 60, need: 'Fly 4 launches and reach day 60' }),
      map: ['CCCCCCCCCL', 'RRRRRRRRRL', 'ggcgggRgLL', 'ggggggRgLg', 'tgggggRLLg', 'ttggggRLgg', 'tgggggRLgg', 'ggggggRgLg'] },
    { id: 'corvo', name: 'Point Corvo', icon: '🧭', sub: 'West coast polar launch site', region: 'namerica', base: 0.45, permit: 8, polar: true,
      desc: 'Green cliffs above the western ocean: the only place you can launch south into polar orbits.',
      unlock: (st) => ({ ok: st.rep >= 40 || has(st, 'firstGTO'), need: '40 reputation or a satellite delivered to GTO' }),
      map: ['SSBggtggR', 'SBBgggggR', 'SSBggwggR', 'SSBggwwgR', 'SBBRRRRRR', 'SSBggggtR', 'SSBgggggR', 'SBBggtggR', 'SSBgggggR'] },
    { id: 'gw-fjord', name: 'Fjordvik Gateway', icon: '📡', sub: 'Ground-station land · Europe', region: 'europe', base: 0.14, permit: 1.5, gateway: true,
      desc: 'A windy northern headland. Ground stations here serve Europe.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['RggggS', 'RgtggS', 'RRRRgS', 'gggwgS', 'tgggBS', 'ggggBS'] },
    { id: 'gw-red', name: 'Red Plains Gateway', icon: '📡', sub: 'Ground-station land · Oceania', region: 'oceania', base: 0.05, permit: 1.5, gateway: true,
      desc: 'Red outback desert. Ground stations here serve Oceania.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['Rddddd', 'Rddrdd', 'RRRRRR', 'dddddd', 'ddrddd', 'dddddd'] },
    { id: 'gw-alti', name: 'Altiplano Gateway', icon: '📡', sub: 'Ground-station land · South America', region: 'samerica', base: 0.08, permit: 1.5, gateway: true,
      desc: 'High plateau with clear skies. Ground stations here serve South America.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['crcccR', 'ccccrR', 'ccwccR', 'RRRRRR', 'cccccc', 'ccrccc'] },
    { id: 'gw-sahel', name: 'Sahel Gateway', icon: '📡', sub: 'Ground-station land · Africa', region: 'africa', base: 0.05, permit: 1.5, gateway: true,
      desc: 'Dry savanna. Ground stations here serve Africa.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['Rdddtd', 'Rddddd', 'RRRRRR', 'dddtdd', 'dddddd', 'tddddd'] },
    { id: 'gw-kaido', name: 'Kaido Gateway', icon: '📡', sub: 'Ground-station land · East Asia', region: 'easia', base: 0.3, permit: 2.5, gateway: true,
      desc: 'Hillside by the sea. Ground stations here serve East Asia.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['tggRSS', 'gggRBS', 'tggRBS', 'gwgRBS', 'gggRBS', 'tggRSS'] },
    { id: 'gw-dune', name: 'Dunehaven Gateway', icon: '📡', sub: 'Ground-station land · Middle East', region: 'mideast', base: 0.12, permit: 2, gateway: true,
      desc: 'Coastal desert. Ground stations here serve the Middle East.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['Rddddd', 'RdrddB', 'RRRRRB', 'ddddBS', 'dddBSS', 'ddBSSS'] },
    { id: 'gw-monsoon', name: 'Monsoon Bay Gateway', icon: '📡', sub: 'Ground-station land · South Asia', region: 'sasia', base: 0.1, permit: 2, gateway: true,
      desc: 'Green delta country. Ground stations here serve South Asia.', unlock: (st) => ({ ok: netOn(st), need: 'Found Halo (Network tab)' }),
      map: ['RggtgS', 'RgwggS', 'RRRRBS', 'ggggBS', 'gtggBS', 'gggwBS'] },
  ];
  // Gateway sites were cramped (6x6): widen them to 10x10 by repeating their inland rows/columns.
  function growMap(map, W, H) {
    const m = map.map((row) => { let r = row; while (r.length < W) { const i = Math.max(1, r.length - 2); r = r.slice(0, i) + r[i - 1] + r.slice(i); } return r; });
    while (m.length < H) { const i = Math.max(1, m.length - 2); m.splice(i, 0, m[i - 1]); }
    return m;
  }
  for (const s of SITES) if (s.gateway) s.map = growMap(s.map, 10, 10);
  // Main sites get more room too: add land rows on the inland/south edge (existing plots and buildings keep their spots).
  const TALL = { cape: 14, mesa: 14, works: 13, corvo: 14 };
  for (const s of SITES) if (TALL[s.id]) { const n = s.map.length; while (s.map.length < TALL[s.id]) s.map.push(s.map[n - 2 + ((s.map.length - n) % 2)]); }
  const SITE = {};
  for (const s of SITES) { s.h = s.map.length; s.w = s.map[0].length; SITE[s.id] = s; }

  // ---------- Buildings ----------
  const PAD_DAYS = [12, 7, 4];
  const OFFICE_SEATS = [8, 18, 30];
  const LAB_RP = [1, 2.2, 4];
  const TEST_RP = [0.6, 1.2, 2];
  const SAT_DAY = [1, 3, 6];
  const CHIP_SELF = [0.35, 0.7, 1];
  const CHIP_INC = [0.8, 1.8, 3.2];
  const VIS_REP = [1, 2, 3], VIS_INC = [0.3, 0.7, 1.2];
  const BT = {
    road: { name: 'Road', icon: '🛣️', w: 1, h: 1, cost: [0.1], days: [0], up: [0.002],
      fx: () => 'Road access (+10%) for buildings next to it', info: 'Your own road. Lay a line of road tiles out from the public road: every building touching a connected road gets the +10% road bonus. Built instantly. A road that does not connect to the public road does nothing.' },
    pad: { name: 'Launch pad', icon: '🚀', w: 2, h: 2, cost: [6, 10, 18], days: [20, 15, 18], up: [0.08, 0.12, 0.18],
      fx: (l) => `Launch every ${PAD_DAYS[l - 1]} days`, info: 'Each pad adds launch capacity. A tank farm next door makes turnaround 20% faster. Visitor centers love being next to pads.' },
    factory: { name: 'Rocket factory', icon: '🏭', w: 3, h: 2, cost: [10, 18, 32], days: [30, 24, 30], up: [0.1, 0.16, 0.24],
      fx: (l) => `${l} build line${l > 1 ? 's' : ''}`, info: 'Each level adds a rocket build line. Road access, a tank farm and an office next door speed it up.' },
    office: { name: 'Engineering office', icon: '🏢', w: 2, h: 2, cost: [4, 8, 15], days: [14, 14, 18], up: [0.04, 0.07, 0.11],
      fx: (l) => `+${OFFICE_SEATS[l - 1]} engineer seats`, info: 'Desks for engineers. You cannot hire beyond your seats. Keep it away from test stands (noise −30%).' },
    housing: { name: 'Staff housing', icon: '🏘️', w: 2, h: 2, cost: [3, 5, 9], days: [10, 12, 14], up: [0.02, 0.03, 0.05],
      fx: (l) => `Hiring ${l * 8}% cheaper · +${l * 3} seats`, info: 'Homes near work make hiring cheaper (up to −50% total). +25% in the city district.' },
    lab: { name: 'Research lab', icon: '🔬', w: 2, h: 2, cost: [6, 11, 20], days: [18, 20, 24], up: [0.06, 0.1, 0.15],
      fx: (l) => `+${LAB_RP[l - 1]} science a day`, info: 'Scientists produce science every day. An office next door adds 15%.' },
    test: { name: 'Engine test stand', icon: '🔥', w: 2, h: 2, cost: [5, 9, 16], days: [16, 18, 22], up: [0.05, 0.08, 0.12],
      fx: (l) => `+${TEST_RP[l - 1]} science a day · engines mature ${l * 25}% faster`, info: 'Hot-fire engines on the ground. +25% in the desert. Very loud: offices and housing next to it lose 30%.' },
    mc: { name: 'Mission control', icon: '🖥️', w: 2, h: 2, cost: [8, 13, 22], days: [18, 18, 22], up: [0.1, 0.14, 0.2],
      fx: (l) => `+${l}% launch success · +${l * 0.5} rep a month`, info: 'Flight controllers watching every launch. Best counted once (max +5% total).' },
    tank: { name: 'Tank farm', icon: '🛢️', w: 2, h: 2, cost: [3, 5, 9], days: [10, 10, 12], up: [0.03, 0.04, 0.06],
      fx: (l) => `Boosts pads and factories next to it by ${[15, 22, 30][l - 1]}%`, info: 'Propellant storage. Put it next to pads and factories.' },
    lz: { name: 'Landing zone', icon: '🎯', w: 2, h: 2, cost: [4, 7, 12], days: [12, 12, 14], up: [0.03, 0.05, 0.07], tech: 'legs',
      fx: (l) => `Boosters can land back at base · +${l * 2}% landing odds`, info: 'A concrete target for boosters flying home (needed for "land back at the pad").' },
    port: { name: 'Drone ship port', icon: '🚢', w: 2, h: 1, cost: [12, 16, 24], days: [24, 18, 20], up: [0.2, 0.25, 0.32], tech: 'barge', coastal: true,
      fx: (l) => `Home of the ocean landing barge${l > 1 ? ` · +${(l - 1) * 3}% barge landings` : ''}`, info: 'Must touch the ocean. Lets you land boosters on the barge.' },
    tower: { name: 'Catch tower', icon: '🦾', w: 1, h: 1, cost: [30, 18, 28], days: [40, 20, 24], up: [0.3, 0.36, 0.44], tech: 'tower', nextToPad: true,
      fx: (l) => `Catches boosters with arms${l > 1 ? ` · +${(l - 1) * 3}% catch odds` : ''}`, info: 'Must stand right next to a launch pad.' },
    solar: { name: 'Solar farm', icon: '☀️', w: 2, h: 2, cost: [3, 5, 8], days: [8, 8, 10], up: [0.01, 0.01, 0.02],
      fx: (l) => `−${l * 5}% base upkeep`, info: 'Cuts the monthly bill for all buildings (max −40% total). +50% in the desert.' },
    visitor: { name: 'Visitor center', icon: '🎟️', w: 2, h: 1, cost: [4, 7, 12], days: [12, 12, 14], up: [0.02, 0.03, 0.05],
      fx: (l) => `+${VIS_REP[l - 1]} rep and +$${VIS_INC[l - 1]}M a month`, info: 'Tourists pay to watch. +50% next to a launch pad, +25% in the city.' },
    satfab: { name: 'Satellite factory', icon: '🛰️', w: 3, h: 2, cost: [15, 30, 55], days: [30, 30, 36], up: [0.3, 0.5, 0.8], net: true,
      fx: (l) => `Builds ${SAT_DAY[l - 1]} Halo sat${l > 1 ? 's' : ''} a day`, info: 'Clean rooms for Halo satellites. A rocket factory next door adds 15%.' },
    fab: { name: 'Chip fab', icon: '💾', w: 3, h: 2, cost: [25, 45, 80], days: [40, 35, 40], up: [0.4, 0.6, 0.9],
      fx: (l) => `Makes ${Math.round(CHIP_SELF[l - 1] * 100)}% of the chips you need · sells spare chips`, info: 'Your own semiconductor plant. During a chip shortage your satellites, cars and compute modules keep their normal cost and speed for the share of chips you make yourself. Spare wafers sell for income. Fabs add up (100% max).' },
    ground: { name: 'Ground station', icon: '📡', w: 1, h: 1, cost: [2, 3, 5], days: [8, 8, 10], up: [0.05, 0.07, 0.1], net: true,
      fx: (l) => `Halo gateway (${l} dish${l > 1 ? 'es' : ''})`, info: 'Connects Halo satellites to the internet. Serves the region of the site it stands on.' },
  };
  const ORDER = ['road', 'pad', 'factory', 'office', 'housing', 'lab', 'test', 'tank', 'mc', 'lz', 'port', 'tower', 'solar', 'visitor', 'satfab', 'ground'];

  // ---------- Helpers ----------
  const tile = (site, x, y) => (x < 0 || y < 0 || x >= site.w || y >= site.h ? null : site.map[y][x]);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function cs(st) { return st.campus; }
  function siteState(st, id) {
    const c = cs(st);
    if (!c.sites[id]) c.sites[id] = { open: false, owned: [] };
    return c.sites[id];
  }
  function isOwned(st, sid, x, y) { const s = cs(st).sites[sid]; return !!(s && s.owned.indexOf(y * SITE[sid].w + x) >= 0); }
  function roadNext(site, x, y) { return N4.some(([dx, dy]) => tile(site, x + dx, y + dy) === 'R'); }
  function at(st, sid, x, y) {
    for (const b of cs(st).b) if (b.site === sid && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
    return null;
  }
  function touches(a, b) { // rectangles share an edge (not overlapping)
    const ox = a.x < b.x + b.w && b.x < a.x + a.w, oy = a.y < b.y + b.h && b.y < a.y + a.h;
    return (ox && (a.y + a.h === b.y || b.y + b.h === a.y)) || (oy && (a.x + a.w === b.x || b.x + b.w === a.x));
  }
  // Player-built road tiles that link up (through other road tiles) to a public road.
  function roadNet(st, sid) {
    const site = SITE[sid], all = new Map(), ok = new Set(), q = [];
    for (const b of cs(st).b) if (b.type === 'road' && b.site === sid && b.lvl > 0) all.set(b.y * site.w + b.x, b);
    for (const [k, b] of all) if (roadNext(site, b.x, b.y)) { ok.add(k); q.push(b); }
    while (q.length) {
      const b = q.pop();
      for (const [dx, dy] of N4) {
        const x = b.x + dx, y = b.y + dy;
        if (x < 0 || y < 0 || x >= site.w || y >= site.h) continue;
        const k = y * site.w + x;
        if (all.has(k) && !ok.has(k)) { ok.add(k); q.push(all.get(k)); }
      }
    }
    return { ok, all };
  }
  function rectRoad(site, r, st) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (roadNext(site, x, y)) return true;
    if (!st) return false;
    const net = roadNet(st, site.id).ok;
    if (!net.size) return false;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      for (const [dx, dy] of N4) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= site.w || yy >= site.h) continue;
        if (xx >= r.x && xx < r.x + r.w && yy >= r.y && yy < r.y + r.h) continue;
        if (net.has(yy * site.w + xx)) return true;
      }
    }
    return false;
  }
  function rectSea(site, r) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (N4.some(([dx, dy]) => tile(site, x + dx, y + dy) === 'S')) return true;
    return false;
  }
  const r2 = (n) => Math.round(n * 100) / 100;

  function plotPrice(st, sid, x, y) {
    const site = SITE[sid], t = TER[tile(site, x, y)];
    if (!t || !t.buy) return null;
    const n = siteState(st, sid).owned.length;
    return r2(site.base * t.mult * (roadNext(site, x, y) ? 1.2 : 1) * Math.pow(1.03, n));
  }
  // Buying a property buys all of its land at once (with a 20% bulk discount).
  function buyablePlots(sid) {
    const site = SITE[sid], out = [];
    for (let y = 0; y < site.h; y++) for (let x = 0; x < site.w; x++) { const t = TER[tile(site, x, y)]; if (t && t.buy) out.push(y * site.w + x); }
    return out;
  }
  function landPrice(sid) {
    const site = SITE[sid];
    let sum = 0;
    for (const k of buyablePlots(sid)) { const x = k % site.w, y = Math.floor(k / site.w); sum += site.base * TER[tile(site, x, y)].mult * (roadNext(site, x, y) ? 1.2 : 1); }
    return r2(sum * 0.8);
  }
  function propertyPrice(sid) { return r2(SITE[sid].permit + landPrice(sid)); }
  function claimAll(st, sid) {
    const ss = siteState(st, sid), have = new Set(ss.owned);
    for (const k of buyablePlots(sid)) if (!have.has(k)) ss.owned.push(k);
  }
  function siteOpen(st, sid) { return !!(cs(st).sites[sid] && cs(st).sites[sid].open); }

  // ---------- State ----------
  function addB(st, type, sid, x, y, lvl, rot) {
    const t = BT[type], c = cs(st);
    const w = rot ? t.h : t.w, h = rot ? t.w : t.h;
    const b = { id: 'b' + (c.nid++), type, site: sid, x, y, w, h, lvl, days: 0, total: 0, spent: 0 };
    for (let i = 0; i < lvl; i++) b.spent += t.cost[i];
    c.b.push(b);
    const ss = siteState(st, sid);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const k = yy * SITE[sid].w + xx; if (ss.owned.indexOf(k) < 0) ss.owned.push(k); }
    return b;
  }
  function ensure(st) {
    if (!st) return null;
    if (st.campus && st.campus.v === 1) {
      for (const s of SITES) siteState(st, s.id);
      if (!st.campus.whole) {
        // Older saves bought land plot by plot (and gateway maps were smaller): own every plot of each open site now.
        for (const s of SITES) { const ss = siteState(st, s.id); if (s.gateway) ss.owned = []; if (ss.open) claimAll(st, s.id); }
        st.campus.whole = 1;
      }
      if (!st.campus.big) {
        // Sites grew: open sites get their new land for free.
        for (const s of SITES) { const ss = siteState(st, s.id); if (ss.open) claimAll(st, s.id); }
        st.campus.big = 1;
      }
      return st.campus;
    }
    st.campus = { v: 1, sites: {}, b: [], nid: 1, view: 'cape', told: {} };
    const cape = siteState(st, 'cape');
    cape.open = true;
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 8; x++) cape.owned.push(y * SITE.cape.w + x);
    for (const s of SITES) siteState(st, s.id);
    // Migrate what the old Base screen had into pre-placed buildings.
    const f = Math.max(1, Math.min(6, st.factory || 1));
    addB(st, 'pad', 'cape', 7, 4, 1);
    addB(st, 'factory', 'cape', 4, 4, Math.min(3, f));
    if (f > 3) addB(st, 'factory', 'cape', 4, 7, f - 3);
    if (st.owned && st.owned.barge) addB(st, 'port', 'cape', 7, 7, 1);
    if (st.owned && st.owned.tower) addB(st, 'tower', 'cape', 7, 6, 1);
    if (st.techs && st.techs.legs) addB(st, 'lz', 'cape', 1, 1, 1);
    st.campus.told.cape = 1;
    claimAll(st, 'cape');
    st.campus.whole = 1; st.campus.big = 1;
    return st.campus;
  }

  // ---------- Efficiency (adjacency) ----------
  function eff(st, b) {
    const site = SITE[b.site];
    const notes = [];
    let m = 1;
    const add = (v, text) => { m += v; notes.push({ good: v >= 0, text: `${text} ${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%` }); };
    const nb = cs(st).b.filter((o) => o !== b && o.site === b.site && o.lvl > 0 && touches(b, o));
    const near = (type) => nb.filter((o) => o.type === type);
    if (!['solar', 'ground', 'tower', 'tank', 'road'].includes(b.type)) {
      if (rectRoad(site, b, st)) add(0.1, 'Road access'); else notes.push({ good: false, text: 'No road access (+10% if next to a road)' });
    }
    const tankL = Math.max(0, ...near('tank').map((o) => o.lvl));
    const tankV = tankL ? [0.15, 0.22, 0.3][tankL - 1] : 0;
    switch (b.type) {
      case 'factory':
        if (tankV) add(tankV, 'Tank farm next door');
        if (near('office').length) add(0.1, 'Office next door');
        break;
      case 'pad': if (tankV) add(0.2, 'Tank farm next door (faster turnaround)'); break;
      case 'lab': if (near('office').length) add(0.15, 'Office next door'); break;
      case 'office': if (near('lab').length) add(0.1, 'Lab next door'); if (near('test').length) add(-0.3, 'Noisy test stand next door'); break;
      case 'housing': if (b.site === 'works') add(0.25, 'City district'); if (near('test').length) add(-0.3, 'Noisy test stand next door'); if (near('pad').length) add(-0.2, 'Rockets next door'); break;
      case 'visitor': if (near('pad').length) add(0.5, 'View of a launch pad'); if (b.site === 'works') add(0.25, 'City district'); break;
      case 'solar': if (b.site === 'mesa' || /^gw-(red|sahel|dune)/.test(b.site)) add(0.5, 'Desert sun'); break;
      case 'test': if (b.site === 'mesa') add(0.25, 'Desert range'); break;
      case 'mc': if (near('pad').length) add(0.1, 'Next to a pad'); break;
      case 'satfab': if (near('factory').length) add(0.15, 'Rocket factory next door'); if (b.site === 'works') add(0.1, 'City district'); break;
      default: break;
    }
    return { mult: Math.max(0.3, m), notes };
  }

  // ---------- Bonus ----------
  function bonus(st) {
    ensure(st);
    const o = { factoryLines: 0, buildSpeed: 1, engineerCap: 8, rpPerDay: 0, heritageMult: 1, satFactory: 0, groundStations: 0, groundStationsByRegion: {},
      pads: 0, padDays: [], launchEveryDays: 0, polarPad: false, landingZone: false, bargePort: false, catchTower: false, launchBonus: 0, landingBonus: 0,
      hireMult: 1, chipSelf: 0, upkeepMonth: 0, repPerMonth: 0, incomeMonth: 0, solarCut: 0, landValue: 0, buildingValue: 0, buildings: 0, building: 0, plots: 0 };
    let up = 0, fSpeed = 0, fN = 0, padRate = 0;
    for (const b of cs(st).b) {
      o.buildingValue += b.spent;
      const L = b.lvl;
      if (L <= 0) { o.building++; continue; }
      o.buildings++;
      if (b.days > 0) o.building++;
      const t = BT[b.type];
      up += t.up[L - 1];
      const e = eff(st, b).mult;
      switch (b.type) {
        case 'factory': o.factoryLines += L; fSpeed += e * L; fN += L; break;
        case 'pad': {
          const d = Math.max(2, Math.round(PAD_DAYS[L - 1] / (e >= 1.2 ? 1.2 : 1)));
          o.pads++; o.padDays.push(d); padRate += 1 / d;
          if (SITE[b.site].polar) o.polarPad = true;
          break;
        }
        case 'office': o.engineerCap += Math.floor(OFFICE_SEATS[L - 1] * Math.min(1.2, e)); break;
        case 'housing': o.engineerCap += L * 3; o.hireMult *= 1 - 0.08 * L * e; break;
        case 'lab': o.rpPerDay += LAB_RP[L - 1] * e; break;
        case 'test': o.rpPerDay += TEST_RP[L - 1] * e; o.heritageMult += 0.25 * L * e; break;
        case 'mc': o.launchBonus += 0.01 * L; o.repPerMonth += 0.5 * L * e; break;
        case 'lz': o.landingZone = true; o.landingBonus = Math.max(o.landingBonus, 0.02 * L); break;
        case 'port': o.bargePort = true; break;
        case 'tower': o.catchTower = true; break;
        case 'solar': o.solarCut += 0.05 * L * e; break;
        case 'visitor': o.repPerMonth += VIS_REP[L - 1] * e; o.incomeMonth += VIS_INC[L - 1] * e; break;
        case 'satfab': o.satFactory += SAT_DAY[L - 1] * e; break;
        case 'fab': o.chipSelf += CHIP_SELF[L - 1] * Math.min(1.2, e); o.incomeMonth += CHIP_INC[L - 1] * e; break;
        case 'ground': {
          o.groundStations += L;
          const rg = SITE[b.site].region;
          o.groundStationsByRegion[rg] = (o.groundStationsByRegion[rg] || 0) + L;
          break;
        }
        default: break;
      }
    }
    for (const s of SITES) {
      const ss = cs(st).sites[s.id];
      if (!ss) continue;
      o.plots += ss.owned.length;
      for (const k of ss.owned) { const t = TER[s.map[Math.floor(k / s.w)][k % s.w]]; if (t && t.mult) o.landValue += s.base * t.mult; }
    }
    o.solarCut = Math.min(0.4, o.solarCut);
    o.upkeepMonth = r2(up * (1 - o.solarCut));
    o.launchBonus = Math.min(0.05, o.launchBonus);
    o.hireMult = Math.max(0.5, o.hireMult);
    o.buildSpeed = fN ? fSpeed / fN : 1;
    o.launchEveryDays = padRate ? r2(1 / padRate) : 0;
    o.rpPerDay = r2(o.rpPerDay);
    o.satFactory = r2(o.satFactory);
    o.chipSelf = Math.min(1, r2(o.chipSelf));
    o.repPerMonth = r2(o.repPerMonth);
    o.incomeMonth = r2(o.incomeMonth);
    o.landValue = r2(o.landValue);
    o.buildingValue = r2(o.buildingValue);
    return o;
  }

  // ---------- Placement ----------
  function lockedWhy(st, type) {
    const t = BT[type];
    const S = root.APOGEE_SIM;
    if (t.tech && !(st.techs && st.techs[t.tech])) return `Research ${S && S.TECHS[t.tech] ? S.TECHS[t.tech].name : t.tech} first`;
    if (t.net && !netOn(st)) return 'Found Halo on the Network tab first';
    return '';
  }
  function check(st, sid, type, x, y, rot) {
    const t = BT[type], site = SITE[sid];
    const w = rot ? t.h : t.w, h = rot ? t.w : t.h;
    const r = { x, y, w, h };
    const tiles = [];
    let why = '';
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const c = tile(site, xx, yy);
      let ok = true, msg = '';
      if (c == null) { ok = false; msg = 'Off the edge of the map'; }
      else if (!TER[c].buy) { ok = false; msg = TER[c].why || 'Cannot build here'; }
      else if (!isOwned(st, sid, xx, yy)) { ok = false; msg = 'You do not own this plot yet (buy it first)'; }
      else if (at(st, sid, xx, yy)) { ok = false; msg = 'Something is already built here'; }
      tiles.push({ x: xx, y: yy, ok });
      if (!ok && !why) why = msg;
    }
    if (!why && t.coastal && !rectSea(site, r)) why = 'Must touch the ocean';
    if (!why && t.nextToPad && !cs(st).b.some((o) => o.site === sid && o.type === 'pad' && touches(r, o))) why = 'Must stand right next to a launch pad';
    if (!why) why = lockedWhy(st, type);
    const cost = t.cost[0];
    if (!why && st.cash < cost) why = `Not enough cash (need ${cost.toFixed(1)}M)`;
    return { ok: !why, why, tiles, x, y, w, h, cost };
  }

  function act(st, a, p) {
    ensure(st);
    const c = cs(st);
    if (a === 'open') {
      const s = SITE[p.site], ss = siteState(st, p.site);
      if (ss.open) return { ok: false, msg: 'Already open' };
      const u = s.unlock(st);
      if (!u.ok) return { ok: false, msg: `Locked: ${u.need}` };
      const price = propertyPrice(p.site);
      if (st.cash < price) return { ok: false, msg: 'Not enough cash to buy this property' };
      st.cash -= price; ss.open = true; claimAll(st, p.site);
      return { ok: true, msg: `Bought <b>${s.name}</b>: ${ss.owned.length} plots of land plus permits for $${price.toFixed(1)}M. Start building!`, cost: price };
    }
    if (a === 'buy') {
      const { site: sid, x, y } = p, ss = siteState(st, sid);
      if (!ss.open) return { ok: false, msg: 'This site is not open yet' };
      if (isOwned(st, sid, x, y)) return { ok: false, msg: 'You already own this plot' };
      const price = plotPrice(st, sid, x, y);
      if (price == null) return { ok: false, msg: TER[tile(SITE[sid], x, y)].why || 'Not for sale' };
      if (st.cash < price) return { ok: false, msg: 'Not enough cash' };
      st.cash -= price; ss.owned.push(y * SITE[sid].w + x);
      return { ok: true, msg: `Bought a ${TER[tile(SITE[sid], x, y)].name.toLowerCase()} plot at ${SITE[sid].name}`, cost: price };
    }
    if (a === 'place') {
      const ck = check(st, p.site, p.type, p.x, p.y, p.rot);
      if (!ck.ok) return { ok: false, msg: ck.why };
      const t = BT[p.type];
      st.cash -= ck.cost;
      const b = addB(st, p.type, p.site, p.x, p.y, 0, p.rot);
      if (!t.days[0]) { b.lvl = 1; b.spent = ck.cost; return { ok: true, msg: `Built a <b>${t.name}</b> tile`, cost: ck.cost, id: b.id, quick: true }; }
      b.days = b.total = t.days[0]; b.to = 1; b.spent = ck.cost;
      return { ok: true, msg: `Started building a <b>${t.name}</b> (${t.days[0]} days)`, cost: ck.cost, id: b.id };
    }
    const b = c.b.find((o) => o.id === p.id);
    if (!b) return { ok: false, msg: 'No such building' };
    const t = BT[b.type];
    if (a === 'upgrade') {
      if (b.days > 0) return { ok: false, msg: 'Busy with construction' };
      if (b.lvl >= t.cost.length) return { ok: false, msg: 'Already at max level' };
      const cost = t.cost[b.lvl];
      if (st.cash < cost) return { ok: false, msg: 'Not enough cash' };
      st.cash -= cost; b.spent += cost; b.to = b.lvl + 1; b.days = b.total = t.days[b.lvl];
      return { ok: true, msg: `Upgrading <b>${t.name}</b> to level ${b.to} (${b.days} days)`, cost };
    }
    if (a === 'demolish') {
      const same = c.b.filter((o) => o.type === b.type && o.lvl > 0);
      if ((b.type === 'pad' || b.type === 'factory') && b.lvl > 0 && same.length <= 1) return { ok: false, msg: `You need at least one ${t.name.toLowerCase()}` };
      if (b.type === 'pad' && c.b.some((o) => o.type === 'tower' && o.site === b.site && touches(o, b))) return { ok: false, msg: 'Remove the catch tower next to it first' };
      const refund = r2(b.spent * (b.lvl > 0 ? 0.3 : 0.6));
      st.cash += refund;
      c.b.splice(c.b.indexOf(b), 1);
      return { ok: true, msg: `Demolished the ${t.name.toLowerCase()} (got back ${refund.toFixed(1)}M)`, cost: -refund };
    }
    return { ok: false, msg: 'Unknown action' };
  }

  // ---------- Daily tick ----------
  function tick(st) {
    ensure(st);
    const c = cs(st), events = [], toasts = [];
    for (const b of c.b) {
      if (b.days <= 0) continue;
      b.days--;
      if (b.days <= 0) {
        b.days = 0; b.lvl = b.to || b.lvl + 1; delete b.to;
        const t = BT[b.type];
        events.push(b.lvl === 1 ? `Finished building the <b>${t.name}</b> at ${SITE[b.site].name}.` : `<b>${t.name}</b> upgraded to level ${b.lvl}.`);
        toasts.push(`${t.icon} ${t.name} ${b.lvl === 1 ? 'is open' : `is now level ${b.lvl}`}`);
      }
    }
    const bo = bonus(st);
    if (bo.rpPerDay) st.rp += bo.rpPerDay;
    if (st.day % 30 === 0) {
      const net = bo.incomeMonth - bo.upkeepMonth;
      st.cash += net;
      st.rep = (st.rep || 0) + bo.repPerMonth;
      if (bo.upkeepMonth || bo.incomeMonth) events.push(`Base: upkeep <b>${bo.upkeepMonth.toFixed(2)}M</b>${bo.incomeMonth ? `, visitors paid <b>${bo.incomeMonth.toFixed(2)}M</b>` : ''}.`);
    }
    for (const s of SITES) {
      if (c.told[s.id]) continue;
      if (s.unlock(st).ok) {
        c.told[s.id] = 1;
        events.push(`New land available: <b>${s.name}</b> (${s.sub}). See the Base tab.`);
        toasts.push(`${s.icon} New land available: ${s.name}`);
      }
    }
    return { events, toasts };
  }

  // ---------- Hiring ----------
  function hireCost(st) { const S = root.APOGEE_SIM; return r2((S ? S.FACILITY.engineerHire : 0.8) * bonus(st).hireMult); }

  // ---------- UI ----------
  const CSS = `
.cp-root{--cp-ok:#3ddc97;--cp-no:#ff5d6c;}
.cp-sites{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;scrollbar-width:thin}
.cp-chip{flex:none;display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:7px 11px;font-size:13px;font-weight:600;color:var(--dim);white-space:nowrap}
.cp-chip.on{color:var(--text);border-color:var(--accent);box-shadow:inset 0 -3px 0 var(--accent)}
.cp-chip small{font-weight:500;opacity:.8}
.cp-main{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}
.cp-map{position:relative;height:min(64vh,600px);min-height:300px;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:#0e1626;touch-action:none;user-select:none;-webkit-user-select:none}
.cp-map canvas{position:absolute;inset:0;display:block;cursor:grab}
.cp-tools{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
.cp-tool{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 12px;font-weight:700;font-size:13px;color:var(--dim)}
.cp-tool.on{background:var(--accent);border-color:var(--accent);color:#1b0d00}
.cp-tool.on::before{content:'● '}
.cp-zoom{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px}
.cp-zoom button{width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(11,15,26,.75);font-size:18px;font-weight:700}
.cp-sitehead{position:absolute;left:10px;top:8px;pointer-events:none;text-shadow:0 1px 6px #000}
.cp-sitehead b{font-size:16px}.cp-sitehead div{font-size:12px;color:#c9d1e6}
.cp-lock{position:absolute;inset:auto 10px 10px 10px;background:rgba(11,15,26,.92);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.cp-status{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-top:8px;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.cp-status .grow{flex:1;min-width:160px}
.cp-ok{color:var(--cp-ok);font-weight:700}.cp-no{color:var(--cp-no);font-weight:700}
.cp-pal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-top:8px}
.cp-bt{text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.3}
.cp-bt b{display:block;font-size:13px}.cp-bt .cp-ic{font-size:18px;float:left;margin:0 8px 0 0;line-height:1.6}
.cp-bt.on{border:2px solid var(--accent);padding:7px 9px;background:var(--panel2)}
.cp-bt.on b::after{content:' ◀ selected';color:var(--accent2);font-size:11px}
.cp-bt.lock{opacity:.55}
.cp-bt .dim{display:block}
.cp-notes{margin:6px 0 0;padding:0;list-style:none;font-size:12px}
.cp-notes li{padding:1px 0}
.cp-bar{height:8px;border-radius:6px;background:var(--panel2);overflow:hidden;margin-top:5px;border:1px solid var(--line)}
.cp-bar i{display:block;height:100%;background:repeating-linear-gradient(45deg,var(--accent) 0 6px,var(--accent2) 6px 12px)}
.cp-cons{display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-top:8px}
.cp-pips{letter-spacing:2px;color:var(--accent2)}
.cp-pal[hidden],.cp-lock[hidden]{display:none}
@media (max-width:900px){.cp-main{grid-template-columns:1fr}.cp-map{height:52vh;min-height:280px}}
@media (max-width:760px){.cp-map{height:clamp(300px,96vw,56vh)}.cp-pal{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-tool{flex:1;padding:9px 6px}}
`;
  function injectCSS() {
    if (document.getElementById('cp-style')) return;
    const s = document.createElement('style'); s.id = 'cp-style'; s.textContent = CSS; document.head.appendChild(s);
  }

  let ui = null; // { el, G, root, view, mode, type, rot, sel, pv, hover }

  function gs() { return ui && (typeof ui.G.state === 'function' ? ui.G.state() : ui.G.state); }
  const pips = (l) => '★'.repeat(l) + '☆'.repeat(3 - l);

  function scene() {
    const st = gs(); if (!st) return null;
    const sid = st.campus.view, site = SITE[sid], ss = siteState(st, sid);
    const owned = new Set(ss.owned);
    const bs = st.campus.b.filter((b) => b.site === sid && b.type !== 'road').map((b) => ({ ...b, prog: b.total ? 1 - b.days / b.total : 1 }));
    // Player roads are drawn as road ground: hand the view a copy of the map with them painted in.
    let vsite = site;
    const rn = roadNet(st, sid);
    if (rn.all.size) {
      const keys = [...rn.all.keys()].sort((a, b) => a - b);
      const map = site.map.map((row, y) => row.split('').map((c, x) => (rn.all.has(y * site.w + x) ? 'R' : c)).join(''));
      vsite = Object.assign({}, site, { id: site.id + '~' + keys.join('.'), base: site.id, map, map0: site.map });
    }
    let preview = null;
    if (ui.mode === 'build' && ui.type && ui.pv && ss.open) preview = { type: ui.type, ...check(st, sid, ui.type, ui.pv.x, ui.pv.y, ui.rot) };
    let sel = null;
    if (ui.sel && ui.sel.site === sid) {
      const b = ui.sel.id && st.campus.b.find((o) => o.id === ui.sel.id);
      sel = b ? { x: b.x, y: b.y, w: b.w, h: b.h, label: BT[b.type].name } : ui.sel.id ? null : { x: ui.sel.x, y: ui.sel.y, w: 1, h: 1 };
    }
    return { site: vsite, owned, buildings: bs, preview, sel, mode: ui.mode, open: ss.open, hover: ui.hover, TER };
  }

  function anchorFor(x, y) {
    const t = BT[ui.type]; const w = ui.rot ? t.h : t.w, h = ui.rot ? t.w : t.h;
    return { x: x - Math.floor((w - 1) / 2), y: y - Math.floor((h - 1) / 2) };
  }
  function onHover(p) {
    if (!ui) return;
    ui.hover = p;
    if (ui.mode === 'build' && ui.type && p) { const a = anchorFor(p.x, p.y); if (!ui.pv || ui.pv.x !== a.x || ui.pv.y !== a.y) { ui.pv = a; ui.pvTouch = false; panel(); } }
  }
  function onTap(p) {
    if (!ui || !p) return;
    const st = gs(), sid = st.campus.view, site = SITE[sid];
    if (p.x < 0 || p.y < 0 || p.x >= site.w || p.y >= site.h) { ui.sel = null; panel(); return; }
    if (ui.mode === 'build' && ui.type) {
      const a = anchorFor(p.x, p.y);
      const same = ui.pv && ui.pv.x === a.x && ui.pv.y === a.y;
      ui.pv = a;
      if (same && (ui.pvTouch || p.mouse)) { doAct('place', { site: sid, type: ui.type, x: a.x, y: a.y, rot: ui.rot }); }
      else ui.pvTouch = true;
      panel(); return;
    }
    const b = at(st, sid, p.x, p.y);
    if (b) { ui.sel = { site: sid, id: b.id }; panel(); return; }
    if (ui.mode === 'buy' && siteOpen(st, sid) && !isOwned(st, sid, p.x, p.y) && plotPrice(st, sid, p.x, p.y) != null) {
      ui.sel = { site: sid, x: p.x, y: p.y };
      doAct('buy', { site: sid, x: p.x, y: p.y });
      return;
    }
    ui.sel = { site: sid, x: p.x, y: p.y };
    panel();
  }

  function doAct(a, p) {
    const st = gs();
    const r = act(st, a, p);
    const G = ui.G;
    if (r.ok) {
      if (a !== 'buy') G.log(r.msg);
      G.toast((a === 'buy' ? '🏷️ ' : a === 'place' ? '🏗️ ' : '✓ ') + r.msg);
      if (a === 'place' && r.quick) { ui.pv = null; ui.pvTouch = false; } // roads: stay in build mode to lay the next tile
      else if (a === 'place') { ui.sel = { site: p.site, id: r.id }; ui.pv = null; ui.pvTouch = false; if (!ui.keepType) ui.mode = 'look'; }
      G.save();
    } else G.toast('✕ ' + r.msg);
    G.refresh();
    if (!document.contains(ui.root)) return;
    panel();
  }

  function setH(node, html) { if (node && node._h !== html) { node.innerHTML = html; node._h = html; } }

  function render(el, G) {
    injectCSS();
    if (ui && (ui.el !== el || !el.contains(ui.root))) dispose();
    const st = typeof G.state === 'function' ? G.state() : G.state;
    ensure(st);
    if (!ui) {
      ui = { el, G, mode: 'look', type: null, rot: false, sel: null, pv: null, hover: null };
      el.innerHTML = `<div class="cp-root">
        <div class="cp-sites"></div>
        <div class="cp-main"><div class="cp-mapcol">
          <div class="cp-tools">
            <button class="cp-tool" data-cp="mode" data-v="look">🔍 Inspect</button>
            <button class="cp-tool" data-cp="mode" data-v="build">🏗️ Build</button>
          </div>
          <div class="cp-map"><div class="cp-sitehead"></div>
            <div class="cp-zoom"><button data-cp="zin" aria-label="Zoom in">+</button><button data-cp="zout" aria-label="Zoom out">−</button><button data-cp="fit" aria-label="Fit map">⤢</button></div>
            <div class="cp-lock" hidden></div></div>
          <div class="cp-status"></div>
          <div class="cp-pal"></div>
        </div><div class="cp-side"></div></div></div>`;
      ui.root = el.firstElementChild;
      ui.G = G;
      ui.onClick = (e) => {
        const t = e.target.closest('[data-cp]');
        if (!t || !ui) return;
        e.stopPropagation();
        const k = t.dataset.cp, v = t.dataset.v, s = gs();
        switch (k) {
          case 'site': s.campus.view = v; ui.sel = null; ui.pv = null; if (ui.view) ui.view.fit(); ui.G.save(); break;
          case 'mode': ui.mode = v; ui.pv = null; if (v !== 'build') ui.type = null; break;
          case 'type': ui.type = ui.type === v ? null : v; ui.mode = 'build'; ui.pv = null; ui.rot = false; break;
          case 'rot': ui.rot = !ui.rot; break;
          case 'cancel': ui.type = null; ui.pv = null; ui.mode = 'look'; break;
          case 'place': if (ui.pv) doAct('place', { site: s.campus.view, type: ui.type, x: ui.pv.x, y: ui.pv.y, rot: ui.rot }); return;
          case 'open': doAct('open', { site: v }); return;
          case 'buy': doAct('buy', { site: s.campus.view, x: +t.dataset.x, y: +t.dataset.y }); return;
          case 'upgrade': doAct('upgrade', { id: v }); return;
          case 'demolish': if (window.confirm('Demolish this building? You get a small part of the cost back.')) { doAct('demolish', { id: v }); ui.sel = null; } return;
          case 'goto': { const b = s.campus.b.find((o) => o.id === v); if (b) { s.campus.view = b.site; ui.sel = { site: b.site, id: b.id }; if (ui.view) ui.view.fit(); } break; }
          case 'hire': {
            const cost = hireCost(s), cap = bonus(s).engineerCap;
            if (s.engineers >= cap) { ui.G.toast('✕ No free desks: build or upgrade an Engineering office'); break; }
            if (s.cash < cost) { ui.G.toast('✕ Not enough cash'); break; }
            s.cash -= cost; s.engineers++; ui.G.save(); ui.G.refresh(); return;
          }
          case 'fire': if (s.engineers > 1) { s.engineers--; ui.G.save(); ui.G.refresh(); } return;
          case 'zin': if (ui.view) ui.view.zoomBy(1.3); return;
          case 'zout': if (ui.view) ui.view.zoomBy(1 / 1.3); return;
          case 'fit': if (ui.view) ui.view.fit(); return;
          default: return;
        }
        panel();
      };
      ui.root.addEventListener('click', ui.onClick);
      const V = root.APOGEE_CAMPUS_VIEW;
      if (V) ui.view = V.mount(ui.root.querySelector('.cp-map'), { scene, tap: onTap, hover: onHover });
    }
    ui.G = G;
    panel();
  }

  function panel() {
    if (!ui) return;
    const st = gs(), G = ui.G, money = G.money, esc = G.esc;
    const c = st.campus, sid = c.view, site = SITE[sid], ss = siteState(st, sid);
    const bo = bonus(st);
    const q = (s) => ui.root.querySelector(s);
    // Site chips
    setH(q('.cp-sites'), SITES.map((s) => {
      const o = siteState(st, s.id).open, u = s.unlock(st).ok;
      if (!o && !u && s.gateway && s.id !== 'gw-fjord') return '';
      return `<button class="cp-chip ${s.id === sid ? 'on' : ''}" data-cp="site" data-v="${s.id}">${o ? s.icon : u ? '🔓' : '🔒'} ${esc(s.name)}${o ? '' : u ? ' <small>· for sale</small>' : ''}</button>`;
    }).join(''));
    for (const b of ui.root.querySelectorAll('.cp-tool')) b.classList.toggle('on', b.dataset.v === ui.mode);
    setH(q('.cp-sitehead'), `<b>${site.icon} ${esc(site.name)}</b><div>${esc(site.sub)} · ${ss.owned.length} plot${ss.owned.length === 1 ? '' : 's'} owned</div>`);
    // Locked overlay
    const lock = q('.cp-lock');
    if (!ss.open) {
      const u = site.unlock(st);
      lock.hidden = false;
      setH(lock, `<b>${u.ok ? '🔓' : '🔒'} ${esc(site.name)}</b> <span class="small dim">· ${esc(site.sub)}</span><p class="small">${esc(site.desc)}</p>
        ${u.ok ? `<div class="small dim">Includes all ${buyablePlots(site.id).length} plots of land and the permits.</div><button class="btn primary sm" data-cp="open" data-v="${site.id}" ${st.cash < propertyPrice(site.id) ? 'disabled' : ''}>Buy property · ${money(propertyPrice(site.id))}</button>` : `<div class="small cp-no">🔒 Locked · needs: ${esc(u.need)}</div>`}`);
    } else lock.hidden = true;

    // Status bar (selection / preview)
    let sHTML = '';
    if (ui.mode === 'build') {
      if (!ui.type) sHTML = `<div class="grow">🏗️ <b>Pick a building below</b>, then tap the map to place it.</div><button class="btn sm" data-cp="cancel">Done</button>`;
      else {
        const t = BT[ui.type];
        const ck = ui.pv && ss.open ? check(st, sid, ui.type, ui.pv.x, ui.pv.y, ui.rot) : null;
        sHTML = `<div class="grow"><b>${t.icon} ${t.name}</b> · ${t.w}×${t.h} · ${money(t.cost[0])} · ${t.days[0]} days<br>`;
        sHTML += !ss.open ? '<span class="cp-no">✕ Open this site first</span>' : !ck ? 'Tap the map where it should go.' : ck.ok ? `<span class="cp-ok">✓ Fits here</span> · ${ui.pvTouch ? 'tap again or press Place' : 'click to place'}` : `<span class="cp-no">✕ ${esc(ck.why)}</span>`;
        sHTML += `</div>${t.w !== t.h ? '<button class="btn sm" data-cp="rot">⟳ Rotate</button>' : ''}<button class="btn primary sm" data-cp="place" ${ck && ck.ok ? '' : 'disabled'}>Place here</button><button class="btn sm" data-cp="cancel">Cancel</button>`;
      }
    } else if (ui.sel && ui.sel.site === sid && ui.sel.id) {
      const b = c.b.find((o) => o.id === ui.sel.id);
      if (b) sHTML = buildingHTML(st, b, true);
    } else if (ui.sel && ui.sel.site === sid) {
      const { x, y } = ui.sel, ch = tile(site, x, y), T = TER[ch], own = isOwned(st, sid, x, y), price = plotPrice(st, sid, x, y);
      sHTML = `<div class="grow"><b>Plot ${x + 1}-${y + 1} · ${T.name}</b>${roadNext(site, x, y) ? ' · 🛣️ road access' : ''}<br>`;
      if (own) sHTML += '<span class="cp-ok">✓ You own this plot</span> · use 🏗️ Build to put something on it';
      else if (price != null) sHTML += `For sale: <b>${money(price)}</b>`;
      else sHTML += `<span class="cp-no">✕ ${esc(T.why || 'Not for sale')}</span>`;
      sHTML += '</div>';
      if (!own && price != null && ss.open) sHTML += `<button class="btn primary sm" data-cp="buy" data-x="${x}" data-y="${y}" ${st.cash < price ? 'disabled' : ''}>Buy plot · ${money(price)}</button>`;
    } else if (ui.mode === 'buy') sHTML = `<div class="grow">🏷️ <b>Buy land:</b> tap any plot with a 🏷 sign post to buy it. Plots next to a road cost 20% more. Each plot you own at a site makes the next one 3% pricier.</div>`;
    else sHTML = `<div class="grow">🔍 Tap a plot or building to see it. Drag to move the map, pinch or scroll to zoom, right-drag or two-finger twist (or ⟲ ⟳) to rotate. Your land has a fence ┄ around it.</div>`;
    setH(q('.cp-status'), sHTML);

    // Palette
    const pal = q('.cp-pal');
    if (ui.mode === 'build') {
      setH(pal, ORDER.map((k) => {
        const t = BT[k], lw = lockedWhy(st, k);
        return `<button class="cp-bt ${ui.type === k ? 'on' : ''} ${lw ? 'lock' : ''}" data-cp="type" data-v="${k}"><span class="cp-ic">${t.icon}</span><b>${t.name}</b>
          <span class="dim">${t.w}×${t.h} · ${money(t.cost[0])} · ${t.days[0]}d</span><span>${lw ? '🔒 ' + esc(lw) : esc(t.fx(1))}</span></button>`;
      }).join(''));
      pal.hidden = false;
    } else { pal.hidden = true; }

    // Side panel
    let h = '';
    const cons = c.b.filter((b) => b.days > 0);
    if (cons.length) {
      h += `<h2>Under construction</h2><div class="card">${cons.map((b) => `<div class="cp-cons tap" data-cp="goto" data-v="${b.id}" style="cursor:pointer"><span>🏗️ ${BT[b.type].name}${b.lvl ? ` → level ${b.to}` : ''} <span class="dim">· ${esc(SITE[b.site].name)}</span></span><b>${b.days} d</b></div><div class="cp-bar" role="progressbar" aria-valuenow="${Math.round(100 * (1 - b.days / b.total))}"><i style="width:${Math.round(100 * (1 - b.days / b.total))}%"></i></div>`).join('')}</div>`;
    }
    h += `<h2>Company campus</h2><div class="card"><div class="kv">
      <div><small>🏭 Build lines</small><b>${bo.factoryLines}</b></div>
      <div><small>🚀 Launch pads</small><b>${bo.pads}</b></div>
      <div><small>⏱️ Launch every</small><b>${bo.launchEveryDays ? bo.launchEveryDays + ' d' : '–'}</b></div>
      <div><small>👷 Desks</small><b>${st.engineers}/${bo.engineerCap}</b></div>
      <div><small>🔬 Science/day</small><b>${r2(st.engineers * (root.APOGEE_SIM ? root.APOGEE_SIM.FACILITY.rpPerEngineerDay : 0.25) + bo.rpPerDay)}</b></div>
      ${bo.satFactory ? `<div><small>🛰️ Sats/day</small><b>${bo.satFactory}</b></div>` : ''}
      ${bo.chipSelf ? `<div><small>💾 Own chips</small><b>${Math.round(bo.chipSelf * 100)}%</b></div>` : ''}
      ${bo.groundStations ? `<div><small>📡 Gateways</small><b>${bo.groundStations}</b></div>` : ''}
      <div><small>💸 Upkeep/mo</small><b>${money(bo.upkeepMonth)}</b></div>
      ${bo.incomeMonth ? `<div><small>💵 Income/mo</small><b class="money">${money(bo.incomeMonth)}</b></div>` : ''}
      ${bo.repPerMonth ? `<div><small>⭐ Rep/mo</small><b>+${bo.repPerMonth}</b></div>` : ''}
      <div><small>🗺️ Land</small><b>${bo.plots} plots</b></div>
      <div><small>🏦 Campus worth</small><b>${money(bo.landValue + bo.buildingValue)}</b></div>
      </div><div class="small dim" style="margin-top:8px">${[bo.landingZone && '🎯 Landing zone', bo.bargePort && '🚢 Barge port', bo.catchTower && '🦾 Catch tower', bo.polarPad && '🧭 Polar pad', bo.solarCut && `☀️ −${Math.round(bo.solarCut * 100)}% upkeep`].filter(Boolean).join(' · ') || 'Build a landing zone, barge port and catch tower to recover boosters.'}</div></div>`;
    const hc = hireCost(st);
    h += `<h2>Team</h2><div class="card"><b>👷 ${st.engineers} engineers</b> <span class="small dim">· ${bo.engineerCap - st.engineers} free desk${bo.engineerCap - st.engineers === 1 ? '' : 's'}</span>
      <div class="small dim">Hire cost ${money(hc)}${bo.hireMult < 1 ? ` (housing −${Math.round((1 - bo.hireMult) * 100)}%)` : ''}. Offices add desks.</div>
      <div class="btns"><button class="btn primary sm" data-cp="hire" ${st.cash < hc || st.engineers >= bo.engineerCap ? 'disabled' : ''}>${st.engineers >= bo.engineerCap ? '✕ No free desks' : `Hire · ${money(hc)}`}</button><button class="btn sm" data-cp="fire" ${st.engineers <= 1 ? 'disabled' : ''}>Let one go</button></div></div>`;
    // Buildings at this site
    const here = c.b.filter((b) => b.site === sid && b.type !== 'road'), nRoad = c.b.filter((b) => b.site === sid && b.type === 'road').length;
    if (here.length || nRoad) h += `<h2>At ${esc(site.name)}</h2><div class="card small">${nRoad ? `<div class="cp-cons"><span>🛣️ Your roads</span><span>${nRoad} tile${nRoad > 1 ? 's' : ''}</span></div>` : ''}${here.map((b) => `<div class="cp-cons" data-cp="goto" data-v="${b.id}" style="cursor:pointer;margin-top:4px"><span>${BT[b.type].icon} ${BT[b.type].name}</span><span>${b.lvl ? `<span class="cp-pips" aria-label="level ${b.lvl}">${pips(b.lvl)}</span>` : '🏗️'}</span></div>`).join('')}</div>`;
    const S0 = root.APOGEE_SIM, stt = st.stats || {};
    h += `<h2>Company</h2><div class="card"><div class="kv"><div><small>Launches</small><b>${stt.launches || 0}</b></div><div><small>Successes</small><b>${stt.successes || 0}</b></div><div><small>Landings</small><b>${stt.landings || 0}</b></div><div><small>Earned</small><b>${money(stt.earned || 0)}</b></div>
      <div><small>Salaries/mo</small><b>${money(st.engineers * (S0 ? S0.FACILITY.engineerSalary : 0.15))}</b></div></div></div>`;
    h += `<h2>Game</h2><div class="card small dim">Your game saves on this device automatically.<div class="btns"><button class="btn sm" data-act="help">How to play</button><button class="btn sm danger" data-act="reset">Start a new company</button></div></div>`;
    setH(q('.cp-side'), h);
    if (ui.view) ui.view.dirty();
  }

  function buildingHTML(st, b, actions) {
    const G = ui.G, money = G.money, esc = G.esc;
    const t = BT[b.type], e = eff(st, b);
    let s = `<div class="grow"><b>${t.icon} ${t.name}</b> ${b.lvl ? `<span class="cp-pips" aria-label="level ${b.lvl}">${pips(b.lvl)}</span> level ${b.lvl}` : ''}<br>`;
    if (b.days > 0) s += `🏗️ ${b.lvl ? `Upgrading to level ${b.to}` : 'Under construction'}: <b>${b.days} days</b> left<div class="cp-bar"><i style="width:${Math.round(100 * (1 - b.days / b.total))}%"></i></div>`;
    if (b.lvl) s += `<span class="cp-ok">✓ Working:</span> ${esc(t.fx(b.lvl))} · upkeep ${money(t.up[b.lvl - 1])}/mo`;
    else s += `<span class="dim">When done: ${esc(t.fx(1))}</span>`;
    s += `<div class="small dim">${esc(t.info)}</div>`;
    if (e.notes.length) s += `<ul class="cp-notes">${e.notes.map((n) => `<li class="${n.good ? 'cp-ok' : 'cp-no'}">${n.good ? '▲' : '▼'} ${esc(n.text)}</li>`).join('')}</ul>`;
    s += '</div>';
    if (actions) {
      if (b.lvl > 0 && b.lvl < t.cost.length && b.days <= 0) s += `<button class="btn primary sm" data-cp="upgrade" data-v="${b.id}" ${st.cash < t.cost[b.lvl] ? 'disabled' : ''}>Upgrade to ${pips(b.lvl + 1)} · ${money(t.cost[b.lvl])} · ${t.days[b.lvl]}d<br><span style="font-weight:500">${esc(t.fx(b.lvl + 1))}</span></button>`;
      else if (b.type === 'road') s += `<span class="small ${roadNet(st, b.site).ok.has(b.y * SITE[b.site].w + b.x) ? 'cp-ok">✓ Connected to the public road' : 'cp-bad">✕ Not connected: link it to the public road'}</span>`;
      else if (b.lvl >= 3) s += '<span class="small cp-ok">★ Max level</span>';
      s += `<button class="btn sm danger" data-cp="demolish" data-v="${b.id}">Demolish</button>`;
    }
    return s;
  }

  function dispose() {
    if (!ui) return;
    if (ui.view) ui.view.dispose();
    if (ui.root) ui.root.removeEventListener('click', ui.onClick);
    ui = null;
  }

  root.APOGEE_CAMPUS = { SITES, SITE, BT, TER, ORDER, REGION_NAMES, ensure, tick, bonus, act, check, plotPrice, propertyPrice, eff, hireCost, render, dispose, _ui: () => ui };
})(typeof window !== 'undefined' ? window : globalThis);
