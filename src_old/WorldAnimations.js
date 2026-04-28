import * as THREE from 'three';

/**
 * WorldAnimations — queued animations that play in the 3D world when steps complete.
 * Each animation manipulates scene objects over time (hose extending, monitor pivoting, etc.)
 */
export class WorldAnimations {
  constructor(scene) {
    this.scene = scene;
    this._active = [];
    this._hoseLines = [];
  }

  update(delta) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const a = this._active[i];
      a.elapsed += delta;
      const t = Math.min(1, a.elapsed / a.duration);
      a.tick(t, delta);
      if (t >= 1) {
        if (a.done) a.done();
        this._active.splice(i, 1);
      }
    }
  }

  _push(duration, tick, done) {
    this._active.push({ elapsed: 0, duration, tick, done: done || null });
  }

  /**
   * Animate a hose tube growing from `from` to `to` over `duration` seconds.
   * Creates a tube mesh that progressively extends.
   */
  animateHoseExtend(from, to, duration = 2.5, color = 0xcc2222) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    dir.normalize();

    const radius = 0.045;
    const segments = 32;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });

    let currentMesh = null;

    this._push(duration, (t) => {
      const currentLen = length * t;
      if (currentLen < 0.1) return;

      if (currentMesh) {
        currentMesh.geometry.dispose();
        this.scene.remove(currentMesh);
      }

      const end = new THREE.Vector3().copy(from).addScaledVector(dir, currentLen);
      const mid = new THREE.Vector3().lerpVectors(from, end, 0.5);
      mid.y = Math.max(0.05, mid.y - currentLen * 0.02);

      const points = [
        new THREE.Vector3(from.x, from.y, from.z),
        new THREE.Vector3(mid.x, 0.08, mid.z),
        new THREE.Vector3(end.x, end.y, end.z),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
      currentMesh = new THREE.Mesh(geo, mat);
      currentMesh.castShadow = true;
      this.scene.add(currentMesh);
    }, () => {
      if (currentMesh) this._hoseLines.push(currentMesh);
    });
  }

  /**
   * Animate a 3D object rotating to face a target over `duration` seconds.
   */
  animatePivotToFace(object, targetPos, duration = 1.5) {
    if (!object) return;
    const startY = object.rotation.y;
    const dx = targetPos.x - object.position.x;
    const dz = targetPos.z - object.position.z;
    const targetY = Math.atan2(dx, dz);

    let diff = targetY - startY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    this._push(duration, (t) => {
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      object.rotation.y = startY + diff * ease;
    });
  }

  /**
   * Pop an object into the scene with a scale bounce.
   */
  animatePopIn(object, duration = 0.8) {
    if (!object) return;
    const targetScale = object.scale.clone();
    object.scale.setScalar(0);
    object.visible = true;

    this._push(duration, (t) => {
      const bounce = t < 0.6
        ? (t / 0.6) * (t / 0.6) * 1.15
        : 1.0 + Math.sin((t - 0.6) / 0.4 * Math.PI) * 0.15 * (1 - t);
      object.scale.copy(targetScale).multiplyScalar(Math.min(1, bounce));
    });
  }

  /**
   * Slide an object from one position to another.
   */
  animateSlide(object, from, to, duration = 2) {
    if (!object) return;
    object.position.copy(from);
    object.visible = true;

    this._push(duration, (t) => {
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      object.position.lerpVectors(from, to, ease);
    });
  }

  /**
   * Flash an emissive pulse on a group of meshes.
   */
  animateEmissivePulse(object, color = 0xff6b1a, duration = 1.5) {
    if (!object) return;
    const meshes = [];
    object.traverse(c => {
      if (c.isMesh && c.material && c.material.emissive) {
        meshes.push({ mesh: c, origIntensity: c.material.emissiveIntensity || 0 });
      }
    });

    this._push(duration, (t) => {
      const pulse = Math.sin(t * Math.PI) * 2;
      for (const m of meshes) {
        m.mesh.material.emissiveIntensity = m.origIntensity + pulse;
      }
    }, () => {
      for (const m of meshes) {
        m.mesh.material.emissiveIntensity = m.origIntensity;
      }
    });
  }

  dispose() {
    for (const mesh of this._hoseLines) {
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      this.scene.remove(mesh);
    }
    this._hoseLines = [];
    this._active = [];
  }
}
