import * as THREE from 'three';

// ── Luma-key vertex shader ───────────────────────────────────────────
const FIRE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ── Luma-key fire fragment — samples video, removes black bg ─────────
const FIRE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uVideo;
uniform float     uIntensity;
uniform bool      uFlip;
varying vec2      vUv;

void main() {
  vec2 uv = uFlip ? vec2(1.0 - vUv.x, vUv.y) : vUv;
  vec4 col = texture2D(uVideo, uv);
  float luma  = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float alpha = smoothstep(0.04, 0.22, luma) * uIntensity;
  col.r = min(1.0, col.r * 1.10);
  col.g = col.g * 0.88;
  col.b = col.b * 0.60;
  float topFade = smoothstep(1.0, 0.82, vUv.y);
  float botFade = smoothstep(0.0, 0.18, vUv.y);
  gl_FragColor = vec4(col.rgb, alpha * topFade * botFade);
}
`;

// ── Procedural smoke (FBM) ───────────────────────────────────────────
const SMOKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const SMOKE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uIntensity;
uniform float uPhase;
varying vec2  vUv;

float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 43.21); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += noise(p) * a; p = p * 2.1 + vec2(3.2, 7.4); a *= 0.5; } return v; }

void main() {
  float t = uTime * 0.13 + uPhase;
  float q = fbm(vUv * 0.9 + vec2(0, -t));
  float f = fbm(vUv * 0.8 + vec2(q * 0.8, -t * 0.75));
  float vF = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.1, vUv.y);
  float hF = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  float val = clamp(f * vF * hF, 0.0, 1.0);
  float g = 0.09 + val * 0.18;
  gl_FragColor = vec4(g, g, g, val * 0.28 * uIntensity);
}
`;

// ── Foam / water jet particle shaders ────────────────────────────────
const FOAM_VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
uniform float uTime;
uniform vec3  uOrigin;
uniform vec3  uDirection;
uniform float uActive;
uniform float uMode;
varying float vAlpha;
varying float vSeed;

void main() {
  float cycle = fract(uTime * 1.8 + aLife);
  float t = cycle;

  vec3 fwd = normalize(uDirection);
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(fwd, worldUp));
  vec3 up    = normalize(cross(right, fwd));

  vec3 p = uOrigin + fwd * t * 16.0;
  p.y -= 1.8 * t * t;

  float waterSpread = 0.15 + aSeed * 0.35;
  float foamSpread  = 0.6 + aSeed * 1.4;
  float spread = mix(waterSpread, foamSpread, uMode);
  p += right * sin(aSeed * 47.3 + uTime * 2.2) * t * spread;
  p += up    * cos(aSeed * 31.7 + uTime * 1.6) * t * spread * 0.5;

  vAlpha = (1.0 - t * t) * 0.9 * uActive;
  vSeed  = aSeed;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float waterSize = 6.0 + t * 12.0 + aSeed * 5.0;
  float foamSize  = 14.0 + t * 24.0 + aSeed * 10.0;
  gl_PointSize = mix(waterSize, foamSize, uMode) * uActive / max(-mv.z, 1.0);
  gl_Position  = projectionMatrix * mv;
}
`;

const FOAM_FRAG = /* glsl */ `
varying float vAlpha;
varying float vSeed;
uniform float uMode;
uniform sampler2D uTex;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec4 texel = texture2D(uTex, gl_PointCoord);
  float shape = texel.r;

  float edgeFade = 1.0 - smoothstep(0.35, 0.5, length(gl_PointCoord - 0.5));
  shape *= edgeFade;

  if (shape < 0.02) discard;

  vec3 waterCol = mix(vec3(0.6, 0.82, 0.98), vec3(0.88, 0.95, 1.0), shape);
  vec3 foamCol  = mix(vec3(0.92, 0.94, 0.97), vec3(1.0, 1.0, 1.0), shape * 0.5);

  vec3 col = mix(waterCol, foamCol, uMode);
  col += (hash(vSeed * 13.7) - 0.5) * 0.03;

  float a = shape * vAlpha * mix(0.7, 0.9, uMode);
  gl_FragColor = vec4(col, a);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute float aLife;
attribute float aSeed;
uniform float uTime;
uniform vec3  uImpact;
uniform float uActive;
varying float vAlpha;

void main() {
  float cycle = fract(uTime * 2.5 + aLife);
  float t = cycle;

  float angle = aSeed * 6.2832;
  float speed = 0.8 + aSeed * 2.0;
  vec3 p = uImpact;
  p.x += cos(angle) * t * speed;
  p.z += sin(angle) * t * speed;
  p.y += t * (1.5 + aSeed) - 4.0 * t * t;

  vAlpha = (1.0 - t) * 0.7 * uActive;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (4.0 + aSeed * 6.0) * (1.0 - t * 0.5) * uActive / max(-mv.z, 1.0);
  gl_Position  = projectionMatrix * mv;
}
`;

const SPLASH_FRAG = /* glsl */ `
varying float vAlpha;
uniform sampler2D uTex;

void main() {
  vec4 texel = texture2D(uTex, gl_PointCoord);
  float shape = texel.r;
  float edge = 1.0 - smoothstep(0.3, 0.5, length(gl_PointCoord - 0.5));
  shape *= edge;
  if (shape < 0.02) discard;
  float a = shape * vAlpha;
  gl_FragColor = vec4(0.88, 0.94, 1.0, a);
}
`;

const JET_VERT = /* glsl */ `
uniform float uTime;
uniform float uActive;
varying vec2 vUv;
varying float vActive;

void main() {
  vUv = uv;
  vActive = uActive;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const JET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uMode;
varying vec2 vUv;
varying float vActive;

void main() {
  float scroll = fract(vUv.y * 3.0 - uTime * 4.0);
  float core = 1.0 - smoothstep(0.3, 0.5, abs(vUv.x - 0.5));
  float lengthFade = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  float ripple = 0.85 + 0.15 * sin(scroll * 6.2832);

  vec3 waterCol = vec3(0.5, 0.75, 0.95);
  vec3 foamCol  = vec3(0.92, 0.95, 0.98);
  vec3 col = mix(waterCol, foamCol, uMode);

  float a = core * lengthFade * ripple * vActive * 0.55;
  gl_FragColor = vec4(col, a);
}
`;

export default class FireSystem {
  constructor(scene, camera, eventBus) {
    this.scene = scene;
    this.camera = camera;
    this.eventBus = eventBus;

    // ── Fire effect state ──────────────────────────────────────
    this._firePos = new THREE.Vector3();
    this._fireActive = false;
    this._fireTime = 0;
    this._fireIntensity = 1.0;
    this._targetIntensity = 1.0;

    this._crossed = [];
    this._crossedBaseScale = [];   // [x, y] base scale per plane
    this._billboard = [];
    this._billboardBaseScale = [];
    this._smoke = [];
    this._lights = [];
    this._video = null;
    this._videoTex = null;

    // ── Post-extinguish smoke ──────────────────────────────────
    this._postSmoke = [];
    this._postSmokeActive = false;
    this._postSmokeTime = 0;
    this._postSmokeDuration = 18.0; // seconds of lingering smoke

    this._smokeGeo = new THREE.PlaneGeometry(1, 1);
    this._fireGeo = new THREE.PlaneGeometry(1, 1);

    // ── Hose state machine ─────────────────────────────────────
    this._hoseState = 'idle';
    this._hoseId = null;
    this._connectedHydrant = null;
    this._hoseMesh = null;
    this._hoseMat = null;
    this._hoseCurve = null;
    this._hoseCurvePts = null;
    this._hoseTmp = null;
    this._lastPlayerPos = new THREE.Vector3();
    this._nozzleMesh = null;
    this._nozzleBail = null;
    this._nozzleTipDummy = null;
    this._nozzleCouplingDummy = null;
    this._foamParticles = null;
    this._jetCoreMesh = null;
    this._splashParticles = null;
    this._sprayPlanes = [];
    this._sprayCore = null;
    this._sprayMistPoints = null;
    this._sprayMistData = null;
    this._sprayPuffPoints = null;
    this._sprayPuffData = null;
    this._tubeFrame = 0;

    this._sprayTime = 0;
    this._fireHealth = 1.0;
    this._sprayMode = 'water';
    this._coolingHits = 0; // throttles cooling sound + steam puff frequency

    this._initVideo();
    this._buildSmoke();
    this._buildPostSmoke();
    this._buildLights();
    this._buildNozzleModel();
    this._buildFoamSystem();
    this._bindEvents();
  }

  // ═══════════════════════════════════════════════════════════════
  //  FIRE EFFECT — VIDEO + SHADERS
  // ═══════════════════════════════════════════════════════════════

  _initVideo() {
    const vid = document.createElement('video');
    vid.src = '/fire/fire.mp4';
    vid.loop = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.autoplay = true;
    vid.crossOrigin = 'anonymous';
    vid.playbackRate = 0.6;

    const tryPlay = () => { vid.playbackRate = 0.6; vid.play().catch(() => {}); };
    vid.addEventListener('canplay', tryPlay, { once: true });
    document.addEventListener('pointerdown', tryPlay, { once: true });

    const tex = new THREE.VideoTexture(vid);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.format = THREE.RGBAFormat;

    this._video = vid;
    this._videoTex = tex;

    vid.addEventListener('loadedmetadata', () => {
      this._buildCrossedPlanes();
      this._buildBillboardGlow();
      if (this._fireActive) {
        [...this._crossed, ...this._billboard].forEach(m => { m.visible = true; });
      }
    }, { once: true });

    setTimeout(() => {
      if (this._crossed.length === 0) {
        this._buildCrossedPlanes();
        this._buildBillboardGlow();
        if (this._fireActive) {
          [...this._crossed, ...this._billboard].forEach(m => { m.visible = true; });
        }
      }
    }, 3000);
  }

  _fireMat(flip = false) {
    return new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uVideo: { value: this._videoTex },
        uIntensity: { value: 0 },
        uFlip: { value: flip },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }

  _buildCrossedPlanes() {
    const vid = this._video;
    const aspect = vid.videoWidth && vid.videoHeight
      ? vid.videoWidth / vid.videoHeight
      : 0.709;

    const ANGLES = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4];
    for (let i = 0; i < 4; i++) {
      const h = 14 + Math.random() * 4;
      const w = h * aspect * 1.25;
      const mesh = new THREE.Mesh(this._fireGeo, this._fireMat(false));
      mesh.scale.set(w, h, 1);
      mesh.rotation.y = ANGLES[i];
      mesh.position.set(this._firePos.x, this._firePos.y + h * 0.5, this._firePos.z);
      mesh.visible = false;
      this.scene.add(mesh);
      this._crossed.push(mesh);
      this._crossedBaseScale.push([w, h]);
    }
  }

  _buildBillboardGlow() {
    const vid = this._video;
    const aspect = vid.videoWidth && vid.videoHeight
      ? vid.videoWidth / vid.videoHeight : 0.709;

    for (let i = 0; i < 2; i++) {
      const h = 12 + Math.random() * 3;
      const w = h * aspect * 1.1;
      const mesh = new THREE.Mesh(this._fireGeo, this._fireMat(i % 2 === 1));
      mesh.scale.set(w, h, 1);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2;
      mesh.position.set(
        this._firePos.x + Math.cos(a) * r,
        this._firePos.y + h * 0.5,
        this._firePos.z + Math.sin(a) * r,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this._billboard.push(mesh);
      this._billboardBaseScale.push([w, h]);
    }
  }

  _buildSmoke() {
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SMOKE_VERT,
        fragmentShader: SMOKE_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uPhase: { value: (i / 3) * Math.PI * 2 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this._smokeGeo, mat);
      const w = 16 + Math.random() * 8;
      const h = 20 + Math.random() * 12;
      mesh.scale.set(w, h, 1);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2;
      mesh.position.set(
        this._firePos.x + Math.cos(a) * r,
        this._firePos.y + h * 0.54,
        this._firePos.z + Math.sin(a) * r,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this._smoke.push(mesh);
    }
  }

  _buildLights() {
    const cfg = [
      { color: 0xff4400, base: 2.5, y: 3, range: 24 },
      { color: 0xff7700, base: 1.3, y: 10, range: 16 },
    ];
    for (const c of cfg) {
      const light = new THREE.PointLight(c.color, 0, c.range, 2.0);
      light.position.set(this._firePos.x, this._firePos.y + c.y, this._firePos.z);
      light.visible = false;
      this.scene.add(light);
      this._lights.push({ light, off: Math.random() * Math.PI * 2, base: c.base });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOSE SYSTEM — NOZZLE + JET + TUBE
  // ═══════════════════════════════════════════════════════════════

  _buildNozzleModel() {
    const group = new THREE.Group();

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xb8b8b8, roughness: 0.2, metalness: 0.95,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xc49a3c, roughness: 0.3, metalness: 0.85,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, roughness: 0.95, metalness: 0.0,
    });
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222, roughness: 0.4, metalness: 0.3,
    });

    /* ── Coupling end (where the hose connects) ── */
    const coupling = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.042, 0.06, 12),
      brassMat,
    );
    coupling.rotation.x = Math.PI / 2;
    coupling.position.z = 0.04;
    group.add(coupling);

    const couplingRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.042, 0.005, 8, 16),
      chromeMat,
    );
    couplingRing.position.z = 0.02;
    group.add(couplingRing);

    /* ── Main barrel ── */
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.032, 0.32, 12),
      brassMat,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.14;
    group.add(barrel);

    for (const rz of [-0.06, -0.14, -0.22]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.033, 0.003, 8, 16),
        chromeMat,
      );
      ring.position.z = rz;
      group.add(ring);
    }

    /* ── Adjustment ring (black rubber band) ── */
    const adjustRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.025, 12),
      rubberMat,
    );
    adjustRing.rotation.x = Math.PI / 2;
    adjustRing.position.z = -0.28;
    group.add(adjustRing);

    /* ── Tip / diffuser cone ── */
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.035, 0.08, 12),
      chromeMat,
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.z = -0.34;
    group.add(tip);

    const tipRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.015, 0.003, 8, 12),
      brassMat,
    );
    tipRim.position.z = -0.38;
    group.add(tipRim);

    /* ── Pistol grip ── */
    const gripMain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.10, 8),
      rubberMat,
    );
    gripMain.position.set(0, -0.06, -0.06);
    gripMain.rotation.x = -0.15;
    group.add(gripMain);

    const gripBulge = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 8, 6),
      rubberMat,
    );
    gripBulge.position.set(0, -0.11, -0.055);
    group.add(gripBulge);

    /* ── Trigger guard ring ── */
    const guardShape = new THREE.TorusGeometry(0.025, 0.003, 6, 12, Math.PI);
    const guard = new THREE.Mesh(guardShape, chromeMat);
    guard.rotation.set(Math.PI / 2, 0, Math.PI);
    guard.position.set(0, -0.04, -0.08);
    group.add(guard);

    /* ── Bail lever (the squeeze-to-spray handle) ── */
    const bailGroup = new THREE.Group();
    bailGroup.position.set(0, 0.015, -0.02);

    const bailArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.012, 0.16),
      redMat,
    );
    bailArm.position.z = -0.07;
    bailGroup.add(bailArm);

    const bailGrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8),
      rubberMat,
    );
    bailGrip.rotation.z = Math.PI / 2;
    bailGrip.position.z = -0.14;
    bailGroup.add(bailGrip);

    group.add(bailGroup);
    this._nozzleBail = bailGroup;

    /* Invisible anchor points — used to get exact world positions of
       the nozzle tip (spray origin) and the coupling (hose end) each frame,
       accounting for sway / rotation automatically via the scene graph. */
    this._nozzleTipDummy = new THREE.Object3D();
    this._nozzleTipDummy.position.set(0, 0, -0.42); // just past the tip exit
    group.add(this._nozzleTipDummy);

    this._nozzleCouplingDummy = new THREE.Object3D();
    this._nozzleCouplingDummy.position.set(0, 0, 0.10); // at the hose-connect end
    group.add(this._nozzleCouplingDummy);

    group.scale.setScalar(2.2);
    group.visible = false;
    this._nozzleMesh = group;
    this.camera.add(group);
    group.position.set(0.35, -0.28, -0.55);
  }

  _buildPostSmoke() {
    // Realistic billowing smoke from a looped video texture (smoke.mp4)
    const video = document.createElement('video');
    video.src = '/fire/smoke.mp4';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    // Required so the video pumps frames once started, even when not yet visible
    video.addEventListener('loadeddata', () => { video.play().catch(() => {}); });
    this._postSmokeVideo = video;

    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.format    = THREE.RGBAFormat;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._postSmokeTex = tex;

    const VIDEO_SMOKE_FRAG = /* glsl */ `
      precision highp float;
      uniform sampler2D uTex;
      uniform float uAlpha;
      uniform vec2  uUvOff;
      uniform vec2  uUvScale;
      varying vec2  vUv;

      void main() {
        vec2 uv = uUvOff + vUv * uUvScale;
        vec4 c  = texture2D(uTex, uv);
        // Smoke videos are white-on-black; use luminance for alpha and tint dark
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        vec3 col  = mix(vec3(0.05, 0.04, 0.03), vec3(0.55, 0.5, 0.46), lum);
        // Soft edge fade so the rectangle never shows
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x)
                   * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        gl_FragColor = vec4(col, lum * uAlpha * edge);
      }
    `;

    const vert = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader:   vert,
        fragmentShader: VIDEO_SMOKE_FRAG,
        uniforms: {
          uTex:     { value: tex },
          uAlpha:   { value: 0 },
          // Each plane samples a slightly different region of the video so they don't all show identical frames
          uUvOff:   { value: new THREE.Vector2((i % 2) * 0.05, Math.floor(i / 2) * 0.07) },
          uUvScale: { value: new THREE.Vector2(0.95, 0.93) },
        },
        transparent: true,
        depthWrite:  false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
      });
      const w = 18 + i * 3;
      const h = 24 + i * 4;
      const mesh = new THREE.Mesh(this._smokeGeo, mat);
      mesh.scale.set(w, h, 1);
      const a = (i / 4) * Math.PI * 2;
      const r = 1.5 + i * 0.4;
      mesh.position.set(
        this._firePos.x + Math.cos(a) * r,
        this._firePos.y + h * 0.52,
        this._firePos.z + Math.sin(a) * r,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this._postSmoke.push(mesh);
    }
  }

  _buildFoamSystem() {
    /* ════════════════════════════════════════════════════════════════
       PROCEDURAL HOSE SPRAY — no video textures.
       Three layers stacked from inside out:
         1. CORE   — solid CylinderGeometry cone w/ internal turbulence,
                     normal alpha blending. Dense, opaque, readable.
         2. STREAK — 6 thin radial planes ("spokes") with a high-freq
                     procedural noise stretched along the jet axis,
                     mimicking motion-blurred water droplets. Additive.
         3. MIST   — GPU points fired from the nozzle, gravity-affected,
                     simulating atomization at the periphery.
       All three respond to uMode (0=water, 1=foam) and master uAlpha.
       ════════════════════════════════════════════════════════════════ */

    /* Cheap hash-based fbm — used by both core + streak shaders. */
    const NOISE_GLSL = /* glsl */ `
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float amp = 0.5;
        for (int k = 0; k < 4; k++) {
          v += amp * vnoise(p);
          p *= 2.07;
          amp *= 0.52;
        }
        return v;
      }
    `;

    const vert = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    /* 1. CORE CONE - Cylinder w/ small radius at nozzle, wide at far end.
       Translated up so its nozzle end sits at local origin; in update()
       we just point local +Y along spray direction. Normal alpha
       blending so it reads as an opaque dense water column. */
    const coreH = 9.0;
    const coreGeo = new THREE.CylinderGeometry(1.05, 0.04, coreH, 24, 8, true);
    coreGeo.translate(0, coreH * 0.5, 0);

    const CORE_FRAG = /* glsl */ `
      precision highp float;
      ${NOISE_GLSL}
      uniform float uTime;
      uniform float uAlpha;
      uniform float uMode;
      varying vec2  vUv;

      void main() {
        // vUv.x around circumference, vUv.y along length (0=nozzle, 1=far)
        // Stretched anisotropic noise: high-freq along Y (motion blur)
        vec2 p = vec2(vUv.x * 4.0, vUv.y * 14.0 - uTime * 5.5);
        float n  = fbm(p);
        float n2 = fbm(vec2(vUv.x * 2.0, vUv.y * 5.0 - uTime * 2.2));
        float turbulence = mix(0.55, 1.0, n * 0.6 + n2 * 0.4);

        float lenFade = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float rim = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);

        // HDR colours > 1.0 — additive blending makes the jet glow against
        // any background, just like a real pressurised water jet in sunlight.
        vec3 waterInner = vec3(1.6, 2.0, 2.4);   // intense cyan-white burst
        vec3 waterRim   = vec3(0.6, 1.1, 1.8);   // vivid blue rim
        vec3 foamInner  = vec3(2.2, 2.2, 2.2);   // pure bright foam
        vec3 foamRim    = vec3(1.2, 1.4, 1.6);   // cool foam edge

        vec3 inner = mix(waterInner, foamInner, uMode);
        vec3 rimC  = mix(waterRim,   foamRim,   uMode);
        vec3 col   = mix(rimC, inner, rim);
        col *= turbulence;

        // Stronger alpha so core is fully opaque before turbulence dims it
        float a = uAlpha * lenFade * (0.72 + rim * 0.28);
        gl_FragColor = vec4(col, a);
      }
    `;

    const coreMat = new THREE.ShaderMaterial({
      vertexShader:   vert,
      fragmentShader: CORE_FRAG,
      uniforms: {
        uTime:  { value: 0 },
        uAlpha: { value: 0.0 },
        uMode:  { value: 0.0 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });

    const core = new THREE.Mesh(coreGeo, coreMat);
    core.frustumCulled = false;
    core.visible = false;
    this.scene.add(core);
    this._sprayCore = core;

    /* 2. STREAK PLANES - 6 radial spokes around the jet axis with
       high-freq vertical noise. Mimics fast water droplets blurred by
       speed. Additive on top of core for HDR sparkle. */
    const STREAK_FRAG = /* glsl */ `
      precision highp float;
      ${NOISE_GLSL}
      uniform float uTime;
      uniform float uAlpha;
      uniform float uMode;
      uniform float uSeed;
      varying vec2  vUv;

      void main() {
        vec2 p = vec2(vUv.x * 10.0 + uSeed, vUv.y * 32.0 - uTime * 12.0);
        float n  = fbm(p);
        float streak = pow(smoothstep(0.45, 0.85, n), 1.6);

        float lenFade  = smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
        float sideFade = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x);

        vec3 waterCol = vec3(1.2, 1.7, 2.2);   // HDR cyan-blue streaks
        vec3 foamCol  = vec3(2.0, 2.0, 2.0);   // HDR white foam streaks
        vec3 col = mix(waterCol, foamCol, uMode);

        float a = streak * uAlpha * lenFade * sideFade * 1.0;
        gl_FragColor = vec4(col, a);
      }
    `;

    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const STREAK_COUNT = 6;
    for (let i = 0; i < STREAK_COUNT; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader:   vert,
        fragmentShader: STREAK_FRAG,
        uniforms: {
          uTime:  { value: 0 },
          uAlpha: { value: 0.0 },
          uMode:  { value: 0.0 },
          uSeed:  { value: i * 7.31 },
        },
        transparent: true,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
        side:        THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this._sprayPlanes.push({ mesh, phase: (i / STREAK_COUNT) * Math.PI * 2 });
    }

    /* 3. MIST POINTS - Kenney circle_05.png for crisp water droplets.
       300 points fired from the nozzle in a forward cone with random
       spread + gravity. Lifetime ~1.2s. Second layer uses smoke_03.png
       for large slow foam puffs at the far end of the jet. */
    const loader = new THREE.TextureLoader();
    const dropletTex = loader.load('/particles/circle_05.png');
    const puffTex    = loader.load('/particles/smoke_03.png');

    const MIST_COUNT = 300;
    const positions = new Float32Array(MIST_COUNT * 3);
    const sizes     = new Float32Array(MIST_COUNT);
    const alphas    = new Float32Array(MIST_COUNT);

    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mistGeo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
    mistGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(alphas, 1));

    // Shared vertex shader for both droplet and puff layers.
    const mistVert = /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPxScale;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPxScale / max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `;

    // Droplet layer — circle_05 texture tinted HDR cyan/white.
    const mistMat = new THREE.ShaderMaterial({
      uniforms: {
        uPxScale: { value: window.innerHeight * 0.5 },
        uMode:    { value: 0.0 },
        uTex:     { value: dropletTex },
      },
      vertexShader: mistVert,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uTex;
        uniform float     uMode;
        varying float     vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a < 0.05) discard;
          vec3 waterCol = vec3(1.0, 1.6, 2.2);
          vec3 foamCol  = vec3(2.0, 2.0, 2.0);
          vec3 col = mix(waterCol, foamCol, uMode) * t.rgb;
          float a = t.a * vAlpha;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    const mist = new THREE.Points(mistGeo, mistMat);
    mist.frustumCulled = false;
    mist.visible = false;
    this.scene.add(mist);
    this._sprayMistPoints = mist;

    // Puff layer — smoke_03.png: larger, slower blobs that drift away
    // from the jet for a bubbly foam / mist-cloud look.
    const PUFF_COUNT = 80;
    const puffPositions = new Float32Array(PUFF_COUNT * 3);
    const puffSizes     = new Float32Array(PUFF_COUNT);
    const puffAlphas    = new Float32Array(PUFF_COUNT);

    const puffGeo = new THREE.BufferGeometry();
    puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPositions, 3));
    puffGeo.setAttribute('aSize',    new THREE.BufferAttribute(puffSizes, 1));
    puffGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(puffAlphas, 1));

    const puffMat = new THREE.ShaderMaterial({
      uniforms: {
        uPxScale: { value: window.innerHeight * 0.5 },
        uMode:    { value: 0.0 },
        uTex:     { value: puffTex },
      },
      vertexShader: mistVert,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uTex;
        uniform float     uMode;
        varying float     vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a < 0.05) discard;
          vec3 waterCol = vec3(0.7, 0.95, 1.4);
          vec3 foamCol  = vec3(1.4, 1.4, 1.4);
          vec3 col = mix(waterCol, foamCol, uMode) * t.rgb;
          float a = t.a * vAlpha * 0.7;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    const puffs = new THREE.Points(puffGeo, puffMat);
    puffs.frustumCulled = false;
    puffs.visible = false;
    this.scene.add(puffs);
    this._sprayPuffPoints = puffs;

    // Puff CPU ring-buffer state
    this._sprayPuffData = {
      count:    PUFF_COUNT,
      writeIdx: 0,
      vel:      new Float32Array(PUFF_COUNT * 3),
      age:      new Float32Array(PUFF_COUNT),
      life:     new Float32Array(PUFF_COUNT),
      positions: puffPositions, sizes: puffSizes, alphas: puffAlphas,
    };
    for (let i = 0; i < PUFF_COUNT; i++) {
      this._sprayPuffData.age[i]  = 99;
      this._sprayPuffData.life[i] = 1;
    }

    this._sprayMistData = {
      count:     MIST_COUNT,
      writeIdx:  0,
      vel:       new Float32Array(MIST_COUNT * 3),
      age:       new Float32Array(MIST_COUNT),
      life:      new Float32Array(MIST_COUNT),
      positions, sizes, alphas,
    };
    for (let i = 0; i < MIST_COUNT; i++) {
      this._sprayMistData.age[i]  = 99;
      this._sprayMistData.life[i] = 1;
    }

    this._foamParticles   = null;
    this._jetCoreMesh     = null;
    this._splashParticles = null;
  }

  /* Spawns N new mist particles at the nozzle tip with cone-spread
     velocity along the spray direction. Called every spray frame. */
  _emitSprayMist(originX, originY, originZ, dirX, dirY, dirZ, n) {
    if (!this._sprayMistData) return;
    const d = this._sprayMistData;
    const upRef = Math.abs(dirY) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let rx = upRef[1] * dirZ - upRef[2] * dirY;
    let ry = upRef[2] * dirX - upRef[0] * dirZ;
    let rz = upRef[0] * dirY - upRef[1] * dirX;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    const ux = dirY * rz - dirZ * ry;
    const uy = dirZ * rx - dirX * rz;
    const uz = dirX * ry - dirY * rx;

    for (let k = 0; k < n; k++) {
      const i = d.writeIdx;
      d.writeIdx = (d.writeIdx + 1) % d.count;

      const ang = Math.random() * Math.PI * 2;
      const r   = Math.random() * 0.06;
      const ox  = Math.cos(ang) * r;
      const oy  = Math.sin(ang) * r;

      d.positions[i * 3]     = originX + rx * ox + ux * oy;
      d.positions[i * 3 + 1] = originY + ry * ox + uy * oy;
      d.positions[i * 3 + 2] = originZ + rz * ox + uz * oy;

      const speed   = 9 + Math.random() * 5;
      const spread  = 0.18;
      const sx = (Math.random() - 0.5) * spread;
      const sy = (Math.random() - 0.5) * spread;
      d.vel[i * 3]     = dirX * speed + (rx * sx + ux * sy) * speed;
      d.vel[i * 3 + 1] = dirY * speed + (ry * sx + uy * sy) * speed;
      d.vel[i * 3 + 2] = dirZ * speed + (rz * sx + uz * sy) * speed;

      d.age[i]  = 0;
      d.life[i] = 0.9 + Math.random() * 0.6;
    }
  }

  _updateSprayMist(delta) {
    if (!this._sprayMistData || !this._sprayMistPoints) return;
    const d = this._sprayMistData;
    const G = -3.5;
    let alive = 0;

    for (let i = 0; i < d.count; i++) {
      d.age[i] += delta;
      if (d.age[i] >= d.life[i]) {
        d.alphas[i] = 0;
        d.sizes[i]  = 0;
        continue;
      }
      alive++;
      d.vel[i * 3 + 1] += G * delta;
      d.positions[i * 3]     += d.vel[i * 3]     * delta;
      d.positions[i * 3 + 1] += d.vel[i * 3 + 1] * delta;
      d.positions[i * 3 + 2] += d.vel[i * 3 + 2] * delta;

      const t = d.age[i] / d.life[i];
      d.sizes[i]  = 0.06 + t * 0.26;
      d.alphas[i] = (1.0 - t) * (1.0 - t) * 0.85;
    }

    this._sprayMistPoints.geometry.attributes.position.needsUpdate = true;
    this._sprayMistPoints.geometry.attributes.aSize.needsUpdate    = true;
    this._sprayMistPoints.geometry.attributes.aAlpha.needsUpdate   = true;
    this._sprayMistPoints.visible = alive > 0;
  }

  /* Emits N slow foam puffs (smoke_03) at a wider cone spread.
     Called once per spray frame alongside _emitSprayMist. */
  _emitSprayPuffs(originX, originY, originZ, dirX, dirY, dirZ, n) {
    if (!this._sprayPuffData) return;
    const d = this._sprayPuffData;
    const upRef = Math.abs(dirY) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let rx = upRef[1] * dirZ - upRef[2] * dirY;
    let ry = upRef[2] * dirX - upRef[0] * dirZ;
    let rz = upRef[0] * dirY - upRef[1] * dirX;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    const ux = dirY * rz - dirZ * ry;
    const uy = dirZ * rx - dirX * rz;
    const uz = dirX * ry - dirY * rx;

    for (let k = 0; k < n; k++) {
      const i = d.writeIdx;
      d.writeIdx = (d.writeIdx + 1) % d.count;

      // Spawn partway along the jet (not at the nozzle) so puffs appear
      // to blossom from the middle and far end of the water column.
      const jDist = 2.0 + Math.random() * 5.0;
      const ang = Math.random() * Math.PI * 2;
      const r   = Math.random() * 0.25;
      const ox  = Math.cos(ang) * r;
      const oy  = Math.sin(ang) * r;

      d.positions[i * 3]     = originX + dirX * jDist + rx * ox + ux * oy;
      d.positions[i * 3 + 1] = originY + dirY * jDist + ry * ox + uy * oy;
      d.positions[i * 3 + 2] = originZ + dirZ * jDist + rz * ox + uz * oy;

      const speed = 1.5 + Math.random() * 2.0;
      const spread = 0.55;
      const sx = (Math.random() - 0.5) * spread;
      const sy = (Math.random() - 0.5) * spread;
      d.vel[i * 3]     = dirX * speed * 0.3 + (rx * sx + ux * sy) * speed;
      d.vel[i * 3 + 1] = dirY * speed * 0.3 + (ry * sx + uy * sy) * speed + 0.4;
      d.vel[i * 3 + 2] = dirZ * speed * 0.3 + (rz * sx + uz * sy) * speed;

      d.age[i]  = 0;
      d.life[i] = 1.2 + Math.random() * 0.8;
    }
  }

  _updateSprayPuffs(delta) {
    if (!this._sprayPuffData || !this._sprayPuffPoints) return;
    const d = this._sprayPuffData;
    const G = -1.2;
    let alive = 0;

    for (let i = 0; i < d.count; i++) {
      d.age[i] += delta;
      if (d.age[i] >= d.life[i]) {
        d.alphas[i] = 0;
        d.sizes[i]  = 0;
        continue;
      }
      alive++;
      d.vel[i * 3 + 1] += G * delta;
      d.positions[i * 3]     += d.vel[i * 3]     * delta;
      d.positions[i * 3 + 1] += d.vel[i * 3 + 1] * delta;
      d.positions[i * 3 + 2] += d.vel[i * 3 + 2] * delta;

      const t = d.age[i] / d.life[i];
      // Puffs grow from small to large (0.18m → 0.9m)
      d.sizes[i]  = 0.18 + t * 0.72;
      // Fade in quickly, hold, then fade out
      d.alphas[i] = Math.min(1.0, t * 5) * (1.0 - t) * (1.0 - t) * 0.9;
    }

    this._sprayPuffPoints.geometry.attributes.position.needsUpdate = true;
    this._sprayPuffPoints.geometry.attributes.aSize.needsUpdate    = true;
    this._sprayPuffPoints.geometry.attributes.aAlpha.needsUpdate   = true;
    this._sprayPuffPoints.visible = alive > 0;
  }

  /* ── Rubber hose tube ──────────────────────────────────
     A proper TubeGeometry mesh (dark rubber, ~0.035m radius) replaces
     the old invisible 1px THREE.Line. Rebuilt only when the player
     moves more than 0.3m to avoid per-frame geometry churn. */

  _createHoseTube() {
    if (this._hoseMesh) {
      this.scene.remove(this._hoseMesh);
      this._hoseMesh.geometry.dispose();
    }
    if (!this._hoseMat) {
      this._hoseMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.92, metalness: 0.05,
      });
    }

    this._hoseCurvePts = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];
    this._hoseCurve = new THREE.CatmullRomCurve3(this._hoseCurvePts);
    this._hoseTmp = new THREE.Vector3();

    this._setCurvePoints(this._connectedHydrant, this._connectedHydrant);
    const geo = new THREE.TubeGeometry(this._hoseCurve, 32, 0.035, 6, false);
    this._hoseMesh = new THREE.Mesh(geo, this._hoseMat);
    this._hoseMesh.castShadow = true;
    this._hoseMesh.frustumCulled = false;
    this.scene.add(this._hoseMesh);
    this._lastPlayerPos.copy(this._connectedHydrant);
  }

  _setCurvePoints(hp, pp, time = 0) {
    const dx = pp.x - hp.x;
    const dz = pp.z - hp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const perpX = -dz / (dist || 1);
    const perpZ = dx / (dist || 1);

    const w1 = Math.sin(time * 2.8) * 0.12;
    const w2 = Math.sin(time * 3.5 + 1.3) * 0.18;
    const w3 = Math.sin(time * 2.1 + 2.7) * 0.10;

    const mx = (hp.x + pp.x) * 0.5;
    const mz = (hp.z + pp.z) * 0.5;

    const sag = Math.max(0.06, Math.min(0.30, dist * 0.015));

    this._hoseCurvePts[0].set(hp.x, 0.65, hp.z);
    this._hoseCurvePts[1].set(
      hp.x + dx * 0.25 + perpX * w1,
      0.18 + Math.sin(time * 1.5) * 0.04,
      hp.z + dz * 0.25 + perpZ * w1,
    );
    this._hoseCurvePts[2].set(
      mx + perpX * w2,
      sag + Math.sin(time * 2.0 + 0.8) * 0.03,
      mz + perpZ * w2,
    );
    this._hoseCurvePts[3].set(
      pp.x - dx * 0.25 + perpX * w3,
      0.22 + Math.sin(time * 1.8 + 1.5) * 0.04,
      pp.z - dz * 0.25 + perpZ * w3,
    );
    this._hoseCurvePts[4].set(pp.x, 0.85, pp.z);
  }

  _updateHoseTube(playerPos) {
    if (!this._hoseMesh || !this._connectedHydrant) return;

    this._tubeFrame++;
    if (this._tubeFrame % 3 !== 0) return;

    const time = performance.now() * 0.001;

    // End the hose at the player's ground-level XZ position — NOT at the
    // nozzle coupling dummy (which is near the camera and clips the near
    // plane, producing the "weird line" artifact in FPS view).
    const hoseEnd = playerPos;

    const moved = this._lastPlayerPos.distanceToSquared(hoseEnd);
    if (moved > 0.02) {
      this._lastPlayerPos.copy(hoseEnd);
    }

    this._setCurvePoints(this._connectedHydrant, hoseEnd, time);

    this._hoseMesh.geometry.dispose();
    this._hoseMesh.geometry = new THREE.TubeGeometry(this._hoseCurve, 32, 0.035, 6, false);
  }

  // ═══════════════════════════════════════════════════════════════
  //  EVENT BUS BINDINGS
  // ═══════════════════════════════════════════════════════════════

  _bindEvents() {
    const bus = this.eventBus;
    bus.on('fire:started', () => this.startFire());
    bus.on('hose:pickup', (id) => this.pickupHose(id));
    bus.on('hose:attach', (hydrantPos) => this.attachHose(hydrantPos));
    bus.on('hose:drop', () => this.dropHose());
    bus.on('hose:charge', () => this.chargeHose());
    bus.on('hose:spray-start', () => this.startSpraying());
    bus.on('hose:spray-stop', () => this.stopSpraying());
    bus.on('hose:set-mode', (mode) => this.setSprayMode(mode));
  }

  /* Spray medium toggle. 'water' (default) is the initial cooling
     stream from H-28/H-20; 'foam' kicks in once the foam nurser has
     been radioed in (request_foam step), giving the visible AFFF
     blanket on the burning tank. */
  setSprayMode(mode) {
    this._sprayMode = mode === 'foam' ? 'foam' : 'water';
    const modeVal = this._sprayMode === 'foam' ? 1.0 : 0.0;
    if (this._sprayCore?.material.uniforms?.uMode) {
      this._sprayCore.material.uniforms.uMode.value = modeVal;
    }
    this._sprayPlanes.forEach(({ mesh }) => {
      if (mesh.material.uniforms?.uMode) {
        mesh.material.uniforms.uMode.value = modeVal;
      }
    });
    if (this._sprayMistPoints?.material.uniforms?.uMode) {
      this._sprayMistPoints.material.uniforms.uMode.value = modeVal;
    }
    if (this._sprayPuffPoints?.material.uniforms?.uMode) {
      this._sprayPuffPoints.material.uniforms.uMode.value = modeVal;
    }
    this.eventBus.emit('hose:mode-change', this._sprayMode);
  }

  getSprayMode() { return this._sprayMode || 'water'; }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API — FIRE
  // ═══════════════════════════════════════════════════════════════

  setFirePosition(pos) {
    this._firePos.copy(pos);
    this._crossed.forEach(m => {
      m.position.x = pos.x;
      m.position.z = pos.z;
    });
    this._billboard.forEach(m => {
      m.position.x = pos.x;
      m.position.z = pos.z;
    });
    this._smoke.forEach(m => {
      m.position.x = pos.x;
      m.position.z = pos.z;
    });
    this._lights.forEach(l => {
      l.light.position.x = pos.x;
      l.light.position.z = pos.z;
    });
    this._postSmoke.forEach(m => {
      m.position.x = pos.x;
      m.position.z = pos.z;
    });
  }

  startFire() {
    this._fireActive = true;
    [...this._crossed, ...this._billboard, ...this._smoke].forEach(m => { m.visible = true; });
    this._lights.forEach(l => { l.light.visible = true; });
    this._video?.play().catch(() => {});
  }

  stopFire() {
    this._fireActive = false;
    [...this._crossed, ...this._billboard, ...this._smoke].forEach(m => {
      m.visible = false;
      if (m.material.uniforms?.uIntensity) m.material.uniforms.uIntensity.value = 0;
    });
    this._lights.forEach(l => { l.light.visible = false; l.light.intensity = 0; });

    // Start post-extinguish smoke
    this._postSmokeActive = true;
    this._postSmokeTime = 0;
    this._postSmokeVideo?.play().catch(() => {});
    this._postSmoke.forEach(m => {
      m.quaternion.copy(this.camera.quaternion);
      m.visible = true;
    });
  }

  setIntensity(v) { this._targetIntensity = Math.max(0.05, v); }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API — HOSE
  // ═══════════════════════════════════════════════════════════════

  pickupHose(id = null) {
    if (this._hoseState !== 'idle') return;
    this._hoseState = 'carrying';
    this._hoseId = id;
    // Make the nozzle visible the moment the hose is in hand so the
    // player gets immediate first-person feedback ("I'm carrying it").
    if (this._nozzleMesh) this._nozzleMesh.visible = true;
    this.eventBus.emit('hose:state-change', 'carrying');
  }

  dropHose() {
    if (this._hoseState === 'idle') return;
    this._hoseState = 'idle';
    this._hoseId = null;
    if (this._nozzleMesh) this._nozzleMesh.visible = false;
    if (this._hoseMesh) {
      this.scene.remove(this._hoseMesh);
      this._hoseMesh.geometry.dispose();
      this._hoseMesh = null;
    }
    this._connectedHydrant = null;
    this.eventBus.emit('hose:state-change', 'idle');
  }

  attachHose(hydrantPos) {
    if (this._hoseState !== 'carrying') return;
    this._hoseState = 'attached';
    this._connectedHydrant = hydrantPos.clone();
    this._createHoseTube();
    this.eventBus.emit('hose:state-change', 'attached');
  }

  chargeHose() {
    if (this._hoseState !== 'attached') return;
    this._hoseState = 'charged';
    if (this._nozzleMesh) this._nozzleMesh.visible = true;
    this.eventBus.emit('hose:state-change', 'charged');
  }

  getHoseId() { return this._hoseId || null; }

  startSpraying() {
    if (this._hoseState !== 'charged') return;
    this._hoseState = 'spraying';
    this.eventBus.emit('hose:state-change', 'spraying');
  }

  stopSpraying() {
    if (this._hoseState !== 'spraying') return;
    this._hoseState = 'charged';
    this.eventBus.emit('hose:state-change', 'charged');
  }

  getHoseState() { return this._hoseState; }
  getFireHealth() { return this._fireHealth; }

  getHosePrompt() {
    switch (this._hoseState) {
      case 'idle': return { label: 'FIRE HOSE', hint: 'Click to pick up' };
      case 'carrying': return { label: 'HOSE COUPLING', hint: 'Walk to hydrant and click to connect' };
      case 'attached': return { label: 'HYDRANT VALVE', hint: 'Turn valve to pressurize' };
      case 'charged': return { label: 'NOZZLE READY', hint: 'Hold CLICK to spray — aim at fire' };
      case 'spraying': return { label: 'SPRAYING', hint: `Fire: ${Math.round(this._fireHealth * 100)}%` };
      default: return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  UPDATE
  // ═══════════════════════════════════════════════════════════════

  update(delta, playerPos) {
    const T = this._fireTime;

    // ── Active fire update ─────────────────────────────────────
    if (this._fireActive) {
      this._fireTime += delta;

      this._fireIntensity += (this._targetIntensity - this._fireIntensity) * Math.min(1, delta * 0.5);
      const I = this._fireIntensity;
      // health-based scale: fire shrinks as it gets put out
      const H = Math.max(0.15, this._fireHealth);

      // Billboard glow + smoke planes track camera
      const q = this.camera.quaternion;
      [...this._billboard, ...this._smoke].forEach(m => m.quaternion.copy(q));

      // Fire planes: scale down with health
      this._crossed.forEach((m, i) => {
        if (this._crossedBaseScale[i]) {
          m.scale.set(
            this._crossedBaseScale[i][0] * H,
            this._crossedBaseScale[i][1] * H,
            1,
          );
          // Raise/lower plane Y so it stays ground-anchored
          m.position.y = this._firePos.y + this._crossedBaseScale[i][1] * H * 0.5;
        }
        m.material.uniforms.uIntensity.value = I;
      });
      this._billboard.forEach((m, i) => {
        if (this._billboardBaseScale[i]) {
          m.scale.set(
            this._billboardBaseScale[i][0] * H,
            this._billboardBaseScale[i][1] * H,
            1,
          );
          m.position.y = this._firePos.y + this._billboardBaseScale[i][1] * H * 0.5;
        }
        m.material.uniforms.uIntensity.value = I;
      });

      // Smoke: shrinks and dims with health too
      this._smoke.forEach(m => {
        m.material.uniforms.uTime.value = T;
        m.material.uniforms.uIntensity.value = I * H;
      });

      // Flickering lights — intensity scales with health
      for (const l of this._lights) {
        const f = 0.68
          + 0.22 * Math.sin(T * 8.1 + l.off)
          + 0.07 * Math.sin(T * 18.3 + l.off * 1.8)
          + 0.03 * Math.sin(T * 33.7 + l.off * 3.2);
        l.light.intensity = l.base * f * I * H;
      }
    }

    // ── Post-extinguish smoke ─────────────────────────────────
    if (this._postSmokeActive) {
      this._postSmokeTime += delta;
      const progress = this._postSmokeTime / this._postSmokeDuration;

      if (progress >= 1.0) {
        this._postSmokeActive = false;
        this._postSmoke.forEach(m => { m.visible = false; });
      } else {
        // Rise upward over time
        const q = this.camera.quaternion;
        this._postSmoke.forEach(m => {
          m.quaternion.copy(q);
          // Drift upward as smoke dissipates
          m.position.y += delta * 0.4;
          // Fade out in the last 40% of duration
          const alphaFade = progress < 0.6 ? 1.0 : 1.0 - (progress - 0.6) / 0.4;
          // Fade in during first 10%
          const alphaIn = Math.min(1.0, progress / 0.1);
          m.material.uniforms.uAlpha.value = alphaIn * alphaFade;
        });
      }
    }

    // ── Hose system update ─────────────────────────────────────
    if (this._hoseState === 'idle' || this._hoseState === 'carrying') return;

    if (this._connectedHydrant && playerPos) {
      this._updateHoseTube(playerPos);
    }

    const isSpraying = this._hoseState === 'spraying';
    const t = performance.now() * 0.001;

    // Nozzle sway + bail lever + recoil
    if (this._nozzleMesh && this._nozzleMesh.visible) {
      const swayAmp = isSpraying ? 0.004 : 0.012;
      const recoil = isSpraying ? Math.sin(t * 22) * 0.003 : 0;
      this._nozzleMesh.rotation.x = Math.sin(t * 1.5) * swayAmp + recoil;
      this._nozzleMesh.rotation.y = Math.sin(t * 1.2) * swayAmp * 0.7;

      if (this._nozzleBail) {
        const targetRot = isSpraying ? -0.35 : 0;
        this._nozzleBail.rotation.x += (targetRot - this._nozzleBail.rotation.x) * Math.min(1, delta * 8);
      }
    }

    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    const modeVal = this._sprayMode === 'foam' ? 1.0 : 0.0;

    // Always advance both particle layers (so they fade out smoothly
    // after the player releases the trigger).
    this._updateSprayMist(delta);
    this._updateSprayPuffs(delta);

    if (isSpraying) {
      // Orthonormal basis around the spray direction. Used by the core
      // cone (Y = dir), the streak spokes (Z = radial), and the mist
      // emission spread.
      const worldUp = Math.abs(dir.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const xBase = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
      const zBase = new THREE.Vector3().crossVectors(dir, xBase).normalize();

      // Use the exact world-space nozzle tip so spray aligns with the
      // physical nozzle model. Falls back to a camera-forward estimate
      // if the nozzle dummy hasn't been added yet.
      const origin = new THREE.Vector3();
      if (this._nozzleTipDummy) {
        this._nozzleTipDummy.getWorldPosition(origin);
      } else {
        camPos.clone().addScaledVector(dir, 1.0);
        origin.copy(camPos).addScaledVector(dir, 1.0);
      }

      /* CORE CONE - position at nozzle, orient local +Y along spray dir. */
      if (this._sprayCore) {
        this._sprayCore.visible = true;
        const coreRot = new THREE.Matrix4().makeBasis(xBase, dir, zBase);
        this._sprayCore.quaternion.setFromRotationMatrix(coreRot);
        this._sprayCore.position.copy(origin);
        const u = this._sprayCore.material.uniforms;
        u.uTime.value  = t;
        u.uMode.value  = modeVal;
        u.uAlpha.value = Math.min(0.92, u.uAlpha.value + delta * 5.0);
      }

      /* STREAK SPOKES - 6 thin radial planes. Y = dir (length axis),
         Z (face normal) = radial spoke direction, fanning 360deg around. */
      this._sprayPlanes.forEach(({ mesh, phase }, i) => {
        mesh.visible = true;

        const jetLen = 6.5 + i * 0.4;
        const jetW   = 0.85 + i * 0.12;
        const offX   = Math.sin(phase + t * 0.9) * (i * 0.04);
        const offZ   = Math.cos(phase + t * 0.7) * (i * 0.04);

        const planeOrigin = origin.clone()
          .addScaledVector(xBase, offX)
          .addScaledVector(zBase, offZ);
        const mid = planeOrigin.clone().addScaledVector(dir, jetLen * 0.5);

        const spokeZ = new THREE.Vector3()
          .addScaledVector(xBase, Math.cos(phase))
          .addScaledVector(zBase, Math.sin(phase));
        const spokeY = dir.clone();
        const spokeX = new THREE.Vector3().crossVectors(spokeY, spokeZ).normalize();
        const rotM = new THREE.Matrix4().makeBasis(spokeX, spokeY, spokeZ);
        mesh.quaternion.setFromRotationMatrix(rotM);

        mesh.scale.set(jetW, jetLen, 1);
        mesh.position.copy(mid);

        const u = mesh.material.uniforms;
        u.uTime.value  = t;
        u.uMode.value  = modeVal;
        u.uAlpha.value = Math.min(0.95, u.uAlpha.value + delta * 5.0);
      });

      /* MIST — Kenney circle_05 droplets: 28/frame tight cone */
      this._emitSprayMist(
        origin.x, origin.y, origin.z,
        dir.x,    dir.y,    dir.z,
        28,
      );
      /* PUFFS — Kenney smoke_03 foam clouds: 4/frame wide spread */
      this._emitSprayPuffs(
        origin.x, origin.y, origin.z,
        dir.x,    dir.y,    dir.z,
        4,
      );

      if (this._fireActive) {
        const toFire = new THREE.Vector3().subVectors(this._firePos, camPos);
        const dist = toFire.length();
        const angleBetween = dir.angleTo(toFire.clone().normalize());

        if (angleBetween < 0.45 && dist < 35) {
          this._sprayTime += delta;
          const rate = this._sprayMode === 'foam' ? 0.11 : 0.07;
          this._fireHealth = Math.max(0, this._fireHealth - delta * rate);
          this.setIntensity(this._fireHealth);

          this._coolingHits += delta;
          if (this._coolingHits > 0.33) {
            this._coolingHits = 0;
            this.eventBus.emit('tank:cooling', {
              mode: this._sprayMode,
              health: this._fireHealth,
            });
          }

          if (this._fireHealth <= 0) {
            this.stopFire();
            this.eventBus.emit('fire:extinguished');
          }
        }
      }
    } else {
      // Fade core
      if (this._sprayCore) {
        const u = this._sprayCore.material.uniforms;
        u.uAlpha.value = Math.max(0, u.uAlpha.value - delta * 6);
        if (u.uAlpha.value < 0.01) this._sprayCore.visible = false;
      }
      // Fade streaks
      this._sprayPlanes.forEach(({ mesh }) => {
        const u = mesh.material.uniforms;
        u.uAlpha.value = Math.max(0, u.uAlpha.value - delta * 6);
        if (u.uAlpha.value < 0.01) mesh.visible = false;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DISPOSE
  // ═══════════════════════════════════════════════════════════════

  dispose() {
    // Fire
    this._fireGeo.dispose();
    this._smokeGeo.dispose();
    [...this._crossed, ...this._billboard, ...this._smoke].forEach(m => {
      m.material.dispose();
      this.scene.remove(m);
    });
    if (this._videoTex) this._videoTex.dispose();
    if (this._video) { this._video.pause(); this._video.src = ''; }
    this._lights.forEach(l => this.scene.remove(l.light));

    // Post smoke
    this._postSmoke.forEach(m => {
      m.material.dispose();
      this.scene.remove(m);
    });
    if (this._postSmokeTex) this._postSmokeTex.dispose();
    if (this._postSmokeVideo) { this._postSmokeVideo.pause(); this._postSmokeVideo.src = ''; }

    // Hose
    if (this._hoseMesh) {
      this._hoseMesh.geometry.dispose();
      this.scene.remove(this._hoseMesh);
    }
    if (this._hoseMat) this._hoseMat.dispose();

    // Spray system (procedural cone + streak spokes + mist points)
    if (this._sprayCore) {
      this._sprayCore.geometry.dispose();
      this._sprayCore.material.dispose();
      this.scene.remove(this._sprayCore);
      this._sprayCore = null;
    }
    this._sprayPlanes.forEach(({ mesh }) => {
      mesh.material.dispose();
      this.scene.remove(mesh);
    });
    this._sprayPlanes = [];
    if (this._sprayMistPoints) {
      this._sprayMistPoints.geometry.dispose();
      this._sprayMistPoints.material.dispose();
      this.scene.remove(this._sprayMistPoints);
      this._sprayMistPoints = null;
    }
    this._sprayMistData = null;
    if (this._sprayPuffPoints) {
      this._sprayPuffPoints.geometry.dispose();
      this._sprayPuffPoints.material.dispose();
      this.scene.remove(this._sprayPuffPoints);
      this._sprayPuffPoints = null;
    }
    this._sprayPuffData = null;
    if (this._nozzleMesh) {
      this.camera.remove(this._nozzleMesh);
    }
  }
}
