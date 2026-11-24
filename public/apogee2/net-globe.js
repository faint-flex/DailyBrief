// Halo network globe: a small rotating 3D Earth with the player's satellite constellation,
// coverage glow and ground stations. Standalone (own WebGLRenderer); never touches APOGEE_3D.init.
// API: window.APOGEE_NETGLOBE.mount(canvas) -> { canvas, update(summary), dispose() }
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) return;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;

  // ---------- region anchors (lat, lon) ----------
  const REGION_LL = {
    na: [40, -98], sa: [-14, -57], eu: [50, 12], af: [4, 21], me: [26, 45], sas: [22, 79], eas: [34, 113], oc: [-25, 134],
  };
  const REGION_ALIAS = [
    [/north.?am|^us|usa|canada/i, 'na'], [/south.?am|latam|brazil/i, 'sa'], [/europe|^eu/i, 'eu'], [/africa|^af/i, 'af'],
    [/middle|mideast|^me/i, 'me'], [/south.?asia|india|^sa?s/i, 'sas'], [/east.?asia|china|japan|^ea/i, 'eas'], [/ocean|austral|^oc|^au/i, 'oc'],
  ];
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function regionLL(id) {
    id = String(id || '');
    if (REGION_LL[id]) return REGION_LL[id];
    for (const [re, k] of REGION_ALIAS) if (re.test(id)) return REGION_LL[k];
    const h = hashStr(id); // unknown id: a stable spot between 45S and 60N
    return [-45 + (h % 1050) / 10, -180 + ((h >>> 11) % 3600) / 10];
  }
  // geographic -> unit vector (same convention as the earth shader)
  function llVec(lat, lon, r) {
    const a = lat * DEG, o = lon * DEG;
    return new T.Vector3(Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o)).multiplyScalar(r || 1);
  }

  // ---------- land mask (rough continents, painted once, shared by all mounts) ----------
  const LAND = [
    // North America
    [-168, 66, -162, 70, -140, 70, -125, 71, -95, 72, -80, 72, -64, 66, -64, 60, -56, 52, -66, 45, -70, 42, -76, 38, -76, 35, -81, 31, -80, 25, -82, 27, -84, 30, -90, 30, -97, 27, -97, 22, -92, 18, -87, 21, -88, 16, -83, 10, -79, 8, -78, 9, -83, 8, -86, 12, -92, 14, -96, 16, -105, 20, -110, 24, -112, 31, -117, 32, -121, 35, -124, 40, -124, 47, -130, 54, -138, 59, -148, 60, -158, 58, -165, 60],
    [-120, 72, -80, 73, -70, 80, -95, 82, -120, 77], // arctic islands
    [-55, 60, -44, 60, -22, 70, -20, 80, -35, 83, -60, 82, -72, 77, -58, 70], // Greenland
    [-24, 64, -14, 64, -14, 66, -22, 66.5], // Iceland
    [-85, 22, -74, 20, -78, 22.5], // Cuba
    // South America
    [-80, 9, -75, 11, -62, 11, -52, 5, -50, 0, -35, -5, -39, -15, -41, -22, -48, -26, -53, -34, -58, -38, -62, -40, -65, -45, -68, -52, -72, -54, -75, -50, -73, -40, -71, -30, -70, -18, -76, -14, -81, -5, -80, 0, -78, 7],
    // Eurasia
    [-10, 36, -9, 43, -1, 46, -4, 48, 2, 51, 8, 54, 9, 57, 11, 56, 14, 55, 21, 55, 23, 59, 28, 60, 21, 61, 22, 65, 25, 65.5, 20, 63, 17, 61, 18, 59, 16, 56, 12, 56, 11, 59, 6, 58, 5, 62, 13, 67, 20, 70, 30, 70, 40, 67, 45, 68, 60, 69, 70, 73, 80, 73, 100, 77, 115, 74, 130, 71, 140, 72, 160, 70, 170, 70, 180, 68, 180, 65, 175, 62, 163, 60, 162, 56, 156, 51, 156, 58, 150, 59, 140, 54, 135, 44, 128, 40, 129, 35, 126, 35, 125, 38, 121, 40, 119, 37, 122, 31, 120, 26, 117, 23, 110, 21, 107, 21, 106, 17, 109, 12, 105, 9, 100, 13, 100, 8, 104, 2, 101, 3, 98, 8, 98, 16, 94, 17, 92, 22, 87, 22, 80, 15, 78, 8, 73, 17, 72, 22, 67, 24, 62, 25, 57, 26, 56, 27, 50, 30, 48, 30, 51, 26, 56, 24, 59, 22, 55, 17, 52, 16, 45, 13, 43, 13, 40, 19, 35, 28, 34, 31, 35, 36, 30, 36, 27, 37, 26, 40, 23, 40, 24, 37, 21, 38, 19, 42, 13, 46, 13, 44, 16, 41, 18, 40, 16, 38, 12, 42, 9, 44, 3, 43, 0, 39, -2, 37, -6, 36],
    [-180, 65, -170, 66, -172, 70, -180, 69], // Chukotka (wraps)
    [-5, 50, 1, 51, 0, 53, -2, 56, -3, 58.5, -6, 58, -5, 55, -3, 54, -5, 52], // Britain
    [-10, 52, -6, 52, -6, 55, -8, 55], // Ireland
    [130, 31, 132, 34, 136, 34, 140, 35, 141, 40, 142, 45, 145, 44, 141, 38, 139, 38, 135, 35, 131, 33], // Japan
    [120, 18, 122, 18, 126, 7, 122, 7, 120, 14], // Philippines
    [95, 5, 98, 4, 106, -6, 104, -6, 95, 2], // Sumatra
    [105, -6, 114, -7, 114, -8.5, 105, -7], // Java
    [109, 1, 110, -3, 116, -4, 119, 1, 117, 7, 113, 3], // Borneo
    [131, -1, 141, -3, 150, -10, 143, -9, 138, -8], // New Guinea
    // Africa
    [-17, 21, -16, 28, -10, 30, -6, 36, 10, 37, 11, 33, 20, 31, 30, 31, 32, 31, 35, 28, 39, 20, 43, 12, 51, 12, 48, 5, 40, -3, 40, -10, 36, -18, 35, -25, 32, -28, 27, -34, 20, -35, 18, -32, 12, -18, 13, -12, 8, -1, 9, 4, 5, 6, -4, 5, -8, 4, -13, 8, -17, 14],
    [44, -25, 47, -25, 50, -15, 49, -12, 44, -17], // Madagascar
    [80, 6, 82, 7, 81, 9.5, 79.8, 8], // Sri Lanka
    // Australia, NZ
    [114, -22, 114, -34, 118, -35, 124, -33, 131, -31, 138, -35, 141, -38, 147, -38, 150, -37, 153, -31, 153, -25, 146, -19, 142, -11, 141, -17, 136, -12, 131, -11, 126, -14, 122, -18],
    [172, -34, 175, -37, 178, -38, 174, -41, 171, -44, 167, -46, 170, -46, 174, -41.5],
  ];
  const WATER = [
    [-95, 58, -88, 56, -80, 52, -78, 58, -82, 63, -90, 64], // Hudson Bay
    [28, 42, 28, 46, 33, 46, 38, 47, 41, 42, 35, 42], // Black Sea
    [47, 45, 50, 47, 54, 45, 53, 38, 49, 38, 47, 42], // Caspian
  ];
  let landCanvas = null;
  function landMask() {
    if (landCanvas) return landCanvas;
    const W = 1024, H = 512;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    try { g.filter = 'blur(1.5px)'; } catch (e) { /* ignore */ }
    const poly = (p, col) => {
      g.fillStyle = col; g.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const x = (p[i] + 180) / 360 * W, y = (90 - p[i + 1]) / 180 * H;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath(); g.fill();
    };
    for (const p of LAND) poly(p, '#fff');
    for (const p of WATER) poly(p, '#000');
    // Antarctica: wobbly cap
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) { const lon = x / W * TAU; const lat = -69 + 3 * Math.sin(lon * 3) + 2 * Math.sin(lon * 7 + 1) - (Math.abs(lon - 5.2) < 0.5 ? 6 : 0); g.lineTo(x, (90 - lat) / 180 * H); }
    g.lineTo(W, H); g.closePath(); g.fill();
    landCanvas = c;
    return c;
  }

  // ---------- shaders ----------
  const NOISE = `
  float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.07 + 1.3; a *= 0.5; } return s; }
  `;
  const EARTH_VS = `
  varying vec3 vN; varying vec3 vW; varying vec3 vL;
  void main(){ vL = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w; }`;
  const EARTH_FS = `
  uniform sampler2D uLand; uniform vec3 uSun; uniform float uCov; uniform float uTime;
  varying vec3 vN; varying vec3 vW; varying vec3 vL;
  ${NOISE}
  void main(){
    vec3 g = normalize(vL);
    float lat = asin(clamp(g.y, -1.0, 1.0));
    float lon = atan(-g.z, g.x);
    vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 + lat / 3.14159265);
    float nz = fbm(g * 9.0);
    vec2 wob = vec2(fbm(g * 6.0 + 4.0), fbm(g * 6.0 + 9.0)) - 0.47;
    float m = texture2D(uLand, uv + wob * 0.012).r;
    float land = smoothstep(0.42, 0.58, m + (nz - 0.47) * 0.35);
    float alat = abs(lat) / 1.5708;
    // land colour by climate band with noise
    float dry = smoothstep(0.12, 0.3, alat) * (1.0 - smoothstep(0.36, 0.5, alat)) + (fbm(g * 4.0 + 20.0) - 0.45) * 0.9;
    vec3 green = mix(vec3(0.10, 0.24, 0.09), vec3(0.18, 0.30, 0.12), fbm(g * 14.0));
    vec3 sand = vec3(0.55, 0.45, 0.28);
    vec3 c = mix(green, sand, smoothstep(0.5, 0.85, dry));
    c = mix(c, vec3(0.22, 0.25, 0.16), smoothstep(0.55, 0.75, alat));
    float ice = smoothstep(0.80, 0.86, alat + (nz - 0.5) * 0.08);
    c = mix(c, vec3(0.88, 0.92, 0.96), ice);
    vec3 sea = mix(vec3(0.02, 0.10, 0.22), vec3(0.03, 0.17, 0.32), smoothstep(0.0, 0.5, m) + nz * 0.2);
    vec3 alb = mix(sea, c, max(land, ice * 0.9));
    // clouds (static wisps)
    float cl = smoothstep(0.52, 0.78, fbm(g * 3.2 + vec3(uTime * 0.004, 0.0, 0.0)) + 0.12 * sin(lat * 6.0));
    alb = mix(alb, vec3(0.92), cl * 0.55);
    vec3 n = normalize(vN);
    float mu = dot(n, uSun);
    float day = smoothstep(-0.12, 0.25, mu);
    vec3 V = normalize(cameraPosition - vW);
    vec3 col = alb * (0.05 + 1.15 * max(mu, 0.0)) + alb * 0.06;
    // sea glint
    vec3 H = normalize(uSun + V);
    col += (1.0 - land) * (1.0 - cl) * pow(max(dot(n, H), 0.0), 60.0) * 0.5 * day;
    // coverage: mid latitudes first, poles last; drawn as a faint hex mesh so it reads without colour
    float dl = abs(degrees(lat));
    float need = dl <= 55.0 ? 0.10 + 0.45 * abs(dl - 42.0) / 42.0 : 0.55 + (dl - 55.0) / 35.0 * 0.4;
    float cov = smoothstep(need - 0.06, need + 0.05, uCov);
    vec2 q = vec2(lon * 18.0, lat * 18.0 * 1.1547);
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 f = abs(fract(q) - 0.5);
    float edge = smoothstep(0.42, 0.5, max(f.x, f.y));
    float pulse = 0.75 + 0.25 * sin(uTime * 1.5 - lat * 3.0);
    vec3 glow = vec3(0.25, 0.75, 1.0);
    col += glow * cov * (0.05 + 0.16 * edge * pulse) * (0.5 + 0.5 * day);
    // night side: a little ambient
    col += vec3(0.01, 0.015, 0.03) * (1.0 - day);
    // rim haze
    float fr = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += vec3(0.30, 0.55, 1.0) * fr * (0.25 + 0.6 * day);
    gl_FragColor = vec4(col, 1.0);
  }`;
  const ATMO_FS = `
  uniform vec3 uSun; uniform float uCov;
  varying vec3 vN; varying vec3 vW; varying vec3 vL;
  void main(){
    vec3 n = normalize(vN); vec3 V = normalize(cameraPosition - vW);
    float r = 1.0 - abs(dot(n, V));
    float a = pow(r, 4.0) * 1.6;
    float day = 0.35 + 0.65 * smoothstep(-0.4, 0.4, dot(n, uSun));
    vec3 c = mix(vec3(0.25, 0.5, 1.0), vec3(0.35, 0.85, 1.0), uCov);
    gl_FragColor = vec4(c * a * day, 1.0);
  }`;
  const SAT_VS = `
  attribute vec4 aOrb; // inclination, raan, phase, radius
  attribute float aSeed;
  uniform float uTime, uSize, uShow; uniform vec3 uSun;
  varying float vLit; varying float vA;
  void main(){
    float w = 0.16 * pow(1.1 / aOrb.w, 1.5);
    float u = aOrb.z + uTime * w;
    vec3 p = vec3(cos(u), 0.0, sin(u)) * aOrb.w;
    float ci = cos(aOrb.x), si = sin(aOrb.x);
    p = vec3(p.x, -p.z * si, p.z * ci);
    float cr = cos(aOrb.y), sr = sin(aOrb.y);
    p = vec3(cr * p.x + sr * p.z, p.y, -sr * p.x + cr * p.z);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    // earth shadow
    float s = dot(wp.xyz, uSun);
    float perp = length(wp.xyz - uSun * s);
    vLit = (s < 0.0 && perp < 1.0) ? 0.28 : 1.0;
    vA = clamp(uShow - aSeed, 0.0, 1.0); // fade-in of newly added sats
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.85 + 0.3 * fract(aSeed * 7.13)) * (5.0 / -mv.z);
  }`;
  const SAT_FS = `
  varying float vLit; varying float vA;
  void main(){
    vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
    if (r > 1.0 || vA <= 0.0) discard;
    float core = smoothstep(0.45, 0.0, r), halo = smoothstep(1.0, 0.0, r) * 0.35;
    vec3 c = mix(vec3(0.55, 0.85, 1.0), vec3(1.0), core) * (core + halo) * vLit * vA;
    gl_FragColor = vec4(c, 1.0);
  }`;
  // ground stations: amber up-pointing triangles with a dark outline (shape differs from the round sats)
  const ST_VS = `
  uniform float uSize, uTime; attribute float aPh;
  varying float vFace; varying float vP;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(wp.xyz);
    vec4 mv = viewMatrix * wp;
    vFace = dot(n, normalize(cameraPosition - wp.xyz));
    vP = 0.5 + 0.5 * sin(uTime * 2.2 + aPh);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (5.0 / -mv.z);
  }`;
  const ST_FS = `
  varying float vFace; varying float vP;
  void main(){
    if (vFace < 0.05) discard;
    vec2 p = gl_PointCoord - vec2(0.5, 0.55); p.y = -p.y;
    // triangle distance (pointing up)
    float k = 1.732;
    vec2 q = vec2(abs(p.x), p.y);
    float d = max(q.x * 0.866 + q.y * 0.5, -q.y) - 0.22;
    if (d > 0.06) discard;
    vec3 c = d > 0.0 ? vec3(0.05, 0.04, 0.02) : mix(vec3(1.0, 0.72, 0.25), vec3(1.0, 0.92, 0.6), vP);
    gl_FragColor = vec4(c, smoothstep(0.06, 0.03, d) * smoothstep(0.05, 0.25, vFace));
  }`;
  // customer glow per region (soft disc on the surface, sized by subscribers)
  const GLOW_FS = `
  varying float vFace; varying float vP; varying float vS;
  void main(){
    if (vFace < 0.0) discard;
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - r), 2.0) * 0.5 * smoothstep(0.0, 0.3, vFace);
    gl_FragColor = vec4(vec3(0.45, 0.85, 1.0) * a, 1.0);
  }`;
  const GLOW_VS = `
  uniform float uSize, uTime; attribute float aSz;
  varying float vFace; varying float vP; varying float vS;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * wp;
    vFace = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)); vP = 0.0; vS = aSz;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aSz * (5.0 / -mv.z);
  }`;

  // ---------- constellation layout (deterministic per index, so the fleet grows stably) ----------
  const SHELLS = [
    { inc: 53, r: 1.100, planes: 24 },
    { inc: 43, r: 1.092, planes: 18 },
    { inc: 70, r: 1.112, planes: 12 },
    { inc: 97.6, r: 1.122, planes: 10 },
  ];
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function layout(cap) {
    const orb = new Float32Array(cap * 4), seed = new Float32Array(cap), shellOf = new Uint8Array(cap);
    const r = rng(7), cnt = [0, 0, 0, 0];
    for (let i = 0; i < cap; i++) {
      let s = 0;
      if (i >= 240) { const x = r(); s = x < 0.45 ? 0 : x < 0.7 ? 1 : x < 0.85 ? 2 : 3; }
      const sh = SHELLS[s], k = cnt[s]++;
      const plane = k % sh.planes, slot = Math.floor(k / sh.planes);
      orb[i * 4] = sh.inc * DEG;
      orb[i * 4 + 1] = (plane / sh.planes) * TAU + s * 0.37;
      orb[i * 4 + 2] = slot * 2.39996 + plane * 0.61 + (r() - 0.5) * 0.02;
      orb[i * 4 + 3] = sh.r + (r() - 0.5) * 0.004;
      seed[i] = i;
      shellOf[i] = s;
    }
    return { orb, seed, shellOf };
  }

  // additive colour that leaves the canvas alpha alone (the canvas is transparent)
  function addBlend(m) {
    m.blending = T.CustomBlending; m.blendEquation = T.AddEquation;
    m.blendSrc = T.OneFactor; m.blendDst = T.OneFactor; m.blendSrcAlpha = T.ZeroFactor; m.blendDstAlpha = T.OneFactor;
    m.transparent = true; m.depthWrite = false;
    return m;
  }

  // ---------- mount ----------
  const live = new Set();
  function mount(canvas) {
    if (!canvas) return null;
    // free contexts left behind by canvases that were thrown away
    for (const h of [...live]) if (!h.canvas.isConnected || h.canvas === canvas) h.dispose();

    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const CAP = small ? 1200 : 3000;
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (e) { console.warn('netglobe: WebGL unavailable', e); return { canvas, update() {}, dispose() {} }; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);
    const sun = new T.Vector3(-0.55, 0.35, 0.75).normalize(); // fixed in view space: lit face toward the viewer
    const world = new T.Group(); scene.add(world);
    const earthG = new T.Group(); world.add(earthG);
    world.rotation.x = 0.32;

    const landTex = new T.CanvasTexture(landMask());
    landTex.wrapS = T.RepeatWrapping; landTex.colorSpace = T.NoColorSpace; landTex.anisotropy = 4;
    const sunW = { value: new T.Vector3() };
    const covU = { value: 0 };
    const timeU = { value: 0 };
    const earthMat = new T.ShaderMaterial({ uniforms: { uLand: { value: landTex }, uSun: sunW, uCov: covU, uTime: timeU }, vertexShader: EARTH_VS, fragmentShader: EARTH_FS });
    const earth = new T.Mesh(new T.SphereGeometry(1, small ? 64 : 96, small ? 48 : 72), earthMat);
    earthG.add(earth);
    const atmo = new T.Mesh(new T.SphereGeometry(1.07, 64, 48), new T.ShaderMaterial({
      uniforms: { uSun: sunW, uCov: covU }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS,
      side: T.BackSide,
    }));
    addBlend(atmo.material);
    world.add(atmo);

    // stars
    const starG = new T.BufferGeometry();
    { const r = rng(11), n = small ? 220 : 420, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const v = new T.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(30); p.set([v.x, v.y, v.z], i * 3); }
      starG.setAttribute('position', new T.BufferAttribute(p, 3)); }
    const stars = new T.Points(starG, new T.PointsMaterial({ color: 0x9fb4d8, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(stars);

    // satellites
    const L = layout(CAP);
    const satG = new T.BufferGeometry();
    satG.setAttribute('position', new T.BufferAttribute(new Float32Array(CAP * 3), 3));
    satG.setAttribute('aOrb', new T.BufferAttribute(L.orb, 4));
    satG.setAttribute('aSeed', new T.BufferAttribute(L.seed, 1));
    satG.setDrawRange(0, 0);
    satG.boundingSphere = new T.Sphere(new T.Vector3(), 1.2);
    const showU = { value: 0 };
    const sizeU = { value: (small ? 7 : 6) * renderer.getPixelRatio() };
    const satMat = new T.ShaderMaterial({ uniforms: { uTime: timeU, uSize: sizeU, uShow: showU, uSun: sunW }, vertexShader: SAT_VS, fragmentShader: SAT_FS });
    addBlend(satMat);
    const sats = new T.Points(satG, satMat);
    sats.frustumCulled = false;
    world.add(sats);

    // faint orbit rings of the shells in use
    const ringMat = addBlend(new T.LineBasicMaterial({ color: new T.Color(0x5fa8ff).multiplyScalar(0.11) }));
    const rings = new T.LineSegments(new T.BufferGeometry(), ringMat);
    world.add(rings);
    let ringKey = '';
    function buildRings(n) {
      const used = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) used[L.shellOf[i]]++;
      const key = used.map((u) => Math.min(u, 12 * 8)).join(',');
      if (key === ringKey) return;
      ringKey = key;
      const pts = [], SEG = 72;
      used.forEach((u, s) => {
        const sh = SHELLS[s];
        const np = Math.min(sh.planes, Math.ceil(u / 8), 8);
        for (let k = 0; k < np; k++) {
          const raan = (Math.round(k * sh.planes / np) / sh.planes) * TAU + s * 0.37, inc = sh.inc * DEG;
          for (let j = 0; j < SEG; j++) {
            for (const jj of [j, j + 1]) {
              const u2 = jj / SEG * TAU;
              let x = Math.cos(u2) * sh.r, z = Math.sin(u2) * sh.r;
              let y = -z * Math.sin(inc); z = z * Math.cos(inc);
              pts.push(Math.cos(raan) * x + Math.sin(raan) * z, y, -Math.sin(raan) * x + Math.cos(raan) * z);
            }
          }
        }
      });
      rings.geometry.dispose();
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      rings.geometry = g;
    }

    // ground stations + customer glows (children of the spinning earth)
    const stSize = { value: (small ? 15 : 13) * renderer.getPixelRatio() };
    const stMat = new T.ShaderMaterial({ uniforms: { uSize: stSize, uTime: timeU }, vertexShader: ST_VS, fragmentShader: ST_FS, transparent: true, depthWrite: false, depthTest: false });
    const stations = new T.Points(new T.BufferGeometry(), stMat); stations.frustumCulled = false; stations.renderOrder = 5;
    const glowSize = { value: 22 * renderer.getPixelRatio() };
    const glowMat = new T.ShaderMaterial({ uniforms: { uSize: glowSize, uTime: timeU }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS });
    addBlend(glowMat);
    const glows = new T.Points(new T.BufferGeometry(), glowMat); glows.frustumCulled = false; glows.renderOrder = 2;
    earthG.add(glows, stations);
    let stKey = '';
    function buildStations(regions) {
      const key = regions.map((r) => `${r.id}:${r.stations | 0}:${Math.round(Math.log10(1 + (r.subs || 0)) * 4)}`).join('|');
      if (key === stKey) return;
      stKey = key;
      const sp = [], ph = [], gp = [], gs = [];
      for (const r of regions) {
        const [lat, lon] = regionLL(r.id);
        const n = Math.min(4, r.stations | 0);
        const rr = rng(hashStr(String(r.id)));
        for (let k = 0; k < n; k++) {
          const v = k === 0 ? llVec(lat, lon, 1.004) : llVec(lat + (rr() - 0.5) * 18, lon + (rr() - 0.5) * 26, 1.004);
          sp.push(v.x, v.y, v.z); ph.push(rr() * 6);
        }
        if ((r.subs || 0) > 0) {
          const v = llVec(lat, lon, 1.002);
          gp.push(v.x, v.y, v.z); gs.push(0.6 + Math.min(2.6, Math.log10(1 + r.subs) * 0.42));
        }
      }
      stations.geometry.dispose(); glows.geometry.dispose();
      const a = new T.BufferGeometry(); a.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); a.setAttribute('aPh', new T.Float32BufferAttribute(ph, 1));
      const b = new T.BufferGeometry(); b.setAttribute('position', new T.Float32BufferAttribute(gp, 3)); b.setAttribute('aSz', new T.Float32BufferAttribute(gs, 1));
      stations.geometry = a; glows.geometry = b;
    }

    // ---------- state ----------
    let target = 0, shown = 0, covTarget = 0;
    let disposed = false, rafId = 0, pollId = 0, detachedAt = 0, onScreen = true;
    let spin = 0, yaw = 0, pitch = 0.32, vyaw = 0, dragging = false, lastX = 0, lastY = 0, idleT = 0;
    let lastT = performance.now(), tSec = 0;

    function resize() {
      const w = Math.max(1, canvas.clientWidth | 0), h = Math.max(1, canvas.clientHeight | 0);
      const pr = renderer.getPixelRatio();
      if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
      }
      // fit the globe + shells (radius ~1.25) in the smaller dimension
      const fitR = 1.34, half = 15 * DEG;
      const k = camera.aspect < 1 ? 1 / camera.aspect : 1;
      camera.position.set(0, 0, (fitR / Math.sin(half)) * k);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }

    function frame() {
      rafId = 0;
      if (disposed) return;
      if (!canvas.isConnected) {
        if (!detachedAt) detachedAt = performance.now();
        if (performance.now() - detachedAt > 3000) { handle.dispose(); return; }
        pollId = setTimeout(frame, 500); return;
      }
      detachedAt = 0;
      if (document.hidden || !onScreen || canvas.clientWidth === 0) { pollId = setTimeout(frame, 400); lastT = performance.now(); return; }
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      tSec += dt;
      timeU.value = tSec;
      resize();
      // grow the visible fleet smoothly
      shown += (target - shown) * Math.min(1, dt * 1.5);
      if (Math.abs(target - shown) < 0.5) shown = target;
      const n = Math.ceil(shown);
      satG.setDrawRange(0, n);
      showU.value = shown;
      covU.value += (covTarget - covU.value) * Math.min(1, dt * 2);
      // motion: slow earth spin, drag with inertia, gentle auto-yaw after idle
      spin += dt * 0.05;
      earthG.rotation.y = spin;
      if (!dragging) {
        idleT += dt;
        yaw += vyaw * dt; vyaw *= Math.pow(0.05, dt);
        if (idleT > 2) yaw += dt * 0.03;
        pitch += (0.32 - pitch) * Math.min(1, dt * 0.4) * (idleT > 2 ? 1 : 0);
      }
      world.rotation.set(pitch, yaw, 0);
      stars.rotation.y = yaw * 0.2;
      // sun fixed relative to the camera, expressed in world space
      sunW.value.copy(sun);
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(frame);
    }
    function wake() { if (!disposed && pollId) { clearTimeout(pollId); pollId = 0; if (!rafId) rafId = requestAnimationFrame(frame); } }

    // visibility
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => { for (const e of es) onScreen = e.isIntersecting; if (onScreen) wake(); });
      io.observe(canvas);
    }
    const onVis = () => { if (!document.hidden) wake(); };
    document.addEventListener('visibilitychange', onVis);

    // drag to spin (touch: horizontal only, so the page still scrolls)
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    const down = (e) => { dragging = true; idleT = 0; lastX = e.clientX; lastY = e.clientY; vyaw = 0; canvas.style.cursor = 'grabbing'; try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      const k = 3.2 / Math.max(120, canvas.clientWidth);
      yaw += dx * k; vyaw = dx * k * 60;
      if (e.pointerType === 'mouse') pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * k));
      idleT = 0;
    };
    const up = () => { dragging = false; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    const handle = {
      canvas,
      update(s) {
        if (disposed || !s) return;
        const orbit = Math.max(0, (s.sats && s.sats.orbit) || 0);
        // up to ~1500 shown 1:1, beyond that compressed into the cap
        target = orbit <= CAP * 0.5 ? orbit : Math.min(CAP, Math.round(CAP * 0.5 + (orbit - CAP * 0.5) * 0.35));
        if (shown > target) shown = target;
        buildRings(target);
        covTarget = Math.max(0, Math.min(1, +s.coverage || 0));
        buildStations(Array.isArray(s.regions) ? s.regions : []);
        wake();
      },
      dispose() {
        if (disposed) return;
        disposed = true; live.delete(handle);
        if (rafId) cancelAnimationFrame(rafId);
        if (pollId) clearTimeout(pollId);
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        landTex.dispose();
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      },
    };
    live.add(handle);
    resize();
    rafId = requestAnimationFrame(frame);
    return handle;
  }

  window.APOGEE_NETGLOBE = { mount, regionLatLon: regionLL };
})();
