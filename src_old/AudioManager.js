import * as THREE from 'three';

export class AudioManager {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.sounds = new Map();
    this.started = false;
  }

  createSound(name, buffer, options = {}) {
    if (!buffer) return null;
    const sound = options.positional
      ? new THREE.PositionalAudio(this.listener)
      : new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setLoop(options.loop || false);
    sound.setVolume(options.volume || 0.5);
    if (options.positional) {
      sound.setRefDistance(options.refDist || 10);
      sound.setMaxDistance(options.maxDist || 50);
    }
    this.sounds.set(name, sound);
    return sound;
  }

  play(name) {
    const s = this.sounds.get(name);
    if (s && !s.isPlaying) {
      try { s.play(); } catch (e) { /* audio context not ready */ }
    }
  }

  stop(name) {
    const s = this.sounds.get(name);
    if (s && s.isPlaying) s.stop();
  }

  fadeIn(name, duration = 1) {
    const s = this.sounds.get(name);
    if (!s) return;
    const targetVol = s.getVolume();
    s.setVolume(0);
    if (!s.isPlaying) try { s.play(); } catch (e) { return; }
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / (duration * 1000));
      s.setVolume(targetVol * t);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  fadeOut(name, duration = 1) {
    const s = this.sounds.get(name);
    if (!s || !s.isPlaying) return;
    const startVol = s.getVolume();
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / (duration * 1000));
      s.setVolume(startVol * (1 - t));
      if (t < 1) requestAnimationFrame(tick);
      else s.stop();
    };
    tick();
  }

  duck(names = [], targetVol = 0.06, duration = 0.4) {
    names.forEach(name => {
      const s = this.sounds.get(name);
      if (!s || !s.isPlaying) return;
      if (!s._baseVolume) s._baseVolume = s.getVolume();
      const from = s.getVolume();
      const start = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / (duration * 1000));
        s.setVolume(from + (targetVol - from) * t);
        if (t < 1) requestAnimationFrame(tick);
      };
      tick();
    });
  }

  unduck(names = [], duration = 0.6) {
    names.forEach(name => {
      const s = this.sounds.get(name);
      if (!s) return;
      const base = s._baseVolume || s.getVolume();
      const from = s.getVolume();
      const start = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / (duration * 1000));
        s.setVolume(from + (base - from) * t);
        if (t < 1) requestAnimationFrame(tick);
      };
      tick();
    });
  }

  resumeContext() {
    if (this.listener.context.state === 'suspended') {
      this.listener.context.resume();
    }
  }

  dispose() {
    this.sounds.forEach(s => { if (s.isPlaying) s.stop(); s.disconnect(); });
    this.sounds.clear();
  }
}
