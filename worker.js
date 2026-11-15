// Cloudflare Worker entry point. Static files are served by Workers Assets;
// this handles the API:
//
//   POST /api/brief     the morning run sends the day's brief here
//   GET  /api/brief     the phone reads the latest (or ?date=YYYY-MM-DD)
//   POST /api/report    an evening app report (BabyLog numbers) is sent here
//   GET  /api/report    the phone reads the latest (?app=babylog&date=YYYY-MM-DD)
//   POST /api/stats     the nightly BabyLog Daily Report run sends its raw numbers here
//   GET  /api/stats     the Stats tab: live website + social, nightly App Store, history
//
// Every /api call needs the key (Authorization: Bearer <key>), because a brief
// is a summary of your inbox.
import { normalizeBrief, briefStore } from './src/brief.js';
import { normalizeReport, reportStore } from './src/report.js';
import { distillNightly, statsStore, liveCached } from './src/stats.js';

const MAX_BODY = 64 * 1024;
const MAX_STATS_BODY = 256 * 1024;

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

async function readJson(request, max = MAX_BODY) {
  const raw = await request.text();
  if (raw.length > max) throw new Error('That is too big.');
  return JSON.parse(raw);
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
      await store.put(brief);
      return json({ ok: true, date: brief.date, dinners: brief.dinners.length });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (url.pathname === '/api/report') {
    const reports = reportStore(env.BRIEFS);
    if (request.method === 'GET') {
      const app = /^[a-z0-9-]{1,30}$/.test(url.searchParams.get('app') || '') ? url.searchParams.get('app') : 'babylog';
      return json({ report: await reports.get(app, url.searchParams.get('date')), dates: await reports.dates(app) });
    }
    if (request.method === 'POST') {
      let input;
      try {
        input = await readJson(request);
      } catch {
        return json({ error: 'Could not read that report as JSON.' }, 400);
      }
      const { report, error } = normalizeReport(input);
      if (error) return json({ error }, 400);
      await reports.put(report);
      return json({ ok: true, app: report.app, date: report.date });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (url.pathname === '/api/stats') {
    const stats = statsStore(env.BRIEFS);
    if (request.method === 'GET') {
      const [nightly, history, live] = await Promise.all([
        stats.latest(), stats.history(),
        liveCached(env, { fresh: url.searchParams.has('fresh') }).catch(() => null),
      ]);
      return json({ live, nightly, history, liveKeys: { website: !!env.STATS_CF_TOKEN, social: !!env.STATS_BUFFER_KEY } });
    }
    if (request.method === 'POST') {
      let input;
      try {
        input = await readJson(request, MAX_STATS_BODY);
      } catch {
        return json({ error: 'Could not read those numbers as JSON (256 KB at most).' }, 400);
      }
      const { snapshot, error } = distillNightly(input);
      if (error) return json({ error }, 400);
      const history = await stats.put(snapshot);
      return json({ ok: true, day: snapshot.day, days: { site: Object.keys(history.site).length, store: Object.keys(history.store).length, social: Object.keys(history.social).length } });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
