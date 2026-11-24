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
    wrap.innerHTML = '<div class="hub-dbar"><button class="btn sm" data-hub-close aria-label="Back to the Base map">✕ Back to Base</button><b class="hub-dtitle"></b></div><div class="hub-dslot"></div>';
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
    const fresh = !open;
    detach();
    const w = ensureWrap(), sec = sectionOf(t);
    if (!sec) return false;
    open = t;
    // Panel switcher inside the drawer (the selected one is marked with ✓ and an underline, not just colour)
    w.querySelector('.hub-dtitle').textContent = `${PANELS[t].icon} ${PANELS[t].name}`; // the tab bar is the menu (Venom: keep the tabs)
    w.querySelector('.hub-dslot').appendChild(sec);
    w.classList.toggle('wide', WIDE.includes(t));
    w.hidden = false;
    if (fresh && !(history.state && history.state.hubPanel)) { try { history.pushState({ hubPanel: 1 }, ''); } catch (e) { /* ignore */ } }
    document.body.classList.add('hub-on');
    w.querySelector('.hub-dslot').scrollTop = 0;
    return true;
  }
  function openPanel(t) {
    const g = G(); if (!g) return;
    g.goTab(t); // refresh() turns this into the drawer
  }

  // quiet = don't refresh (used when the game itself is switching tabs)
  // Put the open panel's section back in <main> (used when switching panels).
  function detach() {
    if (!open) return;
    const sec = sectionOf(open), main = document.getElementById('main');
    if (sec && main) { sec.classList.remove('on'); main.appendChild(sec); }
    open = null;
  }
  // Close the drawer and go back to the Base. quiet = don't refresh (the game is refreshing anyway).
  function close(quiet, fromPop) {
    if (!open) return;
    detach();
    if (wrap) wrap.hidden = true;
    document.body.classList.remove('hub-on');
    // Phone Back: an open panel has its own history entry; drop it when the panel closes some other way.
    if (!fromPop && history.state && history.state.hubPanel) { skipPop = true; try { history.back(); } catch (e) { skipPop = false; } }
    if (!quiet && G()) G().refresh();
  }
  let skipPop = false;
  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (open) close(false, true); // Back button / swipe-back closes the panel instead of leaving the game
  });

  function drawer() { return open; }
  function sync() { const sec = open && sectionOf(open); if (sec) sec.classList.add('on'); }

  // Shortcut bar on top of the Base map.
  // The Base used to get its own row of panel buttons; the normal tab bar does that job now (Venom/LyFe: keep the tabs).
  function decorate(el) {
    if (!el) return;
    on();
    const bar = el.querySelector('.hub-bar'); if (bar) bar.remove();
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
