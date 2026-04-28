import * as THREE from 'three';

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _PI_2 = Math.PI / 2;

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.eyeHeight = 1.7;
    this.crouchHeight = 1.0;
    this.moveSpeed = 7.0;
    this.sprintMul = 1.8;
    this.sensitivity = 0.002;

    this.position = new THREE.Vector3(0, 0, 40);
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.keys = { forward: false, backward: false, left: false, right: false, sprint: false, crouch: false };
    this.isLocked = false;
    this.enabled = false;
    this.currentHeight = this.eyeHeight;
    this.isMoving = false;

    this.boundaryRadius = 140;
    this.collisionSystem = null;

    // Valve grab mode — HOLD left mouse + drag to rotate valve
    this.grabMode      = false;
    this.onGrabDelta   = null;   // callback(dx)
    this._grabDown     = false;  // is left mouse button held?
    this._grabPrevX    = null;   // clientX of previous mousemove event

    // Footstep system
    this._stepTimer = 0;
    this._stepInterval = 0.45; // seconds between steps when walking
    this._audioCtx = null;

    this._bindEvents();
  }

  _bindEvents() {
    this.domElement.addEventListener('click', () => {
      if (!this.isLocked && this.enabled) this.domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });

    // Track mouse button state for grab mode
    document.addEventListener('mousedown', (e) => {
      if (this.grabMode && e.button === 0) {
        this._grabDown  = true;
        this._grabPrevX = e.clientX;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._grabDown  = false;
        this._grabPrevX = null;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.grabMode) {
        // Only drive valve when left button is held
        if (this._grabDown && this._grabPrevX !== null) {
          const dx = e.clientX - this._grabPrevX;
          if (dx !== 0 && this.onGrabDelta) this.onGrabDelta(dx);
        }
        if (this._grabDown) this._grabPrevX = e.clientX;
        return; // never rotate camera while grabbing
      }
      if (!this.isLocked) return;
      _euler.setFromQuaternion(this.camera.quaternion);
      _euler.y -= e.movementX * this.sensitivity;
      _euler.x -= e.movementY * this.sensitivity;
      _euler.x = Math.max(-_PI_2, Math.min(_PI_2, _euler.x));
      this.camera.quaternion.setFromEuler(_euler);
    });

    document.addEventListener('keydown', (e) => this._key(e.code, true));
    document.addEventListener('keyup', (e) => this._key(e.code, false));
  }

  _key(code, down) {
    switch (code) {
      case 'KeyW': this.keys.forward = down; break;
      case 'KeyS': this.keys.backward = down; break;
      case 'KeyA': this.keys.left = down; break;
      case 'KeyD': this.keys.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = down; break;
      case 'KeyC': this.keys.crouch = down; break;
    }
  }

  enable() { this.enabled = true; }
  disable() {
    this.enabled = false;
    Object.keys(this.keys).forEach(k => this.keys[k] = false);
  }

  update(delta) {
    if (!this.isLocked || !this.enabled) return;

    const targetHeight = this.keys.crouch ? this.crouchHeight : this.eyeHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * 10 * delta;

    const speed = this.moveSpeed * (this.keys.sprint ? this.sprintMul : 1);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    this.direction.set(0, 0, 0);
    if (this.keys.forward) this.direction.add(fwd);
    if (this.keys.backward) this.direction.sub(fwd);
    if (this.keys.right) this.direction.add(right);
    if (this.keys.left) this.direction.sub(right);
    if (this.direction.lengthSq() > 0) this.direction.normalize();

    this.velocity.x += (this.direction.x * speed - this.velocity.x) * 8 * delta;
    this.velocity.z += (this.direction.z * speed - this.velocity.z) * 8 * delta;
    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;

    if (this.collisionSystem) {
      this.collisionSystem.resolve(this.position);
    }

    const dist = Math.sqrt(this.position.x * this.position.x + this.position.z * this.position.z);
    if (dist > this.boundaryRadius) {
      const scale = this.boundaryRadius / dist;
      this.position.x *= scale;
      this.position.z *= scale;
    }

    this.isMoving = this.direction.lengthSq() > 0;
    this.camera.position.set(this.position.x, this.currentHeight, this.position.z);

    if (this.direction.lengthSq() > 0) {
      this.camera.position.y += Math.sin(performance.now() * 0.008) * 0.035;

      this._stepTimer += delta;
      const interval = 0.32;
      if (this._stepTimer >= interval) {
        this._stepTimer = 0;
        this._playFootstep();
      }
    } else {
      this._stepTimer = 0;
    }
  }

  _playFootstep() {
    try {
      if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') return;

      // Concrete footstep: short burst of filtered noise
      const dur = 0.06 + Math.random() * 0.03;
      const bufferSize = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const env = 1 - i / bufferSize;
        data[i] = (Math.random() * 2 - 1) * env * env;
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800 + Math.random() * 400;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0.08 + Math.random() * 0.04;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
    } catch (_) { /* audio not available */ }
  }

  getWorldDirection(target) {
    return this.camera.getWorldDirection(target);
  }
}
