// BabyLog stats: the numbers behind the Stats tab.
//
// Two feeds:
//   nightly  The BabyLog Daily Report run (8:39 PM PT) POSTs the raw JSON that
//            faint-flex/BabyLog scripts/report.mjs prints. It is distilled here into
//            a dated history (kept ~13 months) so the app can draw trends.
//   live     When the app opens, the worker reads the website (Cloudflare analytics)
//            and Instagram/TikTok (Buffer) itself, if it has its own read-only keys:
//            STATS_CF_TOKEN and STATS_BUFFER_KEY. App Store numbers are only ever
//            nightly, because Apple publishes them once a day.

import { readDirect, overlaySocial, PLATFORMS } from './social-direct.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const KEEP_DAYS = 400;
export const SITE = 'usebabylog.com';
export const SERVICES = ['instagram', 'tiktok'];
// Buffer metrics that are rates or averages, not counts, so they are never summed.
const NOT_COUNTS = new Set(['engagementRate', 'averageTimeWatched', 'postCount']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const short = (e) => text(e?.message || e, 200);
const webAddress = (v) => (/^https:\/\//i.test(String(v || '')) ? String(v).slice(0, 500) : '');

/* ---------- distill: raw report.mjs-shaped JSON -> what the app draws ---------- */

function distillWebsite(w) {
  if (!w || typeof w !== 'object') return { connected: false, need: 'no website numbers' };
  if (w.error) return { connected: false, error: text(w.error) };
  if (!w.connected) return { connected: false, need: text(w.need) };
  const pages = Array.isArray(w.last24h?.pages) ? w.last24h.pages : [];
  const countries = Array.isArray(w.last24h?.countries) ? w.last24h.countries : [];
  return {
    connected: true,
    days: (Array.isArray(w.days) ? w.days : []).filter((d) => DATE_RE.test(d?.date))
      .map((d) => ({ date: d.date, visitors: num(d.visitors), pageViews: num(d.pageViews) })),
    hours: (Array.isArray(w.hours) ? w.hours : []).map((h) => ({ hour: text(h.hour, 30), views: num(h.views) })),
    pages: pages.map((p) => ({ path: text(p.clientRequestPath ?? p.path, 80), views: num(p.views) }))
      .filter((p) => p.path && !p.path.startsWith('/cdn-cgi/')).slice(0, 8),
    countries: countries.map((c) => ({ code: text(c.clientCountryName ?? c.code, 8), views: num(c.views) })).slice(0, 8),
  };
}

function countsOf(metrics) {
  const out = {};
  for (const [k, v] of Object.entries(metrics || {})) {
    if (!NOT_COUNTS.has(k) && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  return out;
}

function distillSocial(s) {
  if (!s || typeof s !== 'object') return { connected: false, need: 'no social numbers' };
  if (s.error) return { connected: false, error: text(s.error) };
  if (!s.connected) return { connected: false, need: text(s.need) };
  const sent = (Array.isArray(s.posts) ? s.posts : []).filter((p) => p?.status === 'sent');
  const totals = {};
  for (const service of SERVICES) totals[service] = { posts: 0 };
  for (const p of sent) {
    const t = (totals[p.service] ||= { posts: 0 });
    t.posts += 1;
    for (const [k, v] of Object.entries(countsOf(p.metrics))) t[k] = (t[k] || 0) + v;
  }
  for (const [service, a] of Object.entries(s.accounts || {})) {
    if (Number.isFinite(Number(a?.followers))) (totals[service] ||= { posts: 0 }).followers = Number(a.followers);
  }
  const week = {};
  for (const [service, m] of Object.entries(s.week || {})) week[service] = countsOf(m);
  return {
    connected: true,
    totals,
    week,
    posts: sent.slice(0, 12).map((p) => ({
      service: text(p.service, 20), sentAt: text(p.sentAt, 40), text: text(p.text, 80),
      link: webAddress(p.link), metrics: countsOf(p.metrics),
    })),
    scheduled: (Array.isArray(s.posts) ? s.posts : []).filter((p) => p?.status === 'scheduled').length,
    direct: (Array.isArray(s.direct) ? s.direct : []).filter((d) => SERVICES.includes(d)),
  };
}

function distillAppStore(a) {
  if (!a || typeof a !== 'object') return { connected: false, need: 'no App Store numbers' };
  if (a.error) return { connected: false, error: text(a.error) };
  if (!a.connected) return { connected: false, need: text(a.need) };
  const sales = (Array.isArray(a.sales) ? a.sales : []).filter((d) => DATE_RE.test(d?.date) && d.downloads !== undefined)
    .map((d) => ({ date: d.date, downloads: num(d.downloads), redownloads: num(d.redownloads), updates: num(d.updates),
      countries: Object.fromEntries(Object.entries(d.countries || {}).slice(0, 12).map(([k, v]) => [text(k, 4), num(v)])) }));
  return {
    connected: true,
    app: text(a.app, 60),
    sales,
    salesNeed: text(a.salesNeed),
    reviews: (Array.isArray(a.latestReviews) ? a.latestReviews : []).slice(0, 5)
      .map((r) => ({ rating: num(r.rating), title: text(r.title, 80), date: text(r.createdDate, 40), territory: text(r.territory, 4) })),
  };
}

/** Raw nightly report -> { snapshot } or { error }. direct = readDirect() numbers to lay over Buffer's. */
export function distillNightly(input, now = new Date(), direct = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the report as a JSON object.' };
  const day = DATE_RE.test(input.day) ? input.day : DATE_RE.test(input.date) ? input.date : null;
  if (!day) return { error: 'The report needs its "day" (YYYY-MM-DD).' };
  if (!input.website && !input.social && !input.appStore) return { error: 'That report has no website, social or appStore numbers.' };
  return {
    snapshot: {
      day,
      generatedAt: text(input.generatedAt, 40),
      receivedAt: now.toISOString(),
      headline: text(input.headline, 200),
      suggestion: text(input.suggestion, 300),
      website: distillWebsite(input.website),
      social: distillSocial(direct ? overlaySocial(input.social, direct) : input.social),
      appStore: distillAppStore(input.appStore),
    },
  };
}

function trim(map) {
  const keys = Object.keys(map).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete map[k];
  return map;
}

/** Folds a distilled snapshot into the dated history. Later runs correct earlier partial days. */
export function mergeHistory(history, snap) {
  const h = { site: { ...(history?.site || {}) }, store: { ...(history?.store || {}) }, social: { ...(history?.social || {}) } };
  if (snap.website.connected) for (const d of snap.website.days) h.site[d.date] = { visitors: d.visitors, pageViews: d.pageViews };
  if (snap.appStore.connected) {
    for (const d of snap.appStore.sales) h.store[d.date] = { downloads: d.downloads, redownloads: d.redownloads, updates: d.updates };
  }
  if (snap.social.connected) h.social[snap.day] = snap.social.totals;
  trim(h.site); trim(h.store); trim(h.social);
  return h;
}

export function statsStore(kv, app = 'babylog') {
  const read = async (key, fallback) => {
    const raw = await kv.get(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  };
  return {
    latest: () => read(`stats:${app}:latest`, null),
    history: () => read(`stats:${app}:history`, { site: {}, store: {}, social: {} }),
    async put(snap) {
      const history = mergeHistory(await this.history(), snap);
      // Only the newest night replaces "latest"; a backfill of an older day just adds history.
      const latest = await this.latest();
      if (!latest || latest.day <= snap.day) await kv.put(`stats:${app}:latest`, JSON.stringify(snap));
      await kv.put(`stats:${app}:history`, JSON.stringify(history));
      return history;
    },
  };
}

/* ---------- live: the worker's own read-only look at the website and Buffer ---------- */

async function cloudflare(env, fetcher, path, init = {}) {
  const res = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
    ...init, headers: { Authorization: `Bearer ${env.STATS_CF_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 200)}`);
  return body;
}

export async function liveWebsite(env, fetcher = fetch, now = new Date()) {
  if (!env.STATS_CF_TOKEN) return { connected: false, need: 'STATS_CF_TOKEN' };
  const ql = async (query, variables) => (await cloudflare(env, fetcher, '/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) })).data;
  const zone = env.STATS_CF_ZONE || (await cloudflare(env, fetcher, `/zones?name=${SITE}`)).result?.[0]?.id;
  if (!zone) return { connected: false, need: 'STATS_CF_TOKEN needs Zone Read on usebabylog.com' };
  const today = now.toISOString().slice(0, 10);
  const out = { connected: true };
  let days = null;
  for (const span of [30, 7]) {
    try {
      const from = new Date(now.getTime() - (span - 1) * 864e5).toISOString().slice(0, 10);
      const d = await ql(`query($z:String!,$f:Date!,$t:Date!){viewer{zones(filter:{zoneTag:$z}){
        httpRequests1dGroups(limit:${span},orderBy:[date_ASC],filter:{date_geq:$f,date_leq:$t}){
          dimensions{date} sum{pageViews} uniq{uniques}}}}}`, { z: zone, f: from, t: today });
      days = d.viewer.zones[0].httpRequests1dGroups.map((g) => ({ date: g.dimensions.date, visitors: g.uniq.uniques, pageViews: g.sum.pageViews }));
      break;
    } catch (e) { out.daysError = short(e); }
  }
  if (!days) throw new Error(out.daysError);
  out.days = days;
  delete out.daysError;
  // Last 24 hours, real browsers loading pages only: by page, by country, by hour.
  const since = new Date(now.getTime() - 24 * 36e5).toISOString();
  const until = now.toISOString();
  const group = async (dims, order = 'count_DESC', limit = 8) => (await ql(`query($z:String!,$s:Time!,$u:Time!){viewer{zones(filter:{zoneTag:$z}){
    httpRequestsAdaptiveGroups(limit:${limit},orderBy:[${order}],filter:{datetime_geq:$s,datetime_lt:$u,
      requestSource:"eyeball",edgeResponseContentTypeName:"html"}){count dimensions{${dims}}}}}}`, { z: zone, s: since, u: until }))
    .viewer.zones[0].httpRequestsAdaptiveGroups;
  out.last24h = {};
  const [pages, countries, hours] = await Promise.allSettled([
    group('clientRequestPath'), group('clientCountryName'), group('datetimeHour', 'datetimeHour_ASC', 30),
  ]);
  if (pages.status === 'fulfilled') out.last24h.pages = pages.value.map((g) => ({ path: g.dimensions.clientRequestPath, views: g.count }));
  if (countries.status === 'fulfilled') out.last24h.countries = countries.value.map((g) => ({ code: g.dimensions.clientCountryName, views: g.count }));
  if (hours.status === 'fulfilled') out.hours = hours.value.map((g) => ({ hour: g.dimensions.datetimeHour, views: g.count }));
  return out;
}

async function buffer(env, fetcher, query, variables = {}) {
  const res = await fetcher('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.STATS_BUFFER_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) throw new Error(`Buffer ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 200)}`);
  return body.data;
}

export async function liveSocial(env, fetcher = fetch, now = new Date()) {
  if (!env.STATS_BUFFER_KEY) return { connected: false, need: 'STATS_BUFFER_KEY' };
  const { account } = await buffer(env, fetcher, 'query { account { organizations { id } } }');
  const org = account.organizations[0].id;
  const [{ channels }, posts] = await Promise.all([
    buffer(env, fetcher, 'query($id: OrganizationId!) { channels(input:{organizationId:$id}) { id service name } }', { id: org }),
    buffer(env, fetcher, `query($o:OrganizationId!){posts(first:50,input:{organizationId:$o,sort:[{field:dueAt,direction:desc}]}){
      edges{node{status dueAt sentAt text channelService externalLink metrics{type value}}}}}`, { o: org }),
  ]);
  const out = {
    connected: true,
    posts: posts.posts.edges.map(({ node: p }) => ({
      service: p.channelService, status: p.status, sentAt: p.sentAt, text: (p.text || '').split('\n')[0],
      link: p.externalLink, metrics: Object.fromEntries((p.metrics || []).map((m) => [m.type, m.value])),
    })),
    week: {},
  };
  await Promise.all(channels.map(async (c) => {
    try {
      const d = await buffer(env, fetcher, 'query($i:AggregatedPostMetricsInput!){aggregatedPostMetrics(input:$i){metrics{type value}}}', { i: {
        organizationId: org, channelIds: [c.id],
        startDateTime: new Date(now.getTime() - 7 * 864e5).toISOString(), endDateTime: now.toISOString() } });
      out.week[c.service] = Object.fromEntries((d.aggregatedPostMetrics?.metrics || []).map((m) => [m.type, m.value]));
    } catch { /* the week totals are a bonus */ }
  }));
  return out;
}

async function section(fn) {
  try { return await fn(); } catch (e) { return { connected: false, error: short(e) }; }
}

const anyDirect = (env) => Object.values(PLATFORMS).some((p) => p.ready(env));

/** Fresh website + social numbers, distilled like a nightly snapshot. */
export async function readLive(env, fetcher = fetch, now = new Date(), kv = env.BRIEFS) {
  const [website, social, direct] = await Promise.all([
    section(() => liveWebsite(env, fetcher, now)),
    env.STATS_BUFFER_KEY || !anyDirect(env) ? section(() => liveSocial(env, fetcher, now)) : { connected: false, need: 'STATS_BUFFER_KEY' },
    kv && anyDirect(env) ? readDirect(env, kv, fetcher).catch(() => ({})) : {},
  ]);
  const connect = Object.fromEntries(Object.entries(direct).map(([k, d]) => [k, { setup: d.setup !== false, connected: !!d.connected, error: d.error || '' }]));
  return { at: now.toISOString(), website: distillWebsite(website), social: distillSocial(overlaySocial(social, direct)), connect };
}

// One isolate answers many opens; don't hit the APIs more than once a minute.
let cached = null;
export async function liveCached(env, { fresh = false, fetcher = fetch, now = new Date() } = {}) {
  if (!env.STATS_CF_TOKEN && !env.STATS_BUFFER_KEY && !anyDirect(env)) return null;
  if (!fresh && cached && now - cached.time < 60e3) return cached.value;
  const value = await readLive(env, fetcher, now);
  cached = { time: now, value };
  return value;
}
export const clearLiveCache = () => { cached = null; };
