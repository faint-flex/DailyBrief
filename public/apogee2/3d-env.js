// 3D env module: the world around the rocket near the ground (loaded after world3d.js).
// Golden-hour coastal launch site: terrain with beach, dunes, scrub and a lagoon, a shader ocean
// reaching the horizon with waves and sun glint, height-aware haze that matches the sky, a pad hill
// with flame trench, launch table, deluge, lattice tower and service arms, lightning masts, tank farm,
// roads and buildings. Also the landing pad, the drone ship and the catch tower.
// Overrides on window.APOGEE_3D: init (sky tuning), render (haze per altitude), launchSite, padModel,
// bargeModel, catchModel, ocean, lights. Adds: groundHeight(x,z,site), envHaze (uniforms).
(function () {
  'use strict';
  const A = window.APOGEE_3D;
  const T = window.THREE;
  if (!A || !T) return;

  const SUN_ELEV = 7, SUN_AZIM = -35; // degrees
  const SKY = { turbidity: 4, rayleigh: 1.6, mie: 0.0045, g: 0.85 };

  // ---------- helpers ----------
  function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function canvasTex(w, h, paint, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    if (srgb !== false) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const small = () => !!(A.R && A.R.small);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------- Preetham sky in JS (same maths as vendor/sky.js) for haze and reflections ----------
  function skyEval(d, sun, P, out) {
    const e = Math.E, pi = Math.PI;
    const tR = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5];
    const MC = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];
    const cutoff = 1.6110731556870734;
    const sunE = 1000 * Math.max(0, 1 - Math.pow(e, -((cutoff - Math.acos(Math.max(-1, Math.min(1, sun[1])))) / 1.5)));
    const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sun[1])));
    const rc = P.rayleigh - (1 - sunfade);
    const c = 0.2 * P.turbidity * 10E-18;
    const za = Math.acos(Math.max(0, d[1]));
    const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 180 / pi, -1.253));
    const sR = 8.4E3 * inv, sM = 1.25E3 * inv;
    const cosT = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
    const rPh = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
    const g2 = P.g * P.g;
    const mPh = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * P.g * cosT + g2, 1.5));
    const k5 = Math.min(1, Math.max(0, Math.pow(1 - sun[1], 5)));
    for (let i = 0; i < 3; i++) {
      const bR = tR[i] * rc, bM = 0.434 * c * MC[i] * P.mie;
      const Fex = Math.exp(-(bR * sR + bM * sM));
      const ratio = (bR * rPh + bM * mPh) / (bR + bM);
      let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
      Lin *= (1 - k5) + k5 * Math.pow(sunE * ratio * Fex, 0.5);
      const L0 = 0.1 * Fex;
      const tex = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
      out[i] = Math.pow(tex, 1 / (1.2 + 1.2 * sunfade));
    }
    return out;
  }

  // ---------- shared haze state ----------
  const H = {
    u: {
      uSkyTex: { value: null }, uAltM: { value: 0 }, uHazeBoost: { value: 0 },
      uDa: { value: 1.1e-4 }, uDr: { value: 2.6e-5 }, uGroundFade: { value: 1 },
      uSunDir: { value: new T.Vector3(0, 1, 0) }, uSunCol: { value: new T.Vector3(1, 1, 1) }, uAmb: { value: new T.Vector3(0.3, 0.4, 0.5) },
    },
    groundMats: new Set(), props: new Set(), fadeOn: false, tuned: false,
  };
  A.envHaze = H.u;

  function buildSkyTable(sunV) {
    const W = 128, Hh = 32, data = new Uint16Array(W * Hh * 4);
    const sun = [sunV.x, sunV.y, sunV.z], o = [0, 0, 0], d = [0, 0, 0];
    const toH = T.DataUtils.toHalfFloat;
    for (let j = 0; j < Hh; j++) {
      const ev = (j + 0.5) / Hh; const y = ev * ev; // elevation sin = ev^2
      for (let i = 0; i < W; i++) {
        const az = ((i + 0.5) / W - 0.5) * Math.PI * 2;
        const ch = Math.sqrt(Math.max(0, 1 - y * y));
        d[0] = Math.cos(az) * ch; d[1] = y; d[2] = Math.sin(az) * ch;
        skyEval(d, sun, SKY, o);
        const k = (j * W + i) * 4;
        data[k] = toH(o[0]); data[k + 1] = toH(o[1]); data[k + 2] = toH(o[2]); data[k + 3] = toH(1);
      }
    }
    const tex = new T.DataTexture(data, W, Hh, T.RGBAFormat, T.HalfFloatType);
    tex.minFilter = tex.magFilter = T.LinearFilter; tex.wrapS = T.RepeatWrapping; tex.wrapT = T.ClampToEdgeWrapping;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    H.u.uSkyTex.value = tex;
    // sun glow colour (near-sun sky) and ambient (zenith) for the water
    skyEval([sunV.x, sunV.y + 0.02, sunV.z].map((v, i, a) => v / Math.hypot(a[0], a[1], a[2])), sun, SKY, o);
    H.u.uSunCol.value.set(o[0], o[1], o[2]);
    skyEval([0, 1, 0], sun, SKY, o);
    H.u.uAmb.value.set(o[0], o[1], o[2]);
  }

  // ---------- sky tuning: golden hour ----------
  function tuneSky(R) {
    const sd = R.sunDir;
    sd.setFromSphericalCoords(1, Math.PI / 2 - T.MathUtils.degToRad(SUN_ELEV), T.MathUtils.degToRad(SUN_AZIM));
    const su = R.sky.material.uniforms;
    su.sunPosition.value.copy(sd).multiplyScalar(450000);
    su.turbidity.value = SKY.turbidity; su.mieCoefficient.value = SKY.mie; su.mieDirectionalG.value = SKY.g;
    // regenerate the reflection environment for the new sun
    try {
      const pm = new T.PMREMGenerator(R.renderer);
      const es = new T.Scene(); const s2 = new window.ApogeeSky(); s2.scale.setScalar(900000);
      const u2 = s2.material.uniforms;
      u2.turbidity.value = SKY.turbidity; u2.rayleigh.value = SKY.rayleigh; u2.mieCoefficient.value = SKY.mie; u2.mieDirectionalG.value = SKY.g;
      u2.sunPosition.value.copy(su.sunPosition.value);
      es.add(s2);
      const old = R.env; R.env = pm.fromScene(es).texture; pm.dispose();
      if (old && old.dispose) old.dispose();
    } catch (e) { /* keep old env */ }
    H.u.uSunDir.value.copy(sd);
    buildSkyTable(sd);
  }
  const oInit = A.init;
  A.init = function (canvas) {
    const R = oInit.apply(this, arguments);
    if (R && !R.__envTuned) { R.__envTuned = true; tuneSky(R); }
    return R;
  };

  // ---------- haze per frame ----------
  const oRender = A.render;
  A.render = function (scene, view) {
    const alt = (view && view.alt) || 0;
    const R = A.R;
    H.u.uAltM.value = alt * 1000;
    H.u.uHazeBoost.value = sstep(6, 30, alt) * 0.6;
    const fade = typeof A.earthBlend === 'function' ? 1 - A.earthBlend(alt) : 1 - sstep(8, 26, alt);
    H.u.uGroundFade.value = fade;
    const wantT = fade < 0.999;
    if (wantT !== H.fadeOn) {
      H.fadeOn = wantT;
      for (const m of H.groundMats) { m.transparent = wantT; m.needsUpdate = true; }
    }
    const showProps = fade > 0.35;
    for (const g of H.props) { g.visible = showProps; }
    for (const m of H.groundMats) if (m.userData.root) m.userData.root.visible = fade > 0.002;
    return oRender.apply(this, arguments);
  };

  // ---------- GLSL ----------
  const HAZE_GLSL = `
uniform sampler2D uSkyTex; uniform float uAltM; uniform float uHazeBoost; uniform float uDa; uniform float uDr; uniform float uGroundFade;
vec3 skyAt(vec3 d){ float az = atan(d.z, d.x) / 6.2831853 + 0.5; float el = sqrt(clamp(d.y, 0.0, 1.0)); return texture2D(uSkyTex, vec2(az, el * 0.96875 + 0.015625)).rgb; }
float hzLayer(float hc, float hp, float Hs){ float dh = hc - hp; if (abs(dh) < 1.0) return exp(-hc / Hs); return Hs * (exp(-hp / Hs) - exp(-hc / Hs)) / dh; }
float hazeAmt(vec3 rel){ float L = length(rel); float hc = max(uAltM, cameraPosition.y); float hp = max(hc + rel.y, 0.0);
  float od = L * (uDa * hzLayer(hc, hp, 1400.0) + uDr * hzLayer(hc, hp, 8000.0));
  float f = 1.0 - exp(-od); return 1.0 - (1.0 - f) * (1.0 - uHazeBoost); }
vec3 hazeCol(vec3 rel){ vec2 h = rel.xz + vec2(1e-4, 0.0); return skyAt(normalize(vec3(h.x, length(h) * 0.035, h.y))); }
`;
  const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 vnoised(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx)); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
  const COAST_GLSL = `
uniform vec4 uCoast; uniform vec4 uLag;
float coastWob(float u){ return 60.0 * sin(u * 0.0021 + 1.3) + 28.0 * sin(u * 0.0057 + 0.4) + 9.0 * sin(u * 0.019 + 2.0); }
float seaDist(vec2 p){ if (uCoast.w < 0.5) return -1e5; vec2 n = uCoast.xy; vec2 t = vec2(-n.y, n.x); return dot(p, n) - uCoast.z + coastWob(dot(p, t)); }
float lagDist(vec2 p){ if (uLag.w < 0.5) return -1e5; vec2 n = uCoast.xy; vec2 t = vec2(-n.y, n.x); float u = dot(p, t);
  float c = uLag.x + uLag.y * sin(u * 0.00059 + 0.7) + 0.4 * uLag.y * sin(u * 0.0017); return uLag.z - abs(dot(p, n) - c); }
`;
  // JS mirrors of the coast functions
  function coastFns(C) {
    const n = [C.nx, C.nz], t = [-C.nz, C.nx];
    const wob = (u) => 60 * Math.sin(u * 0.0021 + 1.3) + 28 * Math.sin(u * 0.0057 + 0.4) + 9 * Math.sin(u * 0.019 + 2.0);
    const sea = (x, z) => x * n[0] + z * n[1] - C.c + wob(x * t[0] + z * t[1]);
    const lag = (x, z) => {
      if (!C.lag) return -1e5;
      const u = x * t[0] + z * t[1];
      const c = C.lag[0] + C.lag[1] * Math.sin(u * 0.00059 + 0.7) + 0.4 * C.lag[1] * Math.sin(u * 0.0017);
      return C.lag[2] - Math.abs(x * n[0] + z * n[1] - c);
    };
    return { sea, lag };
  }

  const HAZE_STD_FRAG = `{
  vec3 hzRel = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  float hzF = hazeAmt(hzRel);
  vec3 hzC = hazeCol(hzRel);
  #ifdef TONE_MAPPING
  hzC = toneMapping(hzC);
  #endif
  hzC = linearToOutputTexel(vec4(hzC, 1.0)).rgb;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hzC, hzF);
  gl_FragColor.a *= uGroundFade * (1.0 - smoothstep(25000.0, 50000.0, length(hzRel.xz)));
}`;

  // Adds height-aware haze matching the sky to a MeshStandardMaterial.
  function hazify(mat, extra, key) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, H.u);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + HAZE_GLSL)
        .replace('#include <fog_fragment>', HAZE_STD_FRAG);
      if (extra) extra(sh, mat);
    };
    mat.customProgramCacheKey = () => 'apg-haze-' + (key || 'std');
    return mat;
  }
  function stdMat(o, extra, key) { return hazify(new T.MeshStandardMaterial(o), extra, key); }

  // ---------- materials ----------
  let EM = null;
  function emats() {
    if (EM) return EM;
    const concTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = '#b4b0a7'; g.fillRect(0, 0, w, w);
      const r = rand(11);
      for (let i = 0; i < 1400; i++) { const v = r(); g.fillStyle = `rgba(${v > 0.5 ? '255,250,240' : '40,38,34'},${r() * 0.09})`; g.fillRect(r() * w, r() * w, 1 + r() * 6, 1 + r() * 6); }
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(60,55,45,${r() * 0.08})`; g.beginPath(); g.arc(r() * w, r() * w, 6 + r() * 30, 0, 6.3); g.fill(); }
      g.strokeStyle = 'rgba(50,48,44,0.16)'; g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * w / 4, 0); g.lineTo(k * w / 4, w); g.moveTo(0, k * w / 4); g.lineTo(w, k * w / 4); g.stroke(); }
    });
    concTex.wrapS = concTex.wrapT = T.RepeatWrapping;
    const cladTex = canvasTex(64, 64, (g, w) => {
      g.fillStyle = '#c4c1ba'; g.fillRect(0, 0, w, w);
      for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,0.09)'; g.fillRect(x, 0, 1.5, w); }
    });
    cladTex.wrapS = cladTex.wrapT = T.RepeatWrapping;
    EM = {
      concTex, cladTex,
      concrete: stdMat({ color: 0xffffff, map: concTex, roughness: 0.92 }),
      concreteDark: stdMat({ color: 0x75726c, roughness: 0.95 }),
      scorched: stdMat({ color: 0x3a3835, roughness: 1 }),
      steel: stdMat({ color: 0x7d8288, roughness: 0.5, metalness: 0.65 }),
      steelDark: stdMat({ color: 0x4a4e54, roughness: 0.55, metalness: 0.6 }),
      white: stdMat({ color: 0xcfccc4, roughness: 0.55, metalness: 0.1 }),
      clad: stdMat({ color: 0xffffff, map: cladTex, roughness: 0.7, metalness: 0.2 }),
      roof: stdMat({ color: 0xa6a8a8, roughness: 0.5, metalness: 0.6 }),
      orange: stdMat({ color: 0xc8682a, roughness: 0.55, metalness: 0.4 }),
      yellow: stdMat({ color: 0xd9b23a, roughness: 0.6, metalness: 0.2 }),
      pipe: stdMat({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.8 }),
      hull: stdMat({ color: 0x33373e, roughness: 0.75, metalness: 0.45 }),
      hullRed: stdMat({ color: 0x6b2a22, roughness: 0.8, metalness: 0.3 }),
      glass: stdMat({ color: 0x223040, roughness: 0.15, metalness: 0.8 }),
      bush: stdMat({ color: 0xffffff, roughness: 1, flatShading: true }),
      trunk: stdMat({ color: 0x4a3c2c, roughness: 1 }),
    };
    return EM;
  }

  // ---------- ocean ----------
  const OCEAN_VERT = `
varying vec3 vWP;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const OCEAN_FRAG = `
precision highp float;
uniform float uTime; uniform sampler2D uWaveTex; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uFoamOn;
varying vec3 vWP;
${HAZE_GLSL}
${NOISE_GLSL}
${COAST_GLSL}
void main(){
  vec3 rel = vWP - cameraPosition; float L = length(rel); vec3 V = -rel / L;
  vec2 p = vWP.xz;
  vec2 gr = vec2(0.0);
  float crest = 0.0;
  // three layers of a tileable wave-spectrum slope map, rotated, scaled and drifting differently
  vec2 q1 = vec2(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8);
  vec4 w1 = texture2D(uWaveTex, p / 173.0 + uTime * vec2(0.0042, 0.0019));
  vec4 w2 = texture2D(uWaveTex, q1 / 61.0 + uTime * vec2(-0.0061, 0.0093));
  vec4 w3 = texture2D(uWaveTex, p.yx / 19.3 + uTime * vec2(0.021, -0.017));
  float a3 = 1.0 - smoothstep(300.0, 1600.0, L);
  vec2 s2 = w2.rg * 2.0 - 1.0; s2 = vec2(s2.x * 0.8 + s2.y * 0.6, -s2.x * 0.6 + s2.y * 0.8);
  gr = (w1.rg * 2.0 - 1.0) * 0.11 + s2 * 0.085 + (w3.gr * 2.0 - 1.0) * 0.06 * a3;
  crest = w1.b * 0.55 + w2.b * 0.45;
  // wind patches: big slow areas of rougher and calmer water
  float patchv = vnoise(p * 0.0021 + vec2(uTime * 0.004, 0.0)) * 0.7 + vnoise(p * 0.0007 + 5.0) * 0.6;
  gr *= 0.55 + patchv * 0.9;
  vec3 N = normalize(vec3(-gr.x, 1.0, -gr.y));
  float NdV = max(dot(N, V), 0.0);
  vec3 Rf = reflect(-V, N); Rf.y = abs(Rf.y);
  vec3 sky = skyAt(Rf);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  float amb = dot(uAmb, vec3(0.3, 0.5, 0.2));
  vec3 deep = vec3(0.006, 0.032, 0.058) * amb * 2.2;
  float sd = seaDist(p); float ld = lagDist(p);
  if (uCoast.w > 0.5 && max(sd, ld) < -max(8.0, L * 0.004) && L < 18000.0) discard; // land covers it
  float shallow = (1.0 - smoothstep(0.0, 120.0, sd)) * step(-1e4, sd);
  vec3 body = mix(deep, vec3(0.05, 0.16, 0.14) * amb * 2.2, shallow * 0.9);
  if (ld > -1e4) body = mix(body, vec3(0.03, 0.07, 0.05) * amb * 2.2, smoothstep(-40.0, 30.0, ld) * 0.7);
  vec3 sunL = normalize(uSunDir);
  body += uSunCol * 0.04 * crest * max(dot(N, sunL) * 0.5 + 0.5, 0.0);
  vec3 col = mix(body, sky * mix(0.85, 0.6, smoothstep(2000.0, 12000.0, L)), F);
  float rough = mix(1600.0, 500.0, smoothstep(100.0, 9000.0, L));
  float sp = pow(max(dot(Rf, sunL), 0.0), rough) * rough * 0.03;
  col += uSunCol * sp * 2.0;
  // shore foam
  if (sd > -1e4) {
    float fb = 1.0 - smoothstep(0.0, 34.0, sd);
    float band = smoothstep(0.55, 1.0, sin(sd * 0.32 - uTime * 1.3 + vnoise(p * 0.05) * 4.0));
    float fn = vnoise(p * 0.35 + uTime * 0.2);
    float foam = fb * clamp(band * fn * 1.6 + (1.0 - smoothstep(0.0, 5.0, sd)) * 0.8, 0.0, 1.0);
    col = mix(col, (uAmb * 1.1 + uSunCol * 0.25), foam * 0.85);
  }
  // sparse whitecaps
  float wc = smoothstep(0.9, 0.98, crest + vnoise(p * 0.03 + uTime * 0.05) * 0.2) * smoothstep(60.0, 250.0, L) * (1.0 - smoothstep(600.0, 2500.0, L)) * uFoamOn;
  wc *= smoothstep(0.45, 0.8, w3.b) * smoothstep(0.3, 0.7, w2.b);
  col = mix(col, uAmb * 1.1 + uSunCol * 0.2, wc * 0.35);
  float hf = hazeAmt(rel);
  col = mix(col, hazeCol(rel), hf);
  gl_FragColor = vec4(col, uGroundFade * (1.0 - smoothstep(40000.0, 140000.0, length(rel.xz))));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

  // Tileable slope map from a random directional wave spectrum (R,G = slope x,z; B = height).
  let WAVETEX = null;
  function waveTex() {
    if (WAVETEX) return WAVETEX;
    const N = 256, r = rand(1234);
    const waves = [];
    for (let i = 0; i < 90; i++) {
      const km = 2 + Math.pow(r(), 1.6) * 30; // cycles per tile
      const ang = 0.5 + (r() - 0.5) * 2.4 * (r() < 0.8 ? 0.6 : 1.4);
      const kx = Math.round(Math.cos(ang) * km), kz = Math.round(Math.sin(ang) * km);
      if (!kx && !kz) continue;
      const k = Math.hypot(kx, kz);
      waves.push([kx, kz, 1 / Math.pow(k, 1.9), r() * Math.PI * 2]);
    }
    const sx = new Float32Array(N * N), sz = new Float32Array(N * N), h = new Float32Array(N * N);
    let mx = 0, mh = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let ax = 0, az = 0, hh = 0;
      for (const [kx, kz, A, ph] of waves) {
        const t = (kx * x + kz * y) / N * Math.PI * 2 + ph;
        const c = Math.cos(t), s = Math.sin(t);
        // trochoid-ish sharpening: crest gets a sharper slope
        hh += A * s; ax += A * kx * c; az += A * kz * c;
      }
      const i = y * N + x; sx[i] = ax; sz[i] = az; h[i] = hh;
      mx = Math.max(mx, Math.abs(ax), Math.abs(az)); mh = Math.max(mh, Math.abs(hh));
    }
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = Math.round((sx[i] / mx * 0.5 + 0.5) * 255);
      data[i * 4 + 1] = Math.round((sz[i] / mx * 0.5 + 0.5) * 255);
      data[i * 4 + 2] = Math.round((h[i] / mh * 0.5 + 0.5) * 255);
      data[i * 4 + 3] = 255;
    }
    const t = new T.DataTexture(data, N, N, T.RGBAFormat, T.UnsignedByteType);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    WAVETEX = t;
    return t;
  }

  function ocean(size) {
    const uni = Object.assign({}, H.u, {
      uTime: { value: 0 }, uWaveTex: { value: waveTex() }, uCoast: { value: new T.Vector4(0, 0, 0, 0) }, uLag: { value: new T.Vector4(0, 0, 0, 0) }, uFoamOn: { value: 1 },
    });
    const mat = new T.ShaderMaterial({
      uniforms: uni, vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG,
          });
    const mesh = new T.Mesh(new T.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    let tUser = null, tSet = 0;
    mesh.userData.tick = (t) => { tUser = t; tSet = performance.now(); };
    mesh.onBeforeRender = () => {
      const now = performance.now();
      uni.uTime.value = (tUser !== null && now - tSet < 500) ? tUser : now / 1000;
    };
    mesh.userData.setCoast = (C) => {
      uni.uCoast.value.set(C.nx, C.nz, C.c, 1);
      if (C.lag) uni.uLag.value.set(C.lag[0], C.lag[1], C.lag[2], 1);
    };
    mat.userData.root = mesh;
    H.groundMats.add(mat);
    return mesh;
  }

  // ---------- terrain ----------
  const TERRAIN_FRAG = `
uniform vec4 uClear[4];
varying vec3 vWP;
${NOISE_GLSL}
${COAST_GLSL}
vec3 terrainAlbedo(vec2 p, float L){
  float fineW = 1.0 - smoothstep(120.0, 900.0, L);
  float midW = 1.0 - smoothstep(2500.0, 12000.0, L);
  float n1 = vnoise(p * 0.0035), n2 = vnoise(p * 0.017 + 7.0), n3 = vnoise(p * 0.09 + 3.0), n4 = vnoise(p * 0.5);
  float n5 = vnoise(p * 0.0009 + 11.0);
  vec3 scrubG = vec3(0.052, 0.058, 0.034), scrubB = vec3(0.110, 0.092, 0.060), soil = vec3(0.115, 0.095, 0.065), grass = vec3(0.075, 0.085, 0.040);
  vec3 c = mix(scrubG, scrubB, smoothstep(0.3, 0.8, n1 * 0.7 + n5 * 0.3));
  c = mix(c, grass, smoothstep(0.45, 0.8, n2) * 0.55);
  c *= mix(1.0, 0.65 + 0.7 * smoothstep(0.2, 0.8, vnoise(p * 0.006 + 3.0)), midW);
  c = mix(c, soil, smoothstep(0.7, 0.92, mix(0.5, n3, midW)) * 0.5);
  float n6 = vnoise(p * 2.7); float n7 = vnoise(p * 9.0);
  c *= 0.8 + 0.4 * mix(0.5, n4, fineW) * mix(1.0, n3 + 0.5, fineW * 0.5);
  float vf = 1.0 - smoothstep(25.0, 140.0, L); c *= mix(1.0, 0.65 + 0.45 * n6 + 0.25 * (n7 - 0.5), vf);
  float sd = seaDist(p); float ld = lagDist(p);
  vec3 sand = vec3(0.56, 0.47, 0.33) * (0.88 + 0.24 * mix(0.5, n3, midW));
  vec3 wet = vec3(0.30, 0.25, 0.18);
  float beach = smoothstep(-105.0, -68.0, sd + (n2 - 0.5) * 36.0);
  float dune = smoothstep(-150.0, -95.0, sd + (n3 - 0.5) * 30.0) * (1.0 - beach);
  c = mix(c, mix(c, sand, 0.45), dune * 0.8);
  c = mix(c, sand, beach);
  c = mix(c, wet, smoothstep(-16.0, -3.0, sd));
  c = mix(c, vec3(0.07, 0.085, 0.035), smoothstep(-160.0, -25.0, ld) * 0.6);
  c = mix(c, vec3(0.16, 0.14, 0.10), smoothstep(-8.0, 0.0, ld));
  for (int i = 0; i < 4; i++) {
    vec4 cl = uClear[i];
    if (cl.z > 0.0) {
      float dd = length(p - cl.xy) - cl.z + (n2 - 0.5) * 26.0;
      vec3 grav = mix(vec3(0.17, 0.16, 0.14), vec3(0.12, 0.11, 0.09), n3) * (0.85 + 0.3 * mix(0.5, n4, fineW));
      c = mix(c, grav, (1.0 - smoothstep(-6.0, 22.0, dd)) * cl.w);
    }
  }
  return c;
}`;

  function terrainMaterial(C, clears) {
    const uC = { value: new T.Vector4(C.nx, C.nz, C.c, 1) };
    const uL = { value: C.lag ? new T.Vector4(C.lag[0], C.lag[1], C.lag[2], 1) : new T.Vector4() };
    const cl = [0, 1, 2, 3].map((i) => new T.Vector4().fromArray(clears[i] || [0, 0, 0, 0]));
    const mat = stdMat({ color: 0xffffff, roughness: 1, metalness: 0 }, (sh) => {
      sh.uniforms.uCoast = uC; sh.uniforms.uLag = uL; sh.uniforms.uClear = { value: cl };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG)
        .replace('#include <map_fragment>', `float tL = length(vWP - cameraPosition);
if (max(seaDist(vWP.xz), lagDist(vWP.xz)) > max(4.0, tL * 0.004)) discard;
diffuseColor.rgb *= terrainAlbedo(vWP.xz, tL) * 1.45;`);
    }, 'terrain');
    H.groundMats.add(mat);
    return mat;
  }

  // Coast layout C: {nx, nz, c, lag:[centre, amp, halfWidth]}; ground level is y=0, sea level y=SEA.
  const SEA = -2;
  function heightFn(C, flats) {
    const f = coastFns(C);
    const nz = (x, z) => Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * Math.cos(z * 0.009 - x * 0.003) + 0.5 * Math.sin(x * 0.031 + z * 0.027);
    return (x, z) => {
      const sd = f.sea(x, z), ld = f.lag(x, z);
      let h;
      if (sd > 0) h = -Math.min(sd * 0.022 + sd * sd * 0.00003, 40);
      else {
        h = 2.2 * sstep(0, -120, sd) + 3.4 * Math.exp(-Math.pow((sd + 92) / 24, 2)) + 1.6 * Math.exp(-Math.pow((sd + 128) / 18, 2));
        h += nz(x, z) * 0.7 * sstep(-180, -420, sd);
      }
      if (ld > -1e4) h = Math.min(h, -ld * 0.025);
      let y = h + SEA;
      for (const fl of flats) {
        const dd = Math.hypot(x - fl[0], z - fl[1]);
        const k = 1 - sstep(fl[2], fl[2] + fl[3], dd);
        y = y * (1 - k) + (fl[4] || 0) * k;
      }
      return y;
    };
  }
  function terrain(C, flats, clears) {
    const hf = heightFn(C, flats);
    const seg = small() ? 96 : 144, rings = small() ? 70 : 84;
    const R0 = 10, gr = 0.075;
    const pos = [], idx = [];
    pos.push(0, hf(0, 0), 0);
    for (let i = 1; i <= rings; i++) {
      const r = R0 * (Math.pow(1 + gr, i) - 1) / gr;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2 + (i % 2) * (Math.PI / seg);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, hf(x, z), z);
      }
    }
    for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
    for (let i = 1; i < rings; i++) {
      const b0 = 1 + (i - 1) * seg, b1 = 1 + i * seg;
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        idx.push(b0 + j, b0 + j1, b1 + j); idx.push(b0 + j1, b1 + j1, b1 + j);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mat = terrainMaterial(C, clears);
    const mesh = new T.Mesh(g, mat);
    mesh.receiveShadow = true; mesh.frustumCulled = false;
    mat.userData.root = mesh;
    mesh.userData.height = hf;
    return mesh;
  }

  // ---------- vegetation ----------
  function vegetation(group, C, hf, keep, count, radius) {
    const f = coastFns(C);
    const n = small() ? Math.floor(count * 0.4) : count;
    const em = emats();
    const geo = new T.IcosahedronGeometry(1, 1);
    const bushes = new T.InstancedMesh(geo, em.bush, n);
    const treesN = Math.floor(n / 6);
    const crownGeo = new T.IcosahedronGeometry(1, 1);
    const crowns = new T.InstancedMesh(crownGeo, em.bush, treesN);
    const trunks = new T.InstancedMesh(new T.CylinderGeometry(0.18, 0.3, 1, 5), em.trunk, treesN);
    const rr = rand(21); const m4 = new T.Matrix4(); const q = new T.Quaternion(); const col = new T.Color();
    let b = 0, t = 0;
    const ok = (x, z) => {
      const sd = f.sea(x, z), ld = f.lag(x, z);
      if (sd > -75 || ld > -6) return false;
      for (const k of keep) if (Math.hypot(x - k[0], z - k[1]) < k[2]) return false;
      return true;
    };
    for (let i = 0; i < n * 6 && (b < n || t < treesN); i++) {
      const a = rr() * Math.PI * 2, d = 40 + Math.pow(rr(), 0.75) * radius;
      // clumping
      const x = Math.cos(a) * d + (rr() - 0.5) * 20, z = Math.sin(a) * d + (rr() - 0.5) * 20;
      if (!ok(x, z)) continue;
      const clump = Math.sin(x * 0.013) * Math.cos(z * 0.011) + Math.sin((x + z) * 0.005);
      if (clump < -0.3 && rr() < 0.7) continue;
      const y = hf(x, z);
      const tree = rr() < 0.17 && t < treesN;
      if (tree) {
        const h = 4 + rr() * 6;
        m4.compose(new T.Vector3(x, y + h * 0.5, z), q.identity(), new T.Vector3(1 + h * 0.03, h, 1 + h * 0.03)); trunks.setMatrixAt(t, m4);
        const cs = 2.6 + rr() * 2.6;
        q.setFromEuler(new T.Euler(0, rr() * 6, 0));
        m4.compose(new T.Vector3(x, y + h + cs * 0.1, z), q, new T.Vector3(cs * 1.5 * (0.8 + rr() * 0.4), cs * 0.55, cs * 1.5)); crowns.setMatrixAt(t, m4);
        col.setRGB(0.035 + rr() * 0.02, 0.045 + rr() * 0.02, 0.022); crowns.setColorAt(t, col);
        t++;
      } else if (b < n) {
        const s = 0.9 + rr() * 2.6;
        q.setFromEuler(new T.Euler(0, rr() * 6, 0));
        m4.compose(new T.Vector3(x, y + s * 0.25, z), q, new T.Vector3(s * (1 + rr() * 0.6), s * (0.45 + rr() * 0.35), s));
        bushes.setMatrixAt(b, m4);
        const dry = rr();
        col.setRGB(0.035 + dry * 0.06, 0.042 + dry * 0.04, 0.022 + dry * 0.02); bushes.setColorAt(b, col);
        b++;
      }
    }
    bushes.count = b; crowns.count = t; trunks.count = t;
    for (const m of [bushes, crowns, trunks]) { m.castShadow = !small(); m.receiveShadow = true; group.add(m); }
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  }

  // ---------- roads ----------
  let ROADTEX = null;
  function road(group, pts, width, y) {
    if (!ROADTEX) {
      ROADTEX = canvasTex(64, 256, (g, w, h) => {
        g.fillStyle = '#3a3936'; g.fillRect(0, 0, w, h);
        const r = rand(5);
        for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() * 0.06})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
        g.fillStyle = 'rgba(210,205,190,0.8)'; g.fillRect(2, 0, 2, h); g.fillRect(w - 4, 0, 2, h);
        g.fillStyle = 'rgba(220,190,90,0.85)'; g.fillRect(w / 2 - 1.5, 0, 3, h * 0.55);
      });
      ROADTEX.wrapS = ROADTEX.wrapT = T.RepeatWrapping;
    }
    const mat = stdMat({ map: ROADTEX, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const pos = [], uv = [], idx = [];
    let len = 0;
    // densify
    const P = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 25));
      for (let k = 0; k < n; k++) P.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
    }
    P.push(pts[pts.length - 1]);
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (i > 0) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const yy = typeof y === 'function' ? y(P[i][0], P[i][1]) : y;
      pos.push(P[i][0] - dz * width / 2, yy + 0.06, P[i][1] + dx * width / 2, P[i][0] + dz * width / 2, yy + 0.06, P[i][1] - dx * width / 2);
      uv.push(0, len / 40, 1, len / 40);
      if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat); m.receiveShadow = true;
    group.add(m);
    return m;
  }

  // ---------- structure helpers ----------
  function box(parent, w, h, d, mat, x, y, z, cast) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = cast !== false; m.receiveShadow = true;
    parent.add(m); return m;
  }
  function cyl(parent, rt, rb, h, mat, x, y, z, seg) {
    const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 16), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  }
  // a pipe between two points
  function pipe(parent, a, b, r, mat) {
    const v = new T.Vector3().subVectors(b, a); const l = v.length();
    const m = new T.Mesh(new T.CylinderGeometry(r, r, l, 8), mat);
    m.position.copy(a).addScaledVector(v, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize());
    m.castShadow = true; parent.add(m); return m;
  }

  // Square lattice tower: four chords, X-bracing on every face, ring beams, platforms and a core.
  function latticeTower(height, width, mat, opt) {
    opt = opt || {};
    const g = new T.Group();
    const seg = Math.max(4.5, width * 0.75);
    const levels = Math.max(1, Math.round(height / seg));
    const sg = height / levels;
    const im = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), mat, 4 + levels * 12 + 8);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), eu = new T.Euler();
    let i = 0;
    const put = (px, py, pz, sx, sy, sz, rx, ry, rz) => { eu.set(rx || 0, ry || 0, rz || 0); q.setFromEuler(eu); p.set(px, py, pz); s.set(sx, sy, sz); m4.compose(p, q, s); im.setMatrixAt(i++, m4); };
    const hw = width / 2, th = Math.max(0.22, width * 0.035), ch = th * 2.6;
    for (const [cx, cz] of [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]]) put(cx, height / 2, cz, ch, height, ch);
    const diag = Math.hypot(width, sg), ang = Math.atan2(width, sg);
    for (let l = 0; l < levels; l++) {
      const y0 = l * sg + sg / 2;
      put(0, y0, -hw, th, diag, th, 0, 0, ang); put(0, y0, hw, th, diag, th, 0, 0, -ang);
      put(-hw, y0, 0, th, diag, th, ang, 0, 0); put(hw, y0, 0, th, diag, th, -ang, 0, 0);
      put(0, y0, -hw, th, diag, th, 0, 0, -ang); put(0, y0, hw, th, diag, th, 0, 0, ang);
      put(-hw, y0, 0, th, diag, th, -ang, 0, 0); put(hw, y0, 0, th, diag, th, ang, 0, 0);
      const yb = (l + 1) * sg;
      put(0, yb, -hw, width, th * 1.6, th * 1.6); put(0, yb, hw, width, th * 1.6, th * 1.6); put(-hw, yb, 0, th * 1.6, th * 1.6, width); put(hw, yb, 0, th * 1.6, th * 1.6, width);
    }
    im.count = i; im.castShadow = true; im.receiveShadow = true;
    g.add(im);
    // elevator core and platforms
    const em = emats();
    const core = box(g, width * 0.42, height, width * 0.42, em.steelDark, 0, height / 2, 0);
    core.castShadow = true;
    const every = Math.max(2, Math.round(levels / (small() ? 4 : 8)));
    for (let l = every; l < levels; l += every) {
      box(g, width + 1.4, 0.35, width + 1.4, em.steelDark, 0, l * sg, 0);
      box(g, width + 1.4, 1.1, 0.08, em.yellow, 0, l * sg + 0.7, (width + 1.4) / 2, false);
      box(g, width + 1.4, 1.1, 0.08, em.yellow, 0, l * sg + 0.7, -(width + 1.4) / 2, false);
    }
    // roof and lightning rod
    box(g, width + 1, 0.6, width + 1, em.steelDark, 0, height + 0.3, 0);
    if (opt.rod !== false) {
      cyl(g, 0.12, 0.35, height * 0.18, em.steel, 0, height + height * 0.09, 0, 6);
      cyl(g, 0.06, 0.06, height * 0.05, em.white, 0, height + height * 0.2, 0, 6);
    }
    return g;
  }

  // Truss arm along +x, length len, depth d (y), width w (z). Built from boxes.
  function trussArm(len, d, w, mat, chordMat) {
    const g = new T.Group();
    const th = Math.max(0.18, d * 0.08);
    for (const y of [-d / 2, d / 2]) for (const z of [-w / 2, w / 2]) box(g, len, th * 1.5, th * 1.5, chordMat || mat, len / 2, y, z);
    const n = Math.max(2, Math.round(len / (d * 1.1)));
    const sl = len / n;
    const dl = Math.hypot(sl, d), an = Math.atan2(sl, d);
    for (let k = 0; k < n; k++) {
      const x = (k + 0.5) * sl;
      for (const z of [-w / 2, w / 2]) {
        const m = box(g, th, dl, th, mat, x, 0, z); m.rotation.z = (k % 2 ? 1 : -1) * an;
      }
      box(g, th, th, w, mat, k * sl, d / 2, 0); box(g, th, th, w, mat, k * sl, -d / 2, 0);
    }
    return g;
  }

  // ---------- decals ----------
  function targetTex(bg, light, dark, scorch) {
    return canvasTex(1024, 1024, (c, w) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, w);
      const r = rand(6);
      for (let i = 0; i < 2200; i++) { c.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.07})`; c.fillRect(r() * w, r() * w, 2 + r() * 10, 2 + r() * 10); }
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
      for (let k = 1; k < 8; k++) { c.beginPath(); c.moveTo(k * w / 8, 0); c.lineTo(k * w / 8, w); c.moveTo(0, k * w / 8); c.lineTo(w, k * w / 8); c.stroke(); }
      if (scorch) {
        const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w * 0.3);
        gr.addColorStop(0, 'rgba(10,8,6,0.75)'); gr.addColorStop(0.6, 'rgba(20,16,12,0.35)'); gr.addColorStop(1, 'rgba(20,16,12,0)');
        c.fillStyle = gr; c.fillRect(0, 0, w, w);
      }
      c.strokeStyle = light; c.lineWidth = 34;
      c.beginPath(); c.arc(w / 2, w / 2, w * 0.40, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 14;
      c.beginPath(); c.arc(w / 2, w / 2, w * 0.30, 0, Math.PI * 2); c.stroke();
      c.fillStyle = light;
      // four pointers aiming at the centre
      for (let k = 0; k < 4; k++) {
        c.save(); c.translate(w / 2, w / 2); c.rotate(k * Math.PI / 2 + Math.PI / 4);
        c.beginPath(); c.moveTo(0, -w * 0.12); c.lineTo(-w * 0.045, -w * 0.25); c.lineTo(w * 0.045, -w * 0.25); c.closePath(); c.fill();
        c.restore();
      }
      c.beginPath(); c.arc(w / 2, w / 2, w * 0.05, 0, Math.PI * 2); c.fill();
      if (dark) { c.fillStyle = dark; c.beginPath(); c.arc(w / 2, w / 2, w * 0.025, 0, Math.PI * 2); c.fill(); }
      if (scorch) {
        for (let i = 0; i < 60; i++) { const a = r() * 6.3, d = r() * w * 0.25; c.fillStyle = `rgba(0,0,0,${r() * 0.2})`; c.beginPath(); c.ellipse(w / 2 + Math.cos(a) * d, w / 2 + Math.sin(a) * d, 4 + r() * 20, 2 + r() * 6, a, 0, 6.3); c.fill(); }
      }
    });
  }

  function registerProps(g) { H.props.add(g); return g; }

  // ---------- lights ----------
  function lights(scene, target) {
    const R = A.R;
    const sun = new T.DirectionalLight(0xffb470, 4.2);
    sun.position.copy(R.sunDir).multiplyScalar(1500);
    sun.castShadow = R.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = -170; c.right = 170; c.top = 170; c.bottom = -170; c.near = 10; c.far = 4000;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
    scene.add(sun); scene.add(sun.target);
    if (target) { sun.target.position.copy(target); sun.position.add(target); }
    scene.add(new T.HemisphereLight(0x8aa6d8, 0x4a3e30, 0.6));
    scene.environment = R.env;
    scene.fog = null;
    return sun;
  }

  // ---------- launch site ----------
  const LAUNCH_COAST = { nx: 0.2, nz: 0.98, c: 520, lag: [-3400, 260, 300] }; // sea toward +z (east), matches the Earth scene

  function padHill(g, top, half, slope, trench) {
    // Raised pad hill: concrete plateau with grass slopes; a trench gap is left open on +x.
    const em = emats();
    const outer = half + slope;
    const shape = new T.Shape();
    shape.moveTo(-outer, -outer); shape.lineTo(outer, -outer); shape.lineTo(outer, outer); shape.lineTo(-outer, outer); shape.closePath();
    const hillMat = stdMat({ color: 0x7a7458, roughness: 1 });
    // four sloped sides as frustum pieces
    const sides = new T.Mesh(new T.CylinderGeometry(half * Math.SQRT2, outer * Math.SQRT2, top, 4, 1, true), hillMat);
    sides.rotation.y = Math.PI / 4; sides.position.y = top / 2; sides.receiveShadow = true; g.add(sides);
    const tw = trench ? trench.w : 0;
    const slab = (x0, x1, z0, z1) => {
      const m = new T.Mesh(new T.BoxGeometry(x1 - x0, 0.6, z1 - z0), em.concrete);
      m.position.set((x0 + x1) / 2, top - 0.3, (z0 + z1) / 2); m.receiveShadow = true; m.castShadow = false;
      const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 24, uv.getY(i) * (z1 - z0) / 24);
      g.add(m);
    };
    if (!trench) { slab(-half, half, -half, half); return; }
    const x0 = trench.x0;
    slab(-half, half, -half, -tw / 2); slab(-half, half, tw / 2, half); slab(-half, x0, -tw / 2, tw / 2);
    // trench: floor, walls, deflector, and the cut through the slope
    const floorY = 0.6;
    const len = half + slope - x0 + 6;
    box(g, len, 0.6, tw, em.scorched, x0 + len / 2, floorY - 0.3, 0, false);
    for (const s of [-1, 1]) {
      const wall = box(g, half - x0, top - floorY, 1.6, em.concreteDark, x0 + (half - x0) / 2, floorY + (top - floorY) / 2, s * (tw / 2 + 0.8));
      wall.castShadow = false;
      // wing walls down the slope
      const ww = new T.Mesh(new T.BoxGeometry(Math.hypot(slope, top), 1.6, 1.6), em.concreteDark);
      ww.position.set(half + slope / 2, top / 2 - 0.4, s * (tw / 2 + 0.8)); ww.rotation.z = -Math.atan2(top, slope); g.add(ww);
    }
    box(g, 1.6, top - floorY, tw, em.concreteDark, x0 - 0.8, floorY + (top - floorY) / 2, 0, false);
    // flame deflector wedge
    const dw = new T.Mesh(new T.BoxGeometry(tw * 0.9, top * 0.9, tw * 0.98), em.scorched);
    dw.position.set(x0 + tw * 0.1, floorY + top * 0.22, 0); dw.rotation.z = -0.85; dw.scale.set(1, 1, 1); g.add(dw);
    // fill the slope cut so the trench mouth reads as an opening
    const mouth = box(g, slope + 4, 0.3, tw + 3, em.scorched, half + slope / 2, 0.3, 0, false);
    mouth.receiveShadow = true;
  }

  // Open ring table: the rocket sits on clamps at its base edge, the engines and flame are
  // visible through the ring; slanted legs stand on the trench edges.
  function launchMount(g, geo, base, mountH, trenchW) {
    const em = emats();
    const d = geo.d, rIn = d * 0.5 + Math.max(0.8, d * 0.12), rw = Math.max(1.0, d * 0.16), th = Math.max(0.7, d * 0.1);
    const top = base + mountH;
    const ringY = top - 0.35 - th;
    const sh = new T.Shape(); sh.absarc(0, 0, rIn + rw, 0, Math.PI * 2, false);
    const hole = new T.Path(); hole.absarc(0, 0, rIn, 0, Math.PI * 2, true); sh.holes.push(hole);
    const ring = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false, curveSegments: 40 }), em.steelDark);
    ring.rotation.x = -Math.PI / 2; ring.position.y = ringY; ring.castShadow = true; ring.receiveShadow = true; g.add(ring);
    // slanted legs (A-frames) down to both trench edges
    const tw = trenchW || d * 1.7;
    const rr = rIn + rw * 0.5, lr = Math.max(0.35, d * 0.06);
    for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
      const foot = new T.Vector3(px * 1.5, base, Math.sign(pz) * (tw / 2 + 1.2));
      pipe(g, new T.Vector3(px, ringY + th * 0.5, pz), foot, lr, em.steel);
      box(g, lr * 5, 0.8, lr * 5, em.concreteDark, foot.x, base + 0.4, foot.z);
    }
    // cross beams (outside the flame path) linking the legs on each trench side
    for (const sz of [-1, 1]) pipe(g, new T.Vector3(-rr * 1.06, ringY - mountH * 0.35, sz * (tw / 2 + 0.6) * 0.92), new T.Vector3(rr * 1.06, ringY - mountH * 0.35, sz * (tw / 2 + 0.6) * 0.92), lr * 0.7, em.steel);
    // hold-down clamps reaching in to the base edge
    const nC = 8;
    for (let k = 0; k < nC; k++) {
      const a = k / nC * Math.PI * 2 + Math.PI / nC;
      const len = rIn + rw * 0.6 - d * 0.5 + 0.3;
      const c = box(g, len, 0.7, 0.55, em.steel, Math.cos(a) * (d * 0.5 + len / 2 - 0.3), top - 0.35, Math.sin(a) * (d * 0.5 + len / 2 - 0.3));
      c.rotation.y = -a;
    }
    // deluge ring on the table and its feed pipe
    const dl = new T.Mesh(new T.TorusGeometry(rIn + rw * 0.5, Math.max(0.15, d * 0.03), 6, 40), em.pipe);
    dl.rotation.x = Math.PI / 2; dl.position.y = ringY + th + 0.15; g.add(dl);
    pipe(g, new T.Vector3(-rIn - rw - 16, base + 0.8, -tw / 2 - 3), new T.Vector3(-rIn - rw * 0.5, ringY + th * 0.5, -0.2), Math.max(0.3, d * 0.05), em.pipe);
    // tail service mast beside the table
    box(g, 1.4, mountH + 4, 1.4, em.steel, -rIn - rw - 2.5, base + (mountH + 4) / 2, -tw / 2 - 2.5);
  }

  function launchSite(scene, geo, cfg) {
    const em = emats();
    const R = A.R;
    const g = new T.Group();
    // Pad kit (padkit.js): cfg = the chosen pad's type and tower; no cfg keeps the classic pad. Sea platforms sit offshore.
    const kit = cfg && A.padKit3D ? cfg : null, seaPad = !!(kit && kit.sea);
    const C = seaPad ? Object.assign({}, LAUNCH_COAST, { c: -650, lag: null }) : LAUNCH_COAST;
    const top = 9; // pad hill height
    const half = 60, slope = 28;
    const flats = seaPad ? [] : [[0, 0, half + slope + 20, 60, 0], [-330, -150, 140, 60, 0], [-170, 40, 120, 50, 0], [-640, 260, 120, 60, 0]];
    const clears = seaPad ? [] : [[0, 0, half + slope + 40, 1], [-330, -150, 120, 0.85], [-170, 40, 100, 0.8], [-640, 260, 90, 0.8]];
    const land = terrain(C, flats, clears);
    g.add(land);
    const hf = land.userData.height;
    const sea = ocean(400000); sea.position.y = SEA; sea.userData.setCoast(C);
    sea.position.x = 0; g.add(sea);

    const props = new T.Group(); g.add(props); registerProps(props);
    // pad hill + trench (exhaust runs toward +x, out to sea side)
    const tw = Math.max(9, geo.d * 1.7) * (kit && kit.trench > 1 ? kit.trench : 1); // Pad kit: heavy pads get a bigger trench
    if (!seaPad) padHill(props, top, half, slope, kit && !kit.trench ? null : { w: tw, x0: -tw * 0.7 });
    const mountH = Math.max(7, geo.d * 1.25);
    launchMount(props, geo, top, mountH, tw);
    const padTop = top + mountH;
    {
      const sc = canvasTex(256, 256, (c, w) => {
        const r = rand(3);
        const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        gr.addColorStop(0, 'rgba(15,12,10,0.85)'); gr.addColorStop(0.45, 'rgba(25,22,18,0.5)'); gr.addColorStop(1, 'rgba(30,26,20,0)');
        c.fillStyle = gr; c.fillRect(0, 0, w, w);
        for (let i = 0; i < 120; i++) { const a = r() * 6.3, d = r() * w * 0.45; c.fillStyle = `rgba(10,8,6,${r() * 0.25})`; c.beginPath(); c.ellipse(w / 2 + Math.cos(a) * d, w / 2 + Math.sin(a) * d, 3 + r() * 14, 1 + r() * 4, a, 0, 6.3); c.fill(); }
      });
      const dec = new T.Mesh(new T.PlaneGeometry(geo.d * 9 + 30, geo.d * 9 + 30), stdMat({ map: sc, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      dec.rotation.x = -Math.PI / 2; dec.position.set(geo.d, top + 0.02, 0); dec.receiveShadow = true; props.add(dec);
    }

    // Pad kit: custom tower, arms, masts, sea deck and deluge spray replace the default ones below
    const kitFx = kit ? A.padKit3D(props, geo, { top, padTop, mountH, tw, half, slope }, kit) : null;
    if (!kitFx) {
    // tower
    const towW = Math.max(8, geo.d * 1.05);
    const towX = -(geo.d / 2 + towW / 2 + Math.max(4, geo.d * 0.9));
    const towH = padTop + geo.total + 14 - top;
    const tower = latticeTower(towH, towW, em.steel);
    tower.position.set(towX, top, 0); props.add(tower);
    // service arms: crew access arm near the top, umbilical arm lower
    const reach = -towX - towW / 2 - geo.d / 2 - 0.6;
    const armAt = (y, w, h, room) => {
      const a = trussArm(reach, h, w, em.steel, em.steelDark);
      a.position.set(towX + towW / 2, y, 0); props.add(a);
      if (room) box(props, Math.min(4, reach * 0.4), h + 1.2, w + 0.6, em.white, towX + towW / 2 + reach - Math.min(2, reach * 0.2), y + 0.3, 0);
    };
    const boost = geo.stages && geo.stages[0] ? geo.stages[0].h : geo.total * 0.6;
    armAt(padTop + geo.total * 0.86, 2.6, 2.8, true);
    armAt(padTop + boost * 0.98, 2.0, 2.0, false);
    armAt(padTop + boost * 0.45, 1.6, 1.6, false);

    // lightning masts with catenary wires
    const mastH = (padTop + geo.total) * 1.25 + 10;
    const mastPts = [[-75, -78], [78, -75], [75, 78], [-78, 75]];
    const tops = [];
    for (const [x, z] of mastPts) {
      cyl(props, 0.45, 1.2, mastH, em.steel, x, top + mastH / 2, z, 8);
      cyl(props, 0.12, 0.3, mastH * 0.12, em.white, x, top + mastH * 1.06, z, 6);
      tops.push(new T.Vector3(x, top + mastH, z));
    }
    const wirePts = [];
    const cat = (a, b, sag) => { for (let k = 0; k < 24; k++) { const t0 = k / 24, t1 = (k + 1) / 24; for (const t of [t0, t1]) { const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); wirePts.push(p.x, p.y, p.z); } } };
    for (let k = 0; k < 4; k++) cat(tops[k], tops[(k + 1) % 4], mastH * 0.12);
    for (const t of tops) { const out = t.clone().setY(0); out.x *= 2.2; out.z *= 2.2; cat(t, out, mastH * 0.05); }
    const wg = new T.BufferGeometry(); wg.setAttribute('position', new T.Float32BufferAttribute(wirePts, 3));
    props.add(new T.LineSegments(wg, new T.LineBasicMaterial({ color: 0x2a2c30, transparent: true, opacity: 0.55 })));
    } // end default tower (pad kit)

    // water deluge tower (sphere on legs) and pipeline to the pad
    const wtX = 150, wtZ = 170, wtH = 52;
    if (!seaPad && (!kit || kit.deluge)) { // Pad kit: only heavy pads have the water tower
      const y0 = hf(wtX, wtZ);
      const s = cyl(props, 10, 10, 1, em.white, wtX, y0 + wtH + 6, wtZ, 24);
      s.geometry.dispose(); s.geometry = new T.SphereGeometry(11, 28, 18);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; pipe(props, new T.Vector3(wtX + Math.cos(a) * 10, y0, wtZ + Math.sin(a) * 10), new T.Vector3(wtX + Math.cos(a) * 7, y0 + wtH + 2, wtZ + Math.sin(a) * 7), 0.5, em.steel); }
      cyl(props, 1.2, 1.2, wtH, em.pipe, wtX, y0 + wtH / 2, wtZ, 10);
      pipe(props, new T.Vector3(wtX, y0 + 1, wtZ), new T.Vector3(wtX - 70, y0 + 1, wtZ - 70), 1.1, em.pipe);
      pipe(props, new T.Vector3(wtX - 70, y0 + 1, wtZ - 70), new T.Vector3(half + slope, 1, 40), 1.1, em.pipe);
    }
    // tank farm: two big spheres, bullet tanks, small plant
    const tfx = -170, tfz = 40;
    if (!seaPad) { // Pad kit: no land buildings around a sea platform
    for (const [x, z, r] of [[tfx - 20, tfz - 25, 11], [tfx + 18, tfz + 20, 9]]) {
      const sph = new T.Mesh(new T.SphereGeometry(r, 32, 20), em.white);
      sph.position.set(x, r + 3, z); sph.castShadow = true; sph.receiveShadow = true; props.add(sph);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; cyl(props, 0.35, 0.35, r + 3, em.steel, x + Math.cos(a) * r * 0.85, (r + 3) / 2, z + Math.sin(a) * r * 0.85, 6); }
      box(props, r * 2.6, 1.2, r * 2.6, em.concreteDark, x, 0.3, z, false);
    }
    for (let k = 0; k < 5; k++) {
      const t = new T.Mesh(new T.CapsuleGeometry(2.4, 22, 4, 16), em.white);
      t.rotation.z = Math.PI / 2; t.position.set(tfx + 30, 3.6, tfz - 40 + k * 7); t.castShadow = true; t.receiveShadow = true; props.add(t);
      box(props, 1, 1.6, 4, em.concreteDark, tfx + 22, 0.8, tfz - 40 + k * 7); box(props, 1, 1.6, 4, em.concreteDark, tfx + 38, 0.8, tfz - 40 + k * 7);
    }
    box(props, 16, 7, 10, em.clad, tfx - 30, 3.5, tfz + 30);
    pipe(props, new T.Vector3(tfx + 30, 1.2, tfz - 10), new T.Vector3(-half - slope, 1.2, -10), 0.6, em.pipe);
    pipe(props, new T.Vector3(tfx + 30, 1.9, tfz - 12), new T.Vector3(-half - slope, 1.9, -12), 0.5, em.pipe);

    // integration hangar with arched roof, offices, control building
    {
      const hx = -330, hz = -150, L = 120, W = 54, Hh = 24;
      const hall = box(props, L, Hh, W, em.clad, hx, Hh / 2, hz);
      const uv = hall.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 2);
      const roof = new T.Mesh(new T.CylinderGeometry(W / 2, W / 2, L, 24, 1, false, 0, Math.PI), em.roof);
      roof.rotation.z = Math.PI / 2; roof.scale.set(0.3, 1, 1); roof.position.set(hx, Hh, hz); roof.castShadow = true; props.add(roof);
      box(props, 0.4, Hh * 0.85, W * 0.8, em.steelDark, hx + L / 2 + 0.2, Hh * 0.425, hz, false); // big door
      box(props, 40, 9, 18, em.white, hx - 20, 4.5, hz + W / 2 + 14);
      box(props, 40.4, 1.2, 0.3, em.glass, hx - 20, 6, hz + W / 2 + 23.1, false);
    }
    // block house / control
    box(props, 24, 6, 18, em.concreteDark, -640, 3, 260);
    box(props, 30, 12, 20, em.white, -610, 6, 230);
    cyl(props, 0.3, 0.4, 30, em.steel, -625, 15, 250, 6);
    // floodlight poles around the hill
    for (let k = 0; k < (small() ? 4 : 8); k++) {
      const a = k / 8 * Math.PI * 2 + 0.3, r = half + slope + 45;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > half && Math.abs(z) < tw) continue;
      cyl(props, 0.2, 0.35, 22, em.steel, x, 11, z, 6); box(props, 2.2, 1.0, 0.5, em.steelDark, x, 22, z);
    }
    // roads
    const roadsG = new T.Group(); g.add(roadsG); registerProps(roadsG);
    road(roadsG, [[-half - slope - 5, -20], [-200, -20], [-330, -100]], 10, 0);
    road(roadsG, [[-200, -20], [-330, 120], [-610, 250], [-1150, 300], [-1700, 380], [-2300, 600]], 9, hf);
    road(roadsG, [[-330, -178], [-450, -320], [-900, -560], [-1500, -800]], 9, hf);
    road(roadsG, [[-200, 60], [-120, 160], [60, 260], [150, 200]], 7, hf);
    // coast road, parallel to the shore well behind the dunes
    {
      const f = coastFns(C); const n = [C.nx, C.nz], t = [-C.nz, C.nx];
      const pts = [];
      for (let u = -3200; u <= 3200; u += 100) {
        let x = n[0] * (C.c - 300) + t[0] * u, z = n[1] * (C.c - 300) + t[1] * u;
        const sd = f.sea(x, z); x -= n[0] * (sd + 300); z -= n[1] * (sd + 300);
        pts.push([x, z]);
      }
      road(roadsG, pts, 8, hf);
    }
    } // end land buildings (pad kit)
    // vegetation (keep clear of pad, roads and buildings)
    const vegG = new T.Group(); g.add(vegG); registerProps(vegG);
    vegetation(vegG, C, hf, [[0, 0, half + slope + 45], [-330, -150, 130], [-170, 40, 105], [-640, 260, 90], [150, 170, 30]], 2600, 3200);

    scene.add(g);
    return { group: g, sea, padTop, kit: kitFx };
  }

  // ---------- landing pad (on land, near the coast) ----------
  function padModel() {
    const em = emats();
    const g = new T.Group();
    const C = { nx: 0.2, nz: 0.98, c: 420, lag: [-2600, 260, 480] };
    const flats = [[0, 0, 70, 60, 0]];
    const land = terrain(C, flats, [[0, 0, 85, 1]]);
    g.add(land);
    const hf = land.userData.height;
    const sea = ocean(400000); sea.position.y = SEA; sea.userData.setCoast(C); g.add(sea);
    g.userData.sea = sea;
    const props = new T.Group(); g.add(props); registerProps(props);
    const tex = targetTex('#8f8a80', '#f1eee6', '#202020', true);
    const pad = new T.Mesh(new T.CylinderGeometry(43, 44, 0.6, 72), [
      stdMat({ color: 0x8a857c, roughness: 0.95 }), stdMat({ map: tex, roughness: 0.9 }), stdMat({ color: 0x8a857c }),
    ]);
    pad.position.y = 0.3; pad.receiveShadow = true; props.add(pad);
    // apron and edge lights
    const apron = new T.Mesh(new T.RingGeometry(44, 58, 72), stdMat({ color: 0x6d685f, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = 0.05; apron.receiveShadow = true; props.add(apron);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; box(props, 0.6, 0.5, 0.6, em.yellow, Math.cos(a) * 50, 0.3, Math.sin(a) * 50, false); }
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; const x = Math.cos(a) * 75, z = Math.sin(a) * 75; cyl(props, 0.25, 0.4, 22, em.steel, x, 11, z, 6); box(props, 3, 1.5, 0.6, em.steelDark, x, 22, z); }
    box(props, 10, 4, 7, em.concreteDark, -95, 2, 30);
    box(props, 6, 3, 3, em.white, -95, 1.5, 45);
    road(props, [[-58, 0], [-120, 20], [-420, 120], [-900, 200]], 8, hf);
    const vegG = new T.Group(); g.add(vegG); registerProps(vegG);
    vegetation(vegG, C, hf, [[0, 0, 90], [-95, 35, 20]], 1800, 2600);
    return { group: g, deckY: 0.6 };
  }

  // ---------- drone ship ----------
  function bargeModel() {
    const em = emats();
    const g = new T.Group();
    const float = new T.Group(); g.add(float);
    const Lx = 90, Wz = 52, deckY = 4, draft = 4;
    // hull with sloped lower sides
    const hullTop = box(float, Lx, deckY - 0.6, Wz, em.hull, 0, (deckY - 0.6) / 2, 0);
    const bottom = new T.Mesh(new T.CylinderGeometry(Math.hypot(Lx, Wz) / 2, Math.hypot(Lx - 6, Wz - 6) / 2, draft, 4, 1), em.hullRed);
    bottom.rotation.y = Math.PI / 4; bottom.scale.set(Lx / Wz, 1, 1);
    // scale a square frustum into a rectangle: build with a box instead for exact footprint
    bottom.geometry.dispose(); bottom.geometry = new T.BoxGeometry(Lx - 3, draft, Wz - 3); bottom.rotation.y = 0; bottom.scale.set(1, 1, 1);
    bottom.position.y = -draft / 2 + 0.01; float.add(bottom);
    hullTop.castShadow = true;
    // boot-top waterline stripe
    box(float, Lx + 0.05, 0.5, Wz + 0.05, em.white, 0, 0.35, 0, false);
    // deck with the landing target
    const tex = targetTex('#3c4048', '#ecebe4', '#111', true);
    const deck = new T.Mesh(new T.PlaneGeometry(Lx - 2, Wz - 2), stdMat({ map: tex, roughness: 0.85, metalness: 0.2 }));
    tex.repeat.set(1, 1); tex.center.set(0.5, 0.5);
    deck.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = (v - 0.5) * (Lx - 2) / (Wz - 2) + 0.5; });
    deck.rotation.x = -Math.PI / 2; deck.position.y = deckY + 0.01; deck.receiveShadow = true; float.add(deck);
    box(float, Lx, 0.6, Wz, em.steelDark, 0, deckY - 0.3, 0);
    // blast walls on the two short ends, with equipment containers
    for (const s of [-1, 1]) {
      const wall = box(float, 2.4, 8, Wz - 2, em.hull, s * (Lx / 2 - 1.2), deckY + 4, 0);
      wall.castShadow = true;
      for (let k = -1; k <= 1; k += 2) {
        box(float, 6, 2.6, 2.5, k > 0 ? em.white : em.yellow, s * (Lx / 2 - 5.8), deckY + 1.3, k * (Wz / 2 - 6));
      }
      // small crane on one end
      if (s > 0) { cyl(float, 0.5, 0.6, 9, em.yellow, Lx / 2 - 6, deckY + 4.5, -Wz / 2 + 3, 8); const jib = box(float, 0.6, 0.6, 10, em.yellow, Lx / 2 - 6, deckY + 9, -Wz / 2 + 7.5); jib.rotation.x = 0.25; }
      // mast with lights / antennas
      if (s < 0) { cyl(float, 0.2, 0.3, 12, em.steel, -Lx / 2 + 1.2, deckY + 14, 0, 6); box(float, 0.3, 0.3, 3, em.white, -Lx / 2 + 1.2, deckY + 18, 0); }
    }
    // railings on the long sides
    const nPost = small() ? 18 : 36;
    const posts = new T.InstancedMesh(new T.BoxGeometry(0.12, 1.1, 0.12), em.yellow, nPost * 2);
    const m4 = new T.Matrix4(); let pi = 0;
    for (const s of [-1, 1]) for (let k = 0; k < nPost; k++) { m4.makeTranslation(-Lx / 2 + 3 + k * (Lx - 6) / (nPost - 1), deckY + 0.55, s * (Wz / 2 - 0.3)); posts.setMatrixAt(pi++, m4); }
    float.add(posts);
    for (const s of [-1, 1]) box(float, Lx - 6, 0.1, 0.1, em.yellow, 0, deckY + 1.1, s * (Wz / 2 - 0.3), false);
    // four thruster pods hanging off the corners, with frothing water
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = sx * (Lx / 2 - 7), pz = sz * (Wz / 2 + 2.2);
      box(float, 9, deckY + 1.5, 4.4, em.hull, px, (deckY + 1.5) / 2 - 0.8, pz);
      box(float, 9.2, 0.6, 4.6, em.white, px, deckY + 0.9, pz, false);
      const pod = cyl(float, 1.6, 1.6, 6, em.hullRed, px, -draft - 1, pz, 12); pod.rotation.z = Math.PI / 2;
    }
    // foam/wake around the hull (static at the waterline, not bobbing)
    const foamTex = canvasTex(256, 256, (c, w) => {
      c.clearRect(0, 0, w, w);
      const r = rand(17);
      for (let i = 0; i < 900; i++) {
        const a = r() * 6.283, rad = 0.36 + Math.pow(r(), 2) * 0.13;
        const x = w / 2 + Math.cos(a) * rad * w * (Math.abs(Math.cos(a)) * 0.15 + 0.85), y = w / 2 + Math.sin(a) * rad * w;
        c.fillStyle = `rgba(255,255,255,${(0.5 - (rad - 0.36) * 3) * r() * 0.6})`;
        c.beginPath(); c.arc(x, y, 1 + r() * 3, 0, 6.3); c.fill();
      }
    });
    const foam = new T.Mesh(new T.PlaneGeometry(Lx * 1.5, Wz * 1.9), new T.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.75, color: 0xd8dde0 }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = 0.08; g.add(foam);
    // bobbing
    const t0 = Math.random() * 100;
    hullTop.onBeforeRender = () => {
      const t = performance.now() / 1000 + t0;
      float.position.y = 0.22 * Math.sin(t * 0.83) + 0.1 * Math.sin(t * 1.37 + 1);
      float.rotation.x = 0.010 * Math.sin(t * 0.71 + 0.4);
      float.rotation.z = 0.006 * Math.sin(t * 0.57 + 2.1);
      foam.material.opacity = 0.6 + 0.15 * Math.sin(t * 0.9);
    };
    g.userData.deck = float; // add a landed rocket here to ride the motion
    return { group: g, deckY };
  }

  // ---------- catch tower ----------
  function catchModel(geo, armY, cfg) {
    const em = emats();
    const g = new T.Group();
    const C = { nx: 0.2, nz: 0.98, c: 480, lag: [-2700, 260, 500] };
    const top = 6, half = 50, slope = 22;
    const land = terrain(C, [[0, 0, half + slope + 15, 60, 0]], [[0, 0, half + slope + 30, 1]]);
    g.add(land);
    const hf = land.userData.height;
    const sea = ocean(400000); sea.position.y = SEA; sea.userData.setCoast(C); g.add(sea);
    g.userData.sea = sea;
    const props = new T.Group(); g.add(props); registerProps(props);
    const tw = Math.max(10, geo.d * 1.1);
    padHill(props, top, half, slope, { w: Math.max(9, geo.d * 1.7), x0: -Math.max(9, geo.d * 1.7) * 0.7 });
    launchMount(props, geo, top, Math.max(7, geo.d * 1.25), Math.max(9, geo.d * 1.7));
    const towerX = -(geo.d / 2 + tw / 2 + 6);
    const towerH = armY + 30 - top;
    const tower = latticeTower(towerH, tw, (cfg && cfg.arms && A.padKitMat && A.padKitMat(cfg)) || em.steel); // Pad kit: tower colour
    tower.position.set(towerX, top, 0); props.add(tower);
    // carriage that holds the arms
    const carH = 7;
    const car = box(props, tw + 2.4, carH, tw + 2.4, em.steelDark, towerX, armY + 0.5, 0);
    car.castShadow = true;
    const arms = [];
    const len = 6 + geo.d + 4;
    const gap = geo.d / 2 + 1.4;
    for (const side of [-1, 1]) {
      const pivot = new T.Group();
      pivot.position.set(towerX + tw / 2 + 0.6, armY, side * gap);
      const arm = trussArm(len, 3.2, 1.8, em.steel, em.steelDark);
      pivot.add(arm);
      // catch rail / pads on the inner face
      const rail = new T.Mesh(new T.BoxGeometry(len * 0.5, 1.0, 0.6), em.yellow);
      rail.position.set(len * 0.7, 1.2, -side * 1.1); rail.castShadow = true; pivot.add(rail);
      // hinge
      const hinge = new T.Mesh(new T.CylinderGeometry(1, 1, 4.4, 12), em.steelDark); hinge.position.set(0, 0, 0); pivot.add(hinge);
      // s is the sign used by flight.js: rotation.y = s*0.55 opens (tips swing outward), 0 closes (parallel, hugging the booster)
      const s = -side;
      pivot.rotation.y = s * 0.55;
      props.add(pivot);
      arms.push({ pivot, s });
    }
    // lightning masts
    for (const [x, z] of [[-70, -70], [70, 70]]) { const h = armY + 50; cyl(props, 0.45, 1.1, h, em.steel, x, top + h / 2, z, 8); }
    // tank farm and road
    for (const [x, z, r] of [[-160, -60, 10], [-150, 30, 8]]) { const s = new T.Mesh(new T.SphereGeometry(r, 28, 18), em.white); s.position.set(x, r + 3, z); s.castShadow = true; props.add(s); }
    road(props, [[-half - slope - 5, -10], [-220, -10], [-600, 120], [-1200, 260]], 9, hf);
    const vegG = new T.Group(); g.add(vegG); registerProps(vegG);
    vegetation(vegG, C, hf, [[0, 0, half + slope + 40], [-160, -20, 70]], 2000, 3000);
    return { group: g, arms, towerX };
  }

  function groundHeight(x, z, which) {
    const C = which === 'pad' ? { nx: 0.2, nz: 0.98, c: 420, lag: [-2600, 260, 480] } : LAUNCH_COAST;
    return heightFn(C, [])(x, z);
  }

  Object.assign(A, { launchSite, padModel, bargeModel, catchModel, ocean, lights, groundHeight });
  A._env = { emats, stdMat, box, cyl, pipe, latticeTower, trussArm, small, SEA }; // helpers for padkit.js
})();
