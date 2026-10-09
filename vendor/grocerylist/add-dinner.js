// Put a recipe on a shared list from outside the app, the way "Add to list"
// does on a phone: it goes in the shared cookbook and onto the shopping list,
// named, so both of you can see what the ingredients are for.

import { upgradeState, normalizeRecipeUrl } from './lib/merge.js';
import { namedEntry } from './lib/private.js';

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Returns a new copy of `doc` with `recipe` ({ title, url, yield, ingredients })
 * in the shared cookbook and on the list. A recipe already on the list is left
 * alone, so running this twice does not double the shopping.
 */
export function addDinner(doc, recipe, { now = Date.now(), makeId = uid } = {}) {
  const state = upgradeState(structuredClone(doc), now);
  const link = recipe.url ? normalizeRecipeUrl(recipe.url) : null;
  const sameRecipe = (entry) => (link && entry.url && normalizeRecipeUrl(entry.url) === link)
    || (!link && entry.title === recipe.title);

  let entry = state.cookbook.find(sameRecipe);
  if (!entry) {
    entry = { id: makeId(), savedAt: now };
    state.cookbook.push(entry);
  }
  Object.assign(entry, {
    title: recipe.title,
    url: recipe.url || '',
    yield: recipe.yield || '',
    ingredients: recipe.ingredients,
    at: now,
  });

  const onList = state.recipes.some((item) => item.cookbookId === entry.id || sameRecipe(item));
  if (onList) return { doc: state, added: false };

  state.recipes.push({ ...namedEntry(entry, makeId(), { cookbookId: entry.id, shared: true }), at: now });
  // A fresh recipe should reappear even if one of its items was crossed off earlier.
  for (const ingredient of entry.ingredients) {
    if (state.hidden[ingredient.key]) state.hidden[ingredient.key] = { on: false, at: now };
  }
  return { doc: state, added: true };
}
