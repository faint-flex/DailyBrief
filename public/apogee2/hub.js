// Apogee 2.0: the Base map as the main hub (step 1).
// - Tapping a building shows buttons that open its panel (hangar -> rockets, pad -> launch, lab -> research...).
// - A shortcut bar on the Base map opens the same panels.
// - Panels open in a drawer over the map (right side on PC, bottom sheet on phone), so you never leave the Base.
//   Halo and Voltline still switch to their own tab (they have their own full-screen views).
// game.js asks drawer()/sync() in refresh() and calls decorate() after the Base renders.
// Exposes window.APOGEE_HUB.
(function () {
  'use strict';
  const G = () => window.APOGEE_GAME;
  const DRAWER_TABS = ['ops', 'contracts', 'hangar', 'research'];
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
    wrap.innerHTML = '<div class="hub-dbar"><button class="btn sm" data-hub-close aria-label="Back to the Base map">✕ Back to Base</button><b class="hub-dtitle"></b></div><div class="hub-dslot"></div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function sectionOf(t) { return document.getElementById('tab-' + t); }

  function openPanel(t) {
    const g = G(); if (!g) return;
    if (!DRAWER_TABS.includes(t)) { close(true); g.goTab(t); return; } // Halo / Voltline: own full tab
    close(true);
    const w = ensureWrap(), sec = sectionOf(t);
    if (!sec) return;
    open = t;
    w.querySelector('.hub-dtitle').textContent = `${PANELS[t].icon} ${PANELS[t].name}`;
    w.querySelector('.hub-dslot').appendChild(sec);
    w.hidden = false;
    document.body.classList.add('hub-on');
    if (g.goTab) g.goTab('base'); // stay on the Base; refresh() renders the drawer too
    w.querySelector('.hub-dslot').scrollTop = 0;
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
    if (open === p) close(); else openPanel(p);
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    const sw = document.getElementById('sheet-wrap');
    if (sw && !sw.hidden) return; // a sheet is open: let it close first
    const fl = document.getElementById('flight');
    if (fl && !fl.hidden) return;
    close();
  });

  window.APOGEE_HUB = { open: openPanel, close, drawer, sync, decorate, buildingButtons, PANELS };
})();
