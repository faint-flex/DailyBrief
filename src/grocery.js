// "Add to list": put a dinner from the brief on the shared Grocerylist, the same
// way Grocerylist's own scripts/add-dinner.mjs does. The merge logic is copied
// from Grocerylist (see vendor/grocerylist/README.md) so both apps agree on the
// list's format.

import { addDinner } from '../vendor/grocerylist/add-dinner.js';
import { recipeFromPaste } from '../vendor/grocerylist/lib/paste.js';

const CODE_RE = /^[23456789bcdfghjkmnpqrstvwxz]{20}$/;

export class GroceryError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * `call(path, init)` reaches Grocerylist's API (through a service binding on
 * Cloudflare, or plain fetch elsewhere). Returns { added, title, count }.
 */
export async function addToGrocerylist(call, code, dinner) {
  if (!CODE_RE.test(code || '')) {
    throw new GroceryError('Add to list is not set up yet: the Grocerylist share code is missing.', 501);
  }

  let recipe;
  if (dinner.ingredients.length) {
    recipe = recipeFromPaste({ title: dinner.name, url: dinner.url, text: dinner.ingredients.join('\n') });
  } else if (dinner.url) {
    const response = await call('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: dinner.url }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GroceryError(data.error || 'Grocerylist could not read that recipe.', 502);
    recipe = { ...data, title: dinner.name };
  }
  if (!recipe || !recipe.ingredients.length) {
    throw new GroceryError('This dinner has no ingredient list to add.', 422);
  }

  const pulled = await call(`/api/list/${code}`);
  if (!pulled.ok) throw new GroceryError(`Could not open your grocery list (${pulled.status}).`);
  let { doc, rev } = await pulled.json();

  // Someone may be shopping right now; on a conflict, take their copy and retry.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { doc: next, added } = addDinner(doc, recipe);
    if (!added) return { added: false, title: recipe.title, count: recipe.ingredients.length };
    const pushed = await call(`/api/list/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev, doc: next }),
    });
    if (pushed.ok) return { added: true, title: recipe.title, count: recipe.ingredients.length };
    if (pushed.status !== 409) throw new GroceryError(`Could not save your grocery list (${pushed.status}).`);
    ({ doc, rev } = await pushed.json());
  }
  throw new GroceryError('Your grocery list kept changing. Try again in a moment.', 409);
}
