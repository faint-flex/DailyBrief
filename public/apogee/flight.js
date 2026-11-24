// Launch and booster landing scenes.
(function () {
  'use strict';
  const D = window.APOGEE_DRAW;
  const $ = (id) => document.getElementById(id);
  const G = 9.81;

  let raf = 0;
  let resolveRun = null;
  let ctx, canvas, W, H, dpr;
  let keys = { left: false, right: false, burn: false };
  let phase = null;
  let parts = [];
  let skipReq = false;

  function size() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hud(items) {
    $('hud').innerHTML = items.map(([k, v]) => `<div><small>${k}</small>${v}</div>`).join('');
  }
  function banner(text, sub) {
    $('banner').innerHTML = text ? `${text}${sub ? `<small>${sub}</small>` : ''}` : '';
  }

  function puff(x, y, vx, vy, size, life, color) {
    parts.push({ x, y, vx, vy, size, life, max: life, color });
  }
  function stepParts(dt, shiftY, shiftX) {
    for (const p of parts) {
      p.x += p.vx * dt + (shiftX || 0); p.y += p.vy * dt + (shiftY || 0);
      p.vx *= 0.985; p.vy *= 0.985; p.life -= dt; p.size *= 1 + dt * 0.9;
    }
    parts = parts.filter((p) => p.life > 0 && p.y < H + 200 && p.y > -300);
  }
  function drawParts() {
    for (const p of parts) {
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color.replace('A', (a * (p.color.startsWith('rgba(255') ? 0.9 : 0.55)).toFixed(3));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
  }
  function explode(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 260;
      puff(x, y, Math.cos(a) * s, Math.sin(a) * s, 3 + Math.random() * 8, 0.6 + Math.random() * 1.4,
        Math.random() < 0.6 ? 'rgba(255,170,60,A)' : 'rgba(90,90,100,A)');
    }
    if (navigator.vibrate) try { navigator.vibrate([60, 40, 120]); } catch (e) { /* ignore */ }
  }

  // ---------------- Ascent ----------------
  function ascent(plan) {
    const design = plan.design;
    const geo = D.geometry(design, plan.techs);
    const n = design.stages.length;
    const burns = design.stages.map((_, i) => (i === 0 ? 9 : i === n - 1 ? 7 : 5));
    const COUNT = 3, SEP = 1.2;
    const starts = [];
    let t0 = COUNT;
    for (let i = 0; i < n; i++) { starts.push(t0); t0 += burns[i] + (i < n - 1 ? SEP : 0); }
    const total = t0;
    const orbitT = total;
    const targetAlt = { LEO: 210, SSO: 560, GTO: 250, LLO: 220, LUN: 220, MTO: 220, MARS: 220 }[plan.target] || 210;
    let failAt = null;
    if (plan.fail) failAt = starts[plan.fail.stage] + burns[plan.fail.stage] * plan.fail.t;
    const fitScale = (from) => {
      let h = geo.nose;
      for (let i = from; i < n; i++) h += geo.stages[i].h;
      return Math.min((H * 0.42) / h, (W * 0.2) / geo.d);
    };
    let scale = fitScale(0);
    let curStage = 0;
    const dropped = [];
    let fairingOff = false;
    let fairingBits = [];
    let dead = false, deadT = 0, done = false, doneT = 0;
    let t = 0;

    return {
      skip() {
        if (dead || done) { this.finished = true; return; }
        if (failAt != null) { t = failAt - 0.01; } else { t = orbitT - 0.01; }
      },
      step(dt) {
        t += dt;
        const p = Math.max(0, Math.min(1, (t - COUNT) / (total - COUNT)));
        const altKm = targetAlt * Math.pow(p, 1.5);
        const speed = (plan.target === 'GTO' || TARGET_DEEP(plan.target) ? 10.2 : 7.8) * Math.pow(p, 1.25) * 3600;
        const angle = Math.min(1, p * 1.7) * 1.05;
        // stage logic
        while (curStage < n - 1 && t >= starts[curStage + 1] - SEP && !dead) {
          dropped.push({ stage: curStage, x: this.bx || W / 2, y: this.by || H * 0.7, a: this.ang || 0, vx: -14, vy: 30, rot: 0, scale });
          curStage++;
          for (let k = 0; k < 14; k++) puff(W / 2 + (Math.random() - 0.5) * 20, H * 0.6, (Math.random() - 0.5) * 60, 40 + Math.random() * 40, 4, 1.2, 'rgba(230,230,240,A)');
        }
        scale += (fitScale(curStage) - scale) * Math.min(1, dt * 1.5);
        const burning = t >= starts[curStage] && t < starts[curStage] + burns[curStage] && !dead && !done;
        if (!fairingOff && altKm > 110 && !dead) {
          fairingOff = true;
          fairingBits = [{ x: -1, vx: -50, rot: 0 }, { x: 1, vx: 50, rot: 0 }];
        }
        // camera: rocket fixed at screen point after liftoff
        const liftM = t < COUNT ? 0 : 0.5 * 18 * Math.pow(t - COUNT, 2);
        const rise = liftM * scale * 0.6;
        let hs = fairingOff ? 0 : geo.nose;
        for (let i = curStage; i < n; i++) hs += geo.stages[i].h;
        hs *= scale;
        const ry0 = H - 60, rmin = H * 0.5 + hs / 2;
        const groundY = ry0 + Math.max(0, rise - (ry0 - rmin));
        const baseY = Math.max(rmin, ry0 - rise);
        const aNow = t < COUNT ? 0 : angle;
        const cx = W / 2, cy = baseY - hs / 2;
        const upx = Math.sin(aNow), upy = -Math.cos(aNow);
        const rx = cx - upx * hs / 2, ry = cy - upy * hs / 2;
        const topX = cx + upx * hs / 2, topY = cy + upy * hs / 2;

        if (failAt != null && t >= failAt && !dead) {
          dead = true; deadT = t;
          explode(cx, cy, 120);
          banner('VEHICLE LOST', plan.failText || 'Engine failure');
        }
        if (!dead && !done && t >= orbitT) {
          done = true; doneT = t;
          banner(plan.orbitText || 'ORBIT ✓', plan.orbitSub || '');
        }

        // exhaust
        if (burning) {
          const ca = Math.cos(angle), sa = Math.sin(angle);
          for (let k = 0; k < (altKm < 30 ? 4 : 1); k++) {
            puff(rx - sa * 4, ry + ca * 4, -sa * 120 + (Math.random() - 0.5) * 40, ca * 120 + 160 + Math.random() * 60,
              altKm < 20 ? 5 + Math.random() * 4 : 2, altKm < 25 ? 1.6 : 0.5,
              altKm < 15 ? 'rgba(235,235,240,A)' : 'rgba(255,180,90,A)');
          }
        }
        if (t < COUNT) {
          for (let k = 0; k < 2; k++) puff(rx + (Math.random() - 0.5) * 40, groundY - 4, (Math.random() - 0.5) * 80, -10 - Math.random() * 20, 6, 1.4, 'rgba(240,240,245,A)');
        }
        const scroll = t >= COUNT ? Math.min(400, 30 + p * 900) * dt : 0;
        stepParts(dt, altKm < 70 ? scroll : 0, 0);

        this.bx = rx; this.by = ry; this.ang = aNow;
        // ---- draw ----
        const [top, bottom] = D.skyColor(altKm);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, top); g.addColorStop(1, bottom);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const starA = Math.max(0, Math.min(1, (altKm - 25) / 40));
        if (starA > 0) {
          for (const [x, y, s, a] of D.starfield(W, H)) { ctx.fillStyle = `rgba(255,255,255,${starA * (0.3 + a * 0.7)})`; ctx.fillRect(x, y, s, s); }
        }
        // Earth limb as we climb
        if (altKm > 35) {
          const k = Math.min(1, (altKm - 35) / 120);
          const R = W * 3;
          const cy = H + R - H * 0.22 * k;
          const eg = ctx.createRadialGradient(W * 0.3, cy, R * 0.9, W * 0.3, cy, R * 1.02);
          eg.addColorStop(0, '#1b4f8f'); eg.addColorStop(0.96, '#3d8bd8'); eg.addColorStop(0.985, 'rgba(140,200,255,.8)'); eg.addColorStop(1, 'rgba(140,200,255,0)');
          ctx.fillStyle = eg;
          ctx.beginPath(); ctx.arc(W * 0.3, cy, R * 1.02, 0, Math.PI * 2); ctx.fill();
        }
        // clouds layer while low
        if (altKm < 14) {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          const off = (t * 60) % 400;
          for (let i = -1; i < 6; i++) {
            const cy = (i * 170 + (t >= COUNT ? liftM * scale * 0.08 : 0)) % (H + 200) - 100;
            ctx.beginPath(); ctx.ellipse((i * 137 + off) % (W + 200) - 100, cy, 90, 18, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
        // ground
        if (groundY < H + 40) {
          ctx.fillStyle = '#16233b'; ctx.fillRect(0, groundY, W, H);
          ctx.fillStyle = '#0f1a2d'; ctx.fillRect(0, groundY + 10, W, H);
          // tower
          const towerH = (geo.total + 8) * fitScale(0);
          ctx.fillStyle = '#20283f';
          ctx.fillRect(rx - geo.d * fitScale(0) / 2 - 22, groundY - towerH, 14, towerH);
        }
        drawParts();
        // dropped stages fall away
        for (const s of dropped) {
          s.vy += 30 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += 0.5 * dt;
          D.drawRocket(ctx, design, geo, { from: s.stage, to: s.stage, noNose: true, x: s.x, y: s.y, scale: s.scale, angle: s.a + s.rot });
        }
        if (!dead) {
          const vac = curStage > 0;
          D.drawRocket(ctx, design, geo, {
            from: curStage, x: rx, y: ry, scale, angle: aNow,
            flame: burning ? (vac ? 0.8 : 1) : 0, vac, noNose: fairingOff,
            fins: curStage === 0 && plan.recovery !== 'expend', legs: curStage === 0 && plan.recovery !== 'expend' && plan.recovery !== 'catch' ? false : null,
          });
          if (fairingOff) {
            for (const f of fairingBits) {
              f.x += f.vx * dt; f.rot += f.x > 0 ? 1.2 * dt : -1.2 * dt;
              ctx.save(); ctx.translate(topX + f.x, topY + Math.abs(f.x) * 0.4); ctx.rotate(f.rot);
              ctx.fillStyle = '#e8e6df'; ctx.fillRect(-3, -14, 6, 28); ctx.restore();
            }
          }
          if (done) drawPayload(topX, topY, angle, t - doneT, plan);
        }
        if (t < COUNT) banner(`T−${Math.ceil(COUNT - t)}`, plan.title);
        else if (!dead && !done && t < COUNT + 2) banner('LIFTOFF', plan.title);
        else if (!dead && !done && t < starts[1] + 1.5 && t > starts[1] - SEP && n > 1) banner('STAGE SEPARATION', '');
        else if (!dead && !done) banner('');

        const T = Math.max(0, t - COUNT) * 22;
        hud([
          ['T+', `${String(Math.floor(T / 60)).padStart(2, '0')}:${String(Math.floor(T % 60)).padStart(2, '0')}`],
          ['ALT', `${altKm.toFixed(1)} km`],
          ['SPEED', `${Math.round(speed).toLocaleString()} km/h`],
          ['STAGE', `${curStage + 1}/${n}`],
        ]);
        if (dead && t - deadT > 3) this.finished = true;
        if (done && t - doneT > 3.2) this.finished = true;
        this.result = { dead, stage1Ok: !dead || (failAt != null && plan.fail.stage > 0) };
      },
    };
  }

  function TARGET_DEEP(t) { return ['LLO', 'LUN', 'MTO', 'MARS'].includes(t); }

  function drawPayload(tx, ty, angle, dt, plan) {
    const sep = Math.min(40, dt * 18);
    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(angle);
    ctx.translate(0, -8 - sep);
    if (plan.crew) {
      ctx.fillStyle = '#f1efe8';
      ctx.beginPath(); ctx.moveTo(-9, 10); ctx.lineTo(9, 10); ctx.lineTo(5, -6); ctx.lineTo(-5, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1d2230'; ctx.fillRect(-9, 8, 18, 3);
    } else {
      ctx.fillStyle = '#d8b25a'; ctx.fillRect(-5, -6, 10, 12);
      const open = Math.min(1, dt / 1.5);
      ctx.fillStyle = '#2f5fb0';
      ctx.fillRect(-5 - 22 * open, -3, 22 * open, 6);
      ctx.fillRect(5, -3, 22 * open, 6);
    }
    ctx.restore();
  }

  // ---------------- Landing ----------------
  function landing(plan) {
    const design = plan.design;
    const geo = D.geometry(design, plan.techs);
    const mode = plan.recovery; // rtls | barge | catch
    const manual = plan.landing === 'manual';
    const padHalf = mode === 'catch' ? 7 : mode === 'barge' ? 20 : 17;
    const A = 3 * G;
    const b = {
      x: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 100),
      y: 1700, vx: (Math.random() - 0.5) * 24, vy: -185, th: (Math.random() - 0.5) * 0.15, fuel: 15, burning: false,
    };
    const failMode = plan.autoLand ? null : (Math.random() < 0.5 ? 'hard' : 'miss');
    const aimX = failMode === 'miss' ? (padHalf + 14) * (b.x > 0 ? 1 : -1) : 0;
    let t = 0, outcome = null, outT = 0, reason = '';
    let ppm = 0.3, camX = 0;
    const st1H = geo.stages[0].h;
    let pilotShown = false;
    if (manual) {
      $('pilot').hidden = false; pilotShown = true;
      $('flight-skip').hidden = true;
      banner('YOU HAVE CONTROL', 'Hold Space (or ↑) to burn, ← → to steer. Touch down slower than 8 m/s on the target.');
    } else {
      banner('BOOSTER RETURN', { rtls: 'Heading back to the landing pad', barge: 'Aiming for the ocean barge', catch: 'Lining up with the tower arms' }[mode]);
    }

    function control() {
      if (manual) {
        const turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        return { burn: keys.burn, turn };
      }
      const aT = failMode === 'hard' ? 3.4 * G : 1.6 * G;
      const burn = b.vy < -(Math.sqrt(2 * aT * Math.max(0, b.y)) + 2);
      const want = Math.max(-0.35, Math.min(0.35, (aimX - b.x) * 0.03 - b.vx * 0.15));
      const turn = Math.max(-1, Math.min(1, (want - b.th) * 6));
      return { burn, turn };
    }

    return {
      manual,
      skip() {
        if (manual) return;
        this.finished = true;
        this.result = { landed: !!plan.autoLand };
      },
      step(dt) {
        t += dt;
        if (!outcome) {
          const c = control();
          b.th += c.turn * 0.9 * dt;
          b.th = Math.max(-0.6, Math.min(0.6, b.th));
          b.burning = c.burn && b.fuel > 0;
          let ax = 0, ay = -G;
          if (b.burning) {
            ax += A * Math.sin(b.th); ay += A * Math.cos(b.th);
            b.fuel -= dt;
          } else {
            ax += Math.sin(b.th) * Math.abs(b.vy) * 0.12;
          }
          ay += (G / (195 * 195)) * b.vy * b.vy * (b.vy < 0 ? 1 : -1);
          ax -= b.vx * 0.04;
          if (!manual && b.y < 200) { const k = Math.min(1, dt * 2.5); b.x += (aimX - b.x) * k; b.vx *= 1 - k; b.th *= 1 - k; }
          b.vx += ax * dt; b.vy += ay * dt;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.y <= 0) {
            b.y = 0;
            const onPad = Math.abs(b.x) <= padHalf;
            const soft = Math.abs(b.vy) <= 8 && Math.abs(b.vx) <= 5 && Math.abs(b.th) <= 0.26;
            if (onPad && soft) { outcome = 'landed'; b.vy = 0; b.vx = 0; }
            else {
              outcome = 'crash';
              reason = !onPad ? (mode === 'barge' ? 'Missed the barge' : mode === 'catch' ? 'Missed the tower arms' : 'Missed the pad')
                : Math.abs(b.vy) > 8 ? `Hit at ${Math.round(Math.abs(b.vy))} m/s` : Math.abs(b.th) > 0.26 ? 'Came in tilted and tipped over' : 'Too much sideways speed';
            }
            outT = t; b.burning = false;
            if (outcome === 'landed') banner(mode === 'catch' ? 'CAUGHT! 🦾' : 'THE BOOSTER HAS LANDED', 'It can fly again.');
            else { banner('RAPID UNSCHEDULED DISASSEMBLY', reason); }
            if (pilotShown) { $('pilot').hidden = true; $('flight-skip').hidden = false; }
          }
        }
        // camera
        const wantPpm = (H * 0.68) / Math.max(90, b.y + 70);
        ppm += (wantPpm - ppm) * Math.min(1, dt * 2.5);
        camX += (b.x * 0.6 - camX) * Math.min(1, dt * 3);
        const groundY = H * 0.8;
        const sx = (x) => W / 2 + (x - camX) * ppm;
        const sy = (y) => groundY - y * ppm;
        const vis = Math.max(ppm, (H * 0.16) / st1H);

        // particles in screen space; spawn exhaust
        if (b.burning && !outcome) {
          const bx = sx(b.x), by = sy(b.y);
          for (let k = 0; k < 3; k++) puff(bx - Math.sin(b.th) * 4, by + 4, -Math.sin(b.th) * 200 + (Math.random() - 0.5) * 50, 200 + Math.random() * 80, 4 + Math.random() * 3, 0.5, 'rgba(255,190,100,A)');
          if (b.y < 60) for (let k = 0; k < 3; k++) puff(bx + (Math.random() - 0.5) * 30, groundY - 4, (Math.random() - 0.5) * 260, -Math.random() * 30, 6, 1.2, 'rgba(230,230,235,A)');
        }
        stepParts(dt, 0, 0);

        // draw sky
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#0d1838'); g.addColorStop(0.7, '#3a4f86'); g.addColorStop(1, '#f19a5b');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        for (const [x, y, s, a] of D.starfield(W, H)) if (y < H * 0.45) { ctx.fillStyle = `rgba(255,255,255,${0.2 + a * 0.4})`; ctx.fillRect(x, y, s, s); }
        // ground or sea
        if (mode === 'barge') {
          ctx.fillStyle = '#0d2a48'; ctx.fillRect(0, groundY + 6 * Math.max(1, ppm * 0.3), W, H);
          ctx.strokeStyle = 'rgba(160,200,255,.25)'; ctx.lineWidth = 1;
          for (let i = 0; i < 6; i++) {
            const yy = groundY + 12 + i * 14;
            ctx.beginPath();
            for (let x = 0; x <= W; x += 20) ctx.lineTo(x, yy + Math.sin(x * 0.05 + t * 2 + i) * 2);
            ctx.stroke();
          }
          // barge
          const bw = 52 * ppm, bh = Math.max(4, 6 * ppm);
          ctx.fillStyle = '#2a2f3c'; ctx.fillRect(sx(-26), groundY, bw, bh);
          ctx.fillStyle = '#3b4252'; ctx.fillRect(sx(-26), groundY - 1, bw, 2);
          drawTarget(sx(0), groundY, padHalf * ppm);
        } else {
          ctx.fillStyle = '#1a2238'; ctx.fillRect(0, groundY, W, H);
          ctx.fillStyle = '#232d48'; ctx.fillRect(0, groundY, W, 3);
          if (mode === 'catch') {
            // tower with arms at "ground" level; tower continues below
            const tx = sx(-padHalf - 6);
            const tw = Math.max(6, 9 * ppm);
            ctx.fillStyle = '#2a3147';
            ctx.fillRect(tx - tw, groundY - 40 * ppm, tw, H);
            ctx.fillStyle = '#ff7a1a';
            ctx.fillRect(tx, groundY - 2, (padHalf * 2 + 10) * ppm * 0.5 + 2, Math.max(3, 2 * ppm));
            ctx.fillRect(tx, groundY + Math.max(4, 2 * ppm), (padHalf * 2 + 10) * ppm * 0.5 + 2, Math.max(3, 2 * ppm));
            ctx.fillStyle = 'rgba(255,122,26,.18)';
            ctx.fillRect(sx(-padHalf), groundY - 3, padHalf * 2 * ppm, 6);
          } else {
            ctx.fillStyle = '#4a5268';
            ctx.beginPath(); ctx.ellipse(sx(0), groundY + 1, (padHalf + 5) * ppm, Math.max(2, 3 * ppm), 0, 0, Math.PI * 2); ctx.fill();
            drawTarget(sx(0), groundY, padHalf * ppm);
          }
        }
        drawParts();
        // booster
        if (outcome !== 'crash' || t - outT < 0.05) {
          D.drawRocket(ctx, design, geo, {
            from: 0, to: 0, noNose: true, x: sx(b.x), y: sy(b.y) - 1.4 * vis, scale: vis, angle: b.th,
            flame: b.burning ? 0.9 : 0, fins: true, legs: mode === 'catch' ? null : b.y < 220,
          });
        }
        if (outcome === 'crash' && t - outT < 0.05) explode(sx(b.x), sy(b.y) - 10, 140);

        hud([
          ['ALT', `${Math.max(0, b.y).toFixed(0)} m`],
          ['V/S', `<span style="color:${Math.abs(b.vy) <= 8 || b.y > 400 ? '#e9ecf4' : '#ff8d99'}">${b.vy.toFixed(0)} m/s</span>`],
          ['H/S', `${b.vx.toFixed(1)} m/s`],
          ['FUEL', `${Math.max(0, b.fuel / 15 * 100).toFixed(0)}%`],
          ['TARGET', `${(b.x).toFixed(0)} m`],
        ]);
        if (manual && !outcome && t > 3.5 && t < 4) banner('');
        if (!manual && !outcome && t > 3) banner('');
        if (outcome && t - outT > 3) {
          this.finished = true;
          this.result = { landed: outcome === 'landed' };
        }
        if (t > 90 && !outcome) { this.finished = true; this.result = { landed: false }; }
      },
    };
  }

  function drawTarget(x, y, half) {
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y - 1, Math.max(4, half), Math.max(1.5, half * 0.08), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillRect(x - Math.max(3, half * 0.4), y - 2, Math.max(6, half * 0.8), 2);
  }

  // ---------------- Runner ----------------
  function loop(prev) {
    raf = requestAnimationFrame((now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      if (skipReq && phase.skip) { skipReq = false; phase.skip(); }
      if (!phase.finished) phase.step(dt);
      if (phase.finished) { const r = phase.result; next(r); return; }
      loop(now);
    });
  }

  let queue = [];
  let results = {};
  function next(r) {
    Object.assign(results, r || {});
    const make = queue.shift();
    if (!make) { finish(); return; }
    const ph = make(results);
    if (!ph) { next(); return; }
    phase = ph; parts = [];
    loop(performance.now());
  }

  function finish() {
    cancelAnimationFrame(raf);
    $('pilot').hidden = true;
    $('flight-skip').hidden = true;
    const r = resolveRun; resolveRun = null;
    if (r) r(results);
  }

  function run(plan) {
    canvas = $('flight-canvas');
    ctx = canvas.getContext('2d');
    $('flight').hidden = false;
    $('result').hidden = true;
    $('pilot').hidden = true;
    $('flight-skip').hidden = false;
    banner(''); hud([]);
    size();
    results = {};
    queue = [
      () => ascent(plan),
      (res) => (plan.recovery !== 'expend' && res.stage1Ok ? landing(plan) : null),
    ];
    return new Promise((resolve) => { resolveRun = resolve; next(); });
  }

  function close() { $('flight').hidden = true; $('result').hidden = true; banner(''); }

  function bindPilot() {
    const hold = (id, key) => {
      const el = $(id);
      const on = (e) => { e.preventDefault(); keys[key] = true; el.classList.add('held'); };
      const off = (e) => { e.preventDefault(); keys[key] = false; el.classList.remove('held'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('p-left', 'left'); hold('p-right', 'right'); hold('p-burn', 'burn');
    const map = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ' ': 'burn', ArrowUp: 'burn', w: 'burn' };
    window.addEventListener('keydown', (e) => { if (map[e.key] && !$('flight').hidden) { keys[map[e.key]] = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (map[e.key]) keys[map[e.key]] = false; });
    $('flight-skip').addEventListener('click', () => { skipReq = true; });
    window.addEventListener('resize', () => { if (!$('flight').hidden && canvas) size(); });
  }
  document.addEventListener('DOMContentLoaded', bindPilot);

  window.APOGEE_FLIGHT = { run, close };
})();
