// Your cookbook is yours.
//
// A saved recipe stays on the device that saved it unless you share it, so the
// people you shop with never get your collection in their cookbook. Putting one
// on the shopping list is a separate decision: by default the list says which
// recipe an item came from, because otherwise nobody can tell why there is
// 500g of bread flour on it. A recipe can be added quietly instead, and then
// only the device that owns it knows what it is.

import { mergeRecords, mergeTombstones } from './merge.js';

export const PRIVATE_LABEL = 'A recipe of mine';
export const PRIVATE_VERSION = 1;

export function emptyPrivate() {
  return { version: PRIVATE_VERSION, cookbook: [], names: {}, tombstones: {} };
}

/** Accept both the very first shape (a bare array) and the current one. */
export function upgradePrivate(saved) {
  if (Array.isArray(saved)) return { ...emptyPrivate(), cookbook: saved };
  if (saved && typeof saved === 'object') return { ...emptyPrivate(), ...saved };
  return emptyPrivate();
}

const when = (record) => Number(record && record.at) || 0;

function mergeNames(mine = {}, theirs = {}) {
  const merged = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const a = mine[key];
    const b = theirs[key];
    merged[key] = when(a) >= when(b) ? (a || b) : (b || a);
  }
  return merged;
}

/** Merge two copies of one person's own recipes, the same way lists merge. */
export function mergePrivate(mine, theirs, now = Date.now()) {
  if (!theirs) return upgradePrivate(mine);
  if (!mine) return upgradePrivate(theirs);
  const tombstones = mergeTombstones(mine.tombstones, theirs.tombstones, now);
  return {
    version: PRIVATE_VERSION,
    cookbook: mergeRecords('cookbook', mine.cookbook, theirs.cookbook, 'id', tombstones),
    names: mergeNames(mine.names, theirs.names),
    tombstones,
  };
}

export function isQuiet(recipe) {
  // `privateId` is how the first version of this marked a quiet recipe.
  return Boolean(recipe && (recipe.quiet || recipe.privateId));
}

/** What to call a recipe here: the real name if this device knows it. */
export function titleFor(recipe, names = {}) {
  if (!recipe) return '';
  if (!isQuiet(recipe)) return recipe.title;
  const known = names[recipe.id] || names[recipe.privateId];
  return known ? known.title : PRIVATE_LABEL;
}

/** Does this device know what a quiet recipe actually is? */
export function knowsQuiet(recipe, names = {}) {
  return isQuiet(recipe) && Boolean(names[recipe.id] || names[recipe.privateId]);
}

/** The list entry for a recipe added normally: named, so the shop makes sense. */
export function namedEntry(recipe, id, { cookbookId = null, shared = false } = {}) {
  return {
    id,
    cookbookId,
    sharedRecipe: shared,
    title: recipe.title,
    url: recipe.url || '',
    yield: recipe.yield || '',
    scale: 1,
    ingredients: recipe.ingredients,
  };
}

/** Strip a list entry back to ingredients: no title, link or serving size. */
export function quietEntry(recipe) {
  return {
    ...recipe,
    quiet: true,
    cookbookId: null,
    title: PRIVATE_LABEL,
    url: '',
    yield: '',
  };
}

/** What this device remembers locally about a recipe it quietened. */
export function rememberName(recipe, at = Date.now()) {
  return { title: recipe.title, url: recipe.url || '', yield: recipe.yield || '', at };
}

/** Put the name back on a list entry this device quietened. */
export function restoreName(recipe, remembered) {
  const { quiet, privateId, ...rest } = recipe;
  return {
    ...rest,
    title: remembered.title,
    url: remembered.url || '',
    yield: remembered.yield || '',
  };
}
