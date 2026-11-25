// Pallet Router: scan each driver's paper stack (top sheet = stop 1), then scan
// pallet stickers to see which driver and stop they belong to.
// Everything is kept on this phone (localStorage). Works with a Bluetooth
// scanner (it types like a keyboard and presses Enter) or the phone camera.
import { norm, findStop, findExact, loadInfo, pairSheets, nearlySame, poolMatch, lookupAddress, addressBook } from './match.js';
import { mergeDocs, canon, palletKey } from './merge.js';
import { putPhoto, photoUrl, photoBlob, deletePhoto, clearPhotos, shrink } from './photos.js';

const KEY = 'pallet-router-v1';
const COLORS = [
  ['#1e5bd8', 'Blue'], ['#1b8a3a', 'Green'], ['#e07000', 'Orange'], ['#7b3fc4', 'Purple'],
  ['#00838f', 'Teal'], ['#c2185b', 'Pink'], ['#6d4c41', 'Brown'], ['#283593', 'Navy'],
  ['#827717', 'Olive'], ['#455a64', 'Gray'], ['#ad1457', 'Magenta'], ['#00695c', 'Pine'],
];

// The regular drivers, always shown as one-tap buttons on the Stacks tab.
// Each keeps the same color every day.
const ROSTER = ['Martin', 'Jason', 'Rudy', 'Leo', 'Justin'];
const rosterIndex = (name) => ROSTER.findIndex((n) => n.toLowerCase() === String(name).toLowerCase());

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- state ----------
function blank(pool = []) {
  return { pool, pages: [], gone: {}, startedAt: Date.now(), drivers: [], pallets: [], recentNames: load()?.recentNames || [] };
}
const KEEP_DAYS = 7;
// Addresses carry over between days by pro#: freight from yesterday's manifest can
// ride today. Rows older than KEEP_DAYS drop off. Today's stop addresses join too.
function carryPool() {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const pool = (state.pool || []).filter((r) => (r.at || 0) >= cutoff);
  const known = new Set(pool.map((r) => norm(r.pro)));
  for (const d of state.drivers) {
    for (const stop of d.stops) {
      const a = stop.addr;
      if (!a?.name || known.has(norm(stop.pro))) continue;
      pool.push({ pro: stop.pro, alt: '', name: a.name, street: a.street || '', city: a.city || '', at: stop.at || Date.now() });
      known.add(norm(stop.pro));
    }
  }
  return pool;
}
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
let state = load() || blank();
state.pool = state.pool || [];
state.gone = state.gone || {};
state.pages = state.pages || [];
for (const r of state.pool) if (!r.at) r.at = state.startedAt || Date.now();
for (const d of state.drivers) if (rosterIndex(d.name) >= 0) d.colorIndex = rosterIndex(d.name); // keep roster colors fixed
// Stamps each stack with the time of its last change (rev), and remembers deleted
// stacks and cleared pallets, so a shared day merges right on both phones.
let knownDrivers = new Map(); // id -> stack as last saved
let knownPallets = new Set();
const body = (d) => { const { rev, ...rest } = d; return JSON.stringify(rest); };
function remember() {
  knownDrivers = new Map(state.drivers.map((d) => [d.id, body(d)]));
  knownPallets = new Set(state.pallets.map(palletKey));
}
function stamp() {
  const now = Date.now();
  const ids = new Set();
  for (const d of state.drivers) {
    ids.add(d.id);
    const b = body(d);
    if (knownDrivers.get(d.id) !== b) { d.rev = now; knownDrivers.set(d.id, b); }
  }
  for (const id of knownDrivers.keys()) if (!ids.has(id)) { state.gone[`d:${id}`] = now; knownDrivers.delete(id); }
  const keys = new Set(state.pallets.map(palletKey));
  for (const k of knownPallets) if (!keys.has(k)) state.gone[`p:${k}`] = now;
  knownPallets = keys;
}
remember();
function save() {
  stamp();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Could not save on this phone'); }
  if (share.code) { clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, 300); }
}

let tab = 'stacks';
let scanningId = null; // driver whose stack is being scanned
let pendingMove = null; // { code, from } when a sheet is already on another stack
let lastResult = null;

const driverById = (id) => state.drivers.find((d) => d.id === id);
const colorOf = (d) => COLORS[d.colorIndex % COLORS.length];
// A "stack" is one run for one driver. Drivers often have more than one run.
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const runsOf = (name) => state.drivers.filter((d) => sameName(d.name, name)).sort((a, b) => (a.run || 1) - (b.run || 1));
const multiRun = (d) => runsOf(d.name).length > 1 || (d.run || 1) > 1;
const label = (d) => (multiRun(d) ? `${d.name} · Run ${d.run || 1}` : d.name);

function nextColorIndex() {
  const used = new Set([...ROSTER.keys(), ...state.drivers.map((d) => d.colorIndex % COLORS.length)]);
  for (let i = 0; i < COLORS.length; i += 1) if (!used.has(i)) return i;
  return state.drivers.length;
}

// ---------- feedback ----------
let audio;
function tone(freq, ms, when = 0, type = 'square') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = 0.15;
    o.connect(g); g.connect(audio.destination);
    const t = audio.currentTime + when;
    o.start(t); o.stop(t + ms / 1000);
  } catch { /* no sound available */ }
}
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* ignore */ } };
const good = () => { tone(1320, 90); buzz(40); };
const okay = () => { tone(880, 90); tone(880, 90, 0.14); buzz([40, 60, 40]); };
const bad = () => { tone(220, 260, 0, 'sawtooth'); tone(180, 300, 0.32, 'sawtooth'); buzz([200, 100, 200]); };
document.addEventListener('pointerdown', () => { if (audio?.state === 'suspended') audio.resume(); }, { passive: true });

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// Keep the screen awake while the app is open (where the phone allows it).
let wakeLock;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', keepAwake);

// ---------- scanning input ----------
// A Bluetooth scanner types the code fast and ends with Enter (or Tab).
let buffer = '';
let lastKey = 0;
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // the field handles itself
  const now = Date.now();
  if (now - lastKey > 600) buffer = '';
  lastKey = now;
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (buffer.length >= 3) {
      e.preventDefault();
      if (editOpen()) { editValue = buffer.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, ''); showValue(); good(); if (editing?.mode === 'lookup') { lookupQuery = editValue; renderLookup(); } } else handleScan(buffer);
    }
    buffer = '';
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buffer += e.key;
});



function handleScan(raw) {
  // Some barcodes carry a check or stop character (like a trailing %); keep only the number.
  const code = String(raw).trim().replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, '');
  if (norm(code).length < 3) return;
  if (scanningId) stackScan(code);
  else if (tab === 'lookup') { lookupQuery = code; good(); render(); }
  else palletScan(code);
}

// ---------- stacks ----------
function stackScan(code) {
  const driver = driverById(scanningId);
  if (!driver) return;
  const hit = findExact(state.drivers, code);
  pendingMove = null;
  if (hit && hit.driver.id === driver.id) {
    okay();
    showStackMsg('warn', `Already scanned as stop ${hit.index + 1}.`);
    return;
  }
  if (hit) {
    bad();
    pendingMove = { code, fromId: hit.driver.id };
    showStackMsg('bad', `${esc(code)} is already on <b>${esc(label(hit.driver))}</b> (stop ${hit.index + 1}).`,
      '<div class="row"><button class="small ghost" id="mv-no">Leave it</button><button class="small primary" id="mv-yes">Move it here</button></div>');
    $('mv-no').onclick = () => { pendingMove = null; showStackMsg(); };
    $('mv-yes').onclick = () => {
      const from = driverById(pendingMove.fromId);
      const i = findExact([from], pendingMove.code)?.index;
      const moved = i !== undefined ? from.stops.splice(i, 1)[0] : null;
      driver.stops.push({ pro: pendingMove.code, at: Date.now(), ...(moved?.photo ? { photo: true } : {}) });
      pendingMove = null; save(); good(); showStackMsg(); render();
    };
    return;
  }
  driver.stops.push({ pro: code, at: Date.now() });
  save(); good(); offerPhoto(code, driver.stops.length); render();
}

// ---------- address photos ----------
let photoFor = null; // pro# the next photo belongs to
function offerPhoto(pro, stopNo) {
  $('stack-msg').innerHTML = `<button class="big photo" id="snap">📷 Photo of address · stop ${stopNo}</button>`;
  $('snap').onclick = () => takePhoto(pro);
}
function takePhoto(pro) {
  photoFor = pro;
  $('photo-input').value = '';
  $('photo-input').click();
}
$('photo-input').addEventListener('change', async () => {
  const file = $('photo-input').files[0];
  const pro = photoFor;
  photoFor = null;
  if (!file || !pro) return;
  try {
    const blob = await shrink(file);
    await putPhoto(norm(pro), blob);
    for (const d of state.drivers) for (const s of d.stops) if (norm(s.pro) === norm(pro)) s.photo = true;
    save(); good(); showStackMsg(); render();
    toast('Address photo saved');
    readAddress(pro, blob);
  } catch {
    toast('Could not save that photo');
  }
});
// Reads the consignee name and address off the photo (Workers AI on this site).
const stopsFor = (pro) => state.drivers.flatMap((d) => d.stops).filter((s) => norm(s.pro) === norm(pro));
async function readAddress(pro, blob) {
  blob = blob || await photoBlob(norm(pro)).catch(() => null);
  if (!blob) return;
  stopsFor(pro).forEach((s) => { s.addr = { status: 'reading' }; });
  render();
  let addr = { status: 'failed' };
  try {
    const image = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const res = await fetch('/pallets/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
    const out = await res.json().catch(() => ({}));
    if (res.ok && (out.name || out.street)) {
      addr = { name: out.name, street: out.street, city: out.city };
      // The pro# read off the photo should be this sheet's; flag it if it clearly isn't.
      const seen = [out.pro, out.handwritten].filter((v) => v && norm(v).length >= 6);
      if (seen.length && !seen.some((v) => nearlySame(v, pro))) addr.check = seen[0];
    }
  } catch { /* offline: leave it as failed, tap to retry */ }
  stopsFor(pro).forEach((s) => { s.addr = addr; });
  save(); render();
}
// A sheet with no usable barcode (TOTAL, some interline sheets): one photo adds
// it as the next stop, using the handwritten warehouse pro# if there is one.
$('sheet-photo').onclick = () => { $('sheet-input').value = ''; $('sheet-input').click(); };
$('sheet-input').addEventListener('change', async () => {
  const file = $('sheet-input').files[0];
  const d = driverById(scanningId);
  if (!file || !d) return;
  const btn = $('sheet-photo');
  btn.disabled = true;
  btn.textContent = 'Reading the sheet…';
  try {
    const blob = await shrink(file);
    const image = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const res = await fetch('/pallets/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
    const out = await res.json().catch(() => ({}));
    const pro = (out.handwritten && norm(out.handwritten).length >= 6 ? out.handwritten : out.pro) || `SHEET${d.stops.length + 1}`;
    if (findExact(state.drivers, pro)) { toast(`${pro} is already in a stack`); return; }
    const stop = { pro, at: Date.now(), photo: true };
    if (res.ok && (out.name || out.street)) stop.addr = { name: out.name, street: out.street, city: out.city };
    await putPhoto(norm(pro), blob);
    d.stops.push(stop);
    save(); good(); render();
    // Let them check the number against the pallet sticker.
    openEdit(d.id, d.stops.length - 1);
    $('edit-title').textContent = `Stop ${d.stops.length}: is this the pro# on the sticker?`;
  } catch {
    bad();
    toast('Could not read that photo. Type the pro# instead.');
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 Add a sheet with no barcode';
  }
});

// One photo of the whole fanned-out stack fills in addresses for the stops
// already scanned by barcode (the barcodes stay the source of truth for order).
$('stack-photo').onclick = () => {
  const d = driverById(scanningId);
  if (!d || !d.stops.length) { toast('Scan the sheets first, then take the stack photo'); return; }
  $('stack-input').value = '';
  $('stack-input').click();
};
// Stack photos read in the background, so you can move on to the next run.
const readingStacks = new Set(); // driver (run) ids with a stack photo being read

// ---------- manifest: one photo of the line manifest gives every stop its address ----------
let readingManifests = 0;
$('manifest-photo').onclick = () => { $('manifest-input').value = ''; $('manifest-input').click(); };
$('manifest-input').addEventListener('change', async () => {
  const file = $('manifest-input').files[0];
  if (!file) return;
  const blob = await shrink(file, 1800).catch(() => null);
  if (!blob) { toast('Could not open that photo'); return; }
  const id = `m${Date.now().toString(36)}`;
  await putPhoto(id, blob).catch(() => {}); // kept on this phone to view or retry
  readManifest(id, blob);
});
// Every manifest photo is logged as a page, so you can see which pages you have.
async function readManifest(id, blob) {
  blob = blob || await photoBlob(id).catch(() => null);
  if (!blob) { toast('That photo is on the other phone'); return; }
  const log = (fields) => {
    const i = state.pages.findIndex((p) => p.id === id);
    const page = { ...(i === -1 ? { id } : state.pages[i]), ...fields, at: Date.now() };
    if (i === -1) state.pages.push(page); else state.pages[i] = page;
  };
  log({ status: 'reading' });
  save();
  readingManifests += 1;
  render();
  toast('Reading the manifest in the background (up to a minute).');
  try {
    const image = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const res = await fetch('/pallets/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, mode: 'manifest' }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(out.rows)) throw new Error(out.error || 'no rows');
    log({ status: 'ok', manifest: out.manifest || '', page: out.page || '', origin: out.origin || '', last: !!out.last, rows: out.rows.length, listed: out.listed || out.rows.length, pros: out.rows.map((r) => r.pro) });
    let added = 0;
    for (const r of out.rows) {
      const row = { pro: r.pro, alt: r.alt || '', name: r.name, street: r.street, city: r.city, at: Date.now() };
      const i = state.pool.findIndex((p) => norm(p.pro) === norm(r.pro));
      if (i === -1) { state.pool.push(row); added += 1; } else state.pool[i] = row; // today's manifest wins
    }
    save(); good();
    toast(`Manifest: added ${added} address${added === 1 ? '' : 'es'} to the pool`);
  } catch {
    log({ status: 'failed' });
    save();
    bad();
    toast('Could not read that manifest. Tap Retry under Manifest pages, or retake it flat, close and well lit.');
  } finally {
    readingManifests -= 1;
    render();
  }
}

// Groups the pages by manifest#, so a missing page number or a missing last page stands out.
function renderPages() {
  const pages = state.pages || [];
  const el = $('pages');
  if (!pages.length) { el.innerHTML = ''; return; }
  const groups = new Map();
  const loose = [];
  for (const p of pages) {
    if (p.status === 'ok' && p.manifest) {
      if (!groups.has(p.manifest)) groups.set(p.manifest, []);
      groups.get(p.manifest).push(p);
    } else loose.push(p);
  }
  const chip = (p) => {
    const label = p.status === 'reading' ? '⏳ reading' : p.status === 'failed' ? '✕ not read' : `${p.page ? `Page ${esc(p.page)}` : 'Page ?'} · ${p.rows} row${p.rows === 1 ? "" : "s"}`;
    return `<button class="pg ${p.status}" data-page="${esc(p.id)}">${label}</button>${p.status === 'failed' ? `<button class="retry" data-reread="${esc(p.id)}">Retry</button>` : ''}`;
  };
  const out = [];
  for (const [num, list] of groups) {
    list.sort((a, b) => (Number(a.page) || 999) - (Number(b.page) || 999));
    const nums = list.map((p) => Number(p.page)).filter(Boolean);
    const max = Math.max(0, ...nums);
    const missing = [];
    for (let n = 1; n < max; n += 1) if (!nums.includes(n)) missing.push(n);
    const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
    const hasLast = list.some((p) => p.last);
    const notes = [];
    if (missing.length) notes.push(`<span class="bad-t">⚠ Missing page ${missing.join(', ')}</span>`);
    if (!hasLast) notes.push('<span class="warn-t">⚠ No last page (TOTAL) yet</span>');
    if (dupes.length) notes.push(`<span class="muted">Page ${[...new Set(dupes)].join(', ')} scanned twice</span>`);
    if (!notes.length) notes.push('<span class="ok">✓ All pages</span>');
    out.push(`<div class="mf"><div class="mf-top"><b>Manifest ${esc(num)}</b>${list[0].origin ? ` <span class="muted">· ${esc(list[0].origin)}</span>` : ''}</div><div class="mf-pages">${list.map(chip).join('')}</div><div class="mf-notes">${notes.join(' · ')}</div></div>`);
  }
  if (loose.length) out.push(`<div class="mf"><div class="mf-top"><b>${loose.some((p) => p.status === 'ok') ? 'Header not read' : 'Photos'}</b></div><div class="mf-pages">${loose.map(chip).join('')}</div></div>`);
  const ok = pages.filter((p) => p.status === 'ok');
  el.innerHTML = `<div class="hint small-hint">Manifest pages today: ${ok.length} read · ${ok.reduce((n, p) => n + (p.rows || 0), 0)} rows. Tap a page to see the photo and check the row count.</div>${out.join('')}`;
  el.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => showPage(b.dataset.page); });
  el.querySelectorAll('[data-reread]').forEach((b) => { b.onclick = () => readManifest(b.dataset.reread); });
}
function showPage(id) {
  const p = state.pages.find((x) => x.id === id);
  photoUrl(id).then((url) => {
    if (!url) { toast(p?.status === 'ok' ? `${p.rows} rows read. The photo is on the other phone.` : 'The photo is on the other phone'); return; }
    $('viewer-img').src = url;
    $('viewer-msg').textContent = p?.status === 'ok' ? `${p.rows} rows read${p.listed > p.rows ? ` (${p.listed - p.rows} skipped: not a Las Vegas address)` : ''}. Count the rows on the paper. Tap to close.` : 'Tap to close';
    $('viewer').hidden = false;
  });
}

// Fills stops from the manifest pool. A close-up sheet photo still wins; the
// manifest (printed, clean) beats a stack photo.
function applyPool() {
  if (!state.pool?.length) return;
  let changed = false;
  for (const d of state.drivers) {
    for (const stop of d.stops) {
      const from = stop.addr?.from;
      if (stop.addr?.name && from !== 'stack' && from !== 'manifest') continue;
      const row = poolMatch(state.pool, stop.pro);
      if (!row) continue;
      if (from === 'manifest' && stop.addr.name === row.name && stop.addr.street === row.street) continue;
      stop.addr = { name: row.name, street: row.street, city: row.city, from: 'manifest' };
      changed = true;
    }
  }
  if (changed) save();
}
$('stack-input').addEventListener('change', async () => {
  const file = $('stack-input').files[0];
  const d = driverById(scanningId);
  if (!file || !d) return;
  readingStacks.add(d.id);
  render();
  toast('Reading in the background. Go ahead to the next run.');
  try {
    const blob = await shrink(file, 1600);
    const image = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const res = await fetch('/pallets/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, mode: 'stack' }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(out.sheets)) throw new Error(out.error || 'no sheets');
    let filled = 0;
    for (const { index, sheet } of pairSheets(d.stops, out.sheets)) {
      const stop = d.stops[index];
      if (!sheet.name && !sheet.street) continue;
      if (stop.addr?.name && stop.addr.from !== 'stack') { filled += 1; continue; } // a close-up photo wins
      stop.addr = { name: sheet.name, street: sheet.street, city: sheet.city, from: 'stack' };
      filled += 1;
    }
    save(); good();
    toast(`${label(d)}: filled ${filled} of ${d.stops.length} addresses`);
  } catch {
    bad();
    toast(`${label(d)}: could not read that photo. Try closer, flat and well lit.`);
  } finally {
    readingStacks.delete(d.id);
    render();
  }
});

// ---------- pro# keypad: fix a stop, move it, or enter a number by hand ----------
// A Bluetooth scanner hides the phone's keyboard, so this has its own number pad,
// and scanning a barcode while it is open fills in the number.
let editing = null; // { mode: 'edit', driverId, index } or { mode: 'enter' }
let editValue = '';
function showValue() {
  $('edit-pro').textContent = editValue || ' ';
  $('edit-pro').classList.toggle('empty', !editValue);
}
function openEdit(driverId, index) {
  const d = driverById(driverId);
  if (!d || !d.stops[index]) return;
  editing = { mode: 'edit', driverId, index };
  editValue = d.stops[index].pro;
  $('edit-title').textContent = `Stop ${index + 1} of ${d.stops.length}`;
  $('edit-move').hidden = false;
  $('edit-addr').hidden = false;
  const a = d.stops[index].addr || {};
  $('addr-name').value = a.name || '';
  $('addr-street').value = a.street || '';
  $('addr-city').value = a.city || '';
  $('edit-save').textContent = 'Save';
  showValue();
  $('edit-sheet').hidden = false;
}
function openJoin() {
  editing = { mode: 'join' };
  editValue = '';
  $('edit-title').textContent = state.drivers.length ? 'Code from the other phone (replaces the stacks on this phone)' : 'Code from the other phone';
  $('edit-move').hidden = true;
  $('edit-save').textContent = 'Join';
  showValue();
  $('edit-sheet').hidden = false;
}
function openEntry() {
  editing = { mode: 'enter' };
  editValue = '';
  editing = { mode: tab === 'lookup' && !scanningId ? 'lookup' : 'enter' };
  $('edit-title').textContent = scanningId ? 'Enter a sheet pro#' : editing.mode === 'lookup' ? 'Look up a pro#' : 'Enter a pallet pro#';
  $('edit-move').hidden = true;
  $('edit-save').textContent = 'Go';
  showValue();
  $('edit-sheet').hidden = false;
}
const editOpen = () => !$('edit-sheet').hidden;
function closeEdit() { editing = null; $('edit-sheet').hidden = true; $('edit-addr').hidden = true; document.activeElement?.blur?.(); }
$('edit-cancel').onclick = closeEdit;
$('edit-save').onclick = saveEdit;
$('enter-btn').onclick = openEntry;
document.querySelectorAll('#keypad [data-k]').forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'back') editValue = editValue.slice(0, -1);
    else if (k === 'clear') editValue = '';
    else if (editValue.length < 20) editValue += k;
    showValue();
    if (editing?.mode === 'lookup') { lookupQuery = editValue; renderLookup(); } // results update as you type
  };
});
function moveStop(step) {
  const d = driverById(editing?.driverId);
  if (!d) return;
  const from = editing.index;
  const to = from + step;
  if (to < 0 || to >= d.stops.length) return;
  const [stop] = d.stops.splice(from, 1);
  d.stops.splice(to, 0, stop);
  editing.index = to;
  $('edit-title').textContent = `Stop ${to + 1} of ${d.stops.length}`;
  save(); render();
}
$('edit-up').onclick = () => moveStop(-1);
$('edit-down').onclick = () => moveStop(1);

async function saveEdit() {
  if (!editing) return;
  const pro = editValue.trim().replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, '');
  if (editing.mode === 'join') {
    const code = editValue.replace(/\D/g, '');
    if (code.length !== 6) { toast('The code is 6 digits'); return; }
    closeEdit();
    joinSharing(code);
    return;
  }
  if (editing.mode === 'lookup') { lookupQuery = pro; closeEdit(); render(); return; }
  if (editing.mode === 'enter') {
    closeEdit();
    if (norm(pro).length >= 3) handleScan(pro);
    return;
  }
  const d = driverById(editing.driverId);
  const stop = d?.stops[editing.index];
  if (!stop || norm(pro).length < 3) { toast('Enter the pro# from the sheet'); return; }
  const other = findExact(state.drivers, pro);
  if (other && !(other.driver.id === d.id && other.index === editing.index)) {
    toast(`${pro} is already ${label(other.driver)} stop ${other.index + 1}`);
    return;
  }
  // A typed address wins over the manifest and photos (applyPool leaves it alone).
  const typed = { name: $('addr-name').value.trim(), street: $('addr-street').value.trim(), city: $('addr-city').value.trim() };
  const before = stop.addr || {};
  if ((typed.name || typed.street) && (typed.name !== (before.name || '') || typed.street !== (before.street || '') || typed.city !== (before.city || ''))) {
    stop.addr = { ...typed, from: 'typed' };
  }
  const old = stop.pro;
  stop.pro = pro;
  if (stop.photo && norm(old) !== norm(pro)) {
    // Move the address photo to the new pro#.
    const blob = await photoBlob(norm(old)).catch(() => null);
    if (blob) { await putPhoto(norm(pro), blob).catch(() => {}); deletePhoto(norm(old)).catch(() => {}); }
  }
  closeEdit();
  save(); good(); render();
  toast(`Saved ${pro}`);
}

function addrHtml(s, big = false) {
  const a = s.addr;
  if (!a) return '';
  if (a.status === 'reading') return '<div class="addr muted">Reading address…</div>';
  if (a.status === 'failed') return `<div class="addr muted"><button class="retry" data-retry="${esc(s.pro)}">Couldn't read it · tap to retry</button></div>`;
  const approx = a.from === 'stack' ? '<div class="addr muted">From the stack photo: double-check the street #</div>' : '';
  const warn = (a.check ? `<div class="addr warn">⚠ Photo shows pro ${esc(a.check)}. Right sheet?</div>` : '') + (big ? approx : '');
  return big
    ? `<div class="r-addr"><b>${esc(a.name)}</b><br>${esc(a.street)}<br>${esc(a.city)}</div>${warn}`
    : `<div class="addr"><b>${esc(a.name)}</b> · ${esc(a.street)}</div>${warn}`;
}
function wireRetry(root) {
  root.querySelectorAll('[data-retry]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); readAddress(b.dataset.retry); }; });
}

// Fills <img data-photo="pro"> elements once their photo is loaded.
function fillPhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const url = await photoUrl(norm(img.dataset.photo)).catch(() => null);
    if (url) img.src = url; else img.remove();
  });
}
function showPhoto(pro) {
  photoUrl(norm(pro)).then((url) => {
    if (!url) return;
    $('viewer-img').src = url;
    $('viewer-msg').textContent = 'Tap to close';
    $('viewer').hidden = false;
  });
}
$('no-addr').onclick = () => { lookupFilter = 'noaddr'; lookupQuery = ''; setTab('lookup'); };
$('viewer').onclick = () => { $('viewer').hidden = true; };

function showStackMsg(kind, html = '', extra = '') {
  $('stack-msg').innerHTML = kind ? `<div class="msg ${kind}">${html}${extra}</div>` : '';
}

function openStack(id) {
  scanningId = id; pendingMove = null; showStackMsg();
  stopCamera();
  render();
  keepAwake();
}

$('add-driver').onclick = () => {
  const taken = new Set([...ROSTER, ...state.drivers.map((d) => d.name)].map((n) => n.toLowerCase()));
  const names = state.recentNames.filter((n) => !taken.has(n.toLowerCase())).slice(0, 16);
  $('name-chips').innerHTML = names.map((n) => `<button class="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('');
  $('name-chips').querySelectorAll('.chip').forEach((b) => { b.onclick = () => startDriver(b.dataset.name); });
  $('driver-name').value = '';
  $('driver-sheet').hidden = false;
  if (!names.length) setTimeout(() => $('driver-name').focus(), 50);
};
$('driver-cancel').onclick = () => { $('driver-sheet').hidden = true; };
$('driver-start').onclick = () => startDriver($('driver-name').value);
$('driver-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startDriver($('driver-name').value); } });

function startDriver(rawName, run = 1) {
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) { $('driver-name').focus(); return; }
  $('driver-sheet').hidden = true;
  $('driver-name').blur();
  let driver = state.drivers.find((d) => sameName(d.name, name) && (d.run || 1) === run);
  if (!driver) {
    const sibling = runsOf(name)[0];
    const colorIndex = rosterIndex(name) >= 0 ? rosterIndex(name) : sibling ? sibling.colorIndex : nextColorIndex();
    driver = { id: `d${Date.now().toString(36)}`, name: sibling ? sibling.name : name, run, colorIndex, stops: [] };
    state.drivers.push(driver);
  }
  state.recentNames = [name, ...state.recentNames.filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 30);
  save();
  openStack(driver.id);
}

$('stack-undo').onclick = () => {
  const d = driverById(scanningId);
  if (d && d.stops.length) { const s = d.stops.pop(); if (s.photo) deletePhoto(norm(s.pro)).catch(() => {}); save(); toast(`Removed ${s.pro}`); showStackMsg(); render(); }
};
$('stack-done').onclick = () => { scanningId = null; pendingMove = null; stopCamera(); render(); };
let deleteArmed = 0;
$('stack-delete').onclick = () => {
  if (Date.now() - deleteArmed > 3000) { deleteArmed = Date.now(); $('stack-delete').textContent = 'Tap again to delete'; return; }
  state.drivers = state.drivers.filter((d) => d.id !== scanningId);
  scanningId = null; save(); render();
};

let newDayArmed = 0;
$('new-day').onclick = () => {
  if (Date.now() - newDayArmed > 3000) { newDayArmed = Date.now(); $('new-day').textContent = 'Tap again to clear stacks and pallets (addresses are kept)'; return; }
  // Mark today's stacks and pallets as cleared, so a shared phone doesn't bring them back.
  const now = Date.now();
  const gone = Object.fromEntries(Object.entries(state.gone || {}).filter(([, t]) => now - t < 2 * 86400000));
  for (const d of state.drivers) gone[`d:${d.id}`] = now;
  for (const p of state.pallets) gone[`p:${palletKey(p)}`] = now;
  state = blank(carryPool()); state.gone = gone; remember(); save(); lastResult = null; clearPhotos().catch(() => {}); render(); toast('New day started');
};

// ---------- sharing: two phones, one day ----------
// "Share" gives a 6-digit code; the other phone joins with it. Both phones then
// keep the same stacks, pallets and addresses (address photos stay on the phone
// that took them). The server merges both copies (see merge.js).
const SHARE_KEY = 'pallet-router-share';
let share = (() => { try { return JSON.parse(localStorage.getItem(SHARE_KEY) || 'null') || {}; } catch { return {}; } })();
let pushTimer;
let syncing = false;
let again = false;
let online = true;
let synced = ''; // the server's copy, in canon form
function saveShare() { try { localStorage.setItem(SHARE_KEY, JSON.stringify(share)); } catch { /* ignore */ } }

async function post(input) {
  const res = await fetch('/pallets/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const out = await res.json().catch(() => ({}));
  return { res, out };
}

function takeRemote(doc) {
  const merged = mergeDocs(state, doc);
  const { recentNames } = state;
  state = { ...merged, recentNames };
  remember();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  synced = canon(doc);
  render();
}

async function syncNow() {
  if (!share.code) return;
  if (syncing) { again = true; return; }
  syncing = true;
  try {
    const mine = canon(state);
    const dirty = mine !== synced;
    const { res, out } = await post({ code: share.code, ver: share.ver ?? -1, doc: dirty ? JSON.parse(mine) : null });
    if (res.status === 404) { synced = ''; again = true; return; } // the code was forgotten: send this phone's copy to set it up again
    if (!res.ok) throw new Error(out.error);
    if (out.doc) takeRemote(out.doc);
    share.ver = out.ver; saveShare();
    if (!online) { online = true; render(); }
    if (canon(state) !== synced) again = true; // edits made while this was on the way
  } catch {
    if (online) { online = false; render(); }
  } finally {
    syncing = false;
    if (again) { again = false; setTimeout(syncNow, 200); }
  }
}
setInterval(() => { if (share.code && document.visibilityState === 'visible') syncNow(); }, 3000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

async function startSharing() {
  for (let i = 0; i < 5; i += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const { res, out } = await post({ code, create: true, doc: JSON.parse(canon(state)) });
      if (res.status === 409) continue;
      if (!res.ok) throw new Error(out.error);
      share = { code, ver: out.ver }; saveShare();
      takeRemote(out.doc); openShare();
      return;
    } catch { break; }
  }
  bad(); toast('Could not start sharing. Check the signal and try again.');
}
async function joinSharing(code) {
  try {
    const { res, out } = await post({ code, ver: -1 });
    if (res.status === 404 || res.status === 400) { bad(); toast(`No one is sharing with ${code}. Check the code.`); return; }
    if (!res.ok || !out.doc) throw new Error(out.error);
    // Take their day: this phone's stacks give way, addresses are kept.
    state.startedAt = out.doc.startedAt; state.drivers = []; state.pallets = []; state.gone = {};
    remember();
    share = { code, ver: out.ver }; saveShare();
    scanningId = null; lastResult = null;
    takeRemote(out.doc);
    good(); toast(`Joined ${code}. You now see the same stacks.`);
    syncNow();
  } catch { bad(); toast('Could not join. Check the signal and try again.'); }
}
function stopSharing(why) {
  share = {}; saveShare(); synced = '';
  $('share-sheet').hidden = true;
  if (why) toast(why);
  render();
}
function openShare() {
  const on = !!share.code;
  $('share-off').hidden = on;
  $('share-on').hidden = !on;
  if (on) $('share-code').textContent = share.code.replace(/(\d{3})(\d{3})/, '$1 $2');
  $('share-sheet').hidden = false;
}
$('share-btn').onclick = openShare;
$('share-close').onclick = () => { $('share-sheet').hidden = true; };
$('share-start').onclick = startSharing;
$('share-join').onclick = () => { $('share-sheet').hidden = true; openJoin(); };
let stopArmed = 0;
$('share-stop').onclick = () => {
  if (Date.now() - stopArmed > 3000) { stopArmed = Date.now(); $('share-stop').textContent = 'Tap again to stop sharing on this phone'; return; }
  $('share-stop').textContent = 'Stop sharing on this phone';
  stopSharing('Sharing stopped. This phone keeps its copy.');
};

// ---------- pallets ----------
// The saved address for a pallet that is on no run: exact or one digit off, or a
// sticker that carries the pro# inside extra characters.
function addressFor(code) {
  const best = lookupAddress([], state.pool, code, 1)[0];
  if (best && best.rank < 2) return best;
  const key = norm(code);
  const loose = (state.pool || []).filter((r) => [r.pro, r.alt].some((v) => v && norm(v).length >= 6 && (key.startsWith(norm(v)) || key.endsWith(norm(v)))));
  return loose.length === 1 ? loose[0] : null;
}
function palletScan(code) {
  if (tab !== 'pallets') setTab('pallets');
  const hit = findStop(state.drivers, code);
  const entry = { code, at: Date.now(), driverId: hit?.driver.id || null, pro: hit ? hit.driver.stops[hit.index].pro : null };
  state.pallets.push(entry);
  save();
  if (hit) {
    const key = norm(entry.pro);
    const count = state.pallets.filter((p) => p.pro && norm(p.pro) === key).length;
    lastResult = { ok: true, driverId: hit.driver.id, pro: entry.pro, code, count };
    good();
  } else {
    lastResult = { ok: false, code, addr: addressFor(code) };
    bad();
  }
  render();
}

// ---------- camera ----------
let cam = null;
let camLast = { code: '', at: 0 };
$('cam-btn').onclick = startCamera;
$('cam-close').onclick = stopCamera;

async function startCamera() {
  if (!window.Html5Qrcode) { toast('Camera scanner did not load'); return; }
  $('camera').hidden = false;
  $('cam-msg').textContent = 'Hold the barcode flat, inside the box';
  try {
    const F = window.Html5QrcodeSupportedFormats;
    cam = new window.Html5Qrcode('reader', {
      formatsToSupport: [F.CODE_128, F.CODE_39, F.ITF, F.CODABAR, F.CODE_93, F.EAN_13, F.UPC_A, F.QR_CODE],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
    await cam.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * 0.9), height: Math.floor(Math.min(h, w) * 0.4) }) },
      (text) => {
        const now = Date.now();
        if (text === camLast.code && now - camLast.at < 2500) return;
        camLast = { code: text, at: now };
        $('cam-msg').textContent = `Read ${text}`;
        handleScan(text);
        if (!scanningId) stopCamera(); // show the big result right away
      },
      () => {},
    );
    keepAwake();
  } catch (err) {
    $('cam-msg').textContent = 'Camera blocked. Allow camera access for this site, then try again.';
    cam = null;
  }
}
async function stopCamera() {
  $('camera').hidden = true;
  if (cam) { try { await cam.stop(); cam.clear(); } catch { /* already stopped */ } cam = null; }
}

// ---------- tabs ----------
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
function setTab(name) {
  tab = name;
  if (name !== 'stacks') scanningId = null;
  render();
}

// ---------- render ----------
function stopsStatus() {
  const scanned = new Set(state.pallets.filter((p) => p.pro).map((p) => norm(p.pro)));
  let total = 0; let have = 0;
  for (const d of state.drivers) for (const s of d.stops) { total += 1; if (scanned.has(norm(s.pro))) have += 1; }
  const unknown = state.pallets.filter((p) => !p.driverId).length;
  return { scanned, total, have, unknown };
}

function render() {
  rematch();
  applyPool();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('tab-stacks').hidden = !(tab === 'stacks' && !scanningId);
  $('tab-stack-scan').hidden = !(tab === 'stacks' && scanningId);
  $('tab-pallets').hidden = tab !== 'pallets';
  $('tab-check').hidden = tab !== 'check';

  const st = stopsStatus();
  $('status').textContent = state.drivers.length
    ? `${state.drivers.length} drivers · ${st.total} stops` : `Started ${timeOf(state.startedAt)}`;
  $('status').classList.toggle('live', !!share.code && online);
  if (share.code) $('status').textContent += online ? ` · 🔗 ${share.code}` : ' · ⚠ offline';
  $('share-btn').textContent = share.code ? `🔗 Linked · code ${share.code}` : '🔗 Share with a coworker';
  const issues = (st.total - st.have) + st.unknown;
  $('check-badge').hidden = !(state.pallets.length && issues);
  $('check-badge').textContent = issues;
  $('enter-btn').textContent = scanningId ? '⌨ Enter a sheet pro#' : tab === 'lookup' ? '⌨ Look up a pro#' : '⌨ Enter a pallet pro#';
  $('tab-lookup').hidden = tab !== 'lookup';

  renderStacks(st);
  if (scanningId) renderStackScan();
  renderPallets(st);
  renderCheck(st);
  renderLookup();
}

// ---------- Stops: look up any pro#'s address, on a route or not ----------
let lookupQuery = '';
let lookupFilter = 'all'; // 'all', 'route', 'off', or a day like '2026-11-16'
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayName = (key) => {
  if (key === dayKey(Date.now())) return 'Today';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
};
function renderLookup() {
  if (tab !== 'lookup') return;
  const q = lookupQuery;
  $('lookup-q').innerHTML = q ? `${esc(q)} <button class="clear-q" id="clear-q">✕ Clear</button>` : 'Scan or tap ⌨ to search a pro#';
  $('lookup-q').classList.toggle('empty', !q);
  if (q) $('clear-q').onclick = () => { lookupQuery = ''; render(); };

  const book = addressBook(state.drivers, state.pool);
  const days = [...new Set(book.filter((r) => r.at).map((r) => dayKey(r.at)))].sort().reverse();
  if (!['all', 'route', 'off', 'noaddr'].includes(lookupFilter) && !days.includes(lookupFilter)) lookupFilter = 'all';
  const chips = [['all', `All ${book.length}`], ...days.map((k) => [k, dayName(k)]), ['route', 'On a route'], ['noaddr', 'No address'], ['off', 'Not on a route']];
  $('lookup-filters').innerHTML = chips.map(([k, t]) => `<button class="chip ${lookupFilter === k ? 'on' : ''}" data-f="${k}">${esc(t)}</button>`).join('');
  $('lookup-filters').querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { lookupFilter = b.dataset.f; renderLookup(); }; });
  const keep = (r) => lookupFilter === 'all' || (lookupFilter === 'noaddr' ? !!r.driver && !r.name && !r.street : lookupFilter === 'route' ? !!r.driver : lookupFilter === 'off' ? !r.driver : r.at && dayKey(r.at) === lookupFilter);

  if (!book.length) {
    $('lookup-list').innerHTML = '<div class="empty">No stops yet. Take manifest photos or scan stacks on the Stacks tab.</div>';
    return;
  }
  const found = q ? lookupAddress(state.drivers, state.pool, q, 50).filter(keep) : book.filter(keep).slice(0, 400);
  if (!found.length) {
    $('lookup-list').innerHTML = q && norm(q).length < 3 ? '<div class="empty">Keep typing…</div>'
      : q ? `<div class="msg bad">No address saved for <b>${esc(q)}</b>${lookupFilter === 'all' ? '' : ' with this filter'}.</div>` : '<div class="empty">No stops for this filter.</div>';
    return;
  }
  $('lookup-list').innerHTML = (q ? '' : `<div class="hint small-hint">${found.length} stop${found.length === 1 ? '' : 's'}</div>`) + found.map((r) => {
    const route = r.driver
      ? `<span class="tag" style="background:${colorOf(r.driver)[0]}">${esc(label(r.driver))} · stop ${r.index + 1}</span>`
      : '<span class="tag off">Not on a route</span>';
    const close = r.rank === 1 ? '<div class="addr warn">One digit off from what you entered</div>' : '';
    const old = r.at && dayKey(r.at) !== dayKey(Date.now()) ? `<div class="addr muted">From ${new Date(r.at).toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })}</div>` : '';
    const tap = r.driver ? ` data-open="${esc(r.driver.id)}:${r.index}"` : '';
    return `<div class="look ${q && r.rank === 0 ? 'best' : ''}"${tap}><div class="look-top"><span class="pro">${esc(r.pro)}${r.alt ? ` <span class="muted">· ${esc(r.alt)}</span>` : ''}</span>${route}</div>
      ${r.name || r.street ? `<div class="look-name">${esc(r.name)}</div><div>${esc(r.street)}</div><div>${esc(r.city)}</div>` : '<div class="muted">No address yet · tap to type it</div>'}${close}${old}</div>`;
  }).join('');
  $('lookup-list').querySelectorAll('[data-open]').forEach((el) => { el.onclick = () => { const [id, i] = el.dataset.open.split(':'); openEdit(id, Number(i)); }; });
}

function renderStacks(st) {
  const n = state.pool?.length || 0;
  $('manifest-photo').textContent = readingManifests ? `⏳ Reading ${readingManifests} manifest${readingManifests === 1 ? '' : 's'}… tap to add another` : '📷 Manifest photo · addresses for every stop';
  const today = (state.pool || []).filter((r) => (r.at || 0) >= state.startedAt).length;
  const older = n - today;
  $('pool-status').textContent = n
    ? `Address pool: ${today} pro#s from today's manifest${older ? `, ${older} kept from the last ${KEEP_DAYS} days` : ''}. Add more pages any time.`
    : 'Snap each manifest page once. Stops fill in their address by pro#.';
  renderPages();
  const noAddr = state.drivers.reduce((n, d) => n + d.stops.filter((s) => !s.addr?.name).length, 0);
  $('no-addr').hidden = !noAddr;
  $('no-addr').textContent = `⚠ ${noAddr} stop${noAddr === 1 ? '' : 's'} on a run ${noAddr === 1 ? 'has' : 'have'} no address · see which`;
  $('new-day').textContent = 'Start a new day';
  // Regular drivers first (in roster order, even before a stack is scanned), then anyone else added today.
  const names = [...ROSTER];
  for (const d of state.drivers) if (!names.some((n) => sameName(n, d.name))) names.push(d.name);
  $('stacks-list').innerHTML = names.map((name) => {
    const runs = runsOf(name);
    const i = rosterIndex(name);
    const [c, cname] = runs[0] ? colorOf(runs[0]) : COLORS[i >= 0 ? i : 0];
    if (!runs.length) {
      return `<button class="driver todo" data-name="${esc(name)}" data-run="1"><span class="stripe" style="background:${c}"></span>
        <span class="info"><span class="name">${esc(name)}</span><br><span class="meta">Tap to scan Run 1</span></span><span class="go">›</span></button>`;
    }
    const chips = runs.map((d) => {
      const have = d.stops.filter((s) => st.scanned.has(norm(s.pro))).length;
      const pal = state.pallets.length && d.stops.length ? ` · ${have}/${d.stops.length} ✓` : '';
      return `<button class="run" data-name="${esc(name)}" data-run="${d.run || 1}"><b>Run ${d.run || 1}</b><span>${readingStacks.has(d.id) ? '⏳ reading photo' : `${d.stops.length} stop${d.stops.length === 1 ? '' : 's'}${pal}`}</span></button>`;
    }).join('');
    const next = Math.max(...runs.map((d) => d.run || 1)) + 1;
    return `<div class="driver"><span class="stripe" style="background:${c}"></span>
      <div class="info"><span class="name">${esc(name)}</span> <span class="meta">${cname}</span>
      <div class="runs">${chips}<button class="run add" data-name="${esc(name)}" data-run="${next}">+ Run ${next}</button></div></div></div>`;
  }).join('');
  $('stacks-list').querySelectorAll('[data-run]').forEach((b) => { b.onclick = () => startDriver(b.dataset.name, Number(b.dataset.run)); });
}

function renderStackScan() {
  const d = driverById(scanningId);
  if (!d) { scanningId = null; return; }
  const [c] = colorOf(d);
  $('stack-head').style.background = c;
  $('stack-head').innerHTML = `${esc(d.name)} · Run ${d.run || 1}<small>${d.stops.length} stop${d.stops.length === 1 ? '' : 's'} scanned</small>`;
  $('stack-hint').textContent = d.stops.length
    ? 'Keep going down the stack. Next sheet is stop ' + (d.stops.length + 1) + '.'
    : 'Scan the TOP sheet first. That is stop 1.';
  $('stack-delete').textContent = 'Delete this stack';
  const reading = readingStacks.has(d.id);
  $('stack-photo').disabled = reading;
  $('stack-photo').textContent = reading ? '⏳ Reading this stack photo… tap Done and keep going' : '📷 Photo of the whole stack · fill in addresses';
  $('stack-stops').innerHTML = d.stops.map((s, i) => `<li><span class="num">${i + 1}</span><span class="pro"><button class="pro-edit" data-edit="${i}" aria-label="Edit pro number">${esc(s.pro)} <span class="pencil">✎</span></button>${addrHtml(s)}</span>${
    s.photo ? `<img class="thumb" data-photo="${esc(s.pro)}" data-view="${esc(s.pro)}" alt="Address photo">`
      : `<button class="snap-sm" data-snap="${esc(s.pro)}" aria-label="Take address photo">📷</button>`
  }<button class="x" data-i="${i}" aria-label="Remove">✕</button></li>`).reverse().join('');
  $('stack-stops').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openEdit(d.id, Number(b.dataset.edit)); });
  $('stack-stops').querySelectorAll('[data-snap]').forEach((b) => { b.onclick = () => takePhoto(b.dataset.snap); });
  $('stack-stops').querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => showPhoto(b.dataset.view); });
  fillPhotos($('stack-stops'));
  wireRetry($('stack-stops'));
  $('stack-stops').querySelectorAll('.x').forEach((b) => {
    b.onclick = () => { const s = d.stops.splice(Number(b.dataset.i), 1)[0]; if (s.photo) deletePhoto(norm(s.pro)).catch(() => {}); save(); toast(`Removed ${s.pro}`); render(); };
  });
}

function renderPallets(st) {
  const el = $('result');
  const r = lastResult;
  if (!r) {
    el.className = 'result idle';
    el.style.background = '';
    el.innerHTML = state.drivers.length
      ? '<div class="r-big">Scan a pallet</div><div class="r-mid">Pull the trigger on the pro# sticker</div>'
      : '<div class="r-big">No stacks yet</div><div class="r-mid">Scan the drivers\' paper stacks first (Stacks tab)</div>';
  } else if (r.ok && driverById(r.driverId)) {
    const d = driverById(r.driverId);
    const [c, cname] = colorOf(d);
    const index = Math.max(0, d.stops.findIndex((s) => norm(s.pro) === norm(r.pro)));
    const info = loadInfo(index, d.stops.length);
    el.className = 'result r-pop';
    el.style.background = c;
    el.innerHTML = `<div class="r-color">${cname}</div><div class="r-name">${esc(d.name)}</div>
      ${multiRun(d) ? `<div class="r-run">RUN ${d.run || 1}</div>` : ''}
      <div class="r-big">Stop ${info.stop} of ${info.total}</div>
      <div class="r-mid">${info.where}</div>
      <div class="r-small">${esc(r.code)}${r.count > 1 ? ` · pallet #${r.count} for this pro` : ''}</div>
      ${d.stops[index] ? addrHtml(d.stops[index], true) : ''}
      ${d.stops[index]?.photo ? `<img class="r-photo" data-photo="${esc(d.stops[index].pro)}" data-view="${esc(d.stops[index].pro)}" alt="Address photo">` : ''}`;
    el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => showPhoto(b.dataset.view); });
    fillPhotos(el);
    wireRetry(el);
  } else {
    el.className = 'result bad r-pop';
    el.style.background = '';
    const a = r.addr;
    el.innerHTML = `<div class="r-big">✕ NOT ON A RUN</div><div class="r-mid">${esc(r.code)}</div>${a
      ? `<div class="r-addr"><b>${esc(a.name)}</b><br>${esc(a.street || '')}<br>${esc(a.city || '')}</div><div class="r-small">Address from the manifest${a.at ? ` (${new Date(a.at).toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })})` : ''}${a.pro && norm(a.pro) !== norm(r.code) ? ` · pro ${esc(a.pro)}` : ''}</div>`
      : '<div class="r-small">No address saved for it. Set it aside and check the paperwork.</div>'}`;
  }
  // restart the pop animation
  void el.offsetWidth;

  $('pallet-summary').textContent = st.total
    ? `${st.have} of ${st.total} stops have a pallet${st.unknown ? ` · ${st.unknown} not in any stack` : ''}` : '';
  const recent = state.pallets.slice(-8).reverse();
  $('recent').innerHTML = recent.map((p) => {
    const d = p.driverId && driverById(p.driverId);
    const i = d ? d.stops.findIndex((s) => norm(s.pro) === norm(p.pro)) : -1;
    const where = d ? `${esc(label(d))}${i >= 0 ? ` · stop ${i + 1}` : ''}` : '<span class="miss">Not in any stack</span>';
    return `<li><span class="dot" style="background:${d ? colorOf(d)[0] : '#d32f2f'}"></span><span class="pro">${esc(p.code)}</span><span>${where}</span></li>`;
  }).join('');
}

function renderCheck(st) {
  const out = [];
  if (!state.drivers.length) {
    $('check').innerHTML = '<div class="empty">Nothing to check yet.</div>';
    return;
  }
  if (st.total && st.have === st.total && !st.unknown) out.push('<div class="all-good">✓ Every stop has a pallet</div>');

  const unknown = state.pallets.filter((p) => !p.driverId);
  if (unknown.length) {
    out.push(`<div class="check-group"><h3 style="background:#8e1414"><span>Pallets not in any stack</span><span>${unknown.length}</span></h3><ul>${
      unknown.map((p) => `<li><span class="pro">${esc(p.code)}</span><span>${timeOf(p.at)} <button class="x" data-del="${p.at}" aria-label="Clear">✕</button></span></li>`).join('')}</ul></div>`);
  }
  const sorted = [...state.drivers].sort((a, b) => a.name.localeCompare(b.name) || (a.run || 1) - (b.run || 1));
  for (const d of sorted) {
    const [c] = colorOf(d);
    const counts = new Map();
    for (const p of state.pallets) if (p.pro) counts.set(norm(p.pro), (counts.get(norm(p.pro)) || 0) + 1);
    const missing = d.stops.filter((s) => !counts.get(norm(s.pro))).length;
    out.push(`<div class="check-group"><h3 style="background:${c}"><span>${esc(label(d))}</span><span>${missing ? `${missing} missing` : '✓ all here'}</span></h3><ul>${
      d.stops.map((s, i) => {
        const n = counts.get(norm(s.pro)) || 0;
        return `<li><span>${i + 1}. <span class="pro">${esc(s.pro)}</span>${s.addr?.name ? ` <span class="muted">${esc(s.addr.name)}</span>` : ''}${s.photo ? ` <button class="snap-sm" data-view="${esc(s.pro)}" aria-label="Show address photo">🖼</button>` : ''}</span>${n ? `<span class="ok">✓ ${n > 1 ? `${n} pallets` : 'pallet'}</span>` : '<span class="miss">no pallet yet</span>'}</li>`;
      }).join('') || '<li>No sheets scanned</li>'}</ul></div>`);
  }
  $('check').innerHTML = out.join('');
  $('check').querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => showPhoto(b.dataset.view); });
  $('check').querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => { state.pallets = state.pallets.filter((p) => String(p.at) !== b.dataset.del || p.driverId); save(); render(); };
  });
}

// When a stack changes, an earlier "not in any stack" pallet may now match: re-check them.
function rematch() {
  let changed = false;
  for (const p of state.pallets) {
    const hit = findStop(state.drivers, p.code);
    const id = hit?.driver.id || null;
    const pro = hit ? hit.driver.stops[hit.index].pro : null;
    if (id !== p.driverId || pro !== p.pro) { p.driverId = id; p.pro = pro; changed = true; }
  }
  if (changed) save();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/pallets/sw.js', { scope: '/pallets/' }).catch(() => {});
keepAwake();
render();
syncNow();
