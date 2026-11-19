// Pallet Router: scan each driver's paper stack (top sheet = stop 1), then scan
// pallet stickers to see which driver and stop they belong to.
// Everything is kept on this phone (localStorage). Works with a Bluetooth
// scanner (it types like a keyboard and presses Enter) or the phone camera.
import { norm, findStop, findExact, loadInfo } from './match.js';
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
function blank() {
  return { startedAt: Date.now(), drivers: [], pallets: [], recentNames: load()?.recentNames || [] };
}
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
let state = load() || blank();
for (const d of state.drivers) if (rosterIndex(d.name) >= 0) d.colorIndex = rosterIndex(d.name); // keep roster colors fixed
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Could not save on this phone'); }
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
    if (buffer.length >= 3) { e.preventDefault(); handleScan(buffer); }
    buffer = '';
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buffer += e.key;
});

$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('manual-input').value.trim();
  $('manual-input').value = '';
  if (v) handleScan(v);
});

function handleScan(raw) {
  const code = String(raw).trim();
  if (norm(code).length < 3) return;
  if (scanningId) stackScan(code);
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
      if (out.pro && norm(out.pro).length >= 6 && norm(out.pro) !== norm(pro)) addr.check = out.pro;
    }
  } catch { /* offline: leave it as failed, tap to retry */ }
  stopsFor(pro).forEach((s) => { s.addr = addr; });
  save(); render();
}
function addrHtml(s, big = false) {
  const a = s.addr;
  if (!a) return '';
  if (a.status === 'reading') return '<div class="addr muted">Reading address…</div>';
  if (a.status === 'failed') return `<div class="addr muted"><button class="retry" data-retry="${esc(s.pro)}">Couldn't read it · tap to retry</button></div>`;
  const warn = a.check ? `<div class="addr warn">⚠ Photo shows pro ${esc(a.check)}. Right sheet?</div>` : '';
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
    $('viewer').hidden = false;
  });
}
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
  if (Date.now() - newDayArmed > 3000) { newDayArmed = Date.now(); $('new-day').textContent = 'Tap again to clear all stacks and pallets'; return; }
  state = blank(); save(); lastResult = null; clearPhotos().catch(() => {}); render(); toast('New day started');
};

// ---------- pallets ----------
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
    lastResult = { ok: false, code };
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
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('tab-stacks').hidden = !(tab === 'stacks' && !scanningId);
  $('tab-stack-scan').hidden = !(tab === 'stacks' && scanningId);
  $('tab-pallets').hidden = tab !== 'pallets';
  $('tab-check').hidden = tab !== 'check';

  const st = stopsStatus();
  $('status').textContent = state.drivers.length
    ? `${state.drivers.length} drivers · ${st.total} stops` : `Started ${timeOf(state.startedAt)}`;
  const issues = (st.total - st.have) + st.unknown;
  $('check-badge').hidden = !(state.pallets.length && issues);
  $('check-badge').textContent = issues;
  $('manual-input').placeholder = scanningId ? 'Type a sheet pro#' : 'Type a pallet pro#';

  renderStacks(st);
  if (scanningId) renderStackScan();
  renderPallets(st);
  renderCheck(st);
}

function renderStacks(st) {
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
      return `<button class="run" data-name="${esc(name)}" data-run="${d.run || 1}"><b>Run ${d.run || 1}</b><span>${d.stops.length} stop${d.stops.length === 1 ? '' : 's'}${pal}</span></button>`;
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
  $('stack-stops').innerHTML = d.stops.map((s, i) => `<li><span class="num">${i + 1}</span><span class="pro">${esc(s.pro)}${addrHtml(s)}</span>${
    s.photo ? `<img class="thumb" data-photo="${esc(s.pro)}" data-view="${esc(s.pro)}" alt="Address photo">`
      : `<button class="snap-sm" data-snap="${esc(s.pro)}" aria-label="Take address photo">📷</button>`
  }<button class="x" data-i="${i}" aria-label="Remove">✕</button></li>`).reverse().join('');
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
    el.innerHTML = `<div class="r-big">✕ NOT IN ANY STACK</div><div class="r-mid">${esc(r.code)}</div><div class="r-small">Set it aside and check the paperwork</div>`;
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
