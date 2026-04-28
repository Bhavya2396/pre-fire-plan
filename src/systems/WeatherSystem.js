import * as THREE from 'three';

export default class WeatherSystem {
  constructor(scene, eventBus) {
    this._scene = scene;
    this._eventBus = eventBus;
    this._time = 0;
    this._rainActive = false;
    this._rainMesh = null;
    this._dayNightCycle = false;

    this._sunLight = null;
    this._hemiLight = null;

    this._eventBus.on('weather:rain', (active) => this._setRain(active));
    this._eventBus.on('weather:day-night', (active) => { this._dayNightCycle = active; });
  }

  setSunLight(light) { this._sunLight = light; }
  setHemiLight(light) { this._hemiLight = light; }

  _setRain(active) {
    this._rainActive = active;
    if (active && !this._rainMesh) this._buildRain();
    if (this._rainMesh) this._rainMesh.visible = active;
  }

  _buildRain() {
    const count = 4000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      velocities[i] = 15 + Math.random() * 10;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));

    const mat = new THREE.PointsMaterial({
      color: 0x99bbdd,
      size: 0.15,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    this._rainMesh = new THREE.Points(geo, mat);
    this._rainMesh.frustumCulled = false;
    this._rainMesh.visible = false;
    this._scene.add(this._rainMesh);
  }

  update(delta) {
    this._time += delta;

    if (this._rainActive && this._rainMesh) {
      const pos = this._rainMesh.geometry.attributes.position;
      const vel = this._rainMesh.geometry.attributes.velocity;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 1] -= vel.array[i] * delta;
        if (pos.array[i * 3 + 1] < 0) {
          pos.array[i * 3 + 1] = 60 + Math.random() * 20;
        }
      }
      pos.needsUpdate = true;
    }
  }

  dispose() {
    if (this._rainMesh) {
      this._rainMesh.geometry.dispose();
      this._rainMesh.material.dispose();
      this._scene.remove(this._rainMesh);
    }
  }
}
