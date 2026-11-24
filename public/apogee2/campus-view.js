// APOGEE campus map (window.APOGEE_CAMPUS_VIEW): photoreal 3D view of the Base tab (three.js, its own WebGLRenderer).
// mount(wrap, api) -> {fit(), zoomBy(f), dirty(), screenOf(x, y), dispose()}; api = {scene(), tap(tile), hover(tile|null)} from campus.js.
// Drag = pan, right-drag / shift-drag / two-finger twist = rotate and tilt, wheel / pinch = zoom. Falls back to the old 2D map without WebGL.
(function () {
  'use strict';
  // ---------------- 2D fallback (original isometric canvas map) ----------------
  'use strict';
  const TW = 64, TH = 32;
  const GROUND = { S: '#1f6090', L: '#2b72a0', B: '#e2cf98', c: '#97a463', g: '#6ea95a', t: '#5f9b50', d: '#d9b072', r: '#a3826a', w: '#5f8c70', R: '#4a4f5a', C: '#5a6172' };
  const BCOL = { pad: '#b8bcc5', factory: '#d5dae4', office: '#88a6d2', housing: '#dba97c', lab: '#e9edf4', test: '#9aa1aa', mc: '#7d8ca9', tank: '#eceff3',
    lz: '#bcc0c8', port: '#a9afb9', tower: '#c7cbd2', solar: '#3a4f78', visitor: '#8fd3ca', satfab: '#f2f5f9', fab: '#e8ecf2', ground: '#e1e5ec' };

  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(c, f) {
    const [r, g, b] = hex(c);
    const m = (v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  function mount2D(wrap, api) { // 2D fallback when WebGL is not available
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-label', 'Campus map');
    wrap.insertBefore(cv, wrap.firstChild);
    const ctx = cv.getContext('2d');
    let W = 1, H = 1, dpr = 1, fitted = null, fitZ = 1, need = true, alive = true, raf = 0, last = 0;
    const t0 = performance.now();
    const cam = { x: 0, y: 0, z: 1 };
    const P = (x, y) => [cam.x + (x - y) * TW / 2 * cam.z, cam.y + (x + y) * TH / 2 * cam.z];
    function toTile(sx, sy) {
      const wx = (sx - cam.x) / cam.z / (TW / 2), wy = (sy - cam.y) / cam.z / (TH / 2);
      return { x: Math.floor((wx + wy) / 2), y: Math.floor((wy - wx) / 2) };
    }
    function resize() {
      const r = wrap.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      fitted = null; need = true;
    }
    function fit(site) {
      const w = site.w, h = site.h;
      const minx = -h * TW / 2, maxx = w * TW / 2, miny = -60, maxy = (w + h) * TH / 2 + 18;
      fitZ = Math.min((W - 20) / (maxx - minx), (H - 56) / (maxy - miny));
      cam.z = fitZ * (W < 520 ? 1.2 : 1);
      cam.x = W / 2 - (minx + maxx) / 2 * cam.z;
      cam.y = (H + 40) / 2 - (miny + maxy) / 2 * cam.z;
      fitted = site.base || site.id;
    }
    function zoomAt(sx, sy, f) {
      const nz = Math.max(fitZ * 0.6, Math.min(fitZ * 4, cam.z * f));
      const k = nz / cam.z;
      cam.x = sx - (sx - cam.x) * k; cam.y = sy - (sy - cam.y) * k; cam.z = nz; need = true;
    }

    // ---------- primitives ----------
    function poly(pts, fill, stroke, lw) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
    }
    const up = (p, hh) => [p[0], p[1] - hh];
    function corners(x, y, w, h, i) { return [P(x + i, y + i), P(x + w - i, y + i), P(x + w - i, y + h - i), P(x + i, y + h - i)]; }
    function box(x, y, w, h, hgt, col, inset = 0.08) {
      const [a, b, c, d] = corners(x, y, w, h, inset);
      const Hh = hgt * cam.z;
      poly([d, c, up(c, Hh), up(d, Hh)], shade(col, -0.22));
      poly([c, b, up(b, Hh), up(c, Hh)], shade(col, -0.4));
      poly([up(a, Hh), up(b, Hh), up(c, Hh), up(d, Hh)], shade(col, 0.06));
      return { a, b, c, d, Hh };
    }
    function cyl(cx, cy, r, hgt, col, base = 0) {
      const p = P(cx, cy), rx = r * TW / 2 * cam.z * 1.15, ry = rx / 2, Hh = hgt * cam.z, b0 = base * cam.z;
      ctx.fillStyle = shade(col, -0.3);
      ctx.beginPath(); ctx.ellipse(p[0], p[1] - b0, rx, ry, 0, 0, Math.PI); ctx.lineTo(p[0] - rx, p[1] - b0 - Hh); ctx.ellipse(p[0], p[1] - b0 - Hh, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(p[0] - rx, 0, p[0] + rx, 0); g.addColorStop(0, shade(col, -0.1)); g.addColorStop(1, shade(col, -0.45));
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = shade(col, 0.1); ctx.beginPath(); ctx.ellipse(p[0], p[1] - b0 - Hh, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      return { p, rx, Hh: Hh + b0 };
    }
    function line(a, b, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    function pill(x, y, text, bg, fg) {
      ctx.font = `700 ${Math.max(10, Math.min(13, 11 * cam.z / fitZ))}px system-ui, sans-serif`;
      const tw = ctx.measureText(text).width + 12;
      ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y - 10, tw, 19, 9) : ctx.rect(x - tw / 2, y - 10, tw, 19); ctx.fill();
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
    }

    // ---------- ground ----------
    function ground(site, x, y, ch, t) {
      const [a, b, c, d] = corners(x, y, 1, 1, 0);
      const v = (hash(x, y) - 0.5) * 0.08;
      poly([a, b, c, d], shade(GROUND[ch] || '#777', v), 'rgba(0,0,0,.10)', 1);
      const ctr = P(x + 0.5, y + 0.5), z = cam.z;
      if (ch === 'S' || ch === 'L') {
        const k = Math.sin(t * 1.6 + x * 1.3 + y * 0.7);
        ctx.globalAlpha = 0.35 + 0.25 * k;
        line([ctr[0] - 10 * z + k * 4 * z, ctr[1] - 2 * z], [ctr[0] + 2 * z + k * 4 * z, ctr[1] - 2 * z], '#bfe3ff', 1.2);
        line([ctr[0] - 2 * z - k * 3 * z, ctr[1] + 5 * z], [ctr[0] + 9 * z - k * 3 * z, ctr[1] + 5 * z], '#bfe3ff', 1);
        ctx.globalAlpha = 1;
      } else if (ch === 'B') {
        ctx.fillStyle = 'rgba(150,120,70,.35)';
        for (let i = 0; i < 4; i++) { ctx.fillRect(ctr[0] + (hash(x, y, i) - 0.5) * 30 * z, ctr[1] + (hash(y, x, i) - 0.5) * 12 * z, 1.5, 1.5); }
      } else if (ch === 'w') {
        ctx.fillStyle = 'rgba(40,90,120,.55)'; ctx.beginPath(); ctx.ellipse(ctr[0] + 4 * z, ctr[1] + 2 * z, 9 * z, 3.5 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3d6b4a'; ctx.lineWidth = 1.3;
        for (let i = 0; i < 6; i++) { const px = ctr[0] + (hash(x, y, i) - 0.5) * 34 * z, py = ctr[1] + (hash(y, x, i + 3) - 0.5) * 12 * z; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 1, py - 7 * z); ctx.stroke(); }
      } else if (ch === 'r') {
        const p = ctr;
        poly([[p[0] - 12 * z, p[1] + 3 * z], [p[0] - 5 * z, p[1] - 9 * z], [p[0] + 4 * z, p[1] - 6 * z], [p[0] + 12 * z, p[1] + 3 * z], [p[0], p[1] + 7 * z]], '#8a6a55');
        poly([[p[0] - 5 * z, p[1] - 9 * z], [p[0] + 4 * z, p[1] - 6 * z], [p[0] + 1 * z, p[1] - 1 * z]], '#b6957c');
      } else if (ch === 'd') {
        ctx.strokeStyle = 'rgba(160,110,60,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(ctr[0], ctr[1] + 2 * z, 12 * z, 3 * z, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      } else if (ch === 'R') {
        ctx.setLineDash([4 * z, 4 * z]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = site.map[y + dy] && site.map[y + dy][x + dx];
          if (n === 'R') line(ctr, P(x + 0.5 + dx / 2, y + 0.5 + dy / 2), '#e8d27a', 1.3);
        }
        ctx.setLineDash([]);
      }
    }

    // ---------- objects ----------
    function tree(x, y) {
      for (let i = 0; i < 3; i++) {
        const p = P(x + 0.25 + hash(x, y, i) * 0.5, y + 0.25 + hash(y, x, i + 7) * 0.5), z = cam.z, s = 0.8 + hash(x, y, i + 9) * 0.5;
        line(p, up(p, 5 * z), '#5b4130', 2);
        poly([up(p, 22 * z * s), [p[0] - 7 * z * s, p[1] - 4 * z], [p[0] + 7 * z * s, p[1] - 4 * z]], i % 2 ? '#2f6b3a' : '#3a7d45');
      }
    }
    function cityBlock(x, y) {
      const hh = 18 + hash(x, y, 2) * 60;
      const r = box(x, y, 1, 1, hh, hash(x, y, 5) > 0.5 ? '#6f7890' : '#7d8394', 0.14);
      ctx.fillStyle = 'rgba(255,230,150,.55)';
      for (let k = 6; k < hh - 4; k += 7) for (let j = 0; j < 3; j++) {
        if (hash(x * 9 + j, y, k) < 0.45) continue;
        const f = (j + 0.6) / 3.4, px = r.d[0] + (r.c[0] - r.d[0]) * f, py = r.d[1] + (r.c[1] - r.d[1]) * f - k * cam.z;
        ctx.fillRect(px, py, 2 * cam.z, 2.5 * cam.z);
      }
    }
    function pips(b, r) {
      const c = r.c, z = cam.z;
      for (let i = 0; i < b.lvl; i++) {
        const px = c[0] + (i - (b.lvl - 1) / 2) * 9 * z, py = c[1] + 7 * z;
        poly([[px, py - 4 * z], [px + 4 * z, py], [px, py + 4 * z], [px - 4 * z, py]], '#ffd54a', '#1b1405', 1);
      }
    }
    function towerArms(site, b, bs, hh, t) {
      const pad = bs.find((o) => o.type === 'pad' && (o.x === b.x + 1 || o.x + o.w === b.x || o.y === b.y + 1 || o.y + o.h === b.y));
      const top = P(b.x + 0.5, b.y + 0.5);
      if (!pad) return;
      const pc = P(pad.x + pad.w / 2, pad.y + pad.h / 2);
      const swing = Math.sin(t * 0.5) * 0.08;
      for (const k of [0.72, 0.62]) {
        const a = up(top, hh * k * cam.z), e = [a[0] + (pc[0] - a[0]) * (0.55 + swing), a[1] + (pc[1] - top[1]) * (0.55 + swing)];
        line(a, e, '#3b3f47', 3 * cam.z);
      }
    }
    function drawB(b, sc, t, alpha) {
      const z = cam.z, col = BCOL[b.type] || '#ccc', T = b.type;
      const done = b.lvl > 0;
      ctx.globalAlpha = alpha;
      if (!done) { // new construction
        box(b.x, b.y, b.w, b.h, 2, '#8d8f94', 0.04);
        const full = HGT(b);
        const hh = Math.max(2, full * b.prog);
        ctx.globalAlpha = alpha * 0.85;
        box(b.x, b.y, b.w, b.h, hh, col, 0.12);
        ctx.globalAlpha = alpha;
        scaffold(b, full, t);
        ctx.globalAlpha = 1;
        const c = P(b.x + b.w / 2, b.y + b.h / 2);
        if (alpha >= 1) pill(c[0], c[1] - (full + 30) * z, `BUILDING ${Math.round(b.prog * 100)}%`, 'rgba(20,14,0,.85)', '#ffd54a');
        return;
      }
      let r;
      switch (T) {
        case 'pad': {
          r = box(b.x, b.y, b.w, b.h, 3, col, 0.06);
          const c = up(P(b.x + b.w / 2, b.y + b.h / 2), 3 * z);
          ctx.strokeStyle = '#555a63'; ctx.lineWidth = 2 * z; ctx.beginPath(); ctx.ellipse(c[0], c[1], 20 * z * b.w / 2, 10 * z * b.w / 2, 0, 0, Math.PI * 2); ctx.stroke();
          poly([up(P(b.x + b.w / 2 - 0.15, b.y + b.h - 0.1), 3 * z), up(P(b.x + b.w / 2 + 0.15, b.y + b.h - 0.1), 3 * z), up(P(b.x + b.w / 2 + 0.15, b.y + b.h / 2 + 0.2), 3 * z), up(P(b.x + b.w / 2 - 0.15, b.y + b.h / 2 + 0.2), 3 * z)], '#2b2e35');
          box(b.x + 0.15, b.y + 0.15, 0.4, 0.4, 40 + b.lvl * 8, '#7b8089', 0.02);
          const rk = cyl(b.x + b.w / 2, b.y + b.h / 2, 0.11, 34 + b.lvl * 8, '#f4f6fa', 3);
          poly([[rk.p[0] - rk.rx, rk.p[1] - rk.Hh], [rk.p[0] + rk.rx, rk.p[1] - rk.Hh], [rk.p[0], rk.p[1] - rk.Hh - 10 * z]], '#ff7a1a');
          break;
        }
        case 'factory': {
          r = box(b.x, b.y, b.w, b.h, 24 + b.lvl * 3, col);
          const n = 4, Hh = r.Hh;
          for (let i = 0; i < n; i++) {
            const f0 = (i + 0.2) / n, f1 = (i + 0.75) / n;
            const L = (f) => [r.a[0] + (r.b[0] - r.a[0]) * f, r.a[1] + (r.b[1] - r.a[1]) * f - Hh];
            const R0 = (f) => [r.d[0] + (r.c[0] - r.d[0]) * f, r.d[1] + (r.c[1] - r.d[1]) * f - Hh];
            poly([L(f0), L(f1), R0(f1), R0(f0)], 'rgba(120,170,220,.55)');
          }
          const d0 = P(b.x + b.w * 0.35, b.y + b.h - 0.08), d1 = P(b.x + b.w * 0.65, b.y + b.h - 0.08);
          poly([d0, d1, up(d1, 14 * z), up(d0, 14 * z)], '#3a404c');
          ctx.strokeStyle = 'rgba(255,255,255,.18)'; for (let k = 3; k < 14; k += 3) line(up(d0, k * z), up(d1, k * z), 'rgba(255,255,255,.15)', 1);
          break;
        }
        case 'office': {
          const hh = 26 + b.lvl * 12;
          r = box(b.x, b.y, b.w, b.h, hh, col, 0.15);
          for (let k = 6; k < hh - 3; k += 6) { line(up(r.d, k * z), up(r.c, k * z), 'rgba(220,240,255,.6)', 1.2 * z); line(up(r.c, k * z), up(r.b, k * z), 'rgba(200,225,255,.35)', 1.2 * z); }
          break;
        }
        case 'housing': {
          for (let i = 0; i < b.w; i++) for (let j = 0; j < b.h; j++) {
            const q = box(b.x + i, b.y + j, 1, 1, 9 + (b.lvl - 1) * 7, i + j === 1 ? '#e6c8a0' : col, 0.2);
            const top = q.Hh, m1 = P(b.x + i + 0.5, b.y + j + 0.2), m2 = P(b.x + i + 0.5, b.y + j + 0.8);
            poly([up(q.d, top), up(q.c, top), up(m2, top + 9 * z), up(m1, top + 9 * z), up(q.a, top)], '#a4463a');
            poly([up(q.c, top), up(q.b, top), up(m1, top + 9 * z), up(m2, top + 9 * z)], '#7d3027');
          }
          r = { c: P(b.x + b.w, b.y + b.h) };
          break;
        }
        case 'lab': {
          r = box(b.x, b.y, b.w, b.h, 14 + b.lvl * 4, col, 0.1);
          const c = up(P(b.x + b.w / 2, b.y + b.h / 2), r.Hh);
          ctx.fillStyle = '#cfd6e2'; ctx.beginPath(); ctx.ellipse(c[0], c[1], 16 * z, 8 * z, 0, Math.PI, 0); ctx.ellipse(c[0], c[1], 16 * z, 16 * z, 0, 0, Math.PI, true); ctx.fill();
          line([c[0] - 2 * z, c[1] - 15 * z], [c[0] + 4 * z, c[1] - 3 * z], '#40506a', 2 * z);
          break;
        }
        case 'test': {
          r = box(b.x, b.y, b.w, b.h, 8, col, 0.08);
          box(b.x + 0.55, b.y + 0.3, 0.3, 0.3, 46 + b.lvl * 6, '#6c727b', 0.02);
          box(b.x + 1.15, b.y + 0.3, 0.3, 0.3, 46 + b.lvl * 6, '#6c727b', 0.02);
          const c = P(b.x + b.w / 2, b.y + b.h * 0.55);
          cyl(b.x + b.w / 2, b.y + 0.45, 0.12, 22, '#dfe3ea', 18);
          const ph = (t * 0.35 + hash(b.x, b.y)) % 1;
          if (ph < 0.35) { // steam plume from a hot fire
            const k = ph / 0.35;
            ctx.fillStyle = `rgba(240,240,240,${0.6 * (1 - k)})`;
            for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(c[0] + (i * 9 + k * 30) * z, c[1] - (4 + i * 4 + k * 20) * z, (6 + i * 3 + k * 10) * z, 0, Math.PI * 2); ctx.fill(); }
            ctx.fillStyle = 'rgba(255,170,60,.9)'; ctx.beginPath(); ctx.arc(c[0], c[1] - 10 * z, 3.5 * z, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'mc': {
          r = box(b.x, b.y, b.w, b.h, 14 + b.lvl * 3, col, 0.12);
          const c = up(P(b.x + b.w * 0.35, b.y + b.h * 0.35), r.Hh);
          line(c, up(c, 26 * z), '#d0d6e0', 1.5 * z);
          const d = up(P(b.x + b.w * 0.7, b.y + b.h * 0.6), r.Hh);
          ctx.fillStyle = '#f0f3f7'; ctx.beginPath(); ctx.ellipse(d[0], d[1] - 6 * z, 9 * z, 5 * z, -0.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#6b7690'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#9fdcff'; for (let k = 4; k < r.Hh / z - 3; k += 5) { const a = up(r.d, k * z), e = up(r.c, k * z); ctx.globalAlpha = alpha * 0.5; line(a, e, '#9fdcff', 1.5 * z); ctx.globalAlpha = alpha; }
          break;
        }
        case 'tank': {
          r = box(b.x, b.y, b.w, b.h, 1, '#8f9298', 0.05);
          const hh = 14 + b.lvl * 5;
          for (const [i, j] of [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]]) cyl(b.x + i * b.w / 2, b.y + j * b.h / 2, 0.33, hh, (i + j) % 2 ? col : '#f2e9d8', 1);
          break;
        }
        case 'lz': {
          r = box(b.x, b.y, b.w, b.h, 2, col, 0.06);
          const c = up(P(b.x + b.w / 2, b.y + b.h / 2), 2 * z);
          ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 2.5 * z; ctx.beginPath(); ctx.ellipse(c[0], c[1], 24 * z, 12 * z, 0, 0, Math.PI * 2); ctx.stroke();
          line(up(P(b.x + 0.6, b.y + 0.6), 2 * z), up(P(b.x + 1.4, b.y + 1.4), 2 * z), '#f2f2f2', 3 * z);
          line(up(P(b.x + 1.4, b.y + 0.6), 2 * z), up(P(b.x + 0.6, b.y + 1.4), 2 * z), '#f2f2f2', 3 * z);
          break;
        }
        case 'port': {
          r = box(b.x, b.y, b.w, b.h, 3, col, 0.04);
          let sea = null;
          for (let yy = b.y; yy < b.y + b.h && !sea; yy++) for (let xx = b.x; xx < b.x + b.w && !sea; xx++)
            for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (sc.site.map[yy + dy] && sc.site.map[yy + dy][xx + dx] === 'S') { sea = [xx + dx, yy + dy]; break; }
          if (sea) {
            const bob = Math.sin(t * 1.3) * 1.2;
            const q = box(sea[0] + 0.05, sea[1] + 0.12, 0.9, 0.76, 4 + bob, '#3c414b', 0.02);
            ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 1.5 * z; poly([up(q.a, q.Hh), up(q.b, q.Hh), up(q.c, q.Hh), up(q.d, q.Hh)], null, '#ffd54a', 1.5 * z);
          }
          const m = up(P(b.x + 0.4, b.y + 0.5), 3 * z);
          line(m, up(m, 30 * z), '#f2a93b', 2.5 * z);
          line(up(m, 30 * z), [m[0] + 22 * z, m[1] - 22 * z], '#f2a93b', 2 * z);
          break;
        }
        case 'tower': {
          const hh = 70 + b.lvl * 8;
          const [a, bb, c, d] = corners(b.x, b.y, 1, 1, 0.25);
          box(b.x, b.y, 1, 1, 3, '#7b8089', 0.15);
          for (const p of [a, bb, c, d]) line(p, up(p, hh * z), '#5a606a', 2 * z);
          for (let k = 8; k < hh; k += 10) { poly([up(a, k * z), up(bb, k * z), up(c, k * z), up(d, k * z)], null, '#8a909a', 1); line(up(d, k * z), up(c, (k + 10) * z), '#8a909a', 1); }
          towerArms(sc.site, b, sc.buildings, hh, t);
          r = { c };
          break;
        }
        case 'solar': {
          r = box(b.x, b.y, b.w, b.h, 1, '#7d7a6e', 0.05);
          const rows = 3 * b.h;
          for (let i = 0; i < rows; i++) {
            const y0 = b.y + 0.12 + i * (b.h - 0.24) / rows, y1 = y0 + (b.h - 0.24) / rows * 0.7;
            poly([up(P(b.x + 0.12, y0), 6 * z), up(P(b.x + b.w - 0.12, y0), 6 * z), up(P(b.x + b.w - 0.12, y1), 2 * z), up(P(b.x + 0.12, y1), 2 * z)], i % 2 ? '#2c4a86' : '#34569a', 'rgba(160,200,255,.4)', 1);
          }
          break;
        }
        case 'visitor': {
          r = box(b.x, b.y, b.w, b.h, 11 + b.lvl * 3, col, 0.12);
          for (let k = 3; k < r.Hh / z - 2; k += 4) line(up(r.d, k * z), up(r.c, k * z), 'rgba(255,255,255,.35)', 1);
          const sx = b.w >= b.h ? b.x + b.w - 0.3 : b.x + 0.5, sy = b.w >= b.h ? b.y + 0.5 : b.y + b.h - 0.3;
          const rk = cyl(sx, sy, 0.07, 22, '#ffffff', r.Hh / z);
          poly([[rk.p[0] - rk.rx, rk.p[1] - rk.Hh], [rk.p[0] + rk.rx, rk.p[1] - rk.Hh], [rk.p[0], rk.p[1] - rk.Hh - 7 * z]], '#ff7a1a');
          break;
        }
        case 'satfab': {
          r = box(b.x, b.y, b.w, b.h, 20 + b.lvl * 4, col, 0.08);
          const k = r.Hh * 0.55;
          poly([up(r.d, k), up(r.c, k), up(r.c, k + 5 * z), up(r.d, k + 5 * z)], '#3d7fe0');
          poly([up(r.c, k), up(r.b, k), up(r.b, k + 5 * z), up(r.c, k + 5 * z)], '#2b5fae');
          const c = up(P(b.x + b.w / 2, b.y + b.h / 2), r.Hh + 8 * z);
          poly([[c[0] - 16 * z, c[1]], [c[0] - 5 * z, c[1] - 3 * z], [c[0] - 5 * z, c[1] + 3 * z]], '#2b5fae');
          poly([[c[0] + 16 * z, c[1]], [c[0] + 5 * z, c[1] - 3 * z], [c[0] + 5 * z, c[1] + 3 * z]], '#2b5fae');
          ctx.fillStyle = '#d9a43b'; ctx.fillRect(c[0] - 4 * z, c[1] - 4 * z, 8 * z, 8 * z);
          break;
        }
        case 'fab': {
          r = box(b.x, b.y, b.w, b.h, 18 + b.lvl * 4, col, 0.08);
          const k = r.Hh * 0.7;
          poly([up(r.d, k), up(r.c, k), up(r.c, k + 4 * z), up(r.d, k + 4 * z)], '#6b4fd8');
          poly([up(r.c, k), up(r.b, k), up(r.b, k + 4 * z), up(r.c, k + 4 * z)], '#53399f');
          for (let i = 0; i < 1 + b.lvl; i++) {
            cyl(b.x + 0.6 + i * 0.7, b.y + 0.5, 0.12, 12, '#cfd5de', r.Hh / z);
          }
          break;
        }
        case 'ground': {
          r = box(b.x, b.y, 1, 1, 3, '#8f939b', 0.18);
          const c = P(b.x + 0.5, b.y + 0.5), hh = 12 + b.lvl * 3;
          line(c, up(c, hh * z), '#9aa0a8', 3 * z);
          const d = up(c, (hh + 6) * z), ang = -0.6 + Math.sin(t * 0.2 + b.x) * 0.15;
          ctx.fillStyle = '#f4f6f9'; ctx.beginPath(); ctx.ellipse(d[0], d[1], 13 * z, 6 * z, ang, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#7a8496'; ctx.lineWidth = 1.2; ctx.stroke();
          line(d, [d[0] + 7 * z * Math.cos(ang - 1.2), d[1] - 9 * z], '#7a8496', 1.2);
          break;
        }
        default: r = box(b.x, b.y, b.w, b.h, 12, col);
      }
      if (b.days > 0) { // upgrade in progress
        scaffold(b, HGT(b), t);
        ctx.globalAlpha = 1;
        const c = P(b.x + b.w / 2, b.y + b.h / 2);
        if (alpha >= 1) pill(c[0], c[1] - (HGT(b) + 30) * z, `UPGRADING ${Math.round(b.prog * 100)}%`, 'rgba(20,14,0,.85)', '#ffd54a');
      }
      ctx.globalAlpha = 1;
      if (alpha >= 1 && r && r.c) pips(b, r);
    }
    function HGT(b) {
      return { pad: 50, factory: 28, office: 40, housing: 14, lab: 22, test: 52, mc: 18, tank: 22, lz: 6, port: 30, tower: 78, solar: 8, visitor: 16, satfab: 26, fab: 30, ground: 22 }[b.type] || 20;
    }
    function scaffold(b, full, t) {
      const z = cam.z, [a, bb, c, d] = corners(b.x, b.y, b.w, b.h, 0.05), Hh = full * z, col = '#f2c14b';
      for (const p of [bb, c, d]) line(p, up(p, Hh), col, 1.3);
      for (let k = 8 * z; k <= Hh; k += 9 * z) { line(up(d, k), up(c, k), col, 1); line(up(c, k), up(bb, k), col, 1); }
      line(up(d, Hh), up(c, 0), 'rgba(242,193,75,.5)', 1);
      // crane at the back corner, jib swings slowly
      const m = P(b.x + 0.25, b.y + 0.25), top = up(m, Hh + 26 * z);
      line(m, top, '#f2a93b', 2.5 * z);
      const ang = t * 0.4 + b.x, L = (28 + 10 * b.w) * z;
      const e = [top[0] + Math.cos(ang) * L, top[1] + Math.sin(ang) * L * 0.5];
      const e2 = [top[0] - Math.cos(ang) * L * 0.35, top[1] - Math.sin(ang) * L * 0.18];
      line(e2, e, '#f2a93b', 2 * z);
      ctx.fillStyle = '#555'; ctx.fillRect(e2[0] - 3 * z, e2[1] - 2 * z, 6 * z, 5 * z);
      const hookY = e[1] + (14 + 8 * Math.sin(t * 0.9)) * z;
      line(e, [e[0], hookY], '#ddd', 1);
      ctx.fillStyle = '#8a8f99'; ctx.fillRect(e[0] - 3 * z, hookY, 6 * z, 4 * z);
    }

    // ---------- overlays ----------
    function check(p, s) { ctx.strokeStyle = '#06331f'; ctx.lineWidth = 3.2 * s; ctx.beginPath(); ctx.moveTo(p[0] - 6 * s, p[1]); ctx.lineTo(p[0] - 1.5 * s, p[1] + 4 * s); ctx.lineTo(p[0] + 7 * s, p[1] - 5 * s); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 * s; ctx.stroke(); }
    function cross(p, s) { ctx.strokeStyle = '#3a0007'; ctx.lineWidth = 3.4 * s; ctx.beginPath(); ctx.moveTo(p[0] - 5 * s, p[1] - 5 * s); ctx.lineTo(p[0] + 5 * s, p[1] + 5 * s); ctx.moveTo(p[0] + 5 * s, p[1] - 5 * s); ctx.lineTo(p[0] - 5 * s, p[1] + 5 * s); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 * s; ctx.stroke(); }
    function saleSign(x, y) {
      const p = P(x + 0.5, y + 0.5), z = cam.z;
      line(p, up(p, 14 * z), '#5b4130', 1.5 * z);
      const q = up(p, 14 * z);
      ctx.fillStyle = '#fff7e0'; ctx.fillRect(q[0] - 7 * z, q[1] - 6 * z, 14 * z, 9 * z);
      ctx.strokeStyle = '#5b4130'; ctx.lineWidth = 1; ctx.strokeRect(q[0] - 7 * z, q[1] - 6 * z, 14 * z, 9 * z);
      ctx.fillStyle = '#1f6b3c'; ctx.font = `800 ${Math.max(7, 8 * z)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', q[0], q[1] - 1.5 * z);
    }

    function draw(now) {
      const sc = api.scene();
      if (!sc) return;
      const site = sc.site, w = site.w, h = site.h, t = (now - t0) / 1000, z = cam.z;
      if (fitted !== (site.base || site.id)) fit(site);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0d1524'); g.addColorStop(1, '#16233a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const hasSea = site.map.some((r) => r.includes('S'));
      if (hasSea) {
        poly([P(-14, -14), P(w + 14, -14), P(w + 14, h + 14), P(-14, h + 14)], '#1a5884');
        // extend coastline outward so the ocean looks endless
        for (let y = -2; y < h + 2; y++) for (let x = -2; x < w + 2; x++) {
          if (x >= 0 && y >= 0 && x < w && y < h) continue;
          const cx = Math.max(0, Math.min(w - 1, x)), cy = Math.max(0, Math.min(h - 1, y));
          const ch = site.map[cy][cx];
          if (ch === 'S') continue;
          const [a, b, c, d] = corners(x, y, 1, 1, 0);
          poly([a, b, c, d], shade(GROUND[ch === 'R' || ch === 'C' || ch === 'w' || ch === 't' || ch === 'r' ? (ch === 'C' ? 'C' : 'c') : ch], -0.35));
        }
      } else {
        const Dd = 16 * z;
        poly([P(0, h), P(w, h), up(P(w, h), -Dd), up(P(0, h), -Dd)], '#5a4632');
        poly([P(w, h), P(w, 0), up(P(w, 0), -Dd), up(P(w, h), -Dd)], '#3f3123');
      }
      for (let s = 0; s <= w + h - 2; s++) for (let x = Math.max(0, s - h + 1); x <= Math.min(w - 1, s); x++) {
        const y = s - x; ground(site, x, y, site.map[y][x], t);
      }
      // owned land: light tint + dashed fence along the boundary
      const own = (x, y) => sc.owned.has(y * w + x);
      ctx.setLineDash([5 * z, 3 * z]);
      for (const k of sc.owned) {
        const x = k % w, y = Math.floor(k / w), [a, b, c, d] = corners(x, y, 1, 1, 0);
        poly([a, b, c, d], 'rgba(255,240,200,.10)');
        if (y === 0 || !own(x, y - 1)) line(a, b, '#fff1c9', 2);
        if (x === w - 1 || !own(x + 1, y)) line(b, c, '#fff1c9', 2);
        if (y === h - 1 || !own(x, y + 1)) line(d, c, '#fff1c9', 2);
        if (x === 0 || !own(x - 1, y)) line(a, d, '#fff1c9', 2);
      }
      ctx.setLineDash([]);
      // preview footprint (ground part)
      const pv = sc.preview;
      if (pv) for (const tl of pv.tiles) {
        if (tl.x < 0 || tl.y < 0 || tl.x >= w || tl.y >= h) continue;
        const [a, b, c, d] = corners(tl.x, tl.y, 1, 1, 0.03);
        const okk = tl.ok && pv.ok;
        if (!okk) ctx.setLineDash([4, 3]);
        poly([a, b, c, d], okk ? 'rgba(61,220,151,.38)' : 'rgba(255,93,108,.42)', okk ? '#3ddc97' : '#ff5d6c', 2);
        ctx.setLineDash([]);
      }
      // objects: trees, city, buildings, sale signs, painter-sorted by front corner
      const objs = [];
      const occ = new Set();
      for (const b of sc.buildings) for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) occ.add(yy * w + xx);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ch = site.map[y][x];
        if (ch === 't' && !occ.has(y * w + x)) objs.push({ k: x + y + 2, f: () => tree(x, y) });
        else if (ch === 'C') objs.push({ k: x + y + 2, f: () => cityBlock(x, y) });
        if (sc.mode === 'buy' && sc.open && !own(x, y) && sc.TER[ch] && sc.TER[ch].buy) objs.push({ k: x + y + 1.9, f: () => saleSign(x, y) });
      }
      for (const b of sc.buildings) objs.push({ k: b.x + b.w + b.y + b.h, f: () => drawB(b, sc, t, 1) });
      if (pv) {
        const gb = { type: pv.type, x: pv.x, y: pv.y, w: pv.w, h: pv.h, lvl: 1, days: 0, prog: 1 };
        objs.push({ k: pv.x + pv.w + pv.y + pv.h + 0.5, f: () => drawB(gb, sc, t, pv.ok ? 0.6 : 0.3) });
      }
      objs.sort((a, b) => a.k - b.k);
      for (const o of objs) o.f();
      // preview marks on top so they are never hidden
      if (pv) for (const tl of pv.tiles) {
        if (tl.x < 0 || tl.y < 0 || tl.x >= w || tl.y >= h) continue;
        const p = P(tl.x + 0.5, tl.y + 0.5), s = Math.max(0.8, Math.min(1.6, z * 1.1));
        if (tl.ok && pv.ok) check(p, s); else cross(p, s);
      }
      // selection
      if (sc.sel) {
        const [a, b, c, d] = corners(sc.sel.x, sc.sel.y, sc.sel.w, sc.sel.h, 0);
        ctx.setLineDash([7, 4]); ctx.lineDashOffset = -t * 20;
        poly([a, b, c, d], 'rgba(255,213,74,.12)', '#ffd54a', 3);
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        if (sc.sel.label) { const p = P(sc.sel.x + sc.sel.w / 2, sc.sel.y + sc.sel.h / 2); pill(p[0], c[1] + 16, '▲ ' + sc.sel.label, 'rgba(11,15,26,.88)', '#ffd54a'); }
      }
      if (sc.hover && !pv && sc.hover.x >= 0 && sc.hover.y >= 0 && sc.hover.x < w && sc.hover.y < h) {
        const [a, b, c, d] = corners(sc.hover.x, sc.hover.y, 1, 1, 0);
        poly([a, b, c, d], 'rgba(255,255,255,.08)', 'rgba(255,255,255,.7)', 1.5);
      }
    }

    function loop(now) {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden || !cv.isConnected || wrap.offsetParent === null) return;
      if (W < 2) { resize(); if (W < 2) return; }
      if (!need && now - last < 90) return; // ~11 fps idle animation, full speed while interacting
      need = false; last = now;
      draw(now);
    }

    // ---------- input ----------
    const pts = new Map();
    let drag = null, pinch = null, moved = false, hoverKey = '';
    const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function onDown(e) {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      const [x, y] = rel(e);
      pts.set(e.pointerId, [x, y]);
      if (pts.size === 1) { drag = { x, y, cx: cam.x, cy: cam.y }; moved = false; }
      else if (pts.size === 2) {
        const [p1, p2] = [...pts.values()];
        pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), z: cam.z }; moved = true;
      }
    }
    function onMove(e) {
      const [x, y] = rel(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [x, y]);
      if (pinch && pts.size >= 2) {
        const [p1, p2] = [...pts.values()];
        const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        zoomAt((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (pinch.z * d / pinch.d) / cam.z);
        return;
      }
      if (drag && pts.size === 1) {
        const dx = x - drag.x, dy = y - drag.y;
        if (!moved && Math.hypot(dx, dy) > 7) moved = true;
        if (moved) { cam.x = drag.cx + dx; cam.y = drag.cy + dy; need = true; cv.style.cursor = 'grabbing'; }
        return;
      }
      if (e.pointerType === 'mouse') {
        const tl = toTile(x, y), k = tl.x + ',' + tl.y;
        if (k !== hoverKey) { hoverKey = k; api.hover(tl); need = true; }
      }
    }
    function onUp(e) {
      const [x, y] = rel(e);
      const wasTap = drag && !moved && pts.size === 1;
      pts.delete(e.pointerId);
      cv.style.cursor = '';
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const [p] = [...pts.values()]; drag = { x: p[0], y: p[1], cx: cam.x, cy: cam.y }; }
      if (pts.size === 0) drag = null;
      if (wasTap && e.type === 'pointerup') { const tl = toTile(x, y); tl.mouse = e.pointerType === 'mouse'; api.tap(tl); need = true; }
    }
    function onWheel(e) { e.preventDefault(); const [x, y] = rel(e); zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); }
    function onLeave() { hoverKey = ''; api.hover(null); need = true; }
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('wheel', onWheel, { passive: false });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(wrap); else window.addEventListener('resize', resize);
    resize();
    raf = requestAnimationFrame(loop);

    return {
      fit() { fitted = null; need = true; },
      zoomBy(f) { zoomAt(W / 2, H / 2, f); },
      dirty() { need = true; },
      screenOf(x, y) { return P(x + 0.5, y + 0.5); },
      dispose() {
        alive = false; cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        cv.remove();
      },
    };
  }


  // =====================================================================================
  // 3D photoreal campus view (three.js, own WebGLRenderer on the campus canvas).
  // Golden-hour sun with soft shadows, Preetham sky, sky-matched haze, PBR buildings,
  // shader ocean with sun glint and shore foam. Renders only on change/interaction, plus a
  // gentle throttled loop while water or cranes are on screen.
  // =====================================================================================
  const T = window.THREE;
  const TS = 40; // metres per plot
  const PADT = 14; // landscape tiles drawn around the site
  const VEGPAD = 9; // vegetation reaches this many tiles out
  const RS = 8; // sdf pixels per tile
  const RA = 14; // albedo pixels per tile
  const DEG = Math.PI / 180;
  const SKYP = { turbidity: 4, rayleigh: 1.6, mie: 0.0045, g: 0.85 };
  const SUN_EL = 17 * DEG;

  // ---------- deterministic noise ----------
  function nh(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnz(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = nh(xi, yi, s), b = nh(xi + 1, yi, s), c = nh(xi, yi + 1, s), d = nh(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbz(x, y, s, o) {
    let t = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < (o || 4); i++) { t += a * vnz(x * f, y * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
    return t / n;
  }
  function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ---------- Preetham sky in JS (same maths as vendor/sky.js) for haze and water ----------
  function skyEval(d, sun, P, out) {
    const e = Math.E, pi = Math.PI;
    const tR = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5];
    const MC = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];
    const cutoff = 1.6110731556870734;
    const sunE = 1000 * Math.max(0, 1 - Math.pow(e, -((cutoff - Math.acos(clamp(sun[1], -1, 1))) / 1.5)));
    const sunfade = 1 - clamp(1 - Math.exp(sun[1]), 0, 1);
    const rc = P.rayleigh - (1 - sunfade);
    const c = 0.2 * P.turbidity * 10E-18;
    const za = Math.acos(Math.max(0, d[1]));
    const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 180 / pi, -1.253));
    const sR = 8.4E3 * inv, sM = 1.25E3 * inv;
    const cosT = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
    const rPh = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
    const g2 = P.g * P.g;
    const mPh = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * P.g * cosT + g2, 1.5));
    const k5 = clamp(Math.pow(1 - sun[1], 5), 0, 1);
    for (let i = 0; i < 3; i++) {
      const bR = tR[i] * rc, bM = 0.434 * c * MC[i] * P.mie;
      const Fex = Math.exp(-(bR * sR + bM * sM));
      const ratio = (bR * rPh + bM * mPh) / (bR + bM);
      let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
      Lin *= (1 - k5) + k5 * Math.pow(sunE * ratio * Fex, 0.5);
      const tex = (Lin + 0.1 * Fex) * 0.04 + [0, 0.0003, 0.00075][i];
      out[i] = Math.pow(tex, 1 / (1.2 + 1.2 * sunfade));
    }
    return out;
  }

  const CACHE = { sites: {}, canv: {}, wave: null, skyData: null };

  function skyTable(sunV) {
    if (!CACHE.skyData) {
      const W = 128, Hh = 32, data = new Uint16Array(W * Hh * 4);
      const sun = [sunV.x, sunV.y, sunV.z], o = [0, 0, 0], d = [0, 0, 0];
      const toH = T.DataUtils.toHalfFloat;
      for (let j = 0; j < Hh; j++) {
        const ev = (j + 0.5) / Hh, y = ev * ev;
        for (let i = 0; i < W; i++) {
          const az = ((i + 0.5) / W - 0.5) * Math.PI * 2, ch = Math.sqrt(Math.max(0, 1 - y * y));
          d[0] = Math.cos(az) * ch; d[1] = y; d[2] = Math.sin(az) * ch;
          skyEval(d, sun, SKYP, o);
          const k = (j * W + i) * 4;
          data[k] = toH(o[0]); data[k + 1] = toH(o[1]); data[k + 2] = toH(o[2]); data[k + 3] = toH(1);
        }
      }
      const sc = [0, 0, 0], am = [0, 0, 0];
      const v = [sunV.x, sunV.y + 0.02, sunV.z], l = Math.hypot(v[0], v[1], v[2]);
      skyEval(v.map((q) => q / l), sun, SKYP, sc);
      skyEval([0, 1, 0], sun, SKYP, am);
      CACHE.skyData = { data, W, Hh, sunCol: sc, amb: am };
    }
    const D = CACHE.skyData;
    const tex = new T.DataTexture(D.data, D.W, D.Hh, T.RGBAFormat, T.HalfFloatType);
    tex.minFilter = tex.magFilter = T.LinearFilter; tex.wrapS = T.RepeatWrapping; tex.wrapT = T.ClampToEdgeWrapping;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    return { tex, sunCol: D.sunCol, amb: D.amb };
  }

  // Tileable wave slope map (R,G slope, B height) from a random directional spectrum.
  function waveData() {
    if (CACHE.wave) return CACHE.wave;
    const N = 256, r = rng(1234), waves = [];
    for (let i = 0; i < 80; i++) {
      const km = 2 + Math.pow(r(), 1.6) * 30, ang = 0.5 + (r() - 0.5) * 2.4 * (r() < 0.8 ? 0.6 : 1.4);
      const kx = Math.round(Math.cos(ang) * km), kz = Math.round(Math.sin(ang) * km);
      if (!kx && !kz) continue;
      waves.push([kx, kz, 1 / Math.pow(Math.hypot(kx, kz), 1.9), r() * Math.PI * 2]);
    }
    const sx = new Float32Array(N * N), sz = new Float32Array(N * N), hh = new Float32Array(N * N);
    let mx = 0, mh = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let ax = 0, az = 0, h = 0;
      for (const [kx, kz, A, ph] of waves) {
        const t = (kx * x + kz * y) / N * Math.PI * 2 + ph, c = Math.cos(t);
        h += A * Math.sin(t); ax += A * kx * c; az += A * kz * c;
      }
      const i = y * N + x; sx[i] = ax; sz[i] = az; hh[i] = h;
      mx = Math.max(mx, Math.abs(ax), Math.abs(az)); mh = Math.max(mh, Math.abs(h));
    }
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = Math.round((sx[i] / mx * 0.5 + 0.5) * 255);
      data[i * 4 + 1] = Math.round((sz[i] / mx * 0.5 + 0.5) * 255);
      data[i * 4 + 2] = Math.round((hh[i] / mh * 0.5 + 0.5) * 255);
      data[i * 4 + 3] = 255;
    }
    CACHE.wave = { data, N };
    return CACHE.wave;
  }

  // ---------- canvas textures (painted once per page) ----------
  function cnv(key, w, h, paint) {
    if (!CACHE.canv[key]) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      paint(c.getContext('2d'), w, h, rng(key.length * 977 + w));
      CACHE.canv[key] = c;
    }
    return CACHE.canv[key];
  }
  function speck(g, w, h, r, n, rgb, amax, smax) {
    for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rgb},${r() * amax})`; const s = 1 + r() * smax; g.fillRect(r() * w, r() * h, s, s); }
  }
  const PAINT = {
    conc: (g, w, h, r) => {
      g.fillStyle = '#b9b5ac'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 2200, '255,250,240', 0.08, 4); speck(g, w, h, r, 2200, '40,38,34', 0.08, 4);
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(70,62,50,${r() * 0.07})`; g.beginPath(); g.arc(r() * w, r() * h, 8 + r() * 34, 0, 6.3); g.fill(); }
      g.strokeStyle = 'rgba(45,42,38,0.28)'; g.lineWidth = 1.2;
      for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(k * w / 2, 0); g.lineTo(k * w / 2, h); g.moveTo(0, k * h / 2); g.lineTo(w, k * h / 2); g.stroke(); }
    },
    asph: (g, w, h, r) => {
      g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 4000, '200,200,195', 0.12, 2); speck(g, w, h, r, 3000, '10,10,10', 0.2, 2);
      for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(20,20,20,${r() * 0.12})`; g.beginPath(); g.arc(r() * w, r() * h, 10 + r() * 30, 0, 6.3); g.fill(); }
    },
    road: (g, w, h, r) => { // x = along the road (12 m), y = across
      PAINT.asph(g, w, h, r);
      g.fillStyle = 'rgba(70,66,58,0.5)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
      g.fillStyle = 'rgba(235,235,228,0.85)'; g.fillRect(0, 9, w, 3); g.fillRect(0, h - 12, w, 3);
      g.fillStyle = 'rgba(222,176,52,0.9)'; g.fillRect(0, h / 2 - 2, w * 0.42, 4);
      g.fillStyle = 'rgba(30,30,30,0.18)'; g.fillRect(0, h * 0.27, w, 5); g.fillRect(0, h * 0.7, w, 5);
    },
    parking: (g, w, h, r) => { // 20 m square
      PAINT.asph(g, w, h, r);
      g.fillStyle = 'rgba(232,232,225,0.8)';
      for (let x = 0; x < w; x += w / 8) g.fillRect(x, 0, 2, h * 0.4), g.fillRect(x, h * 0.6, 2, h * 0.4);
    },
    clad: (g, w, h, r) => {
      g.fillStyle = '#d9d8d3'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 3, 0, 2, h); }
      speck(g, w, h, r, 300, '90,80,70', 0.05, 3);
      g.fillStyle = 'rgba(80,70,60,0.08)'; g.fillRect(0, h - 10, w, 10);
    },
    door: (g, w, h, r) => {
      g.fillStyle = '#8f979f'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, h); }
      g.fillStyle = 'rgba(20,24,28,0.6)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
      for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, y, w, 2); }
      speck(g, w, h, r, 200, '60,50,40', 0.08, 3);
    },
    curtain: (g, w, h, r) => { // 4 bays x 4 floors (16 m)
      const bw = w / 4, fh = h / 4;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const gr = g.createLinearGradient(0, j * fh, 0, (j + 1) * fh);
        const b = 0.85 + r() * 0.3;
        gr.addColorStop(0, `rgb(${Math.round(120 * b)},${Math.round(150 * b)},${Math.round(175 * b)})`);
        gr.addColorStop(1, `rgb(${Math.round(40 * b)},${Math.round(56 * b)},${Math.round(72 * b)})`);
        g.fillStyle = gr; g.fillRect(i * bw, j * fh, bw, fh);
        if (r() < 0.3) { g.fillStyle = 'rgba(230,236,240,0.35)'; g.fillRect(i * bw + 3, j * fh + 3, bw * 0.3, fh - 12); } // blinds
      }
      g.fillStyle = '#c8ccd0'; for (let i = 0; i <= 4; i++) g.fillRect(i * bw - 1.5, 0, 3, h);
      for (let j = 0; j <= 4; j++) { g.fillStyle = '#3a4048'; g.fillRect(0, j * fh - 6, w, 8); g.fillStyle = '#c8ccd0'; g.fillRect(0, j * fh - 7, w, 2); }
    },
    curtainEm: (g, w, h, r) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      const bw = w / 4, fh = h / 4;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (r() < 0.22) { g.fillStyle = `rgba(255,${190 + r() * 40 | 0},120,${0.4 + r() * 0.5})`; g.fillRect(i * bw + 2, j * fh + 2, bw - 4, fh - 10); }
    },
    facadeA: (g, w, h, r) => facade(g, w, h, r, '#9a968c', 6, 6, false),
    facadeB: (g, w, h, r) => facade(g, w, h, r, '#7e7468', 5, 7, false),
    facadeAEm: (g, w, h, r) => facade(g, w, h, r, '#9a968c', 6, 6, true),
    facadeBEm: (g, w, h, r) => facade(g, w, h, r, '#7e7468', 5, 7, true),
    stucco: (g, w, h, r) => { // 12 m: 3 bays x 4 floors of 3 m
      g.fillStyle = '#e6dccb'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 1500, '120,100,80', 0.06, 3);
      const bw = w / 3, fh = h / 4;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) {
        const x = i * bw + bw * 0.3, y = j * fh + fh * 0.25;
        g.fillStyle = '#f6f4ef'; g.fillRect(x - 3, y - 3, bw * 0.4 + 6, fh * 0.5 + 6);
        const gr = g.createLinearGradient(0, y, 0, y + fh * 0.5); gr.addColorStop(0, '#7f97ad'); gr.addColorStop(1, '#2b3846');
        g.fillStyle = gr; g.fillRect(x, y, bw * 0.4, fh * 0.5);
        g.fillStyle = '#f6f4ef'; g.fillRect(x + bw * 0.2 - 1, y, 2, fh * 0.5);
      }
    },
    panel: (g, w, h, r) => { // white smooth panels 6 m
      g.fillStyle = '#e9eae7'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 300, '100,100,100', 0.04, 3);
      g.fillStyle = 'rgba(60,64,70,0.25)'; for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += h / 2) g.fillRect(0, y, w, 1);
    },
    roofM: (g, w, h, r) => {
      g.fillStyle = '#7d7f80'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 800, '30,30,30', 0.1, 3); speck(g, w, h, r, 500, '230,230,230', 0.06, 3);
      g.fillStyle = 'rgba(40,40,40,0.25)'; for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 1, h);
    },
    tile: (g, w, h, r) => {
      g.fillStyle = '#9c5640'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 0 : 6; x < w; x += 12) {
        g.fillStyle = `rgba(${150 + r() * 40 | 0},${70 + r() * 25 | 0},${50 + r() * 15 | 0},0.9)`; g.fillRect(x, y, 11, 7);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 6, 11, 2);
      }
    },
    solar: (g, w, h) => {
      g.fillStyle = '#c7cbd0'; g.fillRect(0, 0, w, h);
      const cw = (w - 8) / 10, ch = (h - 8) / 4;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 10; i++) {
        const gr = g.createLinearGradient(0, 4 + j * ch, 0, 4 + (j + 1) * ch); gr.addColorStop(0, '#2a3f66'); gr.addColorStop(1, '#13203a');
        g.fillStyle = gr; g.fillRect(4 + i * cw + 0.5, 4 + j * ch + 0.5, cw - 1, ch - 1);
        g.fillStyle = 'rgba(160,180,220,0.25)'; g.fillRect(4 + i * cw + cw / 2, 4 + j * ch, 0.6, ch);
      }
    },
    lz: (g, w, h, r) => {
      g.fillStyle = '#a9a69f'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 3000, '60,55,50', 0.1, 4); speck(g, w, h, r, 2000, '255,255,250', 0.08, 3);
      const c = w / 2, sg = g.createRadialGradient(c, c, 4, c, c, w * 0.3); sg.addColorStop(0, 'rgba(25,22,20,0.85)'); sg.addColorStop(0.5, 'rgba(40,36,32,0.4)'); sg.addColorStop(1, 'rgba(40,36,32,0)');
      g.fillStyle = sg; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(245,245,240,0.95)'; g.lineWidth = w * 0.035; g.beginPath(); g.arc(c, c, w * 0.36, 0, 6.3); g.stroke();
      g.lineWidth = w * 0.05; g.beginPath(); g.moveTo(c - w * 0.16, c - w * 0.16); g.lineTo(c + w * 0.16, c + w * 0.16); g.moveTo(c + w * 0.16, c - w * 0.16); g.lineTo(c - w * 0.16, c + w * 0.16); g.stroke();
      g.strokeStyle = 'rgba(220,170,40,0.9)'; g.lineWidth = w * 0.012; g.setLineDash([w * 0.04, w * 0.03]); g.beginPath(); g.arc(c, c, w * 0.465, 0, 6.3); g.stroke();
    },
    deck: (g, w, h, r) => {
      g.fillStyle = '#55585c'; g.fillRect(0, 0, w, h);
      speck(g, w, h, r, 2500, '20,20,20', 0.15, 3); speck(g, w, h, r, 600, '160,110,70', 0.12, 4);
      const c = w / 2; g.strokeStyle = 'rgba(230,190,50,0.9)'; g.lineWidth = w * 0.03; g.beginPath(); g.arc(c, h / 2, h * 0.36, 0, 6.3); g.stroke();
      g.strokeStyle = 'rgba(240,240,235,0.8)'; g.lineWidth = w * 0.02; g.beginPath(); g.arc(c, h / 2, h * 0.18, 0, 6.3); g.stroke();
      const sg = g.createRadialGradient(c, h / 2, 2, c, h / 2, h * 0.3); sg.addColorStop(0, 'rgba(20,18,16,0.7)'); sg.addColorStop(1, 'rgba(20,18,16,0)'); g.fillStyle = sg; g.fillRect(0, 0, w, h);
    },
    sign: (g, w, h) => {
      g.fillStyle = '#f7f1df'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#2d5a36'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#1f4a2b'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 30px system-ui, sans-serif'; g.fillText('FOR SALE', w / 2, h * 0.3);
      g.font = '900 54px system-ui, sans-serif'; g.fillText('$', w / 2, h * 0.68);
    },
    hatch: (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,1)';
      for (let k = -h; k < w; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 8, 0); g.lineTo(k + 8 + h, h); g.lineTo(k + h, h); g.fill(); }
    },
  };
  function facade(g, w, h, r, base, nx, ny, em) {
    g.fillStyle = em ? '#000' : base; g.fillRect(0, 0, w, h);
    if (!em) speck(g, w, h, r, 900, '40,36,30', 0.08, 3);
    const bw = w / nx, fh = h / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * bw + bw * 0.16, y = j * fh + fh * 0.2, ww = bw * 0.68, hh = fh * 0.58;
      const lit = r() < 0.16;
      if (em) { if (lit) { g.fillStyle = `rgba(255,${185 + r() * 50 | 0},120,${0.5 + r() * 0.5})`; g.fillRect(x, y, ww, hh); } continue; }
      const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, '#6f879c'); gr.addColorStop(1, '#1f2a36');
      g.fillStyle = lit ? '#d8b070' : gr; g.fillRect(x, y, ww, hh);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + hh, ww, 2);
    }
  }

  // ---------- geometry helpers ----------
  function boxG(w, h, d, uvs) {
    const g = new T.BoxGeometry(w, h, d);
    if (uvs) {
      const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / uvs, uv.getY(i) * dims[f][1] / uvs); }
    }
    return g;
  }
  function cylG(rt, rb, h, seg, uvs, open, ts, tl) {
    const g = new T.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open, ts || 0, tl || Math.PI * 2);
    if (uvs) {
      const uv = g.attributes.uv, c = (rt + rb) * (tl || Math.PI * 2) / 2;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c / uvs, uv.getY(i) * h / uvs);
    }
    return g;
  }
  function prismG(w, d, hgt, uvs) { // gable roof, ridge along x, base at y=0
    const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, s = uvs || 1, sl = Math.hypot(d / 2, hgt);
    const P = [], U = [];
    const tri = (a, b, c, ua, ub, uc) => { P.push(...a, ...b, ...c); U.push(...ua, ...ub, ...uc); };
    // front slope (z1 side)
    tri([x0, 0, z1], [x1, 0, z1], [x1, hgt, 0], [0, 0], [w / s, 0], [w / s, sl / s]);
    tri([x0, 0, z1], [x1, hgt, 0], [x0, hgt, 0], [0, 0], [w / s, sl / s], [0, sl / s]);
    tri([x1, 0, z0], [x0, 0, z0], [x0, hgt, 0], [0, 0], [w / s, 0], [w / s, sl / s]);
    tri([x1, 0, z0], [x0, hgt, 0], [x1, hgt, 0], [0, 0], [w / s, sl / s], [0, sl / s]);
    tri([x1, 0, z1], [x1, 0, z0], [x1, hgt, 0], [0, 0], [d / s, 0], [d / 2 / s, hgt / s]);
    tri([x0, 0, z0], [x0, 0, z1], [x0, hgt, 0], [0, 0], [d / s, 0], [d / 2 / s, hgt / s]);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(U, 2));
    g.computeVertexNormals();
    return g;
  }
  function quadG(x0, z0, x1, z1, y, u0, u1, v0, v1, alongZ) { // flat upward quad
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], 3));
    g.setAttribute('normal', new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const uv = alongZ ? [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1] : [u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0];
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    return g;
  }
  function mergeG(list, keepColor) {
    let n = 0;
    const arr = list.map((g) => { const ng = g.index ? g.toNonIndexed() : g; if (ng !== g) g.dispose(); if (!ng.attributes.normal) ng.computeVertexNormals(); n += ng.attributes.position.count; return ng; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = keepColor ? new Float32Array(n * 3) : null;
    let o = 0;
    for (const g of arr) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      if (col) { if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3); }
      o += c; g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  const _e = new T.Euler(0, 0, 0, 'YXZ'), _q = new T.Quaternion(), _v = new T.Vector3(), _s = new T.Vector3(), _m = new T.Matrix4(), _up = new T.Vector3(0, 1, 0);

  // Collects geometry per material and merges it: one draw call per material per model.
  class Bld {
    constructor() { this.m = new Map(); }
    add(mat, g, x, y, z, rx, ry, rz, sx, sy, sz) {
      _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_v.set(x || 0, y || 0, z || 0), _q, _s.set(sx || 1, sy || 1, sz || 1));
      g.applyMatrix4(_m);
      if (!this.m.has(mat)) this.m.set(mat, []);
      this.m.get(mat).push(g);
      return g;
    }
    box(mat, w, h, d, x, y, z, ry) { return this.add(mat, boxG(w, h, d, mat.userData.uv), x, y + h / 2, z, 0, ry); }
    boxC(mat, w, h, d, x, y, z, rx, ry, rz) { return this.add(mat, boxG(w, h, d, mat.userData.uv), x, y, z, rx, ry, rz); }
    cyl(mat, r, h, x, y, z, seg, rt) { return this.add(mat, cylG(rt == null ? r : rt, r, h, seg || 16, mat.userData.uv), x, y + h / 2, z); }
    cylC(mat, rt, rb, h, x, y, z, rx, ry, rz, seg) { return this.add(mat, cylG(rt, rb, h, seg || 16, mat.userData.uv), x, y, z, rx, ry, rz); }
    sph(mat, r, x, y, z, seg, half) { return this.add(mat, new T.SphereGeometry(r, seg || 16, Math.max(6, (seg || 16) >> 1), 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI), x, y, z); }
    beam(mat, a, b, t) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
      if (L < 1e-3) return null;
      const g = boxG(t, L, t);
      _q.setFromUnitVectors(_up, _v.set(dx / L, dy / L, dz / L));
      _m.compose(_s.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new T.Vector3(1, 1, 1));
      g.applyMatrix4(_m);
      if (!this.m.has(mat)) this.m.set(mat, []);
      this.m.get(mat).push(g);
      return g;
    }
    lattice(mat, x, z, wd, h, step, y0, thick) {
      const y = y0 || 0, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * wd / 2, z + b * wd / 2]);
      const t = thick || Math.max(0.25, wd * 0.06);
      for (const p of c) this.beam(mat, [p[0], y, p[1]], [p[0], y + h, p[1]], t * 1.6);
      const n = Math.max(1, Math.round(h / step));
      for (let k = 0; k <= n; k++) {
        const yy = y + k * h / n;
        for (let i = 0; i < 4; i++) {
          const a = c[i], b = c[(i + 1) % 4];
          this.beam(mat, [a[0], yy, a[1]], [b[0], yy, b[1]], t);
          if (k < n) { const y2 = y + (k + 1) * h / n; if ((k + i) % 2) this.beam(mat, [a[0], yy, a[1]], [b[0], y2, b[1]], t * 0.8); else this.beam(mat, [b[0], yy, b[1]], [a[0], y2, a[1]], t * 0.8); }
        }
      }
    }
    sub(b2, x, y, z, rx, ry, rz) {
      _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_v.set(x || 0, y || 0, z || 0), _q, _s.set(1, 1, 1));
      for (const [mat, gs] of b2.m) { for (const g of gs) g.applyMatrix4(_m); if (!this.m.has(mat)) this.m.set(mat, []); this.m.get(mat).push(...gs); }
      b2.m.clear();
    }
    mesh(override, shadows) {
      const grp = new T.Group();
      for (const [mat, gs] of this.m) {
        if (!gs.length) continue;
        const mm = new T.Mesh(mergeG(gs), override || mat);
        mm.castShadow = !!shadows && !mat.userData.noShadow; mm.receiveShadow = !!shadows;
        grp.add(mm);
      }
      this.m.clear();
      return grp;
    }
  }

  // ---------- reusable parts ----------
  function barrelRoof(B, mat, len, dep, rise, x, y, z, alongZ) {
    const r = (dep * dep / 4 + rise * rise) / (2 * rise), th = 2 * Math.asin(Math.min(1, dep / 2 / r));
    const g = cylG(r, r, len, 28, mat.userData.uv, false, Math.PI / 2 - th / 2, th);
    // cylinder axis y -> along x; arc spans z, crown up
    B.add(mat, g, x, y + rise - r, z, 0, alongZ ? Math.PI / 2 : 0, Math.PI / 2);
  }
  function rocket(B, M, H, r, opt) {
    const o = opt || {};
    const s1 = H * 0.6, is = H * 0.05, s2 = H * 0.2, fc = H * 0.06, nose = H * 0.09;
    let y = 0;
    B.cyl(M.black, r * 0.92, 1.4, 0, y, 0, 20); y += 1.2;
    B.cyl(M.white, r, s1 - 1.2, 0, y, 0, 24); y += s1 - 1.2;
    B.cyl(M.black, r, is, 0, y, 0, 24); y += is;
    if (!o.noUpper) {
      B.cyl(M.white, r, s2, 0, y, 0, 24); y += s2;
      B.cyl(M.white, r * 1.12, fc, 0, y, 0, 24, r * 1.12); y += fc;
      const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new T.Vector2(r * 1.12 * Math.sqrt(1 - t * t) + 0.01, t * nose)); }
      B.add(M.white, new T.LatheGeometry(pts, 24), 0, y, 0); y += nose;
      if (o.fins) for (let k = 0; k < 4; k++) B.boxC(M.black, 0.3, 2.2, 1.6, Math.cos(k * Math.PI / 2) * (r + 0.7), s1 - 3, Math.sin(k * Math.PI / 2) * (r + 0.7), 0, -k * Math.PI / 2);
    }
    return y;
  }
  function stageOnCradle(B, M, len, r) { // a booster lying on a transporter, along x
    const s = new Bld();
    rocket(s, M, len / 0.65, r, { noUpper: true });
    B.sub(s, -len / 2, r + 2.2, 0, 0, 0, -Math.PI / 2);
    B.box(M.steelDark, len * 0.92, 1.2, r * 1.6, 0, 0.6, 0);
    for (let i = -2; i <= 2; i++) { B.cylC(M.black, 0.6, 0.6, r * 1.8, i * len * 0.2, 0.6, 0, Math.PI / 2, 0, 0, 10); }
    B.box(M.yellow, 4, 3.2, r * 1.7, len * 0.48 + 2, 0, 0);
    for (const f of [-0.3, 0.3]) B.box(M.steelDark, 1.2, r * 1.4, r * 2, f * len, 1.2, 0);
  }
  function dish(B, M, x, z, r, base, elev, az) {
    const d = new Bld(), f = r * 0.45, pts = [];
    for (let i = 0; i <= 10; i++) { const rr = r * i / 10; pts.push(new T.Vector2(rr + 0.001, rr * rr / (4 * f))); }
    d.add(M.dishW, new T.LatheGeometry(pts, 28), 0, 0, 0);
    const rimY = r * r / (4 * f);
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; d.beam(M.steel, [Math.cos(a) * r * 0.9, rimY * 0.85, Math.sin(a) * r * 0.9], [0, f, 0], Math.max(0.12, r * 0.025)); }
    d.boxC(M.steel, r * 0.12, r * 0.18, r * 0.12, 0, f, 0);
    d.cyl(M.steelDark, r * 0.18, r * 0.25, 0, -r * 0.25, 0, 10);
    B.cyl(M.conc, Math.max(1, r * 0.28), 1, x, 0, z, 12);
    B.cyl(M.white, Math.max(0.5, r * 0.14), base, x, 0, z, 12);
    B.sub(d, x, base + r * 0.15, z, -(Math.PI / 2 - elev), az, 0);
  }
  function radome(B, M, x, z, r) {
    B.cyl(M.conc, r * 0.8, 0.6, x, 0, z, 16);
    B.cyl(M.panel, r * 0.75, r * 0.7, x, 0.6, z, 16);
    B.sph(M.dishW, r, x, r * 0.7 + 0.6 + r * 0.55, z, 20);
  }
  function scaffold(B, M, x0, z0, x1, z1, hh) {
    const sp = 4, off = 1.6;
    const sides = [[x0 - off, z1 + off, x1 + off, z1 + off], [x1 + off, z0 - off, x1 + off, z1 + off], [x0 - off, z0 - off, x1 + off, z0 - off], [x0 - off, z0 - off, x0 - off, z1 + off]];
    for (const [ax, az, bx, bz] of sides) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / sp));
      for (let i = 0; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; B.beam(M.galv, [x, 0, z], [x, hh + 1.5, z], 0.22); }
      for (let y = 2; y <= hh + 1; y += 2) B.beam(M.galv, [ax, y, az], [bx, y, bz], 0.16);
      for (let y = 6; y <= hh; y += 6) { const nx = -(bz - az) / L, nz = (bx - ax) / L; B.add(M.wood, boxG(L, 0.08, 0.9), (ax + bx) / 2 - nx * 0.6, y, (az + bz) / 2 - nz * 0.6, 0, -Math.atan2(bz - az, bx - ax)); }
      for (let i = 0; i < n; i += 2) { const t0 = i / n, t1 = Math.min(1, (i + 1) / n); B.beam(M.galv, [ax + (bx - ax) * t0, 0.5, az + (bz - az) * t0], [ax + (bx - ax) * t1, Math.min(hh, 8), az + (bz - az) * t1], 0.12); }
    }
  }
  function towerCrane(M, hc, jib) { // returns {static Bld, jib Bld} with jib origin at mast top
    const s = new Bld(), j = new Bld();
    s.box(M.conc, 6, 1.2, 6, 0, 0, 0);
    s.lattice(M.yellow, 0, 0, 2.2, hc, 2.4, 1.2, 0.22);
    j.box(M.yellow, 3, 2.6, 3, 0, 0, 0);
    j.box(M.white, 2.4, 2, 2.2, 1.2, -2.2, 2.1);
    for (const [a, b] of [[0, jib], [-jib * 0.32, 0]]) {
      const pts = [[a, 2.6, -0.9], [b, 2.6, -0.9], [b, 2.6, 0.9], [a, 2.6, 0.9]];
      j.beam(M.yellow, pts[0], pts[1], 0.25); j.beam(M.yellow, pts[3], pts[2], 0.25);
      j.beam(M.yellow, [a, 4.2, 0], [b, 4.2, 0], 0.22);
      const n = Math.max(2, Math.round(Math.abs(b - a) / 3));
      for (let i = 0; i < n; i++) { const x0 = a + (b - a) * i / n, x1 = a + (b - a) * (i + 1) / n; j.beam(M.yellow, [x0, 2.6, -0.9], [x1, 4.2, 0], 0.14); j.beam(M.yellow, [x0, 2.6, 0.9], [x1, 4.2, 0], 0.14); }
    }
    j.beam(M.yellow, [0, 9, 0], [jib, 4.2, 0], 0.12); j.beam(M.yellow, [0, 9, 0], [-jib * 0.32, 4.2, 0], 0.12);
    j.beam(M.yellow, [-1, 2.6, 0], [0, 9, 0], 0.3);
    j.box(M.concDark, 4, 3, 2.6, -jib * 0.28, -0.6, 0);
    const tx = jib * 0.62; j.box(M.steelDark, 2, 0.8, 1.6, tx, 1.8, 0);
    j.beam(M.steelDark, [tx, 1.8, 0], [tx, -hc * 0.55, 0], 0.08);
    j.box(M.yellow, 1.2, 1.4, 1.2, tx, -hc * 0.55 - 1.4, 0);
    return { s, j };
  }

  // ---------- building models (local frame: long axis along x, front = +z) ----------
  const HGT = { road: 2, pad: 70, factory: 34, office: 40, housing: 16, lab: 18, test: 50, mc: 16, tank: 26, lz: 4, port: 22, tower: 125, solar: 4, visitor: 16, satfab: 24, fab: 28, ground: 14 };
  const MODELS = {
    factory(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.25, D - 2, 0, 0, 0);
      const H = 18 + 6 * lv, hallL = lv >= 3 ? L - 10 : L - 30, hx = lv >= 3 ? 0 : -10, hallD = D * 0.56, hz = -D / 2 + 4 + hallD / 2;
      B.box(M.clad, hallL, H, hallD, hx, 0, hz);
      barrelRoof(B, M.roof, hallL + 0.8, hallD + 0.8, hallD * 0.11, hx, H, hz);
      const fz = hz + hallD / 2;
      const doorsAt = lv >= 2 ? [hx - hallL * 0.24, hx + hallL * 0.2] : [hx - hallL * 0.12];
      doorsAt.forEach((dx, i) => {
        const dW = Math.min(hallL * 0.3, 36), dH = H * 0.84;
        B.box(M.interior, dW - 1, dH - 0.5, 0.5, dx, 0, fz + 0.05);
        const open = i === 0 ? 0.42 : 0;
        B.box(M.door, dW / 2, dH, 0.7, dx - dW / 4 - open * dW / 2, 0, fz + 0.75);
        B.box(M.door, dW / 2, dH, 0.7, dx + dW / 4, 0, fz + 0.45);
        B.box(M.steelDark, dW + 3, 1.4, 1.6, dx, dH, fz + 0.8);
        B.box(M.yellow, dW + 2, 0.12, 6, dx, 0.26, fz + 3.5);
        if (open) X.interior.push([dx - dW * 0.2, 6, fz - 6]);
      });
      // booster on its transporter rolling out of the main door
      const sl = Math.min(hallL * 0.5, 34 + lv * 5);
      const sB = new Bld(); stageOnCradle(sB, M, sl, 1.8 + lv * 0.35); B.sub(sB, doorsAt[0] + sl * 0.15, 0.25, fz + 9);
      // office annex with glass
      const ax = hallL / 2 + hx + 11;
      if (lv < 3) { B.box(M.curtain, 18, 12, D * 0.42, ax, 0, hz - hallD * 0.1); B.box(M.roofDark, 18.6, 0.6, D * 0.42 + 0.6, ax, 12, hz - hallD * 0.1); }
      for (let i = 0; i < 4 + lv; i++) B.box(M.steel, 4, 2.2, 3, hx - hallL * 0.35 + i * hallL * 0.16, H + hallD * 0.06, hz - hallD * 0.25);
      if (lv >= 2) { // tall high bay with its own door
        const tx = hx - hallL / 2 + 12;
        B.box(M.cladGrey, 24, H * 1.5, hallD * 0.86, tx, 0, hz);
        B.box(M.roofDark, 24.6, 0.6, hallD * 0.86 + 0.6, tx, H * 1.5, hz);
        B.box(M.door, 14, H * 1.32, 0.6, tx, 0, hz + hallD * 0.43 + 0.3);
      }
      if (lv >= 3) { B.box(M.curtain, 26, 15, 16, L / 2 - 16, 0, D / 2 - 12); B.box(M.roofDark, 26.6, 0.6, 16.6, L / 2 - 16, 15, D / 2 - 12); }
      for (let i = 0; i < 7; i++) X.parks.push([L / 2 - 6 - i * 3.2, D / 2 - 6, Math.PI / 2]);
    },
    pad(B, L, D, lv, M, X) {
      if (X.pk && window.APOGEE_PADKIT) return window.APOGEE_PADKIT.campusPad(B, L, D, lv, M, X); // Pad kit: pad type + custom tower
      B.box(M.conc, L - 2, 0.4, D - 2, 0, 0, 0);
      const mx = -4, mz = -2, mh = 8;
      // flame trench toward -x
      const tl = L / 2 + mx - 4;
      B.box(M.scorch, tl, 0.42, 10, mx - 8 - tl / 2 + 4, 0, mz);
      B.box(M.concDark, tl, 2.2, 1.4, mx - 8 - tl / 2 + 4, 0, mz - 5.7); B.box(M.concDark, tl, 2.2, 1.4, mx - 8 - tl / 2 + 4, 0, mz + 5.7);
      B.box(M.conc, 18, mh, 18, mx, 0, mz);
      B.box(M.scorch, 0.3, mh - 1.5, 10, mx - 9.05, 0, mz);
      B.cyl(M.steelDark, 5.5, 1.2, mx, mh, mz, 20);
      const rH = 40 + 15 * lv, r = 1.7 + 0.55 * lv;
      const rb = new Bld(); rocket(rb, M, rH, r, { fins: lv >= 2 }); B.sub(rb, mx, mh + 1.2, mz);
      // integration tower + crew arm
      const tx = mx + r + 8, th = rH + 12 + mh;
      B.lattice(M.steel, tx, mz, 7, th, 4, 0.4, 0.35);
      B.box(M.steelDark, 7.6, 2, 7.6, tx, th, mz);
      B.beam(M.steelDark, [tx - 3.5, mh + rH * 0.88, mz], [mx + r + 0.4, mh + rH * 0.88, mz], 1.6);
      B.box(M.white, 3, 2.4, 2.6, mx + r + 1.6, mh + rH * 0.88 - 1.2, mz);
      if (lv >= 2) B.beam(M.steelDark, [tx - 3.5, mh + rH * 0.55, mz], [mx + r + 0.4, mh + rH * 0.55, mz], 1.2);
      // lightning masts
      for (const [px, pz] of [[-34, -34], [34, -32], [-30, 34]]) { B.cyl(M.steel, 0.55, th + 22, px, 0, pz, 8, 0.25); B.cyl(M.conc, 1.6, 1, px, 0, pz, 10); X.lights.push([px, th + 22.5, pz]); }
      // propellant tanks
      B.sph(M.white, 4.2, 28, 6.8, -26, 18); B.cyl(M.steelDark, 3, 2.6, 28, 0, -26, 12);
      B.cylC(M.white, 2.6, 2.6, 16, 26, 4.6, -12, 0, 0, Math.PI / 2, 18);
      for (const sx of [20, 32]) B.box(M.conc, 1.2, 2.2, 5, sx, 0, -12);
      B.beam(M.pipe, [24, 1.2, -16], [mx + 9, 1.2, mz - 6], 0.9);
      if (lv >= 2) { // water tower for the deluge
        for (const [a, b] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) B.beam(M.steel, [30 + a, 0, 26 + b], [30 + a * 0.4, 24, 26 + b * 0.4], 0.5);
        B.sph(M.white, 5.5, 30, 28, 26, 18);
      }
      if (lv >= 3) B.box(M.cladGrey, 16, 9, 10, 26, 0, 6);
      for (const [px, pz] of [[34, 34], [-36, 0]]) { B.cyl(M.steel, 0.3, 16, px, 0, pz, 6); B.box(M.steelDark, 2.4, 1.2, 1, px, 16, pz); }
    },
    road(B, L, D, lv, M, X) { B.box(M.asph || M.concDark, L - 1, 0.25, D - 1, 0, 0, 0); },
    lz(B, L, D, lv, M, X) {
      B.box(M.concDark, L - 4, 0.2, D - 4, 0, 0, 0);
      B.add(M.lzMark, new T.CylinderGeometry(33, 33.5, 0.5, 64), 0, 0.25, 0);
      const n = 16 + lv * 4;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; B.box(M.lamp, 0.8, 0.5, 0.8, Math.cos(a) * 35.5, 0.2, Math.sin(a) * 35.5); }
      if (lv >= 2) for (let i = 0; i < 6; i++) { const a = -0.6 + i * 0.24; B.box(M.conc, 9, 3.5, 1, Math.cos(a) * 38.4 * 0.98, 0, Math.sin(a) * 38.4 * 0.98, -a + Math.PI / 2); }
      if (lv >= 3) { B.box(M.cladGrey, 12, 6, 8, -30, 0, -30); B.box(M.roofDark, 12.4, 0.4, 8.4, -30, 6, -30); }
      B.cyl(M.steel, 0.25, 9, 34, 0, -34, 6); B.box(M.orange, 0.3, 1.2, 2.4, 34, 7.6, -33);
    },
    tower(B, L, D, lv, M, X) {
      const H = 105 + 15 * (lv - 1);
      B.box(M.conc, 18, 3, 18, 0, 0, 0);
      B.lattice(M.steelDark, 0, 0, 10, H, 6, 3, 0.55);
      B.box(M.steel, 11, 3, 11, 0, H + 3, 0);
      X.lights.push([0, H + 6.4, 0]);
      const ay = H * 0.72, a = X.armDir || 0, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
      B.box(M.steel, 12, 7, 12, 0, ay - 3.5, 0);
      const len = 30 + lv * 2;
      for (const s of [-1, 1]) {
        const x0 = ca * 5 + px * s * 4.5, z0 = sa * 5 + pz * s * 4.5;
        const x1 = ca * (5 + len) + px * s * 6.5, z1 = sa * (5 + len) + pz * s * 6.5;
        B.beam(M.steel, [x0, ay, z0], [x1, ay, z1], 2.2);
        B.beam(M.steelDark, [x0, ay + 1.8, z0], [x1, ay + 0.6, z1], 0.6);
      }
      if (lv >= 2) B.beam(M.steelDark, [ca * 5, H * 0.9, sa * 5], [ca * 16, H * 0.9, sa * 16], 1.4);
    },
    tank(B, L, D, lv, M) {
      B.box(M.concDark, L - 4, 0.2, D - 4, 0, 0, 0);
      for (const [w, d, x, z] of [[L - 8, 0.8, 0, -D / 2 + 4], [L - 8, 0.8, 0, D / 2 - 4], [0.8, D - 8, -L / 2 + 4, 0], [0.8, D - 8, L / 2 - 4, 0]]) B.box(M.conc, w, 1.4, d, x, 0, z);
      const sph = [[-18, -16], [4, -16]].concat(lv >= 3 ? [[-18, 8]] : []);
      for (const [x, z] of sph) { B.cyl(M.steelDark, 5.5, 4.5, x, 0, z, 16); B.sph(M.white, 8.5, x, 11.5, z, 24); B.beam(M.steel, [x + 8, 0, z], [x + 8.3, 12, z], 0.5); }
      for (const z of [12, 20]) { B.cylC(M.white, 3.2, 3.2, 26, -6, 4.4, z, 0, 0, Math.PI / 2, 20); for (const sx of [-15, 3]) B.box(M.conc, 1.2, 1.6, 5, sx, 0, z); }
      if (lv >= 2) for (const z of [-20, -2]) { B.cyl(M.white, 4.6, 24, 24, 0, z, 20); B.sph(M.white, 4.6, 24, 24, z, 20, true); }
      if (lv >= 3) { B.cyl(M.white, 4.6, 24, 24, 0, 16, 20); B.sph(M.white, 4.6, 24, 24, 16, 20, true); }
      for (const z of [-4, 0]) B.beam(M.pipe, [-30, 1.6, z], [30, 1.6, z], 0.7);
      for (let x = -28; x <= 28; x += 8) B.box(M.steelDark, 0.4, 1.6, 6, x, 0, -2);
      B.box(M.cladGrey, 8, 4, 6, 30, 0, 28);
    },
    test(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.3, D - 2, 0, 0, 0);
      const sx = -10, sz = -8, bh = 14, H = 34 + 10 * lv;
      B.box(M.conc, 18, bh, 16, sx, 0, sz);
      B.box(M.black, 7, 6, 0.4, sx + 9.05, 1, sz);
      B.lattice(M.steel, sx, sz, 11, H - bh, 5, bh, 0.45);
      B.box(M.steelDark, 12, 2, 12, sx, H, sz);
      B.cyl(M.black, 2.6, 4.5, sx, bh + 0.5, sz, 18, 1);
      B.cyl(M.steel, 2.2, 10, sx, bh + 5, sz, 16);
      B.boxC(M.scorch, 12, 0.6, 10, sx + 14, 2.6, sz, 0, 0, -0.35);
      B.box(M.scorch, 26, 0.32, 14, sx + 30, 0, sz);
      for (const [x, z] of [[14, -24], [22, -24]]) { B.cyl(M.white, 3.6, 18, x, 0, z, 18); B.sph(M.white, 3.6, x, 18, z, 18, true); }
      B.beam(M.pipe, [14, 2, -20], [sx + 6, 2, sz + 4], 0.6);
      B.box(M.conc, 14, 4, 10, 24, 0, 26); barrelRoof(B, M.conc, 14, 10, 2.4, 24, 4, 26);
      B.box(M.glass, 4, 1, 0.3, 24, 2.4, 31.1);
      if (lv >= 2) { B.cyl(M.steel, 0.5, H + 12, sx + 10, 0, sz - 10, 8, 0.2); X.lights.push([sx + 10, H + 12.5, sz - 10]); }
      if (lv >= 3) { B.box(M.conc, 26, 8, 10, -16, 0, 24); B.box(M.black, 0.4, 5, 6, -2.8, 1, 24); B.box(M.scorch, 16, 0.32, 10, 6, 0, 24); }
      X.steam = [sx + 26, 6, sz];
    },
    office(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.2, D - 2, 0, 0, 0);
      B.box(M.parking, L - 6, 0.25, 22, 0, 0, D / 2 - 14);
      const fl = [4, 7, 11][lv - 1], H = 8 + fl * 4;
      B.box(M.stone, 54, 8, 34, -6, 0, -16);
      B.box(M.curtain, 54.2, 5, 34.2, -6, 0.5, -16);
      B.box(M.curtain, 34, fl * 4, 24, -6, 8, -18);
      for (let k = 1; k < fl; k++) B.box(M.stone, 34.6, 0.5, 24.6, -6, 8 + k * 4, -18);
      B.box(M.stone, 35, 0.8, 25, -6, H, -18);
      B.box(M.steel, 12, 3, 8, -10, H + 0.8, -20); B.box(M.steel, 5, 2, 5, 2, H + 0.8, -14);
      B.box(M.stone, 14, 0.6, 6, -6, 4, 2.5);
      if (lv >= 3) { B.cyl(M.steel, 0.25, 12, 2, H + 0.8, -22, 6); X.lights.push([2, H + 13, -22]); }
      for (let i = 0; i < 10; i++) X.parks.push([-L / 2 + 8 + i * 6.6, D / 2 - 20, Math.PI / 2]);
      for (let i = 0; i < 6; i++) X.parks.push([-L / 2 + 8 + i * 6.6 * 1.5, D / 2 - 8, -Math.PI / 2]);
      X.trees.push([L / 2 - 6, -D / 2 + 6], [L / 2 - 6, -D / 2 + 18], [L / 2 - 6, -8]);
    },
    housing(B, L, D, lv, M, X) {
      if (lv === 1) {
        for (const [x, z] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) {
          const m = (x + z) % 3 ? M.stucco : M.stucco2;
          B.box(m, 14, 5.5, 10, x, 0, z - 2);
          B.add(M.tile, prismG(15.2, 11.2, 3.6, 3), x, 5.5, z - 2);
          B.box(M.concDark, 4, 0.12, 9, x + 4.5, 0, z + 7.5);
          X.parks.push([x + 4.5, z + 8, 0]);
          X.trees.push([x - 6, z + 8]);
        }
      } else if (lv === 2) {
        for (const z of [-17, 13]) {
          B.box(z < 0 ? M.stucco : M.stucco2, 62, 7, 11, 0, 0, z);
          B.add(M.tile, prismG(63, 12.2, 3.8, 3), 0, 7, z);
          for (let i = 0; i < 6; i++) B.box(M.stone, 0.4, 7.6, 12, -31 + i * 62 / 6, 0, z);
          for (let i = 0; i < 6; i++) X.parks.push([-26 + i * 10.3, z + 10, 0]);
        }
      } else {
        for (const z of [-18, 14]) {
          B.box(z < 0 ? M.stucco : M.stucco2, 60, 16, 14, 0, 0, z);
          B.box(M.roofDark, 60.6, 0.6, 14.6, 0, 16, z);
          for (let k = 1; k < 5; k++) B.box(M.stone, 60, 0.3, 1.6, 0, k * 3.2, z + 7.6);
          B.box(M.steel, 6, 2, 4, -18, 16.6, z); B.box(M.steel, 6, 2, 4, 14, 16.6, z);
        }
        B.box(M.pool, 14, 0.3, 6, 0, 0, -2);
        for (let i = 0; i < 8; i++) X.parks.push([-28 + i * 8, 29, 0]);
      }
    },
    lab(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.2, D - 2, 0, 0, 0);
      B.box(M.panel, 50, 9, 28, -6, 0, -10);
      B.box(M.curtain, 50.2, 3, 28.2, -6, 3, -10);
      for (let i = 0; i < 6; i++) { B.add(M.roof, prismG(7.6, 28, 2.4, 4), -27 + i * 8.4, 9, -10, 0, 0, 0); }
      B.box(M.panel, 8, 4, 8, 12, 9, -16); B.sph(M.dishW, 5, 12, 13, -16, 20, true); B.box(M.black, 1.4, 4.8, 0.4, 12, 13.2, -11.2, -0.3);
      if (lv >= 2) { B.box(M.panel, 26, 14, 20, 18, 0, 16); B.box(M.curtain, 26.2, 2.5, 20.2, 18, 8, 16); B.box(M.roofDark, 26.6, 0.5, 20.6, 18, 14, 16); for (const x of [10, 14]) B.cyl(M.steel, 0.6, 6, x, 14, 22, 8); }
      if (lv >= 3) { B.cyl(M.panel, 10, 15, -22, 0, 22, 32); B.sph(M.dishW, 10, -22, 15, 22, 28, true); B.box(M.curtain, 14, 7, 12, -6, 0, 20); }
      for (let i = 0; i < 5; i++) X.parks.push([-L / 2 + 6 + i * 3.2, D / 2 - 6, Math.PI / 2]);
    },
    mc(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.2, D - 2, 0, 0, 0);
      B.box(M.curtain, 46, 5, 26, -10, 0, -12);
      B.box(M.panel, 47, 5, 27, -10, 5, -12);
      B.box(M.curtain, 47.2, 1.6, 27.2, -10, 7, -12);
      B.box(M.roofDark, 47.6, 0.6, 27.6, -10, 10, -12);
      if (lv >= 3) { B.box(M.curtain, 22, 8, 18, -14, 0, 18); B.box(M.roofDark, 22.6, 0.6, 18.6, -14, 8, 18); }
      B.lattice(M.steel, -26, -22, 2.6, 30, 3, 10.6, 0.22); X.lights.push([-26, 41, -22]);
      dish(B, M, 22, -20, 6, 6, 0.75, 0.8);
      dish(B, M, 28, 4, 3.5, 4, 1.0, -0.6);
      if (lv >= 2) dish(B, M, 18, 24, 9, 8, 0.6, 2.2);
      if (lv >= 3) dish(B, M, -30, 22, 12, 10, 0.9, 1.4);
      for (let i = 0; i < 6; i++) X.parks.push([-L / 2 + 6 + i * 3.2, D / 2 - 6, Math.PI / 2]);
    },
    satfab(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.25, D - 2, 0, 0, 0);
      const H = 14 + 4 * lv, hl = lv >= 3 ? L - 12 : L - 34, hx = lv >= 3 ? 0 : 6, hd = D * 0.55, hz = -D / 2 + 4 + hd / 2;
      B.box(M.panel, hl, H, hd, hx, 0, hz);
      B.box(M.blue, hl + 0.4, 2, hd + 0.4, hx, H * 0.6, hz);
      B.box(M.roofDark, hl + 0.6, 0.6, hd + 0.6, hx, H, hz);
      for (let i = 0; i < Math.round(hl / 12); i++) { B.box(M.steel, 6, 2.6, 4.4, hx - hl / 2 + 6 + i * 12, H + 0.6, hz - 6); B.cyl(M.steelDark, 1.4, 1.2, hx - hl / 2 + 6 + i * 12, H + 0.6, hz + 6, 12); }
      const bx = hx - hl / 2 - 12;
      if (lv < 3) { B.box(M.panel, 24, H + 8, hd * 0.9, bx, 0, hz); B.box(M.roofDark, 24.6, 0.6, hd * 0.9 + 0.6, bx, H + 8, hz); B.box(M.doorW, 14, 14, 0.5, bx, 0, hz + hd * 0.45 + 0.25); }
      B.box(M.steelDark, 22, 0.5, 6, hx + hl * 0.2, 5, hz + hd / 2 + 3); B.box(M.black, 20, 4.5, 0.3, hx + hl * 0.2, 0, hz + hd / 2 + 0.1);
      X.trucks.push([hx + hl * 0.2 - 6, hz + hd / 2 + 11, Math.PI / 2], [hx + hl * 0.2 + 6, hz + hd / 2 + 11, Math.PI / 2]);
      for (let i = 0; i < 8; i++) X.parks.push([-L / 2 + 6 + i * 3.2, D / 2 - 6, Math.PI / 2]);
    },
    fab(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.25, D - 2, 0, 0, 0);
      const H = 16 + 4 * lv, hl = L - 20, hd = D * 0.55, hz = -D / 2 + 4 + hd / 2;
      B.box(M.panel, hl, H, hd, 0, 0, hz);
      B.box(M.blue, hl + 0.4, 1.6, hd + 0.4, 0, H * 0.72, hz);
      B.box(M.roofDark, hl + 0.6, 0.6, hd + 0.6, 0, H, hz);
      for (let i = 0; i < Math.round(hl / 10); i++) B.box(M.steel, 5, 2.4, 5, -hl / 2 + 5 + i * 10, H + 0.6, hz);
      for (let i = 0; i < 1 + lv; i++) B.cyl(M.steel, 1.1, H + 14, hl / 2 - 4 - i * 5, 0, hz + hd / 2 - 3, 12);
      for (let i = 0; i < 2 + lv; i++) B.cyl(M.whiteRoof, 2.2, 7, -hl / 2 + 4 + i * 6, 0, hz + hd / 2 + 6, 16);
      X.trucks.push([hl / 2 - 6, hz + hd / 2 + 12, Math.PI / 2]);
      for (let i = 0; i < 8; i++) X.parks.push([-L / 2 + 6 + i * 3.2, D / 2 - 6, Math.PI / 2]);
    },
    ground(B, L, D, lv, M, X) {
      B.box(M.gravel, L - 4, 0.15, D - 4, 0, 0, 0);
      B.box(M.panel, 6, 3, 4, -12, 0, 12);
      dish(B, M, -4, -4, 5, 5, 0.7, 0.6);
      if (lv >= 2) radome(B, M, 9, -9, 5);
      if (lv >= 3) dish(B, M, 9, 9, 4, 4.5, 0.9, -0.8);
      for (const [x, z] of [[-17, -17], [17, -17], [17, 17], [-17, 17]]) B.cyl(M.galv, 0.12, 2.4, x, 0, z, 5);
      for (const [a, b] of [[[-17, -17], [17, -17]], [[17, -17], [17, 17]], [[17, 17], [-17, 17]], [[-17, 17], [-17, -17]]]) { B.beam(M.galv, [a[0], 2.3, a[1]], [b[0], 2.3, b[1]], 0.08); B.beam(M.fenceNet, [a[0], 1.2, a[1]], [b[0], 1.2, b[1]], 0.04); }
    },
    visitor(B, L, D, lv, M, X) {
      B.box(M.conc, L - 2, 0.2, D - 2, 0, 0, 0);
      B.box(M.curtain, 46, 8, 20, -8, 0, -2);
      barrelRoof(B, M.whiteRoof, 50, 24, 3.2, -8, 8, -2);
      const rh = 30 + 7 * lv;
      B.cyl(M.conc, 4, 2, 26, 0, 0, 16); const rb = new Bld(); rocket(rb, M, rh, 1.6, { fins: true }); B.sub(rb, 26, 2, 0);
      if (lv >= 2) { const s = new Bld(); stageOnCradle(s, M, 26, 1.8); B.sub(s, -12, 0.2, 14); }
      if (lv >= 3) { B.sph(M.dishW, 8, -38 + 8, 0, -6, 24, true); }
      X.trees.push([-36, 14], [36, -14]);
    },
    solar(B, L, D, lv, M, X, ghost) {
      B.box(M.gravel, L - 4, 0.12, D - 4, 0, 0, 0);
      const rows = [5, 7, 9][lv - 1], span = D - 10;
      for (let r = 0; r < rows; r++) {
        const z = -span / 2 + (r + 0.5) * span / rows;
        for (let x = -L / 2 + 10; x <= L / 2 - 10; x += 10.5) {
          if (ghost) B.boxC(M.solarP, 10, 0.15, 4, x, 2.2, z, -0.45, 0, 0);
          else X.panels.push([x, z]);
        }
      }
      B.box(M.panel, 4, 2.5, 3, L / 2 - 6, 0, -D / 2 + 5);
      if (lv >= 2) B.box(M.panel, 4, 2.5, 3, -L / 2 + 6, 0, D / 2 - 5);
    },
    port(B, L, D, lv, M, X) {
      B.box(M.conc, L - 1, 0.6, D - 1, 0, 0, 0);
      for (let x = -L / 2 + 4; x <= L / 2 - 4; x += 8) B.cyl(M.black, 0.5, 1.1, x, 0.6, D / 2 - 1.6, 8);
      B.box(M.clad, 28, 10, 14, -18, 0.6, -8); barrelRoof(B, M.roof, 28.6, 14.6, 2.2, -18, 10.6, -8);
      B.box(M.door, 10, 8, 0.4, -18, 0.6, -0.8);
      // gantry crane
      const gx = 14, gh = 16 + lv * 3;
      for (const [x, z] of [[gx - 8, -8], [gx + 8, -8], [gx - 8, 10], [gx + 8, 10]]) B.beam(M.yellow, [x, 0.6, z], [x, gh, z], 1.1);
      B.beam(M.yellow, [gx - 8, gh, -8], [gx - 8, gh, 10], 1.6); B.beam(M.yellow, [gx + 8, gh, -8], [gx + 8, gh, 10], 1.6);
      B.box(M.yellow, 18, 2, 3, gx, gh, 2); B.box(M.steelDark, 4, 2, 3.6, gx, gh - 2, 6);
      if (lv >= 3) B.box(M.cladGrey, 10, 6, 8, 30, 0.6, -10);
    },
  };
  function mConstruct(B, M, L, D, full, prog, type) {
    B.box(M.conc, L - 4, 0.35, D - 4, 0, 0, 0);
    const flat = ['lz', 'solar', 'port'].includes(type);
    const hh = flat ? 0 : Math.max(3, full * Math.min(0.85, prog) * (type === 'tower' || type === 'pad' ? 0.7 : 1));
    const ex = L / 2 - 8, ez = D / 2 - 8;
    if (!flat) {
      const nx = Math.max(1, Math.round(2 * ex / 10)), nz = Math.max(1, Math.round(2 * ez / 10));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        const edge = i === 0 || j === 0 || i === nx || j === nz;
        if (!edge && (i + j) % 2) continue;
        B.box(M.steelDark, 0.7, hh, 0.7, -ex + i * 2 * ex / nx, 0, -ez + j * 2 * ez / nz);
      }
      for (let y = 5; y <= hh; y += 5) {
        B.box(M.concDark, 2 * ex + 1, 0.35, 2 * ez + 1, 0, y - 0.35, 0);
        B.beam(M.steelDark, [-ex, y, ez], [ex, y, ez], 0.5); B.beam(M.steelDark, [ex, y, -ez], [ex, y, ez], 0.5);
      }
      scaffold(B, M, -ex, -ez, ex, ez, hh);
    } else {
      for (let i = 0; i < 4; i++) B.box(M.steel, 6, 0.6, 1.2, -ex + 6 + i * 8, 0.35, ez - 4);
    }
    B.box(M.orange, 6, 2.6, 2.4, ex - 2, 0, ez + 5);
    for (let i = 0; i < 3; i++) B.box(M.wood, 4, 0.8, 1.2, -ex + 3, 0.35 + i * 0.8, ez + 4);
    B.box(M.steel, 7, 0.6, 2, -ex + 10, 0.35, ez + 5);
  }

  // ---------- materials (per mount; textures come from cached canvases) ----------
  const HAZE_GLSL = `
uniform sampler2D uSkyTex; uniform float uHz;
vec3 skyAt(vec3 d){ float az = atan(d.z, d.x) / 6.2831853 + 0.5; float el = sqrt(clamp(d.y, 0.0, 1.0)); return texture2D(uSkyTex, vec2(az, el * 0.96875 + 0.015625)).rgb; }
float hazeAmt(vec3 rel){ return 1.0 - exp(-length(rel) * uHz); }
vec3 hazeCol(vec3 rel){ vec2 h = rel.xz + vec2(1e-4, 0.0); return skyAt(normalize(vec3(h.x, length(h) * 0.035, h.y))); }
`;
  const HAZE_FRAG = `{
  vec3 hzRel = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  float hzF = hazeAmt(hzRel); vec3 hzC = hazeCol(hzRel);
  #ifdef TONE_MAPPING
  hzC = toneMapping(hzC);
  #endif
  hzC = linearToOutputTexel(vec4(hzC, 1.0)).rgb;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hzC, hzF);
}`;
  const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }
`;

  function makeMats(HU, small, texs) {
    const tx = (key, w, h, uvRep, srgb) => {
      const t = new T.CanvasTexture(cnv(key, w, h, PAINT[key]));
      if (srgb !== false) t.colorSpace = T.SRGBColorSpace;
      if (uvRep) t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = small ? 2 : 8;
      texs.push(t);
      return t;
    };
    const hz = (mat, key, extra) => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, HU);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + HAZE_GLSL).replace('#include <fog_fragment>', HAZE_FRAG);
        if (extra) extra(sh);
      };
      mat.customProgramCacheKey = () => 'cv3-' + key;
      return mat;
    };
    const S = (o, uv, key) => { if (o.envMapIntensity == null) o.envMapIntensity = o.metalness > 0.6 ? 0.9 : 0.5; const m = hz(new T.MeshStandardMaterial(o), key || 'std'); m.userData.uv = uv || 0; return m; };
    const M = {
      conc: S({ map: tx('conc', 256, 256, 1), roughness: 0.92 }, 8),
      concDark: S({ map: tx('conc', 256, 256, 1), color: 0x8f8b84, roughness: 0.95 }, 8),
      gravel: S({ map: tx('conc', 256, 256, 1), color: 0xb5ab98, roughness: 1 }, 5),
      asph: S({ map: tx('asph', 256, 256, 1), roughness: 0.95 }, 10),
      road: S({ map: tx('road', 256, 128, 1), roughness: 0.9 }, 0),
      parking: S({ map: tx('parking', 256, 256, 1), roughness: 0.9 }, 20),
      scorch: S({ color: 0x302d2a, roughness: 1 }),
      clad: S({ map: tx('clad', 128, 128, 1), color: 0xf0efea, roughness: 0.5, metalness: 0.25 }, 4),
      cladGrey: S({ map: tx('clad', 128, 128, 1), color: 0xa4a9ae, roughness: 0.5, metalness: 0.3 }, 4),
      door: S({ map: tx('door', 128, 128, 1), roughness: 0.5, metalness: 0.45 }, 12),
      doorW: S({ map: tx('door', 128, 128, 1), color: 0xf2f2f0, roughness: 0.45, metalness: 0.2 }, 12),
      roof: S({ map: tx('clad', 128, 128, 1), color: 0xa9adb0, roughness: 0.4, metalness: 0.7 }, 3),
      roofDark: S({ map: tx('roofM', 128, 128, 1), roughness: 0.9 }, 10),
      whiteRoof: S({ color: 0xf1f0ec, roughness: 0.45, metalness: 0.2, side: T.DoubleSide }),
      panel: S({ map: tx('panel', 128, 128, 1), roughness: 0.45, metalness: 0.1 }, 6),
      stone: S({ color: 0xd9d4c8, roughness: 0.7 }),
      curtain: S({ map: tx('curtain', 256, 256, 1), emissiveMap: tx('curtainEm', 256, 256, 1), emissive: 0xffc890, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.8 }, 16),
      glass: S({ color: 0x24384c, roughness: 0.08, metalness: 0.9 }),
      facadeA: S({ map: tx('facadeA', 256, 256, 1), emissiveMap: tx('facadeAEm', 256, 256, 1), emissive: 0xffc890, emissiveIntensity: 0.7, roughness: 0.6, metalness: 0.15 }, 21),
      facadeB: S({ map: tx('facadeB', 256, 256, 1), emissiveMap: tx('facadeBEm', 256, 256, 1), emissive: 0xffc890, emissiveIntensity: 0.7, roughness: 0.65, metalness: 0.1 }, 18),
      stucco: S({ map: tx('stucco', 256, 256, 1), roughness: 0.85 }, 12),
      stucco2: S({ map: tx('stucco', 256, 256, 1), color: 0xe9cfb0, roughness: 0.85 }, 12),
      tile: S({ map: tx('tile', 128, 128, 1), roughness: 0.8 }, 3),
      pool: S({ color: 0x2f8fb0, roughness: 0.05, metalness: 0.3 }),
      steel: S({ color: 0x8e9398, roughness: 0.45, metalness: 0.75 }),
      steelDark: S({ color: 0x484c52, roughness: 0.55, metalness: 0.6 }),
      galv: S({ color: 0xaeb2b5, roughness: 0.5, metalness: 0.6 }),
      pipe: S({ color: 0xb9bcc0, roughness: 0.3, metalness: 0.85 }),
      yellow: S({ color: 0xe0a72a, roughness: 0.55, metalness: 0.25 }),
      orange: S({ color: 0xcf6a2c, roughness: 0.6, metalness: 0.2 }),
      white: S({ color: 0xf0efeb, roughness: 0.32, metalness: 0.1 }),
      black: S({ color: 0x1c1d1f, roughness: 0.55, metalness: 0.3 }),
      dishW: S({ color: 0xe9eae6, roughness: 0.5, metalness: 0.1, side: T.DoubleSide }),
      blue: S({ color: 0x2c5a9e, roughness: 0.45, metalness: 0.3 }),
      wood: S({ color: 0x8c6c4a, roughness: 0.9 }),
      fenceNet: S({ color: 0x9da2a6, roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.5 }),
      interior: S({ color: 0x1a1410, emissive: 0xffb469, emissiveIntensity: 0.35, roughness: 1 }),
      lamp: S({ color: 0x222222, emissive: 0xffd27a, emissiveIntensity: 1.6 }),
      redLight: S({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 3 }),
      lzMark: S({ map: tx('lz', 512, 512, 0), roughness: 0.85 }),
      deck: S({ map: tx('deck', 256, 256, 0), roughness: 0.8, metalness: 0.4 }),
      hull: S({ color: 0x2d3137, roughness: 0.7, metalness: 0.5 }),
      solarP: S({ map: tx('solar', 256, 128, 0), roughness: 0.18, metalness: 0.55 }),
      leaf: S({ color: 0xffffff, roughness: 0.95 }, 0, 'leaf'),
      trunk: S({ color: 0x5a4632, roughness: 1 }),
      rock: S({ color: 0xffffff, roughness: 0.95 }, 0, 'rock'),
      car: S({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.55 }, 0, 'car'),
      sign: S({ map: tx('sign', 128, 96, 0), roughness: 0.7 }),
      fence: S({ color: 0xc9c4b6, roughness: 0.6, metalness: 0.3 }),
    };
    for (const k of ['lamp', 'redLight', 'fenceNet', 'interior']) M[k].userData.noShadow = true;
    M._hz = hz;
    return M;
  }

  // ---------- per-site landscape data (cached) ----------
  function siteData(site) {
    if (CACHE.sites[site.id]) return CACHE.sites[site.id];
    for (const k of Object.keys(CACHE.sites)) if (k !== site.id && k.split('~')[0] === (site.base || site.id)) delete CACHE.sites[k];
    const w = site.w, h = site.h, P = PADT, GW = w + 2 * P, GH = h + 2 * P;
    const cnt = {};
    for (const row of site.map) for (const ch of row) cnt[ch] = (cnt[ch] || 0) + 1;
    let fill = 'c', best = 0;
    for (const k of ['c', 'g', 'd']) if ((cnt[k] || 0) > best) { best = cnt[k]; fill = k; }
    if (!best) fill = cnt.t ? 'g' : 'c';
    const coastal = !!cnt.S;
    function ext(x, y) {
      const ox = x < 0 || x >= w, oy = y < 0 || y >= h;
      const cx = clamp(x, 0, w - 1), cy = clamp(y, 0, h - 1);
      if (!ox && !oy) return site.map[cy][cx];
      // Beyond the edge, only public roads carry on (player roads stay inside the site).
      const M0 = site.map0 || site.map, ch = M0[cy][cx];
      if (ch === 'R') {
        if (ox && oy) return fill;
        if (ox) return M0[cy][cx === 0 ? Math.min(1, w - 1) : Math.max(0, w - 2)] === 'R' ? 'R' : fill;
        return M0[cy === 0 ? Math.min(1, h - 1) : Math.max(0, h - 2)][cx] === 'R' ? 'R' : fill;
      }
      if (ch === 'C') return Math.max(-x - 1, x - w, -y - 1, y - h) > 4 ? 'N' : 'C';
      if (ch === 'S' || ch === 'L' || ch === 'B') return ch;
      // natural landscape beyond the site: the site's main ground cover with patches of woods
      return 'N';
    }
    const natAt = (tx, ty) => { // natural ground beyond the site, continuous so patches have soft organic edges
      const n = fbz(tx * 0.16 + 3.1, ty * 0.16 - 1.7, 41, 4);
      if (cnt.t && n > 0.6) return 't';
      if (fill !== 'd' && cnt.g && n < 0.34) return 'g';
      return fill;
    };
    const E = [];
    for (let j = 0; j < GH; j++) { const row = []; for (let i = 0; i < GW; i++) row.push(ext(i - P, j - P)); E.push(row); }
    const typ = (x, y) => E[clamp(y + P, 0, GH - 1)][clamp(x + P, 0, GW - 1)];
    const isW = (c) => c === 'S' || c === 'L';
    // water mask + signed distance (metres, + into water)
    const MW = GW * RS, MH = GH * RS, N = MW * MH;
    const mask = new Uint8Array(N), foam = new Float32Array(N);
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const tx = (i + 0.5) / RS - P, ty = (j + 0.5) / RS - P, k = j * MW + i;
      const c = typ(Math.floor(tx), Math.floor(ty));
      let wv = 0;
      if (isW(c)) {
        const wx = tx + (fbz(tx * 0.5, ty * 0.5, 3, 3) - 0.5) * 0.85, wy = ty + (fbz(tx * 0.5 + 7.3, ty * 0.5, 5, 3) - 0.5) * 0.85;
        const c2 = typ(Math.floor(wx), Math.floor(wy));
        if (isW(c2)) wv = c === 'S' && c2 === 'S' ? 1 : 0.25;
      } else if (c === 'w') {
        const fx = tx - Math.floor(tx), fy = ty - Math.floor(ty), e = Math.min(fx, 1 - fx, fy, 1 - fy);
        const n = fbz(tx * 1.6, ty * 1.6, 11, 3);
        if (n - Math.max(0, 0.16 - e) * 2.5 > 0.55) wv = 0.02;
      }
      mask[k] = wv > 0 ? 1 : 0; foam[k] = wv;
    }
    { // round off the tile staircase: box-blur the water mask (and foam) and threshold again
      const R = 3, blur = (src) => {
        const tmp = new Float32Array(N), out = new Float32Array(N), pre = new Float32Array(Math.max(MW, MH) + 1);
        for (let j = 0; j < MH; j++) { for (let i = 0; i < MW; i++) pre[i + 1] = pre[i] + src[j * MW + i]; for (let i = 0; i < MW; i++) { const a = Math.max(0, i - R), b = Math.min(MW, i + R + 1); tmp[j * MW + i] = (pre[b] - pre[a]) / (b - a); } }
        for (let i = 0; i < MW; i++) { for (let j = 0; j < MH; j++) pre[j + 1] = pre[j] + tmp[j * MW + i]; for (let j = 0; j < MH; j++) { const a = Math.max(0, j - R), b = Math.min(MH, j + R + 1); out[j * MW + i] = (pre[b] - pre[a]) / (b - a); } }
        return out;
      };
      const bm = blur(mask), bf = blur(foam);
      for (let k = 0; k < N; k++) { const m = bm[k] > 0.5 ? 1 : 0; if (m && !mask[k]) foam[k] = bf[k] / Math.max(1e-3, bm[k]); if (!m) foam[k] = 0; mask[k] = m; }
    }
    const dt = (target) => {
      const d = new Float32Array(N);
      for (let k = 0; k < N; k++) d[k] = mask[k] === target ? 0 : 1e9;
      const D2 = 1.4142;
      for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
        const k = j * MW + i; let v = d[k]; if (!v) continue;
        if (i > 0) v = Math.min(v, d[k - 1] + 1);
        if (j > 0) { v = Math.min(v, d[k - MW] + 1); if (i > 0) v = Math.min(v, d[k - MW - 1] + D2); if (i < MW - 1) v = Math.min(v, d[k - MW + 1] + D2); }
        d[k] = v;
      }
      for (let j = MH - 1; j >= 0; j--) for (let i = MW - 1; i >= 0; i--) {
        const k = j * MW + i; let v = d[k]; if (!v) continue;
        if (i < MW - 1) v = Math.min(v, d[k + 1] + 1);
        if (j < MH - 1) { v = Math.min(v, d[k + MW] + 1); if (i < MW - 1) v = Math.min(v, d[k + MW + 1] + D2); if (i > 0) v = Math.min(v, d[k + MW - 1] + D2); }
        d[k] = v;
      }
      return d;
    };
    const toLand = dt(0), toWater = dt(1), mpp = TS / RS;
    const sd = new Float32Array(N);
    for (let k = 0; k < N; k++) sd[k] = mask[k] ? (toLand[k] - 0.5) * mpp : -(toWater[k] - 0.5) * mpp;
    const sdf = new Uint8Array(N * 4);
    let hasWater = false;
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const k = j * MW + i;
      let f = 0;
      for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) { const ii = clamp(i + a, 0, MW - 1), jj = clamp(j + b, 0, MH - 1); f = Math.max(f, foam[jj * MW + ii]); }
      sdf[k * 4] = Math.round(clamp((sd[k] + 64) / 192, 0, 1) * 255);
      sdf[k * 4 + 1] = Math.round(f * 255); sdf[k * 4 + 2] = 0; sdf[k * 4 + 3] = 255;
      if (mask[k]) hasWater = true;
    }
    const sdAt = (tx, ty) => { // bilinear, so shore colours follow the smooth water edge
      const fx = clamp((tx + P) * RS - 0.5, 0, MW - 1.001), fy = clamp((ty + P) * RS - 0.5, 0, MH - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * MW + i;
      return (sd[k] * (1 - u) + sd[k + 1] * u) * (1 - v) + (sd[k + MW] * (1 - u) + sd[k + MW + 1] * u) * v;
    };
    const foamAt = (tx, ty) => { const i = clamp(Math.floor((tx + P) * RS), 0, MW - 1), j = clamp(Math.floor((ty + P) * RS), 0, MH - 1); return sdf[(j * MW + i) * 4 + 1] / 255; };
    // road arms per tile
    const isR = (x, y) => typ(x, y) === 'R';
    // albedo canvas
    const AW = GW * RA, AH = GH * RA;
    const can = document.createElement('canvas'); can.width = AW; can.height = AH;
    const g2 = can.getContext('2d'), img = g2.createImageData(AW, AH), px = img.data;
    let fillPal = null;
    const PAL = {
      c: (n1, n2, n3) => { let c = mixc([116, 110, 70], [150, 134, 94], sstep(0.35, 0.7, n1)); c = mixc(c, [86, 98, 54], sstep(0.55, 0.75, n2) * 0.7); if (n3 > 0.78) c = mixc(c, [62, 70, 42], 0.6); return c; },
      g: (n1, n2) => mixc(mixc([84, 112, 50], [112, 134, 62], sstep(0.3, 0.75, n1)), [70, 94, 44], sstep(0.55, 0.8, n2) * 0.6),
      t: (n1, n2) => mixc([78, 88, 50], [98, 88, 60], sstep(0.4, 0.8, n2) * 0.7),
      d: (n1, n2, n3, tx, ty) => { let c = mixc([200, 158, 110], [220, 184, 134], sstep(0.3, 0.75, n1)); c = mixc(c, [168, 132, 96], sstep(0.62, 0.8, n2) * 0.7); const rp = 0.97 + 0.03 * Math.sin((tx * 0.8 + ty * 0.35) * 38 + n2 * 9); return c.map((v) => v * rp); },
      r: (n1, n2, n3, tx, ty) => mixc(fillPal(n1, n2, n3, tx, ty), [128, 110, 92], 0.35 + 0.3 * sstep(0.4, 0.7, n2)).map((v) => v * (n3 > 0.8 ? 0.85 : 1)),
      w: (n1, n2, n3) => { let c = mixc([66, 86, 50], [96, 102, 62], sstep(0.35, 0.7, n2)); if (n3 > 0.75) c = mixc(c, [92, 82, 60], 0.5); return c; },
      B: (n1, n2) => mixc([228, 210, 168], [206, 188, 146], sstep(0.35, 0.75, n2)),
      C: () => [146, 143, 136],
    };
    fillPal = PAL[fill];
    for (let j = 0; j < AH; j++) for (let i = 0; i < AW; i++) {
      const tx = (i + 0.5) / RA - P, ty = (j + 0.5) / RA - P, xi = Math.floor(tx), yi = Math.floor(ty);
      const n1 = fbz(tx * 0.35, ty * 0.35, 1, 3), n2 = fbz(tx * 2.1, ty * 2.1, 2, 2), n3 = vnz(tx * 11, ty * 11, 3), n4 = vnz(tx * 31, ty * 31, 4);
      const cu = typ(xi, yi);
      let c = cu;
      if (cu !== 'R' && cu !== 'C') {
        const wx = tx + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.25, wy = ty + (fbz(tx * 0.35 + 9, ty * 0.35, 6, 3) - 0.5) * 0.5;
        c = typ(Math.floor(wx), Math.floor(wy));
        if (c === 'R' || c === 'C') c = cu;
      }
      if (c === 'N') c = natAt(tx, ty);
      if (c === 'S') c = 'B'; else if (c === 'L') c = 'g';
      let col;
      if (c === 'R') {
        const fx = tx - xi, fy = ty - yi;
        let dmin = Math.hypot(fx - 0.5, fy - 0.5);
        if (isR(xi - 1, yi)) dmin = Math.min(dmin, fx < 0.5 ? Math.abs(fy - 0.5) : dmin);
        if (isR(xi + 1, yi)) dmin = Math.min(dmin, fx > 0.5 ? Math.abs(fy - 0.5) : dmin);
        if (isR(xi, yi - 1)) dmin = Math.min(dmin, fy < 0.5 ? Math.abs(fx - 0.5) : dmin);
        if (isR(xi, yi + 1)) dmin = Math.min(dmin, fy > 0.5 ? Math.abs(fx - 0.5) : dmin);
        col = fillPal(n1, n2, n3, tx, ty);
        col = mixc(col, mixc(col, [138, 130, 112], 0.75), 1 - sstep(0.17, 0.215, dmin + (n4 - 0.5) * 0.02));
      } else if (c === 'C') {
        const fx = tx - xi, fy = ty - yi;
        col = PAL.C();
        if (Math.abs(fx - 0.5) < 0.04 || Math.abs(fy - 0.5) < 0.04) col = [110, 108, 104];
        if (fx < 0.08 || fx > 0.92 || fy < 0.08 || fy > 0.92) col = [86, 86, 86];
      } else col = (PAL[c] || fillPal)(n1, n2, n3, tx, ty);
      // shores
      const s = sdAt(tx, ty);
      if (s > -16) {
        const fk = foamAt(tx, ty);
        if (fk > 0.5) { col = mixc(col, [222, 204, 160], 1 - sstep(-16, -6, s)); col = mixc(col, [150, 132, 100], 1 - sstep(-6, -1, s)); }
        else if (fk > 0.005) col = mixc(col, [96, 86, 64], 1 - sstep(-6, -1, s));
        else col = mixc(col, [78, 74, 52], 1 - sstep(-4, -0.5, s));
      }
      const v = 0.9 + 0.12 * n3 + 0.08 * (n4 - 0.5);
      const k = (j * AW + i) * 4;
      px[k] = clamp(col[0] * v, 0, 255); px[k + 1] = clamp(col[1] * v, 0, 255); px[k + 2] = clamp(col[2] * v, 0, 255); px[k + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    // roads (strips with lane paint) + junction squares
    const roads = { strips: [], squares: [] };
    const rk = (x, y) => { if (!isR(x, y)) return 0; const hz = isR(x - 1, y) || isR(x + 1, y), vt = isR(x, y - 1) || isR(x, y + 1); return hz && !vt ? 1 : vt && !hz ? 2 : 3; };
    for (let y = -P; y < h + P; y++) for (let x = -P; x < w + P; x++) {
      const k = rk(x, y);
      if (k === 3) roads.squares.push([x, y, isR(x - 1, y), isR(x + 1, y), isR(x, y - 1), isR(x, y + 1)]);
      else if (k === 1 && (x === -P || rk(x - 1, y) !== 1)) { let x2 = x; while (x2 + 1 < w + P && rk(x2 + 1, y) === 1) x2++; roads.strips.push([x, y, x2, y, 0]); }
      else if (k === 2 && (y === -P || rk(x, y - 1) !== 2)) { let y2 = y; while (y2 + 1 < h + P && rk(x, y2 + 1) === 2) y2++; roads.strips.push([x, y, x, y2, 1]); }
    }
    // vegetation, rocks, city lots
    const r = rng(site.id.length * 7919 + w * 31 + h);
    const veg = [], rocks = [], city = [];
    for (let y = -VEGPAD; y < h + VEGPAD; y++) for (let x = -VEGPAD; x < w + VEGPAD; x++) {
      const c0 = typ(x, y), inside = x >= 0 && y >= 0 && x < w && y < h;
      const c = c0 === 'N' ? natAt(x + 0.5, y + 0.5) : c0;
      const add = (kind, n, smin, smax) => {
        for (let i = 0; i < n; i++) {
          if (n < 1 && r() > n) continue;
          const tx = x + 0.06 + r() * 0.88, ty = y + 0.06 + r() * 0.88;
          if (sdAt(tx, ty) > -5) continue;
          if (c0 === 'N' && natAt(tx, ty) !== c) continue;
          veg.push({ x: tx, y: ty, k: kind, s: smin + r() * (smax - smin), c: r() });
        }
      };
      if (c === 't') { add('tree', 7, 0.8, 1.3); add('pine', 3, 0.8, 1.2); add('bush', 3, 0.6, 1.2); }
      else if (c === 'g') { add('tree', 0.5, 0.8, 1.3); add('bush', 2, 0.5, 1); }
      else if (c === 'c') { add('bush', 5, 0.5, 1.1); if (coastal) add('palm', 0.45, 0.8, 1.2); else add('pine', 0.35, 0.8, 1.1); }
      else if (c === 'B') { if (inside ? r() < 0.3 : r() < 0.25) add('palm', 1, 0.8, 1.2); }
      else if (c === 'd') add('shrub', 1.6, 0.4, 0.9);
      else if (c === 'w') { add('bush', 4, 0.5, 1); add('reed', 6, 0.6, 1); add('tree', 0.3, 0.8, 1.1); }
      else if (c === 'L' || c === 'S') { /* water */ }
      if (c === 'r' && inside) {
        const big = fill === 'd';
        const n = big ? 3 : 5;
        for (let i = 0; i < n; i++) rocks.push({ x: x + 0.2 + r() * 0.6, y: y + 0.2 + r() * 0.6, sx: (big ? 7 : 3) + r() * (big ? 9 : 5), sy: (big ? 6 : 2) + r() * (big ? 12 : 4), sz: (big ? 7 : 3) + r() * (big ? 8 : 4), ry: r() * 6.3, c: r() });
      }
      if (!inside && fill === 'd' && c === 'd' && r() < 0.03) rocks.push({ x: x + 0.5, y: y + 0.5, sx: 16 + r() * 20, sy: 14 + r() * 22, sz: 16 + r() * 18, ry: r() * 6.3, c: r() });
      if (c === 'C') {
        const far = Math.max(0, -x - 1, x - w, -y - 1, y - h), tall = Math.max(0.25, 1 - far * 0.12);
        if (r() < 0.3) city.push({ x: x + 0.5, y: y + 0.5, w: 0.62 + r() * 0.12, d: 0.62 + r() * 0.12, h: 10 + Math.pow(r(), 2.2) * 85 * tall, v: r() < 0.5 ? 0 : 1 });
        else for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          if (r() < 0.12) continue;
          const hgt = 8 + Math.pow(r(), 2.4) * 55 * tall;
          city.push({ x: x + 0.29 + ox * 0.42, y: y + 0.29 + oy * 0.42, w: 0.28 + r() * 0.1, d: 0.28 + r() * 0.1, h: hgt, v: r() < 0.5 ? 0 : 1 });
        }
      }
    }
    const cars = [];
    for (const [x0, y0, x1, y1, dir] of roads.strips) {
      const len = dir ? y1 - y0 + 1 : x1 - x0 + 1;
      for (let i = 0; i < len; i++) if (r() < 0.22) {
        const t = i + r(), lane = r() < 0.5 ? -1 : 1;
        cars.push(dir ? [x0 + 0.5 + lane * 0.065, y0 + t, lane > 0 ? 0 : Math.PI] : [x0 + t, y0 + 0.5 + lane * 0.065, lane > 0 ? -Math.PI / 2 : Math.PI / 2]);
      }
    }
    const D = { w, h, P, GW, GH, MW, MH, sdf, can, hasWater, coastal, fill, roads, veg, rocks, city, cars, typ };
    CACHE.sites[site.id] = D;
    return D;
  }

  // ---------- instanced geometry ----------
  function jitterGeo(g, amt, seed, flatTop) {
    const p = g.attributes.position, r = rng(seed);
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
      if (!seen.has(key)) seen.set(key, 1 + (r() - 0.5) * amt);
      const f = seen.get(key);
      let y = p.getY(i) * f; if (flatTop && y > flatTop) y = flatTop + (y - flatTop) * 0.15;
      p.setXYZ(i, p.getX(i) * f, y, p.getZ(i) * f);
    }
    g.computeVertexNormals();
    return g;
  }
  function protoGeos() {
    const trunk = new T.CylinderGeometry(0.22, 0.4, 1, 6); trunk.translate(0, 0.5, 0);
    const crown = jitterGeo(new T.IcosahedronGeometry(1, 1), 0.35, 7); crown.translate(0, 0.6, 0);
    const pine = new T.ConeGeometry(1, 1, 7); pine.translate(0, 0.5, 0);
    const bush = jitterGeo(new T.IcosahedronGeometry(1, 0), 0.4, 3); bush.scale(1, 0.6, 1); bush.translate(0, 0.3, 0);
    const reed = new T.ConeGeometry(0.5, 1, 4); reed.translate(0, 0.5, 0);
    const fr = [];
    for (let i = 0; i < 8; i++) { const f = new T.BoxGeometry(3.6, 0.06, 0.7); f.translate(1.8, 0, 0); f.rotateZ(-0.38 - (i % 2) * 0.18); f.rotateY(i * Math.PI / 4 + 0.2); fr.push(f); }
    const palm = mergeG(fr);
    const rock = jitterGeo(new T.IcosahedronGeometry(1, 2), 0.5, 11, 0.55); rock.translate(0, -0.15, 0);
    // car: body + dark cabin + dark skirt
    const body = new T.BoxGeometry(4.4, 0.9, 1.8); body.translate(0, 0.85, 0);
    const cab = new T.BoxGeometry(2.4, 0.75, 1.64); cab.translate(-0.25, 1.67, 0);
    const skirt = new T.BoxGeometry(4.1, 0.5, 1.7); skirt.translate(0, 0.32, 0);
    const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new T.BufferAttribute(a, 3)); return g; };
    const car = mergeG([tint(body, [1, 1, 1]), tint(cab, [0.08, 0.1, 0.12]), tint(skirt, [0.06, 0.06, 0.06])], true);
    const tb = new T.BoxGeometry(12, 3.6, 2.5); tb.translate(-1.5, 2.4, 0);
    const tc = new T.BoxGeometry(2.6, 2.8, 2.4); tc.translate(5.8, 1.9, 0);
    const ts2 = new T.BoxGeometry(14, 0.7, 2.3); ts2.translate(0, 0.45, 0);
    const truck = mergeG([tint(tb, [1, 1, 1]), tint(tc, [0.55, 0.6, 0.66]), tint(ts2, [0.06, 0.06, 0.06])], true);
    const post = new T.BoxGeometry(0.35, 2.2, 0.35); post.translate(0, 1.1, 0);
    const rail = new T.BoxGeometry(1, 0.16, 0.16);
    const spost = new T.BoxGeometry(0.6, 8, 0.6); spost.translate(0, 4, 0);
    const board = new T.BoxGeometry(10, 7.5, 0.3); board.translate(0, 10.5, 0);
    const panel = new T.BoxGeometry(10, 0.15, 4); panel.rotateX(0.45); panel.translate(0, 2.2, 0);
    const pleg = new T.BoxGeometry(9, 1.8, 0.2); pleg.translate(0, 0.9, 0);
    return { trunk, crown, pine, bush, reed, palm, rock, car, truck, post, rail, spost, board, panel, pleg };
  }

  // ---------- ocean shader ----------
  const OCEAN_VERT = `varying vec3 vWP;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const OCEAN_FRAG = `precision highp float;
uniform float uTime; uniform sampler2D uWaveTex; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb;
uniform sampler2D uSdf; uniform vec4 uGeo;
varying vec3 vWP;
${HAZE_GLSL}
${NOISE_GLSL}
void main(){
  vec3 rel = vWP - cameraPosition; float L = length(rel); vec3 V = -rel / L;
  vec2 p = vWP.xz;
  vec2 tc = p / uGeo.x + uGeo.yz * 0.5; vec2 suv = (tc + uGeo.w) / (uGeo.yz + 2.0 * uGeo.w);
  vec4 sv = texture2D(uSdf, suv); float sd = sv.r * 192.0 - 64.0; float fk = sv.g;
  if (sd < -3.0) discard;
  vec2 q1 = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
  vec4 w1 = texture2D(uWaveTex, p / 173.0 + uTime * vec2(0.0042, 0.0019));
  vec4 w2 = texture2D(uWaveTex, q1 / 61.0 + uTime * vec2(-0.0061, 0.0093));
  vec4 w3 = texture2D(uWaveTex, p.yx / 19.3 + uTime * vec2(0.021, -0.017));
  float a3 = 1.0 - smoothstep(300.0, 1600.0, L);
  vec2 s2 = w2.rg * 2.0 - 1.0; s2 = vec2(s2.x * 0.8 + s2.y * 0.6, -s2.x * 0.6 + s2.y * 0.8);
  vec2 gr = (w1.rg * 2.0 - 1.0) * 0.11 + s2 * 0.085 + (w3.gr * 2.0 - 1.0) * 0.06 * a3;
  float crest = w1.b * 0.55 + w2.b * 0.45;
  float patchv = vnoise(p * 0.0021 + vec2(uTime * 0.004, 0.0)) * 0.7 + vnoise(p * 0.0007 + 5.0) * 0.6;
  float calm = mix(0.45, 1.0, smoothstep(0.05, 0.6, fk));
  gr *= (0.55 + patchv * 0.9) * calm;
  vec3 N = normalize(vec3(-gr.x, 1.0, -gr.y));
  float NdV = max(dot(N, V), 0.0);
  vec3 Rf = reflect(-V, N); Rf.y = abs(Rf.y);
  vec3 sky = skyAt(Rf);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  float amb = dot(uAmb, vec3(0.3, 0.5, 0.2));
  vec3 deep = vec3(0.006, 0.032, 0.058) * amb * 2.2;
  float shallow = 1.0 - smoothstep(0.0, 55.0, sd);
  vec3 body = mix(deep, vec3(0.05, 0.17, 0.15) * amb * 2.4, shallow * 0.9);
  body = mix(body, vec3(0.03, 0.055, 0.04) * amb * 2.2, (1.0 - smoothstep(0.02, 0.4, fk)) * 0.85);
  vec3 sunL = normalize(uSunDir);
  body += uSunCol * 0.007 * crest * max(dot(N, sunL) * 0.5 + 0.5, 0.0) * smoothstep(0.1, 0.6, fk);
  vec3 col = mix(body, sky * mix(0.85, 0.6, smoothstep(2000.0, 12000.0, L)), F);
  float rough = mix(1600.0, 500.0, smoothstep(100.0, 9000.0, L));
  col += uSunCol * pow(max(dot(Rf, sunL), 0.0), rough) * rough * 0.06;
  float fb = (1.0 - smoothstep(0.0, 18.0, sd)) * smoothstep(0.3, 0.9, fk);
  float band = smoothstep(0.55, 1.0, sin(sd * 0.42 - uTime * 1.3 + vnoise(p * 0.05) * 4.0));
  float fn = vnoise(p * 0.35 + uTime * 0.2);
  float foam = fb * clamp(band * fn * 1.6 + (1.0 - smoothstep(0.0, 4.0, sd)) * 0.85, 0.0, 1.0);
  col = mix(col, uAmb * 1.0 + uSunCol * 0.2, foam * 0.7);
  float wc = smoothstep(0.9, 0.98, crest + vnoise(p * 0.03 + uTime * 0.05) * 0.2) * smoothstep(60.0, 250.0, L) * (1.0 - smoothstep(600.0, 2500.0, L)) * step(0.9, fk);
  wc *= smoothstep(0.45, 0.8, w3.b) * smoothstep(0.3, 0.7, w2.b);
  col = mix(col, uAmb * 1.1 + uSunCol * 0.2, wc * 0.35);
  col = mix(col, hazeCol(rel), hazeAmt(rel));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

  const GROUND_FRAG = `
uniform sampler2D uAlb; uniform sampler2D uSdf; uniform sampler2D uOwn; uniform vec4 uGeo; uniform float uGrid;
varying vec3 vWP;
${NOISE_GLSL}
float ownAt(vec2 t){ if (t.x < 0.0 || t.y < 0.0 || t.x >= uGeo.y || t.y >= uGeo.z) return 0.0; return texture2D(uOwn, (floor(t) + 0.5) / uGeo.yz).r; }
`;
  const GROUND_MAP = `
vec2 tc = vWP.xz / uGeo.x + uGeo.yz * 0.5;
vec2 auv = (tc + uGeo.w) / (uGeo.yz + 2.0 * uGeo.w);
float gsd = texture2D(uSdf, auv).r * 192.0 - 64.0;
if (gsd > 1.0) discard;
vec3 alb = texture2D(uAlb, auv).rgb;
float gL = length(vWP - cameraPosition);
float nearW = 1.0 - smoothstep(150.0, 900.0, gL);
alb *= mix(1.0, 0.8 + 0.4 * vnoise(vWP.xz * 0.45) * (0.75 + 0.5 * vnoise(vWP.xz * 2.3)), nearW);
float inside = step(0.0, tc.x) * step(0.0, tc.y) * step(tc.x, uGeo.y) * step(tc.y, uGeo.z);
vec2 fr = fract(tc); vec2 de = min(fr, 1.0 - fr) * uGeo.x; float dmin = min(de.x, de.y);
float fw = fwidth(dmin) + 0.001;
float gline = (1.0 - smoothstep(0.2, 0.2 + fw * 1.5 + 0.25, dmin)) * inside;
alb *= 1.0 - 0.3 * gline * uGrid;
float own = ownAt(tc);
alb = mix(alb, alb * vec3(1.14, 1.1, 0.96) + vec3(0.03, 0.026, 0.012), own * 0.75);
float bl = 0.0;
if (own > 0.5) {
  if (ownAt(tc + vec2(-1.0, 0.0)) < 0.5) bl = max(bl, 1.0 - smoothstep(0.6, 0.6 + fw * 1.5 + 0.4, fr.x * uGeo.x));
  if (ownAt(tc + vec2(1.0, 0.0)) < 0.5) bl = max(bl, 1.0 - smoothstep(0.6, 0.6 + fw * 1.5 + 0.4, (1.0 - fr.x) * uGeo.x));
  if (ownAt(tc + vec2(0.0, -1.0)) < 0.5) bl = max(bl, 1.0 - smoothstep(0.6, 0.6 + fw * 1.5 + 0.4, fr.y * uGeo.x));
  if (ownAt(tc + vec2(0.0, 1.0)) < 0.5) bl = max(bl, 1.0 - smoothstep(0.6, 0.6 + fw * 1.5 + 0.4, (1.0 - fr.y) * uGeo.x));
}
alb = mix(alb, vec3(0.92, 0.86, 0.66), bl * 0.9);
diffuseColor.rgb *= alb;
`;

  // ---------- label sprites ----------
  function labelCanvas(text, o) {
    const sc = 2, fs = (o.fs || 13) * sc, pad = 7 * sc;
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = `800 ${fs}px system-ui, sans-serif`;
    const st = o.stars || null, sw = st ? fs * 1.05 : 0;
    const tw = Math.ceil(g.measureText(text).width) + (st ? (text ? fs * 0.4 : 0) + sw * st[1] : 0), bar = o.bar != null ? 6 * sc : 0;
    c.width = tw + pad * 2 + (o.stripe ? 10 * sc : 0); c.height = fs + pad * 1.4 + bar;
    g.font = `800 ${fs}px system-ui, sans-serif`;
    const W = c.width, H = c.height, rr = Math.min(H / 2, 10 * sc);
    g.fillStyle = o.bg || 'rgba(11,15,26,.88)';
    g.beginPath(); g.moveTo(rr, 0); g.lineTo(W - rr, 0); g.quadraticCurveTo(W, 0, W, rr); g.lineTo(W, H - rr); g.quadraticCurveTo(W, H, W - rr, H); g.lineTo(rr, H); g.quadraticCurveTo(0, H, 0, H - rr); g.lineTo(0, rr); g.quadraticCurveTo(0, 0, rr, 0); g.fill();
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = 2 * sc; g.stroke(); }
    let x0 = pad;
    if (o.stripe) { // hazard stripes: a shape cue for "under construction"
      g.save(); g.beginPath(); g.rect(pad * 0.6, pad * 0.5, 8 * sc, H - pad - bar); g.clip();
      for (let k = -H; k < 20 * sc; k += 6 * sc) { g.fillStyle = '#ffd54a'; g.beginPath(); g.moveTo(k, H); g.lineTo(k + 3 * sc, H); g.lineTo(k + 3 * sc + H, 0); g.lineTo(k + H, 0); g.fill(); }
      g.restore(); x0 += 10 * sc;
    }
    g.fillStyle = o.fg || '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(text, x0, (H - bar) / 2 + sc);
    if (st) { // filled stars = level reached, hollow = still to come (shape, not colour)
      let sx = x0 + g.measureText(text).width + (text ? fs * 0.4 : 0) + sw / 2;
      const cy = (H - bar) / 2 + sc * 0.5, R = fs * 0.5;
      for (let i = 0; i < st[1]; i++, sx += sw) {
        g.beginPath();
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.45 : R; g.lineTo(sx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.closePath();
        if (i < st[0]) { g.fillStyle = o.fg || '#ffd54a'; g.fill(); } else { g.strokeStyle = o.fg || '#ffd54a'; g.lineWidth = 1.6 * sc; g.stroke(); }
      }
    }
    if (bar) { g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(pad, H - bar - 3 * sc, W - pad * 2, bar - 2 * sc); g.fillStyle = o.fg || '#ffd54a'; g.fillRect(pad, H - bar - 3 * sc, (W - pad * 2) * clamp(o.bar, 0, 1), bar - 2 * sc); }
    return c;
  }
  function markCanvas(ok) {
    const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (ok) {
      g.fillStyle = '#0b5a37'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, 6.3); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke();
      g.lineWidth = 11; g.beginPath(); g.moveTo(s * 0.28, s * 0.52); g.lineTo(s * 0.44, s * 0.67); g.lineTo(s * 0.72, s * 0.35); g.stroke();
    } else {
      g.fillStyle = '#7a0a16'; g.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
      g.lineWidth = 11; g.beginPath(); g.moveTo(s * 0.3, s * 0.3); g.lineTo(s * 0.7, s * 0.7); g.moveTo(s * 0.7, s * 0.3); g.lineTo(s * 0.3, s * 0.7); g.stroke();
    }
    return c;
  }

  // =====================================================================================
  function mount3D(wrap, api) {
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-label', 'Campus map, 3D. Drag to move, right-drag or two fingers to rotate, scroll or pinch to zoom.');
    wrap.insertBefore(cv, wrap.firstChild);
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { cv.remove(); return null; }
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.66;
    renderer.shadowMap.enabled = !small;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));

    const texs = [], extraMats = [];
    const sunV = new T.Vector3(0.62 * Math.cos(SUN_EL), Math.sin(SUN_EL), -0.78 * Math.cos(SUN_EL)).normalize();
    const sky = skyTable(sunV); texs.push(sky.tex);
    const HU = { uSkyTex: { value: sky.tex }, uHz: { value: 1.25e-4 } };
    const M = makeMats(HU, small, texs);
    const G = protoGeos();

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(36, 1, 1, 60000);
    // sky dome + reflection environment
    const skyMesh = new window.ApogeeSky(); skyMesh.scale.setScalar(40000);
    const su = skyMesh.material.uniforms;
    su.turbidity.value = SKYP.turbidity; su.rayleigh.value = SKYP.rayleigh; su.mieCoefficient.value = SKYP.mie; su.mieDirectionalG.value = SKYP.g;
    su.sunPosition.value.copy(sunV).multiplyScalar(450000);
    scene.add(skyMesh);
    let envTex = null;
    try {
      const pm = new T.PMREMGenerator(renderer), es = new T.Scene(), s2 = new window.ApogeeSky();
      s2.scale.setScalar(900000);
      const u2 = s2.material.uniforms;
      u2.turbidity.value = SKYP.turbidity; u2.rayleigh.value = SKYP.rayleigh; u2.mieCoefficient.value = SKYP.mie; u2.mieDirectionalG.value = SKYP.g;
      u2.sunPosition.value.copy(su.sunPosition.value);
      es.add(s2); envTex = pm.fromScene(es).texture; pm.dispose(); s2.geometry.dispose(); s2.material.dispose();
      scene.environment = envTex;
    } catch (e) { /* no reflections */ }
    // lights
    const sun = new T.DirectionalLight(0xffc088, 4.6);
    sun.castShadow = renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.5; sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    scene.add(new T.HemisphereLight(0x9db6e0, 0x5a4a38, 0.35));

    // ground (terrain shader) + ocean
    const geoU = { value: new T.Vector4(TS, 1, 1, PADT) };
    const albU = { value: null }, sdfU = { value: null }, ownU = { value: null }, gridU = { value: 1 };
    const groundMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.5 });
    M._hz(groundMat, 'ground', (sh) => {
      Object.assign(sh.uniforms, { uAlb: albU, uSdf: sdfU, uOwn: ownU, uGeo: geoU, uGrid: gridU });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GROUND_FRAG).replace('#include <map_fragment>', GROUND_MAP);
    });
    extraMats.push(groundMat);
    const ground = new T.Mesh(new T.PlaneGeometry(14000, 14000), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.frustumCulled = false;
    scene.add(ground);
    const wd = waveData();
    const waveTex = new T.DataTexture(wd.data, wd.N, wd.N, T.RGBAFormat, T.UnsignedByteType);
    waveTex.wrapS = waveTex.wrapT = T.RepeatWrapping; waveTex.magFilter = T.LinearFilter; waveTex.minFilter = T.LinearMipmapLinearFilter; waveTex.generateMipmaps = true; waveTex.needsUpdate = true;
    texs.push(waveTex);
    const oceanU = Object.assign({}, HU, {
      uTime: { value: 0 }, uWaveTex: { value: waveTex }, uSunDir: { value: sunV.clone() },
      uSunCol: { value: new T.Vector3().fromArray(sky.sunCol) }, uAmb: { value: new T.Vector3().fromArray(sky.amb) }, uSdf: sdfU, uGeo: geoU,
    });
    const oceanMat = new T.ShaderMaterial({ uniforms: oceanU, vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG });
    extraMats.push(oceanMat);
    const ocean = new T.Mesh(new T.PlaneGeometry(50000, 50000), oceanMat);
    ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.7; ocean.frustumCulled = false;
    scene.add(ocean);

    const L = { // layers
      site: new T.Group(), veg: new T.Group(), fence: new T.Group(), signs: new T.Group(), bld: new T.Group(), ov: new T.Group(), labels: new T.Group(),
    };
    for (const k in L) scene.add(L[k]);

    // ---------- state ----------
    let userMoved = false;
    let W = 1, H = 1, alive = true, raf = 0, animT = 0, pollT = 0, fitDist = 600, fitPending = true, animOn = false;
    let D = null, site = null, sc = null;
    const st = { siteId: null, own: null, b: null, veg: null, sign: null, ov: null, prog: null };
    const bcache = new Map(); // id -> {key, group, anim, extras, labels}
    let anims = [], signYaw = null;
    const cam = { tx: 0, tz: 0, dist: 600, yaw: Math.PI / 4, pitch: 40 * DEG };
    const t0 = performance.now();
    const ownTexData = { tex: null };
    const ghostCache = new Map();
    const ghostMats = {
      ok: M._hz(new T.MeshStandardMaterial({ color: 0xe8f5ef, roughness: 0.6, transparent: true, opacity: 0.62, depthWrite: false }), 'ghost'),
      bad: M._hz(new T.MeshStandardMaterial({ color: 0xffe2e2, roughness: 0.6, transparent: true, opacity: 0.4, depthWrite: false }), 'ghost2'),
    };
    extraMats.push(ghostMats.ok, ghostMats.bad);
    const hatchTex = new T.CanvasTexture(cnv('hatch', 64, 64, PAINT.hatch)); hatchTex.wrapS = hatchTex.wrapT = T.RepeatWrapping; hatchTex.repeat.set(4, 4); texs.push(hatchTex);
    const OV = {
      okFill: new T.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false }),
      badFill: new T.MeshBasicMaterial({ color: 0xff5d6c, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, alphaMap: hatchTex }),
      okLine: new T.MeshBasicMaterial({ color: 0x3ddc97, toneMapped: false }),
      badLine: new T.MeshBasicMaterial({ color: 0xff5d6c, toneMapped: false }),
      sel: new T.MeshBasicMaterial({ color: 0xffd54a, toneMapped: false }),
      hover: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false }),
    };
    for (const k in OV) extraMats.push(OV[k]);
    const markTex = { ok: new T.CanvasTexture(markCanvas(true)), bad: new T.CanvasTexture(markCanvas(false)) };
    for (const k in markTex) { markTex[k].colorSpace = T.SRGBColorSpace; texs.push(markTex[k]); }

    const world = (tx, ty) => [(tx - site.w / 2) * TS, (ty - site.h / 2) * TS];

    // ---------- helpers ----------
    function disposeTree(o) {
      o.traverse((m) => {
        if (m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
        if (m.isInstancedMesh) m.dispose();
        if (m.isSprite) { if (m.material.map && !m.userData.sharedMap) m.material.map.dispose(); m.material.dispose(); }
      });
    }
    function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); disposeTree(c); } }
    function inst(geo, mat, list, shadows) { // list: [[x,y,z, ry, sx,sy,sz, color?]]
      const im = new T.InstancedMesh(geo, mat, Math.max(1, list.length));
      im.userData.sharedGeo = true;
      const col = new T.Color();
      list.forEach((it, i) => {
        _e.set(it[8] || 0, it[3] || 0, 0, 'YXZ'); _q.setFromEuler(_e);
        _m.compose(_v.set(it[0], it[1], it[2]), _q, _s.set(it[4] || 1, it[5] || 1, it[6] || 1));
        im.setMatrixAt(i, _m);
        if (it[7] != null) im.setColorAt(i, col.setHex(it[7]));
      });
      im.count = list.length;
      im.castShadow = !!shadows && renderer.shadowMap.enabled; im.receiveShadow = renderer.shadowMap.enabled;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      return im;
    }
    function label(text, o, x, y, z) {
      const c = labelCanvas(text, o || {});
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
      const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
      sp.center.set(0.5, 0);
      sp.userData.px = c.height / 2; sp.userData.ar = c.width / c.height;
      sp.position.set(x, y, z); sp.renderOrder = 20;
      scaleSprite(sp);
      return sp;
    }
    function scaleSprite(sp) {
      const s = sp.userData.px * 2 * Math.tan(camera.fov * DEG / 2) / Math.max(1, H);
      sp.scale.set(s * sp.userData.ar, s, 1);
    }
    function ribbons(x0, z0, x1, z1, wdt, mat, dashed, y) {
      const B = new Bld(), yy = y || 0.45;
      const segs = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
      for (const [ax, az, bx, bz] of segs) {
        const Ls = Math.hypot(bx - ax, bz - az);
        if (!dashed) { B.boxC(mat, Ls + wdt, 0.3, wdt, (ax + bx) / 2, yy, (az + bz) / 2, 0, -Math.atan2(bz - az, bx - ax)); continue; }
        const n = Math.max(2, Math.round(Ls / 8));
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 0.6) / n;
          const cx = ax + (bx - ax) * (t0 + t1) / 2, cz = az + (bz - az) * (t0 + t1) / 2;
          B.boxC(mat, Ls * (t1 - t0), 0.3, wdt, cx, yy, cz, 0, -Math.atan2(bz - az, bx - ax));
        }
      }
      const g = B.mesh(null, false);
      g.traverse((m) => { if (m.isMesh) m.renderOrder = 5; });
      return g;
    }

    // ---------- site layer ----------
    function buildSite(s) {
      clearGroup(L.site);
      D = siteData(s);
      geoU.value.set(TS, s.w, s.h, PADT);
      if (albU.value) albU.value.dispose(); if (sdfU.value) sdfU.value.dispose();
      const at = new T.CanvasTexture(D.can); at.flipY = false; at.colorSpace = T.SRGBColorSpace; at.wrapS = at.wrapT = T.MirroredRepeatWrapping; at.anisotropy = small ? 2 : 8;
      albU.value = at;
      const sdT = new T.DataTexture(D.sdf, D.MW, D.MH, T.RGBAFormat, T.UnsignedByteType);
      sdT.wrapS = sdT.wrapT = T.MirroredRepeatWrapping; sdT.magFilter = sdT.minFilter = T.LinearFilter; sdT.generateMipmaps = false; sdT.needsUpdate = true;
      sdfU.value = sdT;
      ocean.visible = D.hasWater;
      // roads
      const B = new Bld(), RW = 12, w2 = s.w / 2, h2 = s.h / 2;
      for (const [x0, y0, x1, y1, dir] of D.roads.strips) {
        if (dir) { const X = (x0 + 0.5 - w2) * TS, Z0 = (y0 - h2) * TS, Z1 = (y1 + 1 - h2) * TS; B.add(M.road, quadG(X - RW / 2, Z0, X + RW / 2, Z1, 0.06, 0, (Z1 - Z0) / 12, 0, 1, true)); }
        else { const Z = (y0 + 0.5 - h2) * TS, X0 = (x0 - w2) * TS, X1 = (x1 + 1 - w2) * TS; B.add(M.road, quadG(X0, Z - RW / 2, X1, Z + RW / 2, 0.06, 0, (X1 - X0) / 12, 0, 1)); }
      }
      for (const [x, y, l, r, u, d] of D.roads.squares) {
        const X = (x + 0.5 - w2) * TS, Z = (y + 0.5 - h2) * TS, hw = RW / 2;
        const xa = l ? X - TS / 2 : X - hw, xb = r ? X + TS / 2 : X + hw, za = u ? Z - TS / 2 : Z - hw, zb = d ? Z + TS / 2 : Z + hw;
        B.add(M.asph, quadG(xa, Z - hw, xb, Z + hw, 0.07, xa / 10, xb / 10, (Z - hw) / 10, (Z + hw) / 10));
        if (u || d) B.add(M.asph, quadG(X - hw, za, X + hw, zb, 0.071, (X - hw) / 10, (X + hw) / 10, za / 10, zb / 10));
      }
      // city blocks
      for (const c of D.city) {
        const X = (c.x - w2) * TS, Z = (c.y - h2) * TS, bw = c.w * TS, bd = c.d * TS;
        const fm = c.v ? M.facadeB : M.facadeA;
        B.box(fm, bw, c.h, bd, X, 0, Z);
        B.box(M.roofDark, bw + 0.6, 0.8, bd + 0.6, X, c.h, Z);
        if (c.h > 30) B.box(M.steel, bw * 0.35, 3, bd * 0.3, X, c.h + 0.8, Z);
      }
      const g = B.mesh(null, renderer.shadowMap.enabled);
      g.traverse((m) => { if (m.isMesh && (m.material === M.road || m.material === M.asph)) { m.castShadow = false; m.renderOrder = 1; } });
      L.site.add(g);
      // rocks
      if (D.rocks.length) {
        L.site.add(inst(G.rock, M.rock, D.rocks.map((k) => { const [x, z] = world(k.x, k.y); return [x, 0, z, k.ry, k.sx, k.sy, k.sz, D.fill === 'd' ? [0xb0704a, 0xa8653f, 0xc08260][Math.floor(k.c * 3)] : [0x8f8578, 0x9c9184, 0x7c746a][Math.floor(k.c * 3)]]; }), true));
      }
      // shadow frustum covers the site
      const R = Math.hypot(s.w, s.h) * TS / 2 + 90;
      const c = sun.shadow.camera; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 50; c.far = 5000; c.updateProjectionMatrix();
      sun.position.copy(sunV).multiplyScalar(2500); sun.target.position.set(0, 0, 0);
      // owned texture
      if (ownTexData.tex) ownTexData.tex.dispose();
      ownTexData.data = new Uint8Array(s.w * s.h * 4);
      const ot = new T.DataTexture(ownTexData.data, s.w, s.h, T.RGBAFormat, T.UnsignedByteType);
      ot.magFilter = ot.minFilter = T.NearestFilter; ot.generateMipmaps = false; ot.needsUpdate = true;
      ownTexData.tex = ot; ownU.value = ot;
      for (const [, v] of bcache) dropB(v);
      bcache.clear();
    }

    function updateOwned(owned) {
      const d = ownTexData.data; d.fill(0);
      for (const k of owned) if (k >= 0 && k < site.w * site.h) { d[k * 4] = 255; d[k * 4 + 3] = 255; }
      ownTexData.tex.needsUpdate = true;
      // fence along the owned boundary (gaps where a road is next to it)
      clearGroup(L.fence);
      const own = (x, y) => x >= 0 && y >= 0 && x < site.w && y < site.h && owned.has(y * site.w + x);
      const posts = [], rails = [];
      for (const k of owned) {
        const x = k % site.w, y = Math.floor(k / site.w);
        const edges = [[0, -1, x, y, x + 1, y], [1, 0, x + 1, y, x + 1, y + 1], [0, 1, x, y + 1, x + 1, y + 1], [-1, 0, x, y, x, y + 1]];
        for (const [dx, dy, ax, ay, bx, by] of edges) {
          if (own(x + dx, y + dy)) continue;
          const nt = D.typ(x + dx, y + dy);
          if (nt === 'R') continue;
          const [X0, Z0] = world(ax, ay), [X1, Z1] = world(bx, by);
          const ix = -dx * 1.2, iz = -dy * 1.2; // just inside the plot
          for (let i = 0; i < 10; i++) { const t = i / 10; posts.push([X0 + (X1 - X0) * t + ix, 0, Z0 + (Z1 - Z0) * t + iz]); }
          const ry = dx ? Math.PI / 2 : 0;
          for (const yy of [1.0, 2.0]) rails.push([(X0 + X1) / 2 + ix, yy, (Z0 + Z1) / 2 + iz, ry, TS, 1, 1]);
        }
      }
      if (posts.length) { L.fence.add(inst(G.post, M.fence, posts, false)); L.fence.add(inst(G.rail, M.fence, rails, false)); }
    }

    function updateSigns() {
      clearGroup(L.signs);
      signYaw = cam.yaw;
      if (!(sc.mode === 'buy' && sc.open)) return;
      const posts = [], boards = [];
      for (let y = 0; y < site.h; y++) for (let x = 0; x < site.w; x++) {
        const ch = site.map[y][x];
        if (sc.owned.has(y * site.w + x) || !(sc.TER[ch] && sc.TER[ch].buy)) continue;
        if (sc.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
        const [X, Z] = world(x + 0.5, y + 0.5);
        posts.push([X, 0, Z, cam.yaw]); boards.push([X, 0, Z, cam.yaw]);
      }
      if (posts.length) { L.signs.add(inst(G.spost, M.wood, posts, true)); L.signs.add(inst(G.board, M.sign, boards, true)); }
    }

    // ---------- buildings ----------
    function dropB(v) { L.bld.remove(v.group); disposeTree(v.group); for (const e of v.extras) { L.bld.remove(e); disposeTree(e); } for (const l of v.labels) { L.labels.remove(l); disposeTree(l); } }
    function buildModel(b, lvl, ghost) {
      const t = MODELS[b.type] ? b.type : 'office';
      const long = b.w >= b.h, Lm = Math.max(b.w, b.h) * TS, Dm = Math.min(b.w, b.h) * TS;
      const X = { parks: [], trees: [], lights: [], panels: [], trucks: [], interior: [], anim: [], extras: [] };
      if (t === 'tower' && site) {
        const pad = (sc ? sc.buildings : []).find((o) => o.type === 'pad' && (o.x === b.x + 1 || o.x + o.w === b.x || o.y === b.y + 1 || o.y + o.h === b.y) && Math.abs((o.x + o.w / 2) - (b.x + 0.5)) <= 2 && Math.abs((o.y + o.h / 2) - (b.y + 0.5)) <= 2);
        X.armDir = pad ? Math.atan2((pad.y + pad.h / 2) - (b.y + 0.5), (pad.x + pad.w / 2) - (b.x + 0.5)) : 0;
      }
      if (t === 'pad' && b.pk) { X.pk = b.pk; X.rocket = rocket; X.Bld = Bld; } // Pad kit: hand the pad config to its model
      const B = new Bld();
      if (lvl > 0) MODELS[t](B, Lm, Dm, Math.min(3, lvl), M, X, ghost);
      else mConstruct(B, M, Lm, Dm, HGT[t] || 20, b.prog || 0, t);
      for (const p of X.lights) B.box(M.redLight, 0.9, 0.9, 0.9, p[0], p[1], p[2]);
      const group = B.mesh(ghost || null, !ghost && renderer.shadowMap.enabled);
      const [cx, cz] = world(b.x + b.w / 2, b.y + b.h / 2);
      group.position.set(cx, 0, cz);
      if (!long) group.rotation.y = Math.PI / 2;
      group.userData.b = b;
      return { group, X, Lm, Dm };
    }
    function localToWorld(group, p) { _v.set(p[0], p[1] || 0, p[2] != null ? p[2] : p[1]); return _v.applyMatrix4(group.matrixWorld).clone(); }

    function updateBuildings() {
      const seen = new Set();
      for (const b of sc.buildings) {
        seen.add(b.id);
        const cons = b.days > 0;
        const key = [b.type, b.x, b.y, b.w, b.h, b.lvl, cons ? 1 : 0, b.lvl === 0 ? Math.floor((b.prog || 0) * 8) : 0, b.pk && window.APOGEE_PADKIT ? window.APOGEE_PADKIT.viewKey(b) : ''].join(':'); // last: pad kit look
        const old = bcache.get(b.id);
        if (old && old.key === key) { old.b = b; continue; }
        if (old) dropB(old);
        const { group, X, Lm, Dm } = buildModel(b, b.lvl);
        L.bld.add(group); group.updateMatrixWorld(true);
        const v = { key, group, extras: [], labels: [], anim: [], b, X: { parks: [], trees: [], panels: [], trucks: [] } };
        // tower crane while building/upgrading
        if (cons) {
          const full = HGT[b.type] || 20, hc = Math.max(full * (b.lvl ? 1.05 : 0.9), 18) + 12, jib = Math.max(26, Math.max(Lm, Dm) * 0.75);
          const cr = towerCrane(M, hc, jib);
          const sg = cr.s.mesh(null, renderer.shadowMap.enabled), jg = cr.j.mesh(null, renderer.shadowMap.enabled);
          const cxl = -Lm / 2 + 3, czl = -Dm / 2 + 3;
          sg.position.set(cxl, 0, czl); jg.position.set(cxl, hc + 1.2, czl);
          if (b.lvl > 0) { const sB = new Bld(), sw = Math.min(30, Lm * 0.4); scaffold(sB, M, Lm / 2 - 8 - sw, Dm / 2 - 16, Lm / 2 - 8, Dm / 2 - 8, Math.min(full * 0.6, 24)); group.add(sB.mesh(null, renderer.shadowMap.enabled)); }
          group.add(sg, jg);
          const ph = (b.x * 7 + b.y * 3) % 6;
          v.anim.push((t) => { jg.rotation.y = ph + t * 0.12; });
        }
        // the drone ship sits on the nearest sea plot
        if (b.type === 'port' && b.lvl > 0) {
          let sea = null;
          for (let yy = b.y; yy < b.y + b.h && !sea; yy++) for (let xx = b.x; xx < b.x + b.w && !sea; xx++) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (D.typ(xx + dx, yy + dy) === 'S') { sea = [xx + dx, yy + dy, dx, dy]; break; }
          if (sea) {
            const S2 = new Bld();
            S2.box(M.hull, 34, 4, 22, 0, -2.6, 0); S2.box(M.deck, 33, 0.3, 21, 0, 1.4, 0);
            S2.box(M.hull, 34, 2.2, 1.2, 0, 1.4, -10.6); S2.box(M.hull, 34, 2.2, 1.2, 0, 1.4, 10.6);
            S2.box(M.white, 4, 3, 3, -14, 1.4, -8); S2.box(M.white, 4, 3, 3, 14, 1.4, 8);
            S2.box(M.yellow, 0.6, 0.6, 22, 16.5, 1.4, 0);
            const bg = S2.mesh(null, renderer.shadowMap.enabled);
            const [X0, Z0] = world(sea[0] + 0.5, sea[1] + 0.5);
            bg.position.set(X0, -0.7, Z0); if (sea[2]) bg.rotation.y = Math.PI / 2;
            L.bld.add(bg); v.extras.push(bg);
            v.anim.push((t) => { bg.position.y = -0.7 + Math.sin(t * 0.9) * 0.25; bg.rotation.z = Math.sin(t * 0.6) * 0.012; });
          }
        }
        if (X.steam && b.lvl > 0) { /* static test stand: no plume when idle */ }
        // collect world-space instance spots
        for (const p of X.parks) { const q = localToWorld(group, [p[0], 0, p[1]]); v.X.parks.push([q.x, q.z, p[2] + group.rotation.y, (b.id.length * 13 + p[0] * 7 + p[1] * 3) | 0]); }
        for (const p of X.trucks) { const q = localToWorld(group, [p[0], 0, p[1]]); v.X.trucks.push([q.x, q.z, p[2] + group.rotation.y]); }
        for (const p of X.trees) { const q = localToWorld(group, [p[0], 0, p[1]]); v.X.trees.push([q.x, q.z]); }
        for (const p of X.panels) { const q = localToWorld(group, [p[0], 0, p[1]]); v.X.panels.push([q.x, q.z, group.rotation.y]); }
        for (const p of X.interior) { /* warm interior glow is in the material */ }
        bcache.set(b.id, v);
      }
      for (const [id, v] of [...bcache]) if (!seen.has(id)) { dropB(v); bcache.delete(id); }
      anims = [];
      for (const [, v] of bcache) anims.push(...v.anim);
      updateLabels();
    }
    function updateLabels() {
      for (const [, v] of bcache) { for (const l of v.labels) { L.labels.remove(l); disposeTree(l); } v.labels = []; }
      for (const [, v] of bcache) {
        const b = v.b, [cx, cz] = world(b.x + b.w / 2, b.y + b.h / 2), full = HGT[b.type] || 20;
        let l;
        if (b.days > 0) {
          const pct = Math.round((b.prog || 0) * 100);
          l = label(b.lvl ? `UPGRADING TO LEVEL ${b.to || b.lvl + 1} · ${pct}%` : `BUILDING ${pct}%`, { bg: 'rgba(20,14,0,.88)', fg: '#ffd54a', stripe: true, bar: b.prog || 0, fs: small ? 10 : 12 }, cx, full + 18, cz);
        } else if (b.lvl > 0) {
          l = label(b.pk && window.APOGEE_PADKIT ? window.APOGEE_PADKIT.badge(b) : '', { bg: 'rgba(11,15,26,.72)', fg: '#ffd54a', fs: small ? 8 : 10, stars: [b.lvl, 3] }, cx, full + 6, cz); // pad kit: pad type name
        }
        if (l) { if (b.days > 0) l.renderOrder = 24; else l.userData.badge = b.id; L.labels.add(l); v.labels.push(l); }
      }
    }

    // ---------- vegetation, cars, panels (instanced) ----------
    function updateVeg() {
      clearGroup(L.veg);
      const rects = sc.buildings.map((b) => { const [x0, z0] = world(b.x, b.y), [x1, z1] = world(b.x + b.w, b.y + b.h); return [x0 - 2, z0 - 2, x1 + 2, z1 + 2]; });
      const blocked = (x, z) => rects.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
      const budget = small ? 1600 : 5000, step = Math.max(1, Math.ceil(D.veg.length / budget));
      const trunks = [], crowns = [], pines = [], bushes = [], reeds = [], palms = [], palmTr = [];
      const GREENS = [0x4d6a2c, 0x5a7432, 0x3f5c28, 0x6a7a38, 0x4a6230];
      D.veg.forEach((v, i) => {
        if (i % step) return;
        const [x, z] = world(v.x, v.y);
        if (blocked(x, z)) return;
        const s = v.s, ci = Math.floor(v.c * 5);
        if (v.k === 'tree') { const ht = 5 * s; trunks.push([x, 0, z, v.c * 6, s, ht, s]); crowns.push([x, ht * 0.85, z, v.c * 6, 4.2 * s, 3.6 * s, 4.2 * s, GREENS[ci]]); }
        else if (v.k === 'pine') { trunks.push([x, 0, z, 0, s * 0.8, 4 * s, s * 0.8]); pines.push([x, 3 * s, z, v.c * 6, 2.8 * s, 10 * s, 2.8 * s, [0x2f4a26, 0x36522a, 0x2b4422][ci % 3]]); }
        else if (v.k === 'palm') { const ht = 9 * s, lean = (v.c - 0.5) * 0.3, ry = v.c * 6, off = Math.sin(lean) * ht; palmTr.push([x, 0, z, ry, 0.7 * s, ht, 0.7 * s, null, lean]); palms.push([x + off * Math.sin(ry), ht * Math.cos(lean), z + off * Math.cos(ry), ry, 1.3 * s, 1.3 * s, 1.3 * s, [0x587a2e, 0x4f6e2a, 0x678838][ci % 3]]); }
        else if (v.k === 'bush') bushes.push([x, 0, z, v.c * 6, 2.2 * s, 2 * s, 2.2 * s, [0x4b5e2c, 0x56662f, 0x3e5027, 0x6b6a3a, 0x52603a][ci]]);
        else if (v.k === 'shrub') bushes.push([x, 0, z, v.c * 6, 1.6 * s, 1.2 * s, 1.6 * s, [0x7d7a58, 0x6e7050, 0x8a8260][ci % 3]]);
        else if (v.k === 'reed') reeds.push([x, 0, z, v.c * 6, 0.9 * s, 2.4 * s, 0.9 * s, [0x7a8044, 0x8a8a50, 0x6a7a3c][ci % 3]]);
      });
      const extraTrees = [];
      for (const [, v] of bcache) for (const t of v.X.trees) extraTrees.push(t);
      for (const [x, z] of extraTrees) { trunks.push([x, 0, z, 0, 0.9, 4.5, 0.9]); crowns.push([x, 4, z, x, 3.4, 3.2, 3.4, 0x4f6c2e]); }
      const sh = !small;
      if (trunks.length) L.veg.add(inst(G.trunk, M.trunk, trunks.concat(palmTr), false));
      if (crowns.length) L.veg.add(inst(G.crown, M.leaf, crowns, sh));
      if (pines.length) L.veg.add(inst(G.pine, M.leaf, pines, sh));
      if (palms.length) L.veg.add(inst(G.palm, M.leaf, palms, sh));
      if (bushes.length) L.veg.add(inst(G.bush, M.leaf, bushes, false));
      if (reeds.length) L.veg.add(inst(G.reed, M.leaf, reeds, false));
      // cars: parking spots (some empty) + traffic on roads
      const CAR = [0xf2f2f2, 0xc0c4c8, 0x1e2226, 0x24406a, 0x8a1e1e, 0x6b6f74, 0xe8e2d0];
      const cars = [], trucks = [];
      for (const [, v] of bcache) {
        if (!v.b.lvl) continue;
        for (const p of v.X.parks) if (nh(p[3], p[0] | 0, 5) < 0.62) cars.push([p[0], 0, p[1], p[2], 1, 1, 1, CAR[Math.floor(nh(p[0] | 0, p[1] | 0, 9) * CAR.length)]]);
        for (const p of v.X.trucks) trucks.push([p[0], 0, p[1], p[2], 1, 1, 1, 0xffffff]);
      }
      for (const c of D.cars) { const [x, z] = world(c[0], c[1]); if (!blocked(x, z)) cars.push([x, 0, z, c[2], 1, 1, 1, CAR[Math.floor(nh(c[0] * 100 | 0, c[1] * 100 | 0, 3) * CAR.length)]]); }
      if (cars.length) L.veg.add(inst(G.car, M.car, cars, sh));
      if (trucks.length) L.veg.add(inst(G.truck, M.car, trucks, sh));
      // solar panels
      const panels = [], legs = [];
      for (const [, v] of bcache) for (const p of v.X.panels) { panels.push([p[0], 0, p[1], 0]); legs.push([p[0], 0, p[1], 0]); }
      if (panels.length) { L.veg.add(inst(G.panel, M.solarP, panels, sh)); L.veg.add(inst(G.pleg, M.steel, legs, false)); }
    }

    // ---------- overlays: preview, selection, hover ----------
    function updateOverlay() {
      clearOv();
      const pv = sc.preview;
      if (pv) {
        const ok = pv.ok;
        for (const tl of pv.tiles) {
          if (tl.x < 0 || tl.y < 0 || tl.x >= site.w || tl.y >= site.h) continue;
          const good = tl.ok && ok;
          const [X, Z] = world(tl.x + 0.5, tl.y + 0.5);
          const q = new T.Mesh(quadG(X - TS / 2 + 1, Z - TS / 2 + 1, X + TS / 2 - 1, Z + TS / 2 - 1, 0.35, 0, 1, 0, 1), good ? OV.okFill : OV.badFill);
          q.renderOrder = 4; L.ov.add(q);
          const mk = new T.Sprite(new T.SpriteMaterial({ map: good ? markTex.ok : markTex.bad, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
          mk.userData.px = small ? 24 : 28; mk.userData.ar = 1; mk.userData.sharedMap = true;
          mk.position.set(X, 2, Z); mk.renderOrder = 30; scaleSprite(mk);
          L.ov.add(mk);
        }
        const [x0, z0] = world(pv.x, pv.y), [x1, z1] = world(pv.x + pv.w, pv.y + pv.h);
        L.ov.add(ribbons(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, 1.4, ok ? OV.okLine : OV.badLine, !ok, 0.5));
        const gk = pv.type + ':' + pv.w + 'x' + pv.h + ':' + (ok ? 1 : 0);
        let gm = ghostCache.get(gk);
        if (!gm) { gm = buildModel({ type: pv.type, x: 0, y: 0, w: pv.w, h: pv.h, lvl: 1 }, 1, ok ? ghostMats.ok : ghostMats.bad).group; gm.userData.keep = true; ghostCache.set(gk, gm); }
        const [cx, cz] = world(pv.x + pv.w / 2, pv.y + pv.h / 2);
        gm.position.set(cx, 0, cz);
        L.ov.add(gm);
      }
      if (sc.sel) {
        const s = sc.sel, [x0, z0] = world(s.x, s.y), [x1, z1] = world(s.x + s.w, s.y + s.h);
        L.ov.add(ribbons(x0 + 0.4, z0 + 0.4, x1 - 0.4, z1 - 0.4, 1.6, OV.sel, false, 0.55));
        if (s.label) {
          const b = sc.buildings.find((o) => o.x === s.x && o.y === s.y && o.w === s.w && o.h === s.h);
          const lv = b && b.lvl ? [b.lvl, 3] : null;
          const hh = b ? (HGT[b.type] || 20) + (b.days > 0 ? 40 : 18) : 20;
          L.ov.add(label('▲ ' + s.label, { bg: 'rgba(11,15,26,.9)', fg: '#ffd54a', border: '#ffd54a', fs: 13, stars: lv }, (x0 + x1) / 2, hh, (z0 + z1) / 2));
        }
      }
      if (sc.hover && !pv && sc.hover.x >= 0 && sc.hover.y >= 0 && sc.hover.x < site.w && sc.hover.y < site.h) {
        const [x0, z0] = world(sc.hover.x, sc.hover.y);
        L.ov.add(ribbons(x0 + 0.6, z0 + 0.6, x0 + TS - 0.6, z0 + TS - 0.6, 0.8, OV.hover, false, 0.4));
      }
    }
    // keep cached ghost models alive when the overlay is cleared
    function clearOv() { for (const c of [...L.ov.children]) { L.ov.remove(c); if (!c.userData.keep) disposeTree(c); } }

    // ---------- sync with campus.js ----------
    function sync() {
      const s = api.scene();
      if (!s) return false;
      sc = s;
      let ch = false;
      if (s.site.id !== st.siteId) {
        const same = st.siteId && st.siteId.split('~')[0] === (s.site.base || s.site.id);
        site = s.site; buildSite(site); st.siteId = site.id;
        st.own = st.b = st.veg = st.sign = st.ov = null; if (!same) fitPending = true; ch = true;
      }
      site = s.site;
      const ownKey = [...s.owned].sort((a, b) => a - b).join(',');
      if (ownKey !== st.own) { st.own = ownKey; updateOwned(s.owned); ch = true; }
      const bKey = s.buildings.map((b) => [b.id, b.type, b.x, b.y, b.w, b.h, b.lvl, b.days > 0 ? 1 : 0, b.lvl === 0 ? Math.floor((b.prog || 0) * 8) : 0].join(':')).join('|');
      if (bKey !== st.b) { st.b = bKey; updateBuildings(); st.veg = null; ch = true; }
      const pKey = s.buildings.map((b) => (b.days > 0 ? b.id + ':' + Math.round((b.prog || 0) * 100) : '')).join('|');
      if (pKey !== st.prog) {
        st.prog = pKey;
        for (const b of s.buildings) { const v = bcache.get(b.id); if (v) v.b = b; }
        updateLabels(); ch = true;
      }
      if (st.veg === null) { st.veg = 1; updateVeg(); }
      const signKey = (s.mode === 'buy' && s.open ? 1 : 0) + '|' + ownKey + '|' + bKey;
      if (signKey !== st.sign) { st.sign = signKey; updateSigns(); ch = true; }
      const ovKey = JSON.stringify([s.preview, s.sel, s.preview ? null : s.hover && [s.hover.x, s.hover.y]]);
      if (ovKey !== st.ov) { st.ov = ovKey; updateOverlay(); ch = true; }
      gridU.value = s.mode === 'look' ? 0.55 : 1.25;
      const selB = s.sel && s.sel.label ? s.buildings.find((o) => o.x === s.sel.x && o.y === s.sel.y && o.w === s.sel.w && o.h === s.sel.h) : null;
      for (const l of L.labels.children) if (l.userData.badge) l.visible = !selB || l.userData.badge !== selB.id;
      const wantAnim = (D && D.hasWater) || anims.length > 0;
      animOn = wantAnim;
      return ch;
    }

    // ---------- camera ----------
    function applyCam() {
      const cp = Math.cos(cam.pitch);
      camera.position.set(cam.tx + cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.tz + cam.dist * cp * Math.cos(cam.yaw));
      camera.near = Math.max(0.5, cam.dist * 0.004);
      camera.updateProjectionMatrix();
      camera.lookAt(cam.tx, 0, cam.tz);
      camera.updateMatrixWorld();
    }
    function fitCam() {
      if (!site) return;
      cam.yaw = Math.PI / 4; cam.pitch = (W < 520 ? 47 : 40) * DEG; cam.tx = 0; cam.tz = 0;
      const hw = site.w * TS / 2, hh = site.h * TS / 2;
      const pts = [];
      for (const [x, z] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) { pts.push(new T.Vector3(x, 0, z)); pts.push(new T.Vector3(x, 25, z)); }
      let lo = 30, hi = 30000;
      const pv = new T.Vector3();
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2; cam.dist = mid; applyCam();
        let ok = true;
        for (const p of pts) { pv.copy(p).project(camera); if (Math.abs(pv.x) > 0.96 || pv.y > 0.8 || pv.y < -0.96) { ok = false; break; } }
        if (ok) hi = mid; else lo = mid;
      }
      fitDist = hi;
      cam.dist = hi * (W < 520 ? 0.86 : 1);
      // centre vertically between the margins
      applyCam(); fitPending = false; userMoved = false;
    }
    function clampCam() {
      if (!site) return;
      cam.dist = clamp(cam.dist, fitDist * 0.16, fitDist * 1.8);
      cam.pitch = clamp(cam.pitch, 12 * DEG, 85 * DEG);
      const mx = site.w * TS / 2 + 160, mz = site.h * TS / 2 + 160;
      cam.tx = clamp(cam.tx, -mx, mx); cam.tz = clamp(cam.tz, -mz, mz);
    }
    const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), ndc = new T.Vector2();
    function groundAt(px, py) {
      ndc.set(px / W * 2 - 1, -(py / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const p = new T.Vector3();
      return ray.ray.intersectPlane(plane, p) ? p : null;
    }
    function pick(px, py) {
      ndc.set(px / W * 2 - 1, -(py / H) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObject(L.bld, true);
      for (const h of hits) {
        let o = h.object; while (o && !o.userData.b) o = o.parent;
        if (o && o.userData.b) {
          const b = o.userData.b;
          const tx = clamp(Math.floor(h.point.x / TS + site.w / 2), b.x, b.x + b.w - 1), ty = clamp(Math.floor(h.point.z / TS + site.h / 2), b.y, b.y + b.h - 1);
          return { x: tx, y: ty };
        }
      }
      const g = groundAt(px, py);
      if (!g) return { x: -1, y: -1 };
      return { x: Math.floor(g.x / TS + site.w / 2), y: Math.floor(g.z / TS + site.h / 2) };
    }

    // ---------- render loop (on demand) ----------
    const visible = () => alive && !document.hidden && cv.isConnected && wrap.offsetParent !== null;
    function invalidate() { if (alive && !raf) raf = requestAnimationFrame(frame); }
    let tween = null;
    function frame() {
      raf = 0;
      if (!visible()) return;
      if (W < 2) { resize(); if (W < 2) return; }
      sync();
      if (fitPending) fitCam();
      const now = performance.now(), t = (now - t0) / 1000;
      if (tween) {
        const k = Math.min(1, (now - tween.s) / 350), e = k * k * (3 - 2 * k);
        cam.yaw = tween.a + (tween.b - tween.a) * e;
        if (k < 1) invalidate(); else tween = null;
      }
      clampCam(); applyCam();
      if (signYaw != null && Math.abs(signYaw - cam.yaw) > 0.2 && L.signs.children.length) updateSigns();
      for (const f of anims) f(t);
      oceanU.uTime.value = t;
      renderer.render(scene, camera);
      V3.frames++;
      if (animOn && !animT) animT = setTimeout(() => { animT = 0; invalidate(); }, small ? 110 : 70);
    }
    function resize() {
      const r = wrap.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const changed = Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1;
      W = r.width; H = r.height;
      renderer.setSize(W, H, false);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      camera.aspect = W / H; camera.updateProjectionMatrix();
      L.labels.children.concat(L.ov.children).forEach((o) => { if (o.isSprite) scaleSprite(o); });
      if (changed && site && !userMoved) fitPending = true;
      invalidate();
    }

    // ---------- input ----------
    const pts = new Map();
    let gest = null, moved = false, hoverKey = '', lastHover = 0;
    const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function startGesture(e) {
      const vals = [...pts.values()];
      if (vals.length >= 2) {
        const [a, b] = vals;
        gest = { type: 'two', d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, a: Math.atan2(b[1] - a[1], b[0] - a[0]), my: (a[1] + b[1]) / 2, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch };
      } else if (vals.length === 1) {
        const [p] = vals;
        const rot = e && (e.button === 2 || e.shiftKey || e.ctrlKey || e.altKey);
        gest = { type: rot ? 'rot' : 'pan', x: p[0], y: p[1], yaw: cam.yaw, pitch: cam.pitch, grab: groundAt(p[0], p[1]) };
      } else gest = null;
    }
    function onDown(e) {
      if (cv.setPointerCapture) try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) moved = false; else moved = true;
      tween = null;
      startGesture(e);
    }
    function onMove(e) {
      const p = rel(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (gest && gest.type === 'two' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, an = Math.atan2(b[1] - a[1], b[0] - a[0]), my = (a[1] + b[1]) / 2;
        cam.dist = gest.dist * gest.d / d;
        let da = an - gest.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        cam.yaw = gest.yaw + da;
        cam.pitch = gest.pitch + (my - gest.my) * 0.006;
        userMoved = true; clampCam(); invalidate(); return;
      }
      if (gest && pts.size === 1 && pts.has(e.pointerId)) {
        const dx = p[0] - gest.x, dy = p[1] - gest.y;
        if (!moved && Math.hypot(dx, dy) > 7) moved = true;
        if (!moved) return;
        cv.style.cursor = 'grabbing'; userMoved = true;
        if (gest.type === 'rot') { cam.yaw = gest.yaw - dx * 0.007; cam.pitch = gest.pitch + dy * 0.005; }
        else if (gest.grab) {
          applyCam();
          const g = groundAt(p[0], p[1]);
          if (g) { cam.tx += gest.grab.x - g.x; cam.tz += gest.grab.z - g.z; }
        }
        clampCam(); invalidate(); return;
      }
      if (e.pointerType === 'mouse' && !pts.size && site) {
        const now = performance.now();
        if (now - lastHover < 40) return;
        lastHover = now;
        const tl = pick(p[0], p[1]), k = tl.x + ',' + tl.y;
        if (k !== hoverKey) { hoverKey = k; api.hover(tl); invalidate(); }
      }
    }
    function onUp(e) {
      const p = rel(e);
      const wasTap = gest && gest.type !== 'two' && !moved && pts.size === 1;
      pts.delete(e.pointerId);
      cv.style.cursor = '';
      startGesture(null);
      if (pts.size) moved = true;
      if (wasTap && e.type === 'pointerup' && site && e.button !== 2) { const tl = pick(p[0], p[1]); tl.mouse = e.pointerType === 'mouse'; api.tap(tl); }
      invalidate();
    }
    function onWheel(e) {
      e.preventDefault();
      const [x, y] = rel(e), g = groundAt(x, y);
      const nd = clamp(cam.dist * Math.exp(e.deltaY * 0.0013), fitDist * 0.16, fitDist * 1.8), k = 1 - nd / cam.dist;
      if (g) { cam.tx += (g.x - cam.tx) * k; cam.tz += (g.z - cam.tz) * k; }
      cam.dist = nd; userMoved = true; clampCam(); invalidate();
    }
    function onLeave() { if (pts.size) return; hoverKey = ''; api.hover(null); invalidate(); }
    const noCtx = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', noCtx);
    // rotate buttons next to campus.js's zoom buttons
    const zoomBox = wrap.querySelector('.cp-zoom');
    const rotBtns = [];
    if (zoomBox) {
      for (const [txt, dir, lab] of [['⟲', 1, 'Rotate view left'], ['⟳', -1, 'Rotate view right']]) {
        const bt = document.createElement('button');
        bt.type = 'button'; bt.textContent = txt; bt.setAttribute('aria-label', lab); bt.className = 'cv3-rot';
        bt.addEventListener('click', (ev) => { ev.stopPropagation(); tween = { a: cam.yaw, b: cam.yaw + dir * Math.PI / 4, s: performance.now() }; invalidate(); });
        zoomBox.appendChild(bt); rotBtns.push(bt);
      }
    }
    const onVis = () => { if (!document.hidden) invalidate(); };
    document.addEventListener('visibilitychange', onVis);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(wrap); else window.addEventListener('resize', resize);
    pollT = setInterval(() => { if (visible() && !raf && sync()) invalidate(); }, 1200);
    resize();
    invalidate();

    return {
      fit() { fitPending = true; invalidate(); },
      zoomBy(f) { cam.dist /= f; userMoved = true; clampCam(); invalidate(); },
      dirty() { invalidate(); },
      _cam: cam, // debugging aid
      screenOf(x, y) { if (!site) return [0, 0]; const [X, Z] = world(x + 0.5, y + 0.5); const p = new T.Vector3(X, 0, Z).project(camera); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; },
      dispose() {
        alive = false;
        if (raf) cancelAnimationFrame(raf); raf = 0;
        clearTimeout(animT); clearInterval(pollT);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVis);
        cv.removeEventListener('wheel', onWheel); cv.removeEventListener('contextmenu', noCtx);
        for (const b of rotBtns) b.remove();
        for (const [, v] of bcache) dropB(v);
        for (const [, g] of ghostCache) disposeTree(g);
        for (const k in L) clearGroup(L[k]);
        ground.geometry.dispose(); ocean.geometry.dispose(); skyMesh.geometry.dispose(); skyMesh.material.dispose();
        for (const k in G) G[k].dispose();
        for (const k in M) if (M[k] && M[k].isMaterial) M[k].dispose();
        for (const m of extraMats) m.dispose();
        for (const t of texs) t.dispose();
        if (albU.value) albU.value.dispose(); if (sdfU.value) sdfU.value.dispose(); if (ownTexData.tex) ownTexData.tex.dispose();
        if (envTex) envTex.dispose();
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
        cv.remove();
      },
    };
  }

  const V3 = { frames: 0 };
  function mount(wrap, api) {
    if (T && window.ApogeeSky) {
      try { const v = mount3D(wrap, api); if (v) return v; } catch (e) { if (window.console) console.warn('campus 3D view failed, using 2D map', e); }
    }
    return mount2D(wrap, api);
  }
  V3.mount = mount;
  V3._cache = CACHE; // debugging aid (per-site landscape data)
  window.APOGEE_CAMPUS_VIEW = V3;
})();
