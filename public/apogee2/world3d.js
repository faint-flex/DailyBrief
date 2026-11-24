// 3D engine for the flight scenes: renderer, sky, Earth, rocket models, launch and landing sites, particles.
// Units: metres in the near scene, kilometres in the Earth scene.
(function () {
  'use strict';
  const T = window.THREE;
  const S = window.APOGEE_SIM;
  const D = window.APOGEE_DRAW;
  const EARTH_R = 6371;

  // ---------- small helpers ----------
  function canvasTex(w, h, paint, opts) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const tx = new T.CanvasTexture(c);
    if (!opts || opts.color !== false) tx.colorSpace = T.SRGBColorSpace;
    tx.anisotropy = 4;
    return tx;
  }
  function rand(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // 3D value noise
  function makeNoise(seed) {
    const r = rand(seed);
    const P = new Uint8Array(512); const V = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; V[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const f = (t) => t * t * (3 - 2 * t);
    const h = (x, y, z) => V[P[P[P[x & 255] + (y & 255)] + (z & 255)]];
    function n3(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = x - xi, yf = y - yi, zf = z - zi;
      const u = f(xf), v = f(yf), w = f(zf);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
        l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
    }
    return function fbm(x, y, z, oct) {
      let s = 0, a = 0.5, fq = 1;
      for (let i = 0; i < (oct || 5); i++) { s += a * n3(x * fq, y * fq, z * fq); fq *= 2.03; a *= 0.5; }
      return s;
    };
  }

  // ---------- renderer and shared scenes ----------
  let R = null;
  function init(canvas) {
    if (R && R.canvas === canvas) return R;
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.autoClear = false;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    renderer.shadowMap.enabled = !small;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));

    const camera = new T.PerspectiveCamera(45, 1, 0.5, 3e6);
    const earthCam = new T.PerspectiveCamera(45, 1, 1, 60000);

    // Sky
    const skyScene = new T.Scene();
    const sky = new window.ApogeeSky();
    sky.scale.setScalar(900000);
    sky.material.fragmentShader = sky.material.fragmentShader
      .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float skyFade;')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyFade, 1.0 );');
    sky.material.uniforms.skyFade = { value: 1 };
    const su = sky.material.uniforms;
    su.turbidity.value = 4; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.86;
    const sunDir = new T.Vector3();
    const elev = T.MathUtils.degToRad(11), azim = T.MathUtils.degToRad(-35);
    sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    su.sunPosition.value.copy(sunDir).multiplyScalar(450000);
    skyScene.add(sky);
    // stars
    const starGeo = new T.BufferGeometry();
    const sp = []; const rs = rand(9);
    for (let i = 0; i < 4000; i++) {
      const v = new T.Vector3(rs() * 2 - 1, rs() * 2 - 1, rs() * 2 - 1).normalize().multiplyScalar(800000);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    const starMat = new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
    const stars = new T.Points(starGeo, starMat);
    skyScene.add(stars);
    // sun glare sprite (visible from space)
    const glare = new T.Sprite(new T.SpriteMaterial({
      map: canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,248,230,.9)'); gr.addColorStop(0.3, 'rgba(255,230,190,.2)'); gr.addColorStop(1, 'rgba(255,220,180,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }),
      blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    }));
    glare.scale.setScalar(120000);
    skyScene.add(glare);

    // environment map from the sky for reflections
    const pmrem = new T.PMREMGenerator(renderer);
    const envScene = new T.Scene();
    const sky2 = new window.ApogeeSky();
    sky2.scale.setScalar(900000);
    Object.assign(sky2.material.uniforms.turbidity, { value: 4 });
    sky2.material.uniforms.rayleigh.value = 1.6; sky2.material.uniforms.mieCoefficient.value = 0.004; sky2.material.uniforms.mieDirectionalG.value = 0.86;
    sky2.material.uniforms.sunPosition.value.copy(su.sunPosition.value);
    envScene.add(sky2);
    const env = pmrem.fromScene(envScene).texture;

    R = { canvas, renderer, camera, earthCam, skyScene, sky, stars, glare, sunDir, env, earth: null, small };
    return R;
  }

  function resize() {
    const c = R.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h; R.camera.updateProjectionMatrix();
    R.earthCam.aspect = w / h; R.earthCam.fov = R.camera.fov; R.earthCam.updateProjectionMatrix();
    const px = R.renderer.getPixelRatio();
    R.pointScale = (h * px) / (2 * Math.tan(T.MathUtils.degToRad(R.camera.fov) / 2));
  }

  // ---------- Earth (km scale) ----------
  function buildEarth() {
    if (R.earth) return R.earth;
    const scene = new T.Scene();
    const fbm = makeNoise(4242);
    const W = 1024, H = 512;
    const tex = canvasTex(W, H, (g) => {
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const lat = (0.5 - y / H) * Math.PI;
        const cl = Math.cos(lat), sl = Math.sin(lat);
        for (let x = 0; x < W; x++) {
          const lon = (x / W) * Math.PI * 2;
          const px = cl * Math.cos(lon), pz = cl * Math.sin(lon), py = sl;
          const e = fbm(px * 1.6 + 5, py * 1.6 + 5, pz * 1.6 + 5, 6);
          const ice = Math.abs(lat) > 1.22;
          let r, gg, b;
          if (ice) { r = 236; gg = 240; b = 246; }
          else if (e > 0.53) {
            const dry = fbm(px * 4, py * 4, pz * 4, 3);
            const desert = Math.max(0, 1 - Math.abs(lat) * 2.2) * (dry > 0.5 ? 1 : 0.4);
            r = 70 + desert * 120 + (e - 0.53) * 200; gg = 92 + desert * 70 + (e - 0.53) * 120; b = 52 + desert * 40;
          } else {
            const shallow = Math.max(0, (e - 0.47) / 0.06);
            r = 8 + shallow * 30; gg = 34 + shallow * 60; b = 78 + shallow * 50;
          }
          const i = (y * W + x) * 4;
          img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    const cloudTex = canvasTex(W, H, (g) => {
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const lat = (0.5 - y / H) * Math.PI;
        const cl = Math.cos(lat), sl = Math.sin(lat);
        for (let x = 0; x < W; x++) {
          const lon = (x / W) * Math.PI * 2;
          const v = fbm(cl * Math.cos(lon) * 3 + 11, sl * 3 * 1.4 + 11, cl * Math.sin(lon) * 3 + 11, 6);
          const a = Math.max(0, Math.min(1, (v - 0.5) * 3.2));
          const i = (y * W + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    const earth = new T.Mesh(new T.SphereGeometry(EARTH_R, 128, 96), new T.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 }));
    earth.rotation.y = 2.2;
    scene.add(earth);
    const clouds = new T.Mesh(new T.SphereGeometry(EARTH_R + 8, 128, 96), new T.MeshStandardMaterial({ map: cloudTex, transparent: true, depthWrite: false, roughness: 1 }));
    clouds.rotation.y = 2.2;
    scene.add(clouds);
    const atmo = new T.Mesh(new T.SphereGeometry(EARTH_R + 110, 96, 64), new T.ShaderMaterial({
      side: T.BackSide, transparent: true, blending: T.AdditiveBlending, depthWrite: false,
      uniforms: { sun: { value: R.sunDir } },
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(normalMatrix*normal); vW = normalize((modelMatrix*vec4(position,1.)).xyz); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 sun; varying vec3 vN; varying vec3 vW; void main(){ float i = pow(max(0.0, 0.72 + dot(vN, vec3(0.,0.,1.))), 4.0); float day = 0.35 + 0.65*max(0.0, dot(vW, sun)); gl_FragColor = vec4(vec3(0.33,0.58,1.0)*i*1.6*day, i); }',
    }));
    scene.add(atmo);
    const sun = new T.DirectionalLight(0xfff2e0, 3.2);
    sun.position.copy(R.sunDir).multiplyScalar(10000);
    scene.add(sun);
    scene.add(new T.AmbientLight(0x223355, 0.25));
    R.earth = { scene, clouds };
    return R.earth;
  }

  // ---------- Particles ----------
  function softTex(stops) {
    return canvasTex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      for (const [k, c] of stops) gr.addColorStop(k, c);
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }
  function smokeTex() {
    return canvasTex(128, 128, (g, w) => {
      const rr = rand(3);
      for (let i = 0; i < 26; i++) {
        const x = w / 2 + (rr() - 0.5) * w * 0.5, y = w / 2 + (rr() - 0.5) * w * 0.5, r = w * (0.12 + rr() * 0.22);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, w);
      }
      g.globalCompositeOperation = 'destination-in';
      const m = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.7, 'rgba(0,0,0,.7)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m; g.fillRect(0, 0, w, w);
    });
  }
  class Particles {
    constructor(max, tex, additive) {
      this.max = max; this.n = 0;
      this.p = []; // {x,y,z,vx,vy,vz,size,grow,life,max,r,g,b,a,drag,gy}
      const geo = new T.BufferGeometry();
      this.pos = new Float32Array(max * 3); this.siz = new Float32Array(max); this.alp = new Float32Array(max); this.col = new Float32Array(max * 3);
      geo.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('aSize', new T.BufferAttribute(this.siz, 1).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('aAlpha', new T.BufferAttribute(this.alp, 1).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('aColor', new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
      this.mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { map: { value: tex }, uScale: { value: 800 } },
        vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = min(2048.0, aSize*uScale / max(0.5, -mv.z)); gl_Position = projectionMatrix*mv; vA = aAlpha; vC = aColor; }',
        fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC*t.rgb, t.a*vA); }',
      });
      this.points = new T.Points(geo, this.mat);
      this.points.frustumCulled = false;
      this.geo = geo;
    }
    add(o) {
      if (this.p.length >= this.max) this.p.shift();
      this.p.push(Object.assign({ vx: 0, vy: 0, vz: 0, grow: 0.6, drag: 0.98, gy: 0, a: 1, r: 1, g: 1, b: 1, fadeIn: 0.1 }, o, { max: o.life }));
    }
    step(dt) {
      const out = [];
      for (const q of this.p) {
        q.life -= dt;
        if (q.life <= 0) continue;
        const d = Math.pow(q.drag, dt * 60);
        q.vx *= d; q.vy *= d; q.vz *= d; q.vy += q.gy * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        q.size *= 1 + q.grow * dt;
        out.push(q);
      }
      this.p = out;
    }
    upload(scale, origin) {
      const n = this.p.length;
      for (let i = 0; i < n; i++) {
        const q = this.p[i];
        this.pos[i * 3] = q.x - origin.x; this.pos[i * 3 + 1] = q.y - origin.y; this.pos[i * 3 + 2] = q.z - origin.z;
        this.siz[i] = q.size;
        const k = q.life / q.max;
        this.alp[i] = q.a * Math.min(1, (1 - k) / q.fadeIn) * Math.min(1, k * 2.2);
        this.col[i * 3] = q.r; this.col[i * 3 + 1] = q.g; this.col[i * 3 + 2] = q.b;
      }
      this.geo.setDrawRange(0, n);
      for (const k of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[k].needsUpdate = true;
      this.mat.uniforms.uScale.value = scale;
    }
    clear() { this.p = []; }
  }

  // ---------- Materials ----------
  let M = null;
  function mats() {
    if (M) return M;
    M = {
      paint: new T.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.42, metalness: 0.05 }),
      steel: new T.MeshStandardMaterial({ color: 0xd2d6dc, roughness: 0.28, metalness: 0.9 }),
      black: new T.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.3 }),
      bell: new T.MeshStandardMaterial({ color: 0x45484f, roughness: 0.35, metalness: 0.85, side: T.DoubleSide }),
      bellVac: new T.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.3, metalness: 0.9, side: T.DoubleSide }),
      fin: new T.MeshStandardMaterial({ color: 0x5d636e, roughness: 0.5, metalness: 0.8, side: T.DoubleSide, transparent: true, alphaTest: 0.5 }),
      leg: new T.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.5, metalness: 0.4 }),
      concrete: new T.MeshStandardMaterial({ color: 0x8c8b87, roughness: 0.95 }),
      darkConcrete: new T.MeshStandardMaterial({ color: 0x4d4c49, roughness: 0.95 }),
      tower: new T.MeshStandardMaterial({ color: 0x3e4552, roughness: 0.55, metalness: 0.7 }),
      white: new T.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.6 }),
      gold: new T.MeshStandardMaterial({ color: 0xd7a94a, roughness: 0.3, metalness: 1 }),
      panel: new T.MeshStandardMaterial({ color: 0x1d3c7a, roughness: 0.25, metalness: 0.6, side: T.DoubleSide }),
      orange: new T.MeshStandardMaterial({ color: 0xd8742a, roughness: 0.5, metalness: 0.5 }),
      hull: new T.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.7, metalness: 0.5 }),
    };
    M.fin.alphaMap = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, w); g.fillStyle = '#fff';
      g.fillRect(0, 0, w, 4); g.fillRect(0, w - 4, w, 4); g.fillRect(0, 0, 4, w); g.fillRect(w - 4, 0, 4, w);
      for (let k = 1; k < 6; k++) { g.fillRect((w * k) / 6 - 1, 0, 2, w); g.fillRect(0, (w * k) / 6 - 1, w, 2); }
    }, { color: false });
    return M;
  }

  function stageTexture(design, steel, soot, first) {
    return canvasTex(512, 1024, (g, w, h) => {
      g.fillStyle = steel ? '#d6dadf' : '#f4f3ef'; g.fillRect(0, 0, w, h);
      if (steel) {
        const rr = rand(5);
        for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rr() < 0.5 ? '255,255,255' : '90,96,104'},${0.05 + rr() * 0.06})`; g.fillRect(rr() * w, 0, 1 + rr() * 2, h); }
        for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(80,86,94,.35)'; g.fillRect(0, y, w, 2); }
      } else {
        for (let y = 0; y < h; y += 90) { g.fillStyle = 'rgba(60,64,72,.12)'; g.fillRect(0, y, w, 2); }
        g.fillStyle = 'rgba(40,44,52,.2)'; g.fillRect(w * 0.73, 0, w * 0.02, h);
      }
      if (first) {
        g.fillStyle = design.color || '#ff7a1a';
        g.fillRect(0, h * 0.58, w, h * 0.018);
        g.save();
        g.translate(w * 0.5, h * 0.33); g.rotate(-Math.PI / 2);
        g.fillStyle = steel ? 'rgba(25,28,34,.7)' : '#1b1f29';
        g.font = '900 54px -apple-system, Segoe UI, Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('A P O G E E', 0, 0);
        g.restore();
      }
      if (soot) {
        const sg = g.createLinearGradient(0, h, 0, h * 0.2);
        sg.addColorStop(0, 'rgba(26,20,14,.92)'); sg.addColorStop(0.3, 'rgba(40,30,22,.6)'); sg.addColorStop(1, 'rgba(40,30,22,0)');
        g.fillStyle = sg; g.fillRect(0, 0, w, h);
        const rr = rand(8);
        for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(30,22,16,${rr() * 0.3})`; g.fillRect(rr() * w, h * (0.2 + rr() * 0.6), 2 + rr() * 6, 30 + rr() * 200); }
      }
    });
  }

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

  function bellGeometry(bw, h) {
    const pts = [];
    const rt = bw * 0.17, re = bw * 0.5;
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      pts.push(new T.Vector2(rt + (re - rt) * Math.pow(k, 0.65), -k * h));
    }
    return new T.LatheGeometry(pts, 28);
  }

  // Plume shader: additive cone, bright core near the nozzle, soft edges.
  function plumeMaterial(core) {
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { time: { value: 0 }, power: { value: 1 }, core: { value: core ? 1 : 0 }, vac: { value: 0 } },
      vertexShader: 'varying float vY; varying float vEdge; void main(){ vY = position.y + 0.5; vec3 n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vEdge = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix*mv; }',
      fragmentShader: [
        'uniform float time; uniform float power; uniform float core; uniform float vac; varying float vY; varying float vEdge;',
        'void main(){',
        '  float along = clamp(vY, 0.0, 1.0);', // 1 at nozzle, 0 at tip
        '  float flick = 0.88 + 0.12*sin(time*61.0 + along*20.0);',
        '  float diamonds = (1.0 - vac) * (1.0 - core) * 0.35 * pow(max(0.0, sin(along*28.0 - time*4.0)), 8.0) * along;',
        '  float i = pow(along, core > 0.5 ? 2.2 : 1.3) * pow(vEdge, 1.6) * flick * power + diamonds * power;',
        '  vec3 hot = vec3(1.0, 0.95, 0.85);',
        '  vec3 warm = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.72, 0.35), along);',
        '  vec3 blue = vec3(0.55, 0.7, 1.0);',
        '  vec3 c = core > 0.5 ? mix(warm, hot, along) : mix(warm, blue, vac*0.5);',
        '  gl_FragColor = vec4(c * i * (core > 0.5 ? 2.6 : 1.5), 1.0);',
        '}',
      ].join('\n'),
    });
  }

  // Build a rocket (or part of one) from a design. Each stage is a group whose origin is its base.
  function buildRocket(design, techs, o) {
    o = o || {};
    const m = mats();
    const geo = D.geometry(design, techs);
    const r = geo.d / 2;
    const steel = geo.steel;
    const root = new T.Group();
    const from = o.from || 0, to = o.to == null ? design.stages.length - 1 : o.to;
    const stages = [];
    let y = 0;
    for (let i = from; i <= to; i++) {
      const st = design.stages[i];
      const h = geo.stages[i].h;
      const g = new T.Group();
      g.position.y = y;
      const bodyMat = (steel ? m.steel : m.paint).clone();
      bodyMat.map = stageTexture(design, steel, i === 0 && o.soot, i === 0);
      const body = new T.Mesh(new T.CylinderGeometry(r, r, h, 64, 1, true), bodyMat);
      body.position.y = h / 2; body.rotation.y = Math.PI; body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      const skirtH = Math.min(1.6, h * 0.08);
      const skirt = new T.Mesh(new T.CylinderGeometry(r * 1.005, r * 1.005, skirtH, 48), m.black);
      skirt.position.y = skirtH / 2; skirt.castShadow = true; g.add(skirt);
      const isTop = i === design.stages.length - 1;
      if (!isTop) {
        const ih = Math.min(2.2, h * 0.1);
        const inter = new T.Mesh(new T.CylinderGeometry(r * 1.005, r * 1.005, ih, 48, 1, true), m.black);
        inter.position.y = h - ih / 2; g.add(inter);
      } else {
        const cap = new T.Mesh(new T.CircleGeometry(r, 48), m.black);
        cap.rotation.x = -Math.PI / 2; cap.position.y = h; g.add(cap);
      }
      // engines
      const eng = S.ENGINES[st.engine];
      const ep = enginePositions(st.count, r, eng.vac);
      const bh = eng.vac ? ep.bw * 1.6 : ep.bw * 1.0;
      const bellG = bellGeometry(ep.bw, bh);
      const glowMat = new T.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
      const glowG = new T.CircleGeometry(ep.bw * 0.48, 20);
      for (const [ex, ez] of ep.pts) {
        const b = new T.Mesh(bellG, eng.vac ? m.bellVac : m.bell);
        b.position.set(ex, 0.05, ez); b.castShadow = true; g.add(b);
        const gl = new T.Mesh(glowG, glowMat);
        gl.rotation.x = Math.PI / 2; gl.position.set(ex, -bh + 0.02, ez); g.add(gl);
      }
      const base = new T.Mesh(new T.CircleGeometry(r, 48), m.black);
      base.rotation.x = Math.PI / 2; base.position.y = 0.02; g.add(base);
      // plume
      const plume = new T.Group();
      plume.position.y = -bh;
      const outerMat = plumeMaterial(false), coreMat = plumeMaterial(true);
      const cone = new T.ConeGeometry(1, 1, 40, 1, true);
      const outer = new T.Mesh(cone, outerMat); outer.rotation.x = Math.PI; outer.position.y = -0.5;
      const inner = new T.Mesh(cone, coreMat); inner.rotation.x = Math.PI; inner.position.y = -0.5;
      const og = new T.Group(); og.add(outer); const ig = new T.Group(); ig.add(inner);
      plume.add(og); plume.add(ig);
      const light = new T.PointLight(0xffa860, 0, 0, 2);
      light.position.y = -r * 2;
      plume.add(light);
      plume.visible = false;
      g.add(plume);
      const stObj = { group: g, h, r, bh, plume, og, ig, light, glowMat, outerMat, coreMat, vac: eng.vac, engines: ep.pts.length, footprint: ep.pts.length > 1 ? r * 0.95 : ep.bw * 0.6 };
      // grid fins and legs on the booster
      if (i === 0 && o.fins) {
        const fs = r * 0.95;
        const finG = new T.PlaneGeometry(fs, fs * 0.8);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          const f = new T.Mesh(finG, m.fin);
          f.position.set(Math.cos(a) * (r + fs * 0.5), h - 1.6 - fs * 0.4, Math.sin(a) * (r + fs * 0.5));
          f.lookAt(f.position.x * 3, f.position.y, f.position.z * 3);
          f.rotateY(Math.PI / 2);
          f.castShadow = true;
          g.add(f);
        }
      }
      if (i === 0 && o.legs) {
        stObj.legs = [];
        const len = r * 2.7 + 2.5;
        const legG = new T.BoxGeometry(r * 0.22, len, r * 0.16);
        legG.translate(0, len / 2, 0);
        const padG = new T.CylinderGeometry(r * 0.28, r * 0.32, 0.25, 16);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          const pivot = new T.Group();
          pivot.position.set(Math.cos(a) * r * 1.02, 0.3, -Math.sin(a) * r * 1.02);
          pivot.rotation.y = a;
          const leg = new T.Group();
          const lm = new T.Mesh(legG, m.leg); lm.castShadow = true; leg.add(lm);
          const pad = new T.Mesh(padG, m.leg); pad.position.y = len; leg.add(pad);
          pivot.add(leg);
          g.add(pivot);
          stObj.legs.push(leg);
        }
        stObj.legLen = len;
      }
      root.add(g);
      stages.push(stObj);
      y += h;
    }
    // fairing and payload
    let fairing = null, payload = null;
    if (to === design.stages.length - 1 && !o.noNose) {
      const nh = geo.nose;
      const prof = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const rad = r * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8)));
        prof.push(new T.Vector2(Math.max(0.001, rad), t * nh));
      }
      fairing = [];
      for (const ph of [0, Math.PI]) {
        const fg = new T.LatheGeometry(prof, 32, ph, Math.PI);
        const fm = new T.Mesh(fg, steel ? m.steel : m.paint);
        fm.castShadow = true;
        const holder = new T.Group(); holder.position.y = y; holder.add(fm);
        root.add(holder);
        fairing.push(holder);
      }
      payload = new T.Group();
      payload.position.y = y + nh * 0.25;
      if (o.crew) {
        const cap = new T.Mesh(new T.CylinderGeometry(r * 0.35, r * 0.75, nh * 0.45, 32), m.white);
        cap.position.y = nh * 0.22; payload.add(cap);
        const shield = new T.Mesh(new T.CylinderGeometry(r * 0.76, r * 0.76, 0.3, 32), m.black);
        payload.add(shield);
      } else {
        const bus = new T.Mesh(new T.BoxGeometry(r * 0.8, nh * 0.35, r * 0.8), m.gold);
        bus.position.y = nh * 0.18; payload.add(bus);
        const wings = new T.Group(); wings.position.y = nh * 0.18;
        for (const s of [-1, 1]) {
          const p = new T.Mesh(new T.PlaneGeometry(r * 2.2, r * 0.7), m.panel);
          p.position.x = s * (r * 0.4 + r * 1.1); p.rotation.x = -Math.PI / 2 + 0.25;
          wings.add(p);
        }
        wings.scale.x = 0.05;
        payload.add(wings);
        payload.userData.wings = wings;
      }
      payload.visible = false;
      root.add(payload);
    }
    return { root, stages, fairing, payload, geo, r, top: y };
  }

  function setPlume(st, power, plume, time) {
    const on = power > 0.01;
    st.plume.visible = on;
    st.glowMat.opacity = on ? 0.9 : 0;
    if (!on) { st.light.intensity = 0; return; }
    const vac = st.vac ? 1 : plume;
    const len = (st.r * 9 + 14) * power * (1 + plume * 0.7) * (0.95 + Math.random() * 0.08);
    const w = st.footprint * (1 + plume * 3.2);
    st.og.scale.set(w * 1.2, len, w * 1.2);
    st.ig.scale.set(st.footprint * 0.75, len * (0.4 + plume * 0.2), st.footprint * 0.75);
    for (const mat of [st.outerMat, st.coreMat]) { mat.uniforms.time.value = time; mat.uniforms.power.value = power; mat.uniforms.vac.value = vac; }
    st.light.intensity = 4e5 * power * (0.9 + Math.random() * 0.2) * (1 - plume * 0.6);
  }

  function setLegs(st, k) {
    if (!st.legs) return;
    for (const leg of st.legs) leg.rotation.z = 0; // stowed: legs lie along the body pointing up
    for (const leg of st.legs) leg.rotation.x = 0;
    // Rotate each leg outward around its pivot's local Z axis (local +X points outward).
    for (const leg of st.legs) leg.rotation.z = -k * 2.45;
  }

  // ---------- Sites ----------
  function groundTex() {
    return canvasTex(512, 512, (g, w) => {
      const fbm = makeNoise(77);
      const img = g.createImageData(w, w);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w;
        const n = fbm(Math.cos(u * 6.283) * 2, Math.sin(u * 6.283) * 2, Math.cos(v * 6.283) * 2 + Math.sin(v * 6.283) * 3, 5);
        const i = (y * w + x) * 4;
        img.data[i] = 70 + n * 70; img.data[i + 1] = 82 + n * 60; img.data[i + 2] = 52 + n * 30; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }
  function waterNormals() {
    return canvasTex(256, 256, (g, w) => {
      const fbm = makeNoise(31);
      const hgt = new Float32Array(w * w);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const u = x / w * 6.283, v = y / w * 6.283;
        hgt[y * w + x] = fbm(Math.cos(u) * 1.5 + 3, Math.sin(u) * 1.5 + Math.cos(v) * 1.5, Math.sin(v) * 1.5 + 7, 5);
      }
      const img = g.createImageData(w, w);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const hx = hgt[y * w + ((x + 1) % w)] - hgt[y * w + ((x - 1 + w) % w)];
        const hy = hgt[((y + 1) % w) * w + x] - hgt[((y - 1 + w) % w) * w + x];
        const nx = -hx * 6, ny = -hy * 6, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * w + x) * 4;
        img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, { color: false });
  }
  let WN = null;
  function ocean(size) {
    if (!WN) { WN = waterNormals(); WN.wrapS = WN.wrapT = T.RepeatWrapping; }
    const n = WN.clone(); n.needsUpdate = true; n.wrapS = n.wrapT = T.RepeatWrapping; n.repeat.set(size / 60, size / 60);
    const mat = new T.MeshStandardMaterial({ color: 0x0b2238, roughness: 0.12, metalness: 0.0, normalMap: n, normalScale: new T.Vector2(0.6, 0.6), envMap: R.env, envMapIntensity: 1.1, transparent: true });
    const mesh = new T.Mesh(new T.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.userData.tick = (t) => { n.offset.set(t * 0.008, t * 0.005); };
    return mesh;
  }

  function lights(scene, target) {
    const sun = new T.DirectionalLight(0xffe0bd, 3.0);
    sun.position.copy(R.sunDir).multiplyScalar(800);
    sun.castShadow = R.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = -160; c.right = 160; c.top = 160; c.bottom = -160; c.near = 10; c.far = 3000;
    sun.shadow.bias = -0.0004;
    scene.add(sun); scene.add(sun.target);
    if (target) sun.target.position.copy(target);
    scene.add(new T.HemisphereLight(0x9cc4ff, 0x40382c, 0.9));
    scene.environment = R.env;
    return sun;
  }

  function lattice(height, width, mat) {
    // Square lattice tower as one instanced mesh.
    const seg = Math.max(5, width * 1.1);
    const levels = Math.ceil(height / seg);
    const count = 4 + levels * 8 + levels * 4;
    const box = new T.BoxGeometry(1, 1, 1);
    const im = new T.InstancedMesh(box, mat, count);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
    let i = 0;
    const put = (px, py, pz, sx, sy, sz, rx, ry, rz) => {
      q.setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)); p.set(px, py, pz); s.set(sx, sy, sz);
      m4.compose(p, q, s); im.setMatrixAt(i++, m4);
    };
    const hw = width / 2, th = Math.max(0.25, width * 0.06);
    for (const [cx, cz] of [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]]) put(cx, height / 2, cz, th * 1.6, height, th * 1.6);
    const diag = Math.hypot(width, seg), ang = Math.atan2(width, seg);
    for (let l = 0; l < levels; l++) {
      const y0 = l * seg + seg / 2;
      put(0, y0, -hw, th, diag, th, 0, 0, ang); put(0, y0, hw, th, diag, th, 0, 0, -ang);
      put(-hw, y0, 0, th, diag, th, ang, 0, 0); put(hw, y0, 0, th, diag, th, -ang, 0, 0);
      put(0, y0, -hw, th, diag, th, 0, 0, -ang); put(0, y0, hw, th, diag, th, 0, 0, ang);
      put(-hw, y0, 0, th, diag, th, -ang, 0, 0); put(hw, y0, 0, th, diag, th, ang, 0, 0);
      const yb = (l + 1) * seg;
      put(0, yb, -hw, width, th, th); put(0, yb, hw, width, th, th); put(-hw, yb, 0, th, th, width); put(hw, yb, 0, th, th, width);
    }
    im.count = i;
    im.castShadow = true;
    return im;
  }

  function scrub(scene, count, radius, keepOut) {
    const geo = new T.IcosahedronGeometry(1, 0);
    const mat = new T.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 1, flatShading: true });
    const im = new T.InstancedMesh(geo, mat, count);
    const rr = rand(21); const m4 = new T.Matrix4();
    let n = 0;
    for (let i = 0; i < count * 3 && n < count; i++) {
      const a = rr() * 6.283, d = keepOut + Math.pow(rr(), 0.6) * radius;
      const s = 1.5 + rr() * 4;
      m4.compose(new T.Vector3(Math.cos(a) * d, s * 0.5, Math.sin(a) * d), new T.Quaternion(), new T.Vector3(s, s * (0.6 + rr() * 0.6), s));
      im.setMatrixAt(n++, m4);
    }
    im.count = n; im.receiveShadow = true;
    scene.add(im);
  }

  function launchSite(scene, geo) {
    const m = mats();
    const g = new T.Group();
    const island = new T.Mesh(new T.CircleGeometry(5000, 96), new T.MeshStandardMaterial({ map: (() => { const t = groundTex(); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(160, 160); return t; })(), roughness: 1 }));
    island.rotation.x = -Math.PI / 2; island.position.y = 0.05; island.receiveShadow = true;
    g.add(island);
    const sea = ocean(400000); sea.position.y = -0.4;
    g.add(sea);
    const pad = new T.Mesh(new T.BoxGeometry(90, 2, 90), m.concrete);
    pad.position.y = 1; pad.receiveShadow = true; pad.castShadow = true; g.add(pad);
    const apron = new T.Mesh(new T.CircleGeometry(160, 48), m.darkConcrete);
    apron.rotation.x = -Math.PI / 2; apron.position.y = 0.12; apron.receiveShadow = true; g.add(apron);
    const mountH = 6;
    const mount = new T.Mesh(new T.CylinderGeometry(geo.d * 0.9, geo.d * 1.1, mountH, 32), m.darkConcrete);
    mount.position.y = 2 + mountH / 2; mount.castShadow = true; mount.receiveShadow = true; g.add(mount);
    const trench = new T.Mesh(new T.BoxGeometry(geo.d * 1.6, 0.5, 70), new T.MeshStandardMaterial({ color: 0x232323, roughness: 1 }));
    trench.position.set(0, 2.05, 20); g.add(trench);
    const tw = Math.max(7, geo.d * 0.9);
    const towerH = geo.total + 12;
    const tower = lattice(towerH, tw, m.tower);
    tower.position.set(-(geo.d / 2 + tw / 2 + 3), 2, 0); g.add(tower);
    // service arm
    const arm = new T.Mesh(new T.BoxGeometry(tw + 3, 2, 2.4), m.tower);
    arm.position.set(-(geo.d / 2 + tw / 2) + 1, 2 + geo.total * 0.8, 0); arm.castShadow = true; g.add(arm);
    // tanks, buildings, lightning masts
    for (const [x, z, rr] of [[-120, -60, 9], [-145, -40, 7], [130, -90, 8]]) {
      const s = new T.Mesh(new T.SphereGeometry(rr, 32, 20), m.white);
      s.position.set(x, rr + 2, z); s.castShadow = true; s.receiveShadow = true; g.add(s);
    }
    for (const [x, z, w, h, d] of [[140, 60, 40, 18, 26], [-170, 90, 60, 26, 30], [220, -30, 28, 12, 18]]) {
      const b = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.8 }));
      b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; g.add(b);
    }
    for (const [x, z] of [[-60, -60], [60, -60], [60, 60], [-60, 60]]) {
      const mast = new T.Mesh(new T.CylinderGeometry(0.4, 0.7, towerH * 1.3, 8), m.tower);
      mast.position.set(x, towerH * 0.65, z); g.add(mast);
    }
    scene.add(g);
    scrub(scene, 600, 2600, 260);
    return { group: g, sea, padTop: 2 + mountH };
  }

  function bargeModel() {
    const m = mats();
    const g = new T.Group();
    const hull = new T.Mesh(new T.BoxGeometry(92, 7, 52), m.hull);
    hull.position.y = 2.5; hull.castShadow = true; hull.receiveShadow = true; g.add(hull);
    const deckTex = canvasTex(512, 512, (c, w) => {
      c.fillStyle = '#3d4149'; c.fillRect(0, 0, w, w);
      const rr = rand(4);
      for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${rr() * 0.15})`; c.fillRect(rr() * w, rr() * w, 10 + rr() * 40, 2 + rr() * 8); }
      c.strokeStyle = '#e7e2d0'; c.lineWidth = 10;
      c.beginPath(); c.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 16; c.beginPath(); c.moveTo(w * 0.36, w * 0.36); c.lineTo(w * 0.64, w * 0.64); c.moveTo(w * 0.64, w * 0.36); c.lineTo(w * 0.36, w * 0.64); c.stroke();
    });
    const deck = new T.Mesh(new T.PlaneGeometry(52, 52), new T.MeshStandardMaterial({ map: deckTex, roughness: 0.8 }));
    deck.rotation.x = -Math.PI / 2; deck.position.y = 6.02; deck.receiveShadow = true; g.add(deck);
    for (const s of [-1, 1]) {
      const wall = new T.Mesh(new T.BoxGeometry(4, 9, 52), m.hull);
      wall.position.set(s * 44, 10, 0); wall.castShadow = true; g.add(wall);
      const crane = new T.Mesh(new T.BoxGeometry(2, 14, 2), m.orange);
      crane.position.set(s * 40, 13, -22); g.add(crane);
    }
    return { group: g, deckY: 6 };
  }

  function padModel() {
    const g = new T.Group();
    const land = new T.Mesh(new T.CircleGeometry(6000, 64), new T.MeshStandardMaterial({ map: (() => { const t = groundTex(); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(200, 200); return t; })(), roughness: 1 }));
    land.rotation.x = -Math.PI / 2; land.receiveShadow = true; g.add(land);
    const padTex = canvasTex(512, 512, (c, w) => {
      c.fillStyle = '#9a9894'; c.fillRect(0, 0, w, w);
      const rr = rand(6);
      for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(0,0,0,${rr() * 0.12})`; c.beginPath(); c.arc(rr() * w, rr() * w, 2 + rr() * 14, 0, 6.3); c.fill(); }
      c.strokeStyle = '#f0ece0'; c.lineWidth = 12;
      c.beginPath(); c.arc(w / 2, w / 2, w * 0.42, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 22; c.beginPath(); c.moveTo(w * 0.32, w * 0.32); c.lineTo(w * 0.68, w * 0.68); c.moveTo(w * 0.68, w * 0.32); c.lineTo(w * 0.32, w * 0.68); c.stroke();
    });
    const pad = new T.Mesh(new T.CylinderGeometry(42, 43, 0.8, 64), [new T.MeshStandardMaterial({ color: 0x8a8884, roughness: 0.95 }), new T.MeshStandardMaterial({ map: padTex, roughness: 0.9 }), new T.MeshStandardMaterial({ color: 0x8a8884 })]);
    pad.position.y = 0.4; pad.receiveShadow = true; g.add(pad);
    return { group: g, deckY: 0.8 };
  }

  function catchModel(geo, armY) {
    const m = mats();
    const g = new T.Group();
    const land = new T.Mesh(new T.CircleGeometry(6000, 64), new T.MeshStandardMaterial({ map: (() => { const t = groundTex(); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(200, 200); return t; })(), roughness: 1 }));
    land.rotation.x = -Math.PI / 2; land.receiveShadow = true; g.add(land);
    const pad = new T.Mesh(new T.BoxGeometry(80, 2, 80), m.concrete); pad.position.y = 1; pad.receiveShadow = true; g.add(pad);
    const tw = Math.max(9, geo.d * 0.9);
    const towerX = -(geo.d / 2 + tw / 2 + 6);
    const tower = lattice(armY + 30, tw, m.tower);
    tower.position.set(towerX, 2, 0); g.add(tower);
    const mount = new T.Mesh(new T.CylinderGeometry(geo.d * 0.9, geo.d * 1.05, 8, 32), m.darkConcrete);
    mount.position.y = 6; mount.castShadow = true; g.add(mount);
    const arms = [];
    for (const s of [-1, 1]) {
      const pivot = new T.Group();
      pivot.position.set(towerX + tw / 2, armY, s * (tw * 0.35));
      const len = geo.d / 2 + tw / 2 + geo.d * 0.9 + 6;
      const a = new T.Mesh(new T.BoxGeometry(len, 2.6, 1.6), m.orange);
      a.position.x = len / 2; a.castShadow = true;
      pivot.add(a);
      pivot.rotation.y = s * 0.55; // open
      g.add(pivot);
      arms.push({ pivot, s });
    }
    const carriage = new T.Mesh(new T.BoxGeometry(tw + 2, 5, tw + 2), m.tower);
    carriage.position.set(towerX, armY + 1, 0); g.add(carriage);
    return { group: g, arms, towerX };
  }

  // ---------- Frame ----------
  // view: { alt (km), earth (bool) }
  function render(nearScene, view) {
    const { renderer, camera, earthCam, skyScene, sky, stars, glare, sunDir } = R;
    const alt = view.alt || 0;
    const fade = Math.max(0, 1 - Math.pow(Math.min(1, alt / 70), 0.8));
    sky.material.uniforms.skyFade.value = fade;
    sky.material.uniforms.rayleigh.value = 1.6 * (0.3 + 0.7 * fade);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    stars.material.opacity = Math.max(0, Math.min(1, (alt - 25) / 40));
    // Day/night (daynight.js): night darkens the low sky, shows stars, dims the sun and turns on pad floodlights.
    const N = (window.APOGEE_DAYNIGHT ? window.APOGEE_DAYNIGHT.flightNight() : 0) * (1 - Math.min(1, alt / 40));
    sky.material.uniforms.skyFade.value = fade * (1 - 0.94 * N);
    stars.material.opacity = Math.max(stars.material.opacity, N * 0.95);
    nightLights(nearScene, N);
    glare.position.copy(camera.position).addScaledVector(sunDir, 700000);
    glare.material.opacity = Math.max(0, Math.min(1, (alt - 30) / 40));
    renderer.toneMappingExposure = 0.6 + (1 - fade) * 0.25;
    renderer.clear();
    renderer.render(skyScene, camera);
    if (alt > 6 && view.earth !== false) {
      const E = buildEarth();
      earthCam.position.set(0, EARTH_R + Math.max(alt, 1), 0);
      earthCam.quaternion.copy(camera.quaternion);
      earthCam.fov = camera.fov; earthCam.near = Math.max(0.5, alt * 0.05); earthCam.updateProjectionMatrix();
      E.clouds.rotation.y += 0.00002;
      renderer.render(E.scene, earthCam);
    }
    renderer.clearDepth();
    renderer.render(nearScene, camera);
  }

  // Day/night: scale the scene's sun/sky lights toward dim moonlight and fade in warm floodlights by the pad.
  function nightLights(scene, N) {
    let L = scene.userData.dn;
    if (!L) {
      L = scene.userData.dn = { lights: [], flood: [], env: scene.environment, n: -1 };
      scene.traverse((o) => { if (o.isDirectionalLight || o.isHemisphereLight || o.isAmbientLight) L.lights.push([o, o.intensity, o.color.clone()]); });
      for (const [x, z] of [[-70, 45], [65, 55], [10, -75]]) { const f = new T.PointLight(0xffc27a, 0, 0, 2); f.position.set(x, 55, z); scene.add(f); L.flood.push(f); }
    }
    if (Math.abs(L.n - N) < 0.002) return;
    L.n = N;
    const moon = new T.Color(0x6a80c0);
    for (const [o, i0, c0] of L.lights) { o.intensity = i0 * (1 - 0.9 * N); o.color.copy(c0).lerp(moon, N); }
    for (const f of L.flood) f.intensity = 1.6e4 * N;
    scene.environment = N > 0.5 ? null : L.env;
  }

  function disposeScene(scene) {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of ms) {
          if (Object.values(M || {}).includes(mm)) continue;
          if (mm.map) mm.map.dispose();
          mm.dispose();
        }
      }
    });
  }

  window.APOGEE_3D = {
    init, resize, render, buildRocket, setPlume, setLegs, Particles, softTex, smokeTex, launchSite, bargeModel, padModel, catchModel, ocean, lights,
    disposeScene, buildEarth, get R() { return R; }, mats,
  };
})();
