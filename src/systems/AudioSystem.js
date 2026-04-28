import * as THREE from 'three';

const FADE_RAMP_DURATION = 3;

export default class AudioSystem {
  constructor(scene, camera, eventBus) {
    this._scene = scene;
    this._camera = camera;
    this._eventBus = eventBus;

    this.listener = new THREE.AudioListener();
    this._camera.add(this.listener);

    this._sounds = new Map();
    this._spatial = [];
    this._ambientLayers = [];
    this._pendingSetups = [];
    this._started = false;

    this._onPlay = (name) => this.play(name);
    this._onFadeIn = ({ name, duration }) => this.fadeIn(name, duration);
    this._onFadeOut = ({ name, duration }) => this.fadeOut(name, duration);
    this._onFireStarted = this._onFireStarted.bind(this);
    this._onFireStopped = this._onFireStopped.bind(this);
    this._onScenarioComplete = this._onScenarioComplete.bind(this);

    // Ducking — when narration is playing, drop all loops by ~8 dB (×0.4)
    // so the speaker is always intelligible.
    this._duckFactor = 1;

    this._eventBus.on('audio:play', this._onPlay);
    this._eventBus.on('audio:fade-in', this._onFadeIn);
    this._eventBus.on('audio:fade-out', this._onFadeOut);
    this._eventBus.on('fire:started', this._onFireStarted);
    this._eventBus.on('fire:stopped', this._onFireStopped);
    this._eventBus.on('scenario:complete', this._onScenarioComplete);
    this._eventBus.on('narration:start', () => this._setDuck(0.4, 0.25));
    this._eventBus.on('narration:end',   () => this._setDuck(1.0, 0.6));
    this._eventBus.on('scenario:phase-change', (data) => {
      // Evacuation alarm fades in once we leave PATROL (i.e. fire is on).
      if (data.phase && data.phase !== 'PATROL' && data.phase !== 'COMPLETE') {
        this.fadeIn('evacuation_alarm', 2.5);
      }
      if (data.phase === 'COMPLETE') this.fadeOut('evacuation_alarm', 3);
    });
  }

  /* Smoothly retarget the master loop multiplier (ducking).
     Affects fire_burning + alarms + ambient layers. */
  _setDuck(factor, duration = 0.4) {
    this._duckFactor = factor;
    const ctx = this.listener.context;
    const apply = (gainParam, base) => {
      gainParam.cancelScheduledValues(ctx.currentTime);
      gainParam.setValueAtTime(gainParam.value, ctx.currentTime);
      gainParam.linearRampToValueAtTime(base * factor, ctx.currentTime + duration);
    };
    for (const name of ['fire_alarm', 'evacuation_alarm', 'fire_burning']) {
      const s = this._sounds.get(name);
      if (s && s.isPlaying) apply(s.gain.gain, s.userData?.targetVolume ?? 0.3);
    }
    for (const entry of this._ambientLayers) {
      apply(entry.sound.gain.gain, entry.targetGain);
    }
  }

  /* Distance-attenuated fire roar. Called every frame from Game.update.
     Loud near fire (within 4 m) → near-silent past 30 m. */
  setFireDistance(distance) {
    const s = this._sounds.get('fire_burning');
    if (!s || !s.isPlaying) return;
    const NEAR = 4, FAR = 30;
    const t = Math.max(0, Math.min(1, (distance - NEAR) / (FAR - NEAR)));
    const base = (s.userData?.targetVolume ?? 0.3) * (1 - t * 0.85);
    s.gain.gain.setTargetAtTime(base * this._duckFactor, this.listener.context.currentTime, 0.15);
  }

  init(assetManager) {
    this._assetManager = assetManager;
    const names = [
      'fire_alarm', 'evacuation_alarm', 'fire_burning',
      'radio_static', 'valve_turn', 'truck_siren',
      'valve_steam', 'valve_grind',
    ];
    for (const name of names) {
      const buffer = assetManager.getBuffer(name);
      if (buffer) {
        const loop = name === 'fire_burning' || name === 'fire_alarm' || name === 'evacuation_alarm';
        const vol = loop ? 0.3 : 0.5;
        this.createSound(name, buffer, { loop, volume: vol });
      }
    }
  }

  play(name) {
    const sound = this._sounds.get(name);
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.play();
  }

  fadeIn(name, duration = 1) {
    const sound = this._sounds.get(name);
    if (!sound) return;
    const ctx = this.listener.context;
    const gain = sound.gain.gain;
    const target = sound.userData?.targetVolume ?? 1;
    if (!sound.isPlaying) {
      gain.setValueAtTime(0, ctx.currentTime);
      sound.play();
    }
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(gain.value, ctx.currentTime);
    gain.linearRampToValueAtTime(target, ctx.currentTime + duration);
  }

  fadeOut(name, duration = 1) {
    const sound = this._sounds.get(name);
    if (!sound || !sound.isPlaying) return;
    const ctx = this.listener.context;
    const gain = sound.gain.gain;
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(gain.value, ctx.currentTime);
    gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    setTimeout(() => {
      if (sound.isPlaying) sound.stop();
    }, duration * 1000 + 50);
  }

  resumeContext() {
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') ctx.resume();
  }

  createSound(name, buffer, opts = {}) {
    if (!buffer) return null;
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setLoop(opts.loop ?? false);
    sound.setVolume(opts.volume ?? 1);
    sound.userData = { targetVolume: opts.volume ?? 1 };
    this._sounds.set(name, sound);
    return sound;
  }

  addProximitySound(position, type) {
    const positional = new THREE.PositionalAudio(this.listener);
    positional.setRefDistance(5);
    positional.setRolloffFactor(1.5);
    positional.setDistanceModel('exponential');
    positional.setMaxDistance(60);

    const holder = new THREE.Object3D();
    holder.position.copy(position);
    holder.add(positional);
    this._scene.add(holder);

    const entry = { positional, holder, type, targetGain: 0.3 };
    this._spatial.push(entry);

    this._pendingSetups.push(() => {
      this._initProximityOscillator(positional, type, entry.targetGain);
    });

    return entry;
  }

  addAmbientLayer(type, volume = 0.15) {
    const sound = new THREE.Audio(this.listener);
    const entry = { sound, type, targetGain: volume };
    this._ambientLayers.push(entry);

    this._pendingSetups.push(() => {
      this._initAmbientOscillator(sound, type, volume);
    });

    return entry;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this.resumeContext();

    for (const setup of this._pendingSetups) {
      setup();
    }
    this._pendingSetups = [];

    const ctx = this.listener.context;
    for (const entry of this._spatial) {
      const gain = entry.positional.gain.gain;
      gain.setValueAtTime(0, ctx.currentTime);
      gain.linearRampToValueAtTime(entry.targetGain, ctx.currentTime + FADE_RAMP_DURATION);
    }
    for (const entry of this._ambientLayers) {
      const gain = entry.sound.gain.gain;
      gain.setValueAtTime(0, ctx.currentTime);
      gain.linearRampToValueAtTime(entry.targetGain, ctx.currentTime + FADE_RAMP_DURATION);
    }
  }

  update(playerPos) {
    if (!this._started || !playerPos) return;
    // PositionalAudio handled by Three.js AudioListener automatically;
    // manual distance-based gain adjustments can be added here if needed.
  }

  dispose() {
    this._eventBus.off('audio:play', this._onPlay);
    this._eventBus.off('audio:fade-in', this._onFadeIn);
    this._eventBus.off('audio:fade-out', this._onFadeOut);
    this._eventBus.off('fire:started', this._onFireStarted);
    this._eventBus.off('fire:stopped', this._onFireStopped);
    this._eventBus.off('scenario:complete', this._onScenarioComplete);

    for (const [, sound] of this._sounds) {
      if (sound.isPlaying) sound.stop();
      sound.disconnect();
    }
    this._sounds.clear();

    for (const entry of this._spatial) {
      if (entry.positional.isPlaying) entry.positional.stop();
      entry.positional.disconnect();
      this._scene.remove(entry.holder);
    }
    this._spatial = [];

    for (const entry of this._ambientLayers) {
      if (entry.sound.isPlaying) entry.sound.stop();
      entry.sound.disconnect();
    }
    this._ambientLayers = [];

    this._camera.remove(this.listener);
  }

  _initProximityOscillator(positional, type, volume) {
    const ctx = this.listener.context;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    switch (type) {
      case 'machinery':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(95, ctx.currentTime);
        break;
      case 'hiss':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(3200, ctx.currentTime);
        break;
      case 'hum':
      default:
        osc.type = 'sine';
        osc.frequency.setValueAtTime(60, ctx.currentTime);
        break;
    }

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    osc.connect(gainNode);
    gainNode.connect(positional.gain);
    positional.gain.connect(ctx.destination);
    osc.start();
    positional.userData = { osc, gainNode };
  }

  _initAmbientOscillator(sound, type, volume) {
    const ctx = this.listener.context;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    switch (type) {
      case 'wind':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        break;
      case 'industrial':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80, ctx.currentTime);
        break;
      default:
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, ctx.currentTime);
        break;
    }

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    osc.connect(gainNode);
    gainNode.connect(sound.gain);
    sound.gain.connect(ctx.destination);
    osc.start();
    sound.userData = { osc, gainNode };
  }

  _onFireStarted() {
    this.fadeIn('fire_alarm', 2);
    this.fadeIn('fire_burning', 3);
  }

  _onFireStopped() {
    this.fadeOut('fire_alarm', 2);
    this.fadeOut('fire_burning', 2);
  }

  _onScenarioComplete() {
    this.fadeOut('fire_alarm', 3);
    this.fadeOut('evacuation_alarm', 3);
    this.fadeOut('fire_burning', 3);
  }
}
