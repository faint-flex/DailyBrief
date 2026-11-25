// Merges two copies of the day (two phones sharing one code). Pure, so the
// phone and the server use the same rules and both end up with the same copy.
//
// A doc is { startedAt, drivers, pallets, pool, gone }.
// - A day started more than 12 hours later replaces the older one (a phone that
//   was off since yesterday), but addresses (pool) carry over. Closer than that,
//   both are the same shift: everything merges and the later start time is kept.
// - Drivers (one stack = one run) merge by id; the most recent edit (rev) wins.
// - Pallet scans are added from both phones; pool rows merge by pro#, newest wins.
// - gone remembers deleted stacks and cleared pallets, so they stay deleted.
import { norm } from './match.js';

const DAY = 86400000;
const SAME_SHIFT = 12 * 3600000;
const POOL_DAYS = 8; // the phone keeps 7 days; a day of slack

export const palletKey = (p) => `${p.at}-${p.code}`;

function mergePool(a = [], b = []) {
  const byPro = new Map();
  for (const r of [...a, ...b]) {
    const k = norm(r.pro);
    const have = byPro.get(k);
    if (!have || (r.at || 0) > (have.at || 0)) byPro.set(k, r);
  }
  return [...byPro.values()].sort((x, y) => (x.at || 0) - (y.at || 0) || norm(x.pro).localeCompare(norm(y.pro)));
}

function pickNewer(x, y) {
  const rx = x.rev || 0; const ry = y.rev || 0;
  if (rx !== ry) return rx > ry ? x : y;
  return JSON.stringify(x) >= JSON.stringify(y) ? x : y; // same time: pick the same one on both phones
}

/** The parts of the day that are shared. Pallet matches are worked out on each phone. */
export function shareable(s) {
  return {
    startedAt: s.startedAt || 0,
    drivers: s.drivers || [],
    pallets: (s.pallets || []).map((p) => ({ code: p.code, at: p.at })),
    pool: s.pool || [],
    pages: s.pages || [],
    gone: s.gone || {},
  };
}

export function mergeDocs(a, b) {
  a = shareable(a || {}); b = shareable(b || {});
  const startedAt = Math.max(a.startedAt, b.startedAt);
  const cutoff = startedAt - POOL_DAYS * DAY;
  const pool = mergePool(a.pool, b.pool).filter((r) => !r.at || r.at >= cutoff);
  if (Math.abs(a.startedAt - b.startedAt) > SAME_SHIFT) {
    const newer = b.startedAt > a.startedAt ? b : a;
    return { ...mergeDocs(newer, newer), pool };
  }
  const gone = { ...a.gone };
  for (const [k, v] of Object.entries(b.gone)) gone[k] = Math.max(gone[k] || 0, v);

  const drivers = new Map();
  for (const d of [...a.drivers, ...b.drivers]) drivers.set(d.id, drivers.has(d.id) ? pickNewer(drivers.get(d.id), d) : d);
  const keptDrivers = [...drivers.values()]
    .filter((d) => !(gone[`d:${d.id}`] >= (d.rev || 0)))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));

  const pallets = new Map();
  for (const p of [...a.pallets, ...b.pallets]) pallets.set(palletKey(p), p);
  const keptPallets = [...pallets.values()]
    .filter((p) => !gone[`p:${palletKey(p)}`])
    .sort((x, y) => x.at - y.at || String(x.code).localeCompare(String(y.code)));

  // Manifest pages scanned today, by id; a re-read of the same page keeps the newest.
  const pages = new Map();
  for (const p of [...a.pages, ...b.pages]) if (!pages.has(p.id) || (p.at || 0) > (pages.get(p.id).at || 0)) pages.set(p.id, p);
  const keptPages = [...pages.values()].sort((x, y) => (x.at || 0) - (y.at || 0) || String(x.id).localeCompare(String(y.id)));

  return { startedAt, drivers: keptDrivers, pallets: keptPallets, pool, pages: keptPages, gone };
}

/** One fixed form, so two copies with the same content compare equal. */
export const canon = (doc) => JSON.stringify(mergeDocs(doc, doc));
