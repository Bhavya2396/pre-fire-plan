import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class AssetLoader {
  constructor() {
    this.gltf = new GLTFLoader();
    this.tex = new THREE.TextureLoader();
    this.audio = new THREE.AudioLoader();
    this.models = new Map();
    this.textures = new Map();
    this.audioBuffers = new Map();
  }

  async loadModel(name, path) {
    return new Promise((resolve, reject) => {
      this.gltf.load(path, (gltf) => {
        this.models.set(name, gltf);
        resolve(gltf);
      }, undefined, (err) => {
        console.warn(`Model ${name} failed:`, err);
        resolve(null);
      });
    });
  }

  loadTexture(path, repeat, srgb = true) {
    const key = path + (repeat ? repeat.join(',') : '');
    if (this.textures.has(key)) return this.textures.get(key);
    const t = this.tex.load(path);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    this.textures.set(key, t);
    return t;
  }

  async loadAudioBuffer(name, path, listener) {
    return new Promise((resolve) => {
      this.audio.load(path, (buffer) => {
        this.audioBuffers.set(name, buffer);
        resolve(buffer);
      }, undefined, () => {
        console.warn(`Audio ${name} failed`);
        resolve(null);
      });
    });
  }

  async loadAll(onProgress) {
    const modelList = [
      // Original models
      ['tank_main', '/models/tank_main.glb'],
      ['tank_secondary', '/models/tank_secondary.glb'],
      ['pipe_kit', '/models/pipe_kit.glb'],
      ['control_station', '/models/control_station.glb'],
      ['fire_hydrant', '/models/fire_hydrant/scene.gltf'],
      ['industrial_valve', '/models/industrial_valve/scene.gltf'],
      ['walkie_talkie', '/models/walkie_talkie/scene.gltf'],
      ['hydrant_key', '/models/hydrant_key/scene.gltf'],
      ['fire_nozzle', '/models/fire_nozzle.glb'],
      ['fire_truck', '/models/fire_truck.glb'],
      ['water_hose', '/models/water_hose.glb'],
      ['water_monitor', '/models/water_monitor.glb'],
      ['control_desk', '/models/control_desk.glb'],
      ['fire_extinguisher', '/models/fire_extinguisher.glb'],
      ['padlock', '/models/padlock.glb'],
      ['chemical_tank', '/models/chemical_tank.glb'],
      // Numaligarh structural assets
      ['distillation_column', '/models/distillation_column.glb'],
      ['cooling_tower', '/models/cooling_tower.glb'],
      ['warehouse', '/models/warehouse.glb'],
      ['pipe_rack', '/models/pipe_rack.glb'],
      ['pipeline', '/models/pipeline.glb'],
      ['light_tower', '/models/light_tower.glb'],
      ['catwalk', '/models/catwalk.glb'],
      ['heat_exchanger', '/models/heat_exchanger.glb'],
      ['gate_valve', '/models/gate_valve.glb'],
      ['butterfly_valve', '/models/butterfly_valve.glb'],
      ['oil_tank', '/models/oil_tank.glb'],
    ];

    const audioList = [
      ['fire_alarm', '/audio/fire_alarm.wav'],
      ['evacuation_alarm', '/audio/evacuation_alarm.wav'],
      ['fire_burning', '/audio/fire_burning.wav'],
      ['radio_static', '/audio/radio_static.wav'],
      ['valve_turn', '/audio/valve_turn.wav'],
      ['truck_siren', '/audio/truck_siren.wav'],
      ['valve_steam', '/audio/valve_steam.wav'],
      ['valve_grind', '/audio/valve_grind.wav'],
    ];

    const total = modelList.length + audioList.length;
    let loaded = 0;

    for (const [name, path] of modelList) {
      await this.loadModel(name, path);
      loaded++;
      if (onProgress) onProgress(loaded / total, `Loading ${name}...`);
    }

    for (const [name, path] of audioList) {
      await this.loadAudioBuffer(name, path);
      loaded++;
      if (onProgress) onProgress(loaded / total, `Loading audio...`);
    }
  }

  getModel(name) {
    const g = this.models.get(name);
    return g ? g.scene.clone() : null;
  }

  getBuffer(name) {
    return this.audioBuffers.get(name) || null;
  }

  dispose() {
    this.models.forEach((gltf) => {
      gltf.scene.traverse((c) => {
        if (c.isMesh) {
          c.geometry.dispose();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { Object.values(m).forEach(v => { if (v?.isTexture) v.dispose(); }); m.dispose(); });
        }
      });
    });
    this.textures.forEach(t => t.dispose());
    this.models.clear();
    this.textures.clear();
    this.audioBuffers.clear();
  }
}
