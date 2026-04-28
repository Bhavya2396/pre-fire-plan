import * as THREE from 'three';

export default class EffectsSystem {
  constructor(scene, eventBus) {
    this._scene = scene;
    this._eventBus = eventBus;
    this._beacons = [];
    this._time = 0;

    this._eventBus.on('effects:beacon', (pos) => this._addBeacon(pos));
    this._eventBus.on('alarm:on', () => this._startAlarmBeacons());
    this._eventBus.on('alarm:off', () => this._stopAlarmBeacons());
  }

  _addBeacon(pos) {
    const light = new THREE.PointLight(0xff2200, 0, 18, 2);
    light.position.set(pos.x || pos[0], 4, pos.z || pos[2]);
    this._scene.add(light);
    this._beacons.push({ light, active: false });
    return this._beacons.length - 1;
  }

  _startAlarmBeacons() {
    this._beacons.forEach((b) => { b.active = true; });
  }

  _stopAlarmBeacons() {
    this._beacons.forEach((b) => {
      b.active = false;
      b.light.intensity = 0;
    });
  }

  update(delta) {
    this._time += delta;
    for (let i = 0; i < this._beacons.length; i++) {
      const b = this._beacons[i];
      if (!b.active) continue;
      const phase = this._time * 4 + i * Math.PI;
      b.light.intensity = Math.sin(phase) > 0 ? 0.8 : 0;
    }
  }

  dispose() {
    this._beacons.forEach((b) => {
      this._scene.remove(b.light);
    });
    this._beacons = [];
  }
}
