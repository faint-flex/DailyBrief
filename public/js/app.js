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

function renderDateNight(night) {
  $('date-night').hidden = !night;
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
    for (const id of ['email', 'notes-card', 'date-night']) $(id).hidden = true;
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
});

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

// Opening the app from the background on a new morning should show the new brief.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  header();
  loadBrief();
  loadWeather();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
