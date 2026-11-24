// APOGEE campus map: light 2.5D isometric canvas (window.APOGEE_CAMPUS_VIEW). Pan with drag, zoom with wheel or pinch.
(function () {
  'use strict';
  const TW = 64, TH = 32;
  const GROUND = { S: '#1f6090', L: '#2b72a0', B: '#e2cf98', c: '#97a463', g: '#6ea95a', t: '#5f9b50', d: '#d9b072', r: '#a3826a', w: '#5f8c70', R: '#4a4f5a', C: '#5a6172' };
  const BCOL = { pad: '#b8bcc5', factory: '#d5dae4', office: '#88a6d2', housing: '#dba97c', lab: '#e9edf4', test: '#9aa1aa', mc: '#7d8ca9', tank: '#eceff3',
    lz: '#bcc0c8', port: '#a9afb9', tower: '#c7cbd2', solar: '#3a4f78', visitor: '#8fd3ca', satfab: '#f2f5f9', ground: '#e1e5ec' };

  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(c, f) {
    const [r, g, b] = hex(c);
    const m = (v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }
  const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  function mount(wrap, api) {
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
      fitted = site.id;
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
      return { pad: 50, factory: 28, office: 40, housing: 14, lab: 22, test: 52, mc: 18, tank: 22, lz: 6, port: 30, tower: 78, solar: 8, visitor: 16, satfab: 26, ground: 22 }[b.type] || 20;
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
      if (fitted !== site.id) fit(site);
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

  window.APOGEE_CAMPUS_VIEW = { mount };
})();
