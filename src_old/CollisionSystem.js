import * as THREE from 'three';

export class CollisionSystem {
  constructor() {
    this.boxes = [];
    this.cylinders = [];
    this.playerRadius = 0.4;
  }

  addBox(center, halfExtents, label = '') {
    this.boxes.push({
      min: new THREE.Vector3(center.x - halfExtents.x, 0, center.z - halfExtents.z),
      max: new THREE.Vector3(center.x + halfExtents.x, center.y + halfExtents.y, center.z + halfExtents.z),
      label,
    });
  }

  addCylinder(center, radius, label = '') {
    this.cylinders.push({ x: center.x, z: center.z, r: radius, label });
  }

  registerDykeWalls(cx, cz, w, d, wallH, thickness) {
    const ht = thickness / 2;
    this.addBox({ x: cx, y: wallH, z: cz - d / 2 }, { x: w / 2, y: wallH, z: ht }, 'dyke-north');
    this.addBox({ x: cx, y: wallH, z: cz + d / 2 }, { x: w / 2, y: wallH, z: ht }, 'dyke-south');
    this.addBox({ x: cx - w / 2, y: wallH, z: cz }, { x: ht, y: wallH, z: d / 2 }, 'dyke-west');
    this.addBox({ x: cx + w / 2, y: wallH, z: cz }, { x: ht, y: wallH, z: d / 2 }, 'dyke-east');
  }

  resolve(pos, prevPos) {
    const r = this.playerRadius;
    let px = pos.x, pz = pos.z;

    for (const b of this.boxes) {
      const nearX = Math.max(b.min.x - r, Math.min(px, b.max.x + r));
      const nearZ = Math.max(b.min.z - r, Math.min(pz, b.max.z + r));

      if (px >= b.min.x - r && px <= b.max.x + r && pz >= b.min.z - r && pz <= b.max.z + r) {
        const overlapLeft = (b.min.x - r) - px;
        const overlapRight = px - (b.max.x + r);
        const overlapFront = (b.min.z - r) - pz;
        const overlapBack = pz - (b.max.z + r);

        const penX = overlapLeft > overlapRight ? -overlapLeft : -overlapRight;
        const penZ = overlapFront > overlapBack ? -overlapFront : -overlapBack;

        const absX = Math.abs(penX < 0 ? overlapLeft : overlapRight);
        const absZ = Math.abs(penZ < 0 ? overlapFront : overlapBack);

        if (absX < absZ) {
          px = penX < 0 ? b.min.x - r - 0.01 : b.max.x + r + 0.01;
        } else {
          pz = penZ < 0 ? b.min.z - r - 0.01 : b.max.z + r + 0.01;
        }
      }
    }

    for (const c of this.cylinders) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = c.r + r;
      if (dist < minDist && dist > 0.001) {
        const push = (minDist - dist) + 0.01;
        px += (dx / dist) * push;
        pz += (dz / dist) * push;
      }
    }

    pos.x = px;
    pos.z = pz;
  }
}
