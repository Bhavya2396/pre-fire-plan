import * as THREE from 'three';
import { cloneRig, retargetClip } from './MixamoRetarget.js';

/**
 * NPCSystem — animated firefighter NPCs.
 *
 * Each NPC is a SkeletonUtils-cloned `firefighter.glb` skinned mesh
 * with its own AnimationMixer. Mixamo .fbx clips are retargeted onto
 * the rig at spawn (track names are remapped to match the GLB's bone
 * naming convention).
 *
 * Public API:
 *   spawn({ id, position, rotationY, animation, scale }) → npc
 *   playClip(id, name, { fade = 0.25, loop = true })
 *   gotoTarget(id, target)
 *   update(delta, playerPos)
 *
 * If `firefighter.glb` failed to load (e.g. the file is missing or
 * corrupt), spawn() falls back to a procedural capsule so the rest of
 * the simulation continues to run without errors.
 */
export default class NPCSystem {
  constructor(scene, eventBus, assetManager) {
    this._scene = scene;
    this._eventBus = eventBus;
    this._assets = assetManager;
    this._npcs = [];
    this._time = 0;
    this._sourceScene = null;

    this._eventBus.on('npc:spawn', (config) => this.spawn(config));
    this._eventBus.on('npc:goto', (id, target) => this.gotoTarget(id, target));
    this._eventBus.on('npc:play', (id, name, opts) => this.playClip(id, name, opts));
  }

  /* Resolve the source scene lazily — AssetManager is constructed
     before loadAll() resolves, so the GLTF isn't in the cache when
     NPCSystem is instantiated. */
  _ensureSource() {
    if (this._sourceScene) return this._sourceScene;
    const gltf = this._assets?.getModelGLTF?.('firefighter');
    this._sourceScene = gltf ? gltf.scene : null;
    return this._sourceScene;
  }

  _normalizeRig(group) {
    /* Mixamo / Sketchfab firefighter exports often ship at 100x scale
       in cm and pivoted at the hips. Normalise so the model stands
       1.8 m tall on the floor at the requested position. */
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const targetH = 1.8;
    if (size.y > 0.01) {
      const s = targetH / size.y;
      group.scale.multiplyScalar(s);
      box.setFromObject(group);
    }
    if (box.min.y < 0) group.position.y -= box.min.y;
    group.traverse((c) => {
      if (c.isMesh || c.isSkinnedMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
        c.frustumCulled = false; // skinned meshes false-cull aggressively
      }
    });
  }

  spawn(config) {
    const id = config.id || `npc_${this._npcs.length}`;
    const pos = config.position || { x: 0, z: 0 };
    let group;
    let mixer = null;
    const actions = new Map();

    const source = this._ensureSource();
    if (source) {
      group = cloneRig(source);
      this._normalizeRig(group);
      if (config.scale) group.scale.multiplyScalar(config.scale);
      group.position.set(pos.x, group.position.y, pos.z);
      if (config.rotationY != null) group.rotation.y = config.rotationY;

      mixer = new THREE.AnimationMixer(group);

      // Retarget every Mixamo clip we have onto THIS clone's skeleton.
      // Cheap — the skeleton is already in memory; we only rewrite
      // track names.
      const names = this._assets?.getAnimationNames?.() || [];
      for (const name of names) {
        const raw = this._assets.getAnimation(name);
        if (!raw) continue;
        const remapped = retargetClip(raw, group);
        const action = mixer.clipAction(remapped);
        action.enabled = true;
        actions.set(name, action);
      }
    } else {
      // Fallback: procedural capsule + helmet so the world still has
      // *something* visible at the firefighter slots.
      group = this._buildFallbackFigure(config);
      group.position.set(pos.x, 0, pos.z);
      if (config.rotationY != null) group.rotation.y = config.rotationY;
    }

    this._scene.add(group);

    const npc = {
      id,
      group,
      mixer,
      actions,
      currentAction: null,
      target: null,
      speed: config.speed || 2.6,
      patrol: config.patrol || null,
      patrolIdx: 0,
    };
    this._npcs.push(npc);

    if (config.animation) this.playClip(id, config.animation, { fade: 0 });
    return npc;
  }

  _buildFallbackFigure(config) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: config.color || 0xcc4400, roughness: 0.7,
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 8), bodyMat);
    body.position.y = 1.2;
    body.castShadow = true;
    group.add(body);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc88, roughness: 0.8 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), headMat);
    head.position.y = 2.0;
    head.castShadow = true;
    group.add(head);
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xdddd00, roughness: 0.4, metalness: 0.3,
    });
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      helmetMat,
    );
    helmet.position.y = 2.1;
    group.add(helmet);
    return group;
  }

  playClip(id, name, opts = {}) {
    const npc = this._npcs.find((n) => n.id === id);
    if (!npc || !npc.mixer) return;
    const next = npc.actions.get(name);
    if (!next) {
      console.warn(`NPCSystem: clip "${name}" not bound to npc "${id}"`);
      return;
    }
    const fade = opts.fade != null ? opts.fade : 0.25;
    next.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = opts.loop === false;
    next.reset();
    next.play();
    if (npc.currentAction && npc.currentAction !== next) {
      npc.currentAction.crossFadeTo(next, fade, false);
    }
    npc.currentAction = next;
  }

  gotoTarget(id, target) {
    const npc = this._npcs.find((n) => n.id === id);
    if (!npc) return;
    npc.target = { x: target.x, z: target.z };
    npc.path = null;
    if (npc.actions.has('walking')) this.playClip(id, 'walking');
  }

  /* Walk a sequence of waypoints. Crossfades to `running` (if present)
     while moving, then to `endAnimation` ('idle' by default) at the
     final point. Each waypoint is { x, z }. */
  walkPath(id, points, opts = {}) {
    const npc = this._npcs.find((n) => n.id === id);
    if (!npc || !points || points.length === 0) return;
    npc.path = points.slice();
    npc.pathIdx = 0;
    npc.pathEndAnim = opts.endAnimation || 'idle';
    npc.target = { x: npc.path[0].x, z: npc.path[0].z };
    const moveAnim = opts.moveAnimation
      || (npc.actions.has('running') ? 'running'
        : npc.actions.has('walking') ? 'walking'
        : null);
    if (moveAnim) this.playClip(id, moveAnim);
    if (opts.speed) npc.speed = opts.speed;
  }

  /* Spawn visible NPCs across the gameplay area using Mixamo animations.
     Placed at locations the player walks past during the scenario so
     the world feels alive. Called from Game.js after loadAll(). */
  spawnDefaultPosers() {
    /* ── FIRE STATION APRON — 2 idle firefighters (visible from spawn) */
    const apron = [
      { x: 44.5, z: -46.0, rotY: -0.3, anim: 'idle' },
      { x: 46.5, z: -45.5, rotY:  0.4, anim: 'idle' },
    ];
    apron.forEach((p, i) => {
      this.spawn({
        id: `apron_ff_${i}`,
        position: { x: p.x, z: p.z },
        rotationY: p.rotY,
        animation: p.anim,
      });
    });

    /* ── CONTROL AREA — operator walking between control station and
       the south corridor. Player sees this during PATROL. */
    const controlWalker = this.spawn({
      id: 'control_walker',
      position: { x: 48, z: 60 },
      rotationY: Math.PI,
      animation: 'walking',
    });
    if (controlWalker.mixer) {
      this.walkPath('control_walker', [
        { x: 48, z: 55 },
        { x: 52, z: 62 },
        { x: 48, z: 68 },
        { x: 48, z: 60 },
      ], { moveAnimation: 'walking', endAnimation: 'idle', speed: 1.8 });
    }

    /* ── DYKE SOUTH CORRIDOR — patrolling guard, running along the road.
       Player passes this area en route to manifold/dyke valves. */
    const corridorRunner = this.spawn({
      id: 'corridor_runner',
      position: { x: -5, z: 28 },
      rotationY: 0,
      animation: 'running',
    });
    if (corridorRunner.mixer) {
      this.walkPath('corridor_runner', [
        { x: 10, z: 28 },
        { x: 20, z: 28 },
        { x: 10, z: 28 },
        { x: -5, z: 28 },
      ], { moveAnimation: 'running', endAnimation: 'idle', speed: 3.8 });
    }

    /* ── NEAR TANK 101-A — kneeling operator inspecting the tank base.
       Visible during the roof drain and boilover steps. */
    this.spawn({
      id: 'tank_inspector',
      position: { x: -10, z: 6 },
      rotationY: -Math.PI / 4,
      animation: 'kneeling_pointing',
    });

    /* ── MANIFOLD PAD — operator standing near the manifold valve. */
    this.spawn({
      id: 'manifold_operator',
      position: { x: 6, z: 20 },
      rotationY: -Math.PI / 2,
      animation: 'idle',
    });

    /* ── NEAR HYDRANT H-28 — firefighter idle, waiting for the first
       turnout phase. */
    this.spawn({
      id: 'hydrant_ff',
      position: { x: -18, z: 36 },
      rotationY: Math.PI / 3,
      animation: 'idle',
    });

    /* ── EAST SIDE — firefighter walking a patrol near cooling valve. */
    const eastPatrol = this.spawn({
      id: 'east_patrol',
      position: { x: 30, z: 0 },
      rotationY: Math.PI,
      animation: 'walking',
    });
    if (eastPatrol.mixer) {
      this.walkPath('east_patrol', [
        { x: 30, z: -8 },
        { x: 30, z: 5 },
        { x: 30, z: 0 },
      ], { moveAnimation: 'walking', endAnimation: 'idle', speed: 2.0 });
    }
  }

  update(delta, playerPos) {
    this._time += delta;
    for (const npc of this._npcs) {
      if (npc.mixer) npc.mixer.update(delta);

      if (npc.target) {
        const dx = npc.target.x - npc.group.position.x;
        const dz = npc.target.z - npc.group.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.4) {
          const step = npc.speed * delta;
          npc.group.position.x += (dx / dist) * step;
          npc.group.position.z += (dz / dist) * step;
          npc.group.rotation.y = Math.atan2(dx, dz);
        } else if (npc.path && npc.pathIdx < npc.path.length - 1) {
          npc.pathIdx++;
          npc.target = { x: npc.path[npc.pathIdx].x, z: npc.path[npc.pathIdx].z };
        } else {
          npc.target = null;
          npc.path = null;
          const endAnim = npc.pathEndAnim || 'idle';
          if (npc.actions.has(endAnim)) this.playClip(npc.id, endAnim);
        }
      }

      // Subtle bob only on the procedural fallback figures (skinned
      // rigs already have idle motion baked in).
      if (!npc.mixer) {
        const bobPhase = this._time * 3 + npc.group.position.x;
        npc.group.position.y = Math.abs(Math.sin(bobPhase)) * 0.05;
      }
    }
  }

  dispose() {
    for (const npc of this._npcs) {
      if (npc.mixer) npc.mixer.stopAllAction();
      npc.group.traverse((c) => {
        if (c.isMesh || c.isSkinnedMesh) {
          c.geometry?.dispose();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          for (const m of mats) m?.dispose();
        }
      });
      this._scene.remove(npc.group);
    }
    this._npcs = [];
  }
}
