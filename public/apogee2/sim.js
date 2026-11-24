// APOGEE: rocket company sim. Pure game data and math (no DOM), so it can be tested in Node.
(function (root) {
  'use strict';
  const G0 = 9.80665;

  // Engines. Thrust in kN, mass in t, cost in $M.
  const ENGINES = {
    ember:  { name: 'Ember',      fuel: 'Kerosene', thrustSL: 845,  thrustVac: 935,  ispSL: 282, ispVac: 311, mass: 0.47, cost: 0.9, rel: 0.985, vac: false, tech: null },
    emberv: { name: 'Ember Vac',  fuel: 'Kerosene', thrustSL: 0,    thrustVac: 980,  ispSL: 0,   ispVac: 348, mass: 0.55, cost: 1.4, rel: 0.985, vac: true,  tech: null },
    comet:  { name: 'Comet',      fuel: 'Methane',  thrustSL: 1850, thrustVac: 2050, ispSL: 321, ispVac: 350, mass: 1.30, cost: 2.2, rel: 0.978, vac: false, tech: 'comet' },
    cometv: { name: 'Comet Vac',  fuel: 'Methane',  thrustSL: 0,    thrustVac: 2250, ispSL: 0,   ispVac: 376, mass: 1.90, cost: 3.0, rel: 0.978, vac: true,  tech: 'comet' },
    nova:   { name: 'Nova',       fuel: 'Methane',  thrustSL: 2700, thrustVac: 2950, ispSL: 330, ispVac: 362, mass: 1.55, cost: 1.6, rel: 0.972, vac: false, tech: 'nova' },
    novav:  { name: 'Nova Vac',   fuel: 'Methane',  thrustSL: 0,    thrustVac: 3000, ispSL: 0,   ispVac: 382, mass: 2.30, cost: 2.4, rel: 0.972, vac: true,  tech: 'nova' },
  };

  // Delta-v needed from the ground (m/s), including typical losses.
  const TARGETS = {
    LEO:  { name: 'Low Earth Orbit',      short: 'LEO',  dv: 9300,  deep: false },
    SSO:  { name: 'Sun-Synchronous Orbit', short: 'SSO', dv: 9750,  deep: false },
    GTO:  { name: 'Geostationary Transfer', short: 'GTO', dv: 11800, deep: false },
    LLO:  { name: 'Lunar Orbit',          short: 'Moon orbit', dv: 13300, deep: true },
    LUN:  { name: 'Lunar Surface',        short: 'Moon landing', dv: 15200, deep: true },
    MTO:  { name: 'Mars Transfer',        short: 'Mars transfer', dv: 13000, deep: true },
    MARS: { name: 'Mars Surface',         short: 'Mars landing', dv: 13900, deep: true },
  };

  const RECOVERY = {
    expend: { name: 'Expend booster',       reserve: 0,    legs: false, tech: null },
    rtls:   { name: 'Land back at the pad', reserve: 0.12, legs: true,  tech: 'legs' },
    barge:  { name: 'Land on the ocean barge', reserve: 0.07, legs: true, tech: 'barge', needs: 'barge' },
    catch:  { name: 'Catch with the tower', reserve: 0.13, legs: false, tech: 'tower', needs: 'tower' },
  };

  const TECHS = {
    legs:      { name: 'Landing Legs & Grid Fins', rp: 30,  req: [],               desc: 'Boosters can fly back and land at the pad, then fly again.' },
    fairing:   { name: 'Fairing Recovery',         rp: 25,  req: [],               desc: 'Fish the nose fairing out of the ocean. Fairings cost 80% less.' },
    lighttanks:{ name: 'Al-Li Tanks',              rp: 35,  req: [],               desc: 'Lighter tank walls: 20% less tank dry mass.' },
    barge:     { name: 'Ocean Landing Barge',      rp: 50,  req: ['legs'],         desc: 'Land boosters downrange at sea. Much less fuel held back. Buy the barge on the Base tab.' },
    rapid:     { name: 'Rapid Turnaround',         rp: 70,  req: ['legs'],         desc: 'Refurbishing a booster costs 4% (not 10%), takes 3 days, and landings are more reliable.' },
    comet:     { name: 'Comet Methane Engine',     rp: 90,  req: [],               desc: 'Twice the thrust of Ember with better efficiency. Comet Vac for upper stages.' },
    capsule:   { name: 'Crew Capsule',             rp: 110, req: ['legs'],         desc: 'Fly astronauts. Unlocks crew contracts.' },
    steel:     { name: 'Stainless Megastructure',  rp: 150, req: ['comet'],        desc: 'Giant cheap steel tanks: up to 4,000 t per stage and 42 engines.' },
    nova:      { name: 'Nova Full-Flow Engine',    rp: 200, req: ['comet'],        desc: 'The best engine there is: huge thrust, top efficiency, cheap to mass-produce.' },
    tower:     { name: 'Tower Catch',              rp: 180, req: ['rapid', 'steel'], desc: 'Catch boosters with arms on the launch tower. No legs, 2-day turnaround. Build the tower on Base.' },
    refill:    { name: 'Orbital Refilling',        rp: 220, req: ['steel'],        desc: 'Tanker flights refill your upper stage in orbit for Moon and Mars missions.' },
    shipreuse: { name: 'Reusable Upper Stage',     rp: 260, req: ['tower'],        desc: 'Upper stages come home too. Each reused flight refunds 90% of the upper stage.' },
    habitat:   { name: 'Mars Habitat',             rp: 300, req: ['refill'],       desc: 'Unlocks Mars city cargo contracts. Land 5 to win the game.' },
  };

  const FACILITY = {
    factoryCost: (lvl) => 8 * lvl * lvl,          // next level cost in $M
    bargeCost: 12,
    towerCost: 30,
    engineerHire: 0.8,
    engineerSalary: 0.15,                         // $M per 30 days
    rpPerEngineerDay: 0.25,
  };

  function has(techs, id) { return !!(techs && techs[id]); }

  function limits(techs) {
    const steel = has(techs, 'steel');
    return {
      maxProp: steel ? 4000 : 600,
      maxEngines: steel ? 42 : 12,
      maxStages: 3,
    };
  }

  function tankDryFrac(techs) {
    let f = has(techs, 'steel') ? 0.052 : 0.06;
    if (has(techs, 'lighttanks')) f *= 0.8;
    return f;
  }
  function tankCostPerTon(techs) { return has(techs, 'steel') ? 0.0012 : 0.003; }

  // Dry mass of one stage (t).
  function stageDry(st, techs, i, recovery) {
    const eng = ENGINES[st.engine];
    let dry = st.prop * tankDryFrac(techs) + eng.mass * st.count + 0.6;
    if (i === 0 && recovery && RECOVERY[recovery].legs) dry += st.prop * 0.006 + 1;
    if (i === 0 && recovery === 'catch') dry += st.prop * 0.002;
    return dry;
  }

  function stageCost(st, techs, i) {
    const eng = ENGINES[st.engine];
    return eng.cost * st.count + st.prop * tankCostPerTon(techs) + 0.8 + (i === 0 ? 0 : 0.2);
  }

  function fairingCost(techs) { return has(techs, 'fairing') ? 0.1 : 0.5; }

  function designCost(design, techs) {
    return design.stages.reduce((s, st, i) => s + stageCost(st, techs, i), 0) + fairingCost(techs);
  }

  function buildDays(design, factoryLvl) {
    const prop = design.stages.reduce((s, st) => s + st.prop, 0);
    const eng = design.stages.reduce((s, st) => s + st.count, 0);
    const base = 6 + prop * 0.006 + eng * 0.5;
    return Math.max(2, Math.round(base / (1 + 0.5 * (factoryLvl - 1))));
  }

  function refurbFrac(techs, recovery) {
    if (recovery === 'catch') return 0.02;
    return has(techs, 'rapid') ? 0.04 : 0.10;
  }
  function refurbDays(techs, recovery) {
    if (recovery === 'catch') return 2;
    return has(techs, 'rapid') ? 3 : 10;
  }

  function validate(design, techs) {
    const lim = limits(techs);
    const errs = [];
    if (!design.stages.length) errs.push('Add a stage.');
    design.stages.forEach((st, i) => {
      const eng = ENGINES[st.engine];
      if (!eng) { errs.push(`Stage ${i + 1}: pick an engine.`); return; }
      if (eng.tech && !has(techs, eng.tech)) errs.push(`Stage ${i + 1}: ${eng.name} needs research.`);
      if (i === 0 && eng.vac) errs.push(`Stage 1 can't use a vacuum engine.`);
      if (st.count > lim.maxEngines) errs.push(`Stage ${i + 1}: max ${lim.maxEngines} engines.`);
      if (st.prop > lim.maxProp) errs.push(`Stage ${i + 1}: max ${lim.maxProp} t of propellant.`);
    });
    return errs;
  }

  // Full performance for a design carrying payload (t) with a recovery mode.
  // upperReuse: hold back fuel on the top stage and carry a heat shield.
  function perf(design, payload, recovery, techs, opts) {
    opts = opts || {};
    const n = design.stages.length;
    const stages = design.stages.map((st, i) => {
      const eng = ENGINES[st.engine];
      let dry = stageDry(st, techs, i, recovery);
      let reserve = i === 0 ? st.prop * (RECOVERY[recovery] ? RECOVERY[recovery].reserve : 0) : 0;
      if (opts.upperReuse && i === n - 1 && n > 1) { dry *= 1.12; reserve = st.prop * 0.06; }
      const isp = i === 0 ? (eng.vac ? eng.ispVac : eng.ispSL * 0.4 + eng.ispVac * 0.6) : eng.ispVac;
      const thrust = (i === 0 ? (eng.thrustSL || eng.thrustVac) : eng.thrustVac) * st.count;
      return { dry, prop: st.prop, reserve, isp, thrust };
    });
    let above = payload;
    let dv = 0;
    const detail = [];
    for (let i = n - 1; i >= 0; i--) {
      const s = stages[i];
      const m0 = above + s.dry + s.prop;
      const m1 = above + s.dry + s.reserve;
      const sdv = s.isp * G0 * Math.log(m0 / m1);
      detail[i] = { dv: sdv, m0, m1, twr: s.thrust / (m0 * G0) };
      dv += sdv;
      above = m0;
    }
    const liftoff = above;
    const twr = detail.length ? detail[0].twr : 0;
    let loss = 0;
    if (twr < 1.2) loss += (1.2 - twr) * 2500;
    const upperTwr = n > 1 ? detail[n - 1].twr : twr;
    if (n > 1 && upperTwr < 0.5) loss += (0.5 - upperTwr) * 1500;
    return { dv: dv - loss, rawDv: dv, loss, twr, liftoff, detail, canLift: twr >= 1.05 };
  }

  // Can this design do this job? Handles orbital refilling for deep-space targets.
  function mission(design, payload, targetId, recovery, techs, opts) {
    const t = TARGETS[targetId];
    const p = perf(design, payload, recovery, techs, opts);
    const res = { need: t.dv, have: p.dv, twr: p.twr, canLift: p.canLift, tankers: 0, refilled: false, perf: p };
    res.ok = p.canLift && p.dv >= t.dv;
    if (!res.ok && t.deep && has(techs, 'refill') && design.stages.length > 1 && p.canLift) {
      // Reach LEO with payload, then refill the top stage and burn from there.
      const toLeo = p.dv >= TARGETS.LEO.dv;
      const top = design.stages[design.stages.length - 1];
      const topIdx = design.stages.length - 1;
      const eng = ENGINES[top.engine];
      let dry = stageDry(top, techs, topIdx, recovery);
      if (opts && opts.upperReuse) dry *= 1.12;
      const depDv = eng.ispVac * G0 * Math.log((payload + dry + top.prop) / (payload + dry));
      const need = t.dv - TARGETS.LEO.dv;
      if (toLeo && depDv >= need) {
        const cap = capacity(design, 'LEO', recovery, techs, opts);
        res.tankers = cap > 0 ? Math.ceil(top.prop / cap) : 99;
        res.refilled = true;
        res.ok = res.tankers <= 20;
        res.have = TARGETS.LEO.dv + depDv;
      }
    }
    return res;
  }

  // Max payload (t) to a target (without refilling).
  function capacity(design, targetId, recovery, techs, opts) {
    const need = TARGETS[targetId].dv;
    if (perf(design, 0, recovery, techs, opts).dv < need) return 0;
    let lo = 0, hi = 2000;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (perf(design, mid, recovery, techs, opts).dv >= need) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Engine reliability grows with flight heritage.
  function engineRel(engineId, heritage) {
    const e = ENGINES[engineId];
    const flights = (heritage && heritage[engineId]) || 0;
    return Math.min(0.9985, e.rel + 0.0012 * flights);
  }

  function engineOutTolerance(count) {
    if (count >= 20) return 2;
    if (count >= 5) return 1;
    return 0;
  }

  // Probability each stage burns without a fatal failure.
  // mod (optional, launch ops): { failMul: scales the failure chance, mul: scales success } for weather, static fires, investigations.
  function launchOdds(design, heritage, designFlights, mod) {
    let p = 1;
    for (const st of design.stages) {
      const r = engineRel(st.engine, heritage);
      const tol = engineOutTolerance(st.count);
      // P(failures <= tol), binomial
      let ok = 0;
      for (let k = 0; k <= tol; k++) ok += binom(st.count, k) * Math.pow(1 - r, k) * Math.pow(r, st.count - k);
      p *= ok;
    }
    const newDesignRisk = Math.max(0.005, 0.05 - 0.009 * (designFlights || 0));
    p *= 1 - newDesignRisk;
    if (mod) p = (1 - (1 - p) * (mod.failMul == null ? 1 : mod.failMul)) * (mod.mul == null ? 1 : mod.mul);
    return p;
  }

  function binom(n, k) {
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return r;
  }

  // mod (optional, launch ops): { add } added to the odds for weather and investigations.
  function landingOdds(recovery, landings, techs, mod) {
    if (recovery === 'expend') return 0;
    const tries = (landings && landings[recovery]) || 0;
    let p;
    if (recovery === 'catch') p = 0.6 + 0.06 * tries;
    else if (recovery === 'barge') p = 0.42 + 0.06 * tries;
    else p = 0.48 + 0.06 * tries;
    if (has(techs, 'rapid')) p += 0.05;
    if (mod && mod.add) return Math.max(0.02, Math.min(0.985, Math.min(0.97, p) + mod.add));
    return Math.min(0.97, p);
  }

  // ---------- Contracts ----------
  const CLIENTS = {
    LEO: ['Brightlink Networks', 'Orbitwise Data', 'Kestrel University', 'Pebble Sats', 'Lumen IoT', 'Northstar Defense'],
    SSO: ['Terraview Imaging', 'Polar Weather Agency', 'GreenCanopy Monitor', 'Coastwatch Survey'],
    GTO: ['Bluewave Telecom', 'SkyBridge TV', 'Meridian Broadband', 'Pacifica Comms'],
    STATION: ['Orbital Outpost Program', 'Tranquil Station Co.'],
    CREW: ['Orbital Outpost Program', 'Horizon Tourism', 'Allied Space Agency'],
    LLO: ['Selene Mapping', 'Allied Space Agency', 'Lunar Relay Inc.'],
    LUN: ['Artemis Mining', 'Allied Space Agency', 'Moonbase Builders'],
    MTO: ['Red Planet Science', 'Ares Orbiter Team'],
    MARS: ['Mars City Project'],
  };

  const CONTRACT_KINDS = [
    { kind: 'smallsat',  label: 'Small satellite',      target: 'LEO', min: 0.2, max: 2.5,  rep: 0,  a: 4,   b: 3.6, client: 'LEO' },
    { kind: 'eo',        label: 'Earth imaging satellite', target: 'SSO', min: 0.8, max: 5,  rep: 8,  a: 6,   b: 3.0, client: 'SSO' },
    { kind: 'batch',     label: 'Internet satellite batch', target: 'LEO', min: 8, max: 18, rep: 20, a: 7,   b: 1.1, client: 'LEO' },
    { kind: 'comsat',    label: 'TV / comms satellite', target: 'GTO', min: 2.5, max: 7,   rep: 18, a: 8,   b: 5,  client: 'GTO' },
    { kind: 'cargo',     label: 'Station cargo run',    target: 'LEO', min: 5, max: 14,    rep: 30, a: 12,  b: 1.2,   client: 'STATION' },
    { kind: 'crew',      label: 'Crew to orbit',        target: 'LEO', min: 12, max: 12,   rep: 40, a: 22,  b: 0,   client: 'CREW', tech: 'capsule' }, // crew: was a: 45; crew.js adds a splashdown bonus
    { kind: 'llo',       label: 'Lunar orbiter',        target: 'LLO', min: 1.5, max: 6,   rep: 45, a: 16,  b: 6.5,  client: 'LLO' },
    { kind: 'mto',       label: 'Mars probe',           target: 'MTO', min: 1, max: 5,     rep: 55, a: 22,  b: 8,  client: 'MTO' },
    { kind: 'lunar',     label: 'Moon lander',          target: 'LUN', min: 4, max: 25,    rep: 65, a: 32,  b: 3,  client: 'LUN' },
    { kind: 'marscity',  label: 'Mars city cargo',      target: 'MARS', min: 60, max: 120, rep: 80, a: 160, b: 3,   client: 'MARS', tech: 'habitat' },
  ];

  function makeContract(rng, state) {
    const avail = CONTRACT_KINDS.filter((k) => state.rep >= k.rep && (!k.tech || has(state.techs, k.tech)));
    // Prefer newer kinds a little.
    const kind = avail[Math.min(avail.length - 1, Math.floor(Math.pow(rng(), 0.7) * avail.length))];
    const mass = Math.round((kind.min + (kind.max - kind.min) * rng()) * 10) / 10;
    const names = CLIENTS[kind.client];
    const client = names[Math.floor(rng() * names.length)];
    const reward = Math.round((kind.a + kind.b * mass) * (0.85 + rng() * 0.35) * 10) / 10;
    const deadline = 45 + Math.round(rng() * 90) + (TARGETS[kind.target].deep ? 60 : 0);
    return {
      id: 'c' + Math.floor(rng() * 1e9).toString(36),
      kind: kind.kind, label: kind.label, client, target: kind.target, mass, reward,
      expires: state.day + deadline, rep: Math.max(2, Math.round(Math.log2(reward + 2) * 1.5)),
      crew: kind.kind === 'crew',
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  root.APOGEE_SIM = {
    G0, ENGINES, TARGETS, RECOVERY, TECHS, FACILITY, CONTRACT_KINDS,
    has, limits, stageDry, stageCost, designCost, fairingCost, buildDays, refurbFrac, refurbDays,
    validate, perf, mission, capacity, engineRel, launchOdds, landingOdds, engineOutTolerance,
    makeContract, mulberry32,
  };
})(typeof window !== 'undefined' ? window : globalThis);
