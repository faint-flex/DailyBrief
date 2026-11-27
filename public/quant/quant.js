// Quant Projection dashboard. Live over websocket from the local paper engine; on the phone it
// reads the copy the engine uploads to the Daily Brief app (/api/quant, brief key).
(() => {
  const $ = id => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const C = n => css.getPropertyValue('--' + n).trim();
  const COL = { up: C('up'), down: C('down'), accent: C('accent'), text: C('text'), muted: C('muted'), dim: C('dim'), line: C('line'), good: C('good'), warn: C('warn'), bad: C('bad'), panel2: C('panel2') };
  const local = location.port === '8787';     // served by the engine itself (PC or home Wi-Fi)
  let S = null, asset = 'btc', lastMsg = 0;
  try { asset = localStorage.getItem('quant-asset') || 'btc'; } catch {}

  const dpOf = p => (p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 3 : 5);
  const money = (x, sign) => (x == null ? '—' : (sign && x > 0 ? '+' : x < 0 ? '−' : '') + '$' + Math.abs(x).toFixed(2));
  const pct = (x, d = 0) => (x == null ? '—' : (x * 100).toFixed(d) + '%');
  const cents = x => (x == null ? '—' : (x * 100).toFixed(1) + '¢');
  const arrow = x => (x > 0 ? '▲ ' : x < 0 ? '▼ ' : '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hhmmss = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ---------- data source ----------
  function connectWs() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = e => { S = JSON.parse(e.data); lastMsg = Date.now(); render(); };
    ws.onclose = () => { $('foot').textContent = 'Engine not reachable. Is the bot window still open? Retrying…'; setTimeout(connectWs, 2000); };
  }
  function getKey() { try { return JSON.parse(localStorage.getItem('brief-key') || 'null'); } catch { return null; } }
  async function poll() {
    const key = getKey();
    if (!key) { $('gate').hidden = false; return; }
    try {
      const r = await fetch('/api/quant', { headers: { authorization: 'Bearer ' + key }, cache: 'no-store' });
      if (r.status === 401) { $('gate').hidden = false; return; }
      const d = await r.json();
      if (d && d.t) { S = d; lastMsg = Date.now(); render(); }
      else $('foot').textContent = 'No data yet. Start the bot on your PC (double-click Quant Bot).';
    } catch { $('foot').textContent = 'Offline. Retrying…'; }
    setTimeout(poll, 5000);
  }
  $('phone').onsubmit = async e => { e.preventDefault(); const key = $('phone-key').value.trim(); if (!key) return; await fetch('/phone-key', { method: 'POST', body: JSON.stringify({ key }) }); $('phone-key').value = ''; };
  $('gate-form').onsubmit = e => { e.preventDefault(); try { localStorage.setItem('brief-key', JSON.stringify($('gate-key').value.trim())); } catch {} $('gate').hidden = true; poll(); };
  let pickKeys = '';
  function picker() {                       // one button per coin the engine is trading
    const keys = Object.keys(S.assets);
    if (!keys.includes(asset)) asset = keys[0];
    if (keys.join() === pickKeys) return;
    pickKeys = keys.join();
    const box = document.querySelector('.assetpick');
    box.innerHTML = keys.map(k => `<button data-asset="${esc(k)}" aria-pressed="${k === asset}">${esc(k.toUpperCase())}</button>`).join('');
    box.querySelectorAll('button').forEach(b => {
      b.onclick = () => { asset = b.dataset.asset; try { localStorage.setItem('quant-asset', asset); } catch {} box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render(); };
    });
  }

  // ---------- canvas helper ----------
  function canvas(id) {
    const c = $(id), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = +c.getAttribute('height');
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + 'px'; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.font = '11px ' + css.getPropertyValue('--mono'); g.lineJoin = 'round';
    return { g, w, h };
  }
  function line(g, pts, color, width = 1.5, dash = []) {
    if (!pts.length) return; g.save(); g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
  }
  function text(g, s, x, y, color, align = 'left', base = 'middle') { g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y); }
  // right-edge labels that never overlap: [[y, text, color]] pushed apart by 13 px
  function edgeLabels(g, x, items, top, bottom) {
    items = items.filter(i => i[0] != null && isFinite(i[0])).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < items.length; i++) items[i][0] = Math.max(items[i][0], items[i - 1][0] + 13);
    const over = items.length ? items[items.length - 1][0] - bottom : 0;
    if (over > 0) items.forEach(i => (i[0] -= over));
    items.forEach(([y, s, c]) => text(g, s, x, Math.max(top, y), c));
  }
  function tri(g, x, y, r, upward, color, filled) {
    g.beginPath(); if (upward) { g.moveTo(x, y - r); g.lineTo(x + r, y + r * .8); g.lineTo(x - r, y + r * .8); } else { g.moveTo(x, y + r); g.lineTo(x + r, y - r * .8); g.lineTo(x - r, y - r * .8); }
    g.closePath(); if (filled) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = 1.2; g.stroke(); }
  }

  // ---------- panels ----------
  function feeds() {
    const n = Object.fromEntries(S.graph.nodes.map(x => [x.id, x]));
    const age = (Date.now() - lastMsg) / 1000;
    const item = (label, nd) => { const st = nd.state === 'ok' && S.t - nd.last < 15000 ? 'ok' : nd.state === 'warn' ? 'warn' : 'wait'; return `<span class="${st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : ''}">${st === 'ok' ? '✓' : st === 'warn' ? '!' : '…'} ${label}</span>`; };
    $('feeds').innerHTML = item('Prices', n.coinbase) + item('Order books', n.book) + item('Markets', n.markets) +
      (local ? '<span class="ok">✓ Live (websocket)</span>' : `<span class="${age > 40 ? 'warn' : 'ok'}">${age > 40 ? '!' : '✓'} Phone copy, ${Math.round((Date.now() - S.t) / 1000)} s old</span>`);
  }

  function wallet() {
    const w = S.wallet;
    $('w-equity').textContent = money(w.equity);
    const tot = w.equity - w.start;
    $('w-pnl').innerHTML = `<span class="${tot >= 0 ? 'up' : 'down'}">${arrow(tot)}${money(tot, true)}</span> since start · today ${arrow(w.today)}${money(w.today, true)}`;
    $('w-kv').innerHTML = [['Cash', money(w.cash)], ['In open bets', money(w.open)], ['Trades', w.trades], ['Win rate', w.winRate == null ? '—' : pct(w.winRate, 1)],
      ['Avg per trade', w.evTrade == null ? '—' : money(w.evTrade, true)], ['Worst drop', money(-w.maxDD)],
      ['Settle check', w.proxy && w.proxy.n ? `${pct(w.proxy.agree / w.proxy.n, 1)} of ${w.proxy.n}` : '—']].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const { g, w: W, h: H } = canvas('c-equity');
    const pts = [[w.since / 1000, w.start], ...w.curve];
    if (pts.length < 2) { text(g, 'Equity curve appears after the first settled trade', 4, H / 2, COL.dim); }
    else {
      const t0 = pts[0][0], t1 = pts[pts.length - 1][0], lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
      const X = t => (t - t0) / Math.max(1, t1 - t0) * (W - 4) + 2, Y = v => H - 4 - (v - lo) / Math.max(1e-9, hi - lo) * (H - 8);
      line(g, [[0, Y(w.start)], [W, Y(w.start)]], COL.line, 1, [3, 3]);
      line(g, pts.map(([t, v]) => [X(t), Y(v)]), COL.accent, 1.8);
    }
    const b = S.backtest;
    $('w-backtest').innerHTML = b ? `Backtest (out of sample, ${b.days} days): <b>${b.n}</b> trades, win <b>${pct(b.win, 1)}</b>, avg <b>${money(b.ev_trade, true)}</b>/trade, return <b>${pct(b.roi, 1)}</b> on money staked, worst drop <b>${money(-b.max_dd)}</b>.<br>${esc(b.verdict || '')}` : 'Backtest numbers appear here once loaded.';
  }

  // agent graph (SVG)
  const POS = { coinbase: [80, 60], markets: [80, 160], book: [80, 255], projector: [270, 60], risk: [270, 160], judge: [440, 160], executor: [560, 60], settler: [560, 255], learner: [320, 255] };
  let built = false;
  function graph() {
    const svg = $('graph'), nodes = S.graph.nodes;
    if (!built) {
      const path = ([a, b]) => { const [x1, y1] = POS[a], [x2, y2] = POS[b]; const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
      svg.innerHTML = S.graph.edges.map(e => `<path class="edge" id="e-${e[0]}-${e[1]}" d="${path(e)}"/>`).join('') +
        nodes.map(n => { const [x, y] = POS[n.id]; return `<g class="node" id="n-${n.id}" transform="translate(${x - 72},${y - 26})"><title>${esc(n.role)}</title><rect width="144" height="52"/><text class="label" x="10" y="18">${esc(n.label)}</text><text class="badge" x="134" y="18" text-anchor="end"></text><text class="detail" x="10" y="36"></text></g>`; }).join('') +
        '<g id="dots"></g>';
      built = true;
    }
    for (const n of nodes) {
      const el = $('n-' + n.id); if (!el) continue;
      const busy = Date.now() - n.last < 1500 && n.state === 'ok';
      el.setAttribute('class', 'node ' + (busy ? 'busy' : n.state));
      const badge = el.querySelector('.badge');
      badge.textContent = n.state === 'ok' ? '✓' : n.state === 'warn' ? '!' : '…';
      badge.setAttribute('fill', n.state === 'ok' ? COL.good : n.state === 'warn' ? COL.warn : COL.dim);
      el.querySelector('.detail').textContent = (n.detail || n.role).slice(0, 22);
    }
    const now = Date.now();
    for (const [a, b] of S.graph.edges) {
      const t = S.graph.pulses[a + '>' + b] || 0, el = $(`e-${a}-${b}`);
      if (el) el.classList.toggle('hot', now - t < 2000);
      if (t && t !== sent[a + b] && now - t < 3000) { sent[a + b] = t; flights.push({ el, t0: performance.now() }); }
    }
    $('g-sub').textContent = `${nodes.reduce((s, n) => s + (n.state === 'ok' ? 1 : 0), 0)}/${nodes.length} agents healthy`;
  }
  const sent = {}, flights = [];
  function animate(ts) {
    const dots = $('dots');
    if (dots) {
      for (let i = flights.length - 1; i >= 0; i--) if (ts - flights[i].t0 > 700) flights.splice(i, 1);
      dots.innerHTML = flights.map(f => { const L = f.el.getTotalLength(), p = f.el.getPointAtLength(L * Math.min(1, (ts - f.t0) / 700)); return `<circle class="dot" r="4" cx="${p.x}" cy="${p.y}"/>`; }).join('');
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  function ladder() {
    const rows = S.ladder;
    $('ladder').innerHTML = rows.length ? rows.map(c => {
      const st = c.status === 'BUY' ? 'buy' : c.status === 'holding' ? 'hold' : 'idle';
      const e = c.edge, w = e == null ? 0 : Math.min(50, Math.abs(e) * 250);
      const sym = c.side ? '▼ D' : '▲ U';
      return `<li><span class="nm"><span class="${c.side ? 'down' : 'up'}">${sym}</span> ${esc(c.label)}</span><span class="st ${st}">${esc(c.status)}</span>
        <span class="bar" aria-hidden="true"><i class="${e >= 0 ? 'pos' : 'neg'}" style="${e >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>
        <span class="nums">model ${pct(c.prob, 1)} · ask ${cents(c.ask)} · fee ${cents(c.fee)} · edge ${e == null ? '—' : (e >= 0 ? '+' : '−') + Math.abs(e * 100).toFixed(1) + '¢'}</span></li>`;
    }).join('') : '<li class="empty">Warming up: needs about 6 minutes of prices first.</li>';
    const k = S.cfg;
    $('cfg').textContent = `Rules: Theil-Sen over ${k.N} s, slope weight ${k.lam}, buy when edge ≥ ${(k.edge * 100).toFixed(0)}¢ after fee, last ${k.startLo} s only, $${k.stake} max per bet, ${k.lat} s order delay, one bet per market.`;
  }

  function priceChart(v) {
    const { g, w: W, h: H } = canvas('c-price');
    $('ch-title').textContent = asset.toUpperCase();
    if (!v || !v.chart) { text(g, v && !v.warm ? 'Warming up price history…' : 'Waiting for data…', 8, H / 2, COL.dim); $('ch-sub').textContent = ''; return; }
    const lag = S.cfg.lag, E = v.E, end = E + 5, start = v.s - 60;
    const pts = v.chart.filter(([u]) => u >= start);
    const paths = (v.mc?.sample || []);
    const t = pts.length ? pts[pts.length - 1][0] : E - v.left;
    let vals = pts.map(p => p[1]).concat([v.strike, v.proj]);
    paths.forEach(p => p.forEach(x => vals.push(x)));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    const L = 8, R = 96, X = u => L + (u - start) / (end - start) * (W - L - R), Y = p => 8 + (hi - p) / (hi - lo) * (H - 26);
    // averaging window shading
    g.fillStyle = 'rgba(185,140,255,.08)'; g.fillRect(X(E - 60 - lag), 4, X(E - lag) - X(E - 60 - lag), H - 18);
    text(g, 'settle average', X(E - 60 - lag) + 4, H - 6, COL.dim, 'left', 'alphabetic');
    g.fillStyle = 'rgba(127,147,168,.06)'; g.fillRect(X(v.s - 60 - lag), 4, X(v.s - lag) - X(v.s - 60 - lag), H - 18);
    text(g, 'strike average', X(v.s - 60 - lag) + 4, H - 6, COL.dim, 'left', 'alphabetic');
    // strike
    line(g, [[L, Y(v.strike)], [W - R, Y(v.strike)]], COL.text, 1, [6, 4]);

    // Monte Carlo paths (from now forward)
    g.globalAlpha = .18; paths.forEach(p => line(g, p.map((x, i) => [X(t + i * 2), Y(x)]), COL.accent, 1)); g.globalAlpha = 1;
    // projection line
    const tEnd = E - lag; line(g, [[X(t), Y(v.price)], [X(tEnd), Y(v.price + S.cfg.lam * v.beta * (tEnd - t))]], COL.accent, 2, [2, 3]);
    // price
    line(g, pts.map(([u, p]) => [X(u), Y(p)]), v.price >= v.strike ? COL.up : COL.down, 2);
    const dp = dpOf(v.price);
    edgeLabels(g, W - R + 4, [[Y(v.strike), 'strike ' + v.strike.toFixed(dp), COL.text], [Y(v.price), (v.price >= v.strike ? '▲ ' : '▼ ') + v.price.toFixed(dp), v.price >= v.strike ? COL.up : COL.down]], 8, H - 20);
    // now marker + close
    line(g, [[X(t), 4], [X(t), H - 16]], COL.dim, 1, [1, 3]);
    line(g, [[X(E), 4], [X(E), H - 16]], COL.muted, 1);
    text(g, 'close', X(E) + 3, 12, COL.muted);
    const gap = v.proj - v.strike;
    $('ch-sub').textContent = `${v.left}s left · projected settle ${gap >= 0 ? '▲ above' : '▼ below'} strike by ${Math.abs(gap).toFixed(dpOf(v.price))} · slope ${v.beta >= 0 ? '+' : ''}${v.beta.toFixed(3)}/s`;
    $('ch-legend').innerHTML = `<span><i style="border-color:${COL.up}"></i>price (Coinbase, 1 s)</span><span><i class="dash" style="border-color:${COL.text}"></i>strike</span><span><i class="dot" style="border-color:${COL.accent}"></i>Theil-Sen projection</span><span><i style="border-color:${COL.accent};opacity:.4"></i>simulated paths</span>`;
  }

  function oscillator(v) {
    const { g, w: W, h: H } = canvas('c-osc');
    const hs = v?.hist || [];
    if (hs.length < 2) { text(g, 'Builds up once the current market is being watched…', 8, H / 2, COL.dim); return; }
    const L = 34, R = 104, t0 = v.s, t1 = v.E, X = u => L + (u - t0) / (t1 - t0) * (W - L - R), Y = p => 8 + (1 - p) * (H - 24);
    [0, .25, .5, .75, 1].forEach(p => { line(g, [[L, Y(p)], [W - R, Y(p)]], COL.line, 1, p === .5 ? [] : [2, 4]); text(g, (p * 100) + '%', L - 4, Y(p), COL.dim, 'right'); });
    const start = v.E - S.cfg.startLo; g.fillStyle = 'rgba(90,209,196,.06)'; g.fillRect(X(start), 4, X(v.E) - X(start), H - 18);
    text(g, 'trading zone', X(start) + 4, H - 6, COL.dim, 'left', 'alphabetic');
    const ser = (i) => hs.filter(r => r[i] != null).map(r => [X(r[0]), Y(r[i])]);
    // book band: Up ask (top) and 1 - Down ask (bottom) = where you could buy each side
    const ask = ser(3), bid = ser(4);
    line(g, ask, COL.up, 1.2, [1, 2]); line(g, bid, COL.down, 1.2, [1, 2]);
    line(g, ser(2), COL.muted, 1.5, [5, 3]);
    line(g, ser(1), COL.accent, 2.2);
    const last = hs[hs.length - 1];
    edgeLabels(g, W - R + 4, [[last[1] == null ? null : Y(last[1]), 'model ' + pct(last[1]), COL.accent], [last[2] == null ? null : Y(last[2]), 'crowd ' + pct(last[2]), COL.muted],
      [last[3] == null ? null : Y(last[3]), '▲ U ask ' + pct(last[3]), COL.up], [last[4] == null ? null : Y(last[4]), '▼ 1−D ask ' + pct(last[4]), COL.down]], 8, H - 20);
    $('osc-legend').innerHTML = `<span><i style="border-color:${COL.accent}"></i>model chance of Up</span><span><i class="dash" style="border-color:${COL.muted}"></i>crowd (mid price)</span><span><i class="dot" style="border-color:${COL.up}"></i>▲ cost to buy Up</span><span><i class="dot" style="border-color:${COL.down}"></i>▼ 1 − cost to buy Down</span><span>Model above ▲ line = Up is cheap · below ▼ line = Down is cheap</span>`;
  }

  function monte(v) {
    const a = canvas('c-mc'), b = canvas('c-hist');
    if (!v || !v.mc) { text(a.g, 'Waiting…', 8, a.h / 2, COL.dim); $('mc-note').textContent = ''; return; }
    const mc = v.mc, paths = mc.sample;
    let vals = [v.strike]; paths.forEach(p => p.forEach(x => vals.push(x)));
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .1 || 1; lo -= pad; hi += pad;
    const n = Math.max(...paths.map(p => p.length), 2);
    const X = i => 6 + i / (n - 1) * (a.w - 60), Y = p => 6 + (hi - p) / (hi - lo) * (a.h - 12);
    line(a.g, [[0, Y(v.strike)], [a.w - 54, Y(v.strike)]], COL.text, 1, [6, 4]);
    text(a.g, 'strike', a.w - 50, Y(v.strike), COL.muted);
    paths.forEach(p => { const up = p[p.length - 1] >= v.strike; a.g.globalAlpha = .45; line(a.g, p.map((x, i) => [X(i), Y(x)]), up ? COL.up : COL.down, 1); });
    a.g.globalAlpha = 1;
    // histogram of settle - strike
    const H = mc.hist, max = Math.max(...H, 1), bw = (b.w - 8) / H.length, zero = (0 - mc.lo) / Math.max(1e-9, mc.hi - mc.lo) * (b.w - 8) + 4;
    H.forEach((c, i) => { const x0 = 4 + i * bw, mid = mc.lo + (i + .5) / H.length * (mc.hi - mc.lo); b.g.fillStyle = mid >= 0 ? COL.up : COL.down; b.g.globalAlpha = mid >= 0 ? .85 : .6; const hh = c / max * (b.h - 18); b.g.fillRect(x0 + 1, b.h - 14 - hh, bw - 2, hh); });
    b.g.globalAlpha = 1;
    if (zero > 4 && zero < b.w - 4) { line(b.g, [[zero, 0], [zero, b.h - 12]], COL.text, 1); }
    text(b.g, '▼ D wins', 4, b.h - 5, COL.down, 'left', 'alphabetic'); text(b.g, 'U wins ▲', b.w - 4, b.h - 5, COL.up, 'right', 'alphabetic');
    const pos = v.position;
    let note = `<b>${pct(mc.pUp, 1)}</b> of ${mc.steps ? 400 : 0} simulated finishes end ▲ Up (formula says ${pct(v.pUp, 1)}).`;
    if (pos) {
      const win = pos.side ? 1 - mc.pUp : mc.pUp, bid = pos.side ? v.quotes.dnBid : v.quotes.upBid;
      const hold = win * pos.shares - pos.cost - pos.fee, exit = bid != null ? bid * pos.shares - pos.cost - pos.fee - pos.shares * v.feeRate * bid * (1 - bid) : null;
      note += `<br>Open bet: ${pos.side ? '▼ Down' : '▲ Up'} ${pos.shares} @ ${cents(pos.price)}. Hold to the end: expected <b>${money(hold, true)}</b>. Sell now at ${cents(bid)}: <b>${money(exit, true)}</b> → ${exit == null || hold >= exit ? '<b>hold</b>' : '<b>exit is better</b>'}.`;
    } else note += '<br>No open bet in this market. The simulator compares holding vs selling once one is open.';
    $('mc-note').innerHTML = note;
    $('mc-sub').textContent = `${mc.steps}s of price left to simulate`;
  }

  function river() {
    const { g, w: W, h: H } = canvas('c-river');
    const now = Date.now(), span = 120000, L = 30;
    const tr = S.river.filter(x => x.asset === asset && now - x.t < span);
    [0, .5, 1].forEach(p => { const y = 6 + (1 - p) * (H - 20); line(g, [[L, y], [W, y]], COL.line, 1, p === .5 ? [] : [2, 4]); text(g, p * 100 + '¢', L - 4, y, COL.dim, 'right'); });
    text(g, 'Up price', L + 2, 12, COL.dim);
    text(g, '2 min ago', L + 2, H - 4, COL.dim, 'left', 'alphabetic'); text(g, 'now', W - 2, H - 4, COL.dim, 'right', 'alphabetic');
    for (const x of tr) {
      const upPrice = x.out === 'U' ? x.price : 1 - x.price;
      const px = L + (1 - (now - x.t) / span) * (W - L - 6), py = 6 + (1 - upPrice) * (H - 20);
      const r = Math.max(2.5, Math.min(11, Math.sqrt(x.price * x.size) * .7));
      const boughtUp = (x.out === 'U') === (x.side === 'BUY');
      tri(g, px, py, r, boughtUp, boughtUp ? COL.up : COL.down, x.side === 'BUY');
    }
    if (!tr.length) text(g, 'No trades in the last 2 minutes', W / 2, H / 2, COL.dim, 'center');
  }

  function logs() {
    const el = $('log'), atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.innerHTML = S.logs.map(l => `<span class="${l.level === 'warn' ? 'w' : ''}">${hhmmss(l.t)} <span class="a">${esc(l.agent.padEnd(8))}</span> ${esc(l.msg)}</span>`).join('\n');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  function trades() {
    const r = S.wallet.recent;
    const open = (S.wallet.openList || []).map(p => `<li><span><span class="${p.side ? 'down' : 'up'}">${p.side ? '▼ D' : '▲ U'}</span> ${p.asset.toUpperCase()} open<br><span class="m">${p.shares} @ ${cents(p.price)} · ${p.left ? p.left + 's left' : 'waiting for result'}</span></span><span class="m">bid ${cents(p.bid)}</span></li>`);
    $('trades').innerHTML = open.concat(r.map(x => `<li><span><span class="${x.side ? 'down' : 'up'}">${x.side ? '▼ D' : '▲ U'}</span> ${x.asset.toUpperCase()} ${new Date(x.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<br><span class="m">${x.shares.toFixed(1)} @ ${cents(x.price)} · model ${pct(x.prob)}</span></span><span>${x.won ? '✓' : '✕'} ${money(x.pnl, true)}</span></li>`)).join('') || '<li class="empty">No paper trades yet.</li>';
  }

  function learn() {
    const Lr = S.learning, w = S.wallet, f = S.frozen;
    if (!Lr || !w.proof) return;
    const pr = w.proof;
    $('proof').innerHTML = pr.checks.map(c => {
      const v = c.id === 'trades' ? c.value : c.id === 'ev' ? (c.value == null ? '—' : money(c.value, true)) : c.id === 'dd' ? money(c.value) : c.id === 'days' ? c.value.toFixed(1) + ' d' : c.value == null ? '—' : pct(c.value);
      return `<li><span class="${c.pass ? 'ok' : 'warn'}">${c.pass ? '✓' : '○'}</span><span>${esc(c.label)}</span><span class="v">${v}</span><span class="bar"><i style="width:${Math.round(c.progress * 100)}%"></i></span></li>`;
    }).join('') + `<li><span class="${pr.proven ? 'ok' : 'warn'}">${pr.proven ? '✓' : '○'}</span><b>${pr.proven ? 'PROVEN on paper. Real money still needs your explicit go.' : 'Not proven yet.'}</b><span></span></li>`;
    const diff = w.pnl - f.pnl;
    $('vsfrozen').innerHTML = `Learning bot ${money(w.pnl, true)} over ${w.trades} bets · frozen copy ${money(f.pnl, true)} over ${f.trades} bets → learning is ${diff >= 0 ? '▲ ahead' : '▼ behind'} by ${money(Math.abs(diff))}.`;
    const P = p => `${p.N}s slope · weight ${p.lam} · edge ${Math.round(p.edge * 100)}¢ · last ${p.startLo}s`;
    $('l-params').innerHTML = `<dt>Learning</dt><dd>${P(w.params)}</dd><dt>Frozen</dt><dd>${P(f.params)}</dd><dt>Switches</dt><dd>${Lr.switches}</dd><dt>Markets recorded</dt><dd>${Lr.records}</dd>`;
    const la = Lr.latency;
    $('l-lat').innerHTML = `<dt>Round trip to Polymarket</dt><dd>${la.rttMs == null ? '—' : Math.round(la.rttMs) + ' ms'}</dd><dt>Feed delay</dt><dd>${la.wsLagMs == null ? '—' : Math.round(la.wsLagMs) + ' ms'}</dd><dt>Order delay used</dt><dd>${la.simS} s (measured ${la.estS.toFixed(2)} s)</dd>`;
    const mins = Math.max(0, Math.round((Lr.nextEval - Date.now() / 1000) / 60));
    $('l-sub').textContent = `next re-test in ${mins} min · switches only on a clear win in the newest ${Lr.rules.holdoutHours} h`;
    $('evals').innerHTML = Lr.evals.length ? Lr.evals.slice(0, 6).map(e => `<li><b>${new Date(e.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${e.decision === 'switch' ? '⇄ switched' : e.decision === 'wait' ? '… waiting' : '= kept'}</b> · ${esc(e.why)}</li>`).join('')
      : `<li>First re-test about an hour after start. It needs ${Lr.rules.minMarkets} recorded markets before it changes anything.</li>`;
  }

  function render() {
    if (!S) return;
    $('gate').hidden = true;
    picker();
    const v = S.assets[asset];
    try { feeds(); wallet(); learn(); graph(); ladder(); priceChart(v); oscillator(v); monte(v); river(); logs(); trades(); } catch (e) { console.error(e); }
    $('phone').hidden = !local || !!S.phone;
    $('foot').textContent = `Paper trading only: no orders are sent anywhere and no wallet or keys are used. Updated ${hhmmss(S.t)}.`;
  }
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
  window.addEventListener('resize', render);
  if (local) connectWs(); else poll();
})();
