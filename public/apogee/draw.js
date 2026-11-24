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

  // Cylinder shading: light from the upper left, a bright specular band, dark limb.
  function bodyGradient(ctx, r, steel) {
    const g = ctx.createLinearGradient(-r, 0, r, 0);
    if (steel) {
      g.addColorStop(0, '#4c525b'); g.addColorStop(0.16, '#8d949e'); g.addColorStop(0.36, '#dfe3e8');
      g.addColorStop(0.44, '#ffffff'); g.addColorStop(0.55, '#c9ced5'); g.addColorStop(0.82, '#7a818b'); g.addColorStop(1, '#3d424a');
    } else {
      g.addColorStop(0, '#6f757f'); g.addColorStop(0.15, '#b9bdc4'); g.addColorStop(0.36, '#f6f5f1');
      g.addColorStop(0.45, '#ffffff'); g.addColorStop(0.58, '#ecebe6'); g.addColorStop(0.84, '#a5aab2'); g.addColorStop(1, '#5d636c');
    }
    return g;
  }
  function darkGradient(ctx, r) {
    const g = ctx.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, '#0c0f15'); g.addColorStop(0.4, '#3a404c'); g.addColorStop(0.5, '#4a515e'); g.addColorStop(1, '#0c0f15');
    return g;
  }

  // Draws the stack starting at stage `from`, with the base of that stage at (0,0), growing up (negative y).
  // Options: x, y, angle, scale, from, to, flame (0..1), vac, plume (0 sea level .. 1 vacuum), noNose,
  // fins, legs (null = none, false = stowed, true = deployed), soot (0..1).
  function drawRocket(ctx, design, geo, o) {
    o = o || {};
    const from = o.from || 0;
    const to = o.to == null ? design.stages.length - 1 : o.to;
    const d = geo.d, r = d / 2;
    const sc = o.scale || 1;
    const px = 1 / sc; // one screen pixel in metres
    ctx.save();
    ctx.translate(o.x || 0, o.y || 0);
    if (o.angle) ctx.rotate(o.angle);
    ctx.scale(sc, sc);
    const steel = geo.steel;
    const body = bodyGradient(ctx, r, steel);
    const dark = darkGradient(ctx, r);
    const accent = design.color || '#ff7a1a';

    if (o.flame) drawFlame(ctx, design.stages[from], r, o.flame, { vac: o.vac, plume: o.plume || 0, px });
    drawBells(ctx, design.stages[from], r, !!o.flame);
    if (from === 0 && o.legs != null) drawLegs(ctx, r, 0, o.legs, px, 'back');

    let y = 0;
    for (let i = from; i <= to; i++) {
      const st = geo.stages[i];
      const top = y - st.h;
      ctx.fillStyle = body;
      ctx.fillRect(-r, top, d, st.h);
      // panel seams
      ctx.strokeStyle = steel ? 'rgba(20,24,30,.16)' : 'rgba(30,34,44,.10)';
      ctx.lineWidth = px;
      const seam = Math.max(d * 1.1, 2.5);
      for (let yy = y - seam; yy > top + 1; yy -= seam) { ctx.beginPath(); ctx.moveTo(-r, yy); ctx.lineTo(r, yy); ctx.stroke(); }
      if (steel) {
        // brushed steel streaks
        ctx.strokeStyle = 'rgba(255,255,255,.07)';
        for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(k * r * 0.27, y); ctx.lineTo(k * r * 0.27, top); ctx.stroke(); }
      } else {
        // a raceway along the side
        ctx.fillStyle = 'rgba(40,44,54,.18)';
        ctx.fillRect(r * 0.62, top + 0.6, r * 0.12, st.h - 1.2);
      }
      // engine section
      const skirt = Math.min(1.6, st.h * 0.09);
      ctx.fillStyle = dark; ctx.fillRect(-r, y - skirt, d, skirt);
      // interstage / top band
      if (i < design.stages.length - 1 || !o.noNose) {
        const band = Math.min(1.4, st.h * 0.1);
        ctx.fillStyle = steel ? 'rgba(25,28,34,.35)' : dark;
        ctx.fillRect(-r, top, d, band);
      }
      if (i === 0) {
        // accent stripe and vertical name
        ctx.fillStyle = accent;
        ctx.fillRect(-r, top + st.h * 0.40, d, Math.max(0.35, st.h * 0.022));
        ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
        ctx.fillRect(-r, top + st.h * 0.40, d * 0.14, Math.max(0.35, st.h * 0.022));
        ctx.fillRect(r - d * 0.16, top + st.h * 0.40, d * 0.16, Math.max(0.35, st.h * 0.022));
        ctx.globalAlpha = 1;
        if (st.h > d * 5) {
          ctx.save();
          ctx.translate(-r * 0.05, top + st.h * 0.70);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = steel ? 'rgba(20,24,30,.55)' : 'rgba(26,30,40,.8)';
          ctx.font = `800 ${d * 0.46}px -apple-system, Segoe UI, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('APOGEE', 0, 0);
          ctx.restore();
        }
        if (o.soot) {
          const sg = ctx.createLinearGradient(0, y, 0, y - st.h * 0.75);
          sg.addColorStop(0, `rgba(30,22,16,${0.85 * o.soot})`);
          sg.addColorStop(0.35, `rgba(45,34,24,${0.45 * o.soot})`);
          sg.addColorStop(1, 'rgba(45,34,24,0)');
          ctx.fillStyle = sg; ctx.fillRect(-r, y - st.h * 0.75, d, st.h * 0.75);
        }
        if (o.fins) drawFins(ctx, r, top + 1.2, px);
      }
      y = top;
    }
    if (from === 0 && o.legs != null) drawLegs(ctx, r, 0, o.legs, px, 'front');
    if (to === design.stages.length - 1 && !o.noNose) {
      const h = geo.nose;
      ctx.beginPath();
      ctx.moveTo(-r, y);
      ctx.bezierCurveTo(-r, y - h * 0.55, -r * 0.32, y - h * 0.96, 0, y - h);
      ctx.bezierCurveTo(r * 0.32, y - h * 0.96, r, y - h * 0.55, r, y);
      ctx.closePath();
      ctx.fillStyle = body; ctx.fill();
      // fairing seam and tip
      ctx.strokeStyle = 'rgba(30,34,44,.25)'; ctx.lineWidth = px;
      ctx.beginPath(); ctx.moveTo(-r * 0.06, y); ctx.lineTo(-r * 0.06, y - h * 0.93); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(-r, y - h * 0.14, d, Math.max(0.25, h * 0.035));
      const tg = ctx.createRadialGradient(-r * 0.15, y - h * 0.88, 0, 0, y - h * 0.9, r * 0.6);
      tg.addColorStop(0, 'rgba(255,255,255,.6)'); tg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(0, y - h * 0.88, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function bellLayout(st, r) {
    const n = Math.min(st.count, 9);
    const vac = S.ENGINES[st.engine].vac;
    const cols = n <= 3 ? n : Math.min(n, Math.ceil(Math.sqrt(n)) + (n > 4 ? 1 : 0));
    const bw = Math.min((r * 2) / Math.max(1, cols) * 0.92, r * (vac ? 1.5 : 1.1));
    const h = vac ? bw * 1.5 : bw * 0.95;
    const step = cols > 1 ? (r * 2 - bw) / (cols - 1) : 0;
    const xs = [];
    for (let k = 0; k < cols; k++) xs.push(cols === 1 ? 0 : -r + bw / 2 + k * step);
    return { xs, bw, h, vac };
  }

  function drawBells(ctx, st, r, firing) {
    const { xs, bw, h, vac } = bellLayout(st, r);
    for (const cx of xs) {
      const g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      if (vac) { g.addColorStop(0, '#2a2420'); g.addColorStop(0.35, '#8a6f55'); g.addColorStop(0.5, '#b08d68'); g.addColorStop(1, '#2a2420'); }
      else { g.addColorStop(0, '#1b1d22'); g.addColorStop(0.35, '#6a707b'); g.addColorStop(0.5, '#8c939e'); g.addColorStop(1, '#1b1d22'); }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - bw * 0.18, 0);
      ctx.quadraticCurveTo(cx - bw * 0.22, h * 0.55, cx - bw * 0.5, h);
      ctx.lineTo(cx + bw * 0.5, h);
      ctx.quadraticCurveTo(cx + bw * 0.22, h * 0.55, cx + bw * 0.18, 0);
      ctx.closePath();
      ctx.fill();
      // rim
      ctx.fillStyle = firing ? 'rgba(255,196,120,.95)' : '#0d0f13';
      ctx.beginPath(); ctx.ellipse(cx, h, bw * 0.5, Math.max(0.08, bw * 0.08), 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Layered, additive rocket plume. plume: 0 at sea level (tight, shock diamonds) .. 1 in vacuum (wide, faint).
  function drawFlame(ctx, st, r, power, o) {
    o = o || {};
    const t = performance.now() / 1000;
    const vac = o.vac || o.plume > 0.75;
    const plume = Math.max(0, Math.min(1, o.plume || 0));
    const flick = 0.92 + Math.sin(t * 47) * 0.04 + Math.random() * 0.07;
    const { bw, h } = bellLayout(st, r);
    const exitY = h;
    const w0 = Math.max(r * 1.9, bw);
    const len = (r * 7 + 8) * power * flick * (1 + plume * 0.6);
    const spread = 1 + plume * 3.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // glow halo
    const halo = ctx.createRadialGradient(0, exitY + len * 0.15, 0, 0, exitY + len * 0.15, len * 0.75);
    halo.addColorStop(0, `rgba(255,170,80,${0.32 * power})`);
    halo.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, exitY + len * 0.15, len * 0.75, 0, Math.PI * 2); ctx.fill();
    // outer plume
    const outer = ctx.createLinearGradient(0, exitY, 0, exitY + len);
    outer.addColorStop(0, `rgba(255,236,190,${0.85 - plume * 0.35})`);
    outer.addColorStop(0.25, `rgba(255,170,70,${0.6 - plume * 0.3})`);
    outer.addColorStop(0.7, `rgba(255,90,30,${0.25 - plume * 0.12})`);
    outer.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(-w0 / 2, exitY);
    ctx.bezierCurveTo(-w0 * 0.6 * spread, exitY + len * 0.3, -w0 * 0.3 * spread, exitY + len * 0.8, 0, exitY + len);
    ctx.bezierCurveTo(w0 * 0.3 * spread, exitY + len * 0.8, w0 * 0.6 * spread, exitY + len * 0.3, w0 / 2, exitY);
    ctx.closePath(); ctx.fill();
    // hot core
    const coreLen = len * (0.45 + plume * 0.2);
    const core = ctx.createLinearGradient(0, exitY, 0, exitY + coreLen);
    core.addColorStop(0, 'rgba(255,255,255,.95)');
    core.addColorStop(0.4, vac ? 'rgba(190,210,255,.6)' : 'rgba(255,240,200,.7)');
    core.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(-w0 * 0.38, exitY);
    ctx.quadraticCurveTo(-w0 * 0.3, exitY + coreLen * 0.6, 0, exitY + coreLen);
    ctx.quadraticCurveTo(w0 * 0.3, exitY + coreLen * 0.6, w0 * 0.38, exitY);
    ctx.closePath(); ctx.fill();
    // shock diamonds near sea level
    const dA = Math.max(0, 1 - plume * 4) * power;
    if (dA > 0.02) {
      for (let k = 0; k < 5; k++) {
        const yy = exitY + w0 * (0.55 + k * 0.72);
        if (yy > exitY + len * 0.85) break;
        const rr = w0 * 0.2 * (1 - k * 0.14);
        const dg = ctx.createRadialGradient(0, yy, 0, 0, yy, rr * 1.6);
        dg.addColorStop(0, `rgba(255,255,240,${0.9 * dA})`);
        dg.addColorStop(0.5, `rgba(255,200,150,${0.45 * dA})`);
        dg.addColorStop(1, 'rgba(255,160,90,0)');
        ctx.fillStyle = dg;
        ctx.beginPath(); ctx.ellipse(0, yy, rr * 1.2, rr * 1.7, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // faint vacuum bloom
    if (plume > 0.4) {
      const vb = ctx.createRadialGradient(0, exitY, 0, 0, exitY, len * 1.1);
      vb.addColorStop(0, `rgba(170,190,255,${0.22 * plume * power})`);
      vb.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.fillStyle = vb;
      ctx.beginPath();
      ctx.moveTo(0, exitY); ctx.lineTo(-len * 0.9, exitY + len * 1.1); ctx.lineTo(len * 0.9, exitY + len * 1.1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawFins(ctx, r, y, px) {
    const s = Math.max(0.9, r * 0.55);
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -r - s : r;
      ctx.fillStyle = '#2b2f38'; ctx.fillRect(x0, y, s, s * 0.85);
      ctx.strokeStyle = '#8b919c'; ctx.lineWidth = Math.max(px, s * 0.06);
      ctx.strokeRect(x0, y, s, s * 0.85);
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        ctx.moveTo(x0 + (s * k) / 4, y); ctx.lineTo(x0 + (s * k) / 4, y + s * 0.85);
        ctx.moveTo(x0, y + (s * 0.85 * k) / 4); ctx.lineTo(x0 + s, y + (s * 0.85 * k) / 4);
      }
      ctx.stroke();
    }
  }

  function drawLegs(ctx, r, y, deployed, px, layer) {
    const len = r * 2.6 + 2;
    const w = Math.max(px * 2, r * 0.2);
    const sides = layer === 'back' ? [] : [-1, 1];
    for (const side of sides) {
      ctx.save();
      if (deployed) {
        const ax = side * r, ay = y - len * 0.72;
        const fx = side * (r + len * 0.58), fy = y + 1.6;
        // strut
        ctx.strokeStyle = '#15181e'; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.strokeStyle = 'rgba(160,168,180,.35)'; ctx.lineWidth = w * 0.3;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(fx, fy); ctx.stroke();
        // brace
        ctx.strokeStyle = '#2a2e36'; ctx.lineWidth = w * 0.45;
        ctx.beginPath(); ctx.moveTo(side * r, y - 0.6); ctx.lineTo((ax + fx) / 2, (ay + fy) / 2); ctx.stroke();
        // foot pad
        ctx.fillStyle = '#20242c';
        ctx.beginPath(); ctx.ellipse(fx, fy, w * 1.6, w * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#1a1d24';
        ctx.fillRect(side > 0 ? r - w * 0.4 : -r - w * 0.6, y - len * 0.9, w, len * 0.9 - 0.4);
      }
      ctx.restore();
    }
  }

  // Starfield cache
  let stars = null;
  function starfield(w, h) {
    if (!stars || stars.w !== w || stars.h !== h) {
      const pts = [];
      for (let i = 0; i < Math.floor(w * h / 1500); i++) pts.push([Math.random() * w, Math.random() * h, Math.random() * 1.4 + 0.25, Math.random(), Math.random() * 6.28]);
      stars = { w, h, pts };
    }
    return stars.pts;
  }
  function drawStars(ctx, w, h, alpha, maxY) {
    if (alpha <= 0) return;
    const t = performance.now() / 1000;
    for (const [x, y, s, a, ph] of starfield(w, h)) {
      if (maxY && y > maxY) continue;
      const tw = 0.75 + 0.25 * Math.sin(t * 2 + ph * 3);
      ctx.fillStyle = `rgba(${a > 0.85 ? '200,215,255' : a < 0.1 ? '255,225,200' : '255,255,255'},${alpha * (0.25 + a * 0.75) * tw})`;
      ctx.fillRect(x, y, s, s);
    }
  }

  function lerpC(a, b, k) { return a.map((v, i) => Math.round(v + (b[i] - v) * k)); }
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  // Sky colours by altitude (km): returns [top, middle, horizon].
  function skyColors(alt) {
    const k = Math.max(0, Math.min(1, alt / 55));
    const e = k * k * (3 - 2 * k);
    return [
      rgb(lerpC([52, 104, 186], [1, 2, 8], e)),
      rgb(lerpC([118, 168, 226], [3, 6, 18], e)),
      rgb(lerpC([244, 205, 160], [12, 22, 48], Math.min(1, e * 1.3))),
    ];
  }
  function skyColor(alt) { const c = skyColors(alt); return [c[0], c[2]]; }

  // Deterministic mountain ridge.
  function ridge(seed, n) {
    const pts = [];
    let a = seed;
    const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i <= n; i++) pts.push(0.35 + rnd() * 0.65);
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < n; i++) pts[i] = (pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4;
    return pts;
  }
  const RIDGES = [ridge(7, 24), ridge(91, 36)];
  function drawRidge(ctx, w, baseY, height, color, which, shift) {
    const pts = RIDGES[which];
    const n = pts.length - 1;
    const step = (w * 1.4) / n;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w * 0.2 - (shift || 0), baseY + 2);
    for (let i = 0; i <= n; i++) ctx.lineTo(-w * 0.2 + i * step - (shift || 0), baseY - pts[i] * height);
    ctx.lineTo(w * 1.2, baseY + 2);
    ctx.closePath(); ctx.fill();
  }

  // Lattice tower with cross bracing and a warning light.
  function drawTower(ctx, x, groundY, w, h, t) {
    ctx.fillStyle = '#1c2133';
    ctx.fillRect(x, groundY - h, w, h);
    ctx.strokeStyle = 'rgba(120,135,170,.35)';
    ctx.lineWidth = 1;
    const seg = Math.max(6, w * 1.1);
    ctx.beginPath();
    for (let yy = groundY - h; yy < groundY; yy += seg) {
      ctx.moveTo(x, yy); ctx.lineTo(x + w, yy + seg);
      ctx.moveTo(x + w, yy); ctx.lineTo(x, yy + seg);
      ctx.moveTo(x, yy); ctx.lineTo(x + w, yy);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,165,200,.25)';
    ctx.fillRect(x, groundY - h, 1.5, h); ctx.fillRect(x + w - 1.5, groundY - h, 1.5, h);
    const on = Math.sin((t || performance.now() / 1000) * 3) > 0;
    if (on) {
      const g = ctx.createRadialGradient(x + w / 2, groundY - h - 3, 0, x + w / 2, groundY - h - 3, 9);
      g.addColorStop(0, 'rgba(255,80,80,1)'); g.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + w / 2, groundY - h - 3, 9, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A small scene of the rocket standing on the pad (used on the Launch tab).
  function drawPadScene(canvas, design, techs) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gy = h - 26;
    const g = ctx.createLinearGradient(0, 0, 0, gy);
    g.addColorStop(0, '#070b1a'); g.addColorStop(0.55, '#1b2a55'); g.addColorStop(0.85, '#7a5a7e'); g.addColorStop(1, '#f0a066');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    drawStars(ctx, w, h, 1, h * 0.55);
    // setting sun glow
    const sun = ctx.createRadialGradient(w * 0.2, gy, 0, w * 0.2, gy, h * 0.9);
    sun.addColorStop(0, 'rgba(255,190,120,.55)'); sun.addColorStop(1, 'rgba(255,150,90,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
    drawRidge(ctx, w, gy, h * 0.18, '#2b2a4a', 0, 0);
    drawRidge(ctx, w, gy, h * 0.1, '#1a1c33', 1, w * 0.1);
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = 'rgba(255,190,130,.25)'; ctx.fillRect(0, gy, w, 1);
    if (!design) return;
    const geo = geometry(design, techs);
    const scale = Math.min((h - 54) / geo.total, (w * 0.25) / geo.d);
    const x = w * 0.62;
    const rw = geo.d * scale;
    // floodlight beams
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fx of [x - rw * 4 - 40, x + rw * 4 + 40]) {
      const bg = ctx.createLinearGradient(fx, gy, x, gy - geo.total * scale * 0.6);
      bg.addColorStop(0, 'rgba(200,215,255,.22)'); bg.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(fx, gy - 6); ctx.lineTo(x - rw * 0.8, gy - geo.total * scale * 0.85); ctx.lineTo(x + rw * 0.8, gy - geo.total * scale * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(230,240,255,.9)'; ctx.fillRect(fx - 2, gy - 8, 4, 3);
    }
    ctx.restore();
    const tw = Math.max(9, rw * 0.7);
    drawTower(ctx, x - rw / 2 - tw - 8, gy, tw, geo.total * scale * 1.06);
    // crew/service arm
    ctx.fillStyle = '#2a3150';
    ctx.fillRect(x - rw / 2 - 8, gy - geo.total * scale * 0.82, 8, 3);
    // pad deck
    ctx.fillStyle = '#2a3046'; ctx.fillRect(x - rw * 2.2, gy - 4, rw * 4.4, 4);
    drawRocket(ctx, design, geo, { x, y: gy - 4, scale, legs: false });
    // venting vapour
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let k = 0; k < 6; k++) {
      const vy = gy - geo.stages[0].h * scale * (0.3 + k * 0.1);
      const vg = ctx.createRadialGradient(x + rw * 0.8, vy, 0, x + rw * 0.8, vy, 10 + k * 3);
      vg.addColorStop(0, 'rgba(235,240,255,.6)'); vg.addColorStop(1, 'rgba(235,240,255,0)');
      ctx.fillStyle = vg; ctx.beginPath(); ctx.arc(x + rw * 0.8 + k * 3, vy, 10 + k * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // ground lights
    const pg = ctx.createRadialGradient(x, gy, 0, x, gy, rw * 3);
    pg.addColorStop(0, 'rgba(255,190,120,.35)'); pg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, gy, rw * 3, 7, 0, 0, Math.PI * 2); ctx.fill();
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
    const base = h - 12;
    // soft studio light behind the rocket
    const lg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.6);
    lg.addColorStop(0, 'rgba(120,150,220,.18)'); lg.addColorStop(1, 'rgba(120,150,220,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(w / 2, base, geo.d * scale * 1.2, 4, 0, 0, Math.PI * 2); ctx.fill();
    drawRocket(ctx, design, geo, { x: w / 2, y: base - geo.d * 0.05 * scale - 2, scale, legs: false });
    ctx.fillStyle = '#8f9ab5';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(`${Math.round(geo.total)} m tall`, 8, 16);
    ctx.fillText(`${geo.d.toFixed(1)} m wide`, 8, 30);
  }

  window.APOGEE_DRAW = { geometry, drawRocket, drawPadScene, drawPreview, starfield, drawStars, skyColor, skyColors, drawFlame, drawRidge, drawTower, bellLayout };
})();
