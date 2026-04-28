import * as THREE from 'three';
import { Tween, Easing, Group as TweenGroup } from '@tweenjs/tween.js';

export class SaveSystem {
  constructor(key = 'preFirePlan_save') {
    this.key = key;
  }

  save(state) {
    try {
      const data = {
        version: 2,
        timestamp: Date.now(),
        playerPos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z },
        currentStep: state.currentStep,
        completedSteps: state.completedSteps,
        phase: state.phase,
        elapsed: state.elapsed,
        score: state.score,
        warnings: state.warnings,
        inventory: state.inventory,
        fireStarted: state.fireStarted,
      };
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('Save failed:', e);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  clear() {
    localStorage.removeItem(this.key);
  }

  hasSave() {
    return !!localStorage.getItem(this.key);
  }
}

export class ScoringSystem {
  constructor() {
    this.startTime = 0;
    this.stepTimes = new Map();
    this.penalties = 0;
    this.bonuses = 0;
    this.stepStartTime = 0;
  }

  start() {
    this.startTime = performance.now();
    this.stepStartTime = this.startTime;
  }

  recordStep(stepId) {
    const now = performance.now();
    const elapsed = (now - this.stepStartTime) / 1000;
    this.stepTimes.set(stepId, {
      elapsed,
      timestamp: now,
    });
    this.stepStartTime = now;
  }

  addPenalty(amount = 1, reason = '') {
    this.penalties += amount;
  }

  addBonus(amount = 1, reason = '') {
    this.bonuses += amount;
  }

  getGrade() {
    const totalTime = (performance.now() - this.startTime) / 1000;
    const baseScore = 100;
    const timePenalty = Math.max(0, (totalTime - 180) * 0.1);
    const score = Math.max(0, baseScore - timePenalty - this.penalties * 5 + this.bonuses * 3);

    let grade = 'F';
    if (score >= 95) grade = 'S';
    else if (score >= 85) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else if (score >= 40) grade = 'D';

    return {
      score: Math.round(score),
      grade,
      totalTime: Math.round(totalTime),
      steps: this.stepTimes.size,
      penalties: this.penalties,
      bonuses: this.bonuses,
    };
  }

  getLeaderboard() {
    try {
      const raw = localStorage.getItem('preFirePlan_leaderboard');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  saveToLeaderboard(name = 'Player') {
    const result = this.getGrade();
    const board = this.getLeaderboard();
    board.push({ name, ...result, date: new Date().toISOString() });
    board.sort((a, b) => b.score - a.score);
    localStorage.setItem('preFirePlan_leaderboard', JSON.stringify(board.slice(0, 20)));
    return board;
  }
}

export class CutsceneCamera {
  constructor(camera) {
    this.camera = camera;
    this.tweenGroup = new TweenGroup();
    this.active = false;
    this._savedPos = new THREE.Vector3();
    this._savedQuat = new THREE.Quaternion();
  }

  play(waypoints, onComplete) {
    if (waypoints.length < 2) return;
    this.active = true;
    this._savedPos.copy(this.camera.position);
    this._savedQuat.copy(this.camera.quaternion);

    const chain = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];
      const duration = to.duration || 2000;

      const tween = new Tween(
        { x: from.pos.x, y: from.pos.y, z: from.pos.z, lx: from.lookAt.x, ly: from.lookAt.y, lz: from.lookAt.z },
        this.tweenGroup
      )
        .to({ x: to.pos.x, y: to.pos.y, z: to.pos.z, lx: to.lookAt.x, ly: to.lookAt.y, lz: to.lookAt.z }, duration)
        .easing(Easing.Sinusoidal.InOut)
        .onUpdate((obj) => {
          this.camera.position.set(obj.x, obj.y, obj.z);
          this.camera.lookAt(obj.lx, obj.ly, obj.lz);
        });

      chain.push(tween);
    }

    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].chain(chain[i + 1]);
    }

    chain[chain.length - 1].onComplete(() => {
      this.active = false;
      if (onComplete) onComplete();
    });

    chain[0].start();
  }

  restore() {
    this.active = false;
    this.camera.position.copy(this._savedPos);
    this.camera.quaternion.copy(this._savedQuat);
  }

  update() {
    if (this.active) {
      this.tweenGroup.update();
    }
  }
}

export class DayNightCycle {
  constructor(scene, sunLight) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.timeOfDay = 0.4;
    this.speed = 0;
    this.enabled = false;
  }

  setTime(t) {
    this.timeOfDay = Math.max(0, Math.min(1, t));
    this._apply();
  }

  _apply() {
    const t = this.timeOfDay;
    const elevation = Math.sin(t * Math.PI) * 80 + 10;
    const azimuth = t * 360 - 90;

    if (this.sunLight) {
      const rad = THREE.MathUtils.degToRad(azimuth);
      const elRad = THREE.MathUtils.degToRad(Math.max(5, elevation));
      this.sunLight.position.set(
        Math.cos(rad) * Math.cos(elRad) * 120,
        Math.sin(elRad) * 120,
        Math.sin(rad) * Math.cos(elRad) * 120
      );

      const dayIntensity = Math.max(0, Math.sin(t * Math.PI));
      this.sunLight.intensity = 0.5 + dayIntensity * 2.5;

      const warmth = t < 0.3 || t > 0.7 ? 0.3 : 0;
      this.sunLight.color.setHSL(0.08 + warmth * 0.02, 0.5 - warmth * 0.2, 0.5 + dayIntensity * 0.4);
    }
  }

  update(delta) {
    if (!this.enabled || this.speed === 0) return;
    this.timeOfDay = (this.timeOfDay + delta * this.speed) % 1;
    this._apply();
  }
}

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.rainParticles = null;
    this.isRaining = false;
    this._time = 0;
  }

  createRain(count = 3000) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = Math.random() * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 200;
      vel[i] = 15 + Math.random() * 10;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aVel;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - aVel * uTime, 60.0);
          vAlpha = 0.3 + 0.2 * sin(uTime + position.x);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 2.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(0.7, 0.75, 0.85, vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.rainParticles = new THREE.Points(geo, mat);
    this.rainParticles.visible = false;
    this.scene.add(this.rainParticles);
  }

  startRain() {
    if (this.rainParticles) {
      this.rainParticles.visible = true;
      this.isRaining = true;
    }
  }

  stopRain() {
    if (this.rainParticles) {
      this.rainParticles.visible = false;
      this.isRaining = false;
    }
  }

  update(delta) {
    this._time += delta;
    if (this.isRaining && this.rainParticles) {
      this.rainParticles.material.uniforms.uTime.value = this._time;
    }
  }
}
