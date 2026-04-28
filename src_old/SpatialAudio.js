import * as THREE from 'three';

export class SpatialAudio {
  constructor(scene, camera, listener) {
    this.scene = scene;
    this.camera = camera;
    this.listener = listener;
    this.sources = new Map();
    this.ambientLayers = [];
    this._time = 0;
    this._ctx = listener.context;
    this._started = false;
    this._pendingSetups = [];
  }

  /**
   * Defers all sound creation until start() is called.
   * This prevents the sharp oscillator pop on page load.
   */
  start() {
    if (this._started) return;
    this._started = true;
    this._pendingSetups.forEach(fn => fn());
    this._pendingSetups = [];

    // Fade in all ambient layers from 0
    this.ambientLayers.forEach(l => {
      const target = l._targetVolume || 0.04;
      l.gain.gain.setValueAtTime(0, this._ctx.currentTime);
      l.gain.gain.linearRampToValueAtTime(target, this._ctx.currentTime + 3.0);
    });

    // Fade in all proximity sources from 0
    this.sources.forEach(src => {
      if (src.gain) {
        const target = src._targetVolume || 0.05;
        src.gain.gain.setValueAtTime(0, this._ctx.currentTime);
        src.gain.gain.linearRampToValueAtTime(target, this._ctx.currentTime + 3.0);
      }
    });
  }

  addProximitySound(id, position, options = {}) {
    const setup = () => {
      const {
        frequency = 120,
        type = 'sawtooth',
        volume = 0.08,
        refDist = 5,
        maxDist = 40,
        rolloff = 2,
      } = options;

      const sound = new THREE.PositionalAudio(this.listener);

      const osc = this._ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;

      const gain = this._ctx.createGain();
      gain.gain.value = 0;

      const filter = this._ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 350;
      filter.Q.value = 0.8;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(sound.gain);
      sound.setNodeSource(osc);
      sound.setRefDistance(refDist);
      sound.setMaxDistance(maxDist);
      sound.setRolloffFactor(rolloff);

      const holder = new THREE.Object3D();
      holder.position.copy(position);
      holder.add(sound);
      this.scene.add(holder);

      osc.start();

      this.sources.set(id, { sound, holder, osc, gain, _targetVolume: volume, type: 'proximity' });
    };

    if (this._started) setup();
    else this._pendingSetups.push(setup);
  }

  addAmbientNoise(id, options = {}) {
    const setup = () => {
      const {
        volume = 0.04,
        filterFreq = 250,
        filterType = 'lowpass',
      } = options;

      const bufferSize = this._ctx.sampleRate * 2;
      const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.3;
      }

      const src = this._ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const gain = this._ctx.createGain();
      gain.gain.value = 0;

      const filter = this._ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this._ctx.destination);
      src.start();

      this.ambientLayers.push({ id, src, gain, filter, _targetVolume: volume });
    };

    if (this._started) setup();
    else this._pendingSetups.push(setup);
  }

  createWindAmbience() {
    this.addAmbientNoise('wind', {
      volume: 0.03,
      filterFreq: 180,
      filterType: 'lowpass',
    });
  }

  createMachineryHum() {
    this.addAmbientNoise('machinery', {
      volume: 0.02,
      filterFreq: 150,
      filterType: 'lowpass',
    });
  }

  addMachineSound(id, position, frequency = 120) {
    this.addProximitySound(id, position, {
      frequency,
      type: 'sawtooth',
      volume: 0.05,
      refDist: 4,
      maxDist: 30,
    });
  }

  addValveHiss(id, position) {
    this.addProximitySound(id, position, {
      frequency: 1800,
      type: 'sawtooth',
      volume: 0.02,
      refDist: 3,
      maxDist: 20,
    });
  }

  setAmbientVolume(id, volume, fadeDuration = 0.5) {
    const layer = this.ambientLayers.find(l => l.id === id);
    if (layer) {
      layer.gain.gain.linearRampToValueAtTime(volume, this._ctx.currentTime + fadeDuration);
    }
  }

  update(delta, playerPos) {
    this._time += delta;
  }

  dispose() {
    this.sources.forEach((src) => {
      if (src.osc) { try { src.osc.stop(); } catch (e) {} }
      if (src.holder) this.scene.remove(src.holder);
    });
    this.ambientLayers.forEach(l => {
      try { l.src.stop(); } catch (e) {}
    });
    this.sources.clear();
    this.ambientLayers = [];
  }
}
