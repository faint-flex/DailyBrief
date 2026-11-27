import test from 'node:test';
import assert from 'node:assert/strict';
import { setPause, breakoutStep, memeReject, safetyCheck, runBot, scorecard, impact, BREAKOUT } from '../src/cryptobot.js';

setPause(async () => {});
const flat = (n, close = 100, vol = 1000) => Array.from({ length: n }, () => ({ high: close, close, vol }));
const store = () => { const m = new Map(); return { m, get: async (k) => structuredClone(m.get(k)), put: async (k, v) => m.set(k, structuredClone(v)) }; };
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

test('breakout buys a coin breaking its 20-day high on 3x volume while BTC trends up', () => {
  const btc = Array.from({ length: 60 }, (_, i) => ({ high: 100 + i, close: 100 + i, vol: 1 }));
  const bars = { BTC: btc, PEPE: [...flat(59), { high: 120, close: 120, vol: 4000 }], DOGE: [...flat(59), { high: 120, close: 120, vol: 2000 }] };
  const book = { pos: {} };
  const r = breakoutStep(book, bars);
  assert.equal(r.regime, true);
  assert.deepEqual(r.buys.map((b) => b[0]), ['PEPE']); // DOGE only had 2x volume
});

test('breakout sells on a 15% drop from the best close, and buys nothing when BTC trends down', () => {
  const btc = Array.from({ length: 60 }, (_, i) => ({ high: 200 - i, close: 200 - i, vol: 1 }));
  const bars = { BTC: btc, PEPE: [...flat(59), { high: 84, close: 84, vol: 9000 }] };
  const book = { pos: { PEPE: { coin: 'PEPE', units: 1, entry: 90, peak: 100 } } };
  const r = breakoutStep(book, bars);
  assert.equal(r.regime, false);
  assert.equal(r.sells.length, 1);
  assert.equal(r.buys.length, 0);
  assert.equal(BREAKOUT.trail, 0.15);
});

const pool = (over = {}) => ({
  id: 'solana_POOL', relationships: { base_token: { data: { id: 'solana_MINT1' } } },
  attributes: {
    name: 'FROG / SOL', address: 'POOL', pool_created_at: '2026-11-20T00:00:00Z', reserve_in_usd: '200000',
    market_cap_usd: '3000000', base_token_price_usd: '0.01',
    volume_usd: { h1: '60000', h24: '480000' },
    transactions: { h1: { buys: 300, sells: 200, buyers: 120 } },
    price_change_percentage: { m15: '3', h1: '8', h24: '40' }, ...over,
  },
});
const NOW = Date.parse('2026-11-24T12:00:00Z');

test('meme filters pass a healthy pool and reject the usual traps', () => {
  assert.equal(memeReject(pool(), NOW), '');
  assert.equal(memeReject(pool({ pool_created_at: '2026-11-24T06:00:00Z' }), NOW), 'too new (rug risk)');
  assert.equal(memeReject(pool({ reserve_in_usd: '20000' }), NOW), 'too little liquidity');
  assert.equal(memeReject(pool({ price_change_percentage: { m15: '3', h1: '8', h24: '900' } }), NOW), 'already pumped too far');
  assert.equal(memeReject(pool({ volume_usd: { h1: '10000', h24: '480000' } }), NOW), 'no volume spike');
  assert.equal(memeReject(pool({ transactions: { h1: { buys: 100, sells: 300, buyers: 90 } } }), NOW), 'more sellers than buyers');
  assert.equal(memeReject(pool({ name: 'WETH / SOL' }), NOW), 'not a meme coin');
  assert.equal(memeReject(pool(), NOW, { MINT1: {} }), 'already held');
});

test('safety check fails closed and reads rug flags', async () => {
  const danger = async () => ok({ score_normalised: 60, risks: [{ name: 'Mint Authority still enabled', level: 'danger' }] });
  assert.match(await safetyCheck(danger, 'solana', 'M'), /Mint Authority/);
  assert.equal(await safetyCheck(async () => ok({ score_normalised: 1, risks: [] }), 'solana', 'M'), '');
  assert.equal(await safetyCheck(async () => new Response('', { status: 500 }), 'solana', 'M'), 'safety check unavailable');
  const honeypot = async () => ok({ result: { '0xabc': { is_honeypot: '1', is_open_source: '1' } } });
  assert.match(await safetyCheck(honeypot, 'base', '0xABC'), /honeypot/);
  const fine = async () => ok({ result: { '0xabc': { is_open_source: '1', buy_tax: '0', sell_tax: '0.01', holders: [{ percent: '0.05', is_contract: 0 }] } } });
  assert.equal(await safetyCheck(fine, 'base', '0xABC'), '');
});

test('price impact grows with trade size against liquidity', () => {
  assert.equal(impact(100, 200000), 0.001);
  assert.equal(impact(100, 0), 0.9);
});

test('a meme run buys a passing pool, then a rug is booked as a total loss', async () => {
  const s = store();
  let rugged = false;
  const fetcher = async (url) => {
    if (url.includes('trending_pools')) return ok({ data: url.includes('/solana/') ? [pool()] : [] });
    if (url.includes('rugcheck')) return ok({ score_normalised: 1, risks: [] });
    if (url.includes('ticker/price')) return ok([{ symbol: 'BTCUSDT', price: '90000' }]);
    if (url.includes('dexscreener')) return ok(rugged ? [] : [{ baseToken: { address: 'MINT1' }, pairAddress: 'POOL', priceUsd: '0.012', liquidity: { usd: 200000 } }]);
    throw new Error(`unexpected ${url}`);
  };
  const r = await runBot(s, 'meme', fetcher, NOW);
  assert.equal(r.buys, 1);
  let st = scorecard(s.m.get('state'));
  assert.equal(st.meme.open[0].sym, 'FROG');
  assert.equal(st.btc_hold_100_is_now, 100);
  await runBot(s, 'meme', fetcher, NOW + 600e3); // price up 20%: hold
  st = scorecard(s.m.get('state'));
  assert.equal(st.meme.open.length, 1);
  assert.ok(st.meme_100_is_now > 100);
  rugged = true;
  await runBot(s, 'meme', fetcher, NOW + 1200e3);
  assert.equal(scorecard(s.m.get('state')).meme.open.length, 1); // one missing price could be a glitch
  await runBot(s, 'meme', fetcher, NOW + 1800e3);
  await runBot(s, 'meme', fetcher, NOW + 2400e3);
  st = scorecard(s.m.get('state'));
  assert.equal(st.meme.rugs, 1);
  assert.equal(st.meme_100_is_now, 90); // the $100 slot is gone
  assert.equal(st.recent[0].why, 'liquidity vanished (rug)');
});

test('a failing data source is recorded, not thrown', async () => {
  const s = store();
  const r = await runBot(s, 'daily', async () => new Response('', { status: 451 }), NOW);
  assert.match(r.error, /no BTC candles/);
  assert.ok(s.m.get('state').last.result.error);
});

test('scalper: buys a fresh mover, banks half at +25%, and books a rug as a loss', async () => {
  const { runBot: rb, scorecard: sc, SCALP } = await import('../src/cryptobot.js');
  const s = store();
  let price = '0.01';
  let gone = false;
  const pair = () => ({ chainId: 'solana', pairAddress: 'P1', baseToken: { address: 'NEW1', symbol: 'ZOOM' }, quoteToken: { symbol: 'SOL' },
    priceUsd: price, liquidity: { usd: 40000 }, volume: { m5: 9000 }, priceChange: { m5: 8, h1: 20 }, txns: { m5: { buys: 50, sells: 20 } } });
  const fetcher = async (url) => {
    if (url.includes('token-profiles') || url.includes('token-boosts')) return ok([{ chainId: 'solana', tokenAddress: 'NEW1' }]);
    if (url.includes('/tokens/v1/')) return ok(gone ? [] : [pair()]);
    if (url.includes('rugcheck')) return ok({ risks: [{ name: 'Mint Authority still enabled', level: 'danger' }] }); // rug risk is accepted
    throw new Error(`unexpected ${url}`);
  };
  assert.equal((await rb(s, 'scalp', fetcher, NOW)).buys, 1);
  assert.equal(s.m.get('scalp').pos.NEW1.cost, 1000 * SCALP.size);
  price = '0.013';
  await rb(s, 'scalp', fetcher, NOW + 120e3);
  assert.equal(s.m.get('scalp').pos.NEW1.half, true);
  gone = true;
  await rb(s, 'scalp', fetcher, NOW + 240e3);
  await rb(s, 'scalp', fetcher, NOW + 360e3);
  const b = s.m.get('scalp');
  assert.equal(b.rugs, 1);
  assert.ok(b.log[0].pnl_pct < 0 && b.log[0].pnl_pct > -50); // the banked half softened it
  assert.equal(sc({ ...s.m.get('scalp'), breakout: { cash: 1000, pos: {}, trades: 0, wins: 0 }, meme: { cash: 1000, pos: {} }, log: [], prices: {} }, b).scalp.rugs, 1);
});

test('scalper refuses tokens it could not sell', async () => {
  const { canSell } = await import('../src/cryptobot.js');
  assert.match(await canSell(async () => ok({ risks: [{ name: 'Freeze Authority still enabled', level: 'danger' }] }), 'solana', 'M'), /can't sell/);
  assert.equal(await canSell(async () => ok({ risks: [{ name: 'Large Amount of LP Unlocked', level: 'danger' }] }), 'solana', 'M'), '');
  assert.match(await canSell(async () => ok({ result: { '0xa': { is_honeypot: '1' } } }), 'base', '0xA'), /honeypot/);
});

test('scalper learns: a mistake in 3 of the last losses moves one rule one step, within limits', async () => {
  const { adapt, diagnose, rulesOf, TUNABLE, lessonText } = await import('../src/cryptobot.js');
  const book = { started: '2026-11-26T00:00:00Z', losses: [], params: {} };
  const r = rulesOf(book);
  const chase = { sym: 'X', pnl_pct: -20, best_pct: 0.5, sig: { m5: 35, vol5m: 20000, liq: 80000, ratio: 3 }, exit_impact_pct: 0.1 };
  assert.deepEqual(diagnose(chase, r), ['chased']);
  assert.match(lessonText({ ...chase, tags: ['chased'] }), /big 5-min jump/);
  for (let i = 0; i < 2; i += 1) book.losses.unshift({ ...chase, tags: ['chased'], final: true });
  assert.equal(adapt(book, NOW), null); // two losses are not a pattern
  book.losses.unshift({ ...chase, tags: ['chased'], final: true });
  const ch = adapt(book, NOW);
  assert.equal(book.params.maxM5, 35);
  assert.match(ch.why, /3 of the last 3 losses/);
  assert.equal(adapt(book, NOW), null); // waits for 3 more losses before moving it again
  book.since_change.maxM5 = 3;
  for (let i = 0; i < 20; i += 1) { book.since_change.maxM5 = 3; adapt(book, NOW); }
  assert.equal(book.params.maxM5, TUNABLE.maxM5.min); // never past the floor
});

test('scalper post-mortem watches a stopped-out coin and flags a stop that was too tight', async () => {
  const s = store();
  let price = '0.01';
  const pair = () => ({ chainId: 'solana', pairAddress: 'P1', baseToken: { address: 'NEW1', symbol: 'ZOOM' }, quoteToken: { symbol: 'SOL' },
    priceUsd: price, liquidity: { usd: 90000 }, volume: { m5: 20000 }, priceChange: { m5: 6, h1: 20 }, txns: { m5: { buys: 90, sells: 20 } } });
  const fetcher = async (url) => {
    if (url.includes('token-profiles') || url.includes('token-boosts')) return ok([{ chainId: 'solana', tokenAddress: 'NEW1' }]);
    if (url.includes('/tokens/v1/')) return ok([pair()]);
    if (url.includes('rugcheck')) return ok({ risks: [] });
    throw new Error(`unexpected ${url}`);
  };
  await runBot(s, 'scalp', fetcher, NOW);
  price = '0.008'; // -20%: stop
  await runBot(s, 'scalp', fetcher, NOW + 120e3);
  let b = s.m.get('scalp');
  assert.equal(b.losses.length, 1);
  assert.equal(b.losses[0].final, false);
  price = '0.0115'; // bounces above the buy price while watched
  await runBot(s, 'scalp', fetcher, NOW + 20 * 60e3);
  await runBot(s, 'scalp', fetcher, NOW + 35 * 60e3);
  b = s.m.get('scalp');
  const pm = b.losses.find((l) => l.sym === 'ZOOM' && l.final);
  assert.ok(pm.tags.includes('stop_too_tight'));
  assert.match(pm.lesson, /recovered above the buy price/);
  const card = scorecard({ breakout: { cash: 1000, pos: {}, trades: 0, wins: 0 }, meme: { cash: 1000, pos: {} }, log: [], prices: {} }, b);
  assert.equal(card.scalp.rules['stop loss'], '-15%');
  assert.ok(card.scalp.lessons.length >= 1);
});

test('dashboard: history gets a point every 30 minutes and health flags late runs', async () => {
  const { recordHistory, dashboard } = await import('../src/cryptobot.js');
  const s = store();
  const state = { started: '2026-11-24T00:00:00Z', btc_start: 100, prices: { BTCUSDT: 110 }, breakout: { cash: 1000, pos: {}, trades: 0, wins: 0 },
    meme: { cash: 900, pos: {}, rejected: {} }, log: [{ at: '2026-11-25T00:00:00Z', pot: 'meme', act: 'buy', sym: 'A', usd: 100 }], runs: { meme: { at: new Date().toISOString(), result: {} } } };
  await recordHistory(s, state, NOW);
  await recordHistory(s, state, NOW + 10 * 60e3);
  const h = await recordHistory(s, state, NOW + 31 * 60e3);
  assert.equal(h.length, 2);
  assert.deepEqual([h[0].m, h[0].btc], [90, 110]);
  const d = dashboard(state, null, h);
  assert.equal(d.trades[0].pot, 'Meme hunter');
  assert.equal(d.health[0].late, false);
  assert.equal(d.health[1].late, true); // the daily check has never run
});
