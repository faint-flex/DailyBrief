/* Apogee Ventures tab UI: Voltline Motors (cars) and Orbital Compute (space data center).
 * window.APOGEE_VENTURES_UI.render(el, G). Needs window.APOGEE_VENTURES. CSS classes prefixed vn-. */
(function (root) {
  'use strict';
  const VT = () => root.APOGEE_VENTURES;
  let view = 'ev';
  try { view = localStorage.getItem('apogee-vn-view') || 'ev'; } catch (e) { /* ignore */ }
  const ds = { type: 'sedan', battery: 75, price: 45, name: '' }; // designer state survives re-renders
  let launchN = 0;

  const CSS = `
.vn-wrap{--vn-gap:10px}
.vn-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:4px 2px 12px}
.vn-head h2{margin:0!important;flex:1}
.vn-seg{display:flex;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:3px;gap:3px}
.vn-seg button{background:none;border:0;padding:8px 14px;border-radius:9px;font-weight:700;color:var(--dim);font-size:14px;white-space:nowrap}
.vn-seg button[aria-pressed=true]{background:var(--panel2);color:var(--accent2);box-shadow:inset 0 -2px 0 var(--accent2)}
.vn-seg button[aria-pressed=true]::before{content:'● '}
.vn-total{font-size:13px;color:var(--dim)}
.vn-total b{color:var(--text)}
.vn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;margin-bottom:10px}
.vn-kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:9px 11px;min-width:0}
.vn-kpi small{display:block;color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vn-kpi b{font-size:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.vn-kpi em{display:block;font-style:normal;font-size:11.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vn-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}
.vn-cols3{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.vn-cols3>.card,.vn-cols>.card{margin-bottom:0}
.vn-sec{margin-top:16px}
.vn-sec>h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin:0 2px 8px;font-weight:700}
.vn-chart{width:100%;height:150px;display:block}
.vn-chartcap{display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:4px}
.vn-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vn-row .vn-grow{flex:1;min-width:0}
.vn-st{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid var(--line);background:var(--panel2);white-space:nowrap}
.vn-st.ok{color:var(--good);border-color:#1f5a45}
.vn-st.warn{color:var(--accent2);border-color:#6a4a1f;border-style:dashed}
.vn-st.bad{color:var(--bad);border-color:#6a2630;border-style:dotted;border-width:2px}
.vn-st.idle{color:var(--dim)}
.vn-model .vn-icon{font-size:28px;line-height:1;width:38px;text-align:center}
.vn-specs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px;font-size:12.5px}
.vn-specs div{background:var(--panel2);border-radius:8px;padding:5px 7px;min-width:0}
.vn-specs small{display:block;color:var(--dim);font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.vn-specs b{white-space:nowrap}
.vn-price{display:flex;align-items:center;gap:4px}
.vn-price .btn{padding:4px 9px;font-size:12px;border-radius:8px}
.vn-types{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
.vn-types button{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:13px;font-weight:600;color:var(--dim)}
.vn-types button[aria-pressed=true]{color:var(--text);border-color:var(--accent2);box-shadow:inset 0 0 0 1px var(--accent2)}
.vn-types button[aria-pressed=true]::after{content:' ✓'}
.vn-field{display:grid;grid-template-columns:92px 1fr 74px;gap:8px;align-items:center;margin:6px 0;font-size:13px}
.vn-field input[type=range]{width:100%;accent-color:var(--accent)}
.vn-field output{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
.vn-input{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 9px;font:inherit;width:100%}
.vn-stars{letter-spacing:1px;white-space:nowrap}
.vn-prog{height:8px;background:var(--panel2);border-radius:99px;overflow:hidden;margin-top:6px;border:1px solid var(--line)}
.vn-prog>i{display:block;height:100%;background:repeating-linear-gradient(45deg,var(--accent) 0 6px,var(--accent2) 6px 12px)}
.vn-small{font-size:12.5px;color:var(--dim)}
.vn-list{display:flex;flex-direction:column;gap:6px}
.vn-li{display:flex;gap:8px;align-items:center;background:var(--panel2);border-radius:10px;padding:7px 9px;font-size:13px}
.vn-li .vn-grow{flex:1;min-width:0}
.vn-lock{text-align:center;padding:22px 16px}
.vn-lock .vn-big{font-size:44px}
.vn-lock p{max-width:560px;margin:8px auto}
.vn-log{font-size:12.5px;color:var(--dim);max-height:200px;overflow:auto}
.vn-log div{padding:3px 0;border-bottom:1px solid var(--line)}
.vn-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
@media (max-width:760px){
 .vn-cols{grid-template-columns:1fr}
 .vn-cols3{grid-template-columns:1fr}
 .vn-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
 .vn-kpi b{font-size:16px}
 .vn-specs{grid-template-columns:repeat(2,minmax(0,1fr))}
 .vn-seg{width:100%}
 .vn-seg button{flex:1;padding:9px 6px;font-size:13px}
 .vn-chart{height:130px}
 .vn-field{grid-template-columns:78px 1fr 64px}
}`;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('vn-css')) return;
    const s = document.createElement('style'); s.id = 'vn-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // ---------- formatting
  const fm = (G, m) => (Math.abs(m) < 1 && m !== 0 ? `${m < 0 ? '−' : ''}$${Math.round(Math.abs(m) * 1000)}k` : G.money(m));
  const signed = (G, m) => `${m >= 0 ? '▲' : '▼'} ${fm(G, m)}`;
  const num = (n) => { n = Math.round(n); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString(); };
  const pct = (p) => Math.round(p * 100) + '%';
  const stars = (s) => { const f = Math.round(s); return '★'.repeat(f) + '☆'.repeat(5 - f) + ` ${s.toFixed(1)}`; };
  const st = (cls, icon, text) => `<span class="vn-st ${cls}">${icon} ${text}</span>`;
  const btn = (act, args, label, opts) => {
    opts = opts || {};
    return `<button class="btn sm${opts.primary ? ' primary' : ''}${opts.go ? ' go' : ''}" data-vn="${act}" data-args='${JSON.stringify(args || {}).replace(/'/g, '&#39;')}'${opts.disabled ? ' disabled' : ''}${opts.title ? ` title="${opts.title}"` : ''}>${label}</button>`;
  };
  const kpi = (label, val, sub) => `<div class="vn-kpi"><small>${label}</small><b>${val}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const prog = (f, text) => `<div class="vn-prog" role="progressbar" aria-valuenow="${Math.round(f * 100)}"><i style="width:${Math.round(Math.max(0, Math.min(1, f)) * 100)}%"></i></div><div class="vn-small">${text}</div>`;

  // ---------- render
  function render(el, G) {
    injectCss();
    const V = VT();
    if (!V) { el.innerHTML = '<div class="empty">Ventures module did not load.</div>'; return; }
    const state = G.state; V.ensure(state);
    const S = V.summary(state);
    if (!el.__vnBound) bind(el, G);
    el.__vnG = G;
    const key = [view, !!S.ev, !!S.dc, innerWidth < 760].join('|');
    if (el.__vnKey !== key || !el.querySelector('.vn-wrap')) {
      el.__vnKey = key;
      el.innerHTML = layout(S, G);
    }
    el.querySelector('[data-part=total]').innerHTML = totalLine(S, G);
    if (view === 'ev') {
      if (!S.ev) { el.querySelector('[data-part=lock]').innerHTML = lockEV(S, G); }
      else {
        part(el, 'ev-kpi', evKpis(S.ev, G));
        part(el, 'ev-models', evModels(S.ev, G));
        part(el, 'ev-fac', evFactories(S.ev, G, state));
        part(el, 'ev-res', research(S.ev, V.EV_RESEARCH, 'ev', G));
        updateDesigner(el, G);
        drawCharts(el, S.ev.history, 'cars', G);
      }
    } else {
      if (!S.dc) { el.querySelector('[data-part=lock]').innerHTML = lockDC(S, G); }
      else {
        part(el, 'dc-kpi', dcKpis(S.dc, G));
        part(el, 'dc-launch', dcLaunch(S.dc, G));
        part(el, 'dc-up', dcUpgrades(S.dc, G, S));
        part(el, 'dc-deals', dcDeals(S.dc, G));
        part(el, 'dc-fleet', dcFleet(S.dc));
        part(el, 'dc-res', research(S.dc, V.DC_RESEARCH, 'dc', G));
        drawCharts(el, S.dc.history, 'units', G);
      }
    }
    part(el, 'log', S.log.length ? S.log.map((l) => `<div>Day ${l.day} · ${l.text}</div>`).join('') : '<div>Nothing yet.</div>');
  }
  function part(el, name, html) { const p = el.querySelector(`[data-part="${name}"]`); if (p && p.__h !== html) { p.innerHTML = html; p.__h = html; } }

  function totalLine(S, G) {
    if (!S.ev && !S.dc) return 'Side businesses for extra income';
    return `Ventures today: <b>${signed(G, S.profitDay)}</b>/day`;
  }
  function layout(S) {
    const seg = `<div class="vn-seg" role="tablist">
      <button data-vnview="ev" aria-pressed="${view === 'ev'}">🚗 Voltline Motors</button>
      <button data-vnview="dc" aria-pressed="${view === 'dc'}">🛰️ Orbital Compute</button></div>`;
    let body = '';
    if (view === 'ev') {
      body = !S.ev ? '<div class="card vn-lock" data-part="lock"></div>' : `
        <div class="vn-kpis" data-part="ev-kpi"></div>
        <div class="vn-cols">
          <div class="card"><div class="vn-chartcap"><span>Profit per month</span><span>▲ profit · ▼ loss</span></div><canvas class="vn-chart" data-chart="profit"></canvas></div>
          <div class="card"><div class="vn-chartcap"><span>Cars delivered per month</span><span data-cap="units"></span></div><canvas class="vn-chart" data-chart="units"></canvas></div>
        </div>
        <div class="vn-sec"><h3>Car models</h3><div class="vn-cols"><div data-part="ev-models" class="vn-list"></div>${designerShell()}</div></div>
        <div class="vn-sec"><h3>Factories, charging & marketing</h3><div class="vn-cols3" data-part="ev-fac"></div></div>
        <div class="vn-sec"><h3>Voltline research</h3><div class="vn-cols3" data-part="ev-res"></div></div>`;
    } else {
      body = !S.dc ? '<div class="card vn-lock" data-part="lock"></div>' : `
        <div class="vn-kpis" data-part="dc-kpi"></div>
        <div class="vn-cols">
          <div class="card"><div class="vn-chartcap"><span>Profit per month</span><span>▲ profit · ▼ loss</span></div><canvas class="vn-chart" data-chart="profit"></canvas></div>
          <div class="card"><div class="vn-chartcap"><span>Usable compute (PF)</span><span data-cap="units"></span></div><canvas class="vn-chart" data-chart="units"></canvas></div>
        </div>
        <div class="vn-sec"><h3>Build & launch modules</h3><div class="vn-cols"><div class="card" data-part="dc-launch"></div><div class="card" data-part="dc-deals"></div></div></div>
        <div class="vn-sec"><h3>Upgrades</h3><div class="vn-cols3" data-part="dc-up"></div></div>
        <div class="vn-sec"><h3>Fleet in orbit</h3><div class="card" data-part="dc-fleet"></div></div>
        <div class="vn-sec"><h3>Compute research</h3><div class="vn-cols3" data-part="dc-res"></div></div>`;
    }
    return `<div class="vn-wrap"><div class="vn-head"><h2>Ventures</h2><span class="vn-total" data-part="total"></span>${seg}</div>${body}
      <div class="vn-sec"><h3>Venture news</h3><div class="card vn-log" data-part="log"></div></div></div>`;
  }

  // ---------- locked / founding
  function lockEV(S, G) {
    const c = S.canFoundEV;
    return `<div class="vn-big">🚗⚡</div><h3>Voltline Motors</h3>
      <p class="dim">Start your own electric car company. Design sedans, SUVs, pickups, semi trucks and roadsters, build gigafactories, roll out Volt Stations and grow a brand. Slow to start, steady later.</p>
      <p>Founding cost <b>${G.money(S.evCost)}</b> · includes a pilot line (6 cars/day)</p>
      <p>${c.ok ? st('ok', '✓', 'Ready to found') : st('bad', '🔒', G.esc(c.why))}</p>
      <div class="vn-btns" style="justify-content:center">${btn('foundEV', {}, 'Found Voltline Motors', { primary: true, disabled: !c.ok })}</div>`;
  }
  function lockDC(S, G) {
    const c = S.canFoundDC;
    return `<div class="vn-big">🛰️🖥️</div><h3>Apogee Orbital Compute</h3>
      <p class="dim">A data center in orbit: endless sunlight for power and deep space to dump heat. Build compute modules (racks + solar arrays + radiators), launch them yourself to LEO, and sell compute to AI labs and cloud customers.</p>
      <p>Founding cost <b>${G.money(S.dcCost)}</b> · unlocks after Halo is founded</p>
      <p>${S.halo ? st('ok', '✓', 'Halo network online') : st('warn', '⏳', 'Halo not founded yet')} ${c.ok ? st('ok', '✓', 'Ready to found') : st('bad', '🔒', G.esc(c.why))}</p>
      <div class="vn-btns" style="justify-content:center">${btn('foundDC', {}, 'Found Orbital Compute', { primary: true, disabled: !c.ok })}</div>`;
  }

  // ---------- EV parts
  function evKpis(e, G) {
    const util = e.capacity ? e.carsDay / e.capacity : 0;
    const wait = e.carsDay > 0.1 ? Math.round(e.backlog / e.carsDay) : 0;
    return kpi('Cars / day', `${e.carsDay.toFixed(e.carsDay < 10 ? 1 : 0)}`, `capacity ${e.capacity} · ${pct(util)} used`)
      + kpi('Orders / day', e.ordersDay.toFixed(e.ordersDay < 10 ? 1 : 0), e.ordersDay > e.capacity ? '▲ demand > capacity' : '✓ capacity OK')
      + kpi('Waitlist', num(e.backlog), wait ? `⏳ ~${wait} days wait` : 'no wait')
      + kpi('Brand', `${e.brand}/100`, `${num(e.delivered)} delivered`)
      + kpi('Profit / day', signed(G, e.profitDay), `rev ${fm(G, e.revenueDay)}`)
      + kpi('Profit 30 days', signed(G, e.profitMonth), e.recalls ? `⚠ ${e.recalls} recall${e.recalls > 1 ? 's' : ''}` : '✓ no recalls')
      + kpi('Volt Stations', num(e.stations), `demand ×${e.demandMult.charging.toFixed(2)}${e.stationsBuilding ? ` · +${e.stationsBuilding} building` : ''}`);
  }
  function evModels(e, G) {
    const V = VT();
    const list = e.models.filter((m) => m.status !== 'retired');
    if (!list.length) return '<div class="card vn-small">No car models yet. Design your first one →</div>';
    return list.map((m) => {
      const T = V.CAR_TYPES[m.type]; const s = m.stats;
      const status = m.status === 'dev'
        ? st('warn', '⏳', `In development · ${m.devLeft}d`)
        : m.waitDays > 45 ? st('bad', '⚠', `Waitlist ${m.waitDays}d`) : st('ok', '✓', 'On sale');
      const margin = s.margin;
      return `<div class="card vn-model"><div class="vn-row"><div class="vn-icon" aria-hidden="true">${T.icon}</div>
        <div class="vn-grow"><b>${G.esc(m.name)}</b> <span class="vn-small">${T.name}</span><div class="vn-small vn-stars" title="review score">${stars(s.stars)}</div></div>${status}</div>
        <div class="vn-specs">
          <div><small>Range</small><b>${s.range} km</b></div>
          <div><small>Battery</small><b>${s.battery} kWh</b></div>
          <div><small>Build cost</small><b>$${s.buildCost.toFixed(1)}k</b></div>
          <div><small>Margin</small><b>${margin >= 0 ? '▲' : '▼'} $${Math.abs(margin).toFixed(1)}k</b></div>
          <div><small>Orders/day</small><b>${m.status === 'dev' ? '~' + s.demand.toFixed(1) : m.lastOrders.toFixed(1)}</b></div>
          <div><small>Built/day</small><b>${m.lastBuilt.toFixed(1)}</b></div>
          <div><small>Waitlist</small><b>${num(m.backlog)}</b></div>
          <div><small>Delivered</small><b>${num(m.delivered)}</b></div>
        </div>
        <div class="vn-row" style="margin-top:8px"><span class="vn-small">Price</span>
          <div class="vn-price">${btn('setPrice', { id: m.id, price: m.price - 5 }, '−5')}${btn('setPrice', { id: m.id, price: m.price - 1 }, '−1')}<b style="min-width:58px;text-align:center">$${m.price}k</b>${btn('setPrice', { id: m.id, price: m.price + 1 }, '+1')}${btn('setPrice', { id: m.id, price: m.price + 5 }, '+5')}</div>
          <span class="vn-grow"></span>${btn('retireModel', { id: m.id }, 'Retire')}</div></div>`;
    }).join('');
  }
  function designerShell() {
    const V = VT();
    return `<div class="card" data-part="ev-design"><h3>🧪 Design a new model</h3>
      <div class="vn-types">${Object.values(V.CAR_TYPES).map((T) => `<button data-vntype="${T.id}" aria-pressed="${ds.type === T.id}">${T.icon} ${T.name}</button>`).join('')}</div>
      <div class="vn-field"><label for="vn-bat">Battery</label><input id="vn-bat" type="range" data-vnds="battery"><output data-o="battery"></output></div>
      <div class="vn-field"><label for="vn-price">Price</label><input id="vn-price" type="range" data-vnds="price"><output data-o="price"></output></div>
      <div class="vn-field"><label for="vn-name">Name</label><input id="vn-name" class="vn-input" data-vnds="name" maxlength="18" placeholder="auto" style="grid-column:span 2"></div>
      <div class="vn-specs" data-o="preview"></div>
      <div class="vn-btns" data-o="go"></div></div>`;
  }
  function syncDesignerInputs(el) {
    const V = VT(); const T = V.CAR_TYPES[ds.type];
    ds.battery = Math.max(T.bat[0], Math.min(T.bat[1], ds.battery));
    ds.price = Math.max(T.price[0], Math.min(T.price[1], ds.price));
    const b = el.querySelector('[data-vnds=battery]'), p = el.querySelector('[data-vnds=price]'), n = el.querySelector('[data-vnds=name]');
    if (!b) return;
    const bstep = T.bat[1] > 300 ? 10 : 5;
    Object.assign(b, { min: T.bat[0], max: T.bat[1], step: bstep }); b.value = ds.battery;
    Object.assign(p, { min: T.price[0], max: T.price[1], step: 1 }); p.value = ds.price;
    if (document.activeElement !== n) n.value = ds.name;
    el.querySelectorAll('[data-vntype]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.vntype === ds.type));
  }
  function updateDesigner(el, G) {
    const box = el.querySelector('[data-part="ev-design"]'); if (!box) return;
    if (!box.__init) { box.__init = true; syncDesignerInputs(el); }
    const V = VT(); const state = G.state;
    const s = V.modelStats(state, ds); const T = V.CAR_TYPES[ds.type];
    box.querySelector('[data-o=battery]').textContent = `${s.battery} kWh`;
    box.querySelector('[data-o=price]').textContent = `$${s.price}k`;
    const vsRange = s.range >= T.refRange ? '▲ above' : '▼ below';
    box.querySelector('[data-o=preview]').innerHTML = `
      <div><small>Range</small><b>${s.range} km</b><div class="vn-small">${vsRange} ${T.refRange}</div></div>
      <div><small>Build cost</small><b>$${s.buildCost.toFixed(1)}k</b></div>
      <div><small>Margin/car</small><b>${s.margin >= 0 ? '▲' : '▼'} $${Math.abs(s.margin).toFixed(1)}k</b></div>
      <div><small>Reviews</small><b class="vn-stars">${stars(s.stars)}</b></div>
      <div><small>Est. orders/day</small><b>~${s.demand.toFixed(1)}</b></div>
      <div><small>Est. profit/day</small><b>${signed(G, s.demand * s.margin / 1000)}</b><div class="vn-small">if built</div></div>
      <div><small>Dev cost</small><b>${G.money(s.devCost)}</b></div>
      <div><small>Dev time</small><b>${s.devDays} days</b></div>`;
    const html = btn('designModel', { type: ds.type, battery: s.battery, price: s.price, name: ds.name }, `Develop ${T.name} · ${G.money(s.devCost)}`, { primary: true, disabled: state.cash < s.devCost });
    const go = box.querySelector('[data-o=go]'); if (go.__h !== html) { go.innerHTML = html; go.__h = html; }
  }
  function evFactories(e, G, state) {
    const V = VT();
    let h = `<div class="card"><div class="vn-row"><b class="vn-grow">🔧 Pilot line</b>${st('ok', '✓', 'Online')}</div><div class="vn-small">${V.PILOT_LINE} cars/day. Small hand-built line from day one.</div></div>`;
    for (const f of e.factories) {
      const status = f.status === 'online' ? st('ok', '✓', `Online · L${f.level}`) : f.status === 'building' ? st('warn', '🏗', 'Building') : st('warn', '⬆', `Expanding to L${f.level + 1}`);
      const total = f.status === 'building' ? V.FACTORY.days : V.FACTORY.upDays;
      h += `<div class="card"><div class="vn-row"><b class="vn-grow">🏭 ${G.esc(f.name)}</b>${status}</div>
        <div class="vn-small">${f.status === 'building' ? 'Will make' : 'Makes'} <b>${f.cap}</b> cars/day${f.status === 'upgrading' ? ' (half speed while expanding)' : ''} · level ${f.level}/${V.FACTORY.maxLevel}</div>
        ${f.status !== 'online' ? prog(1 - f.left / total, `${f.left} days left`) : ''}
        <div class="vn-btns">${f.level < V.FACTORY.maxLevel ? btn('factoryUp', { id: f.id }, `Expand +${V.FACTORY.capPerLevel}/day · ${G.money(f.upCost)}`, { disabled: f.status !== 'online' || state.cash < f.upCost }) : st('idle', '★', 'Max level')}</div></div>`;
    }
    if (e.nextFactoryCost != null) {
      h += `<div class="card"><b>➕ New gigafactory</b><div class="vn-small">${V.FACTORY.capPerLevel} cars/day at level 1, expands to ${V.FACTORY.capPerLevel * V.FACTORY.maxLevel}. Takes ${V.FACTORY.days} days to build.</div>
        <div class="vn-btns">${btn('buildFactory', {}, `Build · ${G.money(e.nextFactoryCost)}`, { primary: true, disabled: state.cash < e.nextFactoryCost })}</div></div>`;
    }
    const B = V.STATION_BATCH;
    h += `<div class="card"><div class="vn-row"><b class="vn-grow">⚡ Volt Stations</b>${st(e.stations >= 400 ? 'ok' : 'warn', e.stations >= 400 ? '✓' : '▲', `${num(e.stations)} open`)}</div>
      <div class="vn-small">Fast chargers make cars easier to own: demand ×${e.demandMult.charging.toFixed(2)} (max ×1.20). ${e.stationsBuilding ? `⏳ ${e.stationsBuilding} being built.` : ''}</div>
      <div class="vn-btns">${btn('stations', { n: 1 }, `+${B.n} · ${G.money(B.cost)}`, { disabled: state.cash < B.cost })}${btn('stations', { n: 4 }, `+${B.n * 4} · ${G.money(B.cost * 4)}`, { disabled: state.cash < B.cost * 4 })}</div></div>`;
    const mk = [0, 2, 5, 10, 20];
    const dm = e.demandMult;
    h += `<div class="card"><b>📣 Marketing</b><div class="vn-small">Now ${G.money(e.marketing)}/month · demand ×${dm.mkt.toFixed(2)}. Brand ${e.brand}/100 (×${dm.brandF.toFixed(2)}). EV adoption ×${dm.adoption.toFixed(2)}.
      ${dm.halo > 1 ? '<br>🛰️ Halo Link in every car: demand +4%.' : ''}${e.mods.map((m) => `<br>${m.v >= 1 ? '▲' : '▼'} ${({ credit: 'Tax credit', chips: 'Chip shortage', rival: 'Rival EV', viral: 'Viral video' })[m.id] || m.id} until day ${m.until}`).join('')}</div>
      <div class="vn-btns">${mk.map((v) => btn('marketing', { perMonth: v }, `${e.marketing === v ? '✓ ' : ''}$${v}M`)).join('')}</div></div>`;
    return h;
  }

  // ---------- research (shared)
  function ipoCard(which, G) {
    const V = window.APOGEE_VENTURES, raw = G.state.ventures && G.state.ventures[which];
    if (!V || !V.ipoCheck || !raw) return '';
    const name = which === 'dc' ? 'Orbital Compute' : 'Voltline Motors';
    if (raw.ipo) return `<div class="card"><div class="vn-row"><b class="vn-grow">🔔 ${name} is public</b>${st('ok', '✓', 'Listed')}</div><div class="vn-small">Sold ${Math.round(raw.ipo.share * 100)}% on day ${raw.ipo.day} at a ${G.money(raw.ipo.valuation)} valuation, raised ${G.money(raw.ipo.raised)}. You keep ${Math.round((1 - raw.ipo.share) * 100)}% of its profit.</div></div>`;
    const c = V.ipoCheck(G.state, which);
    return `<div class="card"><div class="vn-row"><b class="vn-grow">🔔 Take ${name} public (IPO)</b>${c.ok ? st('ok', '✓', 'Ready') : st('idle', '🔒', 'Not yet')}</div>
      <div class="vn-small">Sell ${Math.round(V.IPO.share * 100)}% on the stock market for a big cash injection. Valuation follows revenue. ${c.ok ? `Valued at about ${G.money(c.valuation)} now.` : G.esc(c.why)}</div>
      <div class="vn-btns">${btn('ipo', { line: which }, c.ok ? `Ring the bell · raise ${G.money(c.valuation * V.IPO.share)}` : 'Ring the bell', { primary: c.ok, disabled: !c.ok })}</div></div>`;
  }
  function research(line, list, which, G) {
    return ipoCard(which, G) + list.map((R) => {
      const done = line.research[R.id];
      const busy = line.lab && line.lab.id === R.id;
      const locked = R.req && !line.research[R.req];
      const status = done ? st('ok', '✓', 'Done') : busy ? st('warn', '⏳', `${line.lab.left}d left`) : locked ? st('idle', '🔒', 'Locked') : st('idle', '○', `${R.days} days`);
      return `<div class="card"><div class="vn-row"><b class="vn-grow">${G.esc(R.name)}</b>${status}</div><div class="vn-small">${G.esc(R.desc)}</div>
        ${busy ? prog(1 - line.lab.left / line.lab.total, 'Researching…') : ''}
        ${!done && !busy ? `<div class="vn-btns">${btn('research', { line: which, id: R.id }, `Research · ${G.money(R.cost)}${R.sci ? ` · ${R.sci} 🔬` : ''}`, { disabled: locked || !!line.lab || G.state.cash < R.cost || (G.state.rp || 0) < (R.sci || 0), title: line.lab ? 'Lab busy' : '' })}</div>` : ''}</div>`;
    }).join('');
  }

  // ---------- DC parts
  function dcKpis(d, G) {
    return kpi('Modules in orbit', num(d.modules), `${d.readyCount} ready on ground`)
      + kpi('Usable compute', `${num(d.usablePF)} PF`, `raw ${num(d.rawPF)} PF`)
      + kpi('Uptime', pct(d.uptime), d.uptime >= 0.97 ? '✓ healthy' : '⚠ degraded')
      + kpi('Power/cooling', pct(d.eff), `☀ L${d.up.power} · ❄ L${d.up.cooling}`)
      + kpi('Spot price', `$${(d.spotPrice * 1000).toFixed(d.spotPrice < 0.01 ? 2 : 1)}k`, `per PF-day · index ${d.spotIndex.toFixed(2)}`)
      + kpi('Profit / day', signed(G, d.profitDay), `rev ${fm(G, d.revenueDay)}`)
      + kpi('Profit 30 days', signed(G, d.profitMonth), `${d.deals.length} deal${d.deals.length === 1 ? '' : 's'} · ${num(d.committed)} PF sold`);
  }
  function dcLaunch(d, G) {
    const V = VT(); const Gn = d.gen;
    const ready = Object.entries(d.ready).filter(([, n]) => n > 0).map(([g, n]) => `${n} × ${V.MOD_GENS[g].name}`).join(', ') || 'none';
    let lift = null;
    try { if (G.bestLift) lift = G.bestLift('LEO').mass; } catch (e) { lift = null; }
    const perMass = d.readyCount ? Math.max(...Object.entries(d.ready).filter(([, n]) => n > 0).map(([g]) => V.MOD_GENS[g].mass)) : Gn.mass;
    const fit = lift != null ? Math.floor(lift / perMass) : d.readyCount;
    const maxN = Math.max(0, Math.min(d.readyCount, fit));
    if (!launchN || launchN > maxN) launchN = maxN;
    const earn = d.spotPrice * Gn.units * d.eff * d.uptime;
    const q = d.queue.map((x) => `<div class="vn-li"><span>🧩</span><span class="vn-grow">${x.n} × ${V.MOD_GENS[x.gen].name}${prog(x.prog / x.n, `${Math.floor(x.prog)}/${x.n} built`)}</span></div>`).join('');
    return `<div class="vn-row"><b class="vn-grow">🧩 ${Gn.name}</b>${st('idle', '▣', `${Gn.units} PF · ${Gn.mass} t`)}</div>
      <div class="vn-small">Rack of accelerators with its own solar array and radiator wings. ${G.money(Gn.cost)} each, line builds ${d.lineRate}/day, lasts ~${Gn.life} days.</div>
      <div class="vn-btns">${[1, 5, 10].map((n) => btn('buildModules', { n }, `Build ${n} · ${G.money(Gn.cost * n)}`, { disabled: G.state.cash < Gn.cost * n })).join('')}</div>
      ${q ? `<div class="vn-list" style="margin-top:8px">${q}</div>` : ''}
      <div style="margin-top:12px" class="vn-row"><span class="vn-grow">Ready to launch: <b>${ready}</b></span></div>
      ${lift != null ? `<div class="vn-small">Best ready rocket lifts ${lift.toFixed(1)} t to LEO → up to ${fit} modules per flight.</div>` : ''}
      <div class="vn-row" style="margin-top:8px">
        ${btn('launchN', { d: -1 }, '−', { disabled: launchN <= 1 })}<b style="min-width:110px;text-align:center">${launchN} module${launchN === 1 ? '' : 's'}</b>${btn('launchN', { d: 1 }, '+', { disabled: launchN >= maxN })}
        ${btn('launchDc', { n: launchN }, launchN ? `🚀 Launch ${launchN} to LEO` : '🚀 Nothing ready to launch', { go: true, disabled: !launchN })}</div>
      ${earn < 0.01 ? `<div class="vn-small" style="margin-top:6px">⚠ Spot market saturated: a new module earns ~${fm(G, earn)}/day but costs $10k/day to run. Sign deals or upgrade instead.</div>` : `<div class="vn-small" style="margin-top:6px">✓ A new module earns ~${fm(G, earn)}/day on the spot market (runs $10k/day).</div>`}
      ${!maxN && d.readyCount ? `<div class="vn-small">⚠ No ready rocket can lift a module. Build a bigger rocket.</div>` : ''}`;
  }
  function dcUpgrades(d, G, S) {
    const V = VT();
    return Object.entries(V.DC_UPGRADES).map(([id, U]) => {
      const lvl = d.up[id] || 0; const max = lvl >= U.max;
      const cost = U.cost[lvl];
      const needHalo = id === 'laser' && !S.halo;
      const status = max ? st('ok', '✓', id === 'laser' ? 'Linked' : `Max L${lvl}`) : needHalo ? st('bad', '🔒', 'Needs Halo') : st('idle', '○', `L${lvl}/${U.max}`);
      const icon = { cooling: '❄', power: '☀', line: '🏭', laser: '🔗' }[id];
      return `<div class="card"><div class="vn-row"><b class="vn-grow">${icon} ${U.name}</b>${status}</div><div class="vn-small">${U.desc}</div>
        ${!max ? `<div class="vn-btns">${btn('dcUpgrade', { id }, `Upgrade · ${G.money(cost)}`, { disabled: needHalo || G.state.cash < cost })}</div>` : ''}</div>`;
    }).join('');
  }
  function dcDeals(d, G) {
    let h = '<b>🤝 Compute customers</b>';
    h += d.deals.length ? '<div class="vn-list" style="margin-top:8px">' + d.deals.map((k) => `<div class="vn-li"><span>${k.shortfall ? '⚠' : '✓'}</span><span class="vn-grow"><b>${G.esc(k.client)}</b> · ${k.kind}<br><span class="vn-small">${k.units} PF × $${Math.round(k.price * 1000)}k/day · ${k.left}d left${k.shortfall ? ` · ${k.shortfall} short days (penalty)` : ''}</span></span></div>`).join('') + '</div>' : '<div class="vn-small">No signed deals. Unsold compute goes to the spot market.</div>';
    h += '<div class="vn-small" style="margin-top:10px">Offers</div>';
    h += d.offers.length ? '<div class="vn-list">' + d.offers.map((o) => {
      const fits = d.committed + o.units <= d.usablePF;
      return `<div class="vn-li"><span>${o.laser ? '🔗' : '📨'}</span><span class="vn-grow"><b>${G.esc(o.client)}</b> · ${o.kind}<br><span class="vn-small">${o.units} PF for ${o.days}d at $${Math.round(o.price * 1000)}k/PF-day ≈ ${fm(G, o.units * o.price)}/day · ${fits ? '✓ capacity OK' : '⚠ short of capacity'} · expires d${o.expires}</span></span>
        ${btn('acceptCompute', { id: o.id }, 'Sign', { primary: true, disabled: o.laser && !d.up.laser })}${btn('declineCompute', { id: o.id }, '✕', { title: 'Decline' })}</div>`;
    }).join('') + '</div>' : '<div class="vn-small">⏳ New offers arrive every few weeks.</div>';
    return h;
  }
  function dcFleet(d) {
    if (!d.cohorts.length) return '<div class="vn-small">No modules in orbit yet. Build some and launch them.</div>';
    const V = VT(); const by = {};
    for (const c of d.cohorts) {
      const g = by[c.gen] || (by[c.gen] = { n: 0, oldest: 0, life: c.life, aging: 0, soon: 0, launches: 0 });
      g.n += c.n; g.launches += 1; g.oldest = Math.max(g.oldest, c.age);
      if (c.age / c.life > 0.9) g.soon += c.n; else if (c.health < 1) g.aging += c.n;
    }
    return '<div class="vn-list">' + Object.entries(by).map(([gen, g]) => {
      const s = g.soon ? st('bad', '⤵', `${g.soon} deorbit soon`) : g.aging ? st('warn', '▼', `${g.aging} aging`) : st('ok', '✓', 'Healthy');
      return `<div class="vn-li"><span>🛰️</span><span class="vn-grow"><b>${g.n} × ${V.MOD_GENS[gen].name}</b><br><span class="vn-small">${g.launches} launch${g.launches > 1 ? 'es' : ''} · oldest ${g.oldest}/${g.life} days</span></span>${s}</div>`;
    }).join('') + '</div><div class="vn-small" style="margin-top:6px">Modules slow down after 70% of their life and deorbit at the end. Launch new ones to replace them.</div>';
  }

  // ---------- charts
  function drawCharts(el, hist, unitKey, G) {
    const pc = el.querySelector('[data-chart=profit]'), uc = el.querySelector('[data-chart=units]');
    if (pc) bars(pc, hist.map((h) => h.profit), G);
    if (uc) line(uc, hist.map((h) => h[unitKey] || 0));
    const cap = el.querySelector('[data-cap=units]');
    if (cap) cap.textContent = hist.length ? `last: ${num(hist[hist.length - 1][unitKey] || 0)}` : '';
  }
  function prep(c) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = c.clientWidth || 300, h = c.clientHeight || 150;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    return { x, w, h };
  }
  const css = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };
  function empty(x, w, h) { x.fillStyle = css('--dim', '#8f9ab5'); x.font = '12px sans-serif'; x.textAlign = 'center'; x.fillText('First month of data comes after 30 days', w / 2, h / 2); }
  function bars(c, vals, G) {
    const { x, w, h } = prep(c);
    if (!vals.length) return empty(x, w, h);
    const max = Math.max(0.01, ...vals.map(Math.abs));
    const hasNeg = vals.some((v) => v < 0), hasPos = vals.some((v) => v >= 0);
    const top = 16, bot = 14;
    const zero = hasNeg && hasPos ? top + (h - top - bot) * (Math.max(...vals) / (Math.max(...vals) - Math.min(...vals))) : hasNeg ? top : h - bot;
    const scale = (h - top - bot) / (hasNeg && hasPos ? Math.max(...vals) - Math.min(...vals) : max);
    const bw = (w - 8) / vals.length;
    x.strokeStyle = css('--line', '#26314d'); x.beginPath(); x.moveTo(0, zero + 0.5); x.lineTo(w, zero + 0.5); x.stroke();
    vals.forEach((v, i) => {
      const bh = Math.abs(v) * scale; const bx = 4 + i * bw + bw * 0.15, bwid = Math.max(1, bw * 0.7);
      if (v >= 0) { x.fillStyle = css('--accent2', '#ffb347'); x.fillRect(bx, zero - bh, bwid, bh); }
      else { // losses: outlined + hatched so they read without colour
        x.strokeStyle = css('--bad', '#ff5d6c'); x.lineWidth = 1.5; x.strokeRect(bx + 0.75, zero + 0.75, bwid - 1.5, Math.max(1, bh - 1.5));
        x.save(); x.beginPath(); x.rect(bx, zero, bwid, bh); x.clip();
        for (let k = -bh; k < bwid; k += 5) { x.beginPath(); x.moveTo(bx + k, zero + bh); x.lineTo(bx + k + bh, zero); x.stroke(); }
        x.restore();
      }
    });
    const last = vals[vals.length - 1];
    x.fillStyle = css('--text', '#e9ecf4'); x.font = '11px sans-serif'; x.textAlign = 'right';
    x.fillText(`last month ${signed(G, last)}`, w - 4, 11);
  }
  function line(c, vals) {
    const { x, w, h } = prep(c);
    if (!vals.length) return empty(x, w, h);
    const max = Math.max(1, ...vals); const top = 16, bot = 10;
    const px = (i) => 6 + (vals.length === 1 ? (w - 12) / 2 : i * (w - 12) / (vals.length - 1));
    const py = (v) => h - bot - v / max * (h - top - bot);
    x.beginPath(); vals.forEach((v, i) => (i ? x.lineTo(px(i), py(v)) : x.moveTo(px(i), py(v))));
    x.strokeStyle = css('--blue', '#5aa9ff'); x.lineWidth = 2; x.stroke();
    x.lineTo(px(vals.length - 1), h - bot); x.lineTo(px(0), h - bot); x.closePath(); x.globalAlpha = 0.15; x.fillStyle = css('--blue', '#5aa9ff'); x.fill(); x.globalAlpha = 1;
    x.fillStyle = css('--text', '#e9ecf4'); vals.forEach((v, i) => { x.beginPath(); x.arc(px(i), py(v), 2.2, 0, 7); x.fill(); });
    x.font = '11px sans-serif'; x.textAlign = 'left'; x.fillStyle = css('--dim', '#8f9ab5'); x.fillText(`peak ${num(max)}`, 4, 11);
  }

  // ---------- events
  function bind(el, G0) {
    el.__vnBound = true;
    const G = () => el.__vnG || G0;
    el.addEventListener('click', (ev) => {
      const v = ev.target.closest('[data-vnview]');
      if (v) { view = v.dataset.vnview; try { localStorage.setItem('apogee-vn-view', view); } catch (e) { /* ignore */ } render(el, G()); return; }
      const t = ev.target.closest('[data-vntype]');
      if (t) {
        const T = VT().CAR_TYPES[t.dataset.vntype]; ds.type = T.id;
        ds.battery = Math.round((T.bat[0] + T.bat[1]) / 2 / 5) * 5; ds.price = T.refPrice;
        syncDesignerInputs(el); updateDesigner(el, G()); return;
      }
      const b = ev.target.closest('[data-vn]');
      if (!b || b.disabled) return;
      const g = G(); const act = b.dataset.vn; let args = {};
      try { args = JSON.parse(b.dataset.args || '{}'); } catch (e) { /* ignore */ }
      if (act === 'launchN') { launchN = Math.max(1, launchN + args.d); render(el, g); return; }
      if (act === 'launchDc') {
        const c = VT().dcContract(g.state, args.n);
        if (!c) { g.toast('No modules ready.'); return; }
        g.save(); if (g.openLaunchFor) g.openLaunchFor(c); return;
      }
      const r = VT().act(g.state, act, args);
      g.toast(r.ok ? `✓ ${g.esc(r.msg)}` : `✕ ${g.esc(r.msg)}`);
      if (r.ok) {
        if (/^found|designModel|buildFactory|research|ipo/.test(act)) g.log(`Ventures: ${g.esc(r.msg)}${r.cost ? ` (${g.money(r.cost)})` : ''}.`);
        if (act === 'designModel') ds.name = '';
        g.save();
      }
      g.refresh(); render(el, g);
    });
    el.addEventListener('input', (ev) => {
      const k = ev.target.dataset && ev.target.dataset.vnds; if (!k) return;
      ds[k] = k === 'name' ? ev.target.value : +ev.target.value;
      updateDesigner(el, G());
    });
  }

  function setView(v) { if (v === 'ev' || v === 'dc') { view = v; try { localStorage.setItem('apogee-vn-view', v); } catch (e) { /* ignore */ } } }
  root.APOGEE_VENTURES_UI = { render, setView };
})(typeof window !== 'undefined' ? window : globalThis);
