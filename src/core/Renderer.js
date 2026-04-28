import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, SMAAEffect, VignetteEffect,
  SSAOEffect, NormalPass
} from 'postprocessing';

function createLensflareTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,220,1)');
  gradient.addColorStop(0.2, 'rgba(255,200,100,0.6)');
  gradient.addColorStop(0.5, 'rgba(255,160,60,0.15)');
  gradient.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Sun positioned south-east, behind the player who faces the fire to the north.
// phi=72 = lower angle (28deg above horizon), theta=135 = SE — stays out of the
// player's forward view frustum and avoids the direct bloom in screen centre.
const SUN_PHI = THREE.MathUtils.degToRad(72);
const SUN_THETA = THREE.MathUtils.degToRad(135);

export default class Renderer {
  constructor(canvas, eventBus) {
    this._canvas = canvas;
    this._eventBus = eventBus;
    this._fireActive = false;
    this._alarmActive = false;
    this._disposed = false;

    this._initRenderer(canvas);
    this._initCamera();
    this._initScene();
    this.scene.add(this.camera);
    this._initSky();
    this._initLights();
    this._initPostProcessing();
    this._bindEvents();

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  /* ---- Renderer ---- */

  _initRenderer(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false,
    });
    this.renderer.shadowMap.enabled = true;
    // PCF (not PCFSoft) — same shape, ~2× faster on the shadow pass.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The sun is fixed for the entire game. Render shadows ONCE after
    // the world is built, then keep them frozen. This is by far the
    // biggest per-frame cost we can eliminate (sometimes >40% of frame).
    // Game.markShadowsDirty() forces a re-bake when needed.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.16;
    // Cap retina rendering at 1.25× — for an integrated 5K display this
    // alone roughly halves fragment work vs raw devicePixelRatio.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  }

  /* ---- Camera ---- */

  _initCamera() {
    const aspect = this._canvas.clientWidth / this._canvas.clientHeight || 1;
    // Far plane 800 → 350. Combined with the existing fog (0.0018) this
    // pushes everything beyond ~250 m into the fog wall, so frustum
    // culling + depth fade do most of the heavy lifting.
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 350);
    this.camera.position.set(0, 1.7, 0);
  }

  /* ---- Scene ---- */

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6a9bc8);
    this.scene.fog = new THREE.FogExp2(0xa0b8cc, 0.0018);
  }

  /* ---- Sky ---- */

  _initSky() {
    this._sky = new Sky();
    this._sky.scale.setScalar(450000);
    const uniforms = this._sky.material.uniforms;
    uniforms.turbidity.value = 8;
    uniforms.rayleigh.value = 0.22;
    uniforms.mieCoefficient.value = 0.003;
    uniforms.mieDirectionalG.value = 0.78;

    this._sunPosition = new THREE.Vector3();
    this._sunPosition.setFromSphericalCoords(1, SUN_PHI, SUN_THETA);
    uniforms.sunPosition.value.copy(this._sunPosition);

    this.scene.add(this._sky);
  }

  /* ---- Lights ---- */

  _initLights() {
    // Hemisphere
    this._hemiLight = new THREE.HemisphereLight(0x8899aa, 0x443322, 0.10);
    this.scene.add(this._hemiLight);

    // Sun directional. Position is DERIVED from the same `_sunPosition`
    // unit vector that the Sky shader uses, scaled out to ~120 m so
    // shadow casters fall inside the orthographic frustum. Single source
    // of truth — change SUN_PHI / SUN_THETA to relight the entire scene.
    this._sunLight = new THREE.DirectionalLight(0xffeedd, 0.18);
    const sunDir = this._sunPosition.clone().multiplyScalar(120);
    this._sunLight.position.copy(sunDir);
    this._sunLight.castShadow = true;
    // 2K shadow map = 4× less fill than 4K. Tighter frustum keeps texel
    // density similar (~5 cm/texel across the active 100 m play area).
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.left = -100;
    this._sunLight.shadow.camera.right = 100;
    this._sunLight.shadow.camera.top = 100;
    this._sunLight.shadow.camera.bottom = -100;
    this._sunLight.shadow.camera.near = 0.5;
    this._sunLight.shadow.camera.far = 260;
    this._sunLight.shadow.bias = -0.0003;
    this.scene.add(this._sunLight);

    // Lensflare removed — was creating a massive washed-out bloom in
    // the centre of the screen and covering the fire visuals.

    // Fill light
    this._fillLight = new THREE.DirectionalLight(0xccddee, 0.08);
    this._fillLight.position.set(-30, 5, 40);
    this.scene.add(this._fillLight);

    // Fire point lights — REMOVED. FireSystem owns the fire lights and
    // positions them on the actual burning tank. The previous PointLights
    // here were hard-coded at (0,2,0) and (1,3,-0.5) which lit up the
    // dyke origin instead of TANK_A.

    // Alarm point lights
    this._alarmLights = [
      new THREE.PointLight(0xff0000, 0, 40, 2),
      new THREE.PointLight(0xff0000, 0, 40, 2),
    ];
    this._alarmLights[0].position.set(-10, 3, 5);
    this._alarmLights[1].position.set(10, 3, -5);
    this._alarmLights.forEach((l) => this.scene.add(l));
  }

  /* ---- Post Processing ---- */

  _initPostProcessing() {
    this._composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });

    const renderPass = new RenderPass(this.scene, this.camera);
    this._composer.addPass(renderPass);

    const normalPass = new NormalPass(this.scene, this.camera);
    this._composer.addPass(normalPass);

    const ssao = new SSAOEffect(this.camera, normalPass.texture, {
      samples: 6,
      rings: 2,
      radius: 0.05,
      intensity: 1.8,
      // resolutionScale 0.5 = SSAO computed at half-res then upsampled.
      // Looks identical at this radius/sample count and is ~4× cheaper.
      resolutionScale: 0.5,
    });

    const bloom = new BloomEffect({
      intensity: 0.08,
      luminanceThreshold: 0.95,
      mipmapBlur: true,
      kernelSize: 2,
    });

    const smaa = new SMAAEffect();

    const vignette = new VignetteEffect({ darkness: 0.6 });

    this._effectPass = new EffectPass(this.camera, ssao, bloom, smaa, vignette);
    this._composer.addPass(this._effectPass);
  }

  /* ---- EventBus bindings ---- */

  _bindEvents() {
    this._onFireStarted = () => this.setFireActive(true);
    this._onFireStopped = () => this.setFireActive(false);
    this._onAlarmOn = () => this.setAlarmActive(true);
    this._onAlarmOff = () => this.setAlarmActive(false);

    this._eventBus.on('fire:started', this._onFireStarted);
    this._eventBus.on('fire:stopped', this._onFireStopped);
    this._eventBus.on('alarm:on', this._onAlarmOn);
    this._eventBus.on('alarm:off', this._onAlarmOff);
  }

  /* ---- Public API ---- */

  /** IBL from OpenEXR (zip export `hdr.exr` → `public/env/aec23779_hdr.exr`). */
  async loadEnvironment(onProgress) {
    const loader = new EXRLoader();
    const tex = await loader.loadAsync('/env/aec23779_hdr.exr', onProgress);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = tex;
  }

  setFireActive(active) {
    this._fireActive = active;
  }

  setAlarmActive(active) {
    this._alarmActive = active;
    if (!active) {
      this._alarmLights.forEach((l) => { l.intensity = 0; });
    }
  }

  update(elapsed) {
    if (this._alarmActive) {
      const pulse = Math.sin(elapsed * 8) * 0.5 + 0.5;
      this._alarmLights[0].intensity = pulse * 4;
      this._alarmLights[1].intensity = (1 - pulse) * 4;
    }
  }

  /**
   * Re-bake the static sun shadow map. Call this any time the world
   * changes (after world build, after a placed model is added/removed,
   * or after a major prop animation). Cheaper than autoUpdate=true
   * because it only happens on demand.
   */
  markShadowsDirty() {
    this.renderer.shadowMap.needsUpdate = true;
  }

  render() {
    this._composer.render();
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this._composer.setSize(w, h);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    window.removeEventListener('resize', this._onResize);

    this._eventBus.off('fire:started', this._onFireStarted);
    this._eventBus.off('fire:stopped', this._onFireStopped);
    this._eventBus.off('alarm:on', this._onAlarmOn);
    this._eventBus.off('alarm:off', this._onAlarmOff);

    this._composer.dispose();
    this.renderer.dispose();
  }
}
