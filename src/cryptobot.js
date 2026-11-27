// Crypto paper bot. PAPER ONLY: no exchange account, no wallet, no keys, no real money.
// Two pretend $1,000 pots, run by this Worker's cron triggers (Cloudflare, free plan) and
// kept in one Durable Object (SQLite storage, free plan):
//
//   Coin breakout  once a day (first hourly try after 00:00 UTC that gets candles). 32 coins incl. DOGE/SHIB/PEPE/FLOKI/BONK/WIF.
//                  Buy a coin whose daily close breaks its 20-day high on 3x its usual volume,
//                  only while BTC is above its 50-day average. 5 slots of 20%. Sell on a 15%
//                  drop from its best close, or when BTC falls 3% under its 50-day average.
//                  Backtested 2021-now in faint-flex/Ops cryptobot/ (fees included).
//   Meme hunter    every 10 minutes. Trending DEX pools on Solana and Base, heavy rug filters,
//                  then a volume-spike entry. Forward test only: free data can't backtest it
//                  honestly (dead and rugged tokens disappear from the APIs).
//   Meme scalper   every 2 minutes (LyFe 11-26: "quick trades scaling gains", no rug filter).
//                  Brand-new DexScreener tokens moving up in the last 5 minutes. No age or rug
//                  filters; only "can it be sold at all" checks (freeze authority, honeypot,
//                  blacklist, sell tax, $10k liquidity). 5% slots, sell half at +25%, trail the
//                  rest 15% from its best, stop at -15%, out after 60 minutes whatever happens.
//                  Self-adapting (LyFe 11-26): every losing trade gets a post-mortem (was the entry
//                  a chase, too thin, weak volume or buyers, did the price recover after the stop?).
//                  When the same mistake shows up in 3 of the last 6 losses, one rule moves one
//                  step, inside fixed limits. If it goes 6 hours without a buy it eases one step back.
//
// The scorecard compares all pots with just holding BTC.
//   GET  /api/crypto            (brief key)  -> { status }
//   POST /api/crypto/run?kind=  (brief key)  run meme|daily now (for checking)

const BINANCE = 'https://data-api.binance.vision/api/v3';
const GECKO = 'https://api.geckoterminal.com/api/v2';
const DEXS = 'https://api.dexscreener.com';
const OKX = 'https://www.okx.com/api/v5/market'; // backup when Binance's data API refuses Cloudflare
const OKX_ID = { '1000SATS': 'SATS' };
const KRAKEN = 'https://api.kraken.com/0/public'; // second backup (no PEOPLE, BOME or SATS there)
const KRAKEN_ID = {};
const MEXC = 'https://api.mexc.com/api/v3'; // same candle format as Binance
const SOURCES = ['binance', 'mexc', 'okx', 'kraken'];
const GAP = { mexc: 300, binance: 100, okx: 1100, kraken: 1200 };
const BATCH = { mexc: 6, binance: 8, okx: 8, kraken: 1 };
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
export let pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const setPause = (fn) => { pause = fn; };
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
  state.log.length = Math.min(state.log.length, 200);
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
  if (source === 'kraken') {
    const pair = `${KRAKEN_ID[coin] || coin}USD`;
    const j = await getJson(fetcher, `${KRAKEN}/OHLC?pair=${pair}&interval=1440&since=${Math.floor(now / 1000) - 61 * 86400}`);
    if (j.error?.length) throw new Error(`kraken ${coin} ${j.error[0]}`);
    const rows = Object.entries(j.result || {}).find(([k]) => k !== 'last')?.[1] || [];
    // [time, open, high, low, close, vwap, volume, count]; quote volume = volume x vwap
    return rows.filter((r) => (r[0] + 86400) * 1000 <= now).map((r) => ({ t: r[0] * 1000, high: +r[2], close: +r[4], vol: +r[6] * +r[5] }));
  }
  const sym = source === 'mexc' && coin === '1000SATS' ? 'SATS' : coin;
  const rows = await getJson(fetcher, `${source === 'mexc' ? MEXC : BINANCE}/klines?symbol=${sym}USDT&interval=1d&limit=60`);
  return rows.filter((r) => r[6] < now).map((r) => ({ t: r[0], high: +r[2], close: +r[4], vol: +r[7] }));
}

export async function runDaily(state, fetcher, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const book = state.breakout;
  if (book.last_day === day) return { skipped: 'already ran today' };
  // One source for all coins (volumes differ between exchanges): the first that answers for BTC.
  const order = [...new Set([book.source || 'binance', ...SOURCES])];
  const tried = [];
  let source = null;
  for (const src of order) {
    try {
      if ((await dailyBars(fetcher, 'BTC', now, src)).length >= BREAKOUT.regime) { source = src; break; }
      tried.push(`${src}: too few candles`);
    } catch (e) { tried.push(e.message); }
    await pause(300);
  }
  if (!source) throw new Error(`no BTC candles (${tried.join('; ')})`);
  const bars = {};
  const errors = [];
  // Small batches with pauses: OKX allows ~20 requests per 2 s, Kraken ~1 per second.
  let firstError = '';
  const size = BATCH[source];
  for (let i = 0; i < COINS.length; i += size) {
    const part = COINS.slice(i, i + size);
    const got = await Promise.allSettled(part.map((c) => dailyBars(fetcher, c, now, source)));
    got.forEach((g, j) => {
      if (g.status === 'fulfilled' && g.value.length) bars[part[j]] = g.value;
      else { errors.push(part[j]); firstError ||= g.reason?.message || 'empty'; }
    });
    if (i + size < COINS.length) await pause(GAP[source]);
  }
  if (!bars.BTC?.length) throw new Error(`no BTC candles (${firstError})`);
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
  if (errors.length <= 5) book.last_day = day; // too many gaps: the next run tries the day again
  book.regime = regime;
  Object.assign(state.prices, Object.fromEntries(Object.entries(px).map(([c, v]) => [`${c}USDT`, v])));
  return { source, sells: sells.length, buys: buys.length, regime, missing: errors, tried };
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

/** DexScreener's newest profiles and boosted tokens on our chains: their deepest pair each. */
async function dexPairs(fetcher) {
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
    out.push(...Object.values(best));
  }
  if (!out.length) throw new Error('dexscreener: no candidates');
  return out;
}

async function dexCandidates(fetcher) {
  return (await dexPairs(fetcher)).map(fromDexPair);
}

// ============ Meme scalper ============

export const SCALP = {
  minLiq: 10_000, // below this a $50 exit moves the price too much to get out
  minVol5m: 3_000, minM5: 3, maxM5: 40,
  size: 0.05, slots: 6, maxBuysPerRun: 2, cooldownMin: 60,
  tp1: 0.25, trail: 0.15, stop: 0.15, maxHoldMin: 60,
  fee: 0.01,
};
// The rules the scalper may tune itself, each with a hard floor and ceiling.
export const TUNABLE = {
  maxM5: { start: 40, step: -5, min: 10, max: 40, label: 'max 5-min jump to buy', fmt: (v) => `+${v}%` },
  minLiq: { start: 10_000, step: 5_000, min: 10_000, max: 50_000, label: 'min liquidity', fmt: (v) => `$${v / 1000}k` },
  minVol5m: { start: 3_000, step: 2_000, min: 3_000, max: 15_000, label: 'min 5-min volume', fmt: (v) => `$${v / 1000}k` },
  minBuyRatio: { start: 1, step: 0.25, min: 1, max: 2.5, label: 'min buys per sell', fmt: (v) => `${v}x` },
  stop: { start: 0.15, step: 0.025, min: 0.15, max: 0.25, label: 'stop loss', fmt: (v) => `-${Math.round(v * 1000) / 10}%` },
  tp1: { start: 0.25, step: -0.05, min: 0.15, max: 0.25, label: 'take half at', fmt: (v) => `+${Math.round(v * 100)}%` },
};
// Which mistake moves which rule.
const FIX = { chased: 'maxM5', thin: 'minLiq', rug: 'minLiq', weak_volume: 'minVol5m', weak_buyers: 'minBuyRatio', stop_too_tight: 'stop', gave_back: 'tp1' };
const LESSON = {
  chased: 'bought after a big 5-min jump and it never went higher',
  thin: 'liquidity was thin, so getting out cost a lot',
  rug: 'the liquidity was pulled (rug)',
  weak_volume: 'volume was barely over the minimum',
  weak_buyers: 'buyers only just outnumbered sellers',
  never_moved: 'it never went up after the buy',
  stop_too_tight: 'it recovered above the buy price after the stop sold it',
  gave_back: 'it was well up but gave it all back before taking profit',
};
const WATCH_MIN = 30;

export const rulesOf = (book) => ({ ...SCALP, ...Object.fromEntries(Object.entries(TUNABLE).map(([k, t]) => [k, book.params?.[k] ?? t.start])) });

/** Tags a closed losing trade with what went wrong. */
export function diagnose(pm, r) {
  const tags = [];
  const s = pm.sig || {};
  if (pm.rug) tags.push('rug');
  if (s.m5 >= r.maxM5 * 0.6 && pm.best_pct < 3) tags.push('chased');
  if (!pm.rug && (s.liq < r.minLiq * 2 || pm.exit_impact_pct > 3)) tags.push('thin');
  if (s.vol5m < r.minVol5m * 2) tags.push('weak_volume');
  if (s.ratio < r.minBuyRatio + 0.5) tags.push('weak_buyers');
  if (pm.best_pct < 2 && !tags.includes('chased')) tags.push('never_moved');
  if (pm.best_pct >= 15) tags.push('gave_back');
  return tags;
}

export const lessonText = (pm) => `${pm.sym} ${pm.pnl_pct}%: ${pm.tags.length ? pm.tags.map((t) => LESSON[t]).join('; ') : 'no clear mistake, just a bad draw'}.`;

/** After a loss is final: if one mistake keeps repeating, move its rule one step (inside its limits). */
export function adapt(book, now) {
  const done = (book.losses || []).filter((l) => l.final).slice(0, 6);
  if (done.length < 3) return null;
  const count = {};
  for (const l of done) for (const t of l.tags) if (FIX[t]) count[t] = (count[t] || 0) + 1;
  const [tag, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [];
  if (!tag || n < 3) return null;
  const key = FIX[tag];
  const t = TUNABLE[key];
  // Give each change a chance to work: wait for 3 more losses before moving the same rule again.
  if ((book.since_change?.[key] ?? 99) < 3) return null;
  const from = book.params?.[key] ?? t.start;
  const to = Math.round(Math.min(t.max, Math.max(t.min, from + t.step)) * 1000) / 1000;
  if (to === from) return null;
  (book.params ||= {})[key] = to;
  (book.since_change ||= {})[key] = 0;
  const change = { at: new Date(now).toISOString(), rule: t.label, from: t.fmt(from), to: t.fmt(to), why: `${n} of the last ${done.length} losses: ${LESSON[tag]}` };
  (book.changes ||= []).unshift(change);
  book.changes.length = Math.min(book.changes.length, 20);
  return change;
}

/** Six hours without a buy: ease the most-tightened rule one step back toward where it started. */
function relax(book, now) {
  if (!book.params || now - (book.last_buy_at || Date.parse(book.started)) < 6 * 3600e3) return null;
  if (now - (book.last_relax_at || 0) < 6 * 3600e3) return null;
  const moved = Object.entries(book.params).filter(([k, v]) => v !== TUNABLE[k].start);
  if (!moved.length) return null;
  const [key, from] = moved.sort((a, b) => Math.abs((b[1] - TUNABLE[b[0]].start) / TUNABLE[b[0]].step) - Math.abs((a[1] - TUNABLE[a[0]].start) / TUNABLE[a[0]].step))[0];
  const t = TUNABLE[key];
  const to = Math.round((from - t.step) * 1000) / 1000;
  book.params[key] = to;
  book.last_relax_at = now;
  const change = { at: new Date(now).toISOString(), rule: t.label, from: t.fmt(from), to: t.fmt(to), why: 'no buys for 6 hours, so easing back one step' };
  (book.changes ||= []).unshift(change);
  book.changes.length = Math.min(book.changes.length, 20);
  return change;
}

const scalpFresh = (now) => ({ started: new Date(now).toISOString(), cash: START_USD, pos: {}, trades: 0, wins: 0, rugs: 0, scans: 0, cooldown: {}, rejected: {}, log: [] });
const scalpEquity = (b) => b.cash + Object.values(b.pos).reduce((a, p) => a + p.units * (p.last ?? p.entry), 0);

/** Momentum test on a raw DexScreener pair. '' = buy signal. */
export function scalpReject(x, held = {}, cooldown = {}, now = Date.now(), r = SCALP) {
  const R = { ...SCALP, minBuyRatio: 1, ...r };
  const addr = x.baseToken?.address;
  const sym = String(x.baseToken?.symbol || '').toUpperCase();
  if (!addr || SKIP_SYMBOLS.has(sym)) return 'not a meme coin';
  if (held[addr]) return 'already held';
  if (cooldown[addr] && now - cooldown[addr] < SCALP.cooldownMin * 60e3) return 'sold recently';
  if (!(num(x.liquidity?.usd) >= R.minLiq)) return 'too little liquidity to get out';
  if (!(num(x.volume?.m5) >= R.minVol5m)) return 'quiet';
  const m5 = num(x.priceChange?.m5);
  if (!(m5 >= R.minM5)) return 'not moving up';
  if (m5 > R.maxM5) return 'already spiked';
  const t = x.txns?.m5 || {};
  if (!((t.buys ?? 0) > (t.sells ?? 0) * R.minBuyRatio)) return 'sellers winning';
  if (!(num(x.priceChange?.h1 ?? 0) > -20)) return 'dumping';
  return '';
}

/** Only "can I sell it?" checks. Rug risk (mint authority, unlocked LP, new token) is accepted. */
export async function canSell(fetcher, chain, addr) {
  try {
    if (chain === 'solana') {
      const s = await getJson(fetcher, `https://api.rugcheck.xyz/v1/tokens/${addr}/report/summary`);
      const block = (s.risks || []).filter((r) => /freeze|honeypot|non.?transferable|permanent control/i.test(r.name)).map((r) => r.name);
      return block.length ? `can't sell: ${block.join(', ')}` : '';
    }
    const g = await getJson(fetcher, `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${addr}`);
    const t = g.result?.[addr.toLowerCase()];
    if (!t) return "can't sell: no safety data";
    const bad = ['is_honeypot', 'cannot_sell_all', 'transfer_pausable', 'is_blacklisted', 'owner_change_balance'].filter((k) => t[k] === '1');
    if (bad.length) return `can't sell: ${bad.join(', ')}`;
    if (num(t.sell_tax || 0) > 0.10) return "can't sell: sell tax over 10%";
    return '';
  } catch {
    return "can't sell: check unavailable";
  }
}

function scalpNote(book, entry) {
  book.log.unshift(entry);
  book.log.length = Math.min(book.log.length, 200);
}

export async function runScalp(book, fetcher, now) {
  const at = new Date(now).toISOString();
  const r = rulesOf(book);
  const open = Object.values(book.pos);
  // Losses are watched for 30 minutes after the sale, to learn whether the stop was too tight.
  const watching = (book.losses || []).filter((l) => !l.final);
  const lookup = [...open, ...watching.filter((l) => !book.pos[l.addr])];
  const priced = lookup.length ? await memePrices(fetcher, lookup) : {};
  const learned = [];
  for (const l of watching) {
    const q = priced[l.addr];
    if (q?.price > 0) l.after_best = Math.max(l.after_best || 0, q.price);
    if (now - Date.parse(l.at) < WATCH_MIN * 60e3) continue;
    if (/stop loss/.test(l.exit) && l.after_best >= l.entry * 1.1) l.tags.push('stop_too_tight');
    l.final = true;
    l.lesson = lessonText(l);
    for (const k of Object.keys(book.since_change || {})) book.since_change[k] += 1;
    const ch = adapt(book, now);
    if (ch) learned.push(ch);
  }
  for (const p of open) {
    const q = priced[p.addr];
    if (!q) continue;
    p.misses = q.price > 0 ? 0 : (p.misses || 0) + 1;
    let rug = false;
    let why = '';
    if (p.misses >= 2 || (q.price > 0 && q.liq < 3_000)) { why = 'liquidity vanished (rug)'; rug = true; }
    else if (!(q.price > 0)) continue;
    else {
      p.peak = Math.max(p.peak, q.price); p.last = q.price;
      if (!p.half && q.price >= p.entry * (1 + r.tp1)) {
        // Scale out: bank half, let the rest run on a trailing stop.
        const units = p.units / 2;
        const usd = units * q.price * (1 - SCALP.fee - impact(units * q.price, q.liq));
        p.units -= units; p.realized = (p.realized || 0) + usd; p.half = true; book.cash += usd;
        scalpNote(book, { at, act: 'sell half', sym: p.sym, price: q.price, usd: round(usd), pnl_pct: round(((q.price / p.entry) - 1) * 100, 1), why: `took half at +${Math.round(r.tp1 * 100)}%` });
      }
      const ageMin = (now - Date.parse(p.at)) / 60e3;
      if (q.price <= p.entry * (1 - r.stop)) why = `stop loss (-${Math.round(r.stop * 1000) / 10}%)`;
      else if (p.half && q.price <= p.peak * (1 - SCALP.trail)) why = `fell ${SCALP.trail * 100}% from its best`;
      else if (ageMin >= SCALP.maxHoldMin) why = `time's up (${SCALP.maxHoldMin} min)`;
    }
    if (!why) continue;
    const value = rug ? 0 : p.units * q.price;
    const usd = rug ? 0 : value * (1 - SCALP.fee - impact(value, q.liq));
    book.cash += usd;
    const pnl = ((p.realized || 0) + usd) / p.cost - 1;
    book.trades += 1; if (pnl > 0) book.wins += 1; if (rug) book.rugs += 1;
    scalpNote(book, { at, act: 'sell', sym: p.sym, chain: p.chain, price: q.price || 0, usd: round(usd), pnl_pct: round(pnl * 100, 1), why });
    if (pnl < 0) {
      // Post-mortem: what the entry looked like, how it played out, and what to watch next.
      const pm = { at, addr: p.addr, chain: p.chain, pool: p.pool, sym: p.sym, entry: p.entry, rug, exit: why,
        pnl_pct: round(pnl * 100, 1), best_pct: round((p.peak / p.entry - 1) * 100, 1),
        held_min: Math.round((now - Date.parse(p.at)) / 60e3), exit_impact_pct: round(impact(value, q.liq) * 100, 1), sig: p.sig || {} };
      pm.tags = diagnose(pm, r);
      pm.final = rug; // a rug has nothing left to watch
      if (pm.final) {
        pm.lesson = lessonText(pm);
        for (const k of Object.keys(book.since_change || {})) book.since_change[k] += 1;
      }
      (book.losses ||= []).unshift(pm);
      book.losses.length = Math.min(book.losses.length, 30);
      if (pm.final) { const ch = adapt(book, now); if (ch) learned.push(ch); }
    }
    book.cooldown[p.addr] = now;
    delete book.pos[p.addr];
  }
  for (const [a, t] of Object.entries(book.cooldown)) if (now - t > SCALP.cooldownMin * 60e3) delete book.cooldown[a];
  const eased = relax(book, now);
  if (eased) learned.push(eased);
  const R = rulesOf(book);
  const slots = SCALP.slots - Object.keys(book.pos).length;
  if (slots <= 0 || book.cash < 10) return { buys: 0, open: Object.keys(book.pos).length, learned };
  const pairs = await dexPairs(fetcher);
  book.scans += 1;
  const picks = [];
  for (const x of pairs) {
    const why = scalpReject(x, book.pos, book.cooldown, now, R);
    if (why) book.rejected[why] = (book.rejected[why] || 0) + 1;
    else picks.push(x);
  }
  picks.sort((a, b) => num(b.volume?.m5) - num(a.volume?.m5));
  const equity = scalpEquity(book);
  let buys = 0;
  for (const x of picks.slice(0, 3)) {
    if (buys >= Math.min(slots, SCALP.maxBuysPerRun) || book.cash < 10) break;
    const addr = x.baseToken.address;
    const stuck = await canSell(fetcher, x.chainId, addr);
    if (stuck) { book.rejected[stuck.split(':')[0]] = (book.rejected[stuck.split(':')[0]] || 0) + 1; continue; }
    const price = num(x.priceUsd);
    const liq = num(x.liquidity?.usd);
    const usd = Math.min(book.cash, equity * SCALP.size); // grows as the pot grows
    book.cash -= usd;
    const sym = String(x.baseToken.symbol || '?');
    const t5 = x.txns?.m5 || {};
    const sig = { m5: num(x.priceChange?.m5), h1: num(x.priceChange?.h1), vol5m: num(x.volume?.m5), liq, ratio: round((t5.buys || 0) / Math.max(1, t5.sells || 0), 2), hour: new Date(now).getUTCHours() };
    book.pos[addr] = { addr, sym, chain: x.chainId, pool: x.pairAddress, units: usd / (price * (1 + SCALP.fee + impact(usd, liq))), entry: price, peak: price, last: price, cost: usd, at, sig };
    book.last_buy_at = now;
    scalpNote(book, { at, act: 'buy', sym, chain: x.chainId, price, usd: round(usd), why: `+${num(x.priceChange?.m5).toFixed(0)}% in 5 min on $${Math.round(num(x.volume?.m5) / 1000)}k volume` });
    buys += 1;
  }
  book.last_scan = at;
  return { candidates: pairs.length, signals: picks.length, buys, open: Object.keys(book.pos).length, learned };
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

export function scorecard(state, scalp = null) {
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
    scalp_100_is_now: scalp ? per100(scalpEquity(scalp)) : null,
    scalp: scalp && {
      started: scalp.started, trades: scalp.trades, wins: scalp.wins, rugs: scalp.rugs, scans: scalp.scans, last_scan: scalp.last_scan,
      open: Object.values(scalp.pos).map((p) => ({ sym: p.sym, chain: p.chain, pnl_pct: round(((p.last ?? p.entry) / p.entry - 1) * 100, 1) })),
      rejected: scalp.rejected, recent: scalp.log.slice(0, 12),
      lessons: (scalp.losses || []).filter((l) => l.final).slice(0, 5).map((l) => ({ at: l.at, sym: l.sym, pnl_pct: l.pnl_pct, tags: l.tags, lesson: l.lesson })),
      changes: (scalp.changes || []).slice(0, 5),
      rules: Object.fromEntries(Object.entries(TUNABLE).map(([k, t]) => [t.label, t.fmt(scalp.params?.[k] ?? t.start)])),
    },
    recent: state.log.slice(0, 12),
  };
}

// ============ Plumbing ============

/** One run against a storage object (Durable Object storage, or a Map-like fake in tests). */
export async function runBot(storage, kind, fetcher = fetch, now = Date.now()) {
  if (kind === 'scalp') {
    // Own storage key: a scalp run and a meme run can overlap without overwriting each other.
    const book = (await storage.get('scalp')) || scalpFresh(now);
    let result;
    try { result = await runScalp(book, fetcher, now); } catch (e) { result = { error: e.message }; }
    book.last = { at: new Date(now).toISOString(), result };
    await storage.put('scalp', book);
    return result;
  }
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
  (state.runs ||= {})[kind] = state.last;
  await storage.put('state', state);
  if (kind === 'meme') await recordHistory(storage, state, now);
  return result;
}

/** A point every 30 minutes of what $100 in each pot (and in Bitcoin) is worth, for the dashboard chart. */
export async function recordHistory(storage, state, now) {
  const history = (await storage.get('history')) || [];
  if (history.length && now - history.at(-1).t < 29 * 60e3) return history;
  const c = scorecard(state, (await storage.get('scalp')) || null);
  history.push({ t: now, b: c.breakout_100_is_now, m: c.meme_100_is_now, s: c.scalp_100_is_now, btc: c.btc_hold_100_is_now });
  if (history.length > 3000) history.splice(0, history.length - 3000); // about two months
  await storage.put('history', history);
  return history;
}

/** Everything the dashboard page shows. */
export function dashboard(state, scalp, history) {
  const card = scorecard(state, scalp);
  const ago = (at) => (at ? Math.round((Date.now() - Date.parse(at)) / 60e3) : null);
  const health = [
    { name: 'Meme hunter scan', every_min: 10, last: state.runs?.meme?.at, result: state.runs?.meme?.result },
    { name: 'Coin breakout daily check', every_min: 60, last: state.runs?.daily?.at, result: state.runs?.daily?.result, day: state.breakout.last_day },
    { name: 'Meme scalper scan', every_min: 2, last: scalp?.last?.at, result: scalp?.last?.result },
  ].map((h) => ({ ...h, minutes_ago: ago(h.last), late: h.last ? ago(h.last) > h.every_min * 3 : true, error: h.result?.error || null }));
  return {
    ...card,
    history,
    trades: [...state.log.map((t) => ({ ...t, pot: t.pot === 'breakout' ? 'Coin breakout' : 'Meme hunter' })),
      ...(scalp?.log || []).map((t) => ({ ...t, pot: 'Meme scalper' }))].sort((a, b) => (a.at < b.at ? 1 : -1)),
    scalp_started: scalp?.started || null,
    lessons: (scalp?.losses || []).filter((l) => l.final).map((l) => ({ at: l.at, sym: l.sym, pnl_pct: l.pnl_pct, best_pct: l.best_pct, held_min: l.held_min, exit: l.exit, tags: l.tags, lesson: l.lesson })),
    watching: (scalp?.losses || []).filter((l) => !l.final).map((l) => ({ sym: l.sym, at: l.at })),
    changes: scalp?.changes || [],
    rules: card.scalp?.rules || null,
    sources: { coins: state.breakout.source || null, memes: state.meme.source || null },
    rejected: { meme: state.meme.rejected, scalp: scalp?.rejected || {} },
    health,
  };
}

export class CryptoBot {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const result = await runBot(this.ctx.storage, kindOf(url.searchParams.get('kind')));
      return Response.json({ result });
    }
    const [state, scalp] = await Promise.all([this.ctx.storage.get('state'), this.ctx.storage.get('scalp')]);
    if (url.searchParams.has('full')) {
      if (!state) return Response.json({ dashboard: null });
      return Response.json({ dashboard: dashboard(state, scalp || null, (await this.ctx.storage.get('history')) || []) });
    }
    return Response.json({ status: state ? { ...scorecard(state, scalp || null), last: state.last, scalp_last: scalp?.last || null } : null });
  }
}

const kindOf = (k) => (['daily', 'scalp'].includes(k) ? k : 'meme');
const bot = (env) => env.CRYPTO_BOT.get(env.CRYPTO_BOT.idFromName('paper'));

export async function cryptoScheduled(controller, env) {
  if (!env.CRYPTO_BOT) return;
  const kind = { '7 * * * *': 'daily', '*/2 * * * *': 'scalp' }[controller.cron] || 'meme';
  await bot(env).fetch(`https://bot/run?kind=${kind}`);
}

export async function cryptoApi(request, env, url) {
  if (!env.CRYPTO_BOT) return Response.json({ error: 'The crypto bot is not set up on this deployment.' }, { status: 501 });
  if (url.pathname === '/api/crypto/run' && request.method === 'POST') {
    return bot(env).fetch(`https://bot/run?kind=${kindOf(url.searchParams.get('kind'))}`);
  }
  return bot(env).fetch(`https://bot/status${url.searchParams.has('full') ? '?full=1' : ''}`);
}
