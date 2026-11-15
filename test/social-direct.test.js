import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { startConnect, finishConnect, readDirect, overlaySocial } from '../src/social-direct.js';
import { distillNightly } from '../src/stats.js';
import { memoryKv } from './helpers.js';

const keys = { TIKTOK_CLIENT_KEY: 'tk', TIKTOK_CLIENT_SECRET: 'ts', IG_APP_ID: 'ig', IG_APP_SECRET: 'is', IG_CONFIG_ID: 'cfg' };
const ok = (data) => new Response(JSON.stringify(data), { status: 200 });

function fakeApis(log = []) {
  return async (url, init = {}) => {
    log.push(url);
    if (url.startsWith('https://open.tiktokapis.com/v2/oauth/token/')) {
      const body = new URLSearchParams(init.body);
      return ok({ access_token: `tt-${body.get('grant_type')}`, refresh_token: 'tt-refresh', expires_in: 86400, refresh_expires_in: 31536000 });
    }
    if (url.startsWith('https://open.tiktokapis.com/v2/user/info/')) return ok({ data: { user: { follower_count: 12, likes_count: 40, video_count: 1 } }, error: { code: 'ok' } });
    if (url.startsWith('https://open.tiktokapis.com/v2/video/list/')) {
      return ok({ data: { videos: [{ id: 'v1', title: 'Logging a feed at 3am', create_time: 1763211195, share_url: 'https://www.tiktok.com/@usebabylog/video/1', view_count: 950, like_count: 33, comment_count: 4, share_count: 2 }] }, error: { code: 'ok' } });
    }
    if (url.startsWith('https://graph.facebook.com/v21.0/oauth/access_token?') && url.includes('code=')) return ok({ access_token: 'suat' });
    if (url.includes('/me/accounts?')) return ok({ data: [{ id: 'page1' }, { id: 'page2', instagram_business_account: { id: '1784' } }] });
    if (url.includes('/v21.0/1784?')) return ok({ username: 'usebabylog', followers_count: 58, media_count: 2 });
    if (url.includes('/v21.0/1784/media?')) {
      return ok({ data: [{ id: 'm1', caption: 'Logging a feed at 3am\nmore', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/x/', timestamp: '2026-11-15T03:07:56+0000', like_count: 21, comments_count: 3 },
        { id: 'm2', caption: 'Which side?', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/y/', timestamp: '2026-11-15T03:07:10+0000', like_count: 9, comments_count: 1 }] });
    }
    if (url.includes('/m1/insights')) return ok({ data: [{ name: 'views', values: [{ value: 1200 }] }, { name: 'reach', values: [{ value: 800 }] }, { name: 'shares', values: [{ value: 5 }] }, { name: 'saved', values: [{ value: 7 }] }] });
    if (url.includes('/m2/insights')) {
      if (url.includes('views')) return new Response(JSON.stringify({ error: { message: 'views not supported' } }), { status: 400 });
      return ok({ data: [{ name: 'reach', values: [{ value: 300 }] }] });
    }
    return new Response('{}', { status: 404 });
  };
}

test('connect: sign-in link, one-time state, tokens kept, bad state refused', async () => {
  const kv = memoryKv();
  assert.ok((await startConnect({}, kv, 'tiktok', 'https://b.test')).error);
  const { url } = await startConnect(keys, kv, 'tiktok', 'https://b.test');
  const state = new URL(url).searchParams.get('state');
  assert.equal(new URL(url).searchParams.get('redirect_uri'), 'https://b.test/oauth/tiktok');
  const back = await finishConnect(keys, kv, 'tiktok', new URL(`https://b.test/oauth/tiktok?code=abc&state=${state}`), fakeApis());
  assert.equal(back, '/stats#connected=tiktok');
  assert.equal(JSON.parse(kv.map.get('social-token:tiktok')).access, 'tt-authorization_code');
  // The same state can't be used twice.
  assert.match(await finishConnect(keys, kv, 'tiktok', new URL(`https://b.test/oauth/tiktok?code=abc&state=${state}`), fakeApis()), /connect-error/);
  const ig = await startConnect(keys, kv, 'instagram', 'https://b.test');
  const igState = new URL(ig.url).searchParams.get('state');
  assert.equal(await finishConnect(keys, kv, 'instagram', new URL(`https://b.test/oauth/instagram?code=c&state=${igState}`), fakeApis()), '/stats#connected=instagram');
  const igToken = JSON.parse(kv.map.get('social-token:instagram'));
  assert.equal(igToken.access, 'suat');
  assert.equal(igToken.expires, null);
  assert.equal(igToken.igUser, '1784');
  assert.match(ig.url, /facebook\.com\/v21\.0\/dialog\/oauth\?.*config_id=cfg/);
});

test('direct reads: TikTok videos + followers, Instagram views/reach, expired TikTok token refreshed', async () => {
  const kv = memoryKv();
  await kv.put('social-token:tiktok', JSON.stringify({ access: 'old', refresh: 'r', expires: Date.now() - 1000, at: Date.now() - 864e5 }));
  await kv.put('social-token:instagram', JSON.stringify({ access: 'suat', expires: null, at: Date.now(), igUser: '1784' }));
  const d = await readDirect(keys, kv, fakeApis());
  assert.equal(d.tiktok.connected, true);
  assert.equal(d.tiktok.account.followers, 12);
  assert.equal(d.tiktok.posts[0].metrics.views, 950);
  assert.equal(JSON.parse(kv.map.get('social-token:tiktok')).access, 'tt-refresh_token');
  assert.equal(d.instagram.posts[0].metrics.views, 1200);
  assert.equal(d.instagram.posts[0].metrics.saves, 7);
  assert.equal(d.instagram.posts[1].metrics.reach, 300);
  assert.equal(d.instagram.posts[0].text, 'Logging a feed at 3am');
  const none = await readDirect({}, kv, fakeApis());
  assert.deepEqual(none.tiktok, { connected: false, setup: false });
  const notYet = await readDirect(keys, memoryKv(), fakeApis());
  assert.deepEqual(notYet.instagram, { connected: false, setup: true });
});

test('direct numbers replace Buffer\'s for that platform, nightly and live', async () => {
  const kv = memoryKv();
  await kv.put('social-token:instagram', JSON.stringify({ access: 'suat', expires: null, at: Date.now(), igUser: '1784' }));
  const direct = await readDirect(keys, kv, fakeApis());
  const buffer = { connected: true, posts: [{ service: 'instagram', status: 'sent', metrics: {} }, { service: 'tiktok', status: 'sent', metrics: { views: 5 } }], week: {} };
  const merged = overlaySocial(buffer, direct);
  assert.equal(merged.posts.filter((p) => p.service === 'instagram').length, 2);
  assert.equal(merged.posts.filter((p) => p.service === 'tiktok').length, 1);
  const { snapshot } = distillNightly({ day: '2026-11-15', social: buffer }, new Date(), direct);
  assert.equal(snapshot.social.totals.instagram.views, 1200);
  assert.equal(snapshot.social.totals.instagram.followers, 58);
  assert.equal(snapshot.social.totals.tiktok.views, 5);
  assert.deepEqual(snapshot.social.direct, ['instagram']);
  assert.equal(overlaySocial(buffer, {}), buffer);
});

test('the worker routes: connect needs the key, the sign-in return redirects to the Stats tab', async () => {
  const env = { BRIEF_KEY: 'k', BRIEFS: memoryKv(), ...keys };
  const call = (path, init = {}) => worker.fetch(new Request(`https://b.test${path}`, init), env);
  assert.equal((await call('/api/stats/connect?platform=tiktok', { method: 'POST' })).status, 401);
  const r = await call('/api/stats/connect?platform=tiktok', { method: 'POST', headers: { Authorization: 'Bearer k' } });
  assert.match((await r.json()).url, /^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize\//);
  const back = await call('/oauth/tiktok?state=nope&code=x');
  assert.equal(back.status, 302);
  assert.match(back.headers.get('Location'), /\/stats#connect-error=/);
});
