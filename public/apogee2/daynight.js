// Apogee 2.0: day and night.
// The game clock's fraction of a day (state.tod, 0..1, written by game.js) gives the time of day.
// Shown in the header as a sun/moon + hour, on the launch sheet, and used by world3d.js to light
// launches: night = dark sky, stars, dim moonlight, warm pad floodlights, glowing exhaust.
// Exposes window.APOGEE_DAYNIGHT.
(function () {
  'use strict';
  const G = () => window.APOGEE_GAME;
  const st = () => { const g = G(); return g && g.state; };

  function hourOf(s) { const f = s && typeof s.tod === 'number' ? s.tod : 0.4; return ((f * 24) + 6) % 24; } // day starts at 6 AM
  // 0 = full day, 1 = full night, smooth at dawn (5-7) and dusk (18-20)
  function nightOf(h) {
    if (h >= 7 && h <= 18) return 0;
    if (h > 18 && h < 20) return (h - 18) / 2;
    if (h > 5 && h < 7) return 1 - (h - 5) / 2;
    return 1;
  }
  function phase(h) {
    const n = nightOf(h);
    if (n >= 1) return { icon: '🌙', word: 'Night' };
    if (n <= 0) return { icon: '☀️', word: 'Day' };
    return h < 12 ? { icon: '🌅', word: 'Dawn' } : { icon: '🌇', word: 'Dusk' };
  }
  function clockText(h) { const hh = Math.floor(h); const ap = hh < 12 ? 'AM' : 'PM'; return `${(hh % 12) || 12} ${ap}`; }

  // Header: small "☀️ Day · 2 PM" next to the day number.
  let lastTxt = '';
  function header() {
    const s = st(); if (!s) return;
    let el = document.getElementById('s-tod');
    if (!el) {
      const d = document.getElementById('s-day'); if (!d) return;
      el = document.createElement('small'); el.id = 's-tod'; el.className = 'dn-tod';
      d.parentNode.appendChild(el);
    }
    const h = hourOf(s), p = phase(h), txt = `${p.icon} ${clockText(h)}`;
    if (txt !== lastTxt) { el.textContent = txt; el.title = `${p.word}, ${clockText(h)}`; lastTxt = txt; }
  }

  // Launch sheet line.
  function sheetLine(s) {
    const h = hourOf(s), n = nightOf(h), p = phase(h);
    const what = n >= 1 ? 'Night launch: dark sky, pad floodlights and a bright exhaust glow.' : n > 0 ? `${p.word} launch: the sky is changing colour.` : 'Day launch.';
    return `<p class="small" style="margin:6px 0 0">${p.icon} <b>${clockText(h)}</b> · ${what} <span class="dim">No effect on the odds.</span></p>`;
  }

  // Used by world3d.js render(): how dark the low-altitude scene should be right now (0..1).
  function flightNight() { return nightOf(hourOf(st())); }

  window.APOGEE_DAYNIGHT = { hourOf, nightOf, phase, clockText, header, sheetLine, flightNight };
})();
