import { forecast, findPlace, hereNow } from './weather.js';

const $ = (id) => document.getElementById(id);
const KEY = 'brief-key';
const CACHE = 'brief-cache';
const PLACE = 'brief-place';

// Storage can be missing (private mode) or throw; the app still works without it.
const saved = {
  get(name) {
    try {
      return JSON.parse(localStorage.getItem(name));
    } catch {
      return null;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch { /* not kept, that's all */ }
  },
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hourOf = (local) => {
  const hour = Number(local.slice(11, 13));
  return `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;
};
const dayName = (date) => new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

function header() {
  const hour = new Date().getHours();
  $('greeting').textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('today').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ---------- Key ---------- */

function takeKeyFromLink() {
  const match = location.hash.match(/key=([^&]+)/);
  if (!match) return;
  saved.set(KEY, decodeURIComponent(match[1]));
  history.replaceState(null, '', location.pathname);
}

async function api(path, init = {}) {
  const key = saved.get(KEY);
  if (!key) throw Object.assign(new Error('locked'), { status: 401 });
  const response = await fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${key}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: response.status });
  return data;
}

function showGate(message = '') {
  $('key-gate').hidden = false;
  $('key-status').textContent = message;
}

$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  saved.set(KEY, $('key-input').value.trim());
  $('key-status').textContent = 'Checking…';
  await loadBrief();
});

/* ---------- Brief ---------- */

function renderEmail(email) {
  const needs = $('needs-you');
  needs.replaceChildren();
  if (email.needsYou.length) {
    for (const line of email.needsYou) {
      needs.append(el('li', {},
        line.from ? el('strong', {}, line.from) : null,
        line.subject ? el('span', { class: 'subject' }, line.subject) : null,
        line.why ? el('span', { class: 'why' }, line.why) : null));
    }
  } else {
    needs.append(el('li', { class: 'muted' }, email.note || 'Nothing needs you today.'));
  }
  if (email.needsYou.length && email.note) needs.append(el('li', { class: 'muted' }, email.note));

  const cleanup = $('cleanup');
  cleanup.replaceChildren(...email.cleanup.map((line) => el('li', {},
    el('span', {}, line.sender),
    line.count != null ? el('span', { class: 'count' }, String(line.count)) : null)));
  $('cleanup-box').hidden = !email.cleanup.length;
  $('email').hidden = false;
}

/** Dinner lives in Grocerylist; the brief just names tonight's top picks. */
function renderDinnerLink(brief) {
  const names = (brief?.dinners || []).slice(0, 3).map((dinner) => dinner.name);
  $('dinner-picks').textContent = names.length
    ? `Top picks: ${names.join(', ')}.`
    : 'Ideas, recipes and your shopping list are all in Grocerylist.';
}

/** A picture from the venue's own page; it quietly disappears if the site won't serve it. */
function photo(src, alt) {
  if (!src) return null;
  const img = el('img', { src, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.remove());
  return img;
}

/** Open Google Maps around where you are now, falling back to your weather place. */
async function openNearby(query) {
  $('near-status').textContent = 'Finding where you are…';
  let place;
  try {
    place = await hereNow();
  } catch {
    place = saved.get(PLACE);
  }
  $('near-status').textContent = '';
  const where = place ? `/@${place.latitude},${place.longitude},14z` : '';
  const url = `https://www.google.com/maps/search/${encodeURIComponent(place ? query : `${query} near me`)}${where}`;
  window.open(url, '_blank', 'noopener') || (location.href = url);
}

for (const button of document.querySelectorAll('[data-near]')) {
  button.addEventListener('click', () => openNearby(button.dataset.near));
}

/** Ideas sent with the brief, if any; the buttons above always work. */
function renderDateNight(night) {
  for (const id of ['date-pairing', 'date-things-heading']) $(id).hidden = true;
  $('date-places').replaceChildren();
  $('date-things').replaceChildren();
  if (!night) return;
  $('date-pairing').textContent = night.pairing;
  $('date-pairing').hidden = !night.pairing;

  $('date-places').replaceChildren(...night.restaurants.map((place) => {
    const facts = [place.cuisine, place.price, place.area].filter(Boolean).join(' · ');
    const body = el('div', { class: 'place-text' },
      el('div', { class: 'place-head' },
        el('strong', {}, place.name),
        place.rating ? el('span', { class: 'pill rating' }, `★ ${place.rating}`) : null),
      facts ? el('span', { class: 'muted small' }, facts) : null,
      place.why ? el('span', { class: 'why' }, place.why) : null);
    const inner = [photo(place.image, place.name), body];
    return el('li', {}, place.url
      ? el('a', { class: 'place', href: place.url, target: '_blank', rel: 'noopener' }, inner)
      : el('div', { class: 'place' }, inner));
  }));

  $('date-things').replaceChildren(...night.activities.map((thing) => el('li', {},
    thing.url ? el('a', { href: thing.url, target: '_blank', rel: 'noopener' }, el('strong', {}, thing.name)) : el('strong', {}, thing.name),
    thing.when ? el('span', { class: 'subject' }, thing.when) : null,
    thing.why ? el('span', { class: 'why' }, thing.why) : null)));
  $('date-things-heading').hidden = !night.activities.length;
}

function renderBrief(brief, { stale = false } = {}) {
  $('empty').hidden = !!brief;
  if (!brief) {
    for (const id of ['email', 'notes-card']) $(id).hidden = true;
    renderDateNight(null);
    renderDinnerLink(null);
    return;
  }
  renderEmail(brief.email);
  renderDinnerLink(brief);
  renderDateNight(brief.dateNight || null);
  $('notes').replaceChildren(...brief.notes.map((line) => el('li', {}, line)));
  $('notes-card').hidden = !brief.notes.length;

  let tagline = document.querySelector('.tagline');
  if (!tagline) {
    tagline = el('p', { class: 'tagline' });
    $('greeting').after(tagline);
  }
  tagline.textContent = brief.greeting || '';
  tagline.hidden = !brief.greeting;

  const when = brief.receivedAt ? ` at ${timeOf(brief.receivedAt)}` : '';
  $('brief-status').textContent = `${dayName(brief.date)} brief, sent${when}.${stale ? ' Offline: showing the saved copy.' : ''}`;
}

function renderDates(dates, shown) {
  const select = $('date-select');
  select.replaceChildren(...dates.map((date) => el('option', { value: date }, dayName(date))));
  select.value = shown;
  select.hidden = dates.length < 2;
}

async function loadBrief(date) {
  $('brief-status').textContent = 'Checking for your brief…';
  try {
    const { brief, dates } = await api(`/api/brief${date ? `?date=${date}` : ''}`);
    $('key-gate').hidden = true;
    renderBrief(brief);
    if (brief) renderDates(dates, brief.date);
    if (brief && !date) saved.set(CACHE, brief);
  } catch (error) {
    if (error.status === 401) {
      showGate(saved.get(KEY) ? 'That key did not work.' : '');
      $('brief-status').textContent = '';
      return;
    }
    const cached = saved.get(CACHE);
    if (cached) renderBrief(cached, { stale: true });
    else $('brief-status').textContent = `Could not load your brief: ${error.message}`;
  }
}

$('date-select').addEventListener('change', (event) => loadBrief(event.target.value));
$('refresh').addEventListener('click', () => {
  header();
  loadBrief();
  loadWeather();
  loadTrader();
});

/* ---------- Trading bot ---------- */

const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

function renderTrader(st) {
  if (!st || !st.start) {
    $('trader-since').textContent = 'Paper trading starts tomorrow (weekdays at 6:36 AM). Results show here after the close, around 1 PM.';
    $('trader-scores').replaceChildren();
    $('trader-real').textContent = '';
    $('trader-today').replaceChildren(el('li', {}, 'No trades yet.'));
    $('trader').hidden = false;
    return;
  }
  const since = new Date(`${st.start.date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  $('trader-since').textContent = `What $100 became since ${since} · ${st.trades} trades, ${st.wins} wins`;
  const rows = [
    ['Day trader (shares)', st.day_trader_shares_100_is_now],
    ['Day trader (debit spreads)', st.day_trader_spreads_100_is_now],
    ...(st.day_trader_credit_100_is_now != null ? [['Day trader (credit spreads)', st.day_trader_credit_100_is_now]] : []),
    ['Long-term bot', st.long_term_bot_100_is_now],
    ['Just holding the S&P 500', st.spy_hold_100_is_now],
  ];
  const best = Math.max(...rows.map(([, v]) => (v == null ? -Infinity : v)));
  $('trader-scores').replaceChildren(...rows.map(([name, v]) => el('li', { class: v === best ? 'lead' : '' },
    el('span', {}, name), el('strong', { class: v == null ? '' : v >= 100 ? 'up' : 'down' }, money(v)))));
  const real = st.real_100_rules;
  $('trader-real').textContent = real
    ? `Under real $100 rules (3 day trades a week): shares ${money(real.shares_100_is_now)}, debit spreads ${money(real.spreads_100_is_now)}${real.credit_100_is_now != null ? `, credit spreads ${money(real.credit_100_is_now)}` : ''}.`
    : '';
  const today = (st.today || []).map((t) => {
    if (!t.symbol) return el('li', {}, t.note || 'No trade today.');
    const dir = t.side === 'up' ? '▲' : '▼';
    const res = t.filled ? `${t.return_pct >= 0 ? '+' : ''}${t.return_pct.toFixed(2)}%` : 'never triggered';
    const usd = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`;
    const spread = t.spread ? ` · debit ${usd(t.spread.pnl_usd)}` : '';
    const credit = t.credit ? ` · credit ${usd(t.credit.pnl_usd)}` : '';
    return el('li', {}, `${dir} ${t.symbol}: ${res}${spread}${credit}`);
  });
  $('trader-today').replaceChildren(...(today.length ? today : [el('li', {}, 'No trade today.')]));
  $('trader').hidden = false;
}

async function loadTrader() {
  try {
    const { status } = await api('/api/trader');
    renderTrader(status);
  } catch { /* the card just stays hidden */ }
}

/* ---------- Crypto bot ---------- */

const pct = (v) => `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`;

function renderCrypto(st) {
  if (!st) return;
  const since = new Date(st.started).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const m = st.meme || {};
  $('crypto-since').textContent = `What $100 became since ${since} · ${(st.breakout?.trades || 0) + (m.trades || 0)} closed trades, ${m.rugs || 0} rugs`;
  const rows = [
    ['Coin breakout (daily)', st.breakout_100_is_now],
    ['Meme hunter (every 10 min)', st.meme_100_is_now],
    ...(st.scalp_100_is_now == null ? [] : [['Meme scalper (every 2 min, 24/7)', st.scalp_100_is_now]]),
    ['Just holding Bitcoin', st.btc_hold_100_is_now],
  ];
  const best = Math.max(...rows.map(([, v]) => (v == null ? -Infinity : v)));
  // Arrows as well as colour, so up and down never rely on colour alone.
  $('crypto-scores').replaceChildren(...rows.map(([name, v]) => el('li', { class: v === best ? 'lead' : '' },
    el('span', {}, name),
    el('strong', { class: v == null ? '' : v >= 100 ? 'up' : 'down' }, v == null ? '—' : `${v >= 100 ? '▲' : '▼'} ${money(v)}`))));
  const open = [...(st.breakout?.open || []), ...(m.open || []), ...(st.scalp?.open || [])].map((p) => `${p.sym} ${pct(p.pnl_pct)}`);
  const trend = st.breakout?.btc_uptrend === false ? ' Coin breakout waits in cash while Bitcoin is under its 50-day average.' : '';
  $('crypto-open').textContent = `${open.length ? `Holding: ${open.join(', ')}.` : 'Holding nothing right now.'}${trend}`;
  const all = [...(st.recent || []), ...(st.scalp?.recent || [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const trades = all.slice(0, 8).map((t) => el('li', {},
    t.act === 'buy' ? `Bought ${t.sym} ($${Math.round(t.usd)}): ${t.why}`
      : `${t.act === 'sell half' ? 'Sold half of' : 'Sold'} ${t.sym} ${pct(t.pnl_pct)}: ${t.why}`));
  $('crypto-trades').replaceChildren(...(trades.length ? trades : [el('li', {}, 'No trades yet.')]));
  $('crypto').hidden = false;
}

async function loadCrypto() {
  try {
    const { status } = await api('/api/crypto');
    renderCrypto(status);
  } catch { /* the card just stays hidden */ }
}

/* ---------- Weather ---------- */

function setPlaceLabel(place) {
  $('place-button').textContent = place ? `${place.name} ✎` : 'Set your place';
}

async function loadWeather() {
  const place = saved.get(PLACE);
  setPlaceLabel(place);
  const body = $('weather-body');
  if (!place) {
    $('place-form').hidden = false;
    body.replaceChildren(el('p', { class: 'muted' }, 'Type your city, or tap 📍 to use where you are.'));
    return;
  }
  try {
    const w = await forecast(place);
    body.replaceChildren(
      el('div', { class: 'now' },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, w.icon),
        el('span', { class: 'temp' }, `${w.temp}°`),
        el('div', { class: 'now-text' },
          el('strong', {}, w.label),
          el('span', { class: 'muted small' }, `Feels ${w.feels}° · H ${w.high}° L ${w.low}°`),
          el('span', { class: 'muted small' }, `${w.rain ?? 0}% rain · wind ${w.wind} mph · sunset ${hourOf(w.sunset)}`))),
      el('ol', { class: 'hours' }, w.hours.map((h) => el('li', {},
        el('span', { class: 'small muted' }, hourOf(h.time)),
        el('span', { 'aria-label': h.label }, h.icon),
        el('span', {}, `${h.temp}°`),
        h.rain >= 20 ? el('span', { class: 'small rain' }, `${h.rain}%`) : el('span', { class: 'small' }, ' ')))),
    );
  } catch (error) {
    body.replaceChildren(el('p', { class: 'muted' }, error.message));
  }
}

async function choosePlace(find) {
  const body = $('weather-body');
  body.replaceChildren(el('p', { class: 'muted' }, 'Finding it…'));
  try {
    saved.set(PLACE, await find());
    $('place-form').hidden = true;
  } catch (error) {
    body.replaceChildren(el('p', { class: 'muted' }, error.message));
    return;
  }
  loadWeather();
}

$('place-button').addEventListener('click', () => {
  $('place-form').hidden = !$('place-form').hidden;
  if (!$('place-form').hidden) $('place-input').focus();
});
$('place-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = $('place-input').value.trim();
  if (query) choosePlace(() => findPlace(query));
});
$('locate-button').addEventListener('click', () => choosePlace(hereNow));

/* ---------- Start ---------- */

header();
takeKeyFromLink();
const cached = saved.get(CACHE);
if (cached) renderBrief(cached);
loadBrief();
loadWeather();
loadTrader();
loadCrypto();

// Opening the app from the background on a new morning should show the new brief.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  header();
  loadBrief();
  loadWeather();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
