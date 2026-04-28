import * as THREE from 'three';

export class EquipmentSystem {
  constructor(camera) {
    this.camera = camera;
    this.equipped = new Set();
    this.viewmodels = new Map();
    this.group = new THREE.Group();
    camera.add(this.group);
    this.time = 0;
    this._bobOffset = 0;
  }

  addViewmodel(name, mesh, localPos, localRot, scale) {
    const clone = mesh.clone();
    if (typeof scale === 'number') clone.scale.setScalar(scale);
    clone.position.copy(localPos);
    if (localRot) {
      clone.rotation.set(localRot.x || 0, localRot.y || 0, localRot.z || 0);
    }
    clone.visible = false;
    clone.traverse(c => {
      if (c.isMesh) {
        c.castShadow = false;
        c.receiveShadow = false;
        c.renderOrder = 999;
      }
    });
    this.group.add(clone);
    this.viewmodels.set(name, clone);
  }

  createProceduralRadio() {
    const g = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.12, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 })
    );
    g.add(body);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.025, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x22aa44, emissive: 0x115522, emissiveIntensity: 0.8 })
    );
    screen.position.set(0, 0.02, 0.013);
    g.add(screen);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.002, 0.08, 4),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.8 })
    );
    antenna.position.set(-0.012, 0.1, 0);
    g.add(antenna);

    const btn = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.008, 0.008),
      new THREE.MeshStandardMaterial({ color: 0xff6b1a, emissive: 0xff4400, emissiveIntensity: 0.3 })
    );
    btn.position.set(0.015, 0, 0.013);
    g.add(btn);

    g.position.set(0.32, -0.28, -0.5);
    g.rotation.set(-0.2, -0.3, 0.1);
    g.visible = false;
    this.group.add(g);
    this.viewmodels.set('radio', g);
    return g;
  }

  createProceduralNozzle() {
    const g = new THREE.Group();

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.015, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 })
    );
    barrel.rotation.x = Math.PI / 2;
    g.add(barrel);

    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 })
    );
    grip.position.set(0, -0.06, 0.05);
    grip.rotation.x = 0.3;
    g.add(grip);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.022, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.4, metalness: 0.5 })
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.2;
    g.add(tip);

    g.position.set(0.25, -0.35, -0.65);
    g.rotation.set(0.1, -0.15, 0);
    g.visible = false;
    this.group.add(g);
    this.viewmodels.set('nozzle', g);
    return g;
  }

  equip(name) {
    this.equipped.add(name);
    const vm = this.viewmodels.get(name);
    if (vm) vm.visible = true;
  }

  unequip(name) {
    this.equipped.delete(name);
    const vm = this.viewmodels.get(name);
    if (vm) vm.visible = false;
  }

  hasItem(name) {
    return this.equipped.has(name);
  }

  update(delta, isMoving) {
    this.time += delta;
    const bob = isMoving ? Math.sin(this.time * 6) * 0.003 : 0;
    const sway = Math.sin(this.time * 1.5) * 0.001;
    this.group.position.y = bob;
    this.group.position.x = sway;
  }

  dispose() {
    this.viewmodels.forEach(vm => {
      vm.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    });
    this.camera.remove(this.group);
  }
}
