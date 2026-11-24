// 3D earth module: overrides parts of window.APOGEE_3D (loaded after world3d.js).
// Earth seen from high altitude and orbit (km units, Earth centre at origin, camera above +y).
// - Textures are baked once on the GPU (render-to-texture, equirectangular): land albedo + elevation, clouds + city lights.
// - The surface, cloud and atmosphere shaders share one single-scattering atmosphere model (Rayleigh + Mie),
//   so haze, the blue limb, the reddish terminator and the sky all match.
// - The visible mesh is a dense spherical cap centred under the camera (render() keeps the camera at (0, R+alt, 0)),
//   so the horizon is smooth at every altitude.
(function () {
  'use strict';
  const A = window.APOGEE_3D;
  const T = window.THREE;
  if (!A || !T) return;
  const EARTH_R = 6371, ATMO_R = 6471, CLOUD_H = 5;

  // ---------- shared GLSL ----------
  const GLSL_COMMON = `
  #define PR 6371.0
  #define AR 6471.0
  const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3);
  const float BM = 4e-3;
  const float HR = 8.0;
  const float HM = 1.2;
  uniform vec3 uSun;          // sun direction (earth scene space)
  uniform float uSunI;        // sun intensity
  uniform float uHazeK;       // aerial perspective strength (full at low altitude, softened from orbit)
  uniform mat3 uGeo;          // earth-scene direction -> geographic direction
  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d); return vec2(-b - d, -b + d);
  }
  // Schuler's approximation of the Chapman function * exp(-h): optical depth along a ray to infinity, in units of H
  float chapman(float X, float h, float mu) {
    float c = sqrt(X + h);
    if (mu >= 0.0) return c / (c * mu + 1.0) * exp(-h);
    float s = sqrt(max(0.0, 1.0 - mu * mu)) * (X + h);
    if (s < X) return 1e4;
    float c0 = sqrt(s);
    return 2.0 * c0 * exp(X - s) - c / (1.0 - c * mu) * exp(-h);
  }
  // optical depth (Rayleigh, Mie) from point p toward direction d, out to space
  vec2 odToSpace(vec3 p, vec3 d) {
    float r = length(p); float mu = dot(p, d) / r; float h = max(0.0, r - PR);
    return vec2(HR * chapman(PR / HR, h / HR, mu), HM * chapman(PR / HM, h / HM, mu));
  }
  vec3 extinct(vec2 od) { return exp(-(BR * od.x + BM * 1.1 * od.y)); }
  vec3 sunTrans(vec3 p) { return extinct(odToSpace(p, uSun)); }
  float phaseR(float mu) { return 0.0597 * (1.0 + mu * mu); }
  float phaseM(float mu) { const float g = 0.76; float g2 = g * g; return 0.1194 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5)); }
  // single scattering along ro + rd*t, t in [t0,t1]; returns inscattered light, writes view transmittance
  vec3 scatter(vec3 ro, vec3 rd, float t0, float t1, bool toGround, out vec3 trans) {
    float mu = dot(rd, uSun);
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    vec2 od = vec2(0.0);
    float prevT = t0;
    for (int i = 0; i < NSTEP; i++) {
      float u = (float(i) + 1.0) / float(NSTEP);
      // concentrate samples where the air is dense: the far end for rays that hit the ground, the middle for limb rays
      float f = toGround ? 1.0 - (1.0 - u) * (1.0 - u) : 0.5 - 0.5 * cos(u * 3.14159265);
      float t = mix(t0, t1, f);
      float ds = t - prevT;
      vec3 p = ro + rd * (t - 0.5 * ds);
      prevT = t;
      float h = max(0.0, length(p) - PR);
      vec2 dens = vec2(exp(-h / HR), exp(-h / HM)) * ds;
      od += dens;
      vec3 att = extinct(od + odToSpace(p, uSun) * 0.6);
      sumR += att * dens.x; sumM += att * dens.y;
    }
    trans = extinct(od);
    return uSunI * (BR * phaseR(mu) * sumR + BM * phaseM(mu) * sumM);
  }
  // cheap hash value noise for fine detail
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // equirect uv of a geographic direction, seam-free mip selection (Tarini)
  vec2 geoUV(vec3 g) {
    float u = atan(g.z, g.x) / 6.2831853 + 0.5;
    float v = asin(clamp(g.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    float u2 = fract(u + 0.5) - 0.5;
    return vec2(fwidth(u) < fwidth(u2) + 1e-5 ? u : u2, v);
  }
  `;

  // ---------- texture bake (GPU, once) ----------
  const GLSL_SNOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p, int oct){ float s=0.0,a=0.5; for(int i=0;i<10;i++){ if(i>=oct) break; s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5;} return s; }
  float ridged(vec3 p, int oct){ float s=0.0,a=0.5; for(int i=0;i<8;i++){ if(i>=oct) break; float n=1.0-abs(snoise(p)); s+=a*n*n; p=p*2.07+vec3(4.1,1.3,7.7); a*=0.5;} return s; }
  `;
  const BAKE_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const BAKE_FS = `
  varying vec2 vUv;
  uniform int uMode;   // 0: land albedo (gamma encoded) + elevation; 1: clouds (r), city lights (g)
  uniform vec3 uSite, uEast;
  ${GLSL_SNOISE}
  float elevation(vec3 g) {
    vec3 w = vec3(fbm(g * 1.4 + 3.0, 4), fbm(g * 1.4 + 11.0, 4), fbm(g * 1.4 + 23.0, 4));
    float e = fbm(g * 1.15 + w * 0.9, 7) + 0.10;
    e += 0.18 * ridged(g * 3.0 + w, 5) - 0.09;
    // keep the launch site on a north-south coast: land to the west, ocean to the east
    vec3 d = g - uSite; float r2 = dot(d, d);
    float k = exp(-r2 / 0.012);
    float s = dot(d, uEast);
    e = mix(e, 0.04 - 4.0 * s + 0.12 * fbm(g * 9.0, 4) - 0.6 * max(0.0, -s - 0.06), k);
    return e;
  }
  void main() {
    float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.14159265;
    vec3 g = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    float alat = abs(lat) * 57.29578;
    if (uMode == 0) {
      float e = elevation(g);
      float moist = fbm(g * 2.2 + 40.0, 5) * 0.8;
      // climate: wet tropics, dry subtropics (~25 deg), wet temperate, cold poles
      float lt = alat / 90.0;
      float wet = 0.65 * exp(-pow(alat / 12.0, 2.0)) + 0.55 * smoothstep(35.0, 50.0, alat) * (1.0 - smoothstep(62.0, 75.0, alat)) - 0.45 * exp(-pow((alat - 24.0) / 9.0, 2.0));
      wet += moist - 0.3 * max(0.0, e - 0.15) + 0.7 * exp(-dot(g - uSite, g - uSite) / 0.02);
      float temp = 1.0 - lt * 1.25 - max(0.0, e - 0.3) * 1.2 + 0.08 * fbm(g * 3.0, 3);
      float det = fbm(g * 24.0, 4);
      vec3 rain = vec3(0.030, 0.060, 0.022);
      vec3 grass = vec3(0.075, 0.10, 0.045);
      vec3 steppe = vec3(0.17, 0.15, 0.09);
      vec3 sand = vec3(0.40, 0.29, 0.17);
      vec3 redsand = vec3(0.34, 0.19, 0.10);
      vec3 boreal = vec3(0.05, 0.075, 0.045);
      vec3 tundra = vec3(0.15, 0.14, 0.11);
      vec3 rock = vec3(0.16, 0.14, 0.12);
      vec3 desert = mix(sand, redsand, smoothstep(-0.2, 0.3, fbm(g * 5.0 + 7.0, 4)));
      vec3 c = mix(desert, steppe, smoothstep(-0.25, 0.0, wet));
      c = mix(c, grass, smoothstep(0.0, 0.25, wet));
      c = mix(c, rain, smoothstep(0.25, 0.55, wet) * smoothstep(0.4, 0.75, temp));
      c = mix(c, boreal, smoothstep(0.35, 0.2, temp) * smoothstep(-0.1, 0.2, wet));
      c = mix(c, tundra, smoothstep(0.2, 0.05, temp));
      c = mix(c, rock, smoothstep(0.3, 0.5, e) * 0.7);
      c *= 0.82 + 0.36 * (det + 0.5);
      // ice caps, high-mountain snow, polar sea ice
      float ice = smoothstep(-0.02, -0.12, temp + 0.05 * det);
      float seaIce = smoothstep(74.0, 80.0, alat + 6.0 * fbm(g * 6.0, 4));
      ice = max(ice, seaIce);
      c = mix(c, vec3(0.80, 0.83, 0.88), ice);
      float elev = ice > 0.5 ? max(e, 0.02 + 0.02 * ice) : e;
      gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), clamp(elev * 0.9 + 0.5, 0.0, 1.0));
    } else {
      // clouds: weather bands + warped billows + swirls
      vec3 q = g * 2.0;
      vec3 w = vec3(fbm(q + 5.0, 4), fbm(q + 15.0, 4), fbm(q + 25.0, 4));
      float band = 0.20 * exp(-pow(alat / 8.0, 2.0)) - 0.12 * exp(-pow((alat - 24.0) / 8.0, 2.0)) + 0.20 * exp(-pow((alat - 52.0) / 14.0, 2.0)) + 0.02;
      float n = fbm(q * 1.6 + w * 1.6, 8) + band;
      n += 0.25 * fbm(g * 22.0 + w * 3.0, 5);
      float cov = smoothstep(0.02, 0.45, n);
      cov *= 0.75 + 0.25 * smoothstep(-0.3, 0.3, fbm(g * 40.0, 3));
      // city lights: clustered on lowland coasts and temperate/tropical land, none on ice or deserts
      float e = elevation(g);
      float land = smoothstep(0.0, 0.01, e);
      float hab = land * (1.0 - smoothstep(0.08, 0.3, e)) * (1.0 - smoothstep(55.0, 62.0, alat));
      float coast = 1.0 - smoothstep(0.0, 0.08, e);
      float region = smoothstep(0.05, 0.4, fbm(g * 3.5 + 60.0, 4) + 0.2 * coast);
      float towns = pow(max(0.0, snoise(g * 160.0) * 0.5 + 0.5), 6.0) * 2.5 + pow(max(0.0, snoise(g * 45.0 + 9.0) * 0.5 + 0.5), 8.0) * 3.0;
      float lights = clamp(hab * region * towns * (0.6 + coast), 0.0, 1.0);
      gl_FragColor = vec4(cov, lights, 0.0, 1.0);
    }
  }`;

  function bake(renderer, W, H, mode, site, east) {
    const rt = new T.WebGLRenderTarget(W, H, {
      generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter,
      wrapS: T.RepeatWrapping, wrapT: T.ClampToEdgeWrapping, depthBuffer: false,
    });
    rt.texture.anisotropy = 4;
    const mat = new T.ShaderMaterial({ vertexShader: BAKE_VS, fragmentShader: BAKE_FS, uniforms: { uMode: { value: mode }, uSite: { value: site }, uEast: { value: east } }, depthTest: false, depthWrite: false });
    const sc = new T.Scene();
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false; sc.add(quad);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prevRT = renderer.getRenderTarget();
    const prevAC = renderer.autoClear;
    renderer.setRenderTarget(rt); renderer.autoClear = true;
    renderer.render(sc, cam);
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAC;
    quad.geometry.dispose(); mat.dispose();
    return rt;
  }

  // Dense spherical cap around +y (the camera is always on the +y axis).
  function capGeometry(radius, rings, segs, maxTheta) {
    const pos = [], idx = [];
    pos.push(0, radius, 0);
    for (let i = 1; i <= rings; i++) {
      const th = maxTheta * Math.pow(i / rings, 1.6);
      const st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j < segs; j++) {
        const ph = (j / segs) * Math.PI * 2;
        pos.push(radius * st * Math.cos(ph), radius * ct, radius * st * Math.sin(ph));
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
      const a = 1 + (i - 1) * segs, b = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a + j, a + j1, b + j);
        idx.push(a + j1, b + j1, b + j);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  // 0 below 6 km -> 1 by 25 km: how much the far Earth replaces the near-scene ground
  function earthBlend(alt) {
    const t = Math.max(0, Math.min(1, ((alt || 0) - 6) / 19));
    return t * t * (3 - 2 * t);
  }

  function buildEarth() {
    const R = A.R;
    if (R.earth) return R.earth;
    const small = !!R.small;
    const W = small ? 1024 : 2048, H = W / 2;
    const NSTEP = small ? 5 : 8;

    // earth-scene -> geographic rotation: launch site (scene +y) at 28.5 N, scene +z = geographic east
    const siteLat = T.MathUtils.degToRad(28.5);
    const rot = new T.Matrix4().makeRotationZ(-(Math.PI / 2 - siteLat));
    const geoM = new T.Matrix3().setFromMatrix4(rot);
    const site = new T.Vector3(0, 1, 0).applyMatrix3(geoM);
    const east = new T.Vector3(0, 0, 1).applyMatrix3(geoM);

    const t0 = performance.now();
    const texA = bake(R.renderer, W, H, 0, site, east);
    const texB = bake(R.renderer, W, H, 1, site, east);
    R.earthBakeMs = performance.now() - t0;

    const uniforms = {
      uSun: { value: R.sunDir }, uSunI: { value: 12 }, uGeo: { value: geoM },
      uTexA: { value: texA.texture }, uTexB: { value: texB.texture },
      uCloudRot: { value: 0 }, uCam: { value: new T.Vector3() }, uSkyW: { value: 1 }, uHazeK: { value: 0.65 }, uDetail: { value: small ? 0 : 1 },
    };
    const defines = { NSTEP };
    const VS = 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
    const FS_TAIL = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
    const cloudGeoDir = `
    vec3 cloudDir(vec3 g) { float c = cos(uCloudRot), s = sin(uCloudRot); return vec3(c * g.x - s * g.z, g.y, s * g.x + c * g.z); }`;

    // --- surface ---
    const surfMat = new T.ShaderMaterial({
      defines, uniforms, vertexShader: VS,
      fragmentShader: `
      uniform sampler2D uTexA, uTexB; uniform float uCloudRot; uniform vec3 uCam; uniform float uDetail;
      varying vec3 vP;
      ${GLSL_COMMON}
      ${cloudGeoDir}
      void main() {
        vec3 n = normalize(vP);
        vec3 p = n * PR;
        vec3 rd = normalize(p - uCam);
        vec3 g = uGeo * n;
        vec2 uv = geoUV(g);
        vec4 a = texture2D(uTexA, uv);
        float dist = length(p - uCam);
        float px = dist * fwidth(length(vP)) + dist * 0.0012; // rough km per pixel
        // fine detail for low altitudes (fades out once a pixel is bigger than the feature)
        vec3 pk = g * PR;
        float d1 = vnoise(pk * 0.08) - 0.5, d2 = vnoise(pk * 0.35) - 0.5, d3 = vnoise(pk * 1.4) - 0.5;
        float fd1 = 1.0 - smoothstep(3.0, 12.0, px), fd2 = 1.0 - smoothstep(0.8, 3.0, px), fd3 = 1.0 - smoothstep(0.2, 0.8, px);
        float detail = d1 * fd1 + 0.5 * d2 * fd2 + 0.25 * d3 * fd3;
        float elev = (a.a - 0.5) / 0.9 + detail * 0.012;
        float coastW = max(0.0015, fwidth(elev) * 0.7);
        float water = 1.0 - smoothstep(-coastW, coastW, elev);
        vec3 land = pow(a.rgb, vec3(2.2)) * (1.0 + detail * 0.5);
        // mid-scale terrain variety (fields, forest patches, valleys) below the texture resolution
        float fdm = 1.0 - smoothstep(6.0, 25.0, px);
        if (fdm > 0.0) {
          float m1 = vnoise(pk * 0.025) + 0.5 * vnoise(pk * 0.07 + 3.0) + 0.25 * vnoise(pk * 0.2 + 7.0);
          float rid = pow(1.0 - abs(vnoise(pk * 0.035 + 11.0) * 2.0 - 1.0), 10.0);
          vec3 tint = mix(vec3(0.7, 0.85, 0.65), vec3(1.3, 1.15, 0.95), smoothstep(0.55, 1.2, m1));
          land *= mix(vec3(1.0), tint * (1.0 - 0.3 * rid), fdm);
        }
        float depth = clamp(-elev / 0.06, 0.0, 1.0);
        vec3 sea = mix(vec3(0.02, 0.085, 0.11), vec3(0.004, 0.016, 0.045), smoothstep(0.0, 0.5, depth));
        vec3 alb = mix(land, sea, water);
        // lighting
        float mu = dot(n, uSun);
        vec3 sunL = sunTrans(p) * uSunI * smoothstep(-0.02, 0.05, mu);
        // cloud shadow: look up clouds toward the sun
        vec3 sh = normalize(n + (uSun - n * mu) * (${CLOUD_H.toFixed(1)} / PR) / max(mu, 0.2));
        float cs = texture2D(uTexB, geoUV(cloudDir(uGeo * sh))).r;
        sunL *= 1.0 - 0.55 * cs;
        vec3 sky = uSunI * vec3(0.010, 0.020, 0.040) * smoothstep(-0.15, 0.3, mu);
        vec3 col = alb * (sunL * pow(max(mu, 0.0), 0.6) * 1.3 + sky) / 3.14159;
        // ocean sun glint (wide, wind-roughened)
        vec3 v = -rd; vec3 hv = normalize(uSun + v);
        float nh = max(dot(n, hv), 0.0);
        float rough = 0.06;
        float a2 = rough * rough;
        float dd = nh * nh * (a2 - 1.0) + 1.0;
        float D = a2 / (3.14159 * dd * dd);
        float nv = max(dot(n, v), 0.05);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
        col += water * sunL * D * F * max(mu, 0.0) / (4.0 * nv * max(mu, 0.05)) * 0.6;
        // sky reflected by the ocean near the limb
        col += water * F * uSunI * vec3(0.004, 0.010, 0.025) * smoothstep(-0.1, 0.2, mu);
        // city lights on the night side
        float lights = texture2D(uTexB, uv).g * (1.0 - water);
        lights *= 0.7 + 0.6 * vnoise(pk * 0.6) * fd2;
        col += vec3(1.0, 0.62, 0.28) * lights * 0.9 * smoothstep(0.02, -0.12, mu);
        // atmosphere between the camera and the ground
        vec2 at = raySphere(uCam, rd, AR);
        float tStart = max(0.0, at.x);
        vec3 tr;
        vec3 ins = scatter(uCam, rd, tStart, dist, true, tr);
        gl_FragColor = vec4(col * mix(vec3(1.0), tr, uHazeK) + ins * uHazeK, 1.0);
        ${FS_TAIL}
      }`,
    });

    // --- clouds ---
    const cloudMat = new T.ShaderMaterial({
      defines, uniforms, vertexShader: VS, transparent: true, depthWrite: false,
      fragmentShader: `
      uniform sampler2D uTexB; uniform float uCloudRot; uniform vec3 uCam; uniform float uDetail;
      varying vec3 vP;
      ${GLSL_COMMON}
      ${cloudGeoDir}
      void main() {
        vec3 n = normalize(vP);
        vec3 p = n * (PR + ${CLOUD_H.toFixed(1)});
        vec3 g = cloudDir(uGeo * n);
        float c = texture2D(uTexB, geoUV(g)).r;
        float craw = c;
        float dist = length(p - uCam);
        float px = dist * 0.0012;
        vec3 pk = g * PR;
        float d = (vnoise(pk * 0.12) - 0.5) * (1.0 - smoothstep(4.0, 16.0, px)) + 0.5 * (vnoise(pk * 0.5) - 0.5) * (1.0 - smoothstep(1.0, 4.0, px));
        c = clamp(c + d * 0.6 * c * (1.0 - c) * 4.0, 0.0, 1.0);
        c = smoothstep(0.03, 0.9, c);
        if (c < 0.01) discard;
        vec3 rd = normalize(p - uCam);
        float mu = dot(n, uSun);
        vec3 sunL = sunTrans(p) * uSunI * smoothstep(-0.05, 0.08, mu);
        float lit = 0.3 + 0.9 * pow(max(mu, 0.0), 0.5);
        // self shadowing: thicker cloud toward the sun shades this side
        vec3 ts = normalize(n + (uSun - n * mu) * 0.004);
        float cs2 = texture2D(uTexB, geoUV(cloudDir(uGeo * ts))).r;
        lit *= 1.0 - 0.6 * clamp((cs2 - craw) * 3.0, 0.0, 1.0);
        lit *= 0.65 + 0.35 * c;
        // thicker clouds are brighter on top; thin edges show some forward scatter
        float fwd = pow(max(dot(rd, uSun), 0.0), 8.0) * (1.0 - c) * 1.5;
        vec3 col = 0.95 * sunL * (lit * (0.75 + 0.25 * c) + fwd) / 3.14159 + uSunI * vec3(0.01, 0.015, 0.025) * smoothstep(-0.1, 0.3, mu) * 0.3;
        vec2 at = raySphere(uCam, rd, AR);
        vec3 tr;
        vec3 ins = scatter(uCam, rd, max(0.0, at.x), dist, true, tr);
        gl_FragColor = vec4(col * mix(vec3(1.0), tr, uHazeK) + ins * uHazeK, c * 0.97);
        ${FS_TAIL}
      }`,
    });

    // --- atmosphere shell (rays that miss the ground: blue limb, and the sky once the ground sky has faded) ---
    const atmoMat = new T.ShaderMaterial({
      defines, uniforms, vertexShader: VS, side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      fragmentShader: `
      uniform vec3 uCam; uniform float uSkyW;
      varying vec3 vP;
      ${GLSL_COMMON}
      void main() {
        vec3 rd = normalize(vP - uCam);
        vec2 at = raySphere(uCam, rd, AR);
        vec2 gt = raySphere(uCam, rd, PR);
        float t0 = max(0.0, at.x), t1 = at.y;
        if (gt.x > 0.0 && gt.x < 1e8) t1 = gt.x;
        vec3 tr;
        vec3 ins = scatter(uCam, rd, t0, t1, false, tr);
        gl_FragColor = vec4(ins * uSkyW, 1.0);
        ${FS_TAIL}
      }`,
    });

    const scene = new T.Scene();
    const segs = small ? 192 : 320, rings = small ? 110 : 180;
    const surf = new T.Mesh(capGeometry(EARTH_R, rings, segs, Math.PI / 2), surfMat);
    const clouds = new T.Mesh(capGeometry(EARTH_R + CLOUD_H, rings, segs, Math.PI / 2), cloudMat);
    const atmo = new T.Mesh(new T.SphereGeometry(ATMO_R, small ? 96 : 160, small ? 64 : 100), atmoMat);
    surf.renderOrder = 0; clouds.renderOrder = 1; atmo.renderOrder = 2;
    for (const m of [surf, clouds, atmo]) m.frustumCulled = false;
    scene.add(surf, clouds, atmo);

    // keep uniforms in step with the earth camera (render() places it each frame)
    surf.onBeforeRender = (r, s, cam) => {
      uniforms.uCam.value.copy(cam.position);
      const alt = cam.position.length() - EARTH_R;
      const fade = Math.max(0, 1 - Math.pow(Math.min(1, alt / 70), 0.8)); // same as world3d sky fade
      uniforms.uSkyW.value = 1 - fade;
      { const k = Math.max(0, Math.min(1, (alt - 10) / 130)); uniforms.uHazeK.value = 1.5 + (0.62 - 1.5) * k * k * (3 - 2 * k); }
    };
    // render() spins E.clouds.rotation.y: a plain object here, the cap mesh must stay centred on +y,
    // so the spin is applied to the cloud texture lookup instead
    const spin = { rotation: { y: 0 } };
    surf.onBeforeRender = ((prev) => (r, s, cam) => { prev(r, s, cam); uniforms.uCloudRot.value = spin.rotation.y; })(surf.onBeforeRender);
    R.earth = { scene, clouds: spin, surface: surf, cloudMesh: clouds, atmosphere: atmo, uniforms, textures: [texA, texB] };
    return R.earth;
  }

  A.buildEarth = buildEarth;
  A.earthBlend = earthBlend;
  // world3d's render() calls its own internal buildEarth(), which returns R.earth when it is set:
  // build ours first so render() uses it.
  const baseRender = A.render;
  A.render = function (nearScene, view) {
    if (A.R && !A.R.earth && view && view.alt > 6 && view.earth !== false) buildEarth();
    return baseRender(nearScene, view);
  };
})();
