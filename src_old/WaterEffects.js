import * as THREE from 'three';
import { waterSprite, steamSprite, foamSprite, traceSprite } from './SpriteTextures.js';

/**
 * WaterEffects — GPU particle systems that make the world react to player actions.
 *
 * Systems:
 *  - Cooling cascade: water falling down Tank 101-B shell
 *  - Foam jets: parabolic arcs from HVLRM monitors toward the fire
 *  - Steam wisps: small bursts where cooling water contacts hot metal
 *  - Foam blanket: growing white disc on Tank 101-A roof
 *  - Product pool: dark animated plane inside the dyke
 */
export class WaterEffects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this._systems = [];

    this.coolingCascade = null;
    this.coolingActive = false;

    this.foamJets = [];
    this.steamWisps = null;
    this.steamActive = false;

    this.foamBlanket = null;
    this.foamBlanketScale = 0;
    this.foamBlanketTarget = 0;

    this.productPool = null;
    this.poolScale = 0;
    this.poolGrowing = true;
  }

  /* ── Cooling water cascade on Tank 101-B ─────────────── */

  createCoolingCascade(tankPos, tankRadius = 5.5, tankHeight = 10) {
    const count = 400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rands = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      pos[i * 3]     = Math.cos(angle) * tankRadius;
      pos[i * 3 + 1] = tankHeight + Math.random() * 2;
      pos[i * 3 + 2] = Math.sin(angle) * tankRadius;
      rands[i] = Math.random();
      speeds[i] = 0.4 + Math.random() * 0.3;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(rands, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSprite: { value: waterSprite() } },
      vertexShader: `
        attribute float aRandom;
        attribute float aSpeed;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          float cycle = fract(uTime * aSpeed + aRandom);
          vec3 p = position;
          p.y = position.y - cycle * ${tankHeight.toFixed(1)};
          float r = length(position.xz);
          float outward = 1.0 + cycle * 0.08;
          p.x = position.x / r * r * outward;
          p.z = position.z / r * r * outward;
          p.x += sin(uTime * 3.0 + aRandom * 20.0) * 0.15;
          p.z += cos(uTime * 2.5 + aRandom * 15.0) * 0.15;
          vAlpha = (1.0 - cycle) * 0.55;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (25.0 + aRandom * 15.0) * (1.0 - cycle * 0.3) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uSprite;
        varying float vAlpha;
        void main() {
          vec4 sprite = texture2D(uSprite, gl_PointCoord);
          if (sprite.a < 0.01) discard;
          gl_FragColor = vec4(0.6, 0.8, 1.0, sprite.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.coolingCascade = new THREE.Points(geo, mat);
    this.coolingCascade.position.copy(tankPos);
    this.coolingCascade.visible = false;
    this.scene.add(this.coolingCascade);
    this._systems.push(this.coolingCascade);
  }

  startCooling() {
    if (this.coolingCascade) {
      this.coolingCascade.visible = true;
      this.coolingActive = true;
    }
    if (this.steamWisps) {
      this.steamWisps.visible = true;
      this.steamActive = true;
    }
  }

  /* ── Steam wisps at base of cooling cascade ──────────── */

  createSteamWisps(tankPos, tankRadius = 5.5) {
    const count = 80;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rands = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      pos[i * 3]     = Math.cos(angle) * (tankRadius + 0.5);
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(angle) * (tankRadius + 0.5);
      rands[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSprite: { value: steamSprite() } },
      vertexShader: `
        attribute float aRandom;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          float cycle = fract(uTime * 0.5 + aRandom);
          vec3 p = position;
          p.y += cycle * 6.0;
          float expand = 1.0 + cycle * 1.5;
          p.x *= expand;
          p.z *= expand;
          p.x += sin(uTime * 1.5 + aRandom * 10.0) * cycle * 2.0;
          vAlpha = (1.0 - cycle) * smoothstep(0.0, 0.1, cycle) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (40.0 + aRandom * 30.0) * (0.5 + cycle) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uSprite;
        varying float vAlpha;
        void main() {
          vec4 sprite = texture2D(uSprite, gl_PointCoord);
          if (sprite.a < 0.01) discard;
          gl_FragColor = vec4(0.9, 0.9, 0.95, sprite.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.steamWisps = new THREE.Points(geo, mat);
    this.steamWisps.position.copy(tankPos);
    this.steamWisps.visible = false;
    this.scene.add(this.steamWisps);
    this._systems.push(this.steamWisps);
  }

  /* ── Foam jet (parabolic arc from monitor to tank top) ── */

  createFoamJet(fromPos, toPos, id) {
    const count = 250;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rands = new Float32Array(count);
    const speeds = new Float32Array(count);

    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    for (let i = 0; i < count; i++) {
      pos[i * 3]     = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      rands[i] = Math.random();
      speeds[i] = 0.3 + Math.random() * 0.2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(rands, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const arcHeight = Math.max(15, toPos.y + 5);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFrom: { value: new THREE.Vector3(fromPos.x, fromPos.y + 1.5, fromPos.z) },
        uTo: { value: new THREE.Vector3(toPos.x, toPos.y, toPos.z) },
        uArcH: { value: arcHeight },
        uWaterSprite: { value: traceSprite() },
        uFoamSprite:  { value: foamSprite() },
      },
      vertexShader: `
        attribute float aRandom;
        attribute float aSpeed;
        uniform float uTime;
        uniform vec3 uFrom;
        uniform vec3 uTo;
        uniform float uArcH;
        varying float vAlpha;
        varying float vFoam;
        void main() {
          float cycle = fract(uTime * aSpeed + aRandom);
          // Parametric position along the arc
          float t = cycle;
          vec3 p = mix(uFrom, uTo, t);
          // Parabolic arc
          p.y += uArcH * 4.0 * t * (1.0 - t);
          // Spread at the end (impact splash)
          float splash = smoothstep(0.85, 1.0, t);
          p.x += sin(aRandom * 30.0) * splash * 3.0;
          p.z += cos(aRandom * 25.0) * splash * 3.0;
          // Lateral jitter along stream
          p.x += sin(uTime * 4.0 + aRandom * 20.0) * 0.3 * (1.0 - splash);
          p.z += cos(uTime * 3.0 + aRandom * 15.0) * 0.3 * (1.0 - splash);
          vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - splash * 0.5) * 0.7;
          vFoam = smoothstep(0.7, 1.0, t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float sz = mix(15.0, 35.0, splash);
          gl_PointSize = sz / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uWaterSprite;
        uniform sampler2D uFoamSprite;
        varying float vAlpha;
        varying float vFoam;
        void main() {
          vec4 wSpr = texture2D(uWaterSprite, gl_PointCoord);
          vec4 fSpr = texture2D(uFoamSprite, gl_PointCoord);
          vec4 sprite = mix(wSpr, fSpr, vFoam);
          if (sprite.a < 0.01) discard;
          vec3 waterCol = vec3(0.4, 0.6, 1.0);
          vec3 foamCol  = vec3(0.95, 0.95, 0.9);
          vec3 col = mix(waterCol, foamCol, vFoam);
          gl_FragColor = vec4(col, sprite.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const jet = new THREE.Points(geo, mat);
    jet.visible = false;
    jet.userData.jetId = id;
    this.scene.add(jet);
    this.foamJets.push(jet);
    this._systems.push(jet);
    return jet;
  }

  startFoamJet(id) {
    const jet = this.foamJets.find(j => j.userData.jetId === id);
    if (jet) jet.visible = true;
  }

  /* ── Foam blanket on tank top ────────────────────────── */

  createFoamBlanket(tankPos, tankRadius = 5, tankHeight = 12) {
    const geo = new THREE.CircleGeometry(tankRadius * 1.1, 48);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 0 },
      },
      vertexShader: `
        uniform float uScale;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position * uScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          if (d > 1.0) discard;
          float edge = 1.0 - smoothstep(0.7, 1.0, d);
          // Foam texture: noisy white surface
          float noise = fract(sin(dot(vUv * 40.0, vec2(12.9898, 78.233))) * 43758.5453);
          float foam = 0.85 + noise * 0.15;
          float shimmer = sin(uTime * 2.0 + vUv.x * 30.0) * 0.03 + sin(uTime * 1.5 + vUv.y * 25.0) * 0.03;
          float alpha = edge * (0.75 + shimmer);
          gl_FragColor = vec4(vec3(foam, foam * 0.98, foam * 0.9), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.foamBlanket = new THREE.Mesh(geo, mat);
    this.foamBlanket.position.set(tankPos.x, tankHeight + 0.2, tankPos.z);
    this.foamBlanket.visible = false;
    this.scene.add(this.foamBlanket);
    this._systems.push(this.foamBlanket);
  }

  growFoamBlanket(targetScale) {
    this.foamBlanketTarget = targetScale;
    if (this.foamBlanket) this.foamBlanket.visible = true;
  }

  /* ── Product pool in dyke ────────────────────────────── */

  createProductPool(dykeCenter, maxRadius = 18) {
    const geo = new THREE.CircleGeometry(maxRadius, 48);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 0 },
      },
      vertexShader: `
        uniform float uScale;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position * uScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          if (d > 1.0) discard;
          float edge = 1.0 - smoothstep(0.85, 1.0, d);
          // Dark oil surface with subtle reflections
          float ripple = sin(vUv.x * 60.0 + uTime * 1.5) * sin(vUv.y * 50.0 + uTime * 1.2) * 0.04;
          vec3 oil = vec3(0.03, 0.02, 0.01);
          // Faint orange fire reflection
          float fireRefl = (sin(uTime * 3.0 + d * 8.0) * 0.5 + 0.5) * 0.06 * (1.0 - d);
          vec3 col = oil + vec3(fireRefl * 1.0, fireRefl * 0.4, 0.0) + ripple;
          gl_FragColor = vec4(col, edge * 0.85);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.productPool = new THREE.Mesh(geo, mat);
    this.productPool.position.set(dykeCenter.x, 0.06, dykeCenter.z);
    this.productPool.visible = false;
    this.scene.add(this.productPool);
    this._systems.push(this.productPool);
  }

  startPool() {
    if (this.productPool) {
      this.productPool.visible = true;
      this.poolGrowing = true;
    }
  }

  stopPoolGrowth() {
    this.poolGrowing = false;
  }

  /* ── Update ──────────────────────────────────────────── */

  update(delta) {
    this.time += delta;

    if (this.coolingActive && this.coolingCascade) {
      this.coolingCascade.material.uniforms.uTime.value = this.time;
    }

    if (this.steamActive && this.steamWisps) {
      this.steamWisps.material.uniforms.uTime.value = this.time;
    }

    for (const jet of this.foamJets) {
      if (jet.visible) {
        jet.material.uniforms.uTime.value = this.time;
      }
    }

    if (this.foamBlanket && this.foamBlanket.visible) {
      this.foamBlanketScale += (this.foamBlanketTarget - this.foamBlanketScale) * delta * 0.5;
      this.foamBlanket.material.uniforms.uScale.value = this.foamBlanketScale;
      this.foamBlanket.material.uniforms.uTime.value = this.time;
    }

    if (this.productPool && this.productPool.visible) {
      if (this.poolGrowing) {
        this.poolScale = Math.min(1, this.poolScale + delta * 0.03);
      }
      this.productPool.material.uniforms.uScale.value = this.poolScale;
      this.productPool.material.uniforms.uTime.value = this.time;
    }
  }

  dispose() {
    for (const sys of this._systems) {
      if (sys.geometry) sys.geometry.dispose();
      if (sys.material) sys.material.dispose();
      this.scene.remove(sys);
    }
    this._systems = [];
  }
}
