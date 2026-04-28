import * as THREE from 'three';

export default class ProceduralFactory {
  constructor(scene, assetManager) {
    this._scene = scene;
    this._assets = assetManager;
    this.meshes = [];
  }

  /* ─── helpers ──────────────────────────────────────────── */

  _add(mesh) {
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this._scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  _addFlat(mesh) {
    mesh.receiveShadow = true;
    this._scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, ...opts });
  }

  /* Yellow centerline dash material — built once, reused across all
     EW roads. The texture is a 2-pixel strip (1 yellow, 1 transparent)
     that tiles `repeats` times along the road. Drops the road dash
     count from ~22 separate Mesh+Plane pairs per road to a SINGLE
     textured plane. */
  _dashStripMat() {
    if (this._dashStripMatCache) return this._dashStripMatCache;
    const c = document.createElement('canvas');
    c.width = 2; c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(0, 0, 1, 1);
    // Pixel 1 left transparent (default canvas state).
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._dashStripMatCache = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.6, transparent: true, alphaTest: 0.5,
    });
    return this._dashStripMatCache;
  }

  _texMat(basePath, repeat, extras = {}) {
    const r = { x: repeat[0], y: repeat[1] };
    const map = this._assets.loadTexture(`${basePath}Color.jpg`, r, true);
    const opts = { map, ...extras };

    const nrmPath = `${basePath}NormalGL.jpg`;
    const nrm = this._assets.loadTexture(nrmPath, r, false);
    if (nrm) opts.normalMap = nrm;

    const roughPath = `${basePath}Roughness.jpg`;
    const rough = this._assets.loadTexture(roughPath, r, false);
    if (rough) opts.roughnessMap = rough;

    return new THREE.MeshStandardMaterial(opts);
  }

  /* ═══════════════════════════════════════════════════════════
     1. GROUND
     ═══════════════════════════════════════════════════════════ */

  buildGround() {
    const grassMat = this._mat(0x3a7d44, { roughness: 0.95 });
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      grassMat,
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.05;
    this._addFlat(grass);

    const concreteMat = this._texMat(
      '/textures/concrete033/',
      [9, 7],
    );
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 140),
      concreteMat,
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(-5, -0.02, 0);
    this._addFlat(slab);

    const gravelMat = this._texMat(
      '/textures/gravel_floor/',
      [8, 6],
      { roughness: 0.9 },
    );
    const gravel = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 50),
      gravelMat,
    );
    gravel.rotation.x = -Math.PI / 2;
    gravel.position.set(-5, 0.005, 0);
    this._addFlat(gravel);
  }

  /* ═══════════════════════════════════════════════════════════
     2. ROADS
     ═══════════════════════════════════════════════════════════ */

  buildRoads() {
    const asphaltMat = this._texMat(
      '/textures/asphalt024/',
      [20, 2],
      { roughness: 0.85 },
    );
    const lineMat = this._mat(0xffffff, { roughness: 0.6 });
    const dashMat = this._mat(0xffcc00, { roughness: 0.6 });

    const roads = [
      { name: 'Road 10',  cx: 0,   cz: 30, w: 130, d: 8,  dir: 'EW' },
      { name: 'Road 12',  cx: 0,   cz: 55, w: 130, d: 8,  dir: 'EW' },
      { name: 'Road 15',  cx: 35,  cz: 0,  w: 6,   d: 100, dir: 'NS' },
      { name: 'Service',  cx: -42, cz: 0,  w: 6,   d: 80,  dir: 'NS' },
    ];

    for (const r of roads) {
      const roadMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(r.w, r.d),
        asphaltMat,
      );
      roadMesh.rotation.x = -Math.PI / 2;
      roadMesh.position.set(r.cx, 0.01, r.cz);
      this._addFlat(roadMesh);

      if (r.dir === 'EW') {
        const halfD = r.d / 2;

        for (const side of [-1, 1]) {
          const edge = new THREE.Mesh(
            new THREE.PlaneGeometry(r.w, 0.15),
            lineMat,
          );
          edge.rotation.x = -Math.PI / 2;
          edge.position.set(r.cx, 0.015, r.cz + side * halfD);
          this._addFlat(edge);
        }

        /* Centerline dashes used to be ~22 separate Mesh+Plane pairs
           per road. We collapse them into ONE strip mesh whose UVs
           tile a 2-pixel "dash + gap" texture: 1 draw call instead of
           ~22 across the two EW roads. */
        const dashLen = 3, gapLen = 3;
        const period = dashLen + gapLen;
        const repeats = Math.floor(r.w / period);
        const stripMat = this._dashStripMat();
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(r.w, 0.15),
          stripMat,
        );
        strip.material.map.repeat.set(repeats, 1);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(r.cx, 0.015, r.cz);
        this._addFlat(strip);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     3. DYKE (main bund wall enclosure)
     ═══════════════════════════════════════════════════════════ */

  buildDyke() {
    const wallMat = this._texMat(
      '/textures/concrete_wall_008/',
      [6, 1],
      { roughness: 0.8 },
    );
    const H = 1.8, T = 0.6;
    const xMin = -40, xMax = 30, zMin = -25, zMax = 25;
    const gateGap = 5;

    const wallSegments = [
      // south wall — two segments with gap for south gate
      { cx: (xMin + (xMin + xMax) / 2 - gateGap / 2) / 2,
        cz: zMax + T / 2,
        w: (xMax - xMin) / 2 - gateGap / 2,
        d: T },
      { cx: ((xMin + xMax) / 2 + gateGap / 2 + xMax) / 2,
        cz: zMax + T / 2,
        w: (xMax - xMin) / 2 - gateGap / 2,
        d: T },
      // north wall — solid
      { cx: (xMin + xMax) / 2, cz: zMin - T / 2, w: xMax - xMin + T, d: T },
      // west wall — two segments with gap
      { cx: xMin - T / 2, cz: (zMin + (zMin + zMax) / 2 - gateGap / 2) / 2,
        w: T,
        d: (zMax - zMin) / 2 - gateGap / 2 },
      { cx: xMin - T / 2, cz: ((zMin + zMax) / 2 + gateGap / 2 + zMax) / 2,
        w: T,
        d: (zMax - zMin) / 2 - gateGap / 2 },
      // east wall — solid
      { cx: xMax + T / 2, cz: (zMin + zMax) / 2, w: T, d: zMax - zMin + T },
    ];

    for (const seg of wallSegments) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(seg.w, H, seg.d),
        wallMat,
      );
      wall.position.set(seg.cx, H / 2, seg.cz);
      this._add(wall);
    }

    this._buildGatePosts(xMin, (zMin + zMax) / 2, H);
    this._buildGatePosts((xMin + xMax) / 2, zMax + T / 2, H);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(xMax - xMin, zMax - zMin),
      wallMat.clone(),
    );
    floor.material.color.set(0x999999);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((xMin + xMax) / 2, 0.005, (zMin + zMax) / 2);
    this._addFlat(floor);
  }

  _buildGatePosts(cx, cz, height) {
    // Standard road safety post — yellow + black (less neon)
    const postMat = this._mat(0xc8a418, { roughness: 0.55, metalness: 0.3 });
    const stripeMat = this._mat(0x1b1b1b, { roughness: 0.6 });
    const spacing = 2.5;

    for (const offset of [-spacing, spacing]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, height, 8),
        postMat,
      );
      post.position.set(cx + offset, height / 2, cz);
      this._add(post);

      for (let y = 0.3; y < height; y += 0.5) {
        const stripe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8),
          stripeMat,
        );
        stripe.position.set(cx + offset, y, cz);
        this._add(stripe);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     4. SECONDARY ENCLOSURES
     ═══════════════════════════════════════════════════════════ */

  buildEnclosures() {
    const wallMat = this._texMat(
      '/textures/concrete_wall_008/',
      [4, 1],
      { roughness: 0.8 },
    );
    // West tank cluster enclosure (small chemical tanks at x=-55)
    this._buildRectEnclosure(-55, 0, 12, 22, 1.4, wallMat);
    // East process enclosure (oil tank + light tower)
    this._buildRectEnclosure(50, -5, 12, 18, 1.4, wallMat);
  }

  _buildRectEnclosure(cx, cz, w, d, h, mat) {
    const T = 0.5;
    const walls = [
      { px: cx, pz: cz - d / 2 - T / 2, gw: w + T, gd: T },
      { px: cx, pz: cz + d / 2 + T / 2, gw: w + T, gd: T },
      { px: cx - w / 2 - T / 2, pz: cz, gw: T, gd: d },
      { px: cx + w / 2 + T / 2, pz: cz, gw: T, gd: d },
    ];
    for (const s of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.gw, h, s.gd), mat);
      m.position.set(s.px, h / 2, s.pz);
      this._add(m);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     5. TANK PADS
     ═══════════════════════════════════════════════════════════ */

  buildTankPads() {
    const padMat = this._mat(0xbbbbbb, { roughness: 0.7 });
    const pads = [
      { cx: -15, cz: -5, r: 8 },
      { cx: 12,  cz: -5, r: 6 },
    ];
    for (const p of pads) {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(p.r, p.r, 0.3, 48),
        padMat,
      );
      pad.position.set(p.cx, 0.15, p.cz);
      this._add(pad);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     6. DRAIN CHANNELS
     ═══════════════════════════════════════════════════════════ */

  buildDrainChannels() {
    const mat = this._mat(0x666666, { roughness: 0.9, metalness: 0.1 });
    const channels = [
      { from: [-15, -5], to: [-15, 24], w: 0.5, depth: 0.3 },
      { from: [12, -5],  to: [12, 24],  w: 0.5, depth: 0.3 },
      { from: [-15, 24], to: [12, 24],  w: 0.5, depth: 0.3 },
    ];
    for (const ch of channels) {
      const dx = ch.to[0] - ch.from[0];
      const dz = ch.to[1] - ch.from[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const drain = new THREE.Mesh(
        new THREE.BoxGeometry(ch.w, ch.depth, len),
        mat,
      );
      drain.position.set(
        (ch.from[0] + ch.to[0]) / 2,
        -ch.depth / 2 + 0.01,
        (ch.from[1] + ch.to[1]) / 2,
      );
      drain.rotation.y = angle;
      this._add(drain);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     7. EQUIPMENT SHED
     ═══════════════════════════════════════════════════════════ */

  buildEquipmentShed() {
    const W = 6, D = 4, H = 3;
    const cx = 25, cz = 42;
    const frameMat = this._mat(0x555555, { roughness: 0.4, metalness: 0.8 });
    const gridMat = this._mat(0x888888, {
      roughness: 0.5, metalness: 0.6,
      transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    });
    const roofMat = this._mat(0x777777, { roughness: 0.5, metalness: 0.6 });

    // corner posts
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, H, 6);
    for (const dx of [-W / 2, W / 2]) {
      for (const dz of [-D / 2, D / 2]) {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(cx + dx, H / 2, cz + dz);
        this._add(post);
      }
    }

    // grid walls — 4 sides (skip one short side for entry)
    const wallPanels = [
      { w: W, d: 0.02, px: cx, pz: cz - D / 2 },
      { w: W, d: 0.02, px: cx, pz: cz + D / 2 },
      { w: 0.02, d: D, px: cx + W / 2, pz: cz },
    ];
    for (const p of wallPanels) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(p.w, H * 0.8, p.d),
        gridMat,
      );
      panel.position.set(p.px, H * 0.45, p.pz);
      this._add(panel);
    }

    // roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.4, 0.08, D + 0.4),
      roofMat,
    );
    roof.position.set(cx, H, cz);
    this._add(roof);
  }

  /* ═══════════════════════════════════════════════════════════
     8. TANK LADDERS
     ═══════════════════════════════════════════════════════════ */

  buildTankLadders() {
    const ladderMat = this._mat(0x888888, { roughness: 0.4, metalness: 0.7 });
    const tanks = [
      { cx: -15, cz: -5, r: 6, h: 12 },
      { cx: 12,  cz: -5, r: 5, h: 10 },
    ];

    for (const t of tanks) {
      const rungSpacing = 0.35;
      const rungs = Math.floor(t.h / rungSpacing);
      const railGeo = new THREE.BoxGeometry(0.06, t.h, 0.06);
      const rungGeo = new THREE.BoxGeometry(0.5, 0.04, 0.06);

      for (const side of [-0.25, 0.25]) {
        const rail = new THREE.Mesh(railGeo, ladderMat);
        rail.position.set(t.cx + t.r + 0.1 + side, t.h / 2, t.cz);
        this._add(rail);
      }

      for (let i = 0; i < rungs; i++) {
        const rung = new THREE.Mesh(rungGeo, ladderMat);
        rung.position.set(
          t.cx + t.r + 0.1,
          i * rungSpacing + 0.2,
          t.cz,
        );
        this._add(rung);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     9. FLARE STACK
     ═══════════════════════════════════════════════════════════ */

  buildFlareStack() {
    const cx = -55, cz = -45;
    const segmentH = 5;
    const segments = 7;
    const white = this._mat(0xffffff, { roughness: 0.4, metalness: 0.5 });
    const red = this._mat(0xcc0000, { roughness: 0.4, metalness: 0.5 });

    for (let i = 0; i < segments; i++) {
      const topR = 0.6 - i * 0.04;
      const botR = 0.6 - (i > 0 ? (i - 1) * 0.04 : 0);
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(topR, botR, segmentH, 12),
        i % 2 === 0 ? white : red,
      );
      seg.position.set(cx, segmentH / 2 + i * segmentH, cz);
      this._add(seg);
    }

    const totalH = segments * segmentH;

    // flame sphere
    const flameMat = this._mat(0xff6600, {
      emissive: 0xff4400,
      emissiveIntensity: 2.0,
      roughness: 1,
    });
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 16, 12),
      flameMat,
    );
    flame.position.set(cx, totalH + 1.5, cz);
    this._add(flame);

    // beacon light (smaller sphere above flame)
    const beaconMat = this._mat(0xff0000, {
      emissive: 0xff0000,
      emissiveIntensity: 3.0,
    });
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      beaconMat,
    );
    beacon.position.set(cx, totalH + 4, cz);
    this._add(beacon);

    const flareLight = new THREE.PointLight(0xff6600, 5, 80);
    flareLight.position.set(cx, totalH + 2, cz);
    this._scene.add(flareLight);
    this.meshes.push(flareLight);
  }

  /* ═══════════════════════════════════════════════════════════
     10. BLUE BUILDINGS
     ═══════════════════════════════════════════════════════════ */

  buildBlueBuildings() {
    const buildings = [
      { name: 'Admin',        cx: 50,  cz: 70,  w: 14, d: 10, h: 6 },
      { name: 'Fire Station', cx: 45,  cz: -45, w: 16, d: 12, h: 7 },
    ];

    const blueMat = this._mat(0x2255aa, { roughness: 0.6 });
    const stripeMat = this._mat(0xeeeeee, { roughness: 0.6 });
    const roofMat = this._mat(0x555555, { roughness: 0.4, metalness: 0.6 });

    for (const b of buildings) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        blueMat,
      );
      body.position.set(b.cx, b.h / 2, b.cz);
      this._add(body);

      // white horizontal stripes (two bands)
      for (const yFrac of [0.35, 0.7]) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(b.w + 0.02, 0.2, b.d + 0.02),
          stripeMat,
        );
        stripe.position.set(b.cx, b.h * yFrac, b.cz);
        this._add(stripe);
      }

      // roof
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.6, 0.15, b.d + 0.6),
        roofMat,
      );
      roof.position.set(b.cx, b.h + 0.075, b.cz);
      this._add(roof);

      // roof ducts (2 per building)
      const ductMat = this._mat(0x777777, { roughness: 0.5, metalness: 0.5 });
      for (const dx of [-b.w * 0.25, b.w * 0.25]) {
        const duct = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 0.8, 0.8),
          ductMat,
        );
        duct.position.set(b.cx + dx, b.h + 0.5, b.cz);
        this._add(duct);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     11. GROUND DETAILS
     ═══════════════════════════════════════════════════════════ */

  buildGroundDetails() {
    // Numaligarh palette: raw galvanized pipework + occasional yellow safety
    // marking (handrails). No bright cartoon colors anywhere.
    const pipeMat = this._mat(0xb5b8bb, { roughness: 0.45, metalness: 0.85 });
    const insulMat = this._mat(0x9a9a96, { roughness: 0.7, metalness: 0.2 });
    const yellowMat = this._mat(0xc8a418, { roughness: 0.55, metalness: 0.3 });
    const darkMat = this._mat(0x3a3a3a, { roughness: 0.6, metalness: 0.4 });

    // Long ground-level pipe runs (galvanized steel + occasional insulated section).
    const pipeRuns = [
      { cx: -25, cz: 12,  len: 24, mat: pipeMat },
      { cx: -5,  cz: 12,  len: 24, mat: insulMat, r: 0.2 },
      { cx: 15,  cz: 12,  len: 24, mat: pipeMat },
      { cx: -5,  cz: -15, len: 24, mat: pipeMat },
      { cx: 15,  cz: -15, len: 24, mat: insulMat, r: 0.18 },
    ];
    for (const p of pipeRuns) {
      const r = p.r || 0.15;
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, p.len, 12),
        p.mat,
      );
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(p.cx, 0.25, p.cz);
      this._add(pipe);

      // pipe support saddles every 4m
      const saddleMat = this._mat(0x6e6e70, { roughness: 0.7, metalness: 0.4 });
      for (let i = -1; i <= 1; i++) {
        const saddle = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.4, 0.5),
          saddleMat,
        );
        saddle.position.set(p.cx + i * 6, 0.05, p.cz);
        this._add(saddle);
      }
    }

    // Cable trays (dark perforated steel — no color)
    const trayGeo = new THREE.BoxGeometry(30, 0.1, 0.6);
    for (const z of [15, -18]) {
      const tray = new THREE.Mesh(trayGeo, darkMat);
      tray.position.set(-5, 0.5, z);
      this._add(tray);
    }

    // Yellow safety handrails — toned down ochre, less saturated
    const railPostGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6);
    const railBarGeo = new THREE.BoxGeometry(8, 0.06, 0.06);
    const barrierPositions = [
      { cx: -5, cz: 20, len: 10 },
      { cx: 30, cz: 0, len: 8 },
    ];
    for (const bp of barrierPositions) {
      for (const dx of [-bp.len / 2, 0, bp.len / 2]) {
        const post = new THREE.Mesh(railPostGeo, yellowMat);
        post.position.set(bp.cx + dx, 0.5, bp.cz);
        this._add(post);
      }
      const rail = new THREE.Mesh(railBarGeo, yellowMat);
      rail.position.set(bp.cx, 0.85, bp.cz);
      this._add(rail);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     12. NUMALIGARH-STYLE GREEN-CLAD SHEDS + LPG SPHERE
     ═══════════════════════════════════════════════════════════ */

  buildNumaligarhAccents() {
    // Green-clad metal industrial sheds (signature Numaligarh look)
    const greenMat = this._mat(0x2f6633, { roughness: 0.55, metalness: 0.45 });
    const trimMat  = this._mat(0xe8e8e8, { roughness: 0.5,  metalness: 0.4 });
    const roofMat  = this._mat(0x4a7a4a, { roughness: 0.6,  metalness: 0.4 });

    const sheds = [
      { cx: -55, cz: -15, w: 14, d: 8, h: 6, rotY: 0 },
      { cx: 55,  cz: 65,  w: 16, d: 9, h: 6, rotY: Math.PI / 2 },
    ];
    for (const s of sheds) {
      const grp = new THREE.Group();

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(s.w, s.h, s.d),
        greenMat,
      );
      body.position.y = s.h / 2;
      grp.add(body);

      // Pitched roof — two angled boxes
      const roofW = Math.sqrt((s.d / 2) ** 2 + (s.h * 0.4) ** 2);
      const roofGeo = new THREE.BoxGeometry(s.w + 0.4, 0.15, roofW);
      for (const sign of [-1, 1]) {
        const roof = new THREE.Mesh(roofGeo, roofMat);
        const ang = Math.atan2(s.h * 0.4, s.d / 2);
        roof.rotation.x = sign * ang;
        roof.position.set(0, s.h + s.h * 0.2, sign * (s.d / 4));
        grp.add(roof);
      }

      // White trim band at door height
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(s.w + 0.02, 0.25, s.d + 0.02),
        trimMat,
      );
      trim.position.y = 2.4;
      grp.add(trim);

      grp.position.set(s.cx, 0, s.cz);
      grp.rotation.y = s.rotY;
      grp.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this._scene.add(grp);
      this.meshes.push(grp);
    }

    // White spherical LPG storage tanks (very Numaligarh)
    const sphereMat = this._mat(0xe5e5e8, { roughness: 0.35, metalness: 0.55 });
    const legMat = this._mat(0x6e6e72, { roughness: 0.5, metalness: 0.7 });
    const spheres = [
      { cx: 60, cz: -25, r: 3.2 },
      { cx: 68, cz: -20, r: 2.8 },
    ];
    for (const sp of spheres) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(sp.r, 24, 18),
        sphereMat,
      );
      ball.position.set(sp.cx, sp.r + 1.5, sp.cz);
      ball.castShadow = true;
      ball.receiveShadow = true;
      this._add(ball);

      // 4 legs
      const legGeo = new THREE.CylinderGeometry(0.12, 0.14, 1.5 + sp.r * 0.3, 6);
      for (const ang of [Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 7*Math.PI/4]) {
        const lx = sp.cx + Math.cos(ang) * sp.r * 0.7;
        const lz = sp.cz + Math.sin(ang) * sp.r * 0.7;
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx, (1.5 + sp.r * 0.3) / 2, lz);
        this._add(leg);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DISPOSE
     ═══════════════════════════════════════════════════════════ */

  dispose() {
    for (const obj of this.meshes) {
      this._scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          m.dispose();
        }
      }
    }
    this.meshes.length = 0;
  }
}
