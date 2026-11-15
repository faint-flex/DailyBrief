// BabyLog stats tab. Website and social numbers are fetched live by the worker each
// time this opens (and every minute while it stays open); App Store numbers and the
// trend history come from the nightly 8:39 PM report.
const $ = (id) => document.getElementById(id);
const KEY = 'brief-key';
const CACHE = 'stats-cache';
const saved = {
  get(name) { try { return JSON.parse(localStorage.getItem(name)); } catch { return null; } },
  set(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* fine */ } },
};
const S = { data: null, view: 'overview', range: 30, loading: false, failed: false };

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmt(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString();
}
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const shortDay = (date) => new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sum = (list) => list.reduce((a, b) => a + (b || 0), 0);
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const flag = (code) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0))) : '🌐');
const regionName = (() => {
  try { const names = new Intl.DisplayNames([], { type: 'region' }); return (c) => { try { return names.of(c) || c; } catch { return c; } }; } catch { return (c) => c; }
})();

/** "+12 vs yesterday" style change, colored. */
function delta(now, before, words) {
  if (now == null || before == null) return words ? `<span class="d flat">${esc(words.none || '')}</span>` : '';
  const diff = now - before;
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const pct = before > 0 && diff !== 0 ? ` (${diff > 0 ? '+' : ''}${Math.round((diff / before) * 100)}%)` : '';
  return `<span class="d ${cls}">${diff > 0 ? '▲ +' : diff < 0 ? '▼ ' : '• '}${fmt(diff)}${pct}</span> ${esc(words?.since || '')}`;
}

function spark(values, tone) {
  if (!values || values.length < 2) return '';
  const w = 100, h = 28, max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 7)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} L${w},${h} L0,${h} Z" fill="var(--${tone})" opacity=".13"/>
    <path d="${d}" fill="none" stroke="var(--${tone})" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}

function kpi({ label, value, sub = '', tone, trend, off }) {
  return `<div class="kpi ${tone}"><span class="l">${esc(label)}</span>
    <span class="v${off ? ' off' : ''}">${off ? esc(off) : esc(value)}</span><span class="s">${sub}</span>${off ? '' : spark(trend, tone)}</div>`;
}

/**
 * A tappable chart. series: [{ name, tone, values: [numbers], kind: 'bar' | 'area' | 'line' }]
 * sharing labels. Tapping or dragging shows each value in the readout above.
 */
let chartId = 0;
const charts = new Map();
function chart({ labels, series, title, height = 150 }) {
  const id = `c${(chartId += 1)}`;
  charts.set(id, { labels, series, title });
  const W = 320, H = height, m = { l: 4, r: 4, t: 18, b: 16 };
  const n = labels.length;
  if (!n) return `<div class="card empty">No history yet. It fills in each night.</div>`;
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null)));
  const x = (i) => m.l + (n === 1 ? (W - m.l - m.r) / 2 : (i / (n - 1)) * (W - m.l - m.r));
  const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  const bw = Math.max(2, Math.min(22, ((W - m.l - m.r) / n) * 0.62));
  let g = '';
  for (const f of [0.5, 1]) g += `<line class="grid" x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" stroke-dasharray="2 4"/>`;
  g += `<line class="grid" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
  g += `<text x="${W - 2}" y="${y(max) - 4}" text-anchor="end">${fmt(max)}</text>`;
  for (const s of series) {
    const col = `var(--${s.tone})`;
    if (s.kind === 'bar') {
      s.values.forEach((v, i) => {
        if (v == null) return;
        g += `<rect x="${(n === 1 ? x(i) : Math.min(Math.max(x(i), m.l + bw / 2), W - m.r - bw / 2)) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, y(0) - y(v))}" rx="2" fill="${col}" opacity="${i === n - 1 ? 1 : 0.7}"/>`;
      });
    } else {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) continue;
      const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
      if (s.kind === 'area' && pts.length > 1) g += `<path d="${d} L${pts.at(-1)[0]},${y(0)} L${pts[0][0]},${y(0)} Z" fill="${col}" opacity=".14"/>`;
      g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
      const [lx, ly] = pts.at(-1);
      g += `<circle cx="${lx}" cy="${ly}" r="3" fill="${col}"/>`;
    }
  }
  g += `<text x="${m.l}" y="${H - 3}">${esc(labels[0])}</text>`;
  if (n > 1) g += `<text x="${W - m.r}" y="${H - 3}" text-anchor="end">${esc(labels[n - 1])}</text>`;
  g += `<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1" opacity="0"/>`;
  const legend = series.length > 1
    ? `<div class="legend">${series.map((s) => `<span><i style="background:var(--${s.tone})"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<div class="card chart-card" data-chart="${id}">
    <div class="readout" id="${id}-r">${readout(id, n - 1)}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="${esc(title)}">${g}</svg>${legend}</div>`;
}
function readout(id, i) {
  const c = charts.get(id);
  return `<span>${esc(c.labels[i])}</span><span>${c.series.map((s) => `<b style="color:var(--${s.tone})">${fmt(s.values[i])}</b> <span class="small">${esc(s.name)}</span>`).join(' &nbsp; ')}</span>`;
}
function wireCharts(root) {
  for (const card of root.querySelectorAll('[data-chart]')) {
    const id = card.dataset.chart;
    const svg = card.querySelector('svg');
    const cursor = svg.querySelector('.cursor');
    const n = charts.get(id).labels.length;
    const move = (event) => {
      const box = svg.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const i = n === 1 ? 0 : Math.round(f * (n - 1));
      $(`${id}-r`).innerHTML = readout(id, i);
      const vx = n === 1 ? 160 : 4 + (i / (n - 1)) * 312;
      cursor.setAttribute('x1', vx); cursor.setAttribute('x2', vx); cursor.setAttribute('opacity', '.6');
    };
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'mouse') move(e); });
    svg.addEventListener('pointerleave', () => { $(`${id}-r`).innerHTML = readout(id, n - 1); cursor.setAttribute('opacity', '0'); });
  }
}

function barList(items, tone, nameOf) {
  if (!items?.length) return '<div class="card empty">Nothing yet.</div>';
  const max = Math.max(1, ...items.map((i) => i.views));
  return `<ul class="card bars" style="--tone:var(--${tone})">${items.map((i) => `<li>
    <span class="name">${nameOf(i)}</span><span class="n">${fmt(i.views)}</span>
    <span class="track"><span class="fill" style="display:block;width:${Math.max(2, (i.views / max) * 100)}%"></span></span></li>`).join('')}</ul>`;
}
const sec = (title, hint = '', extra = '') => `<div class="sec"><h3>${esc(title)}</h3>${extra || `<span class="hint">${esc(hint)}</span>`}</div>`;
const notConnected = (part) => (part?.error ? `Couldn't read it: ${part.error}` : part?.need ? `Not connected yet (${part.need})` : 'After tonight\'s report');

/* ---------- what the numbers say ---------- */
function derive(data) {
  const { live, nightly, history = {} } = data;
  const H = { site: history.site || {}, store: history.store || {}, social: history.social || {} };
  const web = live?.website?.connected ? live.website : nightly?.website?.connected ? nightly.website : (live?.website || nightly?.website || null);
  const webLive = !!live?.website?.connected;
  // Website days: nightly history, corrected by the live 30 days.
  const siteMap = { ...H.site };
  if (web?.connected) for (const d of web.days || []) siteMap[d.date] = { visitors: d.visitors, pageViews: d.pageViews };
  const site = Object.keys(siteMap).sort().map((date) => ({ date, ...siteMap[date] }));
  const siteNow = site.at(-1);
  const sitePrev = siteNow && site.find((d) => d.date === addDays(siteNow.date, -1));

  const soc = live?.social?.connected ? live.social : nightly?.social?.connected ? nightly.social : (live?.social || nightly?.social || null);
  const socLive = !!live?.social?.connected;
  const totalsOf = (t) => {
    const out = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, posts: 0 };
    for (const m of Object.values(t || {})) {
      out.views += m.views || 0; out.likes += (m.reactions ?? m.likes) || 0; out.comments += m.comments || 0;
      out.shares += m.shares || 0; out.saves += m.saves || 0; out.reach += m.reach || 0; out.posts += m.posts || 0;
    }
    return out;
  };
  const nights = Object.keys(H.social).sort();
  // Compare with the last nightly snapshot before what we're showing.
  // Live: change since the last nightly snapshot. Nightly only: change since the night before.
  const socialBaseDay = socLive ? nights.at(-1) : [...nights].reverse().find((d) => d < (nightly?.day || ''));
  const socNow = soc?.connected ? totalsOf(soc.totals) : null;
  const socBase = socialBaseDay ? totalsOf(H.social[socialBaseDay]) : null;
  const socialSeries = nights.map((d) => ({ label: shortDay(d), ...totalsOf(H.social[d]) }));
  if (socLive) socialSeries.push({ label: 'Now', ...socNow });

  const storeDays = Object.keys(H.store).sort().map((date) => ({ date, ...H.store[date] }));
  const storeNow = storeDays.at(-1);
  const storePrev = storeNow && storeDays.find((d) => d.date === addDays(storeNow.date, -1));
  const store7 = storeNow ? sum(storeDays.filter((d) => d.date > addDays(storeNow.date, -7)).map((d) => d.downloads)) : null;
  return { live, nightly, web, webLive, site, siteNow, sitePrev, soc, socLive, socNow, socBase, socialBaseDay, socialSeries, storeDays, storeNow, storePrev, store7, totalsOf };
}

/* ---------- views ---------- */
function overview(x) {
  const n = x.nightly;
  const fresh = n && n.day >= addDays(localDay(), -1);
  const siteTrend = x.site.slice(-14);
  const since = x.socLive ? 'since last night' : 'vs night before';
  const follows = x.soc?.week ? sum(Object.values(x.soc.week).map((w) => w.follows || 0)) : null;
  const reviews = n?.appStore?.reviews || [];
  const avg = reviews.length ? sum(reviews.map((r) => r.rating)) / reviews.length : null;
  const hours = x.webLive ? x.web.hours || [] : [];
  return `${fresh && n.headline ? `<p class="headline">${esc(n.headline)}</p>` : ''}
  ${sec('Website', x.webLive ? 'live' : x.siteNow ? `as of ${shortDay(x.siteNow.date)}` : '')}
  <div class="kpis">
    ${kpi({ label: 'Visitors today', tone: 'web', value: fmt(x.siteNow?.visitors), off: x.siteNow ? '' : notConnected(x.web),
      sub: delta(x.siteNow?.visitors, x.sitePrev?.visitors, { since: 'vs yesterday', none: 'first day' }), trend: siteTrend.map((d) => d.visitors) })}
    ${kpi({ label: 'Page views today', tone: 'web', value: fmt(x.siteNow?.pageViews), off: x.siteNow ? '' : notConnected(x.web),
      sub: delta(x.siteNow?.pageViews, x.sitePrev?.pageViews, { since: 'vs yesterday', none: 'first day' }), trend: siteTrend.map((d) => d.pageViews) })}
  </div>
  ${sec('Instagram + TikTok', x.socLive ? 'live' : n?.social?.connected ? `as of ${shortDay(n.day)}` : '')}
  <div class="kpis">
    ${kpi({ label: 'Views', tone: 'social', value: fmt(x.socNow?.views), off: x.socNow ? '' : notConnected(x.soc),
      sub: delta(x.socNow?.views, x.socBase?.views, { since, none: `${fmt(x.socNow?.posts)} posts` }), trend: x.socialSeries.map((s) => s.views) })}
    ${kpi({ label: 'Likes', tone: 'social', value: fmt(x.socNow?.likes), off: x.socNow ? '' : notConnected(x.soc),
      sub: delta(x.socNow?.likes, x.socBase?.likes, { since, none: 'all posts' }), trend: x.socialSeries.map((s) => s.likes) })}
    ${kpi({ label: 'Comments + shares', tone: 'social2', value: fmt((x.socNow?.comments || 0) + (x.socNow?.shares || 0)), off: x.socNow ? '' : notConnected(x.soc),
      sub: delta(x.socNow ? x.socNow.comments + x.socNow.shares : null, x.socBase ? x.socBase.comments + x.socBase.shares : null, { since, none: 'all posts' }),
      trend: x.socialSeries.map((s) => s.comments + s.shares) })}
    ${kpi({ label: 'New follows', tone: 'social2', value: fmt(follows), off: x.soc?.connected ? '' : notConnected(x.soc), sub: 'last 7 days' })}
  </div>
  ${sec('App Store', 'Apple posts each day the next morning')}
  <div class="kpis">
    ${kpi({ label: x.storeNow ? `Downloads ${shortDay(x.storeNow.date)}` : 'Downloads', tone: 'store', value: fmt(x.storeNow?.downloads),
      off: x.storeNow ? '' : notConnected(n?.appStore), sub: x.storeNow ? `${delta(x.storeNow.downloads, x.storePrev?.downloads, { since: 'vs day before', none: '' })} ${x.storePrev ? '' : `<span class="d flat">${fmt(x.store7)} in 7 days</span>`}` : '',
      trend: x.storeDays.slice(-14).map((d) => d.downloads) })}
    ${kpi({ label: 'Ratings', tone: 'store', value: avg == null ? '' : `${avg.toFixed(1)}★`, off: avg != null ? '' : n?.appStore?.connected ? 'None yet' : notConnected(n?.appStore),
      sub: reviews.length ? `${reviews.length} recent review${reviews.length > 1 ? 's' : ''}` : 'no reviews yet' })}
  </div>
  ${hours.length ? `${sec('Website, last 24 hours', 'page loads by hour')}${chart({
    title: 'Page loads by hour', labels: hours.map((h) => new Date(h.hour).toLocaleTimeString([], { hour: 'numeric' })),
    series: [{ name: 'page loads', tone: 'web', kind: 'bar', values: hours.map((h) => h.views) }], height: 120 })}` : ''}
  ${fresh && n.suggestion ? `<p class="tip"><span class="tag">Next</span><span>${esc(n.suggestion)}</span></p>` : ''}`;
}

function websiteView(x) {
  if (!x.site.length) return `<div class="card empty">${esc(notConnected(x.web))}</div>`;
  const days = x.site.slice(-S.range);
  const seg = `<div class="seg">${[7, 30, 90].map((r) => `<button data-range="${r}" class="${S.range === r ? 'active' : ''}">${r}d</button>`).join('')}</div>`;
  const totalV = sum(days.map((d) => d.visitors));
  return `${sec(`Visitors, ${days.length} day${days.length > 1 ? 's' : ''}`, '', seg)}
  ${chart({ title: 'Visitors and page views by day', labels: days.map((d) => shortDay(d.date)),
    series: [{ name: 'page views', tone: 'accent2', kind: 'line', values: days.map((d) => d.pageViews) },
      { name: 'visitors', tone: 'web', kind: 'area', values: days.map((d) => d.visitors) }] })}
  <p class="note">${fmt(totalV)} visitors and ${fmt(sum(days.map((d) => d.pageViews)))} page views in this range. Days are counted the way Cloudflare does (UTC, so "today" starts at 4 PM Pacific) and include some bots.</p>
  ${sec('Top pages', 'last 24 hours')}
  ${barList(x.web?.pages, 'web', (p) => esc(p.path === '/' ? 'Home (landing page)' : p.path))}
  ${sec('Where visitors are', 'last 24 hours')}
  ${barList(x.web?.countries, 'web', (c) => `${flag(c.code)} ${esc(regionName(c.code))}`)}`;
}

function socialView(x) {
  if (!x.soc?.connected) return `<div class="card empty">${esc(notConnected(x.soc))}</div>`;
  const net = (service, label) => {
    const t = x.totalsOf({ [service]: x.soc.totals?.[service] });
    const b = x.socialBaseDay ? x.totalsOf({ [service]: (S.data.history.social[x.socialBaseDay] || {})[service] }) : null;
    const w = x.soc.week?.[service] || {};
    const cell = (name, v, bv) => `<div><span>${name}</span><strong>${fmt(v)}</strong>${b ? `<span class="small">${delta(v, bv)}</span>` : ''}</div>`;
    return `<div class="card net"><div class="net-head"><b><span class="badge ${service}">${label}</span></b><span class="muted small">${fmt(t.posts)} post${t.posts === 1 ? '' : 's'}</span></div>
      <div class="net-grid">${cell('Views', t.views, b?.views)}${cell('Likes', t.likes, b?.likes)}${cell('Comments', t.comments, b?.comments)}
      ${cell('Shares', t.shares, b?.shares)}${service === 'instagram' ? cell('Saves', t.saves, b?.saves) : cell('Reach', t.reach, b?.reach)}
      <div><span>Follows 7d</span><strong>${w.follows == null ? '–' : fmt(w.follows)}</strong></div></div></div>`;
  };
  const posts = x.soc.posts || [];
  const s = x.socialSeries;
  return `${sec('By network', x.socLive ? `live · changes ${x.socialBaseDay ? 'since last night' : ''}` : `as of ${shortDay(x.nightly.day)}`)}
  <div class="nets">${net('instagram', 'Instagram')}${net('tiktok', 'TikTok')}</div>
  ${sec('Views over time', 'all posts, each night')}
  ${s.length > 1 ? chart({ title: 'Total views each night', labels: s.map((p) => p.label),
    series: [{ name: 'views', tone: 'social', kind: 'area', values: s.map((p) => p.views) }, { name: 'likes', tone: 'social2', kind: 'line', values: s.map((p) => p.likes) }] })
    : '<div class="card empty">The chart starts after the second nightly report.</div>'}
  ${sec('Posts', `${posts.length} sent${x.soc.scheduled ? ` · ${x.soc.scheduled} scheduled` : ''}`)}
  ${posts.length ? `<ul class="card posts">${posts.map((p) => `<li><div class="top"><span class="badge ${esc(p.service)}">${esc(p.service === 'instagram' ? 'IG' : p.service === 'tiktok' ? 'TT' : p.service)}</span>
    <span class="txt">${esc(p.text)}</span>${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>
    <div class="m">${p.sentAt ? `${shortDay(localDay(new Date(p.sentAt)))} · ` : ''}${Object.keys(p.metrics || {}).length
      ? `${fmt(p.metrics.views ?? 0)} views · ${fmt((p.metrics.reactions ?? p.metrics.likes) ?? 0)} likes · ${fmt(p.metrics.comments ?? 0)} comments`
      : 'no numbers from Buffer yet'}</div></li>`).join('')}</ul>` : '<div class="card empty">No posts sent yet.</div>'}
  <p class="note">Numbers come from Buffer. TikTok posts finished by hand in the TikTok app may not show numbers here.</p>`;
}

function storeView(x) {
  const n = x.nightly;
  if (!x.storeDays.length) return `<div class="card empty">${esc(n ? notConnected(n.appStore) : 'The first App Store numbers arrive with tonight\'s 8:39 PM report.')}</div>`;
  const all = sum(x.storeDays.map((d) => d.downloads));
  const latest = n?.appStore?.sales?.[0];
  const countries = latest ? Object.entries(latest.countries || {}).map(([code, views]) => ({ code, views })).sort((a, b) => b.views - a.views) : [];
  const reviews = n?.appStore?.reviews || [];
  const days = x.storeDays.slice(-S.range);
  return `<div class="kpis">
    ${kpi({ label: `Downloads ${shortDay(x.storeNow.date)}`, tone: 'store', value: fmt(x.storeNow.downloads), sub: delta(x.storeNow.downloads, x.storePrev?.downloads, { since: 'vs day before', none: 'first day' }) })}
    ${kpi({ label: 'Last 7 days', tone: 'store', value: fmt(x.store7), sub: 'first-time downloads' })}
    ${kpi({ label: 'All time', tone: 'store', value: fmt(all), sub: `since ${shortDay(x.storeDays[0].date)}` })}
    ${kpi({ label: 'Re-downloads', tone: 'store', value: fmt(x.storeNow.redownloads), sub: `${fmt(x.storeNow.updates)} updates` })}
  </div>
  ${sec('Downloads by day')}
  ${chart({ title: 'App Store downloads by day', labels: days.map((d) => shortDay(d.date)),
    series: [{ name: 'downloads', tone: 'store', kind: 'bar', values: days.map((d) => d.downloads) }] })}
  ${countries.length ? `${sec('Countries', latest ? shortDay(latest.date) : '')}${barList(countries, 'store', (c) => `${flag(c.code)} ${esc(regionName(c.code))}`)}` : ''}
  ${sec('Latest reviews')}
  ${reviews.length ? `<ul class="card posts">${reviews.map((r) => `<li><div class="top"><span class="txt">${esc(r.title || '(no title)')}</span>
    <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(Math.max(0, 5 - r.rating))}</span></div>
    <div class="m">${r.date ? shortDay(localDay(new Date(r.date))) : ''} ${esc(r.territory || '')}</div></li>`).join('')}</ul>` : '<div class="card empty">No ratings or reviews yet.</div>'}
  <p class="note">Apple publishes each day's downloads the next morning, so these update with the nightly report.</p>`;
}

/* ---------- render ---------- */
function setStatus() {
  const b = $('refresh');
  const d = S.data;
  const live = d?.live && (d.live.website?.connected || d.live.social?.connected);
  let cls = 'nightly', label = 'Nightly';
  if (S.loading) { cls = 'busy'; label = 'Updating'; }
  else if (S.failed) { cls = 'off'; label = 'Offline'; }
  else if (live) { cls = 'live'; label = `Live · ${timeOf(d.live.at)}`; }
  else if (d?.nightly) label = `Nightly · ${shortDay(d.nightly.day)}`;
  else label = 'Waiting';
  b.className = `status ${cls}`;
  $('status-text').textContent = label;
}

function render() {
  setStatus();
  const d = S.data;
  if (!d) return;
  charts.clear();
  const x = derive(d);
  const keys = d.liveKeys || {};
  const missing = [!keys.website && 'STATS_CF_TOKEN', !keys.social && 'STATS_BUFFER_KEY'].filter(Boolean);
  $('banner').hidden = !missing.length;
  $('banner').innerHTML = missing.length
    ? `Showing the nightly numbers. Live mode turns on when the brief app has ${missing.map((m) => `<code>${m}</code>`).join(' and ')}.` : '';
  const views = { overview, website: websiteView, social: socialView, store: storeView };
  for (const [name, fn] of Object.entries(views)) {
    const el = $(`view-${name}`);
    if (name !== S.view) { el.innerHTML = ''; continue; }
    if (!d.nightly && !d.live) {
      el.innerHTML = '<div class="card empty">No numbers yet. The first report arrives tonight at 8:39 PM.</div>';
      continue;
    }
    el.innerHTML = fn(x);
    wireCharts(el);
  }
  const parts = [];
  if (d.live?.at) parts.push(`Live numbers ${timeOf(d.live.at)}`);
  if (d.nightly) parts.push(`nightly report ${shortDay(d.nightly.day)}, ${timeOf(d.nightly.receivedAt)}`);
  $('foot').textContent = parts.length ? `${parts.join(' · ')}. Tap the status to refresh.` : '';
}

/* ---------- data ---------- */
async function load({ fresh = false } = {}) {
  const key = saved.get(KEY);
  if (!key) { $('gate').hidden = false; setStatus(); return; }
  S.loading = true; setStatus();
  try {
    const res = await fetch(`/api/stats${fresh ? '?fresh=1' : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) { $('gate').hidden = false; $('gate-status').textContent = 'That key did not work.'; return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    S.data = await res.json();
    S.failed = false;
    $('gate').hidden = true;
    saved.set(CACHE, S.data);
  } catch {
    S.failed = true;
  } finally {
    S.loading = false;
    render();
  }
}

$('gate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saved.set(KEY, $('gate-input').value.trim());
  $('gate-status').textContent = 'Checking…';
  load();
});
$('refresh').addEventListener('click', () => load({ fresh: true }));
document.querySelector('.tabs').addEventListener('click', (event) => {
  const b = event.target.closest('button[data-view]');
  if (!b) return;
  S.view = b.dataset.view;
  for (const t of document.querySelectorAll('.tabs button')) {
    const on = t === b;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  }
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${S.view}`);
  render();
  window.scrollTo({ top: 0 });
});
document.addEventListener('click', (event) => {
  const r = event.target.closest('button[data-range]');
  if (!r) return;
  S.range = Number(r.dataset.range);
  render();
});

S.data = saved.get(CACHE);
render();
load();
// A live feed: refresh every minute while open, and right away when the app comes back.
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
