// Engines & boosters feature: editor helpers for the new engines and the solid strap-on side boosters.
// The maths lives in sim.js (ENGINES, FUELS, SRBS, srbOf); the looks in draw.js, 3d-rocket.js and 3d-fx.js.
// Exposes window.APOGEE_ENGINES.
(function () {
  'use strict';
  const S = window.APOGEE_SIM;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One short plain-English line per engine, shown under the engine buttons.
  const NOTES = {
    ember: 'Simple and cheap. A good first engine.',
    emberv: 'Ember with a big nozzle for space.',
    comet: 'Twice the push of Ember, more efficient.',
    cometv: 'Comet with a big nozzle for space.',
    nova: 'Huge thrust, top efficiency, cheap.',
    novav: 'Nova with a big nozzle for space.',
    spark: 'Tiny and very cheap. Tanks are heavy (pressure-fed). Good for small top stages.',
    frost: 'Most efficient, but low thrust and pricey. Hydrogen tanks are big and heavy.',
    forge: 'One Forge does the work of 8 Embers. Fewer engines, so no spare if one fails.',
    zephyr: 'Aerospike: efficient at every height. A little less reliable.',
  };
  // Fuel tag with a text cue (never colour alone).
  const FUEL_TAG = { Kerosene: '🟠 Kerosene', Methane: '🔵 Methane', Hydrogen: '❄️ Hydrogen', Hypergolic: '🧪 Storable' };

  function engineNote(id) {
    const e = S.ENGINES[id];
    if (!e) return '';
    return NOTES[id] || '';
  }
  function fuelTag(fuel) { return FUEL_TAG[fuel] || fuel; }

  function srbUnlocked(techs) { return Object.keys(S.SRBS).filter((k) => S.has(techs, S.SRBS[k].tech)); }

  // Short label for the Hangar card, e.g. " + 4× Flint".
  function srbLabel(design) {
    const b = S.srbOf(design);
    return b ? ` + ${b.count}× ${b.spec.name} side boosters` : '';
  }

  // The side booster block in the rocket editor (goes right under stage 1).
  function srbEditorHtml(design, techs, money) {
    const types = srbUnlocked(techs);
    const cur = design.srb || { type: types[0] || 'small', count: 0 };
    if (!types.length && !cur.count) {
      return `<p class="small dim srb-lock">🔒 Side boosters: research <b>${esc(S.TECHS.srb.name)}</b> (🔬 Research).</p>`;
    }
    const b = S.srbOf(design);
    let html = `<div class="stage srb"><div class="st-head"><b>Side boosters · solid</b><span class="small dim">burn with stage 1, then drop off</span></div>`;
    html += `<div class="seg srb-seg" role="group" aria-label="Number of side boosters">${S.SRB_COUNTS.map((n) => `<button data-act="ed-srb-n" data-id="${n}" class="${(cur.count || 0) === n ? 'on' : ''}" ${n && !types.length ? 'disabled' : ''}>${n === 0 ? 'None' : n}</button>`).join('')}</div>`;
    if (cur.count) {
      html += `<div class="seg srb-seg" role="group" aria-label="Side booster size" style="margin-top:8px">${Object.keys(S.SRBS).map((k) => {
        const sp = S.SRBS[k], ok = S.has(techs, sp.tech);
        return `<button data-act="ed-srb-t" data-id="${k}" class="${cur.type === k ? 'on' : ''}" ${ok ? '' : 'disabled'}>${k === 'small' ? 'Small' : 'Large'} · ${esc(sp.name)}${ok ? '' : ' 🔒'}</button>`;
      }).join('')}</div>`;
    }
    if (b) {
      html += `<div class="small dim" style="margin-top:6px">${b.count}× ${esc(b.spec.name)} · ${Math.round(b.thrust).toLocaleString()} kN together · burns ${Math.round(b.burn)} s · ${money(b.cost)} a flight</div>`;
      html += `<div class="small dim">Thrown away every flight · launch odds ×${(b.rel * 100).toFixed(1)}%</div>`;
    } else {
      html += `<div class="small dim" style="margin-top:6px">Cheap extra push at liftoff. They can't be reused.</div>`;
    }
    return html + '</div>';
  }

  // Handles the editor buttons. Returns true when it changed the draft.
  function editorAct(act, id, design, techs) {
    const types = srbUnlocked(techs);
    if (act === 'ed-srb-n') {
      const n = +id;
      if (!S.SRB_COUNTS.includes(n)) return false;
      if (!n) { delete design.srb; return true; }
      const type = design.srb && types.includes(design.srb.type) ? design.srb.type : types[0];
      if (!type) return false;
      design.srb = { type, count: n };
      return true;
    }
    if (act === 'ed-srb-t') {
      if (!types.includes(id)) return false;
      design.srb = { type: id, count: (design.srb && design.srb.count) || 2 };
      return true;
    }
    return false;
  }

  window.APOGEE_ENGINES = { engineNote, fuelTag, srbEditorHtml, srbLabel, editorAct, srbUnlocked };
})();
