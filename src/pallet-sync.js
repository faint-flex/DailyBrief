// Pallet Router sharing: two phones on one code see the same day.
// Each code is one Durable Object (SQLite storage, in the free plan) that keeps
// the merged day and a version number, so a phone with nothing new only polls.
//
//   POST /pallets/sync { code, ver, doc?, create? }
//     -> { ver, doc? }   doc comes back when the phone's copy is out of date
import { mergeDocs, canon } from '../public/pallets/merge.js';

const MAX_BODY = 2 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handlePalletSync(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!env.PALLET_ROOMS) return json({ error: 'Sharing is not set up on this deployment.' }, 501);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Not allowed.' }, 403);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'That is too big.' }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!/^\d{6}$/.test(String(input.code || ''))) return json({ error: 'The code is 6 digits.' }, 400);
  const room = env.PALLET_ROOMS.get(env.PALLET_ROOMS.idFromName(String(input.code)));
  return room.fetch('https://room/sync', { method: 'POST', body: raw });
}

/** The logic of one shared code, kept apart from the Durable Object so it can be tested. */
export async function syncRoom(storage, input) {
  const stored = (await storage.get('doc')) || null;
  let ver = (await storage.get('ver')) || 0;
  if (input.create && stored) return { status: 409, body: { error: 'That code is taken.' } };
  if (!input.create && !stored && !input.doc) return { status: 404, body: { error: 'No one is sharing with that code.' } };
  if (input.doc) {
    const merged = stored ? mergeDocs(stored, input.doc) : mergeDocs(input.doc, input.doc);
    if (!stored || canon(stored) !== canon(merged)) {
      ver += 1;
      await storage.put({ doc: merged, ver, touched: Date.now() });
    }
    return { status: 200, body: { ver, doc: merged } };
  }
  if (input.ver === ver) return { status: 200, body: { ver } };
  return { status: 200, body: { ver, doc: stored } };
}

export class PalletRoom {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const input = await request.json();
    const { status, body } = await syncRoom(this.ctx.storage, input);
    // Forget a code two weeks after its last change.
    if (status === 200) await this.ctx.storage.setAlarm(Date.now() + 14 * 86400000);
    return json(body, status);
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
