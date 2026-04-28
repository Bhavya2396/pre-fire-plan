import * as THREE from 'three';
import { waterSprite } from './SpriteTextures.js';

export class ProceduralEffects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.beacons = [];
    this.truckLights = [];
    this.spraySystem = null;
    this.sprayActive = false;
    this.valveWheels = [];
    this.activeValveWheel = null;
    this.dustParticles = null;
    this.fireActive = false;
  }

  createAlarmBeacons(positions) {
    const beaconGeo = new THREE.SphereGeometry(0.2, 8, 6);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 2.0,
      transparent: true, opacity: 0.9,
    });

    positions.forEach(pos => {
      const group = new THREE.Group();
      group.position.copy(pos);

      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 })
      );
      group.add(housing);

      const bulb = new THREE.Mesh(beaconGeo, beaconMat.clone());
      bulb.position.y = 0.2;
      group.add(bulb);

      const light = new THREE.PointLight(0xff4400, 0, 25, 2);
      light.position.y = 0.3;
      group.add(light);

      group.visible = false;
      this.scene.add(group);
      this.beacons.push({ group, bulb, light, offset: Math.random() * Math.PI * 2 });
    });
  }

  createTruckLights(truck, side = 'left') {
    if (!truck) return;
    const red = new THREE.PointLight(0xff0000, 0, 15, 2);
    const blue = new THREE.PointLight(0x0044ff, 0, 15, 2);
    red.position.set(side === 'left' ? -1 : 1, 3, 0);
    blue.position.set(side === 'left' ? 1 : -1, 3, 0);
    truck.add(red);
    truck.add(blue);
    this.truckLights.push({ red, blue, offset: Math.random() * Math.PI * 2 });
  }

  removeTruckLights(truck) {
    if (!truck) return;
    this.truckLights = this.truckLights.filter(tl => {
      if (tl.red.parent === truck || tl.blue.parent === truck) {
        tl.red.intensity = 0;
        tl.blue.intensity = 0;
        truck.remove(tl.red);
        truck.remove(tl.blue);
        tl.red.dispose();
        tl.blue.dispose();
        return false;
      }
      return true;
    });
  }

  createWaterSpray(position, radius = 10) {
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * 0.82 + Math.random() * radius * 0.18;
      pos[i * 3]     = Math.cos(angle) * r;
      pos[i * 3 + 1] = 3.6 + Math.random() * 0.4; // emit from ring height
      pos[i * 3 + 2] = Math.sin(angle) * r;
      // Velocity: slight inward + downward (simulate spray aimed at tank surface)
      const inX = -Math.cos(angle) * 0.8;
      const inZ = -Math.sin(angle) * 0.8;
      vel[i * 3]     = inX + (Math.random() - 0.5) * 0.3;
      vel[i * 3 + 1] = 0.5 + Math.random() * 1.2; // small upward then falls
      vel[i * 3 + 2] = inZ + (Math.random() - 0.5) * 0.3;
      life[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSprite: { value: waterSprite() } },
      vertexShader: `
        attribute vec3 aVelocity;
        attribute float aLife;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          float cycle = fract(uTime * 0.35 + aLife);
          vec3 p = position;
          p.x += aVelocity.x * cycle * 2.8;
          p.z += aVelocity.z * cycle * 2.8;
          p.y += aVelocity.y * cycle * 1.2 - 5.5 * cycle * cycle;
          vAlpha = max(0.0, (1.0 - cycle * 1.3)) * 0.65;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 36.0 * (1.0 - cycle * 0.4) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uSprite;
        varying float vAlpha;
        void main() {
          vec4 sprite = texture2D(uSprite, gl_PointCoord);
          if (sprite.a < 0.01) discard;
          gl_FragColor = vec4(0.5, 0.7, 1.0, sprite.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.spraySystem = new THREE.Points(geo, mat);
    this.spraySystem.position.copy(position);
    this.spraySystem.visible = false;
    this.scene.add(this.spraySystem);
  }

  activateSpray() {
    if (this.spraySystem) {
      this.spraySystem.visible = true;
      this.sprayActive = true;
    }
  }

  registerValveWheel(valveGroup) {
    const wheel = valveGroup.userData.wheelGroup
      || valveGroup.children.find(c => c.geometry?.type === 'TorusGeometry');
    if (!wheel) return;
    // mode: 'wheel' = multi-turn Y-axis spin; 'lever' = 90° Z-axis pivot
    const mode = valveGroup.userData.valveMode || 'wheel';
    this.valveWheels.push({ group: valveGroup, wheel, mode });
  }

  setActiveValve(valveGroup) {
    this.activeValveWheel = valveGroup;
  }

  clearActiveValve() {
    this.activeValveWheel = null;
  }

  // direction: 'cw' (close, top-of-wheel moves right) or 'ccw' (open).
  // For levers: direction is ignored — the lever always pivots +Z (arm rises to close).
  spinValve(valveGroup, direction = 'cw') {
    if (!valveGroup) return;
    const entry = this.valveWheels.find(v => v.group === valveGroup);
    if (!entry) return;
    if (!this._valveSpins) this._valveSpins = [];
    if (entry.mode === 'lever') {
      // Quarter-turn pivot on +Z (lever arm swings upward = closed position)
      this._valveSpins.push({ wheel: entry.wheel, elapsed: 0, duration: 0.9, totalRot: Math.PI / 2, axis: 'z' });
    } else {
      // Handwheel: CW = -Y rotation (top of wheel moves right from player's POV),
      // CCW = +Y rotation (top of wheel moves left, i.e. opening direction).
      const sign = direction === 'ccw' ? 1 : -1;
      this._valveSpins.push({ wheel: entry.wheel, elapsed: 0, duration: 1.5, totalRot: sign * Math.PI * 4, axis: 'y' });
    }
  }

  createDustParticles() {
    const count = 150;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rands = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = Math.random() * 30 + 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
      rands[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aRandom;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.2 + aRandom * 10.0) * 8.0;
          p.y += sin(uTime * 0.15 + aRandom * 6.28) * 2.0;
          p.z += cos(uTime * 0.18 + aRandom * 10.0) * 8.0;
          vAlpha = 0.15 + sin(uTime + aRandom * 6.28) * 0.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (15.0 + aRandom * 20.0) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = (1.0 - smoothstep(0.1, 0.5, d)) * vAlpha;
          gl_FragColor = vec4(0.8, 0.6, 0.3, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.dustParticles = new THREE.Points(geo, mat);
    this.dustParticles.visible = false;
    this.scene.add(this.dustParticles);
  }

  setFireActive(active) {
    this.fireActive = active;
    this.beacons.forEach(b => { b.group.visible = active; });
    if (this.dustParticles) this.dustParticles.visible = active;
  }

  setTrucksActive(active) {
    this.truckLights.forEach(tl => {
      tl.red.intensity = active ? 2 : 0;
      tl.blue.intensity = active ? 2 : 0;
    });
  }

  update(delta) {
    this.time += delta;

    // One-shot valve animations (spin for wheels, quarter-turn for levers)
    if (this._valveSpins) {
      for (let i = this._valveSpins.length - 1; i >= 0; i--) {
        const sp = this._valveSpins[i];
        sp.elapsed += delta;
        const t = Math.min(1, sp.elapsed / sp.duration);
        // Ease-out for a satisfying stop
        const ease = 1 - Math.pow(1 - t, 2);
        sp.wheel.rotation[sp.axis || 'y'] = sp.totalRot * ease;
        if (t >= 1) this._valveSpins.splice(i, 1);
      }
    }

    if (this.fireActive) {
      this.beacons.forEach(b => {
        const pulse = Math.sin(this.time * 6 + b.offset) * 0.5 + 0.5;
        b.bulb.material.emissiveIntensity = 1.0 + pulse * 2.0;
        b.light.intensity = pulse * 3;
        b.bulb.rotation.y = this.time * 3 + b.offset;
      });

      this.truckLights.forEach(tl => {
        const flash = Math.sin(this.time * 8 + tl.offset);
        tl.red.intensity = flash > 0 ? 3 : 0;
        tl.blue.intensity = flash > 0 ? 0 : 3;
      });

      if (this.dustParticles) {
        this.dustParticles.material.uniforms.uTime.value = this.time;
      }
    }

    if (this.sprayActive && this.spraySystem) {
      this.spraySystem.material.uniforms.uTime.value = this.time;
    }

    if (this.activeValveWheel) {
      const entry = this.valveWheels.find(v => v.group === this.activeValveWheel);
      if (entry && entry.wheel) {
        const axis = entry.mode === 'lever' ? 'z' : 'y';
        entry.wheel.rotation[axis] += delta * 4;
      }
    }
  }

  dispose() {
    this.beacons.forEach(b => {
      b.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
      this.scene.remove(b.group);
    });
    if (this.spraySystem) {
      this.spraySystem.geometry.dispose();
      this.spraySystem.material.dispose();
      this.scene.remove(this.spraySystem);
    }
    if (this.dustParticles) {
      this.dustParticles.geometry.dispose();
      this.dustParticles.material.dispose();
      this.scene.remove(this.dustParticles);
    }
  }
}
