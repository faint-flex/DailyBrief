// Direct reads from TikTok and Instagram for the Stats tab, so stats don't depend on
// Buffer (which can't see TikTok posts finished by hand, or Reel views).
//
// Each platform needs its own developer app; the worker holds the app's id/secret:
//   TikTok     TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET (Login Kit: user.info.basic,
//              user.info.stats, video.list; redirect /oauth/tiktok)
//   Instagram  IG_APP_ID, IG_APP_SECRET, IG_CONFIG_ID (Meta app, Instagram API with Facebook
//              Login for Business: a login configuration with instagram_basic +
//              instagram_manage_insights; redirect /oauth/instagram). Optional IG_USER_ID if the
//              Instagram account can't be found from the token.
// LyFe signs in once from the Stats tab ("Connect"); tokens are kept in KV and refreshed here.

const GRAPH = 'v21.0';
const FB = `https://graph.facebook.com/${GRAPH}`;

export const PLATFORMS = {
  tiktok: {
    ready: (env) => !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
    authorize: (env, redirect, state) => `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY, scope: 'user.info.basic,user.info.stats,video.list',
      response_type: 'code', redirect_uri: redirect, state })}`,
  },
  instagram: {
    ready: (env) => !!(env.IG_APP_ID && env.IG_APP_SECRET && env.IG_CONFIG_ID),
    authorize: (env, redirect, state) => `https://www.facebook.com/${GRAPH}/dialog/oauth?${new URLSearchParams({
      client_id: env.IG_APP_ID, redirect_uri: redirect, response_type: 'code', state, config_id: env.IG_CONFIG_ID,
      override_default_response_type: 'true' })}`,
  },
};

const tokenKey = (p) => `social-token:${p}`;
const stateKey = (s) => `oauth-state:${s}`;
const short = (e) => String(e?.message || e).slice(0, 200);

async function readJsonRes(res, label) {
  const body = await res.json().catch(() => ({}));
  const err = body.error && typeof body.error === 'object' ? body.error : null;
  if (!res.ok || (err && err.code && err.code !== 'ok') || (typeof body.error === 'string' && body.error)) {
    throw new Error(`${label} ${res.status}: ${JSON.stringify(err || body).slice(0, 200)}`);
  }
  return body;
}

/** Starts a sign-in: returns the platform's sign-in address. */
export async function startConnect(env, kv, platform, origin) {
  const p = PLATFORMS[platform];
  if (!p) return { error: 'Unknown platform.' };
  if (!p.ready(env)) return { error: `The brief app is missing its ${platform === 'tiktok' ? 'TikTok' : 'Instagram'} app keys.` };
  const state = crypto.randomUUID();
  await kv.put(stateKey(state), platform, { expirationTtl: 900 });
  return { url: p.authorize(env, `${origin}/oauth/${platform}`, state) };
}

async function exchange(env, platform, code, redirect, fetcher) {
  const now = Date.now();
  if (platform === 'tiktok') {
    const t = await readJsonRes(await fetcher('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
        code, grant_type: 'authorization_code', redirect_uri: redirect }),
    }), 'TikTok');
    return { access: t.access_token, refresh: t.refresh_token, expires: now + (t.expires_in || 86400) * 1000,
      refreshExpires: now + (t.refresh_expires_in || 31536000) * 1000, scope: t.scope, at: now };
  }
  // Facebook Login for Business: a system-user token (never expires) or a user token (made long-lived).
  const t = await readJsonRes(await fetcher(`${FB}/oauth/access_token?${new URLSearchParams({
    client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, redirect_uri: redirect, code })}`), 'Instagram');
  let token = { access: t.access_token, expires: t.expires_in ? now + t.expires_in * 1000 : null, at: now };
  if (t.expires_in && t.expires_in < 30 * 86400) token = await longLived(env, token, fetcher, now);
  token.igUser = await findInstagram(env, token.access, fetcher);
  return token;
}

async function longLived(env, token, fetcher, now = Date.now()) {
  const r = await readJsonRes(await fetcher(`${FB}/oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, fb_exchange_token: token.access })}`), 'Instagram');
  return { ...token, access: r.access_token, expires: r.expires_in ? now + r.expires_in * 1000 : null, at: now };
}

/** The Instagram account id: set by hand, or found through the Facebook Page it's linked to. */
async function findInstagram(env, access, fetcher) {
  if (env.IG_USER_ID) return String(env.IG_USER_ID);
  const tries = [
    `${FB}/me/accounts?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(access)}`,
    `${FB}/me?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(access)}`,
  ];
  for (const url of tries) {
    try {
      const r = await readJsonRes(await fetcher(url), 'Instagram');
      const found = (r.data || [r]).map((x) => x.instagram_business_account?.id).find(Boolean);
      if (found) return String(found);
    } catch { /* try the next way */ }
  }
  return '';
}

/** The sign-in comes back here (GET /oauth/<platform>). Returns where to send the browser. */
export async function finishConnect(env, kv, platform, url, fetcher = fetch) {
  const fail = (why) => `/stats#connect-error=${encodeURIComponent(why)}`;
  if (!PLATFORMS[platform]) return fail('Unknown platform.');
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code');
  if (!state || (await kv.get(stateKey(state))) !== platform) return fail('That sign-in link expired. Tap Connect again.');
  await kv.delete(stateKey(state));
  if (!code) return fail(url.searchParams.get('error_description') || url.searchParams.get('error') || 'Sign-in was cancelled.');
  try {
    const token = await exchange(env, platform, code, `${url.origin}/oauth/${platform}`, fetcher);
    await kv.put(tokenKey(platform), JSON.stringify(token));
    return `/stats#connected=${platform}`;
  } catch (e) {
    return fail(short(e));
  }
}

async function freshToken(env, kv, platform, fetcher, now = Date.now()) {
  const raw = await kv.get(tokenKey(platform));
  if (!raw) return null;
  let t;
  try { t = JSON.parse(raw); } catch { return null; }
  if (platform === 'tiktok' && t.expires - now < 5 * 60e3) {
    const r = await readJsonRes(await fetcher('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: t.refresh }),
    }), 'TikTok refresh');
    t = { ...t, access: r.access_token, refresh: r.refresh_token || t.refresh, expires: now + (r.expires_in || 86400) * 1000, at: now };
    await kv.put(tokenKey(platform), JSON.stringify(t));
  }
  // Instagram via Facebook: system-user tokens never expire; a user token is renewed when it gets old.
  if (platform === 'instagram' && t.expires && t.expires - now < 10 * 864e5 && now - t.at > 864e5) {
    try {
      t = await longLived(env, t, fetcher, now);
      await kv.put(tokenKey(platform), JSON.stringify(t));
    } catch { /* still valid until it expires; try again next time */ }
  }
  if (platform === 'instagram' && !t.igUser) {
    t.igUser = await findInstagram(env, t.access, fetcher);
    if (t.igUser) await kv.put(tokenKey(platform), JSON.stringify(t));
  }
  return t;
}

async function readTikTok(token, fetcher) {
  const auth = { Authorization: `Bearer ${token.access}` };
  const info = await readJsonRes(await fetcher('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count', { headers: auth }), 'TikTok');
  const list = await readJsonRes(await fetcher('https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }),
  }), 'TikTok');
  const u = info.data?.user || {};
  return {
    account: { followers: u.follower_count, likes: u.likes_count, videos: u.video_count, name: u.display_name },
    posts: (list.data?.videos || []).map((v) => ({
      service: 'tiktok', status: 'sent', sentAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      text: v.title || v.video_description || '(video)', link: v.share_url,
      metrics: { views: v.view_count || 0, reactions: v.like_count || 0, comments: v.comment_count || 0, shares: v.share_count || 0 },
    })),
  };
}

async function readInstagram(token, fetcher) {
  if (!token.igUser) throw new Error('Signed in, but no Instagram account was found. Add its id as IG_USER_ID.');
  const g = (path, params = {}) => fetcher(`${FB}/${path}?${new URLSearchParams({ ...params, access_token: token.access })}`)
    .then((r) => readJsonRes(r, 'Instagram'));
  const me = await g(token.igUser, { fields: 'username,followers_count,media_count' });
  const media = await g(`${token.igUser}/media`, { fields: 'id,caption,media_product_type,permalink,timestamp,like_count,comments_count', limit: '20' });
  const posts = await Promise.all((media.data || []).map(async (m) => {
    const metrics = { reactions: m.like_count || 0, comments: m.comments_count || 0 };
    for (const set of ['views,reach,shares,saved', 'reach,shares,saved']) {
      try {
        const ins = await g(`${m.id}/insights`, { metric: set });
        for (const row of ins.data || []) metrics[row.name === 'saved' ? 'saves' : row.name] = row.values?.[0]?.value ?? row.total_value?.value ?? 0;
        break;
      } catch { /* an older post or metric Instagram won't give; try the smaller set */ }
    }
    return { service: 'instagram', status: 'sent', sentAt: m.timestamp, text: (m.caption || '(post)').split('\n')[0], link: m.permalink, metrics };
  }));
  return { account: { followers: me.followers_count, posts: me.media_count, name: me.username }, posts };
}

/** { tiktok: {connected, account, posts} | {connected:false, ...}, instagram: ... } */
export async function readDirect(env, kv, fetcher = fetch) {
  const out = {};
  await Promise.all(Object.keys(PLATFORMS).map(async (platform) => {
    if (!PLATFORMS[platform].ready(env)) { out[platform] = { connected: false, setup: false }; return; }
    try {
      const token = await freshToken(env, kv, platform, fetcher);
      if (!token) { out[platform] = { connected: false, setup: true }; return; }
      out[platform] = { connected: true, ...(await (platform === 'tiktok' ? readTikTok : readInstagram)(token, fetcher)) };
    } catch (e) {
      out[platform] = { connected: false, setup: true, error: short(e) };
    }
  }));
  return out;
}

/**
 * Lays direct numbers over a report.mjs-shaped social section: a connected platform's
 * posts replace Buffer's for that platform, and its follower count is added.
 */
export function overlaySocial(social, direct) {
  const connected = Object.entries(direct || {}).filter(([, d]) => d.connected);
  if (!connected.length) return social;
  const base = social && social.connected ? social : { connected: true, posts: [], week: {} };
  const posts = (base.posts || []).filter((p) => !connected.some(([name]) => name === p.service));
  const accounts = { ...(base.accounts || {}) };
  for (const [name, d] of connected) { posts.push(...d.posts); accounts[name] = d.account; }
  posts.sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
  return { ...base, connected: true, posts, accounts, direct: connected.map(([name]) => name) };
}
