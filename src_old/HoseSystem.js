import * as THREE from 'three';

/**
 * Immersive fire hose interaction system:
 *
 *  1. PICKUP — player walks to hose rack, clicks to pick up hose (carried in hand)
 *  2. ATTACH — player walks to hydrant, clicks to connect hose coupling
 *  3. CHARGE — player turns hydrant valve (rotate interaction) to pressurize
 *  4. AIM    — hose nozzle appears in first-person view, follows mouse
 *  5. SPRAY  — hold click to shoot water/foam jet toward aim point
 *  6. FIGHT  — sustained spray on fire reduces fire intensity → extinguish
 *
 * The hose renders as a catmull-rom tube from hydrant to player position,
 * updating every frame when connected.
 */
export class HoseSystem {
  constructor(scene, camera, fireEffect) {
    this.scene = scene;
    this.camera = camera;
    this.fireEffect = fireEffect;

    // State machine
    this.state = 'idle'; // idle → carrying → attached → charged → spraying
    this.connectedHydrant = null;
    this.hoseMesh = null;
    this.nozzleMesh = null;
    this.jetMesh = null;
    this.jetParticles = null;

    this._sprayTime = 0;
    this._fireHealth = 1.0;
    this._aimPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2(0, 0);

    this.onFireExtinguished = null;
    this.onStateChange = null;

    this._buildNozzleModel();
    this._buildJetSystem();
  }

  _buildNozzleModel() {
    const group = new THREE.Group();

    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x886633, roughness: 0.4, metalness: 0.7 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.35, 8), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.15;
    group.add(barrel);

    const tipMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.9 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 8), tipMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.35;
    group.add(tip);

    const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), gripMat);
    grip.position.set(0, -0.04, -0.08);
    group.add(grip);

    // Lever handle
    const leverMat = new THREE.MeshStandardMaterial({ color: 0xff4422, roughness: 0.4, metalness: 0.5 });
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.04), leverMat);
    lever.position.set(0, 0.03, -0.08);
    group.add(lever);

    group.visible = false;
    this.nozzleMesh = group;
    this.camera.add(group);
    group.position.set(0.25, -0.18, -0.4);
  }

  _buildJetSystem() {
    const count = 60;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const life = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      life[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uDirection: { value: new THREE.Vector3(0, 0, -1) },
        uActive: { value: 0.0 },
      },
      vertexShader: `
        attribute float aLife;
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform vec3 uDirection;
        uniform float uActive;
        varying float vAlpha;
        void main() {
          float cycle = fract(uTime * 2.0 + aLife);
          float t = cycle;
          vec3 p = uOrigin + uDirection * t * 18.0;
          // Gravity arc
          p.y -= 2.5 * t * t;
          // Spread
          p.x += sin(aLife * 62.8 + uTime * 3.0) * t * 0.8;
          p.z += cos(aLife * 62.8 + uTime * 3.0) * t * 0.8;
          vAlpha = (1.0 - t) * 0.7 * uActive;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (8.0 + t * 12.0) * uActive / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = (1.0 - smoothstep(0.2, 0.5, d)) * vAlpha;
          // White-blue foam color
          gl_FragColor = vec4(0.85, 0.92, 1.0, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.jetParticles = new THREE.Points(geo, mat);
    this.jetParticles.frustumCulled = false;
    this.scene.add(this.jetParticles);
  }

  pickup() {
    if (this.state !== 'idle') return;
    this.state = 'carrying';
    if (this.onStateChange) this.onStateChange('carrying');
  }

  canAttach(hydrantPos, playerPos) {
    if (this.state !== 'carrying') return false;
    const dist = hydrantPos.distanceTo(playerPos);
    return dist < 4.0;
  }

  attach(hydrantWorldPos) {
    if (this.state !== 'carrying') return;
    this.state = 'attached';
    this.connectedHydrant = hydrantWorldPos.clone();

    // Create visible hose tube from hydrant
    this._createHoseTube();

    if (this.onStateChange) this.onStateChange('attached');
  }

  charge() {
    if (this.state !== 'attached') return;
    this.state = 'charged';
    this.nozzleMesh.visible = true;

    if (this.onStateChange) this.onStateChange('charged');
  }

  startSpraying() {
    if (this.state !== 'charged') return;
    this.state = 'spraying';
    if (this.onStateChange) this.onStateChange('spraying');
  }

  stopSpraying() {
    if (this.state !== 'spraying') return;
    this.state = 'charged';
    if (this.onStateChange) this.onStateChange('charged');
  }

  _createHoseTube() {
    if (this.hoseMesh) {
      this.scene.remove(this.hoseMesh);
      this.hoseMesh.geometry.dispose();
    }

    if (!this._hoseMat) {
      this._hoseMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.6 });
    }
    const hoseMat = this._hoseMat;
    // Initial straight tube — gets updated in update() to follow player
    const points = [
      this.connectedHydrant.clone(),
      new THREE.Vector3(
        this.connectedHydrant.x,
        0.1,
        this.connectedHydrant.z + 2
      ),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 12, 0.04, 6, false);
    this.hoseMesh = new THREE.Mesh(geo, hoseMat);
    this.hoseMesh.castShadow = true;
    this.scene.add(this.hoseMesh);
  }

  _updateHoseTube(playerPos) {
    if (!this.hoseMesh || !this.connectedHydrant) return;

    // Only rebuild every ~4 frames to avoid per-frame allocation
    this._tubeFrame = (this._tubeFrame || 0) + 1;
    if (this._tubeFrame % 4 !== 0) return;

    this.scene.remove(this.hoseMesh);
    this.hoseMesh.geometry.dispose();
    if (this.hoseMesh.material) this.hoseMesh.material.dispose();

    const hp = this.connectedHydrant;
    const pp = playerPos;
    const mid = new THREE.Vector3(
      (hp.x + pp.x) / 2,
      0.05,
      (hp.z + pp.z) / 2
    );

    const points = [
      new THREE.Vector3(hp.x, 0.7, hp.z),
      new THREE.Vector3(hp.x, 0.3, hp.z + 1),
      mid,
      new THREE.Vector3(pp.x, 0.15, pp.z - 1),
      new THREE.Vector3(pp.x, 0.8, pp.z),
    ];

    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 16, 0.04, 6, false);
    this.hoseMesh = new THREE.Mesh(geo, this._hoseMat);
    this.hoseMesh.castShadow = true;
    this.scene.add(this.hoseMesh);
  }

  update(delta, playerPos, firePos) {
    if (this.state === 'idle' || this.state === 'carrying') return;

    // Update hose tube to follow player
    if (this.connectedHydrant) {
      this._updateHoseTube(playerPos);
    }

    // Nozzle sway
    if (this.nozzleMesh && this.nozzleMesh.visible) {
      const t = performance.now() * 0.001;
      this.nozzleMesh.rotation.x = Math.sin(t * 1.5) * 0.01;
      this.nozzleMesh.rotation.y = Math.sin(t * 1.2) * 0.008;
    }

    // Jet particles
    const jU = this.jetParticles.material.uniforms;
    jU.uTime.value += delta;

    if (this.state === 'spraying') {
      jU.uActive.value = Math.min(1.0, jU.uActive.value + delta * 3);

      // Jet origin = camera position, jet direction = camera forward
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      jU.uOrigin.value.copy(camPos);

      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      jU.uDirection.value.copy(dir);

      // Check if spray hits fire zone
      if (firePos) {
        // Raycast from camera to see if we're aiming near the fire
        const toFire = new THREE.Vector3().subVectors(firePos, camPos);
        const angleBetween = dir.angleTo(toFire.normalize());

        // Within ~25 degrees of fire center and close enough
        if (angleBetween < 0.45 && camPos.distanceTo(firePos) < 35) {
          this._sprayTime += delta;
          // Fire health decreases with sustained spray (takes ~12 seconds)
          this._fireHealth = Math.max(0, this._fireHealth - delta * 0.08);

          if (this.fireEffect) {
            this.fireEffect.setIntensity(this._fireHealth);
          }

          if (this._fireHealth <= 0 && this.onFireExtinguished) {
            this.onFireExtinguished();
          }
        }
      }
    } else {
      jU.uActive.value = Math.max(0, jU.uActive.value - delta * 5);
    }
  }

  getState() { return this.state; }

  getFireHealth() { return this._fireHealth; }

  getPrompt() {
    switch (this.state) {
      case 'idle': return { label: 'FIRE HOSE', hint: 'Click to pick up' };
      case 'carrying': return { label: 'HOSE COUPLING', hint: 'Walk to hydrant and click to connect' };
      case 'attached': return { label: 'HYDRANT VALVE', hint: 'Turn valve to pressurize' };
      case 'charged': return { label: 'NOZZLE READY', hint: 'Hold CLICK to spray — aim at fire' };
      case 'spraying': return { label: 'SPRAYING', hint: `Fire: ${Math.round(this._fireHealth * 100)}%` };
      default: return null;
    }
  }

  dispose() {
    if (this.hoseMesh) {
      this.hoseMesh.geometry.dispose();
      this.scene.remove(this.hoseMesh);
    }
    if (this.jetParticles) {
      this.jetParticles.geometry.dispose();
      this.jetParticles.material.dispose();
      this.scene.remove(this.jetParticles);
    }
    if (this.nozzleMesh) {
      this.camera.remove(this.nozzleMesh);
    }
  }
}
