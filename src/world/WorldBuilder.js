import * as THREE from 'three';
import ProceduralFactory from './ProceduralFactory.js';
import InstancedRenderer from './InstancedRenderer.js';
import {
  buildGateValve, buildButterflyValve, buildLeverValve, buildMCP,
  buildValveAssembly, buildIndustrialPipe,
} from './ProceduralEquipment.js';
import worldData from '../config/world.json';

// Models that we are intentionally REPLACING with crisp procedural
// Three.js builds. The corresponding GLB placements in world.json are
// silently skipped during world construction. Procedural equivalents
// are placed afterwards at the same coordinates with the same `id`s
// so EquipmentAnimator + InteractionSystem find them by ID/lookup.
const PROCEDURAL_REPLACED_MODELS = new Set([
  'industrial_valve',
  'butterfly_valve',
  'gate_valve',
  'fire_alarm_button',
  'pipeline',
]);

export default class WorldBuilder {
  constructor(scene, assetManager, eventBus, collisionSystem = null) {
    this._scene = scene;
    this._assets = assetManager;
    this._eventBus = eventBus;
    this._collision = collisionSystem;

    this._factory = null;
    this._instanced = null;
    this._placedModels = new Map();
    this._positions = null;
  }

  /* ═══════════════════════════════════════════════════════════
     BUILD — main entry point
     ═══════════════════════════════════════════════════════════ */

  async build() {
    this._positions = worldData.positions || {};

    // 1. Procedural geometry
    this._factory = new ProceduralFactory(this._scene, this._assets);
    this._factory.buildGround();
    this._factory.buildRoads();
    this._factory.buildDyke();
    this._factory.buildEnclosures();
    this._factory.buildTankPads();
    this._factory.buildDrainChannels();
    this._factory.buildEquipmentShed();
    this._factory.buildFlareStack();
    this._factory.buildBlueBuildings();
    this._factory.buildGroundDetails();
    this._factory.buildNumaligarhAccents();

    // 2. Instanced objects
    this._instanced = new InstancedRenderer(this._scene);
    this._instanced.createFencePosts();

    /* Real oak trees around the perimeter (Numaligarh forest backdrop).
       Falls back to procedural tree line if the GLB isn't available.

       NOTE: the second argument is the perimeter HALF-EXTENT in meters,
       not a tree count. Earlier we were passing `worldData.treeCount`
       (260) which placed trees out to ±260 m and looped corner clusters
       at that radius — every iteration was a full GLB clone. Now we
       feed the dedicated `worldData.treeRadius` (default 110 m) so the
       forest sits just past the play area without spilling kilometres
       of clones into the scene graph. */
    const oak = this._assets.getModel('oak_trees');
    if (oak) {
      this._instanced.placeOakTreesAround(oak, worldData.treeRadius || 110);
    } else {
      this._instanced.createTreeLine();
    }

    this._instanced.createBollards(
      worldData.bollards || [
        // dyke corner bollards (outside road areas)
        [-42, 22], [-42, -22], [32, 22], [32, -22],
        // bollards along road kerbs (south side of Road 10, south side of Road 12)
        [-25, 36], [-15, 36], [-5, 36], [5, 36], [15, 36],
        [-25, 61], [-15, 61], [-5, 61], [5, 61], [15, 61],
      ],
    );

    this._instanced.createLightPoles(
      worldData.lightPoles || [
        // along Road 10 south kerb
        [-30, 37], [-10, 37], [10, 37], [30, 37],
        // along Road 12 south kerb
        [-30, 62], [-10, 62], [10, 62], [30, 62],
        // around perimeter (well away from roads)
        [42, -20], [42, 12],
        [-46, -10], [-46, 18],
        [55, 75], [-72, -12],
      ],
    );

    if (worldData.steelFrameworks) {
      for (const f of worldData.steelFrameworks) {
        this._instanced.createSteelFramework(f.cx, f.cz, f.w, f.d, f.h);
      }
    } else {
      // Smaller pipe-rack scaffold next to the process backdrop (north),
      // not draped over the entire dyke as before.
      this._instanced.createSteelFramework(0, -32, 28, 6, 6);
    }

    if (worldData.overheadPipes) {
      for (const p of worldData.overheadPipes) {
        this._instanced.createOverheadPipes(p.cx, p.cz);
      }
    } else {
      this._instanced.createOverheadPipes(0, -28);
    }

    this._instanced.createWarnings(
      worldData.warningSigns || [
        // on dyke corners
        [-40, 22, 0], [30, 22, Math.PI],
        // off-road on perimeter
        [-46, 0, Math.PI / 2], [40, 0, -Math.PI / 2],
        // along road kerbs (south side, away from movement path)
        [-25, 36, 0], [15, 36, 0],
        [-25, 61, 0], [15, 61, 0],
      ],
    );

    // 3. GLB models from world.json zones (skips procedurally-replaced ones)
    await this._placeZoneModels();

    // 4. Procedural equipment (valves, MCP) — placed at known SOP
    //    coordinates with stable IDs so EquipmentAnimator/Interaction
    //    can find them.
    this._placeProceduralEquipment();

    // 4b. Procedural pipe runs replace the old tiny pipeline.glb
    this._placeProceduralPipes();

    // 5. Hard collision boxes for permanent world geometry.
    //    These keep the player from walking through dyke walls, tanks,
    //    and the main GLB structures regardless of asset load order.
    if (this._collision) {
      this._addStaticColliders();
    }

    // 6. Interior light — control station has no exterior sun penetration;
    //    a warm PointLight keeps the radio / walkie-talkie area visible.
    const controlLight = new THREE.PointLight(0xfff5e0, 2.2, 22, 1.6);
    controlLight.position.set(52, 3.2, 65);
    this._scene.add(controlLight);
    // Second fill to avoid hard shadows deep inside
    const controlFill = new THREE.PointLight(0xddeeff, 0.9, 18, 2.0);
    controlFill.position.set(48, 2.5, 62);
    this._scene.add(controlFill);

    this._eventBus.emit('world:built');
  }

  /* ═══════════════════════════════════════════════════════════
     GLB PLACEMENT
     ═══════════════════════════════════════════════════════════ */

  async _placeZoneModels() {
    const zones = worldData.zones || {};
    for (const zoneName of Object.keys(zones)) {
      const zone = zones[zoneName];
      const placements = zone.placements || [];
      for (const entry of placements) {
        // Skip GLB placements we replace procedurally — those are
        // placed by _placeProceduralEquipment() below at the same coords.
        if (PROCEDURAL_REPLACED_MODELS.has(entry.model)) continue;

        const pos = entry.position || entry.pos;
        if (!pos) continue;
        const model = this._placeModel(
          entry.model,
          pos,
          entry.scale,
          entry.rotY || 0,
          entry.targetSize,
          entry.yOffset,
        );
        if (model && entry.id) {
          this._placedModels.set(entry.id, model);
        }
        if (model && entry.collision && this._collision) {
          this._addCollider(model, entry.collision);
        }
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     PROCEDURAL EQUIPMENT — valves, MCP
     ═══════════════════════════════════════════════════════════ */

  _placeProceduralEquipment() {
    // Each valve is built as a full ASSEMBLY (pipe stub + flanges +
    // bracket + valve), so it visually attaches to a real surface
    // (tank shell, dyke wall, pad). Coordinates put each assembly
    // adjacent to the geometry it's "welded" to:
    //   - TANK_A shell south face is at z = 2.5 (centre -5 + r 7.5)
    //   - dyke south wall at z = 25, west wall at x = -40, east at x = 30
    //   - manifold sits in the south corridor at z ≈ 22
    const items = [
      // ── RD-101A: gate valve mounted to the south face of Tank 101A.
      //    Tank A pad is centred at (-15, -5) with r≈8, so the south
      //    shell is at z≈3. We push the assembly out to z=4.5 so the
      //    1m bracket arm just kisses the tank shell at z≈3.5 instead
      //    of clipping INTO the tank cylinder. Wheel ends up at world
      //    (-15, 1.65, 4.70) — exactly chest-height for the player.
      {
        id: 'roof_drain_valve',
        builder: () => buildValveAssembly({
          kind: 'gate', style: 'tank-side',
          colorKey: 'gate', tag: 'RD-101A', pipeColor: 0x3e3e3e,
        }),
        position: [-15, 0, 4.5],
        rotY: -Math.PI / 2,
      },
      // ── DV-101: gate valve sticking out of the south dyke wall.
      //    The south dyke wall sits at z=25; we place the assembly at
      //    z=24.5 so the wall-plate (offset -0.35 m on local -X →
      //    world +Z under rotY=π/2) lands at z≈24.85 — flush against
      //    the inside face of the wall instead of floating in front
      //    of it like the earlier z=24 placement.
      {
        id: 'dyke_drain_valve',
        builder: () => buildValveAssembly({
          kind: 'gate', style: 'wall-stub',
          colorKey: 'gate', tag: 'DV-101', pipeColor: 0x3e3e3e,
        }),
        position: [-26, 0, 24.5],
        rotY: Math.PI / 2,
      },
      // ── MV-101A: lever valve on a concrete pad with a horizontal
      //    manifold pipe running between the tanks.
      {
        id: 'manifold_valve',
        builder: () => buildValveAssembly({
          kind: 'lever', style: 'manifold-pad',
          colorKey: 'ball', tag: 'MV-101A', pipeColor: 0x3e3e3e,
        }),
        position: [4, 0, 22],
        rotY: 0,
      },
      // ── CW-101B: butterfly valve on a vertical riser east of the
      //    dyke; outlet pipe heads west toward Tank 101B.
      {
        id: 'cooling_water_valve',
        builder: () => buildValveAssembly({
          kind: 'butterfly', style: 'pipe-riser',
          colorKey: 'cooling', tag: 'CW-101B', pipeColor: 0x3e3e3e,
        }),
        position: [33, 0, -3],
        rotY: Math.PI,
      },
      // ── CONTROL STATION wall — MCP red call point, raised 1.4 m so
      //    it sits at chest height like a real wall mount.
      {
        id: 'manual_call_point',
        builder: () => buildMCP(),
        position: [50, 1.2, 64.5],
        rotY: Math.PI,
        flush: true,
      },
    ];

    for (const item of items) {
      const grp = item.builder();
      grp.rotation.y = item.rotY || 0;
      grp.position.set(item.position[0], item.position[1] || 0, item.position[2]);

      // Auto-ground if the caller didn't ask for a fixed Y. Snap so the
      // bounding box bottom sits at the requested Y (default 0).
      if (!item.flush) {
        const baseY = item.position[1] || 0;
        const box = new THREE.Box3().setFromObject(grp);
        if (box.min.y < baseY - 0.001) {
          grp.position.y += baseY - box.min.y;
        }
      }

      this._scene.add(grp);
      this._placedModels.set(item.id, grp);
    }
  }

  _placeProceduralPipes() {
    const zones = worldData.zones || {};
    for (const zoneName of Object.keys(zones)) {
      const placements = zones[zoneName]?.placements || [];
      for (const entry of placements) {
        if (entry.model !== 'pipeline') continue;
        const pos = entry.position || entry.pos;
        if (!pos) continue;

        const rawLen = entry.targetSize || 4;
        const length = Math.min(rawLen, 5);
        const pipe = buildIndustrialPipe(length, {
          pipeColor: 0xc4a830,
          pipeY: 0.50 + (entry.yOffset || 0),
        });
        pipe.rotation.y = entry.rotY || 0;
        pipe.position.set(pos[0], pos[1] || 0, pos[2]);

        const box = new THREE.Box3().setFromObject(pipe);
        if (box.min.y < -0.001) {
          pipe.position.y -= box.min.y;
        }

        this._scene.add(pipe);
      }
    }
  }

  _placeModel(name, pos, scale, rotY = 0, targetSize = null, yOffset = 0) {
    const model = this._assets.getModel(name);
    if (!model) return null;

    model.rotation.y = rotY;
    model.traverse(c => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });

    // Apply scale or auto-fit to target longest-axis size
    if (targetSize && targetSize > 0) {
      model.scale.setScalar(1);
      model.position.set(0, 0, 0);
      const probe = new THREE.Box3().setFromObject(model);
      const probeSize = new THREE.Vector3();
      probe.getSize(probeSize);
      const longest = Math.max(probeSize.x, probeSize.y, probeSize.z) || 1;
      const fit = targetSize / longest;
      model.scale.setScalar(fit);
    } else if (typeof scale === 'number') {
      model.scale.setScalar(scale);
    } else if (Array.isArray(scale)) {
      model.scale.set(scale[0], scale[1], scale[2]);
    } else {
      model.scale.setScalar(1);
    }

    model.position.set(pos[0], 0, pos[2]);

    const box = new THREE.Box3().setFromObject(model);
    if (box.min.y < -0.01) model.position.y -= box.min.y;
    if (yOffset) model.position.y += yOffset;

    const size = new THREE.Vector3();
    box.getSize(size);
    const longestPlaced = Math.max(size.x, size.y, size.z);
    if (longestPlaced > 50) {
      console.warn(`WorldBuilder: "${name}" is OVERSIZED — size`, size.toArray().map(v => v.toFixed(1)), '— shrink targetSize in world.json');
    } else if (longestPlaced > 25) {
      console.info(`WorldBuilder: "${name}" placed at ${longestPlaced.toFixed(1)}m (large but ok)`);
    }

    this._scene.add(model);
    return model;
  }

  /* ─── Hard-coded collision geometry ────────────────────────────────
     These approximate the key solid structures in the refinery scene.
     Player radius is 0.4 m (CollisionSystem constant).

     Coordinate origin: dyke interior is roughly (-40..+30) on X and
     (-8..+25) on Z; Tank 101A is centred at (-15, 0, -5).
     ──────────────────────────────────────────────────────────────── */
  _addStaticColliders() {
    const C = this._collision;
    const V = THREE.Vector3;

    /* ── Dyke perimeter walls (4 thick concrete slabs) ──────────── */
    // West wall  x ≈ -42, z -8 → +26, thickness 2m
    C.addBox(new V(-43, 0, 9),   new V(1, 4, 17));
    // East wall  x ≈ +32, z -8 → +26, thickness 2m
    C.addBox(new V(33, 0, 9),    new V(1, 4, 17));
    // North wall z ≈ -8,  x -42 → +32, thickness 2m
    C.addBox(new V(-5, 0, -9),   new V(37, 4, 1));
    // South wall z ≈ +26, x -42 → +32, thickness 2m
    C.addBox(new V(-5, 0, 27),   new V(37, 4, 1));

    /* ── Tank 101A — large vertical cylinder, r ≈ 8m ────────────── */
    C.addCylinder(new V(-15, 0, -5), 8.5);

    /* ── Tank 101B — smaller horizontal tank (approx) ────────────── */
    // The GLB positions vary; use a generous box approximation
    C.addBox(new V(14, 0, -4),   new V(6, 4, 3));

    /* ── Green tunnel / entry building ───────────────────────────── */
    C.addBox(new V(-32, 0, -18), new V(8, 5, 5));

    /* ── Industrial plant backdrop (approximate box) ─────────────── */
    C.addBox(new V(-10, 0, -22), new V(14, 8, 7));

    /* ── Control / MCP station wall ─────────────────────────────── */
    C.addBox(new V(-28, 0, 10),  new V(3, 3, 2));
  }

  _addCollider(model, def) {
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const shrink = typeof def.shrink === 'number' ? def.shrink : 0.85;

    if (def.type === 'cylinder') {
      const r = def.radius || (Math.max(size.x, size.z) * 0.5 * shrink);
      this._collision.addCylinder(new THREE.Vector3(center.x, 0, center.z), r);
    } else {
      const half = new THREE.Vector3(
        Math.max(0.4, size.x * 0.5 * shrink),
        Math.max(1, size.y * 0.5),
        Math.max(0.4, size.z * 0.5 * shrink),
      );
      this._collision.addBox(new THREE.Vector3(center.x, 0, center.z), half);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     PUBLIC ACCESSORS
     ═══════════════════════════════════════════════════════════ */

  getPositions() {
    return this._positions;
  }

  getPlacedModel(id) {
    return this._placedModels.get(id) || null;
  }

  /* ═══════════════════════════════════════════════════════════
     DISPOSE
     ═══════════════════════════════════════════════════════════ */

  dispose() {
    if (this._factory) {
      this._factory.dispose();
      this._factory = null;
    }

    if (this._instanced) {
      this._instanced.dispose();
      this._instanced = null;
    }

    for (const [, model] of this._placedModels) {
      this._scene.remove(model);
      model.traverse(c => {
        if (c.isMesh) {
          c.geometry?.dispose();
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material?.dispose();
        }
      });
    }
    this._placedModels.clear();
  }
}
