import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _fwd = new THREE.Vector3();

export const InteractionType = {
  VALVE: 'valve',
  SIMPLE: 'simple',
  OBSERVE: 'observe',
  PICKUP: 'pickup',
};

export class InteractionSystem {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.interactables = [];
    this.current = null;
    this.enabled = false;
    this.maxDist = 8;

    this.holdState = { active: false, progress: 0, target: null, duration: 2, elapsed: 0 };
    this.observeState = { active: false, data: null, meshes: [], elapsed: 0, required: 3 };

    this.onInteract = null;
    this.onValveComplete = null;
    this.onObserveComplete = null;

    _ray.far = this.maxDist;

    this._mouseDown = false;

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this._mouseDown = true;
        this._handleMouseDown();
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._mouseDown = false;
        this._handleMouseUp();
      }
    });
  }

  register(meshOrGroup, data) {
    const targets = [];
    if (meshOrGroup.isMesh) {
      targets.push(meshOrGroup);
    } else {
      meshOrGroup.traverse(c => { if (c.isMesh) targets.push(c); });
    }
    targets.forEach(m => {
      m.userData.interactable = true;
      m.userData.interactionData = data;
    });
    this.interactables.push({ root: meshOrGroup, data, meshes: targets });
  }

  enable() { this.enabled = true; }

  update(delta) {
    if (!this.enabled) return null;

    if (this.holdState.active) {
      if (this._mouseDown) {
        this.holdState.elapsed += delta;
        this.holdState.progress = Math.min(1, this.holdState.elapsed / this.holdState.duration);

        if (this.holdState.progress >= 1) {
          this.holdState.active = false;
          if (this.onValveComplete) this.onValveComplete(this.holdState.target);
        }
      }
      return this.holdState.target;
    }

    if (this.observeState.active) {
      this.camera.getWorldDirection(_fwd);
      _ray.set(this.camera.position, _fwd);
      const hits = _ray.intersectObjects(this.observeState.meshes, false);
      if (hits.length > 0) {
        this.observeState.elapsed += delta;
        if (this.observeState.elapsed >= this.observeState.required) {
          this.observeState.active = false;
          if (this.onObserveComplete) this.onObserveComplete(this.observeState.data);
        }
        return { ...this.observeState.data, observeProgress: this.observeState.elapsed / this.observeState.required };
      } else {
        this.observeState.elapsed = Math.max(0, this.observeState.elapsed - delta * 2);
        return { ...this.observeState.data, observeProgress: this.observeState.elapsed / this.observeState.required };
      }
    }

    this.camera.getWorldDirection(_fwd);
    _ray.set(this.camera.position, _fwd);

    const allMeshes = [];
    this.interactables.forEach(i => {
      if (!i.data.completed) allMeshes.push(...i.meshes);
    });

    const hits = _ray.intersectObjects(allMeshes, false);
    if (hits.length > 0) {
      const data = hits[0].object.userData.interactionData;
      if (data && !data.completed) {
        this.current = this.interactables.find(i => i.data === data) || null;
        return data;
      }
    }

    this.current = null;
    return null;
  }

  _handleMouseDown() {
    if (!this.enabled || !this.current) return;

    // If pointer lock is not active but no UI panel is blocking, allow SIMPLE/PICKUP
    // to fire (they will open the ActionPanel which exits lock anyway).
    // For VALVE drag interactions, pointer lock is mandatory.
    const hasLock = !!document.pointerLockElement;
    if (!hasLock) {
      const t = this.current.data.type;
      if (t === InteractionType.VALVE) return;   // Need lock for drag
      if (t === InteractionType.OBSERVE) return; // Need lock for sustained look
      // SIMPLE / PICKUP can proceed without lock — ActionPanel or pickup handling exits lock correctly
    }

    const data = this.current.data;

    if (data.type === InteractionType.VALVE) {
      this.holdState.active = true;
      this.holdState.progress = 0;
      this.holdState.elapsed = 0;
      this.holdState.target = data;
      this.holdState.duration = (data.turns || 1) * 2;
    } else if (data.type === InteractionType.SIMPLE || data.type === InteractionType.PICKUP) {
      if (this.onInteract) this.onInteract(data);
    } else if (data.type === InteractionType.OBSERVE) {
      this.observeState.active = true;
      this.observeState.data = data;
      this.observeState.meshes = this.current ? this.current.meshes : [];
      this.observeState.elapsed = 0;
      this.observeState.required = data.observeTime || 3;
    }
  }

  _handleMouseUp() {
    if (this.holdState.active) {
      this.holdState.active = false;
      this.holdState.progress = 0;
    }
  }

  getValveProgress() {
    return this.holdState.active ? this.holdState.progress : -1;
  }

  isValveActive() {
    return this.holdState.active;
  }

  dispose() {
    this.interactables = [];
  }
}
