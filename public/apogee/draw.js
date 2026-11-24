// Drawing helpers: rocket geometry and procedural rendering.
(function () {
  'use strict';
  const S = window.APOGEE_SIM;
  const ENG_SIZE = { ember: 0.95, emberv: 1.0, comet: 1.25, cometv: 1.4, nova: 1.3, novav: 1.5 };
  const DENS = { Kerosene: 1.0, Methane: 0.82 };

  function geometry(design, techs) {
    const s0 = design.stages[0];
    const d = Math.max(1.8, Math.min(13, Math.sqrt(s0.count) * ENG_SIZE[s0.engine] * 1.25 + 0.7));
    const area = Math.PI * (d / 2) * (d / 2);
    const steel = S.has(techs, 'steel') && d > 7;
    const stages = design.stages.map((st) => {
      const eng = S.ENGINES[st.engine];
      const h = st.prop / DENS[eng.fuel] / area + 2.2;
      return { h: Math.max(h, d * 0.9), engine: st.engine, count: st.count };
    });
    const nose = d * 1.9;
    const total = stages.reduce((s, x) => s + x.h, 0) + nose;
    return { d, stages, nose, total, steel };
  }

  // Draws the stack starting at stage `from`, with the base of that stage at (0,0), growing up (negative y).
  function drawRocket(ctx, design, geo, o) {
    o = o || {};
    const from = o.from || 0;
    const to = o.to == null ? design.stages.length - 1 : o.to;
    const d = geo.d, r = d / 2;
    ctx.save();
    ctx.translate(o.x || 0, o.y || 0);
    if (o.angle) ctx.rotate(o.angle);
    ctx.scale(o.scale || 1, o.scale || 1);
    const steel = geo.steel;
    const body = ctx.createLinearGradient(-r, 0, r, 0);
    if (steel) {
      body.addColorStop(0, '#6d737c'); body.addColorStop(0.35, '#d9dde3'); body.addColorStop(0.55, '#f4f6f8'); body.addColorStop(1, '#7a818b');
    } else {
      body.addColorStop(0, '#9aa0aa'); body.addColorStop(0.35, '#f4f2ec'); body.addColorStop(0.6, '#ffffff'); body.addColorStop(1, '#a6abb4');
    }
    const accent = design.color || '#ff7a1a';
    let y = 0;
    // Flame first so the bells sit on top of it.
    if (o.flame) drawFlame(ctx, design.stages[from], r, o.flame, o.vac);
    drawBells(ctx, design.stages[from], r);
    for (let i = from; i <= to; i++) {
      const st = geo.stages[i];
      const top = y - st.h;
      ctx.fillStyle = body;
      ctx.fillRect(-r, top, d, st.h);
      // engine skirt
      ctx.fillStyle = steel ? 'rgba(40,40,46,.55)' : '#2a2f3a';
      ctx.fillRect(-r, y - Math.min(1.4, st.h * 0.08), d, Math.min(1.4, st.h * 0.08));
      // interstage band
      if (i < design.stages.length - 1 || !o.noNose) {
        ctx.fillStyle = steel ? 'rgba(30,30,36,.35)' : '#1d2230';
        ctx.fillRect(-r, top, d, Math.min(1.2, st.h * 0.1));
      }
      if (i === 0) {
        ctx.fillStyle = accent;
        ctx.fillRect(-r, top + st.h * 0.42, d, Math.max(0.35, st.h * 0.025));
        if (o.fins) drawFins(ctx, r, top + 1.4);
        if (o.legs != null) drawLegs(ctx, r, y, o.legs);
      }
      y = top;
    }
    if (to === design.stages.length - 1 && !o.noNose) {
      // fairing / nose
      const h = geo.nose;
      ctx.beginPath();
      ctx.moveTo(-r, y);
      ctx.bezierCurveTo(-r, y - h * 0.55, -r * 0.35, y - h * 0.95, 0, y - h);
      ctx.bezierCurveTo(r * 0.35, y - h * 0.95, r, y - h * 0.55, r, y);
      ctx.closePath();
      ctx.fillStyle = body; ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(-r, y - h * 0.12, d, Math.max(0.25, h * 0.04));
    }
    ctx.restore();
  }

  function drawBells(ctx, st, r) {
    const n = Math.min(st.count, 9);
    const bw = Math.min((r * 2) / Math.max(1, Math.ceil(Math.sqrt(n)) + 0.4), r * 1.1);
    const vac = S.ENGINES[st.engine].vac;
    const h = vac ? bw * 1.4 : bw * 0.9;
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n)) + (n > 4 ? 1 : 0);
    const used = Math.min(cols, n);
    const step = (r * 2 - bw) / Math.max(1, used - 1);
    ctx.fillStyle = vac ? '#3a3f4c' : '#2b2f38';
    for (let k = 0; k < used; k++) {
      const cx = used === 1 ? 0 : -r + bw / 2 + k * step;
      ctx.beginPath();
      ctx.moveTo(cx - bw * 0.22, 0);
      ctx.lineTo(cx + bw * 0.22, 0);
      ctx.lineTo(cx + bw * 0.5, h);
      ctx.lineTo(cx - bw * 0.5, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawFlame(ctx, st, r, power, vac) {
    const t = performance.now() / 1000;
    const flick = 0.9 + Math.sin(t * 40) * 0.05 + Math.random() * 0.08;
    const w = Math.max(r * 1.6, 1.2) * (vac ? 1.8 : 1);
    const len = (r * 6 + 6) * power * flick * (vac ? 1.5 : 1);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(255,255,240,0.95)');
    g.addColorStop(0.15, 'rgba(255,214,120,0.9)');
    g.addColorStop(0.5, 'rgba(255,122,26,0.55)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w / 2, r * 0.2);
    ctx.quadraticCurveTo(-w * 0.62, len * 0.4, 0, len);
    ctx.quadraticCurveTo(w * 0.62, len * 0.4, w / 2, r * 0.2);
    ctx.closePath();
    ctx.fill();
    // blue core
    ctx.fillStyle = 'rgba(160,200,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, len * 0.08, w * 0.25, len * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFins(ctx, r, y) {
    ctx.fillStyle = '#3a3f4a';
    const s = Math.max(0.8, r * 0.5);
    ctx.fillRect(-r - s, y, s, s * 0.8);
    ctx.fillRect(r, y, s, s * 0.8);
  }

  function drawLegs(ctx, r, y, deployed) {
    ctx.strokeStyle = '#20242d';
    ctx.lineWidth = Math.max(0.35, r * 0.18);
    ctx.lineCap = 'round';
    const len = r * 2.6 + 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      if (deployed) {
        ctx.moveTo(side * r, y - len * 0.75);
        ctx.lineTo(side * (r + len * 0.55), y + 1.6);
      } else {
        ctx.moveTo(side * r, y - len * 0.9);
        ctx.lineTo(side * (r + 0.1), y - 0.4);
      }
      ctx.stroke();
    }
  }

  // Starfield cache
  let stars = null;
  function starfield(w, h) {
    if (!stars || stars.w !== w || stars.h !== h) {
      const pts = [];
      for (let i = 0; i < Math.floor(w * h / 1800); i++) pts.push([Math.random() * w, Math.random() * h, Math.random() * 1.3 + 0.2, Math.random()]);
      stars = { w, h, pts };
    }
    return stars.pts;
  }

  function skyColor(alt) {
    // alt in km: 0 → blue, 60+ → black
    const k = Math.max(0, Math.min(1, alt / 60));
    const lerp = (a, b) => Math.round(a + (b - a) * k);
    return [`rgb(${lerp(78, 2)},${lerp(140, 4)},${lerp(214, 12)})`, `rgb(${lerp(170, 6)},${lerp(205, 10)},${lerp(240, 24)})`];
  }

  // A small scene of the rocket standing on the pad (used on the Launch tab).
  function drawPadScene(canvas, design, techs, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a1226'); g.addColorStop(0.7, '#283a66'); g.addColorStop(1, '#e98a4a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (const [x, y, s, a] of starfield(w, h)) {
      if (y > h * 0.55) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.3 + a * 0.6})`; ctx.fillRect(x, y, s, s);
    }
    // ground + sea
    const gy = h - 22;
    ctx.fillStyle = '#0d1424'; ctx.fillRect(0, gy, w, 22);
    ctx.fillStyle = '#16223c'; ctx.fillRect(0, gy, w, 2);
    if (!design) return;
    const geo = geometry(design, techs);
    const scale = Math.min((h - 46) / geo.total, (w * 0.25) / geo.d);
    const x = w * 0.62;
    // tower
    ctx.fillStyle = '#1b2134';
    const th = geo.total * scale * 1.05, tw = Math.max(8, geo.d * scale * 0.6);
    ctx.fillRect(x - geo.d * scale / 2 - tw - 6, gy - th, tw, th);
    ctx.strokeStyle = '#2c3552'; ctx.lineWidth = 1;
    for (let yy = gy - th; yy < gy; yy += 8) {
      ctx.beginPath(); ctx.moveTo(x - geo.d * scale / 2 - tw - 6, yy); ctx.lineTo(x - geo.d * scale / 2 - 6, yy + 8); ctx.stroke();
    }
    drawRocket(ctx, design, geo, { x, y: gy - 4, scale, legs: false });
    // pad glow
    ctx.fillStyle = 'rgba(255,170,80,.25)';
    ctx.beginPath(); ctx.ellipse(x, gy, geo.d * scale * 2, 5, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawPreview(canvas, design, techs) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!design.stages.length) return;
    const geo = geometry(design, techs);
    const scale = Math.min((h - 30) / (geo.total + 3), (w - 40) / geo.d);
    // human for scale (1.8 m)
    const base = h - 12;
    drawRocket(ctx, design, geo, { x: w / 2, y: base - geo.d * 0.05 * scale - 2, scale, legs: false });
    ctx.fillStyle = '#8f9ab5';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(`${Math.round(geo.total)} m tall`, 8, 16);
    ctx.fillText(`${geo.d.toFixed(1)} m wide`, 8, 30);
  }

  window.APOGEE_DRAW = { geometry, drawRocket, drawPadScene, drawPreview, starfield, skyColor, drawFlame };
})();
