import * as THREE from 'three';

export const InteractionType = Object.freeze({
  VALVE: 'valve',
  SIMPLE: 'simple',
  OBSERVE: 'observe',
  PICKUP: 'pickup',
});

export default class InteractionSystem {
  constructor(camera, scene, eventBus) {
    this._camera = camera;
    this._scene = scene;
    this._eventBus = eventBus;

    this.interactables = [];
    this.current = null;
    this.enabled = false;
    this.maxDist = 8;

    this.holdState = {
      active: false,
      progress: 0,
      target: null,
      duration: 2.0,
      elapsed: 0,
    };

    this.observeState = {
      active: false,
      data: null,
      meshes: [],
      elapsed: 0,
      required: 3.0,
    };

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = this.maxDist;
    this._mouseDown = false;

    /* Per-frame scratch — the raycaster needs a position + direction
       Vector3 every frame. Allocating new ones inside update() (as we
       used to) generated steady GC pressure; reuse one of each. */
    this._rayOrigin = new THREE.Vector3();
    this._rayDir = new THREE.Vector3();

    /* Cached flat list of currently-interactable meshes. Rebuilt only
       when the interactables list changes or a `data.completed` flag
       flips — was being rebuilt every frame which scaled with N. */
    this._activeMeshCache = [];
    this._activeMeshCacheDirty = true;

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    this._eventBus.on('input:mousedown', this._onMouseDown);
    this._eventBus.on('input:mouseup', this._onMouseUp);
  }

  register(meshOrGroup, data) {
    const meshes = [];
    if (meshOrGroup.isMesh) {
      meshOrGroup.userData.interactable = true;
      meshOrGroup.userData.interactionData = data;
      meshes.push(meshOrGroup);
    } else {
      meshOrGroup.traverse((child) => {
        if (child.isMesh) {
          child.userData.interactable = true;
          child.userData.interactionData = data;
          meshes.push(child);
        }
      });
    }
    this.interactables.push({ root: meshOrGroup, meshes, data });
    this._activeMeshCacheDirty = true;
  }

  /* Public hook so callers (Game.js) can flag the cache stale when
     they flip a `data.completed = true` outside of register(). The
     hover/raycast path checks this and rebuilds at most once per
     frame instead of every frame. */
  invalidateCache() {
    this._activeMeshCacheDirty = true;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.current = null;
    this._cancelHold();
    this._cancelObserve();
  }

  update(delta) {
    if (!this.enabled) return null;

    this._camera.getWorldPosition(this._rayOrigin);
    this._camera.getWorldDirection(this._rayDir);
    this._raycaster.set(this._rayOrigin, this._rayDir);

    if (this.holdState.active && this._mouseDown) {
      this.holdState.elapsed += delta;
      this.holdState.progress = Math.min(1, this.holdState.elapsed / this.holdState.duration);
      if (this.holdState.progress >= 1) {
        const data = this.holdState.target;
        this._cancelHold();
        this._eventBus.emit('interaction:valve-complete', data);
      }
      return this.holdState.target;
    }

    if (this.holdState.active && !this._mouseDown) {
      this._cancelHold();
    }

    if (this.observeState.active) {
      const hits = this._raycaster.intersectObjects(this.observeState.meshes, false);
      if (hits.length > 0) {
        this.observeState.elapsed += delta;
      } else {
        this.observeState.elapsed = Math.max(0, this.observeState.elapsed - delta * 2);
      }
      if (this.observeState.elapsed >= this.observeState.required) {
        const data = this.observeState.data;
        this._cancelObserve();
        this._eventBus.emit('interaction:observe-complete', data);
        return null;
      }
      this.observeState.data.observeProgress =
        this.observeState.elapsed / this.observeState.required;
      return this.observeState.data;
    }

    /* Rebuild the active-mesh array only when something marked itself
       completed (or a new interactable registered). Default-frame cost
       is now O(0) instead of O(N) array push every animation frame. */
    if (this._activeMeshCacheDirty) {
      this._activeMeshCache.length = 0;
      for (const item of this.interactables) {
        if (item.data.completed) continue;
        for (const m of item.meshes) this._activeMeshCache.push(m);
      }
      this._activeMeshCacheDirty = false;
    }

    const hits = this._raycaster.intersectObjects(this._activeMeshCache, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const data = hit.object.userData.interactionData;
      if (this.current !== data) {
        this.current = data;
        this._eventBus.emit('interaction:hover', data);
        document.body.style.cursor = 'grab';
      }
      return data;
    }

    if (this.current) {
      this._eventBus.emit('interaction:hover', null);
      document.body.style.cursor = '';
    }
    this.current = null;
    return null;
  }

  getValveProgress() {
    return this.holdState.active ? this.holdState.progress : -1;
  }

  isValveActive() {
    return this.holdState.active;
  }

  dispose() {
    this._eventBus.off('input:mousedown', this._onMouseDown);
    this._eventBus.off('input:mouseup', this._onMouseUp);
    this.interactables = [];
    this.current = null;
  }

  _onMouseDown({ button, raw }) {
    if (raw !== 0 && button !== 'left') return;
    this._mouseDown = true;
    if (!this.enabled || !this.current) return;

    const data = this.current;
    switch (data.type) {
      case InteractionType.VALVE:
        this.holdState.active = true;
        this.holdState.progress = 0;
        this.holdState.elapsed = 0;
        this.holdState.target = data;
        this.holdState.duration = data.holdDuration || 2.0;
        break;

      case InteractionType.SIMPLE:
      case InteractionType.PICKUP:
        this._eventBus.emit('interaction:simple', data);
        break;

      case InteractionType.OBSERVE:
        if (!this.observeState.active) {
          this.observeState.active = true;
          this.observeState.data = data;
          this.observeState.elapsed = 0;
          this.observeState.required = data.observeDuration || 3.0;
          this.observeState.meshes = this._getMeshesForData(data);
        }
        break;
    }
  }

  _onMouseUp({ button, raw }) {
    if (raw !== 0 && button !== 'left') return;
    this._mouseDown = false;
    if (this.holdState.active) {
      this._cancelHold();
    }
  }

  _cancelHold() {
    this.holdState.active = false;
    this.holdState.progress = 0;
    this.holdState.elapsed = 0;
    this.holdState.target = null;
  }

  _cancelObserve() {
    this.observeState.active = false;
    this.observeState.data = null;
    this.observeState.meshes = [];
    this.observeState.elapsed = 0;
  }

  _getMeshesForData(data) {
    for (const item of this.interactables) {
      if (item.data === data) return item.meshes;
    }
    return [];
  }
}
