// Pro number matching for Pallet Router. Pure functions, so they can be tested
// in Node and used in the page.

/** Uppercase letters and digits only, leading zeros and a letter suffix dropped. "006365941" -> "6365941", "00279297590DR" -> "279297590". */
export function norm(code) {
  // A letter suffix after the number (00279297590DR) is not on the manifest: drop it.
  const clean = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^(\d{6,})[A-Z]{1,3}$/, '$1');
  const stripped = clean.replace(/^0+/, '');
  return stripped || clean;
}

/** Every stop on every stack, as { driver, index }. */
function allStops(drivers) {
  const out = [];
  for (const driver of drivers) {
    driver.stops.forEach((stop, index) => out.push({ driver, index, key: norm(stop.pro) }));
  }
  return out;
}

/**
 * Finds the stack sheet for a scanned code.
 * An exact match wins. Otherwise a sticker may carry extra characters around the
 * pro# (a piece suffix, a carrier prefix), so a code that starts or ends with a
 * pro# of 6+ characters (or the other way round) also matches, if only one stop fits.
 * Returns { driver, index } or null.
 */
export function findStop(drivers, code) {
  const key = norm(code);
  if (key.length < 3) return null;
  const stops = allStops(drivers);
  const exact = stops.find((s) => s.key === key);
  if (exact) return { driver: exact.driver, index: exact.index };
  const loose = stops.filter((s) => {
    const [short, long] = s.key.length <= key.length ? [s.key, key] : [key, s.key];
    return short.length >= 6 && (long.startsWith(short) || long.endsWith(short));
  });
  if (loose.length === 1) return { driver: loose[0].driver, index: loose[0].index };
  return null;
}

/** Exact match only, used when building stacks so two different pros never merge. */
export function findExact(drivers, code) {
  const key = norm(code);
  for (const driver of drivers) {
    const index = driver.stops.findIndex((s) => norm(s.pro) === key);
    if (index !== -1) return { driver, index };
  }
  return null;
}

/**
 * Where a stop goes on the truck. Stop 1 comes off first, so it is loaded last,
 * at the doors; the last stop is loaded first, at the nose.
 */
export function loadInfo(index, total) {
  const stop = index + 1;
  const loadOrder = total - index;
  let where;
  if (total === 1) where = 'Only stop';
  else if (index === 0) where = 'Load LAST · at the doors';
  else if (index === total - 1) where = 'Load FIRST · at the nose';
  else where = `Load ${ordinal(loadOrder)} of ${total}`;
  return { stop, total, loadOrder, where };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** True when two pro#s differ by at most one character (a misread, an extra or a missing digit). */
export function nearlySame(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 6) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Pairs sheets read off a stack photo with the stops scanned by barcode.
 * Exact pro# first; otherwise a unique near match. Returns [{ index, sheet }].
 */
export function pairSheets(stops, sheets) {
  const out = [];
  const used = new Set();
  for (const sheet of sheets) {
    let index = stops.findIndex((s, k) => !used.has(k) && norm(s.pro) === norm(sheet.pro));
    if (index === -1) {
      const near = stops.map((s, k) => k).filter((k) => !used.has(k) && nearlySame(stops[k].pro, sheet.pro));
      if (near.length === 1) [index] = near;
    }
    if (index !== -1) { used.add(index); out.push({ index, sheet }); }
  }
  return out;
}

/** The manifest row for a pro#: exact on the pro or the interline pro, else a unique one-digit-off match. */
export function poolMatch(pool, pro) {
  const key = norm(pro);
  const exact = pool.find((r) => norm(r.pro) === key || (r.alt && norm(r.alt) === key));
  if (exact) return exact;
  const near = pool.filter((r) => nearlySame(r.pro, pro));
  return near.length === 1 ? near[0] : null;
}

/**
 * Address lookup by pro# for the Stops tab: every manifest row and every stop that
 * has an address. Best first: exact (or the interline pro), then one digit off,
 * then a pro# that contains what was typed (3+ digits). At most `limit` results.
 * Each result: { pro, alt, name, street, city, at, driver, index, rank }.
 */
export function lookupAddress(drivers, pool, query, limit = 10) {
  const q = norm(query);
  if (q.length < 3) return [];
  const out = [];
  for (const r of addressBook(drivers, pool)) {
    let rank = -1;
    if (norm(r.pro) === q || (r.alt && norm(r.alt) === q)) rank = 0;
    else if (nearlySame(r.pro, q)) rank = 1;
    else if (norm(r.pro).includes(q) || (r.alt && norm(r.alt).includes(q))) rank = 2;
    if (rank >= 0) out.push({ ...r, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || (b.at || 0) - (a.at || 0)).slice(0, limit);
}

/** Every pro# with an address or on a route, newest first: manifest rows merged with route stops. */
export function addressBook(drivers, pool) {
  const byPro = new Map();
  for (const r of pool || []) byPro.set(norm(r.pro), { pro: r.pro, alt: r.alt || '', name: r.name, street: r.street, city: r.city, at: r.at });
  for (const driver of drivers || []) {
    driver.stops.forEach((s, index) => {
      const k = norm(s.pro);
      const have = byPro.get(k);
      const a = s.addr?.name ? s.addr : null;
      const closeUp = a && a.from !== 'stack' && a.from !== 'manifest';
      if (have) Object.assign(have, { driver, index }, closeUp || !have.name ? { name: a?.name || have.name, street: a?.street || have.street, city: a?.city || have.city } : {});
      else byPro.set(k, { pro: s.pro, alt: '', name: a?.name || '', street: a?.street || '', city: a?.city || '', at: s.at, driver, index });
    });
  }
  return [...byPro.values()].sort((a, b) => (b.at || 0) - (a.at || 0) || norm(a.pro).localeCompare(norm(b.pro)));
}
