import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * NPCManager — manages firefighter NPCs with multiple animation states.
 *
 * Animation states per NPC:
 *   'idle'     — Standing still (firefighter_idle.fbx)
 *   'walk'     — Walking patrol (Walking.fbx / firefighter.fbx)
 *   'run'      — Running to position (run_forward.fbx)
 *   'kneel'    — Kneeling and pointing at target (kneeling_pointing.fbx)
 *
 * Behaviors:
 *   'patrol'   — circular patrol around origin (walk anim)
 *   'goto'     — run to a target position, then switch to arrival state
 *   'station'  — stand/kneel at position, facing target direction
 */

const TEXTURE_BASE = '/models/firefighter_textures/';
const TEXTURE_MAP = {
  Body: 'Body', Tops: 'Top', Bottoms: 'Bottom',
  Gloves: 'Glove', Hats: 'Hat', Masks: 'Mask', Shoes: 'Shoes',
};
const TEX_LOADER = new THREE.TextureLoader();
const _texCache = {};

function loadTex(path, srgb = true) {
  const t = TEX_LOADER.load(path);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  t.flipY = true;
  return t;
}

function getTextures(meshName) {
  for (const [key, prefix] of Object.entries(TEXTURE_MAP)) {
    if (meshName.toLowerCase().includes(key.toLowerCase())) {
      if (!_texCache[prefix]) {
        _texCache[prefix] = {
          diffuse: loadTex(`${TEXTURE_BASE}${prefix}_diffuse.png`, true),
          normal:  loadTex(`${TEXTURE_BASE}${prefix}_normal.png`, false),
        };
      }
      return _texCache[prefix];
    }
  }
  return null;
}

function stripRootMotion(clip) {
  clip.tracks = clip.tracks.filter(t => {
    const n = t.name.toLowerCase();
    return !(n.includes('hips') && n.includes('position'));
  });
}

export class NPCManager {
  constructor(scene) {
    this.scene = scene;
    this.npcs = [];
    this.mixers = [];
    this._fbxRoot = null;
    this._clips = {};
    this._ready = false;
    this._queue = [];
    this._load();
  }

  async _load() {
    const loader = new FBXLoader();
    const loadFBX = (path) => new Promise(resolve => {
      loader.load(path, resolve, undefined, (err) => {
        console.warn('[NPC] FBX load failed:', path, err.message || err);
        resolve(null);
      });
    });

    const [walkFbx, idleFbx, runFbx, kneelFbx] = await Promise.all([
      loadFBX('/models/firefighter.fbx'),
      loadFBX('/models/firefighter_idle.fbx'),
      loadFBX('/models/run_forward.fbx'),
      loadFBX('/models/kneeling_pointing.fbx'),
    ]);

    if (walkFbx) {
      walkFbx.scale.setScalar(0.01);
      walkFbx.updateMatrixWorld(true);

      walkFbx.traverse(c => {
        if (!c.isMesh) return;
        const texSet = getTextures(c.name);
        if (texSet) {
          c.material = new THREE.MeshStandardMaterial({
            map: texSet.diffuse, normalMap: texSet.normal,
            roughness: 0.75, metalness: 0.1,
          });
        }
        c.castShadow = true;
        c.receiveShadow = true;
        c.frustumCulled = false;
      });

      if (walkFbx.animations?.length > 0) {
        this._clips.walk = walkFbx.animations[0];
        stripRootMotion(this._clips.walk);
      }
      this._fbxRoot = walkFbx;
    }

    if (idleFbx?.animations?.length > 0) {
      this._clips.idle = idleFbx.animations[0];
      stripRootMotion(this._clips.idle);
    }
    if (runFbx?.animations?.length > 0) {
      this._clips.run = runFbx.animations[0];
      stripRootMotion(this._clips.run);
    }
    if (kneelFbx?.animations?.length > 0) {
      this._clips.kneel = kneelFbx.animations[0];
      stripRootMotion(this._clips.kneel);
    }

    const loaded = Object.keys(this._clips).join(', ');
    console.log(`[NPC] Clips loaded: ${loaded}`);
    this._ready = true;
    this._queue.forEach(fn => fn());
    this._queue = [];
  }

  /**
   * Spawn an NPC with optional behavior.
   *
   * @param {THREE.Vector3} position
   * @param {number} rotY  Initial facing
   * @param {number} patrolRadius  >0 = walk patrol, 0 = stand idle
   * @param {object} opts  Extra behavior config:
   *   - behavior: 'patrol' | 'goto' | 'station'
   *   - target: Vector3 — destination for 'goto', face-direction for 'station'
   *   - arrivalState: 'idle' | 'kneel' — what to do after arriving
   *   - runSpeed: number — world-units/sec for 'goto' behavior
   *   - role: string — label like 'SIC', 'HOSE_OP', 'NOZZLE_OP', 'DRIVER'
   */
  spawn(position, rotY = 0, patrolRadius = 2.0, opts = {}) {
    const fn = () => this._doSpawn(position.clone(), rotY, patrolRadius, opts);
    if (this._ready) fn();
    else this._queue.push(fn);
  }

  /**
   * Spawn an NPC that runs from `from` to `to`, then takes arrivalState.
   */
  spawnRunTo(from, to, arrivalState = 'kneel', role = '') {
    const rotY = Math.atan2(to.x - from.x, to.z - from.z);
    this.spawn(from, rotY, 0, {
      behavior: 'goto',
      target: to.clone(),
      arrivalState,
      runSpeed: 4.0,
      role,
    });
  }

  _doSpawn(position, rotY, patrolRadius, opts) {
    if (!this._fbxRoot) { this._spawnFallback(position, rotY, patrolRadius, opts); return; }

    const root = this._fbxRoot.clone(true);
    root.position.copy(position);
    root.position.y = 0;
    root.rotation.y = rotY;
    this.scene.add(root);

    const mixer = new THREE.AnimationMixer(root);
    this.mixers.push(mixer);

    const actions = {};
    for (const [name, clip] of Object.entries(this._clips)) {
      const action = mixer.clipAction(clip);
      action.loop = THREE.LoopRepeat;
      action.setEffectiveWeight(0);
      action.play();
      actions[name] = action;
    }

    const behavior = opts.behavior || (patrolRadius > 0 ? 'patrol' : 'station');
    let initialAnim = 'idle';
    if (behavior === 'patrol') initialAnim = 'walk';
    if (behavior === 'goto')   initialAnim = 'run';

    if (actions[initialAnim]) actions[initialAnim].setEffectiveWeight(1);
    else if (actions.idle) actions.idle.setEffectiveWeight(1);

    const npc = {
      root, mixer, actions,
      origin: position.clone(),
      patrolRadius,
      patrolAngle: Math.random() * Math.PI * 2,
      patrolSpeed: 0.9 + Math.random() * 0.3,
      currentAnim: initialAnim,
      behavior,
      target: opts.target || null,
      arrivalState: opts.arrivalState || 'idle',
      runSpeed: opts.runSpeed || 4.0,
      role: opts.role || '',
      arrived: false,
    };

    this.npcs.push(npc);
  }

  _crossFade(npc, toAnim, duration = 0.4) {
    if (npc.currentAnim === toAnim) return;
    const fromAction = npc.actions[npc.currentAnim];
    const toAction   = npc.actions[toAnim];
    if (!toAction) return;

    if (fromAction) {
      toAction.reset();
      toAction.setEffectiveWeight(1);
      toAction.crossFadeFrom(fromAction, duration, true);
    } else {
      toAction.setEffectiveWeight(1);
    }
    npc.currentAnim = toAnim;
  }

  _spawnFallback(position, rotY, patrolRadius, opts) {
    const group = new THREE.Group();
    const bunker = new THREE.MeshStandardMaterial({ color: 0x8B7D36, roughness: 0.75 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xEEEE00, emissive: 0x444400 });
    const helmet = new THREE.MeshStandardMaterial({ color: 0xCC0000, metalness: 0.4 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xDEB887, roughness: 0.6 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.24), bunker);
    torso.position.y = 1.1; group.add(torso);
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.25), stripe);
    s1.position.y = 0.95; group.add(s1);
    const s2 = s1.clone(); s2.position.y = 1.25; group.add(s2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), skin);
    head.position.y = 1.52; group.add(head);
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.1, 8), helmet);
    helm.position.y = 1.65; group.add(helm);

    const armGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1);
    const lAP = new THREE.Group(); lAP.position.set(-0.26, 1.3, 0);
    const la = new THREE.Mesh(armGeo, bunker); la.position.y = -0.2; lAP.add(la); group.add(lAP);
    const rAP = new THREE.Group(); rAP.position.set(0.26, 1.3, 0);
    const ra = new THREE.Mesh(armGeo, bunker); ra.position.y = -0.2; rAP.add(ra); group.add(rAP);

    const legGeo = new THREE.BoxGeometry(0.13, 0.45, 0.13);
    const lLP = new THREE.Group(); lLP.position.set(-0.1, 0.82, 0);
    const ll = new THREE.Mesh(legGeo, bunker); ll.position.y = -0.22; lLP.add(ll);
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.18), boot); lb.position.set(0, -0.46, 0.02); lLP.add(lb);
    group.add(lLP);
    const rLP = new THREE.Group(); rLP.position.set(0.1, 0.82, 0);
    const rl = new THREE.Mesh(legGeo, bunker); rl.position.y = -0.22; rLP.add(rl);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.18), boot); rb.position.set(0, -0.46, 0.02); rLP.add(rb);
    group.add(rLP);

    const scba = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.35, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6 })
    );
    scba.position.set(0, 1.15, -0.16); group.add(scba);

    group.position.copy(position); group.position.y = 0; group.rotation.y = rotY;
    group.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.scene.add(group);

    const behavior = opts?.behavior || (patrolRadius > 0 ? 'patrol' : 'station');
    this.npcs.push({
      root: group, mixer: null, actions: {},
      leftArmPivot: lAP, rightArmPivot: rAP, leftLegPivot: lLP, rightLegPivot: rLP,
      origin: position.clone(), patrolRadius,
      patrolAngle: Math.random() * Math.PI * 2, patrolSpeed: 1.0,
      walkPhase: Math.random() * Math.PI * 2, isFallback: true,
      currentAnim: behavior === 'patrol' ? 'walk' : 'idle',
      behavior, target: opts?.target || null,
      arrivalState: opts?.arrivalState || 'idle',
      runSpeed: opts?.runSpeed || 4.0,
      role: opts?.role || '', arrived: false,
    });
  }

  update(delta) {
    for (const mixer of this.mixers) mixer.update(delta);

    for (const npc of this.npcs) {
      // Fallback procedural animation
      if (npc.isFallback && (npc.currentAnim === 'walk' || npc.currentAnim === 'run')) {
        const speed = npc.currentAnim === 'run' ? 10 : 6;
        npc.walkPhase = (npc.walkPhase || 0) + delta * speed;
        const sw = Math.sin(npc.walkPhase) * 0.45;
        if (npc.leftLegPivot)  npc.leftLegPivot.rotation.x  =  sw;
        if (npc.rightLegPivot) npc.rightLegPivot.rotation.x = -sw;
        if (npc.leftArmPivot)  npc.leftArmPivot.rotation.x  = -sw * 0.7;
        if (npc.rightArmPivot) npc.rightArmPivot.rotation.x =  sw * 0.7;
      }

      // Behavior: goto — run toward target
      if (npc.behavior === 'goto' && npc.target && !npc.arrived) {
        const dx = npc.target.x - npc.root.position.x;
        const dz = npc.target.z - npc.root.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.5) {
          npc.arrived = true;
          npc.root.position.x = npc.target.x;
          npc.root.position.z = npc.target.z;
          npc.behavior = 'station';
          this._crossFade(npc, npc.arrivalState, 0.5);
        } else {
          const speed = npc.runSpeed * delta;
          const nx = dx / dist;
          const nz = dz / dist;
          npc.root.position.x += nx * speed;
          npc.root.position.z += nz * speed;
          npc.root.rotation.y = Math.atan2(dx, dz);
        }
        continue;
      }

      // Behavior: patrol
      if (npc.behavior === 'patrol' && npc.patrolRadius > 0) {
        npc.patrolAngle += (delta * npc.patrolSpeed) / npc.patrolRadius;
        const nx = npc.origin.x + Math.cos(npc.patrolAngle) * npc.patrolRadius;
        const nz = npc.origin.z + Math.sin(npc.patrolAngle) * npc.patrolRadius;
        const ddx = nx - npc.root.position.x;
        const ddz = nz - npc.root.position.z;
        npc.root.position.x = nx;
        npc.root.position.z = nz;
        if (Math.abs(ddx) + Math.abs(ddz) > 0.001) {
          npc.root.rotation.y = Math.atan2(ddx, ddz);
        }
      }
    }
  }

  /**
   * Command all NPCs with a specific role to change animation.
   */
  setRoleAnim(role, anim) {
    for (const npc of this.npcs) {
      if (npc.role === role) this._crossFade(npc, anim, 0.5);
    }
  }

  /**
   * Get NPC count
   */
  get count() { return this.npcs.length; }

  dispose() {
    for (const npc of this.npcs) {
      npc.mixer?.stopAllAction();
      npc.root.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose(); m.dispose(); });
        }
      });
      this.scene.remove(npc.root);
    }
    this.npcs = []; this.mixers = [];
  }
}
