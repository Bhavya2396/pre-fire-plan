import * as THREE from 'three';

/**
 * Level of Detail system — automatically swaps high-poly meshes
 * to simpler representations beyond a threshold distance.
 */
export class LODSystem {
  constructor(camera) {
    this.camera = camera;
    this.entries = [];
    this._camPos = new THREE.Vector3();
  }

  /**
   * Register a mesh with LOD levels.
   * levels: [{ distance: number, object: THREE.Object3D }]
   * Sorted ascending by distance. First level is the closest (high detail).
   */
  register(levels, parent) {
    const lod = new THREE.LOD();
    levels.forEach(({ distance, object }) => {
      lod.addLevel(object, distance);
    });
    if (parent) {
      parent.add(lod);
    }
    this.entries.push(lod);
    return lod;
  }

  /**
   * Create a simple LOD pair: full model at close range, a colored box at far range.
   */
  createSimpleLOD(scene, model, position, nearDist = 0, farDist = 50, color = 0x888888) {
    if (!model) return null;

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);

    const lowPoly = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    );
    lowPoly.castShadow = true;

    const lod = new THREE.LOD();
    lod.addLevel(model, nearDist);
    lod.addLevel(lowPoly, farDist);
    lod.position.copy(position);

    scene.add(lod);
    this.entries.push(lod);
    return lod;
  }

  update() {
    this.camera.getWorldPosition(this._camPos);
    this.entries.forEach(lod => {
      if (lod.isLOD) lod.update(this.camera);
    });
  }

  dispose() {
    this.entries.forEach(lod => {
      lod.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => m.dispose());
        }
      });
      if (lod.parent) lod.parent.remove(lod);
    });
    this.entries = [];
  }
}
