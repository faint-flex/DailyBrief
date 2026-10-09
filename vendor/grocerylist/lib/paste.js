// Bringing a recipe over by hand.
//
// Some sites refuse to serve anything but a person's own browser, so importing
// by link will never work for them. You can still read the page yourself, so
// the next best thing is to paste the ingredients in and keep the link
// alongside them.

import { parseIngredient } from './ingredients.js';

const NOISE = /^(ingredients?|for the\b|you(?:'| wi)ll need|method|instructions?|directions?|notes?|equipment)\b[:\s]*$/i;

/** A readable name from the address, for when we could not read the page. */
export function titleFromUrl(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return '';
  }
  const slug = path.split('/').filter(Boolean)
    .reverse()
    .find((part) => /[a-z]{3}/i.test(part) && !/^\d+$/.test(part));
  if (!slug) return '';
  return slug
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\brecipes?\b/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Pull ingredient lines out of pasted text, ignoring headings and prose. */
export function ingredientsFromText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !NOISE.test(line))
    .filter((line) => !(line.endsWith(':') && !/\d/.test(line)))
    // A paragraph is a method step, not something to buy.
    .filter((line) => line.length <= 200)
    .filter((line) => !/^(step\s*\d|preheat|heat |stir |bake |cook |mix |whisk |serve )/i.test(line))
    .map(parseIngredient);
}

/** A cookbook entry built from what was pasted. */
export function recipeFromPaste({ title, url, text }) {
  const ingredients = ingredientsFromText(text);
  return {
    title: (title || '').trim() || titleFromUrl(url) || 'Pasted recipe',
    url: (url || '').trim(),
    yield: '',
    ingredients,
  };
}
