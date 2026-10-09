// Merging two copies of the same list.
//
// Two devices edit the same list offline, so a plain "newest document wins"
// would throw away whatever the other one did. Instead every record carries
// the time it last changed, deletions leave a tombstone, and merging takes the
// newer side of each individual record. The result is the same no matter which
// way round the two copies are merged.

export const STATE_VERSION = 3;
const TOMBSTONE_TTL = 60 * 24 * 60 * 60 * 1000;

export function emptyState(now = Date.now()) {
  return {
    version: STATE_VERSION,
    recipes: [],
    cookbook: [],
    extras: [],
    pantry: [],
    checked: {},
    hidden: {},
    checks: [],
    ask: { value: 'always', at: now },
    tombstones: {},
  };
}

const at = (record) => Number(record && record.at) || 0;

/** Newer record wins; a tombstone at least as new as the record removes it. */
export function mergeRecords(kind, mine, theirs, idField, tombstones) {
  const byId = new Map();
  for (const record of [...(mine || []), ...(theirs || [])]) {
    const id = record && record[idField];
    if (id === undefined || id === null) continue;
    const existing = byId.get(id);
    if (!existing || at(record) > at(existing)) byId.set(id, record);
  }
  for (const [id, record] of byId) {
    const removedAt = tombstones[`${kind}:${id}`] || 0;
    if (removedAt >= at(record)) byId.delete(id);
  }
  return [...byId.values()];
}

/** Flag maps ({ key: { on, at } }) merge per key, newest change winning. */
function mergeFlags(mine = {}, theirs = {}) {
  const merged = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const a = mine[key];
    const b = theirs[key];
    const winner = at(a) >= at(b) ? (a || b) : (b || a);
    if (winner && winner.on) merged[key] = { on: true, at: at(winner) };
    else if (winner) merged[key] = { on: false, at: at(winner) };
  }
  return merged;
}

export function mergeTombstones(mine = {}, theirs = {}, now) {
  const merged = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const stamp = Math.max(Number(mine[key]) || 0, Number(theirs[key]) || 0);
    if (now - stamp < TOMBSTONE_TTL) merged[key] = stamp;
  }
  return merged;
}

export function mergeStates(mine, theirs, now = Date.now()) {
  if (!theirs) return mine;
  if (!mine) return theirs;

  const tombstones = mergeTombstones(mine.tombstones, theirs.tombstones, now);
  const ask = at(mine.ask) >= at(theirs.ask) ? mine.ask : theirs.ask;

  return {
    version: STATE_VERSION,
    recipes: mergeRecords('recipe', mine.recipes, theirs.recipes, 'id', tombstones),
    cookbook: mergeRecords('cookbook', mine.cookbook, theirs.cookbook, 'id', tombstones),
    extras: mergeRecords('extra', mine.extras, theirs.extras, 'id', tombstones),
    pantry: mergeRecords('pantry', mine.pantry, theirs.pantry, 'key', tombstones),
    checks: mergeRecords('check', mine.checks, theirs.checks, 'key', tombstones),
    checked: mergeFlags(mine.checked, theirs.checked),
    hidden: mergeFlags(mine.hidden, theirs.hidden),
    ask: ask || emptyState(now).ask,
    tombstones,
  };
}

/** Older saved lists predate sync, so give everything a starting timestamp. */
export function upgradeState(saved, now = Date.now()) {
  if (!saved || typeof saved !== 'object') return emptyState(now);
  if (Number(saved.version) === STATE_VERSION) return { ...emptyState(now), ...saved };

  const stamp = (record) => ({ ...record, at: Number(record.at) || now });
  const flags = (value) => {
    const out = {};
    for (const [key, entry] of Object.entries(value || {})) {
      if (entry && typeof entry === 'object') out[key] = { on: Boolean(entry.on), at: at(entry) || now };
      else if (entry) out[key] = { on: true, at: now };
    }
    return out;
  };

  return {
    ...emptyState(now),
    recipes: (saved.recipes || []).map(stamp),
    // Lists from before the cookbook existed seed it from what is on the list.
    cookbook: (saved.cookbook || (saved.recipes || []).filter((r) => r.url).map((recipe) => ({
      id: recipe.id, title: recipe.title, url: recipe.url, yield: recipe.yield || '',
      ingredients: recipe.ingredients || [], savedAt: now,
    }))).map(stamp),
    extras: (saved.extras || []).map(stamp),
    pantry: (saved.pantry || []).map((entry) => stamp({
      ...entry,
      addedAt: entry.addedAt || now,
      confirmedAt: entry.confirmedAt === undefined ? now : entry.confirmedAt,
    })),
    checks: (saved.checks || []).map(stamp),
    checked: flags(saved.checked),
    hidden: flags(saved.hidden),
    ask: typeof saved.ask === 'string' ? { value: saved.ask, at: now } : (saved.ask || { value: 'always', at: now }),
    tombstones: saved.tombstones || {},
  };
}

/** Recipe links pick up tracking junk; compare them without it. */
export function normalizeRecipeUrl(raw) {
  try {
    const url = new URL(String(raw));
    url.hash = '';
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|ref_|igshid|si$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.protocol = 'https:';
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.hostname}${path}${url.search}`;
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
}
