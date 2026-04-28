import * as THREE from 'three';

export default class CollisionSystem {
  constructor() {
    this.boxes = [];
    this.cylinders = [];
  }

  addBox(center, halfExtents) {
    this.boxes.push({
      min: new THREE.Vector3(center.x - halfExtents.x, 0, center.z - halfExtents.z),
      max: new THREE.Vector3(center.x + halfExtents.x, 10, center.z + halfExtents.z),
    });
  }

  addCylinder(center, radius) {
    this.cylinders.push({ x: center.x, z: center.z, r: radius });
  }

  resolve(pos) {
    const PLAYER_R = 0.4;

    for (const box of this.boxes) {
      const cx = Math.max(box.min.x, Math.min(pos.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(pos.z, box.max.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < PLAYER_R) {
        if (dist < 0.001) {
          pos.x += PLAYER_R;
        } else {
          const push = (PLAYER_R - dist) / dist;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    }

    for (const cyl of this.cylinders) {
      const dx = pos.x - cyl.x;
      const dz = pos.z - cyl.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = PLAYER_R + cyl.r;
      if (dist < minDist && dist > 0.001) {
        const push = (minDist - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }

  clear() {
    this.boxes = [];
    this.cylinders = [];
  }
}
