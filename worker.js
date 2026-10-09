// Cloudflare Worker entry point. Static files are served by Workers Assets;
// this handles the API:
//
//   POST /api/brief     the morning run sends the day's brief here
//   GET  /api/brief     the phone reads the latest (or ?date=YYYY-MM-DD)
//   POST /api/dinner    "Add to list" for one of the brief's dinners
//   GET  /photo/...     a meal photo, copied from the recipe site when the brief arrived
//
// Every /api call needs the key (Authorization: Bearer <key>), because a brief
// is a summary of your inbox.
import { normalizeBrief, briefStore } from './src/brief.js';
import { addToGrocerylist, GroceryError } from './src/grocery.js';
import { savePhotos, servePhoto } from './src/photos.js';

const MAX_BODY = 64 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Compares digests so the check takes the same time however close a guess is. */
export async function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function keyFrom(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error('That is too big.');
  return JSON.parse(raw);
}

/** Reach Grocerylist: a service binding on Cloudflare, or its address otherwise. */
function groceryCaller(env) {
  if (env.GROCERY) return (path, init) => env.GROCERY.fetch(new Request(`https://grocerylist${path}`, init));
  if (env.GROCERY_URL) return (path, init) => fetch(`${env.GROCERY_URL.replace(/\/+$/, '')}${path}`, init);
  return null;
}

export async function handleApi(request, env, url) {
  if (!env.BRIEF_KEY) return json({ error: 'This app has no key set yet. Run npm run setup.' }, 501);
  if (!(await keyMatches(keyFrom(request), env.BRIEF_KEY))) return json({ error: 'Wrong or missing key.' }, 401);
  if (!env.BRIEFS) return json({ error: 'Storage is not set up on this deployment.' }, 501);
  const store = briefStore(env.BRIEFS);

  if (url.pathname === '/api/brief') {
    if (request.method === 'GET') {
      const brief = await store.get(url.searchParams.get('date'));
      return json({ brief, dates: await store.dates() });
    }
    if (request.method === 'POST') {
      let input;
      try {
        input = await readJson(request);
      } catch {
        return json({ error: 'Could not read that brief as JSON.' }, 400);
      }
      const { brief, error } = normalizeBrief(input);
      if (error) return json({ error }, 400);
      await savePhotos(env.BRIEFS, brief);
      await store.put(brief);
      return json({
        ok: true,
        date: brief.date,
        dinners: brief.dinners.length,
        photos: brief.dinners.filter((dinner) => dinner.photo).length,
      });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (url.pathname === '/api/dinner') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    let input;
    try {
      input = await readJson(request);
    } catch {
      return json({ error: 'Could not read that request.' }, 400);
    }
    const brief = await store.get(input.date);
    const dinner = brief && brief.dinners[input.index];
    if (!dinner) return json({ error: 'That dinner is not in the brief.' }, 404);
    const call = groceryCaller(env);
    if (!call) return json({ error: 'Add to list is not connected to Grocerylist yet.' }, 501);
    try {
      const result = await addToGrocerylist(call, env.GROCERY_CODE, dinner);
      await store.markAdded(brief.date, dinner.name);
      return json(result);
    } catch (error) {
      const status = error instanceof GroceryError ? error.status : 502;
      return json({ error: error.message || 'Could not reach Grocerylist.' }, status);
    }
  }

  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    // Meal photos are public: they are recipe-site pictures, nothing personal.
    if (url.pathname.startsWith('/photo/') && env.BRIEFS) return servePhoto(env.BRIEFS, url.pathname);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
