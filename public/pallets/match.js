// Pro number matching for Pallet Router. Pure functions, so they can be tested
// in Node and used in the page.

/** Uppercase letters and digits only, leading zeros dropped. "006365941" -> "6365941". */
export function norm(code) {
  const clean = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
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
