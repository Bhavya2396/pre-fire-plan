import * as THREE from 'three';
import { InstancedWorld } from './InstancedWorld.js';

/**
 * TankFarm — builds the refinery compound modeled after Numaligarh layout.
 *
 * Real-world zoning (looking at the aerial photo):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  NORTH (z < -25): Process area                              │
 *   │    - 2 rows of distillation columns (tight 10m spacing)     │
 *   │    - Heat exchangers flanking columns                       │
 *   │    - Elevated catwalks connecting column tops                │
 *   │    - Steel framework overhead (like green conveyors in pic) │
 *   │    - Overhead pipe runs in color bands                       │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  CENTRAL (z -25..25): Main tank farm (gameplay area)        │
 *   │    - Dyke walls with gates and gate posts                    │
 *   │    - Tank 101-A (-18,0) and 101-B (12,0) on concrete pads  │
 *   │    - Drain channels, ladders, valves, manifold              │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  SOUTH (z 25..60): Roads and emergency staging              │
 *   │    - Road 10 at z=30 (E-W, 8m wide)                        │
 *   │    - Road 12 at z=55 (E-W, 8m wide)                        │
 *   │    - Hydrant stations on south kerbs (z=24, z=49)           │
 *   │    - Control shed at (25, 42)                                │
 *   │    - Fire trucks stage on roads during turnout               │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  EAST (x > 40): Secondary storage + fire station            │
 *   │    - East enclosure with chemical/oil tanks                  │
 *   │    - Fire station building                                   │
 *   │    - Pipe corridor along x=40 (Road 15 east side)           │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  WEST (x < -45): Utilities + maintenance                    │
 *   │    - Warehouses (green-roofed in the photo)                 │
 *   │    - Cooling towers (SW corner)                             │
 *   │    - Workshop building                                       │
 *   │    - Service road at x=-42                                   │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  FAR WEST (x < -85): Flare stack (safety buffer)           │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  PERIMETER: Fence at ±105/±90, trees outside                │
 *   │  GATE: South fence at z=90, gap for main entry              │
 *   │  ADMIN: Gate building at (65,75) near main entry             │
 *   └─────────────────────────────────────────────────────────────┘
 *
 *   Roads:
 *     Road 10: z=30, x∈[-100,100], 8m wide — main perimeter
 *     Road 12: z=55, x∈[-100,100], 8m wide — outer staging
 *     Road 15: x=35, z∈[-75,65], 6m wide  — N-S connector
 *     Service: x=-42, z∈[-55,25], 6m wide  — west utility access
 */
export class TankFarm {
  constructor(scene, loader) {
    this.scene = scene;
    this.loader = loader;
    this.meshes = [];
    this.instanced = new InstancedWorld(scene);
  }

  build() {
    this._buildGround();
    this._buildRoadNetwork();
    this._buildMainDyke();
    this._buildEastEnclosure();
    this._buildWestEnclosure();
    this._buildTankPads();
    this._buildLightPoles();
    this._buildWarnings();
    this._buildDrainChannels();
    this._buildEquipmentShed();
    this._buildTankLadders();
    this._buildBollards();
    this._buildProcessBlock();
    this._buildWarehouseRow();
    this._buildCoolingTowers();
    this._buildFlareStack();
    this._buildPipeRackGrid();
    this._buildSteelFramework();
    this._buildPerimeterFence();
    this._buildTreeLine();
    this._buildBlueBuildings();
    this._buildOverheadPipes();
    this._buildGroundDetails();
  }

  _add(mesh) {
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  _wallMat() {
    const rep = [10, 0.5];
    return new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/concrete_wall_008/Color.jpg', rep),
      normalMap: this.loader.loadTexture('/textures/concrete_wall_008/NormalGL.jpg', rep, false),
      roughnessMap: this.loader.loadTexture('/textures/concrete_wall_008/Roughness.jpg', rep, false),
      roughness: 0.9,
    });
  }

  _concreteMat(rep) {
    return new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/concrete_wall_008/Color.jpg', rep),
      normalMap: this.loader.loadTexture('/textures/concrete_wall_008/NormalGL.jpg', rep, false),
      roughnessMap: this.loader.loadTexture('/textures/concrete_wall_008/Roughness.jpg', rep, false),
      roughness: 0.85,
    });
  }

  _roadMat(rep) {
    return new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/asphalt024/Color.jpg', rep),
      normalMap: this.loader.loadTexture('/textures/asphalt024/NormalGL.jpg', rep, false),
      roughnessMap: this.loader.loadTexture('/textures/asphalt024/Roughness.jpg', rep, false),
      roughness: 0.85, metalness: 0.0,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // GROUND
  // ══════════════════════════════════════════════════════════════

  _buildGround() {
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x1e4a1e, roughness: 0.95, metalness: 0.0,
    });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.04;
    grass.receiveShadow = true;
    this._add(grass);

    // Main compound slab
    const concRep = [18, 15];
    const concMat = new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/concrete033/Color.jpg', concRep),
      normalMap: this.loader.loadTexture('/textures/concrete033/NormalGL.jpg', concRep, false),
      roughnessMap: this.loader.loadTexture('/textures/concrete033/Roughness.jpg', concRep, false),
      roughness: 0.85, metalness: 0.0, color: 0xb0aca6,
    });
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(250, 210), concMat);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(-5, -0.02, -5);
    slab.receiveShadow = true;
    this._add(slab);

    // Gravel inside dyke
    const gravelRep = [10, 8];
    const gravelMat = new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/gravel_floor/Color.jpg', gravelRep),
      normalMap: this.loader.loadTexture('/textures/gravel_floor/NormalGL.jpg', gravelRep, false),
      roughnessMap: this.loader.loadTexture('/textures/gravel_floor/Roughness.jpg', gravelRep, false),
      roughness: 0.95, metalness: 0.0, color: 0xc8bc9a,
    });
    const dykeGravel = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), gravelMat);
    dykeGravel.rotation.x = -Math.PI / 2;
    dykeGravel.position.set(-5, 0.005, 0);
    dykeGravel.receiveShadow = true;
    this._add(dykeGravel);
  }

  // ══════════════════════════════════════════════════════════════
  // ROADS — clear corridors, nothing placed on them
  // ══════════════════════════════════════════════════════════════

  _buildRoadNetwork() {
    const roadMat = this._roadMat([20, 1]);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.7 });
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });

    const roads = [
      { pos: [0, 0.02, 30], w: 200, d: 8, rot: 0 },
      { pos: [0, 0.02, 55], w: 200, d: 8, rot: 0 },
      { pos: [35, 0.02, -5], w: 140, d: 6, rot: Math.PI / 2 },
      { pos: [-42, 0.02, -15], w: 80, d: 6, rot: Math.PI / 2 },
    ];

    roads.forEach(r => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), roadMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = r.rot;
      mesh.position.set(...r.pos);
      mesh.receiveShadow = true;
      this._add(mesh);

      for (const off of [-r.d / 2, r.d / 2]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(r.w, 0.15), edgeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.rotation.z = r.rot;
        if (r.rot) edge.position.set(r.pos[0] + off, 0.03, r.pos[2]);
        else edge.position.set(r.pos[0], 0.03, r.pos[2] + off);
        this._add(edge);
      }
    });

    // Dashed center lines on E-W roads
    roads.filter(r => !r.rot).forEach(r => {
      for (let x = -r.w / 2 + 2; x < r.w / 2; x += 6) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.15), dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(r.pos[0] + x, 0.025, r.pos[2]);
        this._add(dash);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DYKE — main containment (central zone)
  // ══════════════════════════════════════════════════════════════

  _buildMainDyke() {
    const mat = this._wallMat();
    const wallH = 1.8, th = 0.6;

    const wallSegs = [
      { pos: [-29.75, wallH / 2, -25], size: [20.5, wallH, th] },
      { pos: [-5, wallH / 2, -25], size: [19.0, wallH, th] },
      { pos: [19.75, wallH / 2, -25], size: [20.5, wallH, th] },
      { pos: [-29.75, wallH / 2, 25], size: [20.5, wallH, th] },
      { pos: [-5, wallH / 2, 25], size: [19.0, wallH, th] },
      { pos: [19.75, wallH / 2, 25], size: [20.5, wallH, th] },
      { pos: [-40, wallH / 2, -17.75], size: [th, wallH, 14.5] },
      { pos: [-40, wallH / 2, 0], size: [th, wallH, 11.0] },
      { pos: [-40, wallH / 2, 17.75], size: [th, wallH, 14.5] },
      { pos: [30, wallH / 2, -17.75], size: [th, wallH, 14.5] },
      { pos: [30, wallH / 2, 0], size: [th, wallH, 11.0] },
      { pos: [30, wallH / 2, 17.75], size: [th, wallH, 14.5] },
    ];

    wallSegs.forEach(wl => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...wl.size), mat);
      mesh.position.set(...wl.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this._add(mesh);
    });

    this._buildGatePosts([
      { x: -19.5, z: -25 }, { x: -14.5, z: -25 },
      { x: 4.5, z: -25 }, { x: 9.5, z: -25 },
      { x: -19.5, z: 25 }, { x: -14.5, z: 25 },
      { x: 4.5, z: 25 }, { x: 9.5, z: 25 },
      { x: -40, z: -10.5 }, { x: -40, z: -5.5 },
      { x: -40, z: 5.5 }, { x: -40, z: 10.5 },
      { x: 30, z: -10.5 }, { x: 30, z: -5.5 },
      { x: 30, z: 5.5 }, { x: 30, z: 10.5 },
    ], wallH);

    const floorMat = this._concreteMat([12, 8]);
    const dykeFloor = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), floorMat);
    dykeFloor.rotation.x = -Math.PI / 2;
    dykeFloor.position.set(-5, 0.03, 0);
    dykeFloor.receiveShadow = true;
    this._add(dykeFloor);
  }

  _buildEastEnclosure() { this._buildSimpleEnclosure(55, 0, 30, 36); }
  _buildWestEnclosure() { this._buildSimpleEnclosure(-58, -38, 26, 30); }

  _buildSimpleEnclosure(cx, cz, hw, hd) {
    const mat = this._wallMat();
    const wallH = 1.5, th = 0.5;
    const walls = [
      { pos: [cx, wallH / 2, cz - hd / 2], size: [hw, wallH, th] },
      { pos: [cx, wallH / 2, cz + hd / 2], size: [hw, wallH, th] },
      { pos: [cx - hw / 2, wallH / 2, cz], size: [th, wallH, hd] },
      { pos: [cx + hw / 2, wallH / 2, cz], size: [th, wallH, hd] },
    ];
    walls.forEach(wl => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...wl.size), mat);
      mesh.position.set(...wl.pos);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this._add(mesh);
    });
    const floorMat = this._concreteMat([6, 6]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(hw, hd), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.025, cz);
    floor.receiveShadow = true;
    this._add(floor);
  }

  _buildGatePosts(positions, wallH) {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0xff6b1a, emissive: 0xff3300, emissiveIntensity: 0.25,
      roughness: 0.4, metalness: 0.3,
    });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
    positions.forEach(g => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, wallH + 0.6, 6), postMat);
      post.position.set(g.x, (wallH + 0.6) / 2, g.z);
      post.castShadow = true;
      this._add(post);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.12, 6), stripeMat);
      band.position.set(g.x, 1.2, g.z);
      this._add(band);
    });
  }

  _buildTankPads() {
    const mat = this._concreteMat([4, 4]);
    [[-18, 0], [12, 0]].forEach(([x, z]) => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 0.35, 48), mat);
      pad.position.set(x, 0.18, z);
      pad.receiveShadow = true;
      this._add(pad);
    });
  }

  _buildLightPoles() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.7 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffddaa, emissive: 0xffaa44, emissiveIntensity: 0.4 });
    const positions = [
      [-50, 26], [0, 26], [50, 26],
      [-50, 49], [0, 49], [50, 49],
      [-42, -25], [32, -25], [-42, 25], [32, 25],
      [55, -10], [55, 10],
      [-58, -28], [-58, -48],
      [39, -30], [39, 65],
    ];
    this.instanced.createLightPoles(positions, poleMat, lightMat);
  }

  _buildWarnings() {
    const signMat = new THREE.MeshStandardMaterial({
      color: 0x222222, roughness: 0.3, metalness: 0.2,
      emissive: 0xff6b1a, emissiveIntensity: 0.08,
    });
    const dangerMat = new THREE.MeshStandardMaterial({
      color: 0xcc0000, roughness: 0.3,
      emissive: 0xff0000, emissiveIntensity: 0.06,
    });
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x225522, roughness: 0.4,
      emissive: 0x113311, emissiveIntensity: 0.05,
    });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.5 });
    const signs = [
      { pos: [-15, 26], mat: signMat },
      { pos: [-25, 26], mat: signMat },
      { pos: [18, 51], mat: signMat },
      { pos: [-40, 26], mat: dangerMat },
      { pos: [30, 26], mat: dangerMat },
      { pos: [-40, -26], mat: dangerMat },
      { pos: [-18, 15], mat: signMat },
      { pos: [12, 15], mat: signMat },
      { pos: [39, 26], mat: roadMat },
      { pos: [39, 49], mat: roadMat },
      { pos: [39, -55], mat: roadMat },
      { pos: [55, -10], mat: signMat },
      { pos: [55, 10], mat: signMat },
      { pos: [-58, -30], mat: signMat },
    ];
    signs.forEach(s => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6), poleMat);
      pole.position.set(s.pos[0], 1.25, s.pos[1]);
      pole.castShadow = true;
      this._add(pole);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.04), s.mat);
      sign.position.set(s.pos[0], 2.4, s.pos[1]);
      this._add(sign);
    });
  }

  _buildDrainChannels() {
    const drainMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.1 });
    const channels = [
      { from: [-18, 0], to: [-18, 24] },
      { from: [12, 0], to: [12, 24] },
      { from: [-5, -8], to: [-5, 24] },
    ];
    channels.forEach(ch => {
      const dx = ch.to[0] - ch.from[0];
      const dz = ch.to[1] - ch.from[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const channel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, len), drainMat);
      channel.position.set(
        (ch.from[0] + ch.to[0]) / 2, -0.05,
        (ch.from[1] + ch.to[1]) / 2
      );
      channel.rotation.y = angle;
      this._add(channel);
    });
  }

  _buildEquipmentShed() {
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/rusty_metal_grid/Color.jpg', [3, 2]),
      normalMap: this.loader.loadTexture('/textures/rusty_metal_grid/NormalGL.jpg', [3, 2], false),
      roughnessMap: this.loader.loadTexture('/textures/rusty_metal_grid/Roughness.jpg', [3, 2], false),
      metalness: 0.5, roughness: 0.6,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.6 });
    const sx = 25, sz = 42, sw = 6, sd = 4, sh = 3;
    this._add(new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.1), wallMat)).position.set(sx, sh / 2, sz - sd / 2);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(0.1, sh, sd), wallMat)).position.set(sx - sw / 2, sh / 2, sz);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(0.1, sh, sd), wallMat)).position.set(sx + sw / 2, sh / 2, sz);
    this._add(new THREE.Mesh(new THREE.BoxGeometry(sw + 0.4, 0.1, sd + 0.4), roofMat)).position.set(sx, sh, sz);
  }

  _buildTankLadders() {
    const ladderMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.7 });
    const tankHeight = 10;
    [[-18, 0], [12, 0]].forEach(([tx, tz]) => {
      const x = tx + 10;
      this._add(new THREE.Mesh(new THREE.BoxGeometry(0.05, tankHeight, 0.05), ladderMat)).position.set(x - 0.2, tankHeight / 2, tz);
      this._add(new THREE.Mesh(new THREE.BoxGeometry(0.05, tankHeight, 0.05), ladderMat)).position.set(x + 0.2, tankHeight / 2, tz);
      for (let y = 0.5; y < tankHeight; y += 0.35) {
        this._add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), ladderMat)).position.set(x, y, tz);
      }
    });
  }

  _buildBollards() {
    // At dyke gates and road edges — NOT on the road surface
    this.instanced.createBollards([
      [-40, 26], [-40, 35], [30, 26], [30, 35],
      [-15, 26], [-15, 35], [7, 26], [7, 35],
      [31, 26], [31, 35], [31, 49], [31, 60],
    ]);
  }

  // ══════════════════════════════════════════════════════════════
  // GLB helper
  // ══════════════════════════════════════════════════════════════

  _spawnGLB(name, pos, scale, rotY = 0) {
    const model = this.loader.getModel(name);
    if (!model) return null;
    if (typeof scale === 'number') model.scale.setScalar(scale);
    else model.scale.set(scale[0], scale[1], scale[2]);
    model.rotation.y = rotY;
    model.traverse(c => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    model.position.set(pos[0], pos[1], pos[2]);
    const box = new THREE.Box3().setFromObject(model);
    if (box.min.y < -0.01) model.position.y -= box.min.y;
    this._add(model);
    return model;
  }

  // ══════════════════════════════════════════════════════════════
  // NORTH — Process block (z = -30 to -65)
  // Tightly packed like Numaligarh photo — columns in 2x3 grid
  // with heat exchangers on both flanks and catwalks overhead
  // ══════════════════════════════════════════════════════════════

  _buildProcessBlock() {
    const cols = [
      [-55, 0, -50], [-44, 0, -50], [-33, 0, -50],
      [-55, 0, -38], [-44, 0, -38], [-33, 0, -38],
    ];
    cols.forEach(([x, y, z], i) => {
      this._spawnGLB('distillation_column', [x, y, z], 0.08, (i % 2) * Math.PI);
    });
    [[-65, 0, -48], [-65, 0, -38], [-22, 0, -48], [-22, 0, -38]].forEach(([x, y, z], i) => {
      this._spawnGLB('heat_exchanger', [x, y, z], 0.025, i < 2 ? Math.PI / 2 : -Math.PI / 2);
    });
    [[-48, 0, -44], [-37, 0, -44], [-48, 0, -50]].forEach(([x, y, z], i) => {
      this._spawnGLB('catwalk', [x, y, z], 0.03, i === 2 ? Math.PI / 2 : 0);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // WEST — Warehouses (like the green buildings in the photo)
  // ══════════════════════════════════════════════════════════════

  _buildWarehouseRow() {
    [[-75, 0, -65], [-50, 0, -65], [-25, 0, -70], [0, 0, -70]].forEach(([x, y, z], i) => {
      this._spawnGLB('warehouse', [x, y, z], 0.12, (i % 2) ? Math.PI : 0);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // WEST — Cooling towers (SW corner, away from process)
  // ══════════════════════════════════════════════════════════════

  _buildCoolingTowers() {
    [[-72, 0, 62], [-72, 0, 78], [-58, 0, 70]].forEach(([x, y, z]) => {
      this._spawnGLB('cooling_tower', [x, y, z], 0.06);
      const vMat = new THREE.MeshStandardMaterial({
        color: 0x8899aa, transparent: true, opacity: 0.15, roughness: 0.95,
      });
      const vapor = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), vMat);
      vapor.position.set(x, 18, z);
      this._add(vapor);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // FAR WEST — Flare stack (max safety distance)
  // ══════════════════════════════════════════════════════════════

  _buildFlareStack() {
    const matW = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.6 });
    const matR = new THREE.MeshStandardMaterial({ color: 0xbb2222, roughness: 0.55, metalness: 0.6 });
    const x = -95, z = -20;
    for (let i = 0; i < 8; i++) {
      const r = 0.8 - i * 0.05;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.05, 6, 16), i % 2 ? matR : matW);
      seg.position.set(x, 3 + i * 6, z);
      seg.castShadow = true;
      this._add(seg);
    }
    const flameMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff6622, emissiveIntensity: 1.2, roughness: 0.9,
    });
    this._add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 10), flameMat)).position.set(x, 52, z);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff1100, emissiveIntensity: 0.8,
    });
    this._add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), beaconMat)).position.set(x + 1.2, 28, z);
    const flareLight = new THREE.PointLight(0xff6622, 0.5, 60, 2);
    flareLight.position.set(x, 53, z);
    this.scene.add(flareLight);
    this.meshes.push(flareLight);
  }

  // ══════════════════════════════════════════════════════════════
  // PIPE RACK CORRIDORS — along zone boundaries, NOT on roads
  // ══════════════════════════════════════════════════════════════

  _buildPipeRackGrid() {
    const racks = [
      // E-W south of warehouses
      [-60, -72], [-48, -72], [-36, -72], [-24, -72], [-12, -72], [0, -72],
      // E-W process → dyke transition
      [-60, -28], [-48, -28], [-36, -28], [-24, -28], [-12, -28], [0, -28],
      // N-S east corridor (east side of Road 15, x=40)
      [42, -60], [42, -45], [42, -30], [42, -15], [42, 0], [42, 15],
      // N-S west corridor
      [-68, -10], [-68, 5], [-68, 20], [-68, 35],
    ];
    racks.forEach(([x, z]) => {
      const isNS = (x === 42 || x === -68);
      this._spawnGLB('pipe_rack', [x, 0, z], 0.04, isNS ? Math.PI / 2 : 0);
    });
  }

  _buildSteelFramework() {
    this.instanced.createSteelFramework(-44, -44, 44, 24, 18);
  }

  // ══════════════════════════════════════════════════════════════
  // PERIMETER
  // ══════════════════════════════════════════════════════════════

  _buildPerimeterFence() {
    this.instanced.createFencePosts(105, 2.2);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.55, metalness: 0.6 });
    for (const [x, z, w, d] of [
      [0, -90, 210, 0.05], [0, 90, 210, 0.05],
      [-105, 0, 0.05, 180], [105, 0, 0.05, 180],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), postMat);
      rail.position.set(x, 2.1, z);
      this._add(rail);
    }
    for (const dx of [-10, 10]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.5, 0.5), postMat);
      p.position.set(dx, 1.75, 90);
      p.castShadow = true;
      this._add(p);
    }
    const fenceMat = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.6, metalness: 0.5,
      transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    });
    for (const [x, z, w, d] of [
      [0, -90, 210, 0.05], [0, 90, 210, 0.05],
      [-105, 0, 0.05, 180], [105, 0, 0.05, 180],
    ]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, d), 2.0), fenceMat);
      panel.position.set(x, 1.1, z);
      if (d > w) panel.rotation.y = Math.PI / 2;
      this._add(panel);
    }
  }

  _buildTreeLine() {
    this.instanced.createTreeLine(115);
  }

  // ══════════════════════════════════════════════════════════════
  // BUILDINGS — zoned by function per Numaligarh layout
  //   Admin/gate: south near entry (65, 75)
  //   Workshop: west near utilities (-78, -15)
  //   Fire station: east near secondary storage (60, -50)
  // ══════════════════════════════════════════════════════════════

  _buildBlueBuildings() {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2e5c8c, roughness: 0.6, metalness: 0.4 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
    const builds = [
      { x: 65, z: 75, w: 16, d: 10, h: 7 },
      { x: -78, z: -15, w: 14, d: 16, h: 10 },
      { x: 60, z: -50, w: 18, d: 14, h: 8 },
    ];
    builds.forEach(b => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), wallMat);
      body.position.set(b.x, b.h / 2, b.z);
      body.castShadow = true; body.receiveShadow = true;
      this._add(body);
      for (let s = 1; s <= 3; s++) {
        for (const sign of [1, -1]) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(b.w - 1, 0.4, 0.06), stripeMat);
          stripe.position.set(b.x, (s / 4) * b.h, b.z + sign * (b.d / 2 + 0.04));
          this._add(stripe);
        }
      }
      const ductMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.55, metalness: 0.65 });
      for (let k = 0; k < 2; k++) {
        const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 10), ductMat);
        duct.position.set(b.x + (k - 0.5) * 2, b.h + 0.5, b.z);
        this._add(duct);
      }
    });
  }

  _buildOverheadPipes() {
    this.instanced.createOverheadPipes(-44, -44);
  }

  // ══════════════════════════════════════════════════════════════
  // GROUND DETAILS — extra density like the Numaligarh photo
  // Small procedural items that fill empty spaces
  // ══════════════════════════════════════════════════════════════

  _buildGroundDetails() {
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5, metalness: 0.7 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xddcc22, roughness: 0.4, metalness: 0.3 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x336633, roughness: 0.5, metalness: 0.4 });

    // Ground-level pipe runs between dyke and roads (z = 25..26)
    for (let x = -35; x <= 25; x += 8) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(x, 0.3, 26);
      this._add(pipe);
    }

    // Cable trays along service road (west side)
    for (let z = -50; z <= 20; z += 10) {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 8), pipeMat);
      tray.position.set(-47, 3.0, z);
      this._add(tray);
    }

    // Safety barriers at road intersections (yellow)
    const barrierGeo = new THREE.BoxGeometry(3, 0.8, 0.15);
    [
      { x: -10, z: 26, rot: 0 }, { x: 20, z: 26, rot: 0 },
      { x: -10, z: 35, rot: 0 }, { x: 20, z: 35, rot: 0 },
      { x: 32, z: 26, rot: Math.PI / 2 }, { x: 32, z: 35, rot: Math.PI / 2 },
    ].forEach(b => {
      const barrier = new THREE.Mesh(barrierGeo, yellowMat);
      barrier.position.set(b.x, 0.4, b.z);
      barrier.rotation.y = b.rot;
      this._add(barrier);
    });

    // Transformer pad (green box) — utilities zone
    const txMat = new THREE.MeshStandardMaterial({ color: 0x336644, roughness: 0.6, metalness: 0.5 });
    const transformer = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 2), txMat);
    transformer.position.set(-70, 1.25, 40);
    transformer.castShadow = true;
    this._add(transformer);

    // Generator set near workshop
    const genMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.6 });
    const gen = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2.5), genMat);
    gen.position.set(-80, 1, -30);
    gen.castShadow = true;
    this._add(gen);

    // Water tank (elevated) near cooling towers
    const waterTankMat = new THREE.MeshStandardMaterial({ color: 0x4477aa, roughness: 0.4, metalness: 0.5 });
    const wtank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 16), waterTankMat);
    wtank.position.set(-65, 8, 55);
    wtank.castShadow = true;
    this._add(wtank);
    // Legs
    for (let a = 0; a < 4; a++) {
      const angle = (a / 4) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6), pipeMat);
      leg.position.set(-65 + Math.cos(angle) * 2.5, 3, 55 + Math.sin(angle) * 2.5);
      this._add(leg);
    }

    // Shipping containers near gate/admin area (z=65..70)
    const contMat1 = new THREE.MeshStandardMaterial({ color: 0xcc4422, roughness: 0.6, metalness: 0.4 });
    const contMat2 = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.6, metalness: 0.4 });
    [
      { x: 75, z: 62, mat: contMat1 },
      { x: 78, z: 62, mat: contMat2 },
      { x: 75, z: 66, mat: contMat2 },
    ].forEach(c => {
      const cont = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 6), c.mat);
      cont.position.set(c.x, 1.3, c.z);
      cont.castShadow = true;
      this._add(cont);
    });
  }

  dispose() {
    this.meshes.forEach(m => {
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mt => mt.dispose());
      }
      this.scene.remove(m);
    });
    this.meshes = [];
    this.instanced.dispose();
  }
}
