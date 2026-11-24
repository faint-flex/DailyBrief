// 3D rocket module: overrides buildRocket / setPlume / setLegs on window.APOGEE_3D (loaded after world3d.js),
// and adds setFins(st, k). Everything is procedural (canvas textures + three.js primitives).
(function () {
  'use strict';
  const A = window.APOGEE_3D;
  if (!A) return;
  const T = window.THREE, S = window.APOGEE_SIM, D = window.APOGEE_DRAW;
  const TAU = Math.PI * 2;
  const small = () => !!(A.R && A.R.small);

  // ---------- helpers ----------
  function rand(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, color) {
    const t = new T.CanvasTexture(c);
    if (color) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = small() ? 2 : 8;
    return t;
  }
  const grey = (v, a) => { const k = Math.round(Math.max(0, Math.min(1, v)) * 255); return a == null ? `rgb(${k},${k},${k})` : `rgba(${k},${k},${k},${a})`; };
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // Smooth value-noise blotches: a tiny random grid scaled up with bilinear filtering.
  function blotch(g, W, H, seed, cells, alpha, mode) {
    const r = rand(seed);
    const cw = Math.max(2, Math.round(cells)), ch = Math.max(2, Math.round(cells * H / W));
    const c = canvas(cw, ch), cg = c.getContext('2d'), img = cg.createImageData(cw, ch);
    for (let i = 0; i < cw * ch; i++) { const v = r() * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    cg.putImageData(img, 0, 0);
    g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = mode || 'overlay'; g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, W, H); g.restore();
  }
  // Extra maps are not freed by disposeScene (it only frees .map), so free them with the material.
  function autoDispose(mat) {
    mat.addEventListener('dispose', () => { for (const k of ['roughnessMap', 'bumpMap', 'emissiveMap', 'alphaMap']) if (mat[k]) mat[k].dispose(); });
    return mat;
  }
  function stdMat(o) { return autoDispose(new T.MeshStandardMaterial(o)); }

  // Shared materials live in the mats() object so disposeScene never frees them.
  function shared() {
    const M = A.mats();
    if (M.rk_ready) return M;
    M.rk_ready = true;
    M.rk_carbon = new T.MeshStandardMaterial({ color: 0x17181c, roughness: 0.55, metalness: 0.25 });
    M.rk_dark = new T.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.6, metalness: 0.6 });
    M.rk_metal = new T.MeshStandardMaterial({ color: 0x8d9198, roughness: 0.35, metalness: 0.9 });
    M.rk_chrome = new T.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.15, metalness: 1 });
    M.rk_paint = new T.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.5, metalness: 0.05 });
    M.rk_steel = new T.MeshStandardMaterial({ color: 0xc0c5cc, roughness: 0.3, metalness: 1 });
    M.rk_ti = new T.MeshStandardMaterial({ color: 0x5f636a, roughness: 0.42, metalness: 0.9 });
    M.rk_white = new T.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.55, metalness: 0 });
    M.rk_heat = new T.MeshStandardMaterial({ color: 0x1d1b1a, roughness: 0.9, metalness: 0.1 });
    // grid fin lattice (diagonal waffle), alpha-tested
    const c = canvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#fff'; g.lineWidth = 5;
    for (let k = -128; k <= 256; k += 21) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke();
      g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke();
    }
    g.lineWidth = 10; g.strokeRect(0, 0, 128, 128);
    const at = new T.CanvasTexture(c);
    M.rk_lattice = new T.MeshStandardMaterial({ color: 0x5f636a, roughness: 0.42, metalness: 0.9, side: T.DoubleSide, alphaMap: at, alphaTest: 0.5 });
    // base heat shield blanket
    const hc = canvas(256, 256), hg = hc.getContext('2d');
    hg.fillStyle = '#3a3836'; hg.fillRect(0, 0, 256, 256);
    blotch(hg, 256, 256, 41, 18, 0.35);
    hg.strokeStyle = 'rgba(0,0,0,.35)'; hg.lineWidth = 1;
    for (let k = 0; k < 256; k += 16) { hg.beginPath(); hg.moveTo(k, 0); hg.lineTo(k, 256); hg.moveTo(0, k); hg.lineTo(256, k); hg.stroke(); }
    M.rk_heat.map = tex(hc, true);
    return M;
  }

  // ---------- body textures ----------
  // Paints colour, roughness and bump canvases for one stage, in metre space (u around, v up).
  function paintStage(p) {
    const W = p.W, circ = TAU * p.r;
    const H = Math.min(small() ? 1024 : 2048, Math.max(64, Math.round(W * p.h / circ)));
    const sx = W / circ, sy = H / p.h;
    const col = canvas(W, H), rgh = canvas(W, H), bmp = canvas(W, H);
    const gc = col.getContext('2d'), gr = rgh.getContext('2d'), gb = bmp.getContext('2d');
    const Y = (m) => H - m * sy; // metres above the stage base -> px
    const lw = (m) => Math.max(1, m * sy);
    const rr = rand(p.seed);
    const steel = p.steel;
    gc.fillStyle = steel ? '#c4c9cf' : '#efeee9'; gc.fillRect(0, 0, W, H);
    gr.fillStyle = grey(steel ? 0.32 : 0.5); gr.fillRect(0, 0, W, H);
    gb.fillStyle = grey(0.5); gb.fillRect(0, 0, W, H);
    blotch(gc, W, H, p.seed + 1, 9, steel ? 0.22 : 0.07);
    blotch(gc, W, H, p.seed + 2, 40, steel ? 0.12 : 0.04);
    blotch(gr, W, H, p.seed + 3, 14, 0.35);
    blotch(gr, W, H, p.seed + 4, 60, 0.2);
    const bodyTop = p.h - (p.inter || 0);
    if (steel) {
      // welded rings of rolled sheet: tint per ring, brushed grain, horizontal and staggered vertical welds
      const ringH = 1.83;
      for (let ym = 0; ym < bodyTop; ym += ringH) {
        const y0 = Y(Math.min(bodyTop, ym + ringH)), y1 = Y(ym), hh = y1 - y0;
        const warm = rr() < 0.5;
        gc.fillStyle = warm ? `rgba(190,170,140,${0.05 + rr() * 0.08})` : `rgba(140,160,190,${0.04 + rr() * 0.08})`;
        gc.fillRect(0, y0, W, hh);
        gr.fillStyle = grey(0.2 + rr() * 0.25, 0.5); gr.fillRect(0, y0, W, hh);
        const n = small() ? 50 : 120;
        for (let k = 0; k < n; k++) {
          gc.fillStyle = rr() < 0.5 ? `rgba(255,255,255,${0.04 + rr() * 0.07})` : `rgba(70,76,86,${0.04 + rr() * 0.07})`;
          gc.fillRect(rr() * W, y0, 1 + rr() * 2.5, hh);
        }
        gc.fillStyle = 'rgba(95,85,70,.55)'; gc.fillRect(0, y1 - lw(0.03), W, lw(0.03));
        gc.fillStyle = 'rgba(255,250,240,.35)'; gc.fillRect(0, y1 - lw(0.03) - 1, W, 1);
        gb.fillStyle = grey(0.78); gb.fillRect(0, y1 - lw(0.04), W, lw(0.04));
        gr.fillStyle = grey(0.65); gr.fillRect(0, y1 - lw(0.03), W, lw(0.03));
        for (let s = 0; s < 3; s++) {
          const x = ((s + rr() * 0.6) / 3) * W;
          gc.fillStyle = 'rgba(95,85,70,.45)'; gc.fillRect(x, y0, Math.max(1, lw(0.025) * W / H * (sy / sx)), hh);
          gb.fillStyle = grey(0.72); gb.fillRect(x, y0, 2, hh);
        }
      }
    } else {
      // painted aluminium-lithium tank: panel rings, faint stringer seams, light grime streaks
      const pl = 2.4 + rr() * 0.8;
      for (let ym = pl; ym < bodyTop - 0.3; ym += pl) {
        const y = Y(ym);
        gc.fillStyle = 'rgba(70,74,82,.32)'; gc.fillRect(0, y, W, lw(0.018));
        gb.fillStyle = grey(0.25); gb.fillRect(0, y, W, Math.max(2, lw(0.03)));
        gr.fillStyle = grey(0.72); gr.fillRect(0, y, W, lw(0.03));
      }
      for (let s = 0; s < 4; s++) {
        const x = (s / 4 + 0.06) * W;
        gc.fillStyle = 'rgba(70,74,82,.12)'; gc.fillRect(x, Y(bodyTop), 1, H);
        gb.fillStyle = grey(0.38); gb.fillRect(x, Y(bodyTop), 1, H);
      }
      for (let k = 0; k < 40; k++) {
        const x = rr() * W, y = rr() * H, l = (0.5 + rr() * 4) * sy;
        const sg = gc.createLinearGradient(0, y, 0, y + l);
        sg.addColorStop(0, 'rgba(120,115,105,0)'); sg.addColorStop(0.3, `rgba(120,115,105,${0.03 + rr() * 0.05})`); sg.addColorStop(1, 'rgba(120,115,105,0)');
        gc.fillStyle = sg; gc.fillRect(x, y, 1 + rr() * 3, l);
      }
    }
    // interstage band at the top of lower stages
    if (p.inter) {
      const y1 = Y(bodyTop);
      if (!steel) {
        gc.fillStyle = '#1b1c20'; gc.fillRect(0, 0, W, y1);
        blotch(gc, W, y1, p.seed + 5, 30, 0.12);
        for (let x = 0; x < W; x += 3) { gc.fillStyle = `rgba(255,255,255,${(x / 3) % 2 ? 0.015 : 0.03})`; gc.fillRect(x, 0, 2, y1); }
        gr.fillStyle = grey(0.6); gr.fillRect(0, 0, W, y1);
        gb.fillStyle = grey(0.5); gb.fillRect(0, 0, W, y1);
      } else {
        // hot-staging vent ring
        const n = Math.max(8, Math.round(circ / 1.3));
        const vy0 = Y(p.h - p.inter * 0.25), vy1 = Y(bodyTop + p.inter * 0.25);
        for (let k = 0; k < n; k++) {
          const x = (k / n) * W, w = (0.55 / circ) * W;
          gc.fillStyle = '#16171a'; gc.fillRect(x, vy0, w, vy1 - vy0);
          gb.fillStyle = grey(0.15); gb.fillRect(x, vy0, w, vy1 - vy0);
          gr.fillStyle = grey(0.85); gr.fillRect(x, vy0, w, vy1 - vy0);
        }
      }
      gb.fillStyle = grey(0.2); gb.fillRect(0, y1 - 1, W, Math.max(2, lw(0.03)));
      gc.fillStyle = 'rgba(0,0,0,.5)'; gc.fillRect(0, y1 - 1, W, Math.max(1, lw(0.02)));
    }
    // player accent band (+ a thin pinstripe so it reads by shape, not only colour)
    if (p.accent) {
      const top = p.inter ? bodyTop - 0.7 : p.h - 0.9;
      const bandH = Math.min(0.55, p.h * 0.03);
      gc.fillStyle = p.accent; gc.fillRect(0, Y(top), W, bandH * sy);
      gc.fillRect(0, Y(top - bandH - 0.22), W, Math.max(1, 0.08 * sy));
      gr.fillStyle = grey(0.42); gr.fillRect(0, Y(top), W, bandH * sy);
      gb.fillStyle = grey(0.56); gb.fillRect(0, Y(top), W, bandH * sy);
    }
    // the APOGEE wordmark, written up the booster, facing +z
    if (p.wordmark) {
      gc.save();
      gc.setTransform(sx / 100, 0, 0, sy / 100, 0, 0); // centimetre space
      let fm = Math.min(p.r * 0.62, 2.4) * 100;
      gc.font = `900 ${fm}px -apple-system, "Segoe UI", Arial, sans-serif`;
      const txt = 'A P O G E E';
      const wTxt = gc.measureText(txt).width;
      const maxL = bodyTop * 0.5 * 100;
      if (wTxt > maxL) { fm *= maxL / wTxt; gc.font = `900 ${fm}px -apple-system, "Segoe UI", Arial, sans-serif`; }
      gc.translate(circ * 0.5 * 100, (p.h - bodyTop * 0.56) * 100);
      gc.rotate(-Math.PI / 2);
      gc.textAlign = 'center'; gc.textBaseline = 'middle';
      gc.fillStyle = steel ? 'rgba(22,24,30,.78)' : '#1b1f29';
      gc.fillText(txt, 0, 0);
      gc.restore();
    }
    // soot from a reflown booster: heavy at the base, streaks climbing the tank, a dirty windward side
    if (p.soot) {
      if (steel) {
        const hg = gc.createLinearGradient(0, H, 0, Y(p.h * 0.5));
        hg.addColorStop(0, 'rgba(40,30,22,.85)'); hg.addColorStop(0.12, 'rgba(120,80,40,.5)'); hg.addColorStop(0.3, 'rgba(70,70,120,.25)'); hg.addColorStop(1, 'rgba(70,70,120,0)');
        gc.fillStyle = hg; gc.fillRect(0, 0, W, H);
      } else {
        const sg = gc.createLinearGradient(0, H, 0, Y(p.h * 0.65));
        sg.addColorStop(0, 'rgba(24,19,14,.95)'); sg.addColorStop(0.18, 'rgba(38,30,22,.7)'); sg.addColorStop(0.55, 'rgba(60,48,36,.25)'); sg.addColorStop(1, 'rgba(60,48,36,0)');
        gc.fillStyle = sg; gc.fillRect(0, 0, W, H);
      }
      const side = gc.createLinearGradient(0, 0, W, 0);
      side.addColorStop(0, 'rgba(40,32,24,0)'); side.addColorStop(0.15, 'rgba(40,32,24,.28)'); side.addColorStop(0.4, 'rgba(40,32,24,.1)'); side.addColorStop(0.55, 'rgba(40,32,24,0)');
      gc.fillStyle = side; gc.fillRect(0, Y(bodyTop), W, H - Y(bodyTop));
      const n = small() ? 70 : 160;
      for (let k = 0; k < n; k++) {
        const x = rr() * W, l = (1 + rr() * p.h * 0.55) * sy, w = 1 + rr() * 5;
        const sg = gc.createLinearGradient(0, H, 0, H - l);
        const a = 0.08 + rr() * 0.3;
        sg.addColorStop(0, `rgba(26,20,15,${a})`); sg.addColorStop(1, 'rgba(26,20,15,0)');
        gc.fillStyle = sg; gc.fillRect(x, H - l, w, l);
      }
      blotch(gc, W, H, p.seed + 9, 22, 0.25, 'multiply');
      const rg = gr.createLinearGradient(0, H, 0, Y(p.h * 0.6));
      rg.addColorStop(0, grey(0.95, 0.9)); rg.addColorStop(1, grey(0.95, 0));
      gr.fillStyle = rg; gr.fillRect(0, 0, W, H);
    }
    // aft band
    if (p.booster) {
      gc.fillStyle = steel ? 'rgba(60,55,50,.6)' : 'rgba(30,30,34,.85)'; gc.fillRect(0, Y(0.35), W, 0.35 * sy);
      gb.fillStyle = grey(0.3); gb.fillRect(0, Y(0.35), W, 2);
    }
    return { map: tex(col, true), rough: tex(rgh, false), bump: tex(bmp, false) };
  }

  function bodyMaterial(p) {
    const t = paintStage(p);
    return stdMat({
      color: 0xffffff, map: t.map, roughnessMap: t.rough, bumpMap: t.bump, bumpScale: p.steel ? 0.6 : 0.5,
      roughness: 1, metalness: p.steel ? 1 : 0.02, envMapIntensity: p.steel ? 1 : 0.7,
    });
  }

  // ---------- engines ----------
  function enginePositions(n, r, vac) {
    const pts = [];
    if (n === 1) return { pts: [[0, 0]], bw: r * (vac ? 1.55 : 1.0) };
    if (n <= 9) {
      const ring = n >= 5 ? n - 1 : n;
      if (n >= 5) pts.push([0, 0]);
      const rr = r * (n >= 5 ? 0.62 : 0.45);
      for (let i = 0; i < ring; i++) { const a = (i / ring) * Math.PI * 2; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      return { pts, bw: Math.min(r * 0.62, ((2 * Math.PI * rr) / ring) * 0.88) };
    }
    const inner = Math.max(3, Math.round(n * 0.25));
    const outer = n - inner;
    const r1 = r * 0.33, r2 = r * 0.8;
    for (let i = 0; i < inner; i++) { const a = (i / inner) * Math.PI * 2; pts.push([Math.cos(a) * r1, Math.sin(a) * r1]); }
    for (let i = 0; i < outer; i++) { const a = (i / outer) * Math.PI * 2 + 0.1; pts.push([Math.cos(a) * r2, Math.sin(a) * r2]); }
    return { pts, bw: Math.min(r * 0.42, ((2 * Math.PI * r2) / outer) * 0.9) };
  }

  // Chamber + throat + Rao-like bell. Points run top (engine mount) to exit.
  function bellProfile(bw, vac, kero) {
    const re = bw * 0.48;
    const rt = vac ? bw * 0.1 : bw * (kero ? 0.2 : 0.17);
    const rc = rt * 1.6;
    const c = bw * (vac ? 0.24 : 0.3);
    const hb = bw * (vac ? 1.6 : kero ? 1.12 : 0.95);
    const pts = [[rc * 0.85, 0], [rc, -c * 0.12], [rc, -c * 0.55], [rt * 1.2, -c * 0.85], [rt, -c]];
    const nThroat = pts.length - 1;
    const N = small() ? 12 : 18;
    for (let i = 1; i <= N; i++) {
      const k = i / N;
      pts.push([rt + (re - rt) * (0.84 * (1 - Math.pow(1 - k, 2.3)) + 0.16 * k), -c - k * hb]);
    }
    pts.push([re * 1.025, -c - hb]); // exit lip
    const v = (j) => j / (pts.length - 1);
    return { pts, re, rt, rc, c, hb, bh: c + hb, vThroat: v(nThroat), vExt: v(nThroat + Math.round(N * 0.3)) };
  }

  function bellTextures(prof, vac, kero) {
    const W = 256, H = 128;
    const col = canvas(W, H), em = canvas(W, H), rg = canvas(W, H);
    const gc = col.getContext('2d'), ge = em.getContext('2d'), gr = rg.getContext('2d');
    const py = (v) => H * (1 - v); // canvas row for lathe v (canvas top = exit)
    const tubeCol = vac ? '#a27b58' : kero ? '#6e5e52' : '#9a9da4';
    gc.fillStyle = tubeCol; gc.fillRect(0, 0, W, H);
    gr.fillStyle = grey(0.35); gr.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    // regen tubes
    for (let x = 0; x < W; x += 2) { gc.fillStyle = 'rgba(0,0,0,.18)'; gc.fillRect(x, 0, 1, H); }
    for (let x = 1; x < W; x += 4) { gc.fillStyle = 'rgba(255,255,255,.08)'; gc.fillRect(x, 0, 1, H); }
    // chamber / powerhead region darker
    gc.fillStyle = 'rgba(30,30,34,.55)'; gc.fillRect(0, py(prof.vThroat), W, H - py(prof.vThroat));
    // throat ring
    gc.fillStyle = 'rgba(255,240,220,.25)'; gc.fillRect(0, py(prof.vThroat) - 2, W, 3);
    if (vac) {
      // radiatively cooled extension: dark coated niobium, hot near its top
      const y = py(prof.vExt);
      const g = gc.createLinearGradient(0, y, 0, 0);
      g.addColorStop(0, '#3a3633'); g.addColorStop(1, '#25272b');
      gc.fillStyle = g; gc.fillRect(0, 0, W, y);
      gc.fillStyle = '#c9a070'; gc.fillRect(0, y - 2, W, 3); // flange
      for (let k = 1; k < 4; k++) { gc.fillStyle = 'rgba(255,255,255,.07)'; gc.fillRect(0, y * k / 4, W, 1); }
      gr.fillStyle = grey(0.62); gr.fillRect(0, 0, W, y);
      const e = ge.createLinearGradient(0, y, 0, 0);
      e.addColorStop(0, '#ffffff'); e.addColorStop(0.5, '#7a7a7a'); e.addColorStop(1, '#1c1c1c');
      ge.fillStyle = e; ge.fillRect(0, 0, W, y);
    } else {
      if (kero) { blotch(gc, W, H, 77, 16, 0.35, 'multiply'); }
      gc.fillStyle = kero ? '#4a3f37' : '#c5c8ce'; gc.fillRect(0, 0, W, 4); // exit manifold
      const e = ge.createLinearGradient(0, 0, 0, H * 0.25);
      e.addColorStop(0, '#5a5a5a'); e.addColorStop(1, '#000');
      ge.fillStyle = e; ge.fillRect(0, 0, W, H * 0.25);
    }
    return { map: tex(col, true), emissiveMap: tex(em, true), rough: tex(rg, false) };
  }

  // ---------- flames ----------
  const FUEL = {
    Kerosene: {
      core: [1.0, 0.88, 0.62], mid: [1.0, 0.5, 0.14], edge: [0.95, 0.26, 0.04], dia: [1.0, 0.8, 0.45],
      jetB: 2.6, outB: 1.35, diaK: 0.45, len: 1.15, jetFrac: 0.48, spread: 3.4, turb: 1.0,
      light: 0xffa04a, lightK: 1.0, glow: 0xffb060, halo: [1.0, 0.62, 0.28], haloK: 1.25,
    },
    Methane: {
      core: [0.9, 0.92, 1.0], mid: [0.48, 0.5, 1.0], edge: [1.0, 0.45, 0.16], dia: [1.0, 0.86, 1.0],
      jetB: 3.0, outB: 0.45, diaK: 1.5, len: 0.85, jetFrac: 0.62, spread: 2.8, turb: 0.45,
      light: 0xffd6c0, lightK: 0.6, glow: 0xe6dcff, halo: [0.85, 0.82, 1.0], haloK: 0.9,
    },
  };

  const FLAME_VS = [
    'uniform float uExpand; uniform float uJet; uniform float uSpread;',
    'varying float vT; varying float vEdge; varying float vAxial; varying vec2 vXZ;',
    'void main(){',
    '  float t = clamp(-position.y, 0.0, 1.0);',
    '  vec2 xz = position.xz;',
    '  float slR = uJet > 0.5 ? (1.0 - 0.28*t) : (1.0 + 0.5*t) * (1.0 - 0.5*t*t);',
    '  float vacR = 1.0 + uSpread * (uJet > 0.5 ? 0.55 : 1.0) * pow(t, 0.55);',
    '  float rad = mix(slR, vacR, uExpand);',
    '  vec4 p = vec4(xz.x*rad, position.y, xz.y*rad, 1.0);',
    '  vec3 nObj = vec3(xz.x, 0.0, xz.y);',
    '  #ifdef USE_INSTANCING',
    '  p = instanceMatrix * p; nObj = mat3(instanceMatrix) * nObj;',
    '  #endif',
    '  vec4 mv = modelViewMatrix * p;',
    '  vec3 v = normalize(-mv.xyz);',
    '  vEdge = abs(dot(normalize(normalMatrix * nObj), v));',
    '  vAxial = abs(dot(normalize(normalMatrix * vec3(0.0, 1.0, 0.0)), v));',
    '  vT = t; vXZ = xz;',
    '  gl_Position = projectionMatrix * mv;',
    '}',
  ].join('\n');
  const FLAME_FS = [
    'uniform float uPower; uniform float uTime; uniform float uExpand; uniform float uJet; uniform float uSeed; uniform float uBright; uniform float uDiaK; uniform float uTurb;',
    'uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uEdge; uniform vec3 uDia;',
    'varying float vT; varying float vEdge; varying float vAxial; varying vec2 vXZ;',
    'float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }',
    'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y); }',
    'void main(){',
    '  float t = vT;',
    '  float face = mix(pow(vEdge, 1.2), 1.0, vAxial*vAxial*0.85);',
    '  float n = vn(vec2(vXZ.x*2.3 + vXZ.y*1.7 + uSeed, t*7.0 - uTime*17.0))*0.6 + vn(vec2(vXZ.y*4.1 - vXZ.x*2.0 - uSeed, t*19.0 - uTime*33.0))*0.4;',
    '  float turb = mix(1.0, 0.45 + 1.1*n, uTurb);',
    '  float startK = smoothstep(0.0, 0.03, t) * 0.6 + 0.4;',
    '  vec3 col;',
    '  if (uJet > 0.5) {',
    '    float ph = fract(t*mix(5.5, 2.0, uExpand) + 0.1);',
    '    float w = 1.0 - abs(2.0*ph - 1.0);',
    '    float fadeD = pow(max(0.0, 1.0 - t*1.15), 0.9) * (1.0 - uExpand);',
    '    float dia = smoothstep(1.0 - w*0.8, 1.0 - w*0.8 + 0.12, face) * fadeD;',
    '    float disk = exp(-pow((ph - 0.04)*16.0, 2.0)) * smoothstep(0.35, 0.9, face) * fadeD * 0.7;',
    '    float body = pow(max(0.0, 1.0 - t), mix(1.9, 1.3, uExpand)) * pow(face, 1.4) * mix(0.85 + 0.3*n, 1.0, 0.4);',
    '    col = mix(uMid, uCore, clamp(face*1.3*(1.0 - t*0.7), 0.0, 1.0)) * body * mix(1.0, 0.5, uExpand);',
    '    col += uDia * (dia + disk) * uDiaK;',
    '    col *= uBright * startK;',
    '  } else {',
    '    float fall = pow(max(0.0, 1.0 - t), mix(1.15, 1.5, uExpand));',
    '    float f = pow(face, mix(1.1, 2.4, uExpand));',
    '    float I = fall * f * turb * mix(1.0, 0.45, uExpand);',
    '    col = mix(uEdge, uMid, smoothstep(0.12, 0.85, face));',
    '    col = mix(col, uCore, (1.0 - t) * face * 0.35 * (1.0 - uExpand));',
    '    col *= I * uBright * startK;',
    '  }',
    '  gl_FragColor = vec4(col * uPower, 1.0);',
    '}',
  ].join('\n');

  function flameMaterial(jet, F, seed) {
    const v3 = (a) => new T.Vector3(a[0], a[1], a[2]);
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: {
        uPower: { value: 1 }, uTime: { value: 0 }, uExpand: { value: 0 }, uJet: { value: jet ? 1 : 0 }, uSeed: { value: seed },
        uBright: { value: jet ? F.jetB : F.outB }, uDiaK: { value: F.diaK }, uTurb: { value: F.turb }, uSpread: { value: F.spread },
        uCore: { value: v3(F.core) }, uMid: { value: v3(F.mid) }, uEdge: { value: v3(F.edge) }, uDia: { value: v3(F.dia) },
      },
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
    });
  }
  function haloMaterial(F) {
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uSize: { value: 10 }, uScale: { value: 800 }, uMin: { value: 10 }, uI: { value: 0 }, uCol: { value: new T.Vector3(...F.halo) } },
      vertexShader: 'uniform float uSize; uniform float uScale; uniform float uMin; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp(uSize*uScale/max(1.0,-mv.z), uMin, 900.0); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uCol; uniform float uI; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d)*2.0; float a = exp(-r*r*6.0) * max(0.0, 1.0 - r) + 0.6*exp(-r*r*40.0); gl_FragColor = vec4(uCol * a * uI, 1.0); }',
    });
  }

  // ---------- structural helpers ----------
  const UP = new T.Vector3(0, 1, 0);
  function orient(mesh, a, b, len) { // cylinder (base at origin, +y) from a toward b
    const d = new T.Vector3().subVectors(b, a);
    const L = d.length() || 1e-3;
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / L));
    mesh.scale.set(1, len == null ? L : Math.min(len, L), 1);
  }
  const ease = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

  function lathe(prof, seg, phi, len) { return new T.LatheGeometry(prof.map(([x, y]) => new T.Vector2(Math.max(0.001, x), y)), seg, phi || 0, len || TAU); }

  // ---------- rocket ----------
  function buildRocket(design, techs, o) {
    o = o || {};
    const m = shared();
    const geo = D.geometry(design, techs);
    const r = geo.d / 2;
    const steel = geo.steel;
    const sm = small();
    const SEG = sm ? 32 : 64;
    const TW = sm ? 512 : 1024;
    const accent = design.color || '#ff7a1a';
    const seed0 = hashStr(String(design.id || design.name || 'x'));
    const root = new T.Group();
    const nSt = design.stages.length;
    const from = o.from || 0, to = o.to == null ? nSt - 1 : o.to;
    const stages = [];
    let y = 0;
    for (let i = from; i <= to; i++) {
      const st = design.stages[i];
      const h = geo.stages[i].h;
      const isTop = i === nSt - 1;
      const booster = i === 0;
      const g = new T.Group();
      g.position.y = y;
      const ih = isTop ? 0 : Math.min(steel ? 2.4 : 3.2, h * 0.12);
      // tank body
      const bodyMat = bodyMaterial({ W: TW, r, h, steel, soot: booster && o.soot, booster, inter: ih, accent: (booster || isTop) ? accent : null, wordmark: booster, seed: seed0 + i * 31 });
      const body = new T.Mesh(new T.CylinderGeometry(r, r, h, SEG, 1, true), bodyMat);
      body.position.y = h / 2; body.rotation.y = Math.PI; body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      // raceway (cable tunnel) on the +x side
      const rwH = h - ih - 1.2;
      if (rwH > 1) {
        const rw = new T.Mesh(new T.BoxGeometry(r * 0.06, rwH, Math.max(0.12, r * 0.11)), steel ? m.rk_steel : m.rk_paint);
        rw.position.set(r + r * 0.02, 0.6 + rwH / 2, 0); rw.castShadow = true; g.add(rw);
      }
      if (isTop) {
        const cap = new T.Mesh(new T.CircleGeometry(r, SEG / 2), m.rk_dark);
        cap.rotation.x = -Math.PI / 2; cap.position.y = h; g.add(cap);
      }
      // aft heat shield
      const base = new T.Mesh(new T.CircleGeometry(r, SEG / 2), m.rk_heat);
      base.rotation.x = Math.PI / 2; base.position.y = 0.02; g.add(base);
      if (booster && !steel && !sm) {
        // cold gas thruster pods near the top
        for (const s of [-1, 1]) {
          const pod = new T.Mesh(new T.BoxGeometry(r * 0.12, r * 0.22, r * 0.18), m.rk_carbon);
          pod.position.set(0, h - ih + r * 0.15, s * (r + r * 0.04)); g.add(pod);
        }
      }

      // engines
      const eng = S.ENGINES[st.engine];
      const kero = eng.fuel === 'Kerosene';
      const F = FUEL[eng.fuel] || FUEL.Methane;
      const ep = enginePositions(st.count, r, eng.vac);
      const n = ep.pts.length;
      const prof = bellProfile(ep.bw, eng.vac, kero);
      const bh = prof.bh;
      const bt = bellTextures(prof, eng.vac, kero);
      const bellMat = stdMat({
        color: 0xffffff, map: bt.map, roughnessMap: bt.rough, roughness: 1, metalness: 0.85, side: T.DoubleSide,
        emissive: new T.Color(1.0, 0.36, 0.1), emissiveMap: bt.emissiveMap, emissiveIntensity: 0,
      });
      const bells = new T.InstancedMesh(lathe(prof.pts, sm ? 16 : 28), bellMat, n);
      const mtx = new T.Matrix4(), q = new T.Quaternion(), sc1 = new T.Vector3(1, 1, 1), pv = new T.Vector3();
      ep.pts.forEach(([ex, ez], k) => {
        q.setFromAxisAngle(UP, (k * 2.39) % TAU);
        bells.setMatrixAt(k, mtx.compose(pv.set(ex, 0, ez), q, sc1));
      });
      bells.castShadow = true;
      g.add(bells);
      if (!sm && n <= 9) {
        // turbopump + (kerosene) gas generator exhaust duct beside each chamber
        const pump = new T.InstancedMesh(new T.CylinderGeometry(prof.rt * 0.8, prof.rt * 0.8, prof.c * 0.7, 10), m.rk_metal, n);
        let duct = null;
        if (kero && !eng.vac) {
          const dg = new T.CylinderGeometry(prof.rt * 0.32, prof.rt * 0.4, prof.hb * 0.75, 8);
          dg.translate(0, -prof.hb * 0.375, 0);
          duct = new T.InstancedMesh(dg, m.rk_dark, n);
        }
        ep.pts.forEach(([ex, ez], k) => {
          const a = (k * 2.39) % TAU;
          const ox = Math.cos(a) * (prof.rc + prof.rt * 0.6), oz = -Math.sin(a) * (prof.rc + prof.rt * 0.6);
          pump.setMatrixAt(k, mtx.makeTranslation(ex + ox, -prof.c * 0.4, ez + oz));
          if (duct) {
            const dx = Math.cos(a + 1.3) * (prof.rc * 1.1), dz = -Math.sin(a + 1.3) * (prof.rc * 1.1);
            mtx.makeRotationAxis(new T.Vector3(Math.sin(a + 1.3), 0, Math.cos(a + 1.3)), -Math.atan2(prof.re - prof.rc, prof.hb) * 0.9);
            mtx.setPosition(ex + dx, -prof.c * 0.6, ez + dz);
            duct.setMatrixAt(k, mtx);
          }
        });
        g.add(pump); if (duct) g.add(duct);
      }
      // nozzle exit glow discs
      const glowMat = new T.MeshBasicMaterial({ color: F.glow, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
      const glows = new T.InstancedMesh(new T.CircleGeometry(prof.re * 0.97, 20).rotateX(Math.PI / 2), glowMat, n);
      ep.pts.forEach(([ex, ez], k) => glows.setMatrixAt(k, mtx.makeTranslation(ex, -bh + prof.hb * 0.04, ez)));
      glows.frustumCulled = false;
      g.add(glows);

      // plume: per-engine jets (ig) + combined envelope (og) + far-view halo + light
      const plume = new T.Group();
      plume.position.y = -bh;
      const outerMat = flameMaterial(false, F, (seed0 % 100) * 0.37 + i);
      const coreMat = flameMaterial(true, F, (seed0 % 100) * 0.53 + i * 3);
      const og = new T.Group(), ig = new T.Group();
      const outerGeo = new T.CylinderGeometry(1, 1, 1, sm ? 24 : 40, sm ? 20 : 36, true); outerGeo.translate(0, -0.5, 0);
      const outer = new T.Mesh(outerGeo, outerMat); outer.frustumCulled = false; og.add(outer);
      const jetGeo = new T.CylinderGeometry(1, 1, 1, sm ? 12 : 18, sm ? 24 : 40, true); jetGeo.translate(0, -0.5, 0);
      const jets = new T.InstancedMesh(jetGeo, coreMat, n);
      ep.pts.forEach(([ex, ez], k) => jets.setMatrixAt(k, mtx.compose(pv.set(ex, 0, ez), q.identity(), new T.Vector3(prof.re * 0.88, 1, prof.re * 0.88))));
      jets.frustumCulled = false; ig.add(jets);
      plume.add(og); plume.add(ig);
      const hgeo = new T.BufferGeometry(); hgeo.setAttribute('position', new T.Float32BufferAttribute([0, -r * 0.4, 0], 3));
      const haloMat = haloMaterial(F);
      const halo = new T.Points(hgeo, haloMat); halo.frustumCulled = false;
      plume.add(halo);
      const light = new T.PointLight(F.light, 0, 0, 2);
      light.position.y = -r * 2;
      plume.add(light);
      plume.visible = false;
      g.add(plume);
      const stObj = {
        group: g, h, r, bh, plume, og, ig, light, glowMat, outerMat, coreMat, haloMat, bellMat, vac: eng.vac, fuel: eng.fuel, F,
        engines: n, exitR: prof.re, footprint: n > 1 ? r * 0.95 : ep.bw * 0.6, heat: 0, _t: null, seed: (seed0 % 97) + i,
      };

      // grid fins (4, aligned with the legs). k = 1 deployed, 0 stowed flat against the tank.
      if (booster && o.fins) {
        stObj.fins = [];
        const fs = steel ? r * 0.5 : r * 0.78, fd = fs * 0.85, th = fs * 0.09;
        const latG = new T.PlaneGeometry(fs, fd).rotateX(-Math.PI / 2).translate(fs / 2 + th, 0, 0);
        const edgeG = new T.BoxGeometry(th * 0.45, th, fd + th * 0.45);
        const sideG = new T.BoxGeometry(fs, th, th * 0.45);
        const hingeG = new T.BoxGeometry(th * 2.2, fd * 0.45, fd * 0.5);
        const finY = h - ih - fd * 0.45 - 0.3;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + Math.PI / 4;
          const pivot = new T.Group();
          pivot.position.set(Math.cos(a) * r, finY, -Math.sin(a) * r);
          pivot.rotation.y = a;
          const hinge = new T.Mesh(hingeG, m.rk_dark); hinge.position.set(th * 0.6, 0, 0); pivot.add(hinge);
          const fin = new T.Group();
          fin.position.set(th * 1.2, 0, 0);
          for (const yy of [-th * 0.45, th * 0.45]) { const l = new T.Mesh(latG, m.rk_lattice); l.position.y = yy; l.castShadow = true; fin.add(l); }
          const e1 = new T.Mesh(edgeG, m.rk_ti); e1.position.x = th + fs; fin.add(e1);
          const e0 = new T.Mesh(edgeG, m.rk_ti); e0.position.x = th; fin.add(e0);
          for (const s of [-1, 1]) { const sd = new T.Mesh(sideG, m.rk_ti); sd.position.set(th + fs / 2, 0, s * fd / 2); sd.castShadow = true; fin.add(sd); }
          pivot.add(fin);
          g.add(pivot);
          stObj.fins.push(fin);
        }
        setFins(stObj, o.fins === 'stowed' || o.finsStowed ? 0 : 1);
      }

      // landing legs: carbon beams hinged at the base, telescoping pusher struts
      if (booster && o.legs) {
        stObj.legs = [];
        const len = r * 2.7 + 2.5;
        const lw = r * 0.3, ld = r * 0.12;
        const legG = new T.BoxGeometry(lw, len, ld, 1, 4, 1);
        const pa = legG.attributes.position;
        for (let k = 0; k < pa.count; k++) { const yy = pa.getY(k) / len + 0.5; pa.setX(k, pa.getX(k) * (1 - 0.45 * yy)); }
        legG.translate(0, len / 2, 0); legG.computeVertexNormals();
        const padG = new T.CylinderGeometry(r * 0.2, r * 0.24, r * 0.08, 16);
        const sleeveG = new T.CylinderGeometry(r * 0.05, r * 0.05, 1, 8); sleeveG.translate(0, 0.5, 0);
        const rodG = new T.CylinderGeometry(r * 0.03, r * 0.03, 1, 8); rodG.translate(0, 0.5, 0);
        const footG = new T.BoxGeometry(lw * 0.6, len * 0.06, ld * 1.3);
        const legMat = steel ? m.rk_dark : m.rk_carbon;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + Math.PI / 4;
          const pivot = new T.Group();
          pivot.position.set(Math.cos(a) * (r + ld * 0.5 + 0.02), 0.3, -Math.sin(a) * (r + ld * 0.5 + 0.02));
          pivot.rotation.y = a;
          const leg = new T.Group();
          const lm = new T.Mesh(legG, legMat); lm.castShadow = true; leg.add(lm);
          const tip = new T.Mesh(footG, m.rk_white); tip.position.y = len * 0.97; leg.add(tip);
          const pad = new T.Mesh(padG, m.rk_metal); pad.position.y = len; pad.castShadow = true; leg.add(pad);
          pivot.add(leg);
          const sleeve = new T.Mesh(sleeveG, m.rk_metal), rod = new T.Mesh(rodG, m.rk_chrome);
          sleeve.castShadow = rod.castShadow = true;
          pivot.add(sleeve); pivot.add(rod);
          g.add(pivot);
          leg.userData.rig = { pad, sleeve, rod, len, B: new T.Vector3(-ld * 0.5 - 0.02, len * 0.62, 0), s: len * 0.42 };
          stObj.legs.push(leg);
        }
        stObj.legLen = len;
        setLegs(stObj, 0);
      }
      root.add(g);
      stages.push(stObj);
      y += h;
    }

    // ---------- fairing / capsule and payload ----------
    let fairing = null, payload = null;
    if (to === nSt - 1 && !o.noNose) {
      const nh = geo.nose;
      fairing = [];
      payload = new T.Group();
      payload.position.y = y;
      if (o.crew) {
        // trunk + capsule always visible; the "fairing" is the hinged nose cap that flight.js can jettison
        const cr = r * 0.97;
        const tH = nh * 0.26, shH = nh * 0.035, cH = nh * 0.42;
        const trunkC = canvas(512, 128), tg = trunkC.getContext('2d');
        tg.fillStyle = '#e9e9e5'; tg.fillRect(0, 0, 512, 128);
        tg.fillStyle = '#1a2440'; tg.fillRect(256, 10, 256, 108);
        tg.strokeStyle = 'rgba(180,190,210,.4)'; for (let x = 256; x < 512; x += 8) { tg.beginPath(); tg.moveTo(x, 10); tg.lineTo(x, 118); tg.stroke(); }
        tg.fillStyle = accent; tg.fillRect(0, 118, 512, 10);
        const trunk = new T.Mesh(new T.CylinderGeometry(cr, r, tH, SEG, 1, true), stdMat({ map: tex(trunkC, true), roughness: 0.5, metalness: 0.1 }));
        trunk.position.y = tH / 2; trunk.castShadow = true; payload.add(trunk);
        const shield = new T.Mesh(new T.CylinderGeometry(cr * 1.01, cr * 1.01, shH, SEG), m.rk_heat);
        shield.position.y = tH + shH / 2; payload.add(shield);
        const capC = canvas(512, 256), cg = capC.getContext('2d');
        cg.fillStyle = '#f1f0ec'; cg.fillRect(0, 0, 512, 256);
        blotch(cg, 512, 256, 12, 20, 0.05);
        for (let k = 0; k < 4; k++) { // windows
          cg.fillStyle = '#0d1018'; cg.beginPath(); cg.ellipse(64 + k * 128, 150, 14, 18, 0, 0, TAU); cg.fill();
          cg.strokeStyle = '#555'; cg.lineWidth = 3; cg.stroke();
        }
        cg.fillStyle = 'rgba(30,32,38,.85)'; // thruster pod cutouts
        for (let k = 0; k < 4; k++) cg.fillRect(k * 128, 200, 30, 26);
        cg.fillStyle = '#1b1f29'; cg.font = '900 22px -apple-system, Arial, sans-serif'; cg.textAlign = 'center';
        cg.fillText('A P O G E E', 256, 105);
        const capProf = [[cr, 0], [cr * 0.98, cH * 0.05], [cr * 0.62, cH * 0.82], [cr * 0.55, cH * 0.92], [cr * 0.42, cH]];
        const capsule = new T.Mesh(lathe(capProf, SEG), stdMat({ map: tex(capC, true), roughness: 0.45, metalness: 0.05 }));
        capsule.position.y = tH + shH; capsule.castShadow = true; payload.add(capsule);
        const port = new T.Mesh(new T.CylinderGeometry(cr * 0.28, cr * 0.32, nh * 0.03, 20), m.rk_metal);
        port.position.y = tH + shH + cH + nh * 0.015; payload.add(port);
        // nose cap halves
        const y0 = tH + shH + cH * 0.82, capH = nh - y0;
        const nose = [];
        for (let k = 0; k <= 12; k++) { const t = k / 12; nose.push([cr * 0.64 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.6))) + 0.001, y0 + t * capH]); }
        const noseMat = stdMat({ color: 0xf1f0ec, roughness: 0.45, metalness: 0.05 });
        for (const ph of [0, Math.PI]) {
          const fm = new T.Mesh(lathe(nose, SEG / 2, ph, Math.PI), noseMat);
          fm.castShadow = true;
          const holder = new T.Group(); holder.position.y = y; holder.add(fm);
          root.add(holder); fairing.push(holder);
        }
        payload.userData.wings = new T.Group(); payload.userData.wings.scale.x = 0.05; payload.add(payload.userData.wings);
        payload.userData.crew = true;
        payload.visible = true;
      } else {
        // fairing: boat-tail, cylinder, tangent ogive; painted fairings are a little wider than the stage
        const rf = steel ? r : r * 1.12;
        const pr = [];
        const cylEnd = steel ? 0.22 : 0.4;
        const L = nh * (1 - cylEnd), rho = (rf * rf + L * L) / (2 * rf);
        if (!steel) { pr.push([r * 0.995, 0]); pr.push([rf, nh * 0.07]); } else pr.push([rf, 0]);
        pr.push([rf, nh * cylEnd]);
        const NN = sm ? 18 : 30;
        for (let k = 1; k <= NN; k++) {
          const x = (k / NN) * L; // distance from the ogive base
          const rad = Math.sqrt(Math.max(0, rho * rho - x * x)) + rf - rho;
          pr.push([Math.max(rf * 0.035, rad), nh * cylEnd + x]);
        }
        pr.push([0.001, nh + rf * 0.02]);
        let fmat;
        if (steel) {
          fmat = bodyMaterial({ W: TW / 2, r: rf, h: nh, steel: true, seed: seed0 + 99 });
        } else {
          const W = sm ? 256 : 512;
          const c = canvas(W, W), fg = c.getContext('2d');
          fg.fillStyle = '#f2f1ec'; fg.fillRect(0, 0, W, W);
          blotch(fg, W, W, seed0 + 7, 10, 0.06);
          // lathe v follows point index; mark the cylinder-ogive joint and the base ring
          const vJ = (steel ? 1 : 2) / (pr.length - 1);
          fg.fillStyle = 'rgba(60,64,72,.35)'; fg.fillRect(0, W * (1 - vJ), W, 2);
          fg.fillStyle = 'rgba(30,30,34,.9)'; fg.fillRect(0, W - 3, W, 3);
          fg.fillStyle = 'rgba(40,44,52,.7)'; fg.fillRect(0, 0, 3, W); fg.fillRect(W - 3, 0, 3, W);
          fmat = stdMat({ map: tex(c, true), roughness: 0.48, metalness: 0.02, envMapIntensity: 0.7 });
        }
        for (const ph of [0, Math.PI]) {
          const fm = new T.Mesh(lathe(pr, SEG / 2, ph, Math.PI), fmat);
          fm.castShadow = true;
          const holder = new T.Group(); holder.position.y = y; holder.add(fm);
          root.add(holder); fairing.push(holder);
        }
        // satellite: adapter cone, foil-wrapped bus, dish, folded solar wings
        const adH = nh * 0.08;
        const adapter = new T.Mesh(new T.CylinderGeometry(r * 0.3, r * 0.55, adH, 24), m.rk_dark);
        adapter.position.y = adH / 2; payload.add(adapter);
        const bw = r * 0.85, bH = nh * 0.34;
        const fc = canvas(128, 128), fgc = fc.getContext('2d');
        fgc.fillStyle = '#c9982f'; fgc.fillRect(0, 0, 128, 128);
        const fr = rand(seed0 + 3);
        for (let k = 0; k < 140; k++) { fgc.fillStyle = fr() < 0.5 ? `rgba(255,230,150,${fr() * 0.5})` : `rgba(90,60,10,${fr() * 0.5})`; fgc.beginPath(); fgc.moveTo(fr() * 128, fr() * 128); fgc.lineTo(fr() * 128, fr() * 128); fgc.lineTo(fr() * 128, fr() * 128); fgc.fill(); }
        fgc.fillStyle = '#e8e8e8'; fgc.fillRect(18, 30, 92, 68); // radiator panel
        fgc.strokeStyle = '#bbb'; for (let x = 22; x < 110; x += 8) { fgc.beginPath(); fgc.moveTo(x, 30); fgc.lineTo(x, 98); fgc.stroke(); }
        const bus = new T.Mesh(new T.BoxGeometry(bw, bH, bw), stdMat({ map: tex(fc, true), roughness: 0.3, metalness: 0.8 }));
        bus.position.y = adH + bH / 2; bus.castShadow = true; payload.add(bus);
        const dish = new T.Mesh(new T.LatheGeometry([0, 0.25, 0.5, 0.75, 1].map((k) => new T.Vector2(k * bw * 0.4, k * k * bw * 0.18)), 20), stdMat({ color: 0xf2f2f0, roughness: 0.6, side: T.DoubleSide }));
        dish.position.y = adH + bH + bw * 0.12; payload.add(dish);
        const mast = new T.Mesh(new T.CylinderGeometry(bw * 0.03, bw * 0.03, bw * 0.12, 6), m.rk_metal);
        mast.position.y = adH + bH + bw * 0.06; payload.add(mast);
        const pc = canvas(256, 128), pg = pc.getContext('2d');
        pg.fillStyle = '#c8ccd2'; pg.fillRect(0, 0, 256, 128);
        for (let cx = 0; cx < 16; cx++) for (let cy = 0; cy < 8; cy++) { pg.fillStyle = (cx + cy) % 3 ? '#16264d' : '#1b2d5a'; pg.fillRect(cx * 16 + 1, cy * 16 + 1, 14, 14); }
        const panelMat = stdMat({ map: tex(pc, true), roughness: 0.25, metalness: 0.5, side: T.DoubleSide });
        const wings = new T.Group(); wings.position.y = adH + bH * 0.55;
        const pw = r * 0.7, ph = bH * 0.85;
        for (const s of [-1, 1]) {
          const boom = new T.Mesh(new T.BoxGeometry(r * 0.4, bw * 0.03, bw * 0.03), m.rk_metal);
          boom.position.x = s * (bw / 2 + r * 0.2); wings.add(boom);
          for (let k = 0; k < 3; k++) {
            const p = new T.Mesh(new T.PlaneGeometry(pw * 0.96, ph), panelMat);
            p.position.x = s * (bw / 2 + r * 0.4 + pw * (k + 0.5));
            wings.add(p);
          }
        }
        wings.scale.x = 0.05;
        payload.add(wings);
        payload.userData.wings = wings;
        payload.visible = false;
      }
      root.add(payload);
    }
    return { root, stages, fairing, payload, geo, r, top: y };
  }

  // ---------- animation ----------
  // power 0..1, plume 0 (sea level, tight) .. 1 (vacuum, wide), time in seconds.
  function setPlume(st, power, plume, time) {
    const dt = st._t == null ? 0 : Math.max(0, Math.min(0.2, time - st._t));
    st._t = time;
    const on = power > 0.01;
    // nozzle heat: vacuum extensions glow and cool slowly
    const target = on ? power : 0;
    st.heat += (target - st.heat) * Math.min(1, dt * (target > st.heat ? 0.6 : 0.25));
    st.bellMat.emissiveIntensity = st.vac ? Math.pow(st.heat, 1.5) * 2.2 : st.heat * 0.35;
    st.plume.visible = on;
    st.glowMat.opacity = on ? 0.55 + 0.45 * power : 0;
    if (!on) { st.light.intensity = 0; return; }
    const F = st.F;
    const ex = st.vac ? Math.max(plume, 0.85) : Math.max(0, Math.min(1, plume));
    const flick = 1 + 0.035 * Math.sin(time * 37 + st.seed) + 0.025 * Math.sin(time * 91 + st.seed * 3) + (Math.random() - 0.5) * 0.04;
    const len = (st.r * 7 + 12) * F.len * (0.35 + 0.65 * power) * (1 + ex * 1.8) * flick;
    const w = st.footprint * (st.engines > 1 ? 1.08 : 1.0) * (1 + ex * 0.3);
    st.og.scale.set(w, len, w);
    st.ig.scale.set(1, len * F.jetFrac * (1 - ex * 0.25) * (0.8 + 0.2 * flick), 1);
    for (const mat of [st.outerMat, st.coreMat]) {
      const u = mat.uniforms;
      u.uTime.value = time; u.uPower.value = power * (0.94 + 0.06 * flick); u.uExpand.value = ex;
    }
    const hm = st.haloMat.uniforms;
    hm.uSize.value = (st.r * 2.6 + 2) * (1 + ex * 0.8);
    hm.uScale.value = (A.R && A.R.pointScale) || 800;
    hm.uMin.value = 9 * ((A.R && A.R.renderer && A.R.renderer.getPixelRatio()) || 1);
    hm.uI.value = power * F.haloK * (1 - ex * 0.35) * flick;
    st.light.intensity = 2.2e5 * Math.sqrt(st.engines) * F.lightK * power * flick * (1 - ex * 0.6);
  }

  // Legs: k = 0 stowed against the tank, 1 deployed. Smoothly eased; struts follow.
  const _L = new T.Vector3();
  function setLegs(st, k) {
    if (!st.legs) return;
    const e = ease(k);
    const ang = -e * 2.45;
    for (const leg of st.legs) {
      leg.rotation.set(0, 0, ang);
      const rig = leg.userData.rig;
      if (!rig) continue;
      rig.pad.rotation.z = -ang - (1 - e) * Math.PI / 2;
      _L.set(-Math.sin(ang) * rig.s, Math.cos(ang) * rig.s, 0);
      orient(rig.sleeve, rig.B, _L, rig.len * 0.5);
      orient(rig.rod, _L, rig.B);
      rig.sleeve.visible = rig.rod.visible = e > 0.02;
    }
  }

  // Grid fins: k = 1 deployed (lattice horizontal, sticking out), 0 folded up flat against the tank.
  function setFins(st, k) {
    if (!st.fins) return;
    const e = ease(k);
    for (const f of st.fins) f.rotation.z = (1 - e) * Math.PI / 2;
  }

  A.buildRocket = buildRocket;
  A.setPlume = setPlume;
  A.setLegs = setLegs;
  A.setFins = setFins;
})();
