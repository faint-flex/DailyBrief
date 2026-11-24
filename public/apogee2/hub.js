// Apogee 2.0: the Base map as the main hub (step 1).
// - Tapping a building shows buttons that open its panel (hangar -> rockets, pad -> launch, lab -> research...).
// - A shortcut bar on the Base map opens the same panels.
// - Every panel opens over the map (a side drawer on PC, a full page on phone), so you never leave the Base.
//   The old tab bars are hidden; the shortcut bar is the menu. Keys 1-7 still work.
// - game.js refresh(): any code that switches to another tab is turned into "open that panel over the Base"
//   (take()), so every button in the game lands in the drawer. It renders the drawer via drawer()/sync().
// Exposes window.APOGEE_HUB.
(function () {
  'use strict';
  const G = () => window.APOGEE_GAME;
  const DRAWER_TABS = ['ops', 'contracts', 'hangar', 'research', 'network', 'ventures'];
  const WIDE = ['network', 'ventures']; // big dashboards get a wider drawer on PC
  const PANELS = {
    ops: { icon: '🚀', name: 'Launch', sub: 'Rockets, weather and the launch pad' },
    contracts: { icon: '📋', name: 'Contracts', sub: 'Jobs to fly' },
    hangar: { icon: '🛠️', name: 'Hangar', sub: 'Design and build rockets' },
    research: { icon: '🔬', name: 'Research', sub: 'Unlock new tech' },
    network: { icon: '🛰️', name: 'Halo', sub: 'Satellite internet' },
    ventures: { icon: '🚗', name: 'Voltline', sub: 'Electric cars' },
  };
  // Which panels each building opens. First one is the main (big) button.
  const BY_BUILDING = {
    pad: ['ops', 'contracts'], mc: ['contracts', 'ops'], factory: ['hangar'], office: ['research', 'hangar'],
    lab: ['research'], test: ['ops'], lz: ['hangar'], port: ['hangar'], tower: ['hangar'], tank: ['ops'],
    satfab: ['network'], ground: ['network'], visitor: ['contracts'],
  };
  let open = null, wrap = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function ensureWrap() {
    if (wrap) return wrap;
    wrap = document.createElement('aside');
    wrap.id = 'hub-drawer'; wrap.className = 'hub-drawer'; wrap.hidden = true;
    wrap.setAttribute('aria-label', 'Panel');
    wrap.innerHTML = '<div class="hub-dbar"><button class="btn sm" data-hub-close aria-label="Back to the Base map">✕ Base</button><nav class="hub-dtabs" aria-label="Panels"></nav></div><div class="hub-dslot"></div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function sectionOf(t) { return document.getElementById('tab-' + t); }

  // Is hub mode on? (needs the Base map)
  function on() {
    const g = G(), s = g && g.state;
    const ok = !!(s && s.campus && window.APOGEE_CAMPUS);
    document.body.classList.toggle('hub-mode', ok);
    if (ok) setTop();
    return ok;
  }
  function setTop() {
    const top = document.querySelector('.top');
    const h = top ? Math.round(top.getBoundingClientRect().height) : 64;
    if (h !== setTop.h) { setTop.h = h; document.documentElement.style.setProperty('--hub-top', h + 'px'); }
  }

  // Put tab t's section into the drawer (no refresh; game.js refresh() calls this, then renders it).
  function take(t) {
    if (!DRAWER_TABS.includes(t)) return false;
    if (open === t) return true;
    close(true);
    const w = ensureWrap(), sec = sectionOf(t);
    if (!sec) return false;
    open = t;
    // Panel switcher inside the drawer (the selected one is marked with ✓ and an underline, not just colour)
    w.querySelector('.hub-dtabs').innerHTML = DRAWER_TABS.map((k) => `<button class="hub-dt ${k === t ? 'on' : ''}" data-hub="${k}" ${k === t ? 'aria-current="page"' : ''} title="${esc(PANELS[k].name)}"><span aria-hidden="true">${PANELS[k].icon}</span><i>${PANELS[k].name}</i></button>`).join('');
    w.querySelector('.hub-dslot').appendChild(sec);
    w.classList.toggle('wide', WIDE.includes(t));
    w.hidden = false;
    document.body.classList.add('hub-on');
    w.querySelector('.hub-dslot').scrollTop = 0;
    return true;
  }
  function openPanel(t) {
    const g = G(); if (!g) return;
    g.goTab(t); // refresh() turns this into the drawer
  }

  // quiet = don't refresh (used when the game itself is switching tabs)
  function close(quiet) {
    if (!open) return;
    const sec = sectionOf(open), main = document.getElementById('main');
    if (sec && main) { sec.classList.remove('on'); main.appendChild(sec); }
    open = null;
    if (wrap) wrap.hidden = true;
    document.body.classList.remove('hub-on');
    if (!quiet && G()) G().refresh();
  }

  function drawer() { return open; }
  function sync() { const sec = open && sectionOf(open); if (sec) sec.classList.add('on'); }

  // Shortcut bar on top of the Base map.
  function decorate(el) {
    if (!el) return;
    on();
    let bar = el.querySelector('.hub-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'hub-bar';
      el.insertBefore(bar, el.firstChild);
    }
    const s = G() && G().state;
    const html = ['ops', 'contracts', 'hangar', 'research', 'network', 'ventures'].map((t) => {
      const P = PANELS[t];
      return `<button class="hub-chip ${open === t ? 'on' : ''}" data-hub="${t}" title="${esc(P.sub)}"><span aria-hidden="true">${P.icon}</span>${P.name}${open === t ? ' ✓' : ''}</button>`;
    }).join('');
    const tip = s && !(s.hubTip) ? '<div class="hub-tip small">🏠 Your Base is the hub: tap a building, or use these buttons, to open its panel.</div>' : '';
    if (bar._h !== html + tip) { bar.innerHTML = html + tip; bar._h = html + tip; }
  }

  // Buttons for a selected building (campus.js buildingHTML).
  function buildingButtons(st, b) {
    const list = BY_BUILDING[b.type];
    if (!list || !b.lvl) return '';
    return list.map((t, i) => `<button class="btn ${i === 0 ? 'primary' : ''} sm" data-hub="${t}">${PANELS[t].icon} Open ${PANELS[t].name}</button>`).join('');
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-hub],[data-hub-close]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.hasAttribute('data-hub-close')) { close(); return; }
    const p = t.getAttribute('data-hub');
    const s = G() && G().state; if (s && !s.hubTip) s.hubTip = 1;
    if (open === p) { if (!t.classList.contains('hub-dt')) close(); } else openPanel(p);
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === '5' && open && !(e.target && e.target.tagName === 'INPUT')) { close(); return; } // 5 = Base
    if (e.key !== 'Escape' || !open) return;
    const sw = document.getElementById('sheet-wrap');
    if (sw && !sw.hidden) return; // a sheet is open: let it close first
    const fl = document.getElementById('flight');
    if (fl && !fl.hidden) return;
    close();
  });

  window.addEventListener('resize', () => { if (document.body.classList.contains('hub-mode')) setTop(); });
  window.APOGEE_HUB = { open: openPanel, close, drawer, sync, decorate, buildingButtons, on, take, PANELS };
})();
