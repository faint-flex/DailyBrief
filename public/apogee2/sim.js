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
    // Engines & boosters feature: more engines, each behind its own research.
    spark:  { name: 'Spark',      fuel: 'Hypergolic', thrustSL: 0,  thrustVac: 120,  ispSL: 0,   ispVac: 318, mass: 0.09, cost: 0.25, rel: 0.993, vac: true, tech: 'spark', pressureFed: true },
    frost:  { name: 'Frost Vac',  fuel: 'Hydrogen', thrustSL: 0,    thrustVac: 450,  ispSL: 0,   ispVac: 451, mass: 0.95, cost: 3.6, rel: 0.98,  vac: true,  tech: 'frost' },
    forge:  { name: 'Forge',      fuel: 'Kerosene', thrustSL: 6900, thrustVac: 7650, ispSL: 268, ispVac: 304, mass: 6.2,  cost: 4.2, rel: 0.98,  vac: false, tech: 'forge' },
    zephyr: { name: 'Zephyr Spike', fuel: 'Methane', thrustSL: 1600, thrustVac: 1700, ispSL: 345, ispVac: 368, mass: 1.7, cost: 2.0, rel: 0.97,  vac: false, tech: 'aerospike', spike: true },
  };

  // Tank factors per fuel (engines & boosters feature). 1 keeps the old numbers exactly.
  const FUELS = {
    Kerosene:   { tank: 1, cost: 1 },
    Methane:    { tank: 1, cost: 1 },
    Hydrogen:   { tank: 1.8, cost: 1.6 },  // very light fuel: big insulated tanks
    Hypergolic: { tank: 1, cost: 1.3 },    // storable, toxic
  };
  function tankK(eng) { const f = FUELS[eng.fuel]; return (f ? f.tank : 1) * (eng.pressureFed ? 1.6 : 1); }
  function tankCostK(eng) { const f = FUELS[eng.fuel]; return f ? f.cost : 1; }

  // Solid strap-on boosters (engines & boosters feature). Burn from liftoff with stage 1, then drop off.
  // Thrust kN, mass t, cost $M per booster. d/h are drawing sizes in metres.
  const SRBS = {
    small: { name: 'Flint',  prop: 28,  dry: 3.6, thrustSL: 1250, thrustVac: 1400, ispSL: 248, ispVac: 274, cost: 0.8, rel: 0.997, tech: 'srb',      d: 1.3, h: 16 },
    large: { name: 'Basalt', prop: 105, dry: 12,  thrustSL: 4100, thrustVac: 4600, ispSL: 255, ispVac: 282, cost: 2.6, rel: 0.995, tech: 'srbheavy', d: 2.4, h: 30 },
  };
  const SRB_COUNTS = [0, 2, 4, 6];
  // The strap-on set of a design, or null. design.srb = { type: 'small'|'large', count: 0|2|4|6 } (optional).
  function srbOf(design) {
    const s = design && design.srb;
    if (!s || !s.count || !SRBS[s.type]) return null;
    const b = SRBS[s.type], n = s.count;
    const isp = b.ispSL * 0.4 + b.ispVac * 0.6;
    const mdot = (b.thrustSL * 0.4 + b.thrustVac * 0.6) * n / (isp * G0); // t/s for all of them
    return { type: s.type, count: n, spec: b, prop: b.prop * n, dry: b.dry * n, isp, mdot, burn: b.prop * n / mdot,
      thrust: b.thrustSL * n, cost: b.cost * n, rel: Math.pow(b.rel, n) };
  }
  function srbCost(design) { const b = srbOf(design); return b ? b.cost : 0; }

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
    // Engines & boosters feature
    spark:     { name: 'Spark Kick Engine',        rp: 20,  req: [],               icon: '✨', desc: 'A tiny, cheap, very reliable upper-stage engine. Pressure-fed, so its tanks are heavy.' },
    srb:       { name: 'Solid Strap-on Boosters',  rp: 40,  req: [],               icon: '🧨', desc: 'Strap 2, 4 or 6 small Flint solid boosters to stage 1 for extra liftoff thrust. Cheap, thrown away after each flight.' },
    forge:     { name: 'Forge Heavy Kerosene Engine', rp: 80, req: [],             icon: '🔥', desc: 'One Forge pushes as hard as 8 Embers. Fewer engines, but one failure hurts more.' },
    srbheavy:  { name: 'Large Solid Boosters',     rp: 100, req: ['srb'],          icon: '🎆', desc: 'Basalt solid boosters: three times the push of a Flint.' },
    frost:     { name: 'Frost Hydrogen Engine',    rp: 110, req: ['lighttanks'],   icon: '❄️', desc: 'Upper-stage engine with the best efficiency. Low thrust, pricey, and hydrogen needs big, heavy tanks.' },
    aerospike: { name: 'Zephyr Aerospike',         rp: 170, req: ['comet'],        icon: '🗡️', desc: 'Methane engine that stays efficient from sea level to space. A little less reliable.' },
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
    let dry = st.prop * tankDryFrac(techs) * tankK(eng) + eng.mass * st.count + 0.6; // tankK = 1 for kerosene/methane
    if (i === 0 && recovery && RECOVERY[recovery].legs) dry += st.prop * 0.006 + 1;
    if (i === 0 && recovery === 'catch') dry += st.prop * 0.002;
    return dry;
  }

  function stageCost(st, techs, i) {
    const eng = ENGINES[st.engine];
    return eng.cost * st.count + st.prop * tankCostPerTon(techs) * tankCostK(eng) + 0.8 + (i === 0 ? 0 : 0.2);
  }

  function fairingCost(techs) { return has(techs, 'fairing') ? 0.1 : 0.5; }

  function designCost(design, techs) {
    return design.stages.reduce((s, st, i) => s + stageCost(st, techs, i), 0) + fairingCost(techs) + srbCost(design); // + strap-on boosters
  }

  function buildDays(design, factoryLvl) {
    const prop = design.stages.reduce((s, st) => s + st.prop, 0);
    const eng = design.stages.reduce((s, st) => s + st.count, 0);
    const srb = srbOf(design);
    const base = 6 + prop * 0.006 + eng * 0.5 + (srb ? srb.count * 0.4 : 0); // strap-ons take a little longer
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
    // Strap-on boosters
    const sb = design.srb;
    if (sb && sb.count) {
      if (!SRBS[sb.type] || !SRB_COUNTS.includes(sb.count)) errs.push('Side boosters: pick a size and 2, 4 or 6.');
      else if (!has(techs, SRBS[sb.type].tech)) errs.push(`${SRBS[sb.type].name} side boosters need research.`);
    }
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
    const srb = srbOf(design);
    for (let i = n - 1; i >= 0; i--) {
      const s = stages[i];
      if (i === 0 && srb) { detail[0] = srbStage1(design, s, srb, above); dv += detail[0].dv; above = detail[0].m0; continue; }
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

  // Stage 1 with strap-on solids: both burn from liftoff (phase A), the empty solids drop,
  // then the core burns on alone (phase B). Landing fuel (reserve) is only held back on the core.
  function srbStage1(design, s, srb, above) {
    const st = design.stages[0], eng = ENGINES[st.engine];
    const cF = (eng.vac ? eng.thrustVac : eng.thrustSL * 0.4 + eng.thrustVac * 0.6) * st.count;
    const cMdot = cF / (s.isp * G0);
    const usable = Math.max(0, s.prop - s.reserve);
    const tA = Math.min(srb.burn, usable / cMdot);
    const coreA = cMdot * tA, srbA = srb.mdot * tA;
    const ispA = (cMdot * s.isp + srb.mdot * srb.isp) / (cMdot + srb.mdot);
    const m0 = above + s.dry + s.prop + srb.dry + srb.prop;
    let m = m0 - coreA - srbA;
    let sdv = ispA * G0 * Math.log(m0 / m);
    const left = srb.prop - srbA;
    if (left > 1e-9) { sdv += srb.isp * G0 * Math.log(m / (m - left)); m -= left; } // solids outlast the core
    m -= srb.dry; // drop the empty solids
    const m1 = above + s.dry + s.reserve;
    if (m > m1) sdv += s.isp * G0 * Math.log(m / m1);
    return { dv: sdv, m0, m1, twr: (s.thrust + srb.thrust) / (m0 * G0), srbDv: ispA * G0 * Math.log(m0 / (m0 - coreA - srbA)), srbBurn: srb.burn, coreBurn: usable / cMdot };
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
  function launchOdds(design, heritage, designFlights) {
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
    const srb = srbOf(design); // each strap-on booster is one more thing that can fail
    return p * (1 - newDesignRisk) * (srb ? srb.rel : 1);
  }

  function binom(n, k) {
    let r = 1;
    for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return r;
  }

  function landingOdds(recovery, landings, techs) {
    if (recovery === 'expend') return 0;
    const tries = (landings && landings[recovery]) || 0;
    let p;
    if (recovery === 'catch') p = 0.6 + 0.06 * tries;
    else if (recovery === 'barge') p = 0.42 + 0.06 * tries;
    else p = 0.48 + 0.06 * tries;
    if (has(techs, 'rapid')) p += 0.05;
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
    { kind: 'crew',      label: 'Crew to orbit',        target: 'LEO', min: 12, max: 12,   rep: 40, a: 45,  b: 0,   client: 'CREW', tech: 'capsule' },
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
    FUELS, SRBS, SRB_COUNTS, srbOf, srbCost, // engines & boosters feature
  };
})(typeof window !== 'undefined' ? window : globalThis);
