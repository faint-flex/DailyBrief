import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import { distillNightly, mergeHistory, readLive, clearLiveCache, KEEP_DAYS } from '../src/stats.js';
import { memoryKv } from './helpers.js';

const KEY = 'test-key-123';
const raw = JSON.parse(readFileSync(new URL('./fixtures/babylog-report.json', import.meta.url)));
const env = (extra = {}) => ({ BRIEF_KEY: KEY, BRIEFS: memoryKv(), ...extra });
const call = (e, path, { method = 'GET', body, key = KEY } = {}) => worker.fetch(new Request(`https://brief.test${path}`, {
  method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body,
}), e);

test('a raw nightly report is distilled into what the dashboard draws', () => {
  const { snapshot } = distillNightly({ ...raw, headline: 'First full day', suggestion: 'Post the freezer image' });
  assert.equal(snapshot.day, '2026-11-15');
  assert.equal(snapshot.headline, 'First full day');
  assert.deepEqual(snapshot.website.days, [{ date: '2026-11-15', visitors: 335, pageViews: 423 }]);
  assert.ok(!snapshot.website.pages.some((p) => p.path.startsWith('/cdn-cgi')));
  assert.equal(snapshot.website.countries[0].code, 'US');
  assert.equal(snapshot.social.totals.instagram.posts, 2);
  assert.equal(snapshot.social.totals.tiktok.posts, 1);
  assert.equal(snapshot.social.scheduled, 1);
  assert.equal(snapshot.social.week.instagram.engagementRate, undefined);
  assert.equal(snapshot.appStore.sales.length, 1);
  assert.equal(snapshot.appStore.sales[0].downloads, 2);
  assert.equal(snapshot.social.posts[1].link, 'https://www.instagram.com/reel/DfvxzsfhC8F/');
  assert.ok(distillNightly({}).error);
  assert.ok(distillNightly({ day: '2026-11-15' }).error);
});

test('a source that is not connected stays not connected', () => {
  const { snapshot } = distillNightly({ day: '2026-11-15', website: { connected: false, need: 'X' }, social: { error: 'boom' }, appStore: {} });
  assert.equal(snapshot.website.connected, false);
  assert.equal(snapshot.social.error, 'boom');
  assert.equal(snapshot.appStore.connected, false);
});

test('history merges by date, later runs correct a day, and old days drop off', () => {
  const a = distillNightly(raw).snapshot;
  let h = mergeHistory(null, a);
  assert.deepEqual(h.site['2026-11-15'], { visitors: 335, pageViews: 423 });
  assert.equal(h.store['2026-11-14'].downloads, 2);
  assert.ok(h.social['2026-11-15'].instagram);
  const later = structuredClone(raw);
  later.day = '2026-11-16';
  later.website.days = [{ date: '2026-11-15', visitors: 400, pageViews: 500 }, { date: '2026-11-16', visitors: 50, pageViews: 60 }];
  h = mergeHistory(h, distillNightly(later).snapshot);
  assert.equal(h.site['2026-11-15'].visitors, 400);
  assert.equal(Object.keys(h.social).length, 2);
  const many = { site: {}, store: {}, social: {} };
  for (let i = 0; i < KEEP_DAYS + 5; i += 1) many.site[new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)] = { visitors: i, pageViews: i };
  assert.equal(Object.keys(mergeHistory(many, a).site).length, KEEP_DAYS);
});

test('the stats API is locked, takes the nightly numbers and reads them back', async () => {
  const e = env();
  assert.equal((await call(e, '/api/stats', { key: 'wrong' })).status, 401);
  const empty = await (await call(e, '/api/stats')).json();
  assert.equal(empty.nightly, null);
  assert.equal(empty.live, null);
  assert.deepEqual(empty.liveKeys, { website: false, social: false });
  assert.equal((await call(e, '/api/stats', { method: 'POST', body: 'nope' })).status, 400);
  const sent = await call(e, '/api/stats', { method: 'POST', body: JSON.stringify(raw) });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).day, '2026-11-15');
  // An older backfill adds history but doesn't replace the newest night.
  await call(e, '/api/stats', { method: 'POST', body: JSON.stringify({ ...raw, day: '2026-11-10' }) });
  const got = await (await call(e, '/api/stats')).json();
  assert.equal(got.nightly.day, '2026-11-15');
  assert.ok(got.history.social['2026-11-10']);
  assert.equal(got.history.site['2026-11-15'].visitors, 335);
});

test('live numbers come from Cloudflare and Buffer with the worker\'s own keys', async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    seen.push({ url, auth: init.headers.Authorization });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    if (url.includes('/zones?name=')) return ok({ result: [{ id: 'zone1' }] });
    if (url.includes('cloudflare.com/client/v4/graphql')) {
      if (body.query.includes('httpRequests1dGroups')) {
        return ok({ data: { viewer: { zones: [{ httpRequests1dGroups: [
          { dimensions: { date: '2026-11-14' }, sum: { pageViews: 300 }, uniq: { uniques: 200 } },
          { dimensions: { date: '2026-11-15' }, sum: { pageViews: 450 }, uniq: { uniques: 350 } }] }] } } });
      }
      const dim = body.query.match(/dimensions\{(\w+)\}/)[1];
      const value = { clientRequestPath: '/', clientCountryName: 'US', datetimeHour: '2026-11-15T13:00:00Z' }[dim];
      return ok({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count: 42, dimensions: { [dim]: value } }] }] } } });
    }
    if (url === 'https://api.buffer.com') {
      if (body.query.includes('organizations')) return ok({ data: { account: { organizations: [{ id: 'org1' }] } } });
      if (body.query.includes('channels')) return ok({ data: { channels: [{ id: 'c1', service: 'instagram', name: 'usebabylog' }] } });
      if (body.query.includes('posts')) {
        return ok({ data: { posts: { edges: [
          { node: { status: 'sent', sentAt: '2026-11-15T03:07:10Z', text: 'Which side?\nmore', channelService: 'instagram', externalLink: 'https://www.instagram.com/p/x/', metrics: [{ type: 'views', value: 120 }, { type: 'reactions', value: 9 }] } },
          { node: { status: 'sent', sentAt: '2026-11-15T03:08:10Z', text: 'Reel', channelService: 'instagram', externalLink: null, metrics: [{ type: 'views', value: 80 }] } }] } } });
      }
      if (body.query.includes('aggregatedPostMetrics')) return ok({ data: { aggregatedPostMetrics: { metrics: [{ type: 'follows', value: 3 }] } } });
    }
    return new Response('{}', { status: 404 });
  };
  const live = await readLive({ STATS_CF_TOKEN: 'cf', STATS_BUFFER_KEY: 'bf' }, fetcher, new Date('2026-11-15T22:00:00Z'));
  assert.equal(live.website.connected, true);
  assert.equal(live.website.days.at(-1).visitors, 350);
  assert.equal(live.website.pages[0].views, 42);
  assert.equal(live.website.hours[0].views, 42);
  assert.equal(live.social.totals.instagram.views, 200);
  assert.equal(live.social.totals.instagram.reactions, 9);
  assert.equal(live.social.week.instagram.follows, 3);
  assert.equal(live.social.posts[0].text, 'Which side?');
  assert.ok(seen.some((s) => s.auth === 'Bearer cf') && seen.some((s) => s.auth === 'Bearer bf'));

  const half = await readLive({ STATS_BUFFER_KEY: 'bf' }, fetcher);
  assert.equal(half.website.connected, false);
  assert.equal(half.website.need, 'STATS_CF_TOKEN');
  const broken = await readLive({ STATS_CF_TOKEN: 'cf' }, async () => new Response('{"errors":[{"message":"no"}]}', { status: 403 }));
  assert.equal(broken.website.connected, false);
  assert.match(broken.website.error, /Cloudflare 403/);
  clearLiveCache();
});
