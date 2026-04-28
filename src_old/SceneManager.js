import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import {
  EffectComposer, RenderPass, EffectPass,
  BloomEffect, SMAAEffect, VignetteEffect,
  SSAOEffect, NormalPass,
} from 'postprocessing';

export class SceneManager {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6a9bc8);
    this.scene.fog = new THREE.FogExp2(0xa0b8cc, 0.0018);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false,
      depth: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.75;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 800);
    this.camera.position.set(0, 1.7, 0);

    this.composer = null;
    this._setupLighting();
    this._setupSky();
    this._setupPostProcessing();

    window.addEventListener('resize', () => this._onResize());
  }

  async loadEnvironment(onProgress) {
    return new Promise((resolve, reject) => {
      new RGBELoader().load('/env/outdoor_sky_4k.hdr', (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = tex;
        this.scene.backgroundIntensity = 0.35;
        this.scene.backgroundBlurriness = 0.02;
        this.scene.environmentIntensity = 0.8;
        if (onProgress) onProgress(1);
        resolve();
      }, (xhr) => {
        if (onProgress && xhr.total) onProgress(xhr.loaded / xhr.total);
      }, reject);
    });
  }

  _setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    this.scene.add(sky);

    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = 8;
    uniforms['rayleigh'].value = 1.2;
    uniforms['mieCoefficient'].value = 0.003;
    uniforms['mieDirectionalG'].value = 0.7;

    const phi = THREE.MathUtils.degToRad(90 - 28);
    const theta = THREE.MathUtils.degToRad(210);
    const sun = new THREE.Vector3();
    sun.setFromSphericalCoords(1, phi, theta);
    uniforms['sunPosition'].value.copy(sun);

    this.sky = sky;
  }

  _setupLighting() {
    const ambient = new THREE.HemisphereLight(0x8899aa, 0x443322, 0.6);
    this.scene.add(ambient);
    this.ambientLight = ambient;

    this.moonLight = new THREE.DirectionalLight(0xffeedd, 1.8);
    this.moonLight.position.set(50, 80, -60);
    this.moonLight.castShadow = true;
    const s = 130;
    this.moonLight.shadow.camera.left = -s;
    this.moonLight.shadow.camera.right = s;
    this.moonLight.shadow.camera.top = s;
    this.moonLight.shadow.camera.bottom = -s;
    this.moonLight.shadow.camera.near = 0.5;
    this.moonLight.shadow.camera.far = 300;
    this.moonLight.shadow.mapSize.set(4096, 4096);
    this.moonLight.shadow.bias = -0.0003;
    this.moonLight.shadow.normalBias = 0.02;
    this.scene.add(this.moonLight);

    this._setupLensFlare();

    const fillLight = new THREE.DirectionalLight(0xccddee, 0.2);
    fillLight.position.set(-30, 5, 40);
    this.scene.add(fillLight);

    this.fireLight = new THREE.PointLight(0xff4400, 0, 28, 2.0);
    this.fireLight.position.set(-20, 18, 0);
    this.scene.add(this.fireLight);

    this.fireFill = new THREE.PointLight(0xff2200, 0, 16, 2.5);
    this.fireFill.position.set(-20, 5, 0);
    this.scene.add(this.fireFill);

    this.alarmLight1 = new THREE.PointLight(0xff2200, 0, 18, 2);
    this.alarmLight1.position.set(0, 4, 30);
    this.scene.add(this.alarmLight1);

    this.alarmLight2 = new THREE.PointLight(0xff2200, 0, 18, 2);
    this.alarmLight2.position.set(0, 4, -30);
    this.scene.add(this.alarmLight2);
  }

  _setupLensFlare() {
    const mainTex = this._genFlareTexture(256, 0.6);
    const ringTex = this._genFlareTexture(128, 0.2);

    const lensflare = new Lensflare();
    lensflare.addElement(new LensflareElement(mainTex, 200, 0, new THREE.Color(0xffffee)));
    lensflare.addElement(new LensflareElement(ringTex, 60, 0.3, new THREE.Color(0xff8844)));
    lensflare.addElement(new LensflareElement(ringTex, 40, 0.6, new THREE.Color(0x88aaff)));
    this.moonLight.add(lensflare);
    this.lensflare = lensflare;
  }

  _genFlareTexture(size, falloff) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, `rgba(255,255,240,${falloff})`);
    g.addColorStop(0.3, `rgba(255,200,100,${falloff * 0.4})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  _setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const normalPass = new NormalPass(this.scene, this.camera);
    this.composer.addPass(normalPass);

    let ssao = null;
    try {
      ssao = new SSAOEffect(this.camera, normalPass.texture, {
        samples: 16,
        rings: 4,
        luminanceInfluence: 0.5,
        radius: 0.06,
        intensity: 2.2,
        bias: 0.025,
        fade: 0.01,
        resolutionScale: 0.5,
      });
    } catch (e) {
      console.warn('SSAO unavailable:', e.message);
    }

    this.bloom = new BloomEffect({
      intensity: 0.4,
      luminanceThreshold: 0.7,
      luminanceSmoothing: 0.15,
      mipmapBlur: true,
    });

    const smaa = new SMAAEffect();
    this.vignette = new VignetteEffect({ darkness: 0.6, offset: 0.25 });

    const effects = [this.bloom, smaa, this.vignette];
    if (ssao) effects.unshift(ssao);

    this.composer.addPass(new EffectPass(this.camera, ...effects));
    this.ssao = ssao;
  }

  setFireActive(active) {
    this.fireActive = active;
  }

  setAlarmActive(active) {
    this.alarmActive = active;
  }

  setAlarmPostProcess(intensity) {
    if (this.bloom) {
      this.bloom.intensity = 0.4 + intensity * 1.0;
    }
    if (this.vignette) {
      this.vignette.darkness = 0.6 + intensity * 0.4;
    }
  }

  update(elapsed) {
    if (this.fireActive) {
      const flicker = Math.sin(elapsed * 7.1) * 0.4
                    + Math.sin(elapsed * 13.3) * 0.2
                    + Math.sin(elapsed * 19.7) * 0.1;
      this.fireLight.intensity = 1.2 + flicker;
      this.fireFill.intensity  = 0.5 + flicker * 0.4;
    }
    if (this.alarmActive) {
      const p = Math.sin(elapsed * 4) > 0 ? 1 : 0;
      this.alarmLight1.intensity = p * 0.8;
      this.alarmLight2.intensity = (1 - p) * 0.8;
      this.setAlarmPostProcess(p * 0.25);
    } else {
      this.setAlarmPostProcess(0);
    }
  }

  render() {
    this.composer.render();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  dispose() {
    this.renderer.dispose();
    this.composer.dispose();
  }
}
