// Crypto paper bot. PAPER ONLY: no exchange account, no wallet, no keys, no real money.
// Two pretend $1,000 pots, run by this Worker's cron triggers (Cloudflare, free plan) and
// kept in one Durable Object (SQLite storage, free plan):
//
//   Coin breakout  once a day (00:07 UTC). 32 coins incl. DOGE/SHIB/PEPE/FLOKI/BONK/WIF.
//                  Buy a coin whose daily close breaks its 20-day high on 3x its usual volume,
//                  only while BTC is above its 50-day average. 5 slots of 20%. Sell on a 15%
//                  drop from its best close, or when BTC falls 3% under its 50-day average.
//                  Backtested 2021-now in faint-flex/Ops cryptobot/ (fees included).
//   Meme hunter    every 10 minutes. Trending DEX pools on Solana and Base, heavy rug filters,
//                  then a volume-spike entry. Forward test only: free data can't backtest it
//                  honestly (dead and rugged tokens disappear from the APIs).
//
// The scorecard compares both pots with just holding BTC.
//   GET  /api/crypto            (brief key)  -> { status }
//   POST /api/crypto/run?kind=  (brief key)  run meme|daily now (for checking)

const BINANCE = 'https://data-api.binance.vision/api/v3';
const GECKO = 'https://api.geckoterminal.com/api/v2';
const DEXS = 'https://api.dexscreener.com';
const OKX = 'https://www.okx.com/api/v5/market'; // backup when Binance's data API refuses Cloudflare
const OKX_ID = { '1000SATS': 'SATS' };
const START_USD = 1000;

// ---------- Coin breakout (settings chosen from the robustness grid, not the single best cell) ----------
export const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'TRX', 'SUI', 'NEAR',
  'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'ICP', 'FIL', 'APE', 'GALA', 'SAND', 'MANA', 'AXS', 'UNI', '1000SATS', 'MEME',
  'PEOPLE', 'BOME'];
const BIG = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC', 'TRX', 'SUI', 'NEAR']);
export const BREAKOUT = { look: 20, volX: 3, trail: 0.15, slots: 5, regime: 50 };
const coinFee = (c) => (BIG.has(c) ? 0.0015 : 0.003); // exchange fee + slippage, per side

// ---------- Meme hunter rules ----------
export const MEME = {
  minAgeH: 24, // most rugs happen in a token's first hours
  minLiq: 75_000,
  minVol24: 250_000,
  minCap: 500_000,
  maxVolToLiq: 60, // far more volume than liquidity smells like wash trading
  minBuyers1h: 50,
  spike: 2, // last hour's volume vs the 24h hourly average
  maxH1: 60, maxH24: 300, // don't buy the vertical part
  size: 0.10, slots: 5, maxBuysPerRun: 2,
  stop: 0.30, trailFrom: 0.30, trail: 0.25, staleH: 72, cooldownH: 48,
  fee: 0.01, // DEX fee + priority fee, per side; price impact is added on top
};
const SKIP_SYMBOLS = new Set(['SOL', 'WSOL', 'USDC', 'USDT', 'WETH', 'ETH', 'WBTC', 'CBBTC', 'USDS', 'DAI', 'EURC', 'JITOSOL', 'MSOL']);
const CHAINS = { solana: 'solana', base: 'base' }; // GeckoTerminal network -> DexScreener chain

const num = (v) => (v == null || v === '' ? NaN : Number(v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const sma = (xs, n) => (xs.length >= n ? xs.slice(-n).reduce((a, b) => a + b, 0) / n : null);

function fresh(now) {
  return {
    started: new Date(now).toISOString(),
    btc_start: null,
    breakout: { cash: START_USD, pos: {}, trades: 0, wins: 0, last_day: null },
    meme: { cash: START_USD, pos: {}, trades: 0, wins: 0, rugs: 0, cooldown: {}, rejected: {}, scans: 0 },
    log: [],
    prices: {},
  };
}

function note(state, entry) {
  state.log.unshift(entry);
  state.log.length = Math.min(state.log.length, 60);
}

async function getJson(fetcher, url) {
  const r = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// ============ Coin breakout ============

/** Pure signal step on closed daily candles. bars: coin -> [{high, close, vol}] oldest first. */
export function breakoutStep(book, bars, p = BREAKOUT) {
  const closes = (c) => bars[c].map((b) => b.close);
  const px = Object.fromEntries(Object.entries(bars).filter(([, b]) => b.length).map(([c, b]) => [c, b.at(-1).close]));
  const btc = closes('BTC');
  const m = sma(btc, p.regime);
  const riskOff = m != null && btc.at(-1) < m * 0.97;
  const sells = [];
  for (const [c, pos] of Object.entries(book.pos)) {
    if (!(c in px)) continue;
    if (px[c] <= pos.peak * (1 - p.trail) || riskOff) sells.push([c, riskOff && px[c] > pos.peak * (1 - p.trail) ? 'BTC trend broke' : `fell ${p.trail * 100}% from its best`]);
  }
  for (const pos of Object.values(book.pos)) pos.peak = Math.max(pos.peak, px[pos.coin] ?? pos.peak);
  const buys = [];
  if (m != null && btc.at(-1) >= m) {
    const cand = [];
    for (const c of Object.keys(bars)) {
      const b = bars[c];
      if (c in book.pos || b.length < p.look + 1) continue;
      const prior = b.slice(-p.look - 1, -1);
      const hi = Math.max(...prior.map((x) => x.high));
      const avgV = prior.reduce((a, x) => a + x.vol, 0) / p.look;
      const last = b.at(-1);
      if (last.close > hi && avgV > 0 && last.vol > p.volX * avgV) cand.push([last.vol / avgV, c]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    const free = p.slots - (Object.keys(book.pos).length - sells.length);
    for (const [ratio, c] of cand.slice(0, Math.max(0, free))) buys.push([c, `broke its 20-day high on ${ratio.toFixed(1)}x volume`]);
  }
  return { px, sells, buys, regime: m == null ? null : btc.at(-1) >= m };
}

async function dailyBars(fetcher, coin, now, source) {
  if (source === 'okx') {
    const j = await getJson(fetcher, `${OKX}/candles?instId=${OKX_ID[coin] || coin}-USDT&bar=1Dutc&limit=60`);
    if (j.code !== '0') throw new Error(`okx ${coin} ${j.msg || j.code}`);
    return j.data.filter((r) => r[8] === '1').reverse().map((r) => ({ t: +r[0], high: +r[2], close: +r[4], vol: +r[7] }));
  }
  const rows = await getJson(fetcher, `${BINANCE}/klines?symbol=${coin}USDT&interval=1d&limit=60`);
  return rows.filter((r) => r[6] < now).map((r) => ({ t: r[0], high: +r[2], close: +r[4], vol: +r[7] }));
}

export async function runDaily(state, fetcher, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const book = state.breakout;
  if (book.last_day === day) return { skipped: 'already ran today' };
  // One source for all coins (volumes differ between exchanges): Binance, else OKX.
  let source = book.source || 'binance';
  try { await dailyBars(fetcher, 'BTC', now, source); } catch { source = source === 'okx' ? 'binance' : 'okx'; }
  const bars = {};
  const errors = [];
  const got = await Promise.allSettled(COINS.map((c) => dailyBars(fetcher, c, now, source)));
  got.forEach((g, i) => { if (g.status === 'fulfilled' && g.value.length) bars[COINS[i]] = g.value; else errors.push(COINS[i]); });
  if (!bars.BTC?.length) throw new Error(`no BTC candles (${got[0].reason?.message || 'empty'})`);
  book.source = source;
  const { px, sells, buys, regime } = breakoutStep(book, bars);
  const at = new Date(now).toISOString();
  for (const [c, why] of sells) {
    const pos = book.pos[c];
    const usd = pos.units * px[c] * (1 - coinFee(c));
    book.cash += usd;
    const pnl = usd / pos.cost - 1;
    book.trades += 1; if (pnl > 0) book.wins += 1;
    note(state, { at, pot: 'breakout', act: 'sell', sym: c, price: px[c], usd: round(usd), pnl_pct: round(pnl * 100, 1), why });
    delete book.pos[c];
  }
  const equity = book.cash + Object.values(book.pos).reduce((a, p) => a + p.units * (px[p.coin] ?? p.entry), 0);
  for (const [c, why] of buys) {
    const usd = Math.min(book.cash, equity / BREAKOUT.slots);
    if (usd < 1) break;
    book.cash -= usd;
    book.pos[c] = { coin: c, units: (usd * (1 - coinFee(c))) / px[c], entry: px[c], peak: px[c], cost: usd, at };
    note(state, { at, pot: 'breakout', act: 'buy', sym: c, price: px[c], usd: round(usd), why });
  }
  book.last_day = day;
  book.regime = regime;
  Object.assign(state.prices, Object.fromEntries(Object.entries(px).map(([c, v]) => [`${c}USDT`, v])));
  return { sells: sells.length, buys: buys.length, regime, missing: errors };
}

// ============ Meme hunter ============

/** Numeric filters on a GeckoTerminal pool. Returns a reason string, or '' when it passes. */
export function memeReject(pool, now, held = {}, cooldown = {}) {
  const a = pool.attributes || {};
  const base = pool.relationships?.base_token?.data?.id || '';
  const addr = base.slice(base.indexOf('_') + 1);
  const sym = String(a.name || '').split(' / ')[0].trim().toUpperCase();
  if (!addr || SKIP_SYMBOLS.has(sym)) return 'not a meme coin';
  if (held[addr]) return 'already held';
  if (cooldown[addr] && now - cooldown[addr] < MEME.cooldownH * 3600e3) return 'sold recently';
  const ageH = (now - Date.parse(a.pool_created_at)) / 3600e3;
  if (!(ageH >= MEME.minAgeH)) return 'too new (rug risk)';
  const liq = num(a.reserve_in_usd);
  if (!(liq >= MEME.minLiq)) return 'too little liquidity';
  const v24 = num(a.volume_usd?.h24), v1 = num(a.volume_usd?.h1);
  if (!(v24 >= MEME.minVol24)) return 'too little volume';
  const cap = num(a.market_cap_usd) || num(a.fdv_usd);
  if (!(cap >= MEME.minCap)) return 'too small';
  if (v24 / liq > MEME.maxVolToLiq) return 'looks like wash trading';
  const tx = a.transactions?.h1 || {};
  if (!((tx.buyers ?? 0) >= MEME.minBuyers1h)) return 'too few buyers';
  if (!((tx.buys ?? 0) >= (tx.sells ?? 0))) return 'more sellers than buyers';
  const ch = a.price_change_percentage || {};
  if (!(num(ch.m15) > 0 && num(ch.h1) > 0)) return 'not rising now';
  if (num(ch.h1) > MEME.maxH1 || num(ch.h24) > MEME.maxH24) return 'already pumped too far';
  if (!(v1 >= MEME.spike * (v24 / 24))) return 'no volume spike';
  return '';
}

/** Safety check on the token contract. Fails closed: no answer means no trade. */
export async function safetyCheck(fetcher, network, addr) {
  try {
    if (network === 'solana') {
      const s = await getJson(fetcher, `https://api.rugcheck.xyz/v1/tokens/${addr}/report/summary`);
      const danger = (s.risks || []).filter((r) => r.level === 'danger').map((r) => r.name);
      if (danger.length) return `rug flags: ${danger.join(', ')}`;
      if (!(num(s.score_normalised) <= 50)) return 'high rug score';
      return '';
    }
    const g = await getJson(fetcher, `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${addr}`);
    const t = g.result?.[addr.toLowerCase()];
    if (!t) return 'no safety data';
    const bad = ['is_honeypot', 'is_mintable', 'owner_change_balance', 'hidden_owner', 'can_take_back_ownership',
      'transfer_pausable', 'cannot_sell_all', 'slippage_modifiable', 'is_blacklisted', 'selfdestruct', 'external_call']
      .filter((k) => t[k] === '1');
    if (bad.length) return `contract flags: ${bad.join(', ')}`;
    if (t.is_open_source !== '1') return 'contract code hidden';
    if (num(t.buy_tax || 0) > 0.05 || num(t.sell_tax || 0) > 0.05) return 'high tax';
    const top = (t.holders || []).filter((h) => String(h.is_contract) !== '1' && String(h.is_locked) !== '1')
      .slice(0, 10).reduce((s, h) => s + num(h.percent || 0), 0);
    if (top > 0.4) return 'a few wallets hold too much';
    return '';
  } catch {
    return 'safety check unavailable';
  }
}

/** Price impact of a trade against a constant-product pool holding `liq` USD in total. */
export const impact = (usd, liq) => (liq > 0 ? Math.min(0.9, usd / (liq / 2)) : 0.9);

async function memePrices(fetcher, positions) {
  const out = {};
  const byChain = {};
  for (const p of positions) (byChain[p.chain] ||= []).push(p);
  await Promise.all(Object.entries(byChain).map(async ([chain, list]) => {
    const pairs = await getJson(fetcher, `${DEXS}/tokens/v1/${chain}/${list.map((p) => p.addr).join(',')}`);
    for (const p of list) {
      const mine = (pairs || []).filter((x) => x.baseToken?.address?.toLowerCase() === p.addr.toLowerCase());
      const pick = mine.find((x) => x.pairAddress === p.pool) || mine.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      out[p.addr] = pick ? { price: num(pick.priceUsd), liq: num(pick.liquidity?.usd) } : { price: NaN, liq: 0 };
    }
  }));
  return out;
}

export async function runMeme(state, fetcher, now) {
  const book = state.meme;
  const at = new Date(now).toISOString();
  const open = Object.values(book.pos);
  let priced = {};
  if (open.length) priced = await memePrices(fetcher, open);
  // ---- exits ----
  for (const p of open) {
    const q = priced[p.addr];
    if (!q) continue;
    const ageH = (now - Date.parse(p.at)) / 3600e3;
    let why = '';
    let rug = false;
    // A token missing from the price feed 3 runs in a row (30 min), or with almost no liquidity, was rugged.
    p.misses = q.price > 0 ? 0 : (p.misses || 0) + 1;
    if (p.misses >= 3 || (q.price > 0 && q.liq < 5_000)) { why = 'liquidity vanished (rug)'; rug = true; }
    else if (!(q.price > 0)) continue;
    else if (q.liq < p.liq0 * 0.4) why = 'liquidity pulled out';
    else if (q.price <= p.entry * (1 - MEME.stop)) why = `stop loss (-${MEME.stop * 100}%)`;
    else if (p.peak >= p.entry * (1 + MEME.trailFrom) && q.price <= p.peak * (1 - MEME.trail)) why = `fell ${MEME.trail * 100}% from its best`;
    else if (ageH > MEME.staleH && q.price < p.entry * 1.1) why = `went nowhere in ${MEME.staleH}h`;
    if (q.price > 0) { p.peak = Math.max(p.peak, q.price); p.last = q.price; p.liq = q.liq; }
    if (!why) continue;
    const value = rug ? 0 : p.units * q.price;
    const usd = rug ? 0 : value * (1 - MEME.fee - impact(value, q.liq));
    book.cash += usd;
    const pnl = usd / p.cost - 1;
    book.trades += 1; if (pnl > 0) book.wins += 1; if (rug) book.rugs += 1;
    note(state, { at, pot: 'meme', act: 'sell', sym: p.sym, chain: p.chain, price: q.price || 0, usd: round(usd), pnl_pct: round(pnl * 100, 1), why });
    book.cooldown[p.addr] = now;
    delete book.pos[p.addr];
  }
  for (const [a, t] of Object.entries(book.cooldown)) if (now - t > MEME.cooldownH * 3600e3) delete book.cooldown[a];
  // ---- entries ----
  const slots = MEME.slots - Object.keys(book.pos).length;
  const equity = memeEquity(book);
  if (slots <= 0 || book.cash < 20) return { exits: open.length - Object.keys(book.pos).length, buys: 0 };
  const pools = [];
  const errs = [];
  for (const net of Object.keys(CHAINS)) {
    try {
      const j = await getJson(fetcher, `${GECKO}/networks/${net}/trending_pools?duration=1h&page=1`);
      for (const pool of j.data || []) pools.push([net, pool]);
    } catch (e) { errs.push(e.message); }
  }
  if (!pools.length) {
    // GeckoTerminal rate-limits Cloudflare's shared addresses; DexScreener's newest
    // profiles and boosted tokens (social/promo buzz) are the backup list.
    try { pools.push(...(await dexCandidates(fetcher))); book.source = 'dexscreener'; } catch (e) { errs.push(e.message); }
  } else book.source = 'geckoterminal';
  book.scans += 1;
  const passed = [];
  const seen = new Set();
  for (const [net, pool] of pools) {
    const why = memeReject(pool, now, book.pos, book.cooldown);
    const id = pool.relationships?.base_token?.data?.id || pool.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (why) { book.rejected[why] = (book.rejected[why] || 0) + 1; continue; }
    const a = pool.attributes;
    passed.push({ net, pool, spike: num(a.volume_usd.h1) / (num(a.volume_usd.h24) / 24) });
  }
  passed.sort((a, b) => b.spike - a.spike);
  let buys = 0;
  for (const c of passed.slice(0, 4)) {
    if (buys >= Math.min(slots, MEME.maxBuysPerRun) || book.cash < 20) break;
    const a = c.pool.attributes;
    const id = c.pool.relationships.base_token.data.id;
    const addr = id.slice(id.indexOf('_') + 1);
    const unsafe = await safetyCheck(fetcher, c.net, addr);
    if (unsafe) { const k = unsafe.split(':')[0]; book.rejected[k] = (book.rejected[k] || 0) + 1; continue; }
    const price = num(a.base_token_price_usd);
    const liq = num(a.reserve_in_usd);
    const usd = Math.min(book.cash, equity * MEME.size);
    const fill = price * (1 + MEME.fee + impact(usd, liq)); // pay up for fees and slippage
    book.cash -= usd;
    const sym = String(a.name).split(' / ')[0].trim();
    book.pos[addr] = { addr, sym, chain: CHAINS[c.net], pool: a.address, units: usd / fill, entry: price, peak: price, last: price, cost: usd, liq0: liq, liq, at };
    note(state, { at, pot: 'meme', act: 'buy', sym, chain: CHAINS[c.net], price, usd: round(usd), why: `${c.spike.toFixed(1)}x volume spike, passed rug checks` });
    buys += 1;
  }
  book.last_scan = at;
  book.scan_errors = errs;
  return { pools: pools.length, passed: passed.length, buys, errors: errs };
}

/** A DexScreener pair in the GeckoTerminal pool shape that memeReject reads. */
export function fromDexPair(x) {
  const net = Object.keys(CHAINS).find((k) => CHAINS[k] === x.chainId);
  const tx = x.txns?.h1 || {};
  return [net, {
    id: `${net}_${x.pairAddress}`,
    relationships: { base_token: { data: { id: `${net}_${x.baseToken?.address}` } } },
    attributes: {
      name: `${x.baseToken?.symbol} / ${x.quoteToken?.symbol}`, address: x.pairAddress,
      pool_created_at: x.pairCreatedAt ? new Date(x.pairCreatedAt).toISOString() : null,
      reserve_in_usd: x.liquidity?.usd, market_cap_usd: x.marketCap, fdv_usd: x.fdv, base_token_price_usd: x.priceUsd,
      volume_usd: { h1: x.volume?.h1, h24: x.volume?.h24 },
      // DexScreener has no unique-buyer count; half the buy count is a rough stand-in.
      transactions: { h1: { buys: tx.buys, sells: tx.sells, buyers: Math.floor((tx.buys || 0) / 2) } },
      price_change_percentage: { m15: x.priceChange?.m5, h1: x.priceChange?.h1, h24: x.priceChange?.h24 },
    },
  }];
}

async function dexCandidates(fetcher) {
  const lists = await Promise.all(['token-profiles/latest/v1', 'token-boosts/latest/v1', 'token-boosts/top/v1']
    .map((path) => getJson(fetcher, `${DEXS}/${path}`).catch(() => [])));
  const want = {};
  for (const t of lists.flat()) {
    const chain = t?.chainId;
    if (!Object.values(CHAINS).includes(chain) || !t.tokenAddress) continue;
    (want[chain] ||= new Set()).add(t.tokenAddress);
  }
  const out = [];
  for (const [chain, set] of Object.entries(want)) {
    const pairs = await getJson(fetcher, `${DEXS}/tokens/v1/${chain}/${[...set].slice(0, 30).join(',')}`);
    const best = {};
    for (const x of pairs || []) {
      const a = x.baseToken?.address;
      if (a && set.has(a) && (!best[a] || (x.liquidity?.usd || 0) > (best[a].liquidity?.usd || 0))) best[a] = x;
    }
    out.push(...Object.values(best).map(fromDexPair));
  }
  if (!out.length) throw new Error('dexscreener: no candidates');
  return out;
}

const memeEquity = (book) => book.cash + Object.values(book.pos).reduce((a, p) => a + p.units * (p.last ?? p.entry), 0);

// ============ Scorecard ============

async function livePrices(fetcher, symbols) {
  try {
    const j = await getJson(fetcher, `${BINANCE}/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`);
    return Object.fromEntries(j.map((x) => [x.symbol, num(x.price)]));
  } catch {
    const got = await Promise.all(symbols.map(async (sym) => {
      const coin = sym.replace(/USDT$/, '');
      const j = await getJson(fetcher, `${OKX}/ticker?instId=${OKX_ID[coin] || coin}-USDT`).catch(() => null);
      return [sym, num(j?.data?.[0]?.last)];
    }));
    return Object.fromEntries(got.filter(([, v]) => v > 0));
  }
}

export async function refreshPrices(state, fetcher) {
  const syms = ['BTCUSDT', ...Object.keys(state.breakout.pos).map((c) => `${c}USDT`)];
  try { Object.assign(state.prices, await livePrices(fetcher, [...new Set(syms)])); } catch { /* keep the last prices */ }
  if (!state.btc_start && state.prices.BTCUSDT) state.btc_start = state.prices.BTCUSDT;
}

export function scorecard(state) {
  const b = state.breakout;
  const bVal = b.cash + Object.values(b.pos).reduce((a, p) => a + p.units * (state.prices[`${p.coin}USDT`] ?? p.entry), 0);
  const mVal = memeEquity(state.meme);
  const btc = state.prices.BTCUSDT && state.btc_start ? (100 * state.prices.BTCUSDT) / state.btc_start : null;
  const per100 = (v) => round((100 * v) / START_USD);
  return {
    started: state.started,
    updated: state.updated,
    breakout_100_is_now: per100(bVal),
    meme_100_is_now: per100(mVal),
    btc_hold_100_is_now: btc == null ? null : round(btc),
    breakout: {
      trades: b.trades, wins: b.wins, btc_uptrend: b.regime ?? null, last_day: b.last_day,
      open: Object.values(b.pos).map((p) => ({ sym: p.coin, pnl_pct: round(((state.prices[`${p.coin}USDT`] ?? p.entry) / p.entry - 1) * 100, 1) })),
    },
    meme: {
      trades: state.meme.trades, wins: state.meme.wins, rugs: state.meme.rugs, scans: state.meme.scans, last_scan: state.meme.last_scan,
      open: Object.values(state.meme.pos).map((p) => ({ sym: p.sym, chain: p.chain, pnl_pct: round(((p.last ?? p.entry) / p.entry - 1) * 100, 1) })),
      rejected: state.meme.rejected,
    },
    recent: state.log.slice(0, 12),
  };
}

// ============ Plumbing ============

/** One run against a storage object (Durable Object storage, or a Map-like fake in tests). */
export async function runBot(storage, kind, fetcher = fetch, now = Date.now()) {
  const state = (await storage.get('state')) || fresh(now);
  let result;
  try {
    result = kind === 'daily' ? await runDaily(state, fetcher, now) : await runMeme(state, fetcher, now);
  } catch (e) {
    result = { error: e.message };
  }
  await refreshPrices(state, fetcher);
  state.updated = new Date(now).toISOString();
  state.last = { kind, at: state.updated, result };
  await storage.put('state', state);
  return result;
}

export class CryptoBot {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const result = await runBot(this.ctx.storage, url.searchParams.get('kind') === 'daily' ? 'daily' : 'meme');
      return Response.json({ result });
    }
    const state = await this.ctx.storage.get('state');
    return Response.json({ status: state ? { ...scorecard(state), last: state.last } : null });
  }
}

const bot = (env) => env.CRYPTO_BOT.get(env.CRYPTO_BOT.idFromName('paper'));

export async function cryptoScheduled(controller, env) {
  if (!env.CRYPTO_BOT) return;
  const kind = controller.cron === '7 0 * * *' ? 'daily' : 'meme';
  await bot(env).fetch(`https://bot/run?kind=${kind}`);
}

export async function cryptoApi(request, env, url) {
  if (!env.CRYPTO_BOT) return Response.json({ error: 'The crypto bot is not set up on this deployment.' }, { status: 501 });
  if (url.pathname === '/api/crypto/run' && request.method === 'POST') {
    return bot(env).fetch(`https://bot/run?kind=${url.searchParams.get('kind') === 'daily' ? 'daily' : 'meme'}`);
  }
  return bot(env).fetch('https://bot/status');
}
