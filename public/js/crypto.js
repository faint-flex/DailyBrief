// Crypto bot dashboard: reads GET /api/crypto?full=1 with the brief key and draws everything here.
const $ = (id) => document.getElementById(id);
const KEY = 'brief-key';
const saved = {
  get(name) { try { return JSON.parse(localStorage.getItem(name)); } catch { return null; } },
  set(name, value) { try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* not kept */ } },
};

function el(tag, props = {}, ...children) {
  const node = document.createElementNS(tag === 'svg' || props.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'svg') continue;
    if (name === 'class') node.setAttribute('class', value);
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (value != null) node.setAttribute(name, value);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}
const s = (tag, props = {}, ...kids) => el(tag, { ...props, svg: true }, ...kids);

const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
const arrow = (v, base = 0) => (v == null ? '' : v >= base ? '▲' : '▼');
const cls = (v, base = 0) => (v == null ? '' : v >= base ? 'up' : 'down');
const when = (at) => {
  if (!at) return 'never';
  const d = new Date(at);
  const mins = Math.round((Date.now() - d) / 60e3);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const stamp = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Each line has its own colour AND its own dash pattern, so the chart reads without colour.
const SERIES = [
  { key: 'b', name: 'Coin breakout', color: 'var(--s1)', dash: '', sw: '' },
  { key: 'm', name: 'Meme hunter', color: 'var(--s2)', dash: '6 4', sw: 'd2' },
  { key: 's', name: 'Meme scalper', color: 'var(--s3)', dash: '1.5 3', sw: 'd3' },
  { key: 'btc', name: 'Just holding Bitcoin', color: 'var(--s4)', dash: '10 3 2 3', sw: 'd4' },
];

let data = null;
let range = 0;
let potFilter = 'All';
let shown = 25;

async function load() {
  const key = saved.get(KEY);
  if (!key) return showGate();
  try {
    const r = await fetch('/api/crypto?full=1', { headers: { Authorization: `Bearer ${key}` } });
    if (r.status === 401) return showGate('That key did not work.');
    const j = await r.json();
    data = j.dashboard;
    if (!data) { $('updated').textContent = 'No data yet: the bot has not run.'; return; }
    $('gate').hidden = true;
    $('app').hidden = false;
    render();
  } catch {
    $('updated').textContent = 'Could not reach the bot. Pull to refresh in a moment.';
  }
}

function showGate(msg = '') {
  $('gate').hidden = false;
  $('app').hidden = true;
  $('gate-status').textContent = msg;
}

$('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saved.set(KEY, $('gate-input').value.trim());
  $('gate-status').textContent = 'Checking…';
  load();
});

function render() {
  $('updated').textContent = `Updated ${when(data.updated)} · refreshes every minute`;
  renderPots();
  renderChart();
  renderOpen();
  renderLearned();
  renderTrades();
  renderHealth();
}

function renderPots() {
  const btc = data.btc_hold_100_is_now;
  const pots = [
    [SERIES[0], data.breakout_100_is_now, `${data.breakout.trades} trades · ${data.breakout.btc_uptrend === false ? 'waiting: BTC under 50-day avg' : 'daily, 31 coins'}`],
    [SERIES[1], data.meme_100_is_now, `${data.meme.trades} trades · ${data.meme.rugs} rugs · every 10 min`],
    [SERIES[2], data.scalp_100_is_now, data.scalp ? `${data.scalp.trades} trades · ${data.scalp.wins} wins · since ${stamp(data.scalp_started)}` : 'not started'],
    [SERIES[3], btc, 'the benchmark to beat'],
  ];
  const best = Math.max(...pots.slice(0, 3).map(([, v]) => v ?? -Infinity));
  $('pots').replaceChildren(...pots.map(([sr, v, sub], i) => el('li', { class: i < 3 && v === best ? 'lead' : '' },
    el('span', { class: 'name' }, el('span', { class: `swatch ${sr.sw}`, style: `color:${sr.color}`, 'aria-hidden': 'true' }), sr.name),
    el('span', { class: `val ${cls(v, 100)}` }, v == null ? '—' : `${arrow(v, 100)} ${money(v)}`),
    el('span', { class: 'sub' }, i < 3 && v != null && btc != null ? `${v >= btc ? 'ahead of' : 'behind'} Bitcoin by ${money(Math.abs(v - btc))} · ${sub}` : sub))));
}

function renderChart() {
  const all = data.history || [];
  const cut = range ? Date.now() - range * 86400e3 : 0;
  const pts = all.filter((p) => p.t >= cut);
  const W = 360, H = 220, L = 34, R = 6, T = 8, B = 20; // phone-sized, so the labels stay readable
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Value of $100 in each pot over time, against holding Bitcoin' });
  if (pts.length < 2) {
    svg.append(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' }, 'The chart fills in as the bot runs (a point every 30 minutes).'));
    $('chart').replaceChildren(svg);
  } else {
    const vals = pts.flatMap((p) => SERIES.map((x) => p[x.key]).filter((v) => v != null));
    let lo = Math.min(100, ...vals), hi = Math.max(100, ...vals);
    const pad = Math.max(1, (hi - lo) * 0.1); lo -= pad; hi += pad;
    const t0 = pts[0].t, t1 = pts.at(-1).t;
    const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    for (let i = 0; i <= 4; i += 1) {
      const v = lo + ((hi - lo) * i) / 4;
      svg.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid' }), s('text', { x: L - 4, y: Y(v) + 3, 'text-anchor': 'end', class: 'axis' }, `$${v.toFixed(0)}`));
    }
    svg.append(s('line', { x1: L, x2: W - R, y1: Y(100), y2: Y(100), class: 'base' }));
    const fmt = (t) => new Date(t).toLocaleString([], (t1 - t0) > 2 * 86400e3 ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' });
    svg.append(s('text', { x: L, y: H - 6, class: 'axis' }, fmt(t0)), s('text', { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'axis' }, fmt(t1)));
    for (const sr of SERIES) {
      const seg = pts.filter((p) => p[sr.key] != null);
      if (seg.length < 2) continue;
      const d = seg.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p[sr.key]).toFixed(1)}`).join('');
      svg.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2.2, 'stroke-dasharray': sr.dash || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    $('chart').replaceChildren(svg);
  }
  $('legend').replaceChildren(...SERIES.map((sr) => el('li', {}, el('span', { class: `swatch ${sr.sw}`, style: `color:${sr.color}`, 'aria-hidden': 'true' }), sr.name)));
}

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  range = Number(b.dataset.range);
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderChart();
}));

function renderOpen() {
  const rows = [
    ...(data.breakout.open || []).map((p) => ['Coin breakout', p]),
    ...(data.meme.open || []).map((p) => ['Meme hunter', p]),
    ...((data.scalp && data.scalp.open) || []).map((p) => ['Meme scalper', p]),
  ];
  $('open').replaceChildren(...(rows.length ? rows.map(([pot, p]) => el('li', {},
    el('span', { class: 'main' }, el('span', { class: 'title' }, p.sym), el('span', { class: 'meta' }, `${pot}${p.chain ? ` · ${p.chain}` : ''}`)),
    el('span', { class: `num ${cls(p.pnl_pct)}` }, `${arrow(p.pnl_pct)} ${pct(p.pnl_pct)}`)))
    : [el('li', { class: 'empty' }, 'Nothing open right now.')]));
}

function renderLearned() {
  const rules = data.rules || {};
  $('rules').replaceChildren(...(Object.keys(rules).length ? Object.entries(rules).map(([k, v]) => el('li', {}, el('span', {}, k), el('span', { class: 'num' }, v)))
    : [el('li', { class: 'empty' }, 'The scalper has not started yet.')]));
  $('changes').replaceChildren(...(data.changes.length ? data.changes.map((c) => el('li', {},
    el('span', { class: 'main' }, el('span', { class: 'title' }, `${c.rule}: ${c.from} → ${c.to}`), el('span', { class: 'meta' }, `${c.why} · ${when(c.at)}`))))
    : [el('li', { class: 'empty' }, 'No changes yet. It needs the same mistake in 3 losses first.')]));
  const watching = (data.watching || []).map((w) => el('li', {}, el('span', { class: 'main' },
    el('span', { class: 'title' }, `${w.sym}: reviewing`), el('span', { class: 'meta' }, `watching the price for 30 minutes after the sale · sold ${when(w.at)}`))));
  const lessons = (data.lessons || []).slice(0, 15).map((l) => el('li', {},
    el('span', { class: 'main' },
      el('span', { class: 'title' }, `${l.sym} · ${l.exit}`),
      el('span', { class: 'meta' }, `${l.lesson.replace(/^[^:]*:\s*/, '')} Best point +${l.best_pct}%, held ${l.held_min} min · ${when(l.at)}`),
      el('span', {}, ...(l.tags || []).map((t) => el('span', { class: 'tag' }, t.replace(/_/g, ' '))))),
    el('span', { class: `num ${cls(l.pnl_pct)}` }, `${arrow(l.pnl_pct)} ${pct(l.pnl_pct)}`)));
  $('lessons').replaceChildren(...([...watching, ...lessons].length ? [...watching, ...lessons] : [el('li', { class: 'empty' }, 'No losing trades reviewed yet.')]));
}

function renderTrades() {
  const pots = ['All', 'Coin breakout', 'Meme hunter', 'Meme scalper'];
  $('trade-filter').replaceChildren(...pots.map((p) => el('button', { type: 'button', 'aria-pressed': String(p === potFilter), onclick: () => { potFilter = p; shown = 25; renderTrades(); } }, p)));
  const list = data.trades.filter((t) => potFilter === 'All' || t.pot === potFilter);
  $('trades').replaceChildren(...(list.length ? list.slice(0, shown).map((t) => {
    const sell = t.act !== 'buy';
    const verb = t.act === 'buy' ? 'Bought' : t.act === 'sell half' ? 'Sold half of' : 'Sold';
    return el('li', {},
      el('span', { class: 'main' }, el('span', { class: 'title' }, `${verb} ${t.sym}`), el('span', { class: 'meta' }, `${t.pot} · ${stamp(t.at)} · ${t.why}`)),
      el('span', { class: `num ${sell ? cls(t.pnl_pct) : ''}` }, sell ? `${arrow(t.pnl_pct)} ${pct(t.pnl_pct)}` : `$${Math.round(t.usd)}`));
  }) : [el('li', { class: 'empty' }, 'No trades yet.')]));
  $('more').hidden = list.length <= shown;
}
$('more').addEventListener('click', () => { shown += 25; renderTrades(); });

function renderHealth() {
  $('health').replaceChildren(...data.health.map((h) => {
    const bad = h.late || h.error;
    const detail = h.error ? `Last try failed: ${h.error}` : h.late ? `No run for a while (expected every ${h.every_min} min)` : `Runs every ${h.every_min} min`;
    return el('li', {},
      el('span', { class: 'main' }, el('span', { class: 'title' }, h.name), el('span', { class: 'meta' }, `${detail} · last ${when(h.last)}${h.day ? ` · traded day ${h.day}` : ''}`)),
      el('span', { class: `pill ${bad ? 'down' : 'up'}` }, bad ? (h.error ? '✕ Error' : '! Late') : '✓ OK'));
  }));
  const src = data.sources || {};
  $('sources').textContent = `Data: coin candles from ${src.coins || '—'}, meme coins from ${src.memes || '—'} and DexScreener. All free, no keys, no real money.`;
}

load();
setInterval(() => { if (document.visibilityState === 'visible' && data) load(); }, 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
