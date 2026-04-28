import * as THREE from 'three';

const KEY_MAP = {
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
};

export default class PlayerController {
  constructor(camera, eventBus) {
    this.camera = camera;
    this.eventBus = eventBus;

    this.eyeHeight = 1.7;
    this.crouchHeight = 1.0;
    this.moveSpeed = 7.0;
    this.sprintMul = 1.8;
    this.sensitivity = 0.002;

    this.position = new THREE.Vector3(0, 0, 30);
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.isLocked = false;
    this.enabled = false;
    this.currentHeight = this.eyeHeight;
    this.isMoving = false;
    this.boundaryRadius = 140;

    this.collisionSystem = null;

    this.grabMode = false;
    this.onGrabDelta = null;
    this._grabButton = false;

    this._yaw = 0;
    this._pitch = 0;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this._bobPhase = 0;
    this._footstepTimer = 0;
    this._audioCtx = null;

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      crouch: false,
    };

    this._bindEvents();
  }

  _bindEvents() {
    this.eventBus.on('input:keydown', (code) => {
      if (KEY_MAP[code]) this.keys[KEY_MAP[code]] = true;
    });

    this.eventBus.on('input:keyup', (code) => {
      if (KEY_MAP[code]) this.keys[KEY_MAP[code]] = false;
    });

    this.eventBus.on('input:pointerlock', (locked) => {
      this.isLocked = locked;
    });

    this.eventBus.on('input:mousemove', (data) => {
      this._handleMouseMove(data.movementX, data.movementY);
    });

    this.eventBus.on('input:mousedown', (data) => {
      if (data.raw === 0 && this.grabMode) {
        this._grabButton = true;
      }
    });

    this.eventBus.on('input:mouseup', (data) => {
      if (data.raw === 0) {
        this._grabButton = false;
      }
    });
  }

  _handleMouseMove(dx, dy) {
    if (!this.isLocked) return;

    if (this.grabMode && this._grabButton) {
      /* Accept both horizontal (dx) and vertical (dy) mouse movement for
         valve spinning. Horizontal drag maps naturally to CW/CCW when
         the wheel faces the player (billboard); vertical drag (pulling
         up/pushing down) gives the same result.  Use whichever axis
         has the larger magnitude so diagonal drags don't cancel out. */
      if (this.onGrabDelta) {
        const dominant = Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
        this.onGrabDelta(dominant);
      }
      return;
    }

    this._yaw -= dx * this.sensitivity;
    this._pitch -= dy * this.sensitivity;
    this._pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._pitch));

    this._euler.set(this._pitch, this._yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  update(delta) {
    if (!this.enabled) return;

    const speed = this.moveSpeed * (this.keys.sprint ? this.sprintMul : 1.0);

    const targetHeight = this.keys.crouch ? this.crouchHeight : this.eyeHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * Math.min(1, 10 * delta);

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    this.direction.set(0, 0, 0);
    // While in grabMode (valve drag, MCP smash), suppress WASD so the
    // player can't accidentally walk away from the interaction.
    if (!this.grabMode) {
      if (this.keys.forward) this.direction.add(forward);
      if (this.keys.backward) this.direction.sub(forward);
      if (this.keys.left) this.direction.sub(right);
      if (this.keys.right) this.direction.add(right);
    }

    if (this.direction.lengthSq() > 0) {
      this.direction.normalize();
    }

    const targetVelX = this.direction.x * speed;
    const targetVelZ = this.direction.z * speed;
    const smoothing = Math.min(1, 12 * delta);
    this.velocity.x += (targetVelX - this.velocity.x) * smoothing;
    this.velocity.z += (targetVelZ - this.velocity.z) * smoothing;

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;

    if (this.collisionSystem) {
      this.collisionSystem.resolve(this.position);
    }

    const distFromCenter = Math.sqrt(this.position.x * this.position.x + this.position.z * this.position.z);
    if (distFromCenter > this.boundaryRadius) {
      const scale = this.boundaryRadius / distFromCenter;
      this.position.x *= scale;
      this.position.z *= scale;
    }

    this.isMoving = Math.abs(this.velocity.x) > 0.5 || Math.abs(this.velocity.z) > 0.5;

    let bobOffset = 0;
    if (this.isMoving) {
      const bobFreq = this.keys.sprint ? 12 : 8;
      const bobAmp = this.keys.sprint ? 0.06 : 0.035;
      this._bobPhase += delta * bobFreq;
      bobOffset = Math.sin(this._bobPhase) * bobAmp;

      this._footstepTimer -= delta;
      if (this._footstepTimer <= 0) {
        this._footstepTimer = this.keys.sprint ? 0.28 : 0.42;
        this._playFootstep();
      }
    } else {
      this._bobPhase = 0;
      this._footstepTimer = 0;
    }

    this.camera.position.set(
      this.position.x,
      this.currentHeight + bobOffset,
      this.position.z
    );
  }

  getWorldDirection(target) {
    return this.camera.getWorldDirection(target);
  }

  _playFootstep() {
    try {
      if (!this._audioCtx) {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') return;

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
    } catch (_) {}
  }
}
