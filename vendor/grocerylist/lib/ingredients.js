// Ingredient parsing, merging and aisle grouping.
// Shared verbatim between the Node server and the browser (loaded as an ES module in both).

const UNICODE_FRACTIONS = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6,
  '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const UNIT_DEFS = [
  { id: 'tsp', dim: 'volume', factor: 1, aliases: ['teaspoon', 'teaspoons', 'tsp', 'tsps'] },
  { id: 'tbsp', dim: 'volume', factor: 3, aliases: ['tablespoon', 'tablespoons', 'tbsp', 'tbsps', 'tbs'] },
  { id: 'fl oz', dim: 'volume', factor: 6, aliases: ['fluid ounce', 'fluid ounces', 'fl oz', 'floz'] },
  { id: 'cup', dim: 'volume', factor: 48, aliases: ['cup', 'cups'] },
  { id: 'pint', dim: 'volume', factor: 96, aliases: ['pint', 'pints', 'pt'] },
  { id: 'quart', dim: 'volume', factor: 192, aliases: ['quart', 'quarts', 'qt'] },
  { id: 'gallon', dim: 'volume', factor: 768, aliases: ['gallon', 'gallons', 'gal'] },
  { id: 'ml', dim: 'volume', factor: 0.2028841, metric: true, aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  { id: 'l', dim: 'volume', factor: 202.8841, metric: true, aliases: ['l', 'liter', 'liters', 'litre', 'litres'] },
  { id: 'g', dim: 'weight', factor: 1, metric: true, aliases: ['g', 'gr', 'gram', 'grams'] },
  { id: 'kg', dim: 'weight', factor: 1000, metric: true, aliases: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'] },
  { id: 'oz', dim: 'weight', factor: 28.3495, aliases: ['oz', 'ounce', 'ounces'] },
  { id: 'lb', dim: 'weight', factor: 453.592, aliases: ['lb', 'lbs', 'pound', 'pounds'] },
];

// Units that only merge with themselves ("3 cloves" + "2 cloves", never "cloves" + "cups").
const LOOSE_UNITS = [
  'clove', 'can', 'package', 'pkg', 'bunch', 'head', 'stalk', 'sprig', 'slice', 'pinch',
  'dash', 'handful', 'jar', 'bottle', 'container', 'box', 'bag', 'ear', 'fillet', 'filet',
  'breast', 'thigh', 'strip', 'piece', 'leaf', 'stick', 'sheet', 'rib', 'link', 'loaf', 'sprigs',
];

// Loose units that also read naturally after the ingredient name.
const TRAILING_UNITS = new Set([
  'clove', 'can', 'package', 'jar', 'bottle', 'box', 'bag', 'breast', 'thigh', 'fillet',
  'filet', 'sprig', 'stalk', 'head', 'bunch', 'slice', 'piece', 'rib', 'link', 'ear', 'loaf',
]);

const UNIT_LOOKUP = new Map();
for (const def of UNIT_DEFS) {
  for (const alias of def.aliases) UNIT_LOOKUP.set(alias, def);
}
for (const id of LOOSE_UNITS) {
  const def = { id, dim: null, factor: 1, loose: true };
  UNIT_LOOKUP.set(id, def);
  UNIT_LOOKUP.set(pluralize(id), def);
}
UNIT_LOOKUP.set('leaves', UNIT_LOOKUP.get('leaf'));
UNIT_LOOKUP.set('cloves', UNIT_LOOKUP.get('clove'));
UNIT_LOOKUP.set('loaves', UNIT_LOOKUP.get('loaf'));

// Longest alias first so "fluid ounces" wins over "ounces".
const UNIT_ALIASES = [...UNIT_LOOKUP.keys()].sort((a, b) => b.length - a.length);

const DISPLAY_LADDERS = {
  'volume': ['tsp', 'tbsp', 'cup', 'quart', 'gallon'],
  'volume-metric': ['ml', 'l'],
  'weight': ['oz', 'lb'],
  'weight-metric': ['g', 'kg'],
};

// Words dropped when building the match key, so "fresh flat-leaf parsley" and
// "parsley" land in the same bucket.
// A comma followed by one of these introduces preparation, not another ingredient word.
const PREP_WORDS = new Set([
  'chopped', 'minced', 'diced', 'sliced', 'grated', 'shredded', 'crushed', 'peeled', 'cored',
  'halved', 'quartered', 'cubed', 'julienned', 'torn', 'crumbled', 'beaten', 'whisked',
  'melted', 'softened', 'divided', 'drained', 'rinsed', 'trimmed', 'seeded', 'stemmed',
  'pitted', 'deveined', 'thawed', 'cooked', 'uncooked', 'toasted', 'roasted', 'washed',
  'finely', 'roughly', 'coarsely', 'thinly', 'freshly', 'lightly', 'well', 'plus', 'more',
  'cut', 'sifted', 'packed', 'room', 'at', 'for', 'optional', 'or', 'to', 'zested', 'juiced',
  'patted', 'squeezed', 'if', 'preferably', 'plucked', 'stems', 'separated', 'about',
]);

const KEY_STOPWORDS = new Set([
  'fresh', 'freshly', 'large', 'small', 'medium', 'extra', 'ripe', 'organic', 'raw', 'whole',
  'ground', 'chopped', 'minced', 'diced', 'sliced', 'grated', 'shredded', 'crushed', 'peeled',
  'cooked', 'uncooked', 'dried', 'boneless', 'skinless', 'unsalted', 'salted', 'low', 'fat',
  'reduced', 'plain', 'pure', 'good', 'quality', 'best', 'optional', 'packed', 'lightly',
  'finely', 'coarsely', 'roughly', 'thinly', 'of', 'a', 'an', 'the', 'your', 'favorite',
  'plus', 'more', 'for', 'and', 'or', 'to', 'taste', 'garnish', 'serving', 'divided',
  'leaf', 'leaves', 'flat', 'virgin', 'light', 'dark', 'sea', 'kosher', 'granulated',
]);

const AISLES = [
  ['Produce', ['lettuce', 'spinach', 'kale', 'arugula', 'tomato', 'onion', 'scallion', 'shallot', 'garlic', 'potato', 'carrot', 'celery', 'bell pepper', 'jalapeno', 'cucumber', 'zucchini', 'squash', 'broccoli', 'cauliflower', 'mushroom', 'cabbage', 'corn', 'pea', 'green bean', 'asparagus', 'avocado', 'lemon', 'lime', 'lemon juice', 'lime juice', 'orange', 'apple', 'banana', 'berry', 'berries', 'strawberry', 'blueberry', 'raspberry', 'grape', 'mango', 'pineapple', 'melon', 'peach', 'pear', 'plum', 'cilantro', 'parsley', 'basil', 'mint', 'dill', 'thyme', 'rosemary', 'sage', 'chive', 'ginger', 'herb', 'sweet potato', 'beet', 'radish', 'leek', 'eggplant', 'fennel', 'cherry']],
  ['Meat & Seafood', ['chicken', 'beef', 'steak', 'pork', 'bacon', 'sausage', 'turkey', 'lamb', 'ham', 'ground meat', 'mince', 'shrimp', 'prawn', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'fish', 'scallop', 'crab', 'lobster', 'mussel', 'clam', 'chorizo', 'pancetta', 'prosciutto', 'brisket', 'ribs']],
  ['Dairy & Eggs', ['milk', 'cream', 'half and half', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'ricotta', 'yogurt', 'yoghurt', 'sour cream', 'egg', 'creme fraiche', 'buttermilk', 'mascarpone', 'cream cheese']],
  ['Bakery', ['bread', 'bun', 'roll', 'baguette', 'tortilla', 'pita', 'naan', 'bagel', 'croissant', 'brioche', 'english muffin']],
  ['Pantry & Dry Goods', ['flour', 'sugar', 'rice', 'pasta', 'spaghetti', 'penne', 'noodle', 'oat', 'quinoa', 'couscous', 'lentil', 'barley', 'cornmeal', 'breadcrumb', 'panko', 'baking powder', 'baking soda', 'yeast', 'cornstarch', 'oil', 'vinegar', 'honey', 'maple syrup', 'molasses', 'peanut butter', 'nut', 'almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'seed', 'sesame', 'chocolate', 'cocoa', 'vanilla', 'gelatin', 'stock', 'broth', 'soy sauce', 'fish sauce', 'worcestershire', 'mustard', 'mayonnaise', 'mayo', 'ketchup', 'hot sauce', 'sriracha', 'tahini', 'miso', 'raisin', 'date', 'coconut']],
  ['Canned & Jarred', ['canned', 'can of', 'tomato paste', 'tomato sauce', 'puree', 'tomato puree', 'crushed tomatoes', 'diced tomatoes', 'coconut milk', 'bean', 'chickpea', 'garbanzo', 'olive', 'caper', 'anchovy', 'pickle', 'salsa', 'jam', 'jelly', 'pumpkin puree', 'artichoke']],
  ['Spices & Seasonings', ['salt', 'pepper', 'peppercorn', 'cumin', 'paprika', 'cinnamon', 'nutmeg', 'clove', 'cardamom', 'coriander', 'turmeric', 'curry', 'chili powder', 'chile powder', 'cayenne', 'oregano', 'bay leaf', 'bay leaves', 'red pepper flakes', 'garlic powder', 'onion powder', 'allspice', 'seasoning', 'spice', 'za’atar', 'sumac', 'saffron', 'star anise']],
  ['Frozen', ['frozen', 'ice cream', 'puff pastry', 'phyllo', 'pie crust']],
  ['Beverages', ['water', 'wine', 'beer', 'juice', 'coffee', 'tea', 'soda', 'seltzer', 'sparkling', 'vodka', 'rum', 'whiskey', 'bourbon', 'tequila', 'brandy', 'sherry', 'vermouth']],
];


// Two names for one thing. The left-hand side is what the key becomes, so a
// recipe calling for green onions and one calling for scallions end up on the
// same line of the list. Keys are already singular and stripped of the
// stopwords above by the time this is applied.
const SYNONYMS = new Map(Object.entries({
  'scallion': ['green onion', 'spring onion', 'salad onion'],
  'cilantro': ['coriander leaf', 'fresh coriander', 'chinese parsley'],
  'chickpea': ['garbanzo', 'garbanzo bean', 'ceci bean'],
  'zucchini': ['courgette'],
  'eggplant': ['aubergine'],
  'arugula': ['rocket', 'rucola'],
  'bell pepper': ['capsicum', 'sweet pepper'],
  'shrimp': ['prawn'],
  'ground beef': ['minced beef', 'beef mince', 'hamburger meat', 'ground chuck'],
  'ground pork': ['minced pork', 'pork mince'],
  'ground turkey': ['minced turkey', 'turkey mince'],
  'cornstarch': ['corn flour', 'cornflour', 'corn starch'],
  'powdered sugar': ['confectioner sugar', 'icing sugar', 'powder sugar'],
  'superfine sugar': ['caster sugar', 'castor sugar'],
  'heavy cream': ['double cream', 'whipping cream', 'heavy whipping cream'],
  'half and half': ['single cream', 'light cream'],
  'all purpose flour': ['plain flour', 'ap flour'],
  'bread flour': ['strong flour', 'strong white flour'],
  'baking soda': ['bicarbonate soda', 'bicarb soda', 'sodium bicarbonate'],
  'molasses': ['treacle', 'black treacle'],
  'golden raisin': ['sultana'],
  'beet': ['beetroot'],
  'snow pea': ['mangetout'],
  'scampi': ['langoustine'],
  'romaine': ['cos lettuce'],
  'tomato paste': ['tomato puree', 'tomato concentrate'],
  'oatmeal': ['rolled oat', 'porridge oat', 'old fashioned oat'],
  'peanut': ['groundnut'],
  'canola oil': ['rapeseed oil'],
  'broth': ['stock'],
  'soda water': ['club soda', 'sparkling water', 'seltzer'],
  'napa cabbage': ['chinese cabbage', 'wombok'],
  'jalapeno': ['jalapeno pepper'],
  'green bean': ['string bean', 'french bean', 'haricot vert'],
  'sweet potato': ['yam'],
  'granola': ['muesli'],
  'shortening': ['vegetable shortening'],
  'parchment paper': ['baking paper', 'greaseproof paper'],
}));

const CANONICAL = new Map();
for (const [canonical, names] of SYNONYMS) {
  // The canonical name maps to itself, so that "ground beef" survives the
  // stopword pass that would otherwise leave just "beef".
  CANONICAL.set(canonical, canonical);
  for (const name of names) CANONICAL.set(name, canonical);
}

/** The agreed name for an ingredient, if it goes by more than one. */
export function canonicalName(key) {
  return CANONICAL.get(key) || key;
}

function pluralize(word) {
  if (/(s|x|ch|sh)$/.test(word)) return word + 'es';
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

function singularize(word) {
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|sses|oes)$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** "1½" -> "1 1/2", "¼" -> "1/4" */
export function normalizeFractions(text) {
  let out = '';
  for (const ch of text) {
    if (UNICODE_FRACTIONS[ch] !== undefined) {
      const value = UNICODE_FRACTIONS[ch];
      const [num, den] = nearestFraction(value);
      out += (out && /\d$/.test(out) ? ' ' : '') + num + '/' + den;
    } else {
      out += ch;
    }
  }
  return out;
}

function nearestFraction(value, denominators = [2, 3, 4, 5, 6, 8]) {
  let best = [0, 1];
  let bestErr = Infinity;
  for (const den of denominators) {
    const num = Math.round(value * den);
    const err = Math.abs(value - num / den);
    if (err < bestErr - 1e-9) {
      bestErr = err;
      best = [num, den];
    }
  }
  return best;
}

const NUMBER = String.raw`\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+`;
const QUANTITY_RE = new RegExp(
  String.raw`^\s*(${NUMBER})\s*(?:(?:-|–|—|to|or)\s*(${NUMBER}))?\s*`, 'i');

function parseNumber(text) {
  const cleaned = text.replace(/\s*\/\s*/g, '/').trim();
  const mixed = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = cleaned.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one recipe line into { raw, qty, unit, name, note, key, aisle }.
 * Anything it can't read stays in `name` so nothing is silently dropped.
 */
export function parseIngredient(raw) {
  const original = String(raw ?? '').replace(/\s+/g, ' ').trim();
  // Recipe sites prefix lines with bullets, checkboxes and other furniture.
  let text = normalizeFractions(original)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();

  const notes = [];

  // Parentheticals are notes ("2 (14.5 oz) cans diced tomatoes" -> note "14.5 oz").
  text = text.replace(/\(([^)]*)\)/g, (_, inner) => {
    const trimmed = inner.trim();
    // Blogs annotate lines with per-item costs; that is not shopping information.
    if (trimmed && !/^[$£€]\s*[\d.,]+$/.test(trimmed)) notes.push(trimmed);
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  let qty = null;
  const qtyMatch = text.match(QUANTITY_RE);
  if (qtyMatch) {
    const low = parseNumber(qtyMatch[1]);
    const high = qtyMatch[2] ? parseNumber(qtyMatch[2]) : null;
    if (low !== null) {
      qty = low;
      if (high !== null && high !== low) notes.push(`recipe says ${qtyMatch[1]}–${qtyMatch[2]}`);
      text = text.slice(qtyMatch[0].length).trim();
    }
  }

  let unit = null;
  const lowered = text.toLowerCase();
  for (const alias of UNIT_ALIASES) {
    if (lowered.startsWith(alias) && /^[\s.,]|^$/.test(lowered.slice(alias.length))) {
      unit = UNIT_LOOKUP.get(alias).id;
      text = text.slice(alias.length).replace(/^[\s.,]+/, '').trim();
      break;
    }
  }

  text = text.replace(/^of\s+/i, '').trim();

  // "1 garlic clove" / "2 chicken breasts" put the unit after the ingredient.
  if (qty !== null && !unit) {
    const trailing = text.match(/^(.*\S)\s+([a-z]+)$/i);
    if (trailing) {
      const candidate = UNIT_LOOKUP.get(trailing[2].toLowerCase());
      if (candidate && candidate.loose && TRAILING_UNITS.has(candidate.id)) {
        unit = candidate.id;
        text = trailing[1].trim();
      }
    }
  }

  // A comma usually starts preparation notes ("1 onion, finely chopped"), but not
  // always ("5 boneless, skinless chicken thighs") -- only split on the first kind.
  const commaIdx = text.indexOf(',');
  if (commaIdx > 0) {
    const tail = text.slice(commaIdx + 1).trim();
    const firstWord = tail.toLowerCase().split(/[\s,]+/)[0] || '';
    if (tail && PREP_WORDS.has(firstWord)) {
      notes.push(tail);
      text = text.slice(0, commaIdx).trim();
    }
  }

  const name = text.replace(/[*\u2020\u2021]+$/, '').replace(/[.;:,]+$/, '').trim();
  return {
    raw: original,
    qty,
    unit,
    name: name || original,
    note: notes.join('; '),
    key: ingredientKey(name || original),
    aisle: aisleFor(name || original),
  };
}

/** Normalized bucket used to merge the same ingredient across recipes. */
function foldAccents(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function ingredientKey(name) {
  const words = foldAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singularize);
  if (!words.length) return String(name).toLowerCase().trim();

  // Look the whole phrase up before dropping descriptive words, or "plain
  // flour" would become "flour" and "ground beef" just "beef" before either
  // could be recognised.
  const whole = words.join(' ');
  if (CANONICAL.has(whole)) return CANONICAL.get(whole);

  const kept = words.filter((word) => !KEY_STOPWORDS.has(word));
  return canonicalName((kept.length ? kept : words).join(' ').trim());
}

export function aisleFor(name) {
  if (/^\s*frozen\b/i.test(name)) return 'Frozen';
  const clean = ' ' + foldAccents(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  let best = null;
  for (const [aisle, keywords] of AISLES) {
    for (const keyword of keywords) {
      if (!clean.includes(' ' + keyword + ' ') && !clean.includes(' ' + keyword + 's ')) continue;
      // The head noun sits at the end: "olive oil" belongs with the oils, not the olives.
      const score = keyword.length + (clean.trimEnd().endsWith(' ' + keyword) || clean.trimEnd().endsWith(' ' + keyword + 's') ? 20 : 0);
      if (!best || score > best.score) best = { aisle, score };
    }
  }
  return best ? best.aisle : 'Other';
}

export const AISLE_ORDER = [...AISLES.map(([a]) => a), 'Other'];

function unitDef(id) {
  return id ? UNIT_LOOKUP.get(id) || null : null;
}

function ladderFor(dim, metric) {
  return DISPLAY_LADDERS[metric ? `${dim}-metric` : dim] || null;
}

/** Sum amounts that share a dimension, then pick a human-sized unit. */
function combineAmounts(entries) {
  const buckets = new Map();
  let unquantified = false;

  for (const entry of entries) {
    if (entry.qty === null || entry.qty === undefined) {
      unquantified = true;
      continue;
    }
    const def = unitDef(entry.unit);
    const bucketId = def && def.dim ? def.dim : `fixed:${entry.unit || 'count'}`;
    const bucket = buckets.get(bucketId) || {
      dim: def && def.dim, unit: entry.unit, total: 0, metric: true, sameUnit: true,
    };
    bucket.total += entry.qty * (def && def.dim ? def.factor : 1);
    if (!def || !def.metric) bucket.metric = false;
    if (bucket.unit !== entry.unit) bucket.sameUnit = false;
    buckets.set(bucketId, bucket);
  }

  const amounts = [];
  for (const bucket of buckets.values()) {
    if (bucket.dim) {
      // "1/3 cup" reads better than "5 1/3 tbsp", so only convert when the
      // amounts actually came in different units.
      if (bucket.sameUnit) {
        amounts.push({ qty: bucket.total / unitDef(bucket.unit).factor, unit: bucket.unit });
        continue;
      }
      const ladder = ladderFor(bucket.dim, bucket.metric) || [];
      let chosen = ladder[0];
      for (const id of ladder) {
        const def = unitDef(id);
        if (bucket.total / def.factor >= 1) chosen = id;
      }
      const def = unitDef(chosen);
      amounts.push({ qty: bucket.total / def.factor, unit: chosen });
    } else {
      const unit = bucket.unit;
      const plural = unit && bucket.total > 1 && UNIT_LOOKUP.get(unit)?.loose ? pluralize(unit) : unit;
      amounts.push({ qty: bucket.total, unit: plural || null });
    }
  }
  return { amounts, unquantified };
}

export function formatQty(value) {
  if (value === null || value === undefined) return '';
  const rounded = Math.round(value * 1000) / 1000;
  const whole = Math.floor(rounded + 1e-9);
  const rest = rounded - whole;
  if (rest < 0.02) return String(whole);
  const [num, den] = nearestFraction(rest, [2, 3, 4, 8]);
  if (Math.abs(rest - num / den) < 0.021 && num > 0 && num < den) {
    return whole ? `${whole} ${num}/${den}` : `${num}/${den}`;
  }
  return String(Math.round(rounded * 100) / 100);
}

export function formatAmount({ qty, unit }) {
  const q = formatQty(qty);
  if (!q) return unit || '';
  return unit ? `${q} ${unit}` : q;
}

/**
 * Collapse many parsed lines into one shopping list.
 * entries: [{ ...parsedIngredient, scale, source }]
 */
export function buildList(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const scale = entry.scale ?? 1;
    const key = entry.key || ingredientKey(entry.name);
    const group = groups.get(key) || {
      key,
      name: entry.name,
      aisle: entry.aisle || aisleFor(entry.name),
      parts: [],
      sources: [],
      notes: [],
    };
    // Prefer the shortest label: "parsley" reads better than "fresh flat-leaf parsley".
    if (entry.name && entry.name.length < group.name.length) group.name = entry.name;
    group.parts.push({ qty: entry.qty === null || entry.qty === undefined ? null : entry.qty * scale, unit: entry.unit });
    if (entry.source && !group.sources.includes(entry.source)) group.sources.push(entry.source);
    if (entry.note) group.notes.push(entry.note);
    groups.set(key, group);
  }

  const items = [...groups.values()].map((group) => {
    const { amounts, unquantified } = combineAmounts(group.parts);
    const text = amounts.map(formatAmount).filter(Boolean).join(' + ');
    return {
      key: group.key,
      name: group.name,
      aisle: group.aisle,
      amount: text || (unquantified ? '' : ''),
      amountNote: text && unquantified ? '+ more' : '',
      sources: group.sources,
      notes: [...new Set(group.notes)],
    };
  });

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** A pantry staple matches when the keys are equal or one fully contains the other. */
export function pantryMatch(pantryKeys, itemKey) {
  for (const pantryKey of pantryKeys) {
    if (!pantryKey) continue;
    if (pantryKey === itemKey) return pantryKey;
    const a = ` ${pantryKey} `;
    const b = ` ${itemKey} `;
    if (a.includes(b) || b.includes(a)) return pantryKey;
  }
  return null;
}
