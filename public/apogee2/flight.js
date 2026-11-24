// Launch and booster landing scenes, rendered in 3D (window.APOGEE_3D) with broadcast-style cameras.
// The game logic (timeline, landing physics, results) is unchanged from the 2D version; only the drawing is new.
// Physics runs in 2D (x across, y up, metres) and is mapped into the 3D scene.
(function () {
  'use strict';
  const D = window.APOGEE_DRAW;
  const T = window.THREE;
  const $ = (id) => document.getElementById(id);
  const G = 9.81;
  const A3 = () => window.APOGEE_3D;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clamp01 = (v) => clamp(v, 0, 1);
  const smooth = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
  const V = (x, y, z) => new T.Vector3(x || 0, y || 0, z || 0);
  const DEG = 180 / Math.PI;

  let raf = 0;
  let resolveRun = null;
  let canvas = null, R = null, gl = false, fallbackCam = null;
  let ov = null, octx = null, fadeEl = null, W = 1, H = 1, dpr = 1;
  let fade = 0;
  const keys = { left: false, right: false, burn: false };
  let phase = null;
  let skipReq = false;

  // ---------------- shared helpers ----------------
  function safe(fn) { try { return fn(); } catch (e) { if (!safe.warned) { safe.warned = true; console.warn('flight:', e); } return undefined; } }

  function cam() {
    if (R && R.camera) return R.camera;
    if (!fallbackCam) fallbackCam = new T.PerspectiveCamera(45, 1, 0.5, 3e6);
    return fallbackCam;
  }

  function setup() {
    canvas = $('flight-canvas');
    if (!ov) {
      ov = document.createElement('canvas');
      ov.className = 'flight-ov';
      ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.insertAdjacentElement('afterend', ov);
      octx = ov.getContext('2d');
      fadeEl = document.createElement('div');
      fadeEl.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none';
      ov.insertAdjacentElement('afterend', fadeEl);
    }
    if (!R) {
      const A = A3();
      if (A && T) {
        try { R = A.init(canvas); gl = !!(R && R.renderer); } catch (e) { console.warn('flight: WebGL unavailable', e); R = null; gl = false; }
      }
    }
    size();
  }

  function size() {
    if (!canvas) return;
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (gl) safe(() => A3().resize());
    else { const c = cam(); c.aspect = W / H; c.updateProjectionMatrix(); }
  }

  // Point the camera. fov in degrees.
  function setCam(pos, look, fov, near, up) {
    const c = cam();
    c.position.copy(pos);
    if (up) c.up.copy(up); else c.up.set(0, 1, 0);
    c.lookAt(look);
    c.fov = fov; c.near = near || 0.5; c.far = 3e6;
    c.aspect = W / H;
    c.updateProjectionMatrix();
    if (R) {
      const px = R.renderer ? R.renderer.getPixelRatio() : 1;
      R.pointScale = (H * px) / (2 * Math.tan((fov / DEG) / 2));
    }
  }

  function render(scene, alt) {
    if (!gl || !scene) return;
    safe(() => A3().render(scene, { alt: alt || 0 }));
  }

  // Particles (APOGEE_FX3D) are optional: every call is guarded.
  function makeFx(scene) {
    const F = window.APOGEE_FX3D;
    if (!gl || !F || !F.create) return null;
    const fx = safe(() => F.create(scene));
    if (!fx) return null;
    const call = (name, args) => { if (typeof fx[name] === 'function') safe(() => fx[name].apply(fx, args)); };
    return {
      exhaust: (...a) => call('exhaust', a), landingBurn: (...a) => call('landingBurn', a), explode: (...a) => call('explode', a),
      vent: (...a) => call('vent', a), sonic: (...a) => call('sonic', a), step: (...a) => call('step', a),
      clear: () => call('clear', []), dispose: () => call('dispose', []), has: (name) => typeof fx[name] === 'function',
    };
  }

  // Simple fireball used when the particle module is missing or has no explode().
  function flashes() {
    const list = [];
    return {
      add(scene, pos, sizeM) {
        if (!gl) return;
        const A = A3();
        const tex = safe(() => A.softTex([[0, 'rgba(255,250,235,1)'], [0.25, 'rgba(255,190,90,.9)'], [0.6, 'rgba(200,80,30,.35)'], [1, 'rgba(60,40,30,0)']]));
        const sp = new T.Sprite(new T.SpriteMaterial({ map: tex || null, color: 0xffffff, blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
        sp.position.copy(pos); sp.scale.setScalar(sizeM * 0.2);
        scene.add(sp);
        const light = new T.PointLight(0xffa050, 6e5, 0, 2); light.position.copy(pos); scene.add(light);
        list.push({ sp, light, t: 0, size: sizeM, scene });
      },
      step(dt) {
        for (const f of list) {
          f.t += dt;
          const k = f.t / 2.2;
          f.sp.scale.setScalar(f.size * (0.2 + 1.4 * Math.sqrt(Math.min(1, k))));
          f.sp.material.opacity = Math.max(0, 1 - k);
          f.light.intensity = 6e5 * Math.max(0, 1 - k * 2);
          if (k >= 1 && f.sp.parent) { f.scene.remove(f.sp); f.scene.remove(f.light); f.sp.material.dispose(); }
        }
      },
    };
  }

  function cut() { fade = 1; }
  function stepFade(dt) {
    fade = Math.max(0, fade - dt / 0.5);
    if (fadeEl) fadeEl.style.opacity = (fade * fade * 0.95).toFixed(3);
  }

  let hudHtml = '', bannerHtml = null;
  function hud(items) {
    const h = items.map(([k, v]) => `<div><small>${k}</small>${v}</div>`).join('');
    if (h !== hudHtml) { hudHtml = h; $('hud').innerHTML = h; }
  }
  function banner(text, sub, low) {
    const h = text ? `${text}${sub ? `<small>${sub}</small>` : ''}` : '';
    if (h !== bannerHtml) { bannerHtml = h; $('banner').innerHTML = h; }
    $('banner').classList.toggle('low', !!low); // playtest #23: countdown sits in the lower third, clear of the rocket
  }
  function buzz(p) { if (navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* ignore */ } }

  // Screen projection for overlays.
  const _pv = T ? new T.Vector3() : null;
  function project(v) {
    _pv.copy(v).project(cam());
    return { x: (_pv.x + 1) / 2 * W, y: (1 - _pv.y) / 2 * H, ok: _pv.z < 1 && _pv.z > -1 };
  }

  function camLabel(text) {
    if (!text || W < 600) return;
    octx.save();
    octx.font = '600 11px -apple-system, Segoe UI, Arial, sans-serif';
    octx.textBaseline = 'bottom';
    const x = 14, y = H - 16;
    const w = octx.measureText(text).width;
    octx.fillStyle = 'rgba(0,0,0,.45)'; octx.fillRect(x - 6, y - 16, w + 22, 20);
    octx.fillStyle = '#ff4d4d'; octx.beginPath(); octx.arc(x + 1, y - 6, 3, 0, 7); octx.fill();
    octx.fillStyle = 'rgba(235,240,250,.9)'; octx.fillText(text, x + 10, y);
    octx.restore();
  }

  function minYOf(root, skip) {
    const box = new T.Box3(), tmp = new T.Box3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      for (let p = o; p; p = p.parent) if (p === skip) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    });
    return box.isEmpty() ? 0 : box.min.y - root.position.y;
  }

  // ---------------- Ascent ----------------
  function ascent(plan) {
    const A = A3();
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
    const recov = plan.recovery !== 'expend';
    let curStage = 0;
    let fairingOff = false;
    let dead = false, deadT = 0, done = false, doneT = 0;
    let t = 0;

    const progress = (tt) => clamp01((tt - COUNT) / (total - COUNT));
    const altAt = (tt) => { const p = progress(tt); return targetAlt * p * p; };
    const angleAt = (tt) => Math.min(1, progress(tt) * 1.7) * 1.05;

    // camera schedule (seconds after T-0)
    const Lr = geo.total;
    const TPAD = 3.6;
    const a0 = Math.max(10, (2 * (Lr + 16)) / (TPAD * TPAD));
    const onboardFrom = n > 1 ? starts[1] - SEP - 0.6 : Infinity;
    const chaseFrom = n > 1 ? starts[1] + 0.9 : COUNT + TPAD + 5;
    const maxqFrom = COUNT + TPAD + 0.3, maxqTo = COUNT + TPAD + 2.1;

    // ---- 3D setup ----
    let vis = false, rk = null, scene = null, site = null, fx = null, where = 'ground', padTop = 0;
    const fl = flashes();
    const dropped = []; // {obj, v, spin, stage, vent}
    let payloadFree = null;
    // Halo batch: a stack of flat-packed sats that separates into a "train"
    const isHalo = plan.payloadKind === 'halo';
    let haloFree = null, haloPending = false;
    let shot = null, shotT = 0, deadShot = null;
    const deadPos = V();
    const track = { ct: V(-3600, 30, 9800), jit: V() };
    if (gl) {
      try {
        rk = A.buildRocket(design, plan.techs, { fins: recov, legs: recov && plan.recovery !== 'catch', crew: !!plan.crew, halo: isHalo ? Math.max(1, plan.satCount | 0 || 1) : 0 });
        scene = new T.Scene();
        A.lights(scene, V());
        site = A.launchSite(scene, geo) || {};
        padTop = site.padTop || 0;
        rk.root.position.y = padTop;
        scene.add(rk.root);
        if (rk.stages[0] && rk.stages[0].legs) A.setLegs(rk.stages[0], 0);
        if (rk.stages[0] && A.setFins) A.setFins(rk.stages[0], 0);
        fx = makeFx(scene);
        vis = true;
      } catch (e) { console.warn('flight: 3D ascent setup failed', e); vis = false; }
    }

    const axisOf = (ang) => V(Math.sin(ang), Math.cos(ang), 0);
    // Rocket attitude shown on screen: upright on the pad, then pitches over smoothly.
    const visAngle = (tt) => angleAt(tt) * clamp01((tt - COUNT - 2.4) / 4);
    function stackLen(from) {
      let h = fairingOff ? 0 : geo.nose;
      for (let i = from; i < n; i++) h += geo.stages[i].h;
      return h;
    }
    function groundPos(tt) {
      const tau = Math.max(0, tt - COUNT);
      if (tau < TPAD) return V(0, padTop + 0.5 * a0 * tau * tau, 0);
      const altM = altAt(tt) * 1000;
      return V(altM * 0.7 * progress(tt), padTop + altM, 0);
    }

    function toSpace() {
      if (!vis || where === 'space') return;
      if (fx) fx.dispose();
      scene.remove(rk.root);
      safe(() => A.disposeScene(scene));
      dropped.length = 0;
      scene = new T.Scene();
      A.lights(scene, V());
      scene.traverse((o) => { if (o.isHemisphereLight) o.intensity *= 0.35; });
      rk.root.position.set(0, 0, 0);
      scene.add(rk.root);
      fx = makeFx(scene);
      where = 'space';
    }

    function onSeparate(i) {
      if (!vis) return;
      const st = rk.stages[i - (rk.stages.length - n)] || rk.stages[i];
      if (!st) return;
      A.setPlume(st, 0, 0, t);
      scene.attach(st.group);
      const ax = axisOf(visAngle(t));
      dropped.push({ obj: st.group, v: ax.clone().multiplyScalar(-3), spin: 0.25 + Math.random() * 0.15, vent: 1.6, st, fins: i === 0 && recov ? 0 : null });
    }
    function onFairing() {
      if (!vis || !rk.fairing) return;
      rk.root.updateMatrixWorld(true);
      const side = V(1, 0, 0).transformDirection(rk.root.matrixWorld);
      rk.fairing.forEach((h, k) => {
        scene.attach(h);
        const s = k === 0 ? 1 : -1;
        dropped.push({ obj: h, v: side.clone().multiplyScalar(4 * s), hinge: -0.7 * s, fair: true });
      });
      if (rk.payload) rk.payload.visible = true;
    }
    function onDeploy() {
      if (!vis || !rk.payload) return;
      if (rk.payload.userData.halo) { haloPending = true; rk.payload.visible = true; return; }
      rk.payload.visible = true;
      scene.attach(rk.payload);
      payloadFree = { obj: rk.payload, v: axisOf(visAngle(t)).multiplyScalar(1.4), t: 0 };
    }
    // called from draw() once the rocket is posed for this frame, so the sats keep their place when re-parented
    function releaseHalo() {
      haloPending = false;
      const hs = rk.payload.userData.halo;
      {
        // release the whole stack at once; small velocity differences string the sats out into a line
        const ax = axisOf(visAngle(t));
        const side = V(-ax.y, ax.x, 0);
        const n = hs.sats.length;
        haloFree = { t: 0, sats: [], rods: hs.rods, span: 0 };
        hs.sats.forEach((g, i) => {
          scene.attach(g);
          const k = n - 1 - i; // top of the stack leaves first and fastest
          const v = ax.clone().multiplyScalar(0.5 + k * (12 / Math.max(4, n)))
            .addScaledVector(side, (Math.random() - 0.5) * 0.35).add(V(0, 0, (Math.random() - 0.5) * 0.35));
          haloFree.sats.push({ g, v, spin: V((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06), unfold: 1.2 + Math.random() * 1.4 + k * 0.03 });
        });
      }
    }
    function onExplode() {
      buzz([60, 40, 120]);
      if (!vis) return;
      rk.root.updateMatrixWorld(true);
      const p = rk.stages[Math.min(curStage, rk.stages.length - 1)].group.getWorldPosition(V());
      p.addScaledVector(axisOf(visAngle(t)), stackLen(curStage) * 0.4);
      deadPos.copy(p);
      const sz = geo.d * 8 + 30;
      if (fx && fx.has('explode')) fx.explode(p, sz, where === 'ground' ? padTop : p.y - altAt(t) * 1000); else fl.add(scene, p, sz * 1.5);
      if (where === 'space' && fx && fx.has('explode')) fl.add(scene, p, sz);
      rk.root.visible = false;
      for (const st of rk.stages) A.setPlume(st, 0, 0, t);
    }

    function draw(fdt) {
      if (!vis) { octx.clearRect(0, 0, W, H); return; }
      const tau = t - COUNT;
      let want;
      if (tau < TPAD) want = 'pad';
      else if (t < onboardFrom && t < chaseFrom) want = 'track';
      else if (t < chaseFrom) want = 'onboard';
      else want = 'chase';
      if (dead) want = deadShot || want;
      if (want !== shot) {
        if (shot) cut();
        if (want === 'onboard' || want === 'chase') toSpace();
        shot = want; shotT = 0;
      }
      shotT += fdt;
      const ang = visAngle(t);
      const ax = axisOf(ang);
      const altKm = altAt(t);
      // place the rocket
      if (where === 'ground') rk.root.position.copy(groundPos(t));
      else rk.root.position.set(0, 0, 0);
      rk.root.rotation.set(0, 0, -ang);
      rk.root.updateMatrixWorld(true);
      if (haloPending && !dead) releaseHalo();
      // engines
      const burning = !dead && !done && t >= starts[curStage] && t < starts[curStage] + burns[curStage];
      const ignite = !dead && curStage === 0 && t >= COUNT - 0.7 && t < COUNT;
      const plumeX = where === 'ground' ? clamp01((rk.root.position.y / 1000) / 45) : 1;
      rk.stages.forEach((st, i) => {
        const si = i + (n - rk.stages.length);
        let pw = 0;
        if (!dead && si === curStage && (burning || ignite)) pw = ignite ? 0.4 + 0.6 * clamp01((t - COUNT + 0.7) / 0.7) : 1;
        if (st.group.parent !== rk.root) pw = 0;
        A.setPlume(st, pw, plumeX, t);
        if (pw > 0 && fx) {
          const noz = st.group.getWorldPosition(V()).addScaledVector(ax, -st.bh);
          const dir = ax.clone().negate();
          const ak = where === 'ground' ? (rk.root.position.y - padTop) / 1000 : altKm;
          if (where === 'ground') fx.exhaust(noz, dir, pw, ak, rk.r || st.r, fdt, padTop);
          else fx.exhaust(noz, dir, pw, ak, rk.r || st.r, fdt);
        }
      });
      if (t < COUNT + TPAD && A.prepareEarth) safe(() => A.prepareEarth());
      // pre-launch venting
      if (fx && t < COUNT && !dead) {
        const r = geo.d / 2;
        for (let i = 0; i < rk.stages.length; i++) {
          const g = rk.stages[i].group;
          const p = V(r * 1.02, Math.min(geo.stages[i].h - 1, geo.stages[i].h * 0.9), 0);
          fx.vent(g.localToWorld(p), V(1, -0.15, 0.2).normalize(), fdt);
        }
      }
      // max-q vapour
      if (fx && !dead && t > maxqFrom && t < maxqTo) {
        const c = rk.root.localToWorld(V(0, stackLen(0) * 0.62, 0));
        fx.sonic(c, geo.d * 0.9);
      }
      // dropped stages, fairings, payload
      for (const d of dropped) {
        d.obj.position.addScaledVector(d.v, fdt);
        const upperBurn = burning && curStage > 0;
        if (upperBurn) d.v.addScaledVector(ax, -6 * fdt);
        if (d.fair) { d.obj.rotateZ(d.hinge * fdt); d.v.addScaledVector(ax, -2 * fdt); }
        else d.obj.rotateZ(d.spin * fdt * 0.6), d.obj.rotateX(d.spin * fdt * 0.3);
        if (d.fins != null && d.fins < 1 && A.setFins) { d.fins = Math.min(1, d.fins + fdt / 1.5); safe(() => A.setFins(d.st, smooth(0, 1, d.fins))); }
        if (d.vent > 0 && fx) {
          d.vent -= fdt;
          const top = d.obj.localToWorld(V(0, d.st ? d.st.h : 0, 0));
          fx.vent(top, ax, fdt);
        }
      }
      if (haloFree) {
        const hf = haloFree;
        hf.t += fdt;
        const c0 = V();
        for (const s of hf.sats) {
          s.g.position.addScaledVector(s.v, fdt);
          s.g.rotation.x += s.spin.x * fdt; s.g.rotation.y += s.spin.y * fdt; s.g.rotation.z += s.spin.z * fdt;
          const u = clamp01((hf.t - s.unfold) / 2.2);
          const w = s.g.userData.wing;
          if (w) { w.visible = u > 0; w.scale.x = Math.max(0.001, smooth(0, 1, u)); }
          if (s.g.userData.folded) s.g.userData.folded.visible = u < 0.35;
          c0.add(s.g.position);
        }
        // retention rods swing open like petals
        hf.rods.forEach((rod, i) => { const o = smooth(0, 1, hf.t / 1.2) * 0.55; rod.rotation.set((i & 1 ? -1 : 1) * o, 0, (i < 2 ? -1 : 1) * o); });
        if (hf.sats.length) {
          c0.multiplyScalar(1 / hf.sats.length);
          hf.center = c0;
          hf.span = hf.sats[0].g.position.distanceTo(hf.sats[hf.sats.length - 1].g.position);
        }
      }
      if (payloadFree) {
        payloadFree.t += fdt;
        payloadFree.obj.position.addScaledVector(payloadFree.v, fdt);
        payloadFree.obj.rotateY(0.15 * fdt);
        const w = payloadFree.obj.userData.wings;
        if (w) w.scale.x = Math.min(1, 0.05 + payloadFree.t / 1.6);
      }
      fl.step(fdt);
      // ---- cameras ----
      const c = cam();
      let lbl = '', rAlt = 0;
      if (shot === 'pad') {
        lbl = 'PAD CAM 2';
        const cp = V(Lr * 0.55 + 12, padTop + 1.2, Lr * 1.05 + 30 + Math.max(0, COUNT - t) * 2.5);
        const rp = dead ? deadPos : rk.root.localToWorld(V(0, Lr * 0.45, 0));
        const look = rp.clone();
        look.y = Math.max(look.y, padTop + Lr * 0.42);
        const shake = burning && tau < 3 ? 0.25 * (1 - tau / 3) : 0;
        look.x += (Math.random() - 0.5) * shake; look.y += (Math.random() - 0.5) * shake;
        setCam(cp, look, 52, 0.5);
        rAlt = 0;
      } else if (shot === 'track') {
        lbl = 'TRACKING CAMERA · 18 KM';
        const rp = dead ? deadPos : rk.root.localToWorld(V(0, stackLen(curStage) * 0.5, 0));
        const dist = rp.distanceTo(track.ct);
        const zoom = dead ? 6 : 1.9;
        const fov = clamp(2 * Math.atan((Lr * zoom) / dist) * DEG, 0.05, 40);
        // operator follows with a little drift; the long lens shakes at max-q
        const half = dist * Math.tan(fov / DEG / 2);
        const q = !dead && t > maxqFrom && t < maxqTo ? Math.sin(Math.PI * (t - maxqFrom) / (maxqTo - maxqFrom)) : 0;
        const s = 0.025 + q * 0.09;
        track.jit.set(Math.sin(t * 1.3) * 0.4 + (Math.random() - 0.5) * q * 0.9, Math.cos(t * 0.9) * 0.3 + (Math.random() - 0.5) * q * 0.9, 0).multiplyScalar(half * s);
        setCam(track.ct, rp.clone().add(track.jit), fov, Math.max(1, dist * 0.3));
        rAlt = 0;
      } else if (shot === 'onboard') {
        lbl = 'ONBOARD · STAGE 2';
        const r = geo.d / 2;
        const up = rk.stages.length > 1 ? rk.stages[1].group.position.y : 0;
        const vib = burning ? 0.015 : 0.004;
        const cp = rk.root.localToWorld(V((Math.random() - 0.5) * vib, up + 2.2, r + 1.25));
        const look = rk.root.localToWorld(V(0, up - 70, r + 0.2));
        const upv = V(0, 0, 1);
        setCam(cp, look, W < H ? 88 : 70, 0.1, upv);
        rAlt = altKm;
      } else {
        lbl = done ? 'CHASE CAM · PAYLOAD' : 'CHASE CAM · UPPER STAGE';
        let L = Math.max(14, stackLen(curStage));
        if (haloFree) L = Math.max(L, haloFree.span * 0.55);
        const base = rk.stages[Math.min(rk.stages.length - 1, curStage - (n - rk.stages.length))].group.getWorldPosition(V());
        let focus = base.clone().addScaledVector(ax, L * 0.5);
        if (dead) focus = deadPos.clone();
        else if (payloadFree) focus.lerp(payloadFree.obj.getWorldPosition(V()), Math.min(0.6, payloadFree.t * 0.25));
        else if (haloFree && haloFree.center) focus.lerp(haloFree.center, Math.min(0.85, haloFree.t * 0.3));
        const perp = V(-Math.cos(ang), Math.sin(ang), 0);
        const orbit = 0.55 + shotT * 0.035;
        const d = L * (2.4 - Math.min(0.5, shotT * 0.04));
        const cp = focus.clone().addScaledVector(ax, -d * 0.75).addScaledVector(perp, d * 0.55)
          .add(V(0, 0, d * Math.cos(orbit) * 0.9)).addScaledVector(ax, d * Math.sin(orbit) * 0.2);
        setCam(cp, focus, 42, 0.3);
        rAlt = altKm;
      }
      if (fx) fx.step(fdt, c);
      render(scene, rAlt);
      octx.clearRect(0, 0, W, H);
      camLabel(lbl);
    }

    return {
      skip() {
        if (dead || done) { this.finished = true; return; }
        if (failAt != null) { t = failAt - 0.01; } else { t = orbitT - 0.01; }
      },
      step(dt) {
        t += dt;
        const p = progress(t);
        const altKm = altAt(t);
        const speed = (plan.target === 'GTO' || TARGET_DEEP(plan.target) ? 10.2 : 7.8) * Math.pow(p, 1.25) * 3600;
        // stage logic
        while (curStage < n - 1 && t >= starts[curStage + 1] - SEP && !dead) {
          onSeparate(curStage);
          curStage++;
        }
        if (!fairingOff && altKm > 110 && !dead) { fairingOff = true; onFairing(); }
        if (failAt != null && t >= failAt && !dead) {
          dead = true; deadT = t; deadShot = shot;
          onExplode();
          banner('VEHICLE LOST', plan.failText || 'Engine failure');
        }
        if (!dead && !done && t >= orbitT) {
          done = true; doneT = t;
          onDeploy();
          banner(plan.orbitText || 'ORBIT ✓', plan.orbitSub || '');
        }
        if (t < COUNT) banner(`T−${Math.ceil(COUNT - t)}`, plan.title, true);
        else if (!dead && !done && t < COUNT + 2) banner('LIFTOFF', plan.title, true);
        else if (!dead && !done && t > maxqFrom && t < maxqFrom + 1.6) banner('MAX-Q', 'Peak aerodynamic pressure');
        else if (!dead && !done && t < starts[1] + 1.5 && t > starts[1] - SEP && n > 1) banner('STAGE SEPARATION', '');
        else if (!dead && !done) banner('');

        const Tc = Math.max(0, t - COUNT) * 22;
        hud([
          ['T+', `${String(Math.floor(Tc / 60)).padStart(2, '0')}:${String(Math.floor(Tc % 60)).padStart(2, '0')}`],
          ['ALT', `${altKm.toFixed(1)} km`],
          ['SPEED', `${Math.round(speed).toLocaleString()} km/h`],
          ['STAGE', `${curStage + 1}/${n}`],
        ]);
        if (dead && t - deadT > 3) this.finished = true;
        if (done && t - doneT > (isHalo ? 6.5 : 3.2)) this.finished = true;
        this.result = { dead, stage1Ok: !dead || (failAt != null && plan.fail.stage > 0) };
      },
      draw,
      dispose() {
        if (fx) fx.dispose();
        if (vis && scene) safe(() => A.disposeScene(scene));
        scene = null; vis = false;
      },
    };
  }

  function TARGET_DEEP(t) { return ['LLO', 'LUN', 'MTO', 'MARS'].includes(t); }

  // ---------------- Landing ----------------
  function landing(plan) {
    const A = A3();
    const design = plan.design;
    const geo = D.geometry(design, plan.techs);
    const mode = plan.recovery; // rtls | barge | catch
    const manual = plan.landing === 'manual';
    const steer = plan.landing === 'steer';
    const moveBoat = steer && mode === 'barge';
    const hands = manual || steer;
    let padX = 0, padV = 0;
    const padHalf = mode === 'catch' ? 7 : mode === 'barge' ? 20 : 17;
    const A_ = 3 * G;
    const b = {
      x: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 100),
      y: 1700, vx: (Math.random() - 0.5) * 24, vy: -185, th: (Math.random() - 0.5) * 0.15, fuel: 15, burning: false,
    };
    let pin = false;
    const failMode = steer || plan.autoLand ? null : (Math.random() < 0.5 ? 'hard' : 'miss');
    if (steer) { b.x = (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 70); b.vx = (Math.random() - 0.5) * 16; }
    const aimX = failMode === 'miss' ? (padHalf + 14) * (b.x > 0 ? 1 : -1) : 0;
    let t = 0, outcome = null, outT = 0, reason = '';
    const CATCH_HOVER = 10; // metres between the caught booster's engines and the launch mount
    const st1H = geo.stages[0].h;
    let pilotShown = false;
    if (hands) {
      $('pilot').hidden = false; pilotShown = true;
      $('p-burn').hidden = steer;
      const keysEl = document.querySelector('#pilot .keys');
      if (keysEl) keysEl.innerHTML = steer ? `Keyboard: <b>←</b> <b>→</b> to ${moveBoat ? 'move the barge' : 'steer'}` : 'Keyboard: hold <b>Space</b> or <b>↑</b> to burn, <b>←</b> <b>→</b> to steer';
      $('flight-skip').hidden = true;
      if (manual) banner('YOU HAVE CONTROL', 'Hold Space (or ↑) to burn, ← → to steer. Touch down slower than 8 m/s on the target.');
      else if (moveBoat) banner('MOVE THE BARGE', 'The booster handles the burn. Use ← → to slide the barge under it.');
      else banner('STEER IT IN', 'The booster handles the burn. Use ← → to steer it onto the target.');
    } else {
      banner('BOOSTER RETURN', { rtls: 'Heading back to the landing pad', barge: 'Aiming for the ocean barge', catch: 'Lining up with the tower arms' }[mode]);
    }

    function control() {
      const input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (manual) return { burn: keys.burn, turn: input };
      if (steer) {
        const burn = b.vy < -(Math.sqrt(2 * 1.6 * G * Math.max(0, b.y)) + 2);
        if (moveBoat) {
          // Booster just keeps itself upright; the player moves the barge.
          return { burn, turn: Math.max(-1, Math.min(1, -b.th * 4 - b.vx * 0.02)), boat: input };
        }
        // Player slides it left/right; it holds position when you let go.
        return { burn, turn: 0, slide: input };
      }
      const aT = failMode === 'hard' ? 3.4 * G : 1.6 * G;
      const burn = b.vy < -(Math.sqrt(2 * aT * Math.max(0, b.y)) + 2);
      const want = Math.max(-0.35, Math.min(0.35, (aimX - b.x) * 0.03 - b.vx * 0.15));
      const turn = Math.max(-1, Math.min(1, (want - b.th) * 6));
      return { burn, turn };
    }

    // ---- 3D setup ----
    let vis = false, scene = null, bk = null, st = null, fx = null, model = null, sea = null;
    let surfaceY = 0, touchY = 0, flameY = 0, armY = 0, towerX = -20;
    const fl = flashes();
    let arms = null;
    let legK = 0, exploded = false, ventT = 0;
    if (gl) {
      try {
        scene = new T.Scene();
        A.lights(scene, V());
        bk = A.buildRocket(design, plan.techs, { from: 0, to: 0, noNose: true, fins: true, legs: mode !== 'catch', soot: true });
        st = bk.stages[0];
        let foot = st.bh;
        if (st.legs) { A.setLegs(st, 1); foot = Math.max(0.5, -minYOf(bk.root, st.plume)); A.setLegs(st, 0); }
        if (mode === 'barge') {
          model = A.bargeModel();
          scene.add(model.group);
          if (!model.group.userData.sea) { sea = A.ocean(400000); sea.position.y = 0; scene.add(sea); }
          surfaceY = model.deckY != null ? model.deckY : 6;
          touchY = surfaceY + foot; flameY = surfaceY;
        } else if (mode === 'catch') {
          const mountTop = 10;
          touchY = mountTop + CATCH_HOVER + st.bh;
          armY = touchY + st1H - 3;
          model = A.catchModel(geo, armY);
          scene.add(model.group);
          surfaceY = model.mountTop != null ? model.mountTop : mountTop;
          flameY = surfaceY;
          towerX = model.towerX != null ? model.towerX : towerX;
          arms = model.arms || null;
        } else {
          model = A.padModel();
          scene.add(model.group);
          surfaceY = model.deckY != null ? model.deckY : 0.8;
          touchY = surfaceY + foot; flameY = surfaceY;
        }
        scene.add(bk.root);
        fx = makeFx(scene);
        vis = true;
      } catch (e) { console.warn('flight: 3D landing setup failed', e); vis = false; }
    }
    // Catch arms: the model's convention is rotation.y = s*0.55 open, 0 closed around the booster.
    if (vis && arms) for (const a of arms) { a.open = a.s * 0.55; a.closed = 0; a.pivot.rotation.y = a.open; }

    // ---- cameras ----
    const camS = { pos: V(), look: V(), init: false, cx: 0, cy: 0, d: 0 };
    let shot = null, shotT = 0;
    function sideCam(dt, base) {
      // Side-on view, x across the screen: keeps booster and target readable for steering.
      const asp = W / H;
      // playtest #12: portrait phones have little width, so widen the view and allow pulling back further.
      const narrow = Math.max(1, 0.7 / asp);
      const fov = 40 * Math.min(1.35, Math.sqrt(narrow)), tanH = Math.tan(fov / DEG / 2);
      const top = base.y + st1H + 8;
      const bottom = (mode === 'catch' ? 0 : surfaceY) - 3;
      const xMin = Math.min(b.x - 10, padX - padHalf - 10, mode === 'catch' ? towerX - 8 : Infinity);
      const xMax = Math.max(b.x + 10, padX + padHalf + 10);
      // Ground sits ~30% up from the bottom (clear of the touch controls); booster top stays in view.
      const Wc = xMax - xMin;
      const need = Math.max(st1H * 2.4, top - bottom) / 1.02;
      const dFit = Math.max(need / tanH, (Wc / 2) / (tanH * asp)) * 1.08;
      const dMax = st1H / (0.13 * 2 * tanH) * narrow; // keep the booster at least ~13% of screen height (less when portrait)
      const d = top - bottom > 450 ? Math.min(dFit, dMax) : dFit; // low down, always show the target
      const hv = d * tanH, hw = hv * asp;
      const cy = Math.max(bottom + hv * 0.4, top - hv * 0.62);
      let cx = (xMin + xMax) / 2;
      cx = clamp(cx, b.x - hw * 0.7, b.x + hw * 0.7); // booster stays ≥15% from the screen edge
      const k = camS.init ? 1 - Math.exp(-dt * 3) : 1;
      // playtest #12: smooth the aim point relative to the booster, so a fast fall or drift never leaves it off screen.
      camS.cx += (cx - b.x - camS.cx) * k; camS.cy += (cy - base.y - camS.cy) * k; camS.d += (d - camS.d) * k;
      camS.init = true;
      const ax = b.x + camS.cx, ay = base.y + camS.cy;
      const yaw = 0.1;
      const pos = V(ax + camS.d * Math.sin(yaw), ay + camS.d * 0.1, camS.d * Math.cos(yaw));
      setCam(pos, V(ax, ay, 0), fov, Math.max(0.5, camS.d * 0.02));
    }
    // Aim between two points so both are in frame (vertical fov in degrees).
    function frame2(cp, p1, p2, minFov, maxFov, margin) {
      const a1 = p1.clone().sub(cp).normalize(), a2 = p2.clone().sub(cp).normalize();
      const sep = Math.acos(clamp(a1.dot(a2), -1, 1)) * DEG;
      const look = cp.clone().add(a1.add(a2).normalize());
      setCam(cp, look, clamp(sep * 1.2 + margin, minFov, maxFov), 0.5);
    }
    function wideCam(base) {
      const pad = V(padX, surfaceY, 0);
      const top = base.clone().add(V(Math.sin(b.th) * st1H, Math.cos(b.th) * st1H, 0));
      const dist0 = 1000;
      const cp = V(padX + dist0 * Math.sin(0.6), surfaceY + (mode === 'barge' ? 12 : 22), dist0 * Math.cos(0.6));
      frame2(cp, pad, top, 5, 80, 4);
    }
    function closeCam(base) {
      const push = 1 - Math.min(0.15, shotT * 0.03);
      const top = base.clone().add(V(Math.sin(b.th) * st1H, Math.cos(b.th) * st1H, 0));
      if (mode === 'catch') {
        const dd = (st1H * 1.5 + 30) * push;
        const cp = V(dd * 0.55, 6 + st1H * 0.2, dd);
        frame2(cp, V(base.x, surfaceY, 0), top.add(V(0, 6, 0)), 40, 80, 8);
      } else {
        const dd = (st1H * 1.7 + 24) * push;
        const cp = V(padX - dd * 0.45, surfaceY + 4.5, dd * 0.9);
        frame2(cp, V(base.x, surfaceY, 0), top.add(V(0, 4, 0)), 36, 80, 8);
      }
    }

    function draw(fdt) {
      if (!vis) { octx.clearRect(0, 0, W, H); drawBar(); return; }
      const base = V(b.x, touchY + Math.max(0, b.y), 0);
      const deck = mode === 'barge' && model && model.group.userData.deck;
      if (deck && outcome === 'landed') {
        // ride the bobbing deck once down
        if (bk.root.parent !== deck) { bk.root.position.copy(base); bk.root.rotation.set(0, 0, -b.th); model.group.updateMatrixWorld(true); deck.attach(bk.root); }
      } else {
        bk.root.position.copy(base);
        bk.root.rotation.set(0, 0, -b.th);
      }
      bk.root.updateMatrixWorld(true);
      const ax = V(Math.sin(b.th), Math.cos(b.th), 0);
      // legs
      if (st.legs) {
        const want = b.y < 220 || outcome === 'landed' ? 1 : 0;
        legK = clamp01(legK + Math.sign(want - legK) * fdt / 1.5);
        A.setLegs(st, smooth(0, 1, legK));
      }
      // engine and particles
      const on = b.burning && !outcome;
      A.setPlume(st, on ? 0.9 : 0, 0, t);
      if (on && fx) {
        const noz = base.clone().addScaledVector(ax, -st.bh);
        fx.landingBurn(noz, ax.clone().negate(), 0.9, flameY, fdt, { radius: bk.r || st.r, water: mode === 'barge' });
      }
      if (outcome === 'landed' && fx && t - outT < 2.5) {
        ventT += fdt;
        fx.vent(base.clone().addScaledVector(ax, st1H * 0.9), V(1, 0.1, 0.3).normalize(), fdt);
      }
      if (outcome === 'crash' && !exploded && t - outT >= 0.05) {
        exploded = true;
        const p = base.clone().addScaledVector(ax, st1H * 0.25);
        if (fx && fx.has('explode')) fx.explode(p, st1H * 0.9, mode === 'catch' ? 0 : surfaceY); else fl.add(scene, p, st1H * 1.6);
        bk.root.visible = false;
      }
      fl.step(fdt);
      // site animation
      if (mode === 'barge' && model) {
        model.group.position.x = padX;
        if (sea && sea.userData.tick) sea.userData.tick(t);
      }
      if (arms) {
        const closed = outcome === 'landed' ? smooth(0, 1, (t - outT) * 2) : 0;
        for (const a of arms) {
          a.pivot.rotation.y = a.open + (a.closed - a.open) * closed;
        }
      }
      // camera
      let want;
      if (hands) want = outcome ? 'close' : 'side';
      else want = outcome || b.y < 110 ? 'close' : 'wide';
      if (want !== shot) { if (shot) cut(); shot = want; shotT = 0; }
      shotT += fdt;
      let lbl = '';
      if (shot === 'side') { sideCam(fdt, base); lbl = 'LANDING CAM'; }
      else if (shot === 'wide') { wideCam(base); lbl = mode === 'barge' ? 'SUPPORT SHIP CAMERA' : 'LONG RANGE TRACKING'; }
      else { closeCam(base); lbl = mode === 'barge' ? 'DECK CAM' : mode === 'catch' ? 'TOWER CAM' : 'PAD CAM'; }
      if (fx) fx.step(fdt, cam());
      render(scene, 0);
      octx.clearRect(0, 0, W, H);
      if (hands && !outcome) { drawMarkers(base); drawBar(); }
      camLabel(lbl);
    }

    // On-screen guides: shapes and words, not colour alone.
    function drawMarkers(base) {
      const lvl = mode === 'catch' ? touchY : surfaceY;
      const on = Math.abs(b.x - padX) <= padHalf;
      const L = project(V(padX - padHalf, lvl, 0)), Rr = project(V(padX + padHalf, lvl, 0)), C = project(V(padX, lvl, 0));
      const g = octx;
      g.save();
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (L.ok && Rr.ok) {
        // target brackets [  ] with a crosshair
        const hgt = 14;
        g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 5;
        const br = () => {
          g.beginPath();
          g.moveTo(L.x + 8, L.y - hgt); g.lineTo(L.x, L.y - hgt); g.lineTo(L.x, L.y + 4); g.lineTo(L.x + 8, L.y + 4);
          g.moveTo(Rr.x - 8, Rr.y - hgt); g.lineTo(Rr.x, Rr.y - hgt); g.lineTo(Rr.x, Rr.y + 4); g.lineTo(Rr.x - 8, Rr.y + 4);
          g.moveTo(C.x - 6, C.y - 5); g.lineTo(C.x + 6, C.y - 5); g.moveTo(C.x, C.y - 11); g.lineTo(C.x, C.y + 1);
          g.stroke();
        };
        br(); g.strokeStyle = '#ffffff'; g.lineWidth = 2; br();
        label(g, mode === 'catch' ? 'CATCH ZONE' : 'TARGET', C.x, Math.min(L.y, Rr.y) - hgt - 6, '#ffffff');
      }
      // booster: dashed drop line to the target level, ending in a down-pointing triangle
      const top = project(base);
      const foot = project(V(b.x, lvl, 0));
      if (top.ok && foot.ok) {
        const col = on ? '#3ddc97' : '#ffb347';
        g.setLineDash(on ? [] : [6, 6]);
        g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(top.x, top.y + 4); g.lineTo(foot.x, foot.y - 16); g.stroke();
        g.strokeStyle = col; g.lineWidth = 2; g.stroke();
        g.setLineDash([]);
        g.beginPath(); g.moveTo(foot.x, foot.y - 2); g.lineTo(foot.x - 9, foot.y - 18); g.lineTo(foot.x + 9, foot.y - 18); g.closePath();
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
        if (on) { g.fillStyle = col; g.fill(); } else { g.lineWidth = 2.5; g.strokeStyle = col; g.stroke(); }
        // box around the booster when it is small on screen
        const tip = project(base.clone().add(V(Math.sin(b.th) * st1H, Math.cos(b.th) * st1H, 0)));
        const hpx = Math.abs(top.y - tip.y);
        if (hpx < 90) {
          const cx = (top.x + tip.x) / 2, cy = (top.y + tip.y) / 2;
          const hh = Math.max(16, hpx / 2 + 8), hw = Math.max(10, hh * 0.45);
          corners(g, cx - hw, cy - hh, hw * 2, hh * 2, '#ffffff');
          label(g, 'BOOSTER', cx, cy - hh - 6, '#ffffff');
        }
      }
      g.restore();
    }

    // A level strip near the bottom: target bracket in the middle, booster triangle where it is.
    function drawBar() {
      if (!hands || outcome) return;
      const g = octx;
      const bw = Math.min(W - 40, 460), x0 = (W - bw) / 2, y = W < 600 ? 128 : 100;
      const span = 160;
      const toX = (m) => x0 + bw / 2 + clamp(m / span, -1, 1) * (bw / 2 - 12);
      const dx = b.x - padX;
      const on = Math.abs(dx) <= padHalf;
      g.save();
      g.fillStyle = 'rgba(5,8,16,.55)';
      roundRect(g, x0 - 8, y - 30, bw + 16, 52, 10); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0 + 6, y); g.lineTo(x0 + bw - 6, y); g.stroke();
      for (let m = -150; m <= 150; m += 50) { g.beginPath(); g.moveTo(toX(m), y - 3); g.lineTo(toX(m), y + 3); g.stroke(); }
      // target bracket
      const l = toX(-padHalf), r = toX(padHalf);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(l + 5, y - 10); g.lineTo(l, y - 10); g.lineTo(l, y + 8); g.lineTo(l + 5, y + 8);
      g.moveTo(r - 5, y - 10); g.lineTo(r, y - 10); g.lineTo(r, y + 8); g.lineTo(r - 5, y + 8); g.stroke();
      g.font = '700 10px -apple-system, Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffffff';
      g.fillText(mode === 'barge' ? 'BARGE' : mode === 'catch' ? 'ARMS' : 'PAD', (l + r) / 2, y + 19);
      // booster triangle
      const bx = toX(dx);
      const col = on ? '#3ddc97' : '#ffb347';
      g.beginPath(); g.moveTo(bx, y - 1); g.lineTo(bx - 8, y - 15); g.lineTo(bx + 8, y - 15); g.closePath();
      if (on) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 2.5; g.stroke(); }
      g.textAlign = Math.abs(dx) > span * 0.75 ? (dx > 0 ? 'right' : 'left') : 'center';
      g.fillStyle = col;
      const hint = on ? '✓ ON TARGET' : moveBoat ? (dx > 0 ? 'BOOSTER · move barge ▶' : '◀ move barge · BOOSTER') : (dx > 0 ? '◀ steer left' : 'steer right ▶');
      g.fillText(hint, bx, y - 19);
      if (Math.abs(dx) > span) { g.fillText(dx > 0 ? '▶▶' : '◀◀', bx + (dx > 0 ? 0 : 0), y + 19); }
      g.restore();
    }

    return {
      manual,
      skip() {
        if (hands) return;
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
          if (moveBoat) {
            padV += (c.boat || 0) * 9 * dt;
            if (!c.boat) padV *= 1 - Math.min(1, dt * 1.2);
            padV = Math.max(-16, Math.min(16, padV));
            padX += padV * dt;
          }
          if (steer) b.vx += (Math.sin(t * 0.8) * 2.6 + Math.sin(t * 2.3 + 1) * 1.6) * dt; // wind gusts
          if (steer && c.slide) b.fuel -= dt * 0.35; // side thrusters use landing fuel
          let ax = 0, ay = -G;
          if (b.burning) {
            ax += A_ * Math.sin(b.th); ay += A_ * Math.cos(b.th);
            b.fuel -= dt;
          } else {
            ax += Math.sin(b.th) * Math.abs(b.vy) * 0.12;
          }
          ay += (G / (195 * 195)) * b.vy * b.vy * (b.vy < 0 ? 1 : -1);
          ax -= b.vx * 0.04;
          if (!hands && b.y < 200) { const k = Math.min(1, dt * 2.5); b.x += (aimX - b.x) * k; b.vx *= 1 - k; b.th *= 1 - k; }
          b.vx += ax * dt; b.vy += ay * dt;
          if (steer && !moveBoat) {
            const want = (c.slide || 0) * 14;
            const k = Math.min(1, dt * 1.6);
            b.vx += (want - b.vx) * k;
            b.th = Math.max(-0.2, Math.min(0.2, (want - b.vx) * 0.02 + b.vx * 0.006));
          }
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.y <= 0) {
            b.y = 0;
            const onPad = Math.abs(b.x - padX) <= padHalf;
            const soft = Math.abs(b.vy) <= 8 && Math.abs(b.vx - (moveBoat ? padV : 0)) <= 5 && Math.abs(b.th) <= 0.26;
            if (onPad && soft) { outcome = 'landed'; b.vy = 0; b.vx = 0; pin = manual && Math.abs(b.x - padX) <= padHalf * 0.35; }
            else {
              outcome = 'crash';
              reason = !onPad ? (mode === 'barge' ? 'Missed the barge' : mode === 'catch' ? 'Missed the tower arms' : 'Missed the pad')
                : Math.abs(b.vy) > 8 ? `Hit at ${Math.round(Math.abs(b.vy))} m/s` : Math.abs(b.th) > 0.26 ? 'Came in tilted and tipped over' : 'Too much sideways speed';
              buzz([60, 40, 120]);
            }
            outT = t; b.burning = false;
            if (outcome === 'landed') banner(mode === 'catch' ? 'CAUGHT! 🦾' : 'THE BOOSTER HAS LANDED', pin ? '🎯 Pinpoint! Refurbishing costs half.' : 'It can fly again.');
            else { banner('RAPID UNSCHEDULED DISASSEMBLY', reason); }
            if (pilotShown) { $('pilot').hidden = true; $('p-burn').hidden = false; $('flight-skip').hidden = false; }
          }
        }
        hud([
          ['ALT', `${Math.max(0, b.y).toFixed(0)} m`],
          ['V/S', `<span style="color:${!manual || Math.abs(b.vy) <= 8 || b.y > 400 ? '#e9ecf4' : '#ff8d99'}">${b.vy.toFixed(0)} m/s</span>`],
          ['H/S', `${b.vx.toFixed(1)} m/s`],
          ['FUEL', `${Math.max(0, b.fuel / 15 * 100).toFixed(0)}%`],
          ['TARGET', `${(b.x - padX).toFixed(0)} m`],
        ]);
        if (hands && !outcome && t > 3.5 && t < 4) banner('');
        if (!hands && !outcome && t > 3) banner('');
        if (outcome && t - outT > 3) {
          this.finished = true;
          this.result = { landed: outcome === 'landed', pinpoint: pin };
        }
        if (t > 90 && !outcome) { this.finished = true; this.result = { landed: false }; }
      },
      draw,
      dispose() {
        if (fx) fx.dispose();
        if (vis && scene) safe(() => A.disposeScene(scene));
        scene = null; vis = false;
      },
    };
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function corners(g, x, y, w, h, col) {
    const k = Math.min(10, w / 3, h / 3);
    const path = () => {
      g.beginPath();
      g.moveTo(x, y + k); g.lineTo(x, y); g.lineTo(x + k, y);
      g.moveTo(x + w - k, y); g.lineTo(x + w, y); g.lineTo(x + w, y + k);
      g.moveTo(x + w, y + h - k); g.lineTo(x + w, y + h); g.lineTo(x + w - k, y + h);
      g.moveTo(x + k, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - k);
      g.stroke();
    };
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.55)'; path();
    g.lineWidth = 2; g.strokeStyle = col; path();
  }
  function label(g, text, x, y, col) {
    g.font = '700 11px -apple-system, Segoe UI, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(text, x, y);
    g.fillStyle = col; g.fillText(text, x, y);
  }

  // ---------------- Runner ----------------
  // Same timing as the 2D version: one step per frame, at most 0.05 s (slow devices run in slow motion).
  function loop(prev) {
    raf = requestAnimationFrame((now) => {
      const real = Math.min(0.25, Math.max(0, (now - prev) / 1000));
      const fdt = Math.min(0.05, real);
      if (skipReq && phase.skip) { skipReq = false; phase.skip(); }
      for (let rem = real; rem > 1e-4 && !phase.finished; rem -= 0.05) phase.step(Math.min(0.05, rem));
      if (phase.finished) { const r = phase.result; next(r); return; }
      stepFade(fdt);
      try { phase.draw(fdt); } catch (e) { if (!loop.warned) { loop.warned = true; console.warn('flight draw:', e); } }
      loop(now);
    });
  }

  let queue = [];
  let results = {};
  function next(r) {
    Object.assign(results, r || {});
    if (phase && phase.dispose) safe(() => phase.dispose());
    const make = queue.shift();
    if (!make) { phase = null; finish(); return; }
    const ph = make(results);
    if (!ph) { next(); return; }
    phase = ph;
    loop(performance.now());
  }

  function finish() {
    cancelAnimationFrame(raf);
    $('pilot').hidden = true;
    $('flight-skip').hidden = true;
    if (octx) octx.clearRect(0, 0, W, H);
    const r = resolveRun; resolveRun = null;
    if (r) r(results);
  }

  function run(plan) {
    $('flight').hidden = false;
    $('result').hidden = true;
    $('pilot').hidden = true;
    $('flight-skip').hidden = false;
    hudHtml = ''; bannerHtml = null;
    banner(''); hud([]);
    setup();
    fade = 1;
    // Build the Earth now (it is used once the rocket is high) so staging does not stutter.
    if (gl) safe(() => { const A = A3(); if (A.prepareEarth) A.prepareEarth(); else if (A.buildEarth) A.buildEarth(); });
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
    const onResize = () => { if (!$('flight').hidden && canvas) size(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  }
  document.addEventListener('DOMContentLoaded', bindPilot);

  window.APOGEE_FLIGHT = { run, close };
})();
