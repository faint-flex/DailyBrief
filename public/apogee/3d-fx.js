// 3D fx module: smoke, steam, fire particles and explosions (loaded after world3d.js).
// Exposes window.APOGEE_FX3D.create(scene) -> fx with exhaust / landingBurn / explode / vent / sonic / step / clear / dispose.
// Particles are camera-facing instanced quads (no point-size limits), lit as soft spheres by R.sunDir
// (bright sun side, darker underside), sorted back-to-front for smoke; fire and sparks are additive.
// Units: metres, seconds, m/s. Scene y is up.
(function () {
  'use strict';
  const T = window.THREE;
  const A = window.APOGEE_3D;
  if (!T || !A) return;

  // ---------- tiny utils ----------
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const small = () => !!(A.R && A.R.small);
  const _v = new T.Vector3(), _w = new T.Vector3(), _u = new T.Vector3(), _p = new T.Vector3();
  function randUnit(out) {
    const z = rr(-1, 1), a = rr(0, Math.PI * 2), s = Math.sqrt(1 - z * z);
    return out.set(s * Math.cos(a), z, s * Math.sin(a));
  }
  function perpBasis(d, a, b) { // two unit vectors perpendicular to d
    a.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0).cross(d).normalize();
    b.crossVectors(d, a).normalize();
  }

  // ---------- textures (generated once, shared) ----------
  function vnoise(sd) {
    let s = sd >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const N = 32, V = new Float32Array(N * N); for (let i = 0; i < V.length; i++) V[i] = r();
    const f = (t) => t * t * (3 - 2 * t);
    const at = (x, y) => V[((y % N + N) % N) * N + ((x % N + N) % N)];
    const n2 = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), u = f(x - xi), v = f(y - yi);
      const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u, b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u; return a + (b - a) * v; };
    return (x, y) => n2(x, y) * 0.55 + n2(x * 2.1 + 7, y * 2.1 + 3) * 0.28 + n2(x * 4.3 + 1, y * 4.3 + 9) * 0.17;
  }
  let TEX = null;
  function textures() {
    if (TEX) return TEX;
    // smoke atlas: 2x2 cells of 128px of billowy puffs.
    // RG = normal map of the puff surface (lit per pixel by the sun), B = thickness, A = density.
    const W = 256, C = 128, data = new Uint8Array(W * W * 4);
    const H = new Float32Array(C * C);
    for (let cell = 0; cell < 4; cell++) {
      let s = 777 + cell * 31; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const blobs = [];
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, d = Math.pow(r(), 0.8) * 0.27;
        const rad = 0.07 + r() * 0.13 * (1 - d * 1.5);
        blobs.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, rad, 0.6 + r() * 0.5]);
      }
      const nz = vnoise(99 + cell * 13);
      const ox = (cell % 2) * C, oy = Math.floor(cell / 2) * C;
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C, v = (y + 0.5) / C;
        let d = 0;
        for (const b of blobs) {
          const dx = u - b[0], dy = v - b[1], q = 1 - (dx * dx + dy * dy) / (b[2] * b[2]);
          if (q > 0) d = Math.max(d, b[3] * Math.sqrt(q) + d * 0.25); // union of spheres -> cauliflower
        }
        const n = nz(u * 9, v * 9);
        const rad = Math.hypot(u - 0.5, v - 0.5) * 2;
        const mask = clamp(1 - (rad - 0.55) / 0.4, 0, 1);
        H[y * C + x] = d * (0.75 + 0.5 * n) * mask;
      }
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const h = H[y * C + x];
        const hx = H[y * C + Math.min(C - 1, x + 1)] - H[y * C + Math.max(0, x - 1)];
        const hy = H[Math.min(C - 1, y + 1) * C + x] - H[Math.max(0, y - 1) * C + x];
        let nx = -hx * 6.5, ny = -hy * 6.5, nzz = 1; const l = Math.hypot(nx, ny, nzz); nx /= l; ny /= l;
        const t = clamp((h - 0.03) / 0.65, 0, 1), al = t * t * (3 - 2 * t);
        const i = ((oy + y) * W + ox + x) * 4;
        data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255;
        data[i + 2] = clamp(h / 1.1, 0, 1) * 255; data[i + 3] = al * 255;
      }
    }
    const smoke = new T.DataTexture(data, W, W, T.RGBAFormat);
    smoke.generateMipmaps = true; smoke.minFilter = T.LinearMipmapLinearFilter; smoke.magFilter = T.LinearFilter;
    smoke.needsUpdate = true;
    // fire: soft hot core (same 2x2 atlas layout so one shader works; all cells slightly different)
    const fd = new Uint8Array(W * W * 4);
    for (let cell = 0; cell < 4; cell++) {
      const nz = vnoise(5 + cell * 7); const ox = (cell % 2) * C, oy = Math.floor(cell / 2) * C;
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C, v = (y + 0.5) / C, rad = Math.hypot(u - 0.5, v - 0.5) * 2;
        const n = cell === 0 ? 1 : 0.6 + 0.8 * nz(u * 6, v * 6);
        const a = clamp(Math.exp(-rad * rad * 3.2) * n - rad * 0.08, 0, 1) * (rad < 1 ? 1 : 0);
        const i = ((oy + y) * W + ox + x) * 4;
        fd[i] = 255; fd[i + 1] = 255; fd[i + 2] = 255; fd[i + 3] = a * 255;
      }
    }
    const fire = new T.DataTexture(fd, W, W, T.RGBAFormat);
    fire.generateMipmaps = true; fire.minFilter = T.LinearMipmapLinearFilter; fire.magFilter = T.LinearFilter;
    fire.needsUpdate = true;
    TEX = { smoke, fire };
    return TEX;
  }

  // ---------- shaders ----------
  const VERT = `
    attribute vec4 iPos; attribute vec4 iCol; attribute vec4 iExt;
    #ifdef STRETCH
    attribute vec3 iVel;
    #endif
    varying vec2 vC; varying vec2 vUv; varying vec2 vCell; varying vec4 vCol; varying float vGlow; varying vec2 vRot;
    #include <fog_pars_vertex>
    void main(){
      vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
      float s = iPos.w;
      vec2 c = position.xy;
      float a = iCol.a;
      float dz = -mv.z;
      a *= smoothstep(s * 0.12, s * 0.7, dz);           // fade quads that would fill the screen
      #ifdef STRETCH
        vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
        vec2 d = vv.xy / max(1.0, dz) ; float L = length(d);
        vec2 ax = L > 1e-5 ? d / L : vec2(1.0, 0.0); vec2 ay = vec2(-ax.y, ax.x);
        float len = s + length(vv.xy) * iExt.w;
        mv.xy += ax * c.x * len + ay * c.y * s;
      #else
        mv.xy += c * s;
      #endif
      vec4 mvPosition = mv;
      gl_Position = projectionMatrix * mv;
      float cr = cos(iExt.x), sr = sin(iExt.x);
      vUv = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) + 0.5;
      vCell = vec2(mod(iExt.z, 2.0), floor(iExt.z / 2.0));
      vC = c; vCol = vec4(iCol.rgb, a); vGlow = iExt.y; vRot = vec2(cr, sr);
      #include <fog_vertex>
    }`;
  const FRAG = `
    uniform sampler2D map; uniform float uOcc; uniform vec3 uSunV; uniform vec3 uUpV; uniform vec3 uSunCol; uniform vec3 uSkyAmb; uniform vec3 uGndAmb; uniform vec3 uGlowCol;
    varying vec2 vC; varying vec2 vUv; varying vec2 vCell; varying vec4 vCol; varying float vGlow; varying vec2 vRot;
    #include <fog_pars_fragment>
    void main(){
      float r2 = dot(vC, vC) * 4.0;
      if (r2 > 1.0) discard;
      vec4 t = texture2D(map, (clamp(vUv, 0.004, 0.996) + vCell) * 0.5);
      float d = t.a * vCol.a;
      if (d < 0.004) discard;
      #ifdef LIT
        vec2 tn = t.rg * 2.0 - 1.0;
        tn = vec2(tn.x * vRot.x + tn.y * vRot.y, -tn.x * vRot.y + tn.y * vRot.x);   // texture space -> view space
        vec3 n = normalize(vec3(vC * 1.2 + tn * 1.3, 0.75));
        float ndl = dot(n, uSunV);
        float sun = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
        sun = sun * sun * (0.55 + 0.6 * t.b);                       // thicker parts catch more light, thin wisps less
        float up = dot(n, uUpV) * 0.5 + 0.5;
        vec3 amb = mix(uGndAmb, uSkyAmb, up) * (0.6 + 0.6 * t.b);
        float back = pow(max(0.0, -uSunV.z), 3.0) * (1.0 - t.a) * 0.9;   // silver lining when backlit
        vec3 col = vCol.rgb * (amb + uSunCol * (sun + back));
        col += uGlowCol * vGlow * (0.35 + 0.65 * (1.0 - up)) * t.a;       // flame light from below/inside
        gl_FragColor = vec4(col, d);
      #else
        float core = smoothstep(0.35, 1.0, t.a);
        // premultiplied: emits light and also partly hides what is behind (a fireball is not see-through)
        gl_FragColor = vec4(vCol.rgb * (1.0 + core * 1.5) * d, d * uOcc);
      #endif
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #ifdef LIT
      #include <fog_fragment>
      #endif
    }`;

  // ---------- particle pool (structure of arrays) ----------
  const F = ['x', 'y', 'z', 'vx', 'vy', 'vz', 's', 's1', 'gr', 'age', 'life', 'a', 'r', 'g', 'b', 'drag', 'gy', 'rot', 'rv', 'glow', 'gdec', 'floor', 'cell', 'fin', 'pw', 'cool', 'st', 'bounce', 'dil'];
  const DEF = { vx: 0, vy: 0, vz: 0, gr: 0.6, age: 0, a: 1, r: 1, g: 1, b: 1, drag: 0.5, gy: 0, rot: 0, rv: 0, glow: 0, gdec: 3, floor: -1e9, cell: 0, fin: 0.15, pw: 1.3, cool: 0, st: 0, bounce: 0, dil: 0 };
  class Pool {
    constructor(max, kind, scene) {
      this.max = max; this.n = 0; this.kind = kind; this.rr = 0;
      for (const f of F) this[f] = new Float32Array(max);
      const tx = textures();
      const lit = kind === 'smoke', stretch = kind === 'spark';
      const geo = new T.InstancedBufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      this.iPos = new Float32Array(max * 4); this.iCol = new Float32Array(max * 4); this.iExt = new Float32Array(max * 4);
      const ia = (arr, k) => new T.InstancedBufferAttribute(arr, k).setUsage(T.DynamicDrawUsage);
      geo.setAttribute('iPos', ia(this.iPos, 4)); geo.setAttribute('iCol', ia(this.iCol, 4)); geo.setAttribute('iExt', ia(this.iExt, 4));
      if (stretch) { this.iVel = new Float32Array(max * 3); geo.setAttribute('iVel', ia(this.iVel, 3)); }
      geo.instanceCount = 0;
      const uniforms = T.UniformsUtils.merge([T.UniformsLib.fog, {
        uSunV: { value: new T.Vector3(0, 0, 1) }, uUpV: { value: new T.Vector3(0, 1, 0) },
        uSunCol: { value: new T.Color(1.25, 1.08, 0.88) }, uSkyAmb: { value: new T.Color(0.3, 0.38, 0.5) }, uGndAmb: { value: new T.Color(0.12, 0.11, 0.1) },
        uGlowCol: { value: new T.Color(1.6, 0.75, 0.3) },
      }]);
      uniforms.map = { value: lit ? tx.smoke : tx.fire };
      uniforms.uOcc = { value: kind === 'fire' ? 0.55 : 0 };
      const defines = {}; if (lit) defines.LIT = 1; if (stretch) defines.STRETCH = 1;
      this.mat = new T.ShaderMaterial({
        uniforms, defines, vertexShader: VERT, fragmentShader: FRAG, fog: lit,
        transparent: true, depthWrite: false,
        blending: lit ? T.NormalBlending : T.CustomBlending,
        blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
      });
      this.mesh = new T.Mesh(geo, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = lit ? 20 : stretch ? 22 : 21;
      this.mesh.name = 'fx-' + kind;
      this.geo = geo;
      if (lit) { this.idx = new Int32Array(max); this.key = new Float32Array(max); }
      scene.add(this.mesh);
    }
    add(o) {
      let i;
      if (this.n < this.max) i = this.n++;
      else { i = this.rr; this.rr = (this.rr + 7) % this.max; }
      for (const f of F) this[f][i] = o[f] !== undefined ? o[f] : (DEF[f] !== undefined ? DEF[f] : 0);
      if (o.s1 === undefined) this.s1[i] = this.s[i];
      if (o.rot === undefined) this.rot[i] = rnd() * 6.283;
      if (o.cell === undefined) this.cell[i] = Math.floor(rnd() * 4);
      // pre-advance particles born part-way through the frame (no gaps / banding at speed)
      const age = this.age[i];
      if (age > 0) { this.x[i] += this.vx[i] * age; this.y[i] += this.vy[i] * age; this.z[i] += this.vz[i] * age; }
      return i;
    }
    kill(i) {
      const j = --this.n;
      if (i !== j) for (const f of F) this[f][i] = this[f][j];
    }
    step(dt, wind) {
      for (let i = 0; i < this.n; i++) {
        this.age[i] += dt;
        if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
        const k = 1 - Math.exp(-this.drag[i] * dt);
        this.vx[i] += (wind.x - this.vx[i]) * k; this.vy[i] += (wind.y - this.vy[i]) * k; this.vz[i] += (wind.z - this.vz[i]) * k;
        this.vy[i] += this.gy[i] * dt;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
        const fl = this.floor[i] + this.s[i] * (this.kind === 'spark' ? 0 : 0.28);
        if (this.y[i] < fl) {
          this.y[i] = fl;
          if (this.vy[i] < 0) {
            // smoke hitting the ground spreads sideways; sparks bounce
            const sp = -this.vy[i] * (this.kind === 'spark' ? 0.3 : 0.6);
            const h = Math.hypot(this.vx[i], this.vz[i]) || 1;
            this.vx[i] += this.vx[i] / h * sp; this.vz[i] += this.vz[i] / h * sp;
            this.vy[i] = -this.vy[i] * this.bounce[i];
          }
        }
        this.s[i] += (this.s1[i] - this.s[i]) * (1 - Math.exp(-this.gr[i] * dt));
        this.rot[i] += this.rv[i] * dt;
      }
    }
    upload(cam) {
      const n = this.n; const cp = cam.position;
      let order = null;
      if (this.idx) {
        _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
        for (let i = 0; i < n; i++) { this.idx[i] = i; this.key[i] = (this.x[i] - cp.x) * _v.x + (this.y[i] - cp.y) * _v.y + (this.z[i] - cp.z) * _v.z; }
        const key = this.key;
        order = this.idx.subarray(0, n).sort((a, b) => key[b] - key[a]);
      }
      for (let o = 0; o < n; o++) {
        const i = order ? order[o] : o;
        const t = this.age[i] / this.life[i];
        let al = this.a[i] * Math.min(1, this.age[i] / Math.max(0.001, this.fin[i])) * Math.pow(1 - t, this.pw[i]);
        let r = this.r[i], g = this.g[i], b = this.b[i];
        if (this.cool[i]) { // fire cools from white-yellow to deep red
          const h = Math.exp(-this.age[i] * this.cool[i]);
          r *= Math.pow(h, 0.25); g *= h; b *= h * h;
        }
        const o4 = o * 4;
        this.iPos[o4] = this.x[i]; this.iPos[o4 + 1] = this.y[i]; this.iPos[o4 + 2] = this.z[i]; this.iPos[o4 + 3] = this.s[i];
        this.iCol[o4] = r; this.iCol[o4 + 1] = g; this.iCol[o4 + 2] = b; this.iCol[o4 + 3] = al;
        this.iExt[o4] = this.rot[i]; this.iExt[o4 + 1] = this.glow[i] * Math.exp(-this.age[i] * this.gdec[i]); this.iExt[o4 + 2] = this.cell[i]; this.iExt[o4 + 3] = this.st[i];
        if (this.iVel) { const o3 = o * 3; this.iVel[o3] = this.vx[i]; this.iVel[o3 + 1] = this.vy[i]; this.iVel[o3 + 2] = this.vz[i]; }
      }
      this.geo.instanceCount = n;
      this.mesh.visible = n > 0;
      for (const k of ['iPos', 'iCol', 'iExt', 'iVel']) {
        const at = this.geo.attributes[k]; if (!at) continue;
        at.needsUpdate = true;
        if (at.addUpdateRange) { at.clearUpdateRanges(); at.addUpdateRange(0, n * at.itemSize); }
      }
    }
    clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
    dispose() { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
  }

  // ---------- the fx system ----------
  function create(scene) {
    const lowEnd = small();
    const Q = lowEnd ? 0.45 : 1; // emission quality factor
    const smoke = new Pool(lowEnd ? 900 : 2600, 'smoke', scene);
    const fire = new Pool(lowEnd ? 260 : 700, 'fire', scene);
    const spark = new Pool(lowEnd ? 160 : 500, 'spark', scene);
    const light = new T.PointLight(0xffaa55, 0, 0, 2);
    light.castShadow = false; scene.add(light);
    let frame = 0, lightE = 0;
    const debris = [];
    const wind = new T.Vector3(3.5, 0, 1.5);
    const zero = new T.Vector3();
    const rocketVel = new T.Vector3(), lastDir = new T.Vector3(0, -1, 0);
    let altKm = 0;
    const em = {};
    const emitter = (name) => em[name] || (em[name] = { last: new T.Vector3(), has: false, frame: -9, acc: 0 });

    // Emit along the path the emitter moved since last frame: fn(point, ageOffset)
    function along(name, pos, dt, rate, spacing, cap, fn) {
      const e = emitter(name);
      const cont = e.has && frame - e.frame <= 2;
      const from = cont ? e.last : pos;
      let dist = cont ? from.distanceTo(pos) : 0;
      if (dist > 30000) dist = 0;
      e.acc += Math.max(rate * dt, dist / Math.max(0.05, spacing));
      let n = Math.floor(e.acc); e.acc -= n;
      if (n > cap) n = cap;
      for (let i = 0; i < n; i++) {
        const f = (i + rnd()) / n;
        _p.copy(dist > 0 ? from : pos).lerp(pos, dist > 0 ? f : 1);
        fn(_p, (1 - f) * dt);
      }
      if (cont && dt > 0) rocketVel.subVectors(pos, from).divideScalar(dt); else if (!cont) rocketVel.set(0, 0, 0);
      e.last.copy(pos); e.has = true; e.frame = frame;
      return n;
    }

    const greyish = (base, j) => { const k = base + rr(-j, j); return k; };

    // ---------- exhaust ----------
    function exhaust(pos, dir, power, alt, radius, dt, groundY) {
      if (!(power > 0.01) || !(dt > 0)) return;
      radius = radius || 1.8; altKm = alt || 0; lastDir.copy(dir);
      const rho = Math.exp(-Math.max(0, altKm) / 7.5);           // air density factor
      const h = Math.max(0, altKm * 1000);
      const gY = groundY !== undefined && groundY !== null ? groundY : pos.y - h;
      const hg = pos.y - gY;
      // --- trail smoke / steam (fades out by ~40 km) ---
      const vis = clamp(1 - altKm / 38, 0, 1);
      if (vis > 0) {
        const thin = 1 - rho;
        const cap = lowEnd ? 5 : 12;
        const e = emitter('exh'); const moved = e.has && frame - e.frame <= 2 ? e.last.distanceTo(pos) : 0;
        // puffs must overlap along the path: widen them if the per-frame budget can't cover the distance moved
        const s0 = Math.max(radius * (3.0 + 9 * thin), moved / cap / 0.25);
        const s1 = Math.max(radius * (15 + 40 * thin) * (lowEnd ? 1.15 : 1), s0 * 1.6);
        const life = (lowEnd ? 7 : 11) * (0.25 + 0.75 * Math.pow(rho, 0.6)) * rr(0.8, 1.2);
        const spacing = s0 * 0.25;
        const al = (0.6 * Math.pow(rho, 0.35) + 0.08) * vis * (0.4 + 0.6 * power);
        along('exh', pos, dt, 45 * Q * power, spacing, cap, (p, ao) => {
          perpBasis(dir, _u, _w);
          const ang = rr(0, 6.283), sp = rr(2, 8) * (1 + 6 * thin);
          const out = rr(25, 70) * power * (1 + 3 * thin);
          const g = greyish(0.86, 0.05);
          smoke.add({
            x: p.x + dir.x * radius * 2, y: p.y + dir.y * radius * 2, z: p.z + dir.z * radius * 2,
            vx: dir.x * out + (_u.x * Math.cos(ang) + _w.x * Math.sin(ang)) * sp,
            vy: dir.y * out + (_u.y * Math.cos(ang) + _w.y * Math.sin(ang)) * sp,
            vz: dir.z * out + (_u.z * Math.cos(ang) + _w.z * Math.sin(ang)) * sp,
            s: s0 * rr(0.8, 1.2), s1: s1 * rr(0.7, 1.3), gr: rr(0.25, 0.45) * (1 + 2 * thin), life, age: ao,
            a: al * rr(0.75, 1), r: g * 1.01, g: g, b: g * 0.97, drag: 0.5 + 0.6 * rho, gy: 0.4 * rho,
            rv: rr(-0.15, 0.15), glow: 1.4, gdec: 3.5, floor: gY, fin: 0.06, pw: 1.4,
          });
        });
      } else along('exh', pos, dt, 0, 1e9, 0, () => {});
      // --- faint exhaust glow high up (and a hot core right at the nozzle everywhere) ---
      const glowK = clamp((altKm - 15) / 25, 0, 1);
      if (glowK > 0) {
        const n = Math.max(1, Math.round((lowEnd ? 3 : 6) * glowK));
        for (let i = 0; i < n; i++) {
          const d = rr(0, 1), sp = rr(200, 600);
          fire.add({
            x: pos.x + dir.x * radius * 4 * d, y: pos.y + dir.y * radius * 4 * d, z: pos.z + dir.z * radius * 4 * d,
            vx: dir.x * sp + rr(-30, 30), vy: dir.y * sp + rr(-30, 30), vz: dir.z * sp + rr(-30, 30),
            s: radius * 3, s1: radius * (18 + 30 * glowK), gr: 2.5, life: rr(0.4, 0.8), a: 0.05 * power * glowK,
            r: 1.0, g: 0.62, b: 0.34, drag: 0, fin: 0.05, pw: 1.5, cool: 0.5,
          });
        }
      }
      // --- ground clouds at liftoff (steam + smoke pushed out sideways from the pad) ---
      const reach = radius * 45 * power;
      if (hg < reach && dir.y < -0.3 && altKm < 0.3) {
        const strength = power * Math.pow(1 - hg / reach, 0.8);
        const hit = _v.copy(pos).addScaledVector(dir, hg / -dir.y);
        const hx = hit.x, hz = hit.z;
        const e = emitter('ground'); e.acc += (lowEnd ? 26 : 60) * strength * dt;
        let n = Math.min(Math.floor(e.acc), lowEnd ? 3 : 6); e.acc -= Math.floor(e.acc);
        for (let i = 0; i < n; i++) {
          // two big lobes out of the flame trench, plus some all-round spill
          let ang = rnd() < 0.62 ? (rnd() < 0.5 ? 0 : Math.PI) + rr(-0.45, 0.45) : rr(0, 6.283);
          ang += fxObj.trenchAngle;
          const sp = rr(25, 80) * (0.5 + strength);
          const steam = rnd() < 0.65; const g = steam ? greyish(0.95, 0.03) : greyish(0.8, 0.06);
          smoke.add({
            x: hx + rr(-radius, radius), y: gY + radius * 1.5, z: hz + rr(-radius, radius),
            vx: Math.cos(ang) * sp, vy: rr(3, 18) * (0.4 + strength), vz: Math.sin(ang) * sp,
            s: radius * rr(4, 7), s1: radius * rr(18, 38) * (lowEnd ? 1.25 : 1), gr: rr(0.15, 0.3), life: rr(10, 20) * (lowEnd ? 0.75 : 1), age: rr(0, dt),
            a: rr(0.45, 0.85), r: g, g: g, b: g * 0.98, drag: rr(0.22, 0.38), gy: rr(0.6, 2.2),
            rv: rr(-0.1, 0.1), glow: 1.8 * strength, gdec: 1.3, floor: gY, fin: 0.3, pw: 1.6,
          });
        }
      }
    }

    // ---------- landing burn: spray / dust kicked up by the plume ----------
    function landingBurn(pos, dir, power, groundY, dt, opts) {
      if (!(power > 0.01) || !(dt > 0)) return;
      opts = opts || {};
      const radius = opts.radius || 1.8;
      const water = !!opts.water;
      lastDir.copy(dir);
      const hg = pos.y - groundY;
      // a little smoke straight out of the engine
      along('land', pos, dt, 16 * Q * power, radius * 2, lowEnd ? 2 : 5, (p, ao) => {
        const out = rr(40, 90) * power; const g = greyish(0.84, 0.05);
        smoke.add({
          x: p.x + dir.x * radius * 2, y: p.y + dir.y * radius * 2, z: p.z + dir.z * radius * 2,
          vx: dir.x * out + rr(-4, 4), vy: dir.y * out + rr(-4, 4), vz: dir.z * out + rr(-4, 4),
          s: radius * 1.8, s1: radius * rr(7, 11), gr: 0.6, life: rr(3, 5), age: ao, a: 0.45 * power, r: g, g, b: g * 0.97,
          drag: 0.9, glow: 1.6, gdec: 3, floor: groundY, fin: 0.15, pw: 1.4,
        });
      });
      const reach = radius * 38 * power;
      if (hg > reach || dir.y > -0.3) return;
      const strength = power * Math.pow(1 - Math.max(0, hg) / reach, 1.2);
      const hit = _v.copy(pos).addScaledVector(dir, Math.max(0, hg) / -dir.y);
      const hx = hit.x, hz = hit.z;
      const e = emitter('landgnd'); e.acc += (lowEnd ? 40 : 100) * strength * dt;
      let n = Math.min(Math.floor(e.acc), lowEnd ? 4 : 9); e.acc -= Math.floor(e.acc);
      for (let i = 0; i < n; i++) {
        const ang = rr(0, 6.283), sp = rr(30, 90) * (0.4 + strength);
        const c = water ? [0.93, 0.95, 0.97] : opts.color ? [opts.color.r, opts.color.g, opts.color.b] : [0.66 + rr(-0.05, 0.05), 0.6, 0.52];
        smoke.add({
          x: hx + Math.cos(ang) * radius, y: groundY + radius * 0.6, z: hz + Math.sin(ang) * radius,
          vx: Math.cos(ang) * sp, vy: rr(1, 10) * (water ? 1.6 : 1), vz: Math.sin(ang) * sp,
          s: radius * rr(2, 3.5), s1: radius * rr(10, 18), gr: rr(0.45, 0.8), life: rr(3, 6), age: rr(0, dt),
          a: rr(0.55, 0.85) * (water ? 0.85 : 1), r: c[0], g: c[1], b: c[2], drag: rr(0.8, 1.4), gy: water ? -2 : 0.3,
          rv: rr(-0.3, 0.3), glow: 1.2 * strength, gdec: 2.5, floor: groundY, fin: 0.12, pw: 1.3,
        });
      }
      // hot glow where the plume hits the deck
      if (hg < reach * 0.45 && rnd() < (lowEnd ? 0.5 : 1)) {
        fire.add({
          x: hx + rr(-radius, radius), y: groundY + radius * 0.8, z: hz + rr(-radius, radius),
          vx: rr(-30, 30), vy: rr(0, 6), vz: rr(-30, 30), s: radius * 3, s1: radius * 7, gr: 2, life: rr(0.25, 0.5),
          a: 0.35 * strength, r: 1.0, g: 0.7, b: 0.4, drag: 2, fin: 0.03, pw: 1.2, cool: 2.5, floor: groundY,
        });
      }
    }

    // ---------- explosion ----------
    function explode(pos, sizeM, groundY) {
      const S = Math.max(2, sizeM || 20);
      const fl = groundY !== undefined && groundY !== null ? groundY : -1e9;
      const qs = lowEnd ? 0.45 : 1;
      // flash
      fire.add({ x: pos.x, y: pos.y, z: pos.z, s: S * 3, s1: S * 7, gr: 6, life: 0.45, a: 1, r: 6, g: 5.4, b: 4.6, drag: 0, fin: 0.01, pw: 2.2, cell: 0, rot: 0 });
      lightE = Math.max(lightE, 1); light.position.copy(pos); light.userData.S = S;
      // fireball
      for (let i = 0, n = Math.round(45 * qs); i < n; i++) {
        randUnit(_u); const d = Math.pow(rnd(), 0.6) * S * 0.35;
        const sp = S * rr(1.2, 3.5);
        fire.add({
          x: pos.x + _u.x * d, y: pos.y + _u.y * d, z: pos.z + _u.z * d,
          vx: _u.x * sp, vy: _u.y * sp + S * 0.4, vz: _u.z * sp,
          s: S * rr(0.35, 0.6), s1: S * rr(1.0, 1.6), gr: rr(1.2, 2.2), life: rr(1.0, 2.4), age: rr(0, 0.05),
          a: rr(0.5, 0.9), r: 3.2, g: 1.45, b: 0.4, drag: rr(1.5, 2.6), gy: rr(2, 5), fin: 0.04, pw: 1.1, cool: rr(0.9, 1.6), floor: fl,
          rv: rr(-0.6, 0.6),
        });
      }
      // dark smoke that rises and lingers
      for (let i = 0, n = Math.round(60 * qs); i < n; i++) {
        randUnit(_u); const d = Math.pow(rnd(), 0.5) * S * 0.5;
        const sp = S * rr(0.5, 1.8);
        const g = rr(0.07, 0.16);
        smoke.add({
          x: pos.x + _u.x * d, y: pos.y + _u.y * d, z: pos.z + _u.z * d,
          vx: _u.x * sp, vy: _u.y * sp + S * 0.25, vz: _u.z * sp,
          s: S * rr(0.5, 0.8), s1: S * rr(1.8, 3.2) * (lowEnd ? 1.2 : 1), gr: rr(0.25, 0.45), life: rr(14, 26) * (lowEnd ? 0.7 : 1), age: 0,
          a: rr(0.75, 0.95), r: g * 1.05, g: g, b: g * 0.95, drag: rr(0.5, 0.9), gy: rr(0.8, 2.0),
          rv: rr(-0.12, 0.12), glow: 2.2, gdec: 0.9, floor: fl, fin: rr(0.4, 1.0), pw: 1.2,
        });
      }
      // sparks with gravity
      for (let i = 0, n = Math.round(140 * qs); i < n; i++) {
        randUnit(_u); _u.y = Math.abs(_u.y) * 0.8 + 0.2 * _u.y;
        const sp = rr(20, 25 + S * 4);
        spark.add({
          x: pos.x + _u.x * S * 0.2, y: pos.y + _u.y * S * 0.2, z: pos.z + _u.z * S * 0.2,
          vx: _u.x * sp, vy: _u.y * sp, vz: _u.z * sp,
          s: rr(0.3, 0.8) * Math.sqrt(S / 20), life: rr(1.2, 4), a: rr(0.7, 1), r: 3.5, g: 2.4, b: 1.3,
          drag: 0.12, gy: -9.81, fin: 0.01, pw: 0.6, cool: rr(0.3, 0.8), st: 0.045, floor: fl, bounce: 0.35,
        });
      }
      // a few big burning debris pieces trailing smoke
      for (let i = 0, n = lowEnd ? 4 : 9; i < n; i++) {
        randUnit(_u); _u.y = Math.abs(_u.y) * 0.7 + 0.3;
        const sp = rr(15, 20 + S * 2.2);
        debris.push({ p: pos.clone(), v: _u.clone().multiplyScalar(sp), life: rr(2, 5), age: 0, fl, s: Math.sqrt(S / 20) });
      }
    }

    // ---------- cold gas vent / RCS ----------
    function vent(pos, dir, dt) {
      if (!(dt > 0)) return;
      const vac = altKm > 35;
      along('vent', pos, dt, 40 * Q, 0.6, lowEnd ? 3 : 6, (p, ao) => {
        const sp = rr(12, 28) * (vac ? 2 : 1);
        smoke.add({
          x: p.x, y: p.y, z: p.z, vx: dir.x * sp + rr(-3, 3) + rocketVel.x * (vac ? 1 : 0.3), vy: dir.y * sp + rr(-3, 3) + rocketVel.y * (vac ? 1 : 0.3), vz: dir.z * sp + rr(-3, 3) + rocketVel.z * (vac ? 1 : 0.3),
          s: rr(0.3, 0.6), s1: rr(2.5, 4.5) * (vac ? 3 : 1), gr: vac ? 3 : 1.6, life: rr(0.7, 1.4) * (vac ? 0.6 : 1), age: ao,
          a: rr(0.45, 0.65), r: 0.97, g: 0.97, b: 0.98, drag: vac ? 0 : 1.6, fin: 0.04, pw: 1.6,
        });
      });
    }

    // ---------- condensation cloud at max-q ----------
    function sonic(pos, radius, vel) {
      radius = radius || 1.8;
      const v = vel ? _w.copy(vel) : _w.copy(rocketVel);
      const fwd = v.lengthSq() > 1 ? _u.copy(v).normalize() : _u.copy(lastDir).negate();
      if (fwd.lengthSq() < 0.5) fwd.set(0, 1, 0);
      const a1 = new T.Vector3(), a2 = new T.Vector3(); perpBasis(fwd, a1, a2);
      const n = lowEnd ? 40 : 110;
      for (let i = 0; i < n; i++) {
        const t = rnd();                                   // 0 = forward edge, 1 = aft
        const ax = radius * (2 - t * 9);                  // along the body, bell widening aft
        const ring = radius * (1.5 + 2.6 * Math.sqrt(t)) * rr(0.9, 1.1);
        const ang = rr(0, 6.283), c = Math.cos(ang), s = Math.sin(ang);
        smoke.add({
          x: pos.x + fwd.x * ax + (a1.x * c + a2.x * s) * ring, y: pos.y + fwd.y * ax + (a1.y * c + a2.y * s) * ring, z: pos.z + fwd.z * ax + (a1.z * c + a2.z * s) * ring,
          vx: v.x, vy: v.y, vz: v.z,
          s: radius * rr(1.6, 2.6), s1: radius * rr(3, 4.5), gr: 1, life: rr(0.8, 1.6), a: rr(0.5, 0.8) * (1 - t * 0.4),
          r: 1, g: 1, b: 1, drag: rr(0.25, 0.6), fin: 0.12, pw: 1.5,
        });
      }
    }

    // ---------- per frame ----------
    function step(dt, camera) {
      frame++;
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      // burning debris
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.age += dt;
        if (d.age > d.life) { debris.splice(i, 1); continue; }
        d.v.y -= 9.81 * dt; d.v.multiplyScalar(Math.exp(-0.15 * dt));
        const prev = _v.copy(d.p); d.p.addScaledVector(d.v, dt);
        if (d.p.y < d.fl) { d.p.y = d.fl; d.v.set(0, 0, 0); d.life = Math.min(d.life, d.age + 0.6); }
        const k = 1 - d.age / d.life;
        const segs = lowEnd ? 1 : 2;
        for (let j = 0; j < segs; j++) {
          const f = (j + rnd()) / segs;
          const x = prev.x + (d.p.x - prev.x) * f, y = prev.y + (d.p.y - prev.y) * f, z = prev.z + (d.p.z - prev.z) * f;
          const g = rr(0.1, 0.2);
          smoke.add({ x, y, z, s: 1.5 * d.s, s1: rr(5, 9) * d.s, gr: 0.6, life: rr(4, 8), a: 0.55 * k + 0.15, r: g, g, b: g, drag: 0.8, gy: 0.8, glow: 1.5, gdec: 2.5, fin: 0.2, pw: 1.3 });
          fire.add({ x, y, z, s: 2.2 * d.s * k + 0.6, s1: 0.4 * d.s, gr: 2, life: 0.35, a: 0.7 * k, r: 3, g: 1.9, b: 0.9, drag: 0, fin: 0.01, pw: 1, cool: 2 });
        }
      }
      smoke.step(dt, wind); fire.step(dt, zero); spark.step(dt, zero);
      // explosion light
      if (lightE > 0) {
        lightE *= Math.exp(-dt * 2.2); if (lightE < 0.01) lightE = 0;
        const S = light.userData.S || 20;
        light.intensity = lightE * S * S * 10; light.distance = S * 40;
      } else light.intensity = 0;
      if (camera) {
        camera.updateMatrixWorld();
        const R = A.R; const inv = camera.matrixWorldInverse;
        const sunV = smoke.mat.uniforms.uSunV.value;
        if (R && R.sunDir) sunV.copy(R.sunDir).transformDirection(inv); else sunV.set(0.5, 0.7, 0.3).normalize().transformDirection(inv);
        smoke.mat.uniforms.uUpV.value.set(0, 1, 0).transformDirection(inv);
        // thinner sky light at altitude
        const k = clamp(1 - altKm / 60, 0.25, 1);
        smoke.mat.uniforms.uSkyAmb.value.setRGB(0.3 * k, 0.38 * k, 0.5 * k);
        smoke.upload(camera); fire.upload(camera); spark.upload(camera);
      }
    }

    function clear() {
      smoke.clear(); fire.clear(); spark.clear(); debris.length = 0; lightE = 0; light.intensity = 0;
      for (const k in em) { em[k].has = false; em[k].acc = 0; }
    }
    function dispose() {
      smoke.dispose(); fire.dispose(); spark.dispose(); scene.remove(light); light.dispose && light.dispose();
    }
    // shift everything (floating origin support)
    function shift(d) {
      for (const P of [smoke, fire, spark]) for (let i = 0; i < P.n; i++) { P.x[i] += d.x; P.y[i] += d.y; P.z[i] += d.z; P.floor[i] += d.y; }
      for (const k in em) em[k].last.add(d);
      for (const db of debris) { db.p.add(d); db.fl += d.y; }
    }
    const fxObj = {
      exhaust, landingBurn, explode, vent, sonic, step, clear, dispose, shift,
      wind, trenchAngle: 0,
      setAlt(km) { altKm = km; },
      count() { return { smoke: smoke.n, fire: fire.n, spark: spark.n, debris: debris.length }; },
      pools: { smoke, fire, spark },
    };
    return fxObj;
  }

  window.APOGEE_FX3D = { create, textures };
})();
