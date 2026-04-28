import * as THREE from 'three';

/**
 * FireEffect — EmberGen video simulation via THREE.VideoTexture + luma-key shader.
 *
 * The MP4 is a 6.67s / 30fps EmberGen fluid simulation on a black background.
 * A luma-key fragment shader makes dark pixels transparent, giving photorealistic
 * fire with no visible black rectangle.
 *
 * Rendering strategy:
 *  - 4 CROSSED PLANES at fixed Y rotations (0°, 45°, 90°, 135°) — NOT billboarded.
 *    From any camera angle, 2–3 planes overlap, creating a volumetric fire column.
 *  - 2 BILLBOARD PLANES face the camera for the bright inner glow.
 *  - 3 PROCEDURAL SMOKE planes (FBM shader) — smoke above the fire.
 *  - GLOW DISC — flat lit disc on the tank top, connects fire to surface.
 *  - EMBERS — 200 GL_POINTS sparks rising from the base.
 *  - 2 flickering PointLights — illuminate the tank shell only.
 */

// ── luma-key vertex shader ───────────────────────────────────────────
const FIRE_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ── luma-key fire shader — samples the video, removes black bg ───────
const FIRE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uVideo;
uniform float     uIntensity;
uniform bool      uFlip;
varying vec2      vUv;

void main() {
  // Optional horizontal flip for back-faces of crossed planes
  vec2 uv = uFlip ? vec2(1.0 - vUv.x, vUv.y) : vUv;

  vec4 col = texture2D(uVideo, uv);

  // Luma key — black/dark pixels become transparent
  float luma  = dot(col.rgb, vec3(0.299, 0.587, 0.114));
  float alpha = smoothstep(0.04, 0.22, luma) * uIntensity;

  // Slightly shift colour toward petroleum-fire orange (campfire is too yellow-green)
  col.r = min(1.0, col.r * 1.10);
  col.g = col.g * 0.88;
  col.b = col.b * 0.60;

  // Fade the very top of the billboard so it dissolves into smoke
  float topFade = smoothstep(1.0, 0.82, vUv.y);
  // Bottom 18% fades to transparent — lets the tank geometry blend with the fire base
  float botFade = smoothstep(0.0, 0.18, vUv.y);

  gl_FragColor = vec4(col.rgb, alpha * topFade * botFade);
}
`;

// ── procedural smoke shader (FBM) ────────────────────────────────────
const SMOKE_VERT = /* glsl */`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SMOKE_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uIntensity;
uniform float uPhase;
varying vec2  vUv;

float hash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+43.21);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=noise(p)*a;p=p*2.1+vec2(3.2,7.4);a*=.5;}return v;}

void main(){
  float t = uTime*.13+uPhase;
  float q = fbm(vUv*.9+vec2(0,-t));
  float f = fbm(vUv*.8+vec2(q*.8,-t*.75));
  float vF = smoothstep(0.,.28,vUv.y)*smoothstep(1.,.1,vUv.y);
  float hF = smoothstep(0.,.18,vUv.x)*smoothstep(1.,.82,vUv.x);
  float val = clamp(f*vF*hF,0.,1.);
  float g = .09+val*.18;
  gl_FragColor = vec4(g,g,g,val*.28*uIntensity);
}
`;

// ─────────────────────────────────────────────────────────────────────

export class FireEffect {
  constructor(scene, position, radius = 7) {
    this.scene     = scene;
    this.position  = position.clone();
    this.radius    = radius;
    this.active    = false;
    this.time      = 0;
    this.intensity = 1.0;
    this._targetI  = 1.0;

    this._crossed   = [];
    this._billboard = [];
    this._smoke     = [];
    this._lights    = [];
    this._video     = null;
    this._videoTex  = null;

    this._smokeGeo = new THREE.PlaneGeometry(1, 1);
    this._fireGeo  = new THREE.PlaneGeometry(1, 1);

    this._initVideo();
    this._buildSmoke();
    this._buildLights();
  }

  // ── video setup ───────────────────────────────────────────────────

  _initVideo() {
    const vid = document.createElement('video');
    vid.src         = '/fire/fire.mp4';
    vid.loop        = true;
    vid.muted       = true;
    vid.playsInline = true;
    vid.autoplay    = true;
    vid.crossOrigin = 'anonymous';

    // 60% speed — makes the fire look heavier and more realistic
    vid.playbackRate = 0.6;

    // Play on load; also retry on first user gesture (mobile / strict autoplay policy)
    const tryPlay = () => { vid.playbackRate = 0.6; vid.play().catch(() => {}); };
    vid.addEventListener('canplay', tryPlay, { once: true });
    document.addEventListener('pointerdown', tryPlay, { once: true });

    const tex = new THREE.VideoTexture(vid);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.format    = THREE.RGBAFormat;

    this._video    = vid;
    this._videoTex = tex;

    // Build fire planes once the video has metadata (so we know its aspect ratio)
    vid.addEventListener('loadedmetadata', () => {
      this._buildCrossedPlanes();
      this._buildBillboardGlow();
      // If fire already started before video was ready, make them visible
      if (this.active) {
        [...this._crossed, ...this._billboard].forEach(m => { m.visible = true; });
      }
    }, { once: true });

    // Fallback — build with default aspect if metadata never fires
    setTimeout(() => {
      if (this._crossed.length === 0) {
        this._buildCrossedPlanes();
        this._buildBillboardGlow();
        if (this.active) {
          [...this._crossed, ...this._billboard].forEach(m => { m.visible = true; });
        }
      }
    }, 3000);
  }

  _fireMat(flip = false) {
    return new THREE.ShaderMaterial({
      vertexShader:   FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uVideo:     { value: this._videoTex },
        uIntensity: { value: 0 },
        uFlip:      { value: flip },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });
  }

  // ── fire planes ───────────────────────────────────────────────────

  _buildCrossedPlanes() {
    const vid = this._video;
    // Use video natural dimensions for aspect ratio, fallback 0.7 (portrait)
    const aspect = vid.videoWidth && vid.videoHeight
      ? vid.videoWidth / vid.videoHeight
      : 0.709;  // 1152/1626

    const ANGLES = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4];
    for (let i = 0; i < 4; i++) {
      const h = 14 + Math.random() * 4;  // 14-18 m tall
      const w = h * aspect * 1.25;       // scale to cover wide tank top
      const mesh = new THREE.Mesh(this._fireGeo, this._fireMat(false));
      mesh.scale.set(w, h, 1);
      mesh.rotation.y = ANGLES[i];
      // Base sits at fire position (tank top), rises upward
      mesh.position.set(this.position.x, this.position.y + h * 0.5, this.position.z);
      mesh.visible = false;
      this.scene.add(mesh);
      this._crossed.push(mesh);
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
        this.position.x + Math.cos(a) * r,
        this.position.y + h * 0.5,
        this.position.z + Math.sin(a) * r,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this._billboard.push(mesh);
    }
  }

  // ── smoke planes (procedural — above the video fire) ─────────────

  _buildSmoke() {
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader:   SMOKE_VERT,
        fragmentShader: SMOKE_FRAG,
        uniforms: {
          uTime:      { value: 0 },
          uIntensity: { value: 0 },
          uPhase:     { value: (i / 3) * Math.PI * 2 },
        },
        transparent: true,
        depthWrite:  false,
        blending:    THREE.NormalBlending,
        side:        THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(this._smokeGeo, mat);
      const w = 16 + Math.random() * 8;
      const h = 20 + Math.random() * 12;
      mesh.scale.set(w, h, 1);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2;
      mesh.position.set(
        this.position.x + Math.cos(a) * r,
        this.position.y + h * 0.54,
        this.position.z + Math.sin(a) * r,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this._smoke.push(mesh);
    }
  }

  // ── lights ────────────────────────────────────────────────────────

  _buildLights() {
    const cfg = [
      { color: 0xff4400, base: 2.5, y: 3,  range: 24 },
      { color: 0xff7700, base: 1.3, y: 10, range: 16 },
    ];
    for (const c of cfg) {
      const light = new THREE.PointLight(c.color, 0, c.range, 2.0);
      light.position.set(this.position.x, this.position.y + c.y, this.position.z);
      light.visible = false;
      this.scene.add(light);
      this._lights.push({ light, off: Math.random() * Math.PI * 2, base: c.base });
    }
  }

  // ── public API ────────────────────────────────────────────────────

  start() {
    this.active = true;
    [...this._crossed, ...this._billboard, ...this._smoke].forEach(m => { m.visible = true; });
    this._lights.forEach(l => { l.light.visible = true; });
    this._video?.play().catch(() => {});
  }

  stop() {
    this.active = false;
    [...this._crossed, ...this._billboard, ...this._smoke].forEach(m => {
      m.visible = false;
      if (m.material.uniforms?.uIntensity) m.material.uniforms.uIntensity.value = 0;
    });
    this._lights.forEach(l => { l.light.visible = false; l.light.intensity = 0; });
  }

  setIntensity(v) { this._targetI = Math.max(0.05, v); }

  update(delta, camera) {
    if (!this.active) return;
    this.time += delta;

    this.intensity += (this._targetI - this.intensity) * Math.min(1, delta * 0.5);
    const I = this.intensity;
    const T = this.time;

    // Billboard only the glow + smoke planes; crossed planes are fixed
    if (camera) {
      const q = camera.quaternion;
      [...this._billboard, ...this._smoke].forEach(m => m.quaternion.copy(q));
    }

    // Update video fire uniforms
    [...this._crossed, ...this._billboard].forEach(m => {
      m.material.uniforms.uIntensity.value = I;
    });

    // Update smoke uniforms
    this._smoke.forEach(m => {
      m.material.uniforms.uTime.value      = T;
      m.material.uniforms.uIntensity.value = I;
    });


    // Flicker lights
    for (const l of this._lights) {
      const f = 0.68
              + 0.22 * Math.sin(T * 8.1  + l.off)
              + 0.07 * Math.sin(T * 18.3 + l.off * 1.8)
              + 0.03 * Math.sin(T * 33.7 + l.off * 3.2);
      l.light.intensity = l.base * f * I;
    }
  }

  dispose() {
    this._fireGeo.dispose();
    this._smokeGeo.dispose();
    [...this._crossed, ...this._billboard, ...this._smoke].forEach(m => {
      m.material.dispose();
      this.scene.remove(m);
    });
    if (this._videoTex) this._videoTex.dispose();
    if (this._video)    { this._video.pause(); this._video.src = ''; }
    this._lights.forEach(l => this.scene.remove(l.light));
  }
}
