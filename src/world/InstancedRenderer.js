import * as THREE from 'three';

const _dummy = new THREE.Object3D();

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export default class InstancedRenderer {
  constructor(scene) {
    this._scene = scene;
    this._instancedMeshes = [];
    this._lights = [];
  }

  /* ─── helpers ──────────────────────────────────────────── */

  _create(geo, mat, count, opts = {}) {
    const im = new THREE.InstancedMesh(geo, mat, count);
    // castShadow defaults to false on tiny props (fence posts, bollards,
    // wires, light pole stems) — they're too small/numerous to justify
    // the shadow-pass cost and look fine without their own cast shadow.
    im.castShadow = opts.castShadow ?? false;
    im.receiveShadow = opts.receiveShadow ?? true;
    this._scene.add(im);
    this._instancedMeshes.push(im);
    return im;
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, ...opts });
  }

  /* ═══════════════════════════════════════════════════════════
     FENCE POSTS & PANELS
     ═══════════════════════════════════════════════════════════ */

  createFencePosts(extent = 105, height = 2.2) {
    const postMat = this._mat(0x888888, { roughness: 0.4, metalness: 0.7 });
    const railMat = this._mat(0x999999, { roughness: 0.4, metalness: 0.6 });
    const meshMat = this._mat(0xaaaaaa, {
      roughness: 0.5, metalness: 0.4,
      transparent: true, opacity: 0.3, side: THREE.DoubleSide,
    });

    const spacing = 3;
    const half = extent;
    const perimeter = [];

    // four sides
    for (let x = -half; x <= half; x += spacing) {
      perimeter.push({ x, z: -half, faceZ: true });
      perimeter.push({ x, z: half,  faceZ: true });
    }
    for (let z = -half + spacing; z < half; z += spacing) {
      perimeter.push({ x: -half, z, faceZ: false });
      perimeter.push({ x: half,  z, faceZ: false });
    }

    // posts
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, height, 6);
    const posts = this._create(postGeo, postMat, perimeter.length);
    perimeter.forEach((p, i) => {
      _dummy.position.set(p.x, height / 2, p.z);
      _dummy.updateMatrix();
      posts.setMatrixAt(i, _dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true;

    // top rail between consecutive posts per side
    const railGeo = new THREE.BoxGeometry(spacing, 0.05, 0.05);
    const sides = [
      { fixed: 'z', val: -half, axis: 'x', from: -half, to: half },
      { fixed: 'z', val: half,  axis: 'x', from: -half, to: half },
      { fixed: 'x', val: -half, axis: 'z', from: -half, to: half },
      { fixed: 'x', val: half,  axis: 'z', from: -half, to: half },
    ];

    let railCount = 0;
    for (const s of sides) {
      railCount += Math.floor((s.to - s.from) / spacing);
    }

    const rails = this._create(railGeo, railMat, railCount * 2);
    let ri = 0;
    for (const s of sides) {
      for (let v = s.from; v < s.to; v += spacing) {
        for (const yOff of [height - 0.1, height * 0.5]) {
          const x = s.fixed === 'x' ? s.val : v + spacing / 2;
          const z = s.fixed === 'z' ? s.val : v + spacing / 2;
          _dummy.position.set(x, yOff, z);
          _dummy.rotation.set(0, s.axis === 'z' ? Math.PI / 2 : 0, 0);
          _dummy.updateMatrix();
          rails.setMatrixAt(ri++, _dummy.matrix);
        }
      }
    }
    rails.instanceMatrix.needsUpdate = true;
    _dummy.rotation.set(0, 0, 0);

    // mesh panels
    const panelGeo = new THREE.PlaneGeometry(spacing - 0.2, height - 0.3);
    const panelCount = railCount;
    const panels = this._create(panelGeo, meshMat, panelCount);
    let pi = 0;
    for (const s of sides) {
      for (let v = s.from; v < s.to; v += spacing) {
        const x = s.fixed === 'x' ? s.val : v + spacing / 2;
        const z = s.fixed === 'z' ? s.val : v + spacing / 2;
        _dummy.position.set(x, height / 2, z);
        _dummy.rotation.set(0, s.axis === 'z' ? 0 : Math.PI / 2, 0);
        _dummy.updateMatrix();
        panels.setMatrixAt(pi++, _dummy.matrix);
      }
    }
    panels.instanceMatrix.needsUpdate = true;
    _dummy.rotation.set(0, 0, 0);

    // gate posts (wider, taller) at entries on each side
    const gatePostGeo = new THREE.CylinderGeometry(0.12, 0.12, height + 0.5, 8);
    const gatePostMat = this._mat(0x666666, { roughness: 0.3, metalness: 0.8 });
    const gatePositions = [
      { x: 0, z: -half }, { x: 0, z: half },
      { x: -half, z: 0 }, { x: half, z: 0 },
    ];
    const gatePosts = this._create(gatePostGeo, gatePostMat, gatePositions.length * 2);
    gatePositions.forEach((g, i) => {
      for (let side = 0; side < 2; side++) {
        const offset = side === 0 ? -1.5 : 1.5;
        const px = g.z === -half || g.z === half ? g.x + offset : g.x;
        const pz = g.x === -half || g.x === half ? g.z + offset : g.z;
        _dummy.position.set(px, (height + 0.5) / 2, pz);
        _dummy.updateMatrix();
        gatePosts.setMatrixAt(i * 2 + side, _dummy.matrix);
      }
    });
    gatePosts.instanceMatrix.needsUpdate = true;
  }

  /* ═══════════════════════════════════════════════════════════
     BOLLARDS
     ═══════════════════════════════════════════════════════════ */

  createBollards(positions) {
    if (!positions || positions.length === 0) return;
    const geo = new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8);
    // Less neon — muted yellow + black banding (standard road safety bollard)
    const mat = this._mat(0xc8a418, { roughness: 0.55, metalness: 0.3 });
    const im = this._create(geo, mat, positions.length);

    positions.forEach((p, i) => {
      _dummy.position.set(p[0], 0.45, p[1]);
      _dummy.updateMatrix();
      im.setMatrixAt(i, _dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
  }

  /* ═══════════════════════════════════════════════════════════
     LIGHT POLES
     ═══════════════════════════════════════════════════════════ */

  createLightPoles(positions) {
    if (!positions || positions.length === 0) return;
    const count = positions.length;
    const poleMat = this._mat(0x666666, { roughness: 0.3, metalness: 0.8 });
    const lampMat = this._mat(0xffffcc, {
      emissive: 0xffffaa,
      emissiveIntensity: 0.8,
    });

    // pole
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 8, 6);
    const poles = this._create(poleGeo, poleMat, count);

    // arm
    const armGeo = new THREE.BoxGeometry(2, 0.06, 0.06);
    const arms = this._create(armGeo, poleMat, count);

    // lamp housing
    const lampGeo = new THREE.BoxGeometry(0.6, 0.15, 0.4);
    const lamps = this._create(lampGeo, lampMat, count);

    positions.forEach((p, i) => {
      const x = p[0], z = p[1];

      _dummy.position.set(x, 4, z);
      _dummy.updateMatrix();
      poles.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(x + 1, 7.9, z);
      _dummy.updateMatrix();
      arms.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(x + 1.8, 7.8, z);
      _dummy.updateMatrix();
      lamps.setMatrixAt(i, _dummy.matrix);

      const light = new THREE.PointLight(0xffeedd, 1.5, 30);
      light.position.set(x + 1.8, 7.7, z);
      this._scene.add(light);
      this._lights.push(light);
    });

    poles.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
  }

  /* ═══════════════════════════════════════════════════════════
     TREE LINE
     ═══════════════════════════════════════════════════════════ */

  /**
   * Sparse fallback ring of low-poly trees. Used only if the oak GLB
   * isn't available — see `placeOakTreesAround` below for the real one.
   */
  createTreeLine(extent = 115) {
    const rand = seededRandom(42);
    const spacing = 14;
    const positions = [];

    for (let x = -extent; x <= extent; x += spacing) {
      positions.push({ x: x + (rand() - 0.5) * 4, z: -extent + (rand() - 0.5) * 4 });
      positions.push({ x: x + (rand() - 0.5) * 4, z: extent + (rand() - 0.5) * 4 });
    }
    for (let z = -extent + spacing; z < extent; z += spacing) {
      positions.push({ x: -extent + (rand() - 0.5) * 4, z: z + (rand() - 0.5) * 4 });
      positions.push({ x: extent + (rand() - 0.5) * 4,  z: z + (rand() - 0.5) * 4 });
    }

    const count = positions.length;
    const trunkMat = this._mat(0x4a2e15, { roughness: 0.95 });
    const canopyMat = this._mat(0x2c5c2a, { roughness: 0.85 });

    // Trees stay shadow-casting — they're large enough that the cast
    // shadow visibly grounds them.
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3.5, 6);
    const trunks = this._create(trunkGeo, trunkMat, count, { castShadow: true });
    const canopyGeo = new THREE.SphereGeometry(2.4, 8, 6);
    const canopies = this._create(canopyGeo, canopyMat, count, { castShadow: true });

    positions.forEach((p, i) => {
      const trunkH = 2.5 + rand() * 2;
      const scale = 0.9 + rand() * 0.6;

      _dummy.position.set(p.x, trunkH / 2, p.z);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      trunks.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(p.x, trunkH + 1.6 * scale, p.z);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      canopies.setMatrixAt(i, _dummy.matrix);
    });

    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    _dummy.scale.setScalar(1);
  }

  /**
   * Place real oak tree GLB clusters around the perimeter to match the
   * Numaligarh forest aesthetic. Only creates clusters at strategic
   * points (corners + sparse intervals) so the scene stays performant.
   */
  placeOakTreesAround(treeModel, extent = 110) {
    if (!treeModel) return;
    const rand = seededRandom(99);
    const positions = [];

    // Corner clusters — denser
    for (const corner of [[-extent, -extent], [extent, -extent], [-extent, extent], [extent, extent]]) {
      for (let i = 0; i < 3; i++) {
        positions.push([
          corner[0] + (rand() - 0.5) * 18,
          corner[1] + (rand() - 0.5) * 18,
        ]);
      }
    }

    // North forest backdrop (Numaligarh has dense jungle behind the plant)
    for (let x = -extent; x <= extent; x += 22) {
      positions.push([x + (rand() - 0.5) * 8, -extent + (rand() - 0.5) * 6]);
    }
    // East / west sparser tree breaks
    for (let z = -extent + 30; z < extent - 30; z += 35) {
      positions.push([-extent + (rand() - 0.5) * 6, z + (rand() - 0.5) * 6]);
      positions.push([ extent + (rand() - 0.5) * 6, z + (rand() - 0.5) * 6]);
    }
    // South perimeter — fewer (player-facing)
    for (let x = -extent; x <= extent; x += 30) {
      positions.push([x + (rand() - 0.5) * 6, extent + (rand() - 0.5) * 6]);
    }

    // Probe size of source GLB so we can scale to ~12-18m tall
    const probe = new THREE.Box3().setFromObject(treeModel);
    const size = new THREE.Vector3();
    probe.getSize(size);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const baseScale = 14 / longest;

    /* Clone strategy: SkeletonUtils-style deep clones would give every
       tree its own material instances → texture uploads × N. Instead we
       SHALLOW-clone the scene graph and reuse the source materials. The
       trees never animate or change material so this is safe and slashes
       per-tree GPU memory + reduces material draw-call grouping cost. */
    for (const [px, pz] of positions) {
      const t = treeModel.clone(false);
      // Shallow clone copies the root group but not its children — re-add
      // the source children directly (shared geometry + materials).
      treeModel.children.forEach(child => t.add(child.clone(true)));
      // Now point the freshly cloned meshes at the SOURCE materials so
      // we don't multiply material instances.
      const sourceMatsByName = new Map();
      treeModel.traverse(c => {
        if (c.isMesh && c.material) sourceMatsByName.set(c.name, c.material);
      });
      const s = baseScale * (0.7 + rand() * 0.6);
      t.scale.setScalar(s);
      t.position.set(px, 0, pz);
      t.rotation.y = rand() * Math.PI * 2;
      t.traverse(c => {
        if (c.isMesh) {
          const shared = sourceMatsByName.get(c.name);
          if (shared) c.material = shared;
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      this._scene.add(t);
      this._instancedMeshes.push(t);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     STEEL FRAMEWORK
     ═══════════════════════════════════════════════════════════ */

  createSteelFramework(cx, cz, w, d, h) {
    const mat = this._mat(0x888888, { roughness: 0.3, metalness: 0.85 });

    // vertical posts at 4 corners + midpoints
    const postPositions = [];
    for (const dx of [-w / 2, 0, w / 2]) {
      for (const dz of [-d / 2, d / 2]) {
        postPositions.push([cx + dx, cz + dz]);
      }
    }
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, h, 6);
    const posts = this._create(postGeo, mat, postPositions.length);
    postPositions.forEach((p, i) => {
      _dummy.position.set(p[0], h / 2, p[1]);
      _dummy.updateMatrix();
      posts.setMatrixAt(i, _dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true;

    // horizontal beams at top
    const beamDefs = [
      { from: [-w / 2, -d / 2], to: [w / 2, -d / 2] },
      { from: [-w / 2, d / 2],  to: [w / 2, d / 2] },
      { from: [-w / 2, -d / 2], to: [-w / 2, d / 2] },
      { from: [w / 2, -d / 2],  to: [w / 2, d / 2] },
    ];
    const beamGeo = new THREE.BoxGeometry(1, 0.08, 0.08);
    const beams = this._create(beamGeo, mat, beamDefs.length);
    beamDefs.forEach((b, i) => {
      const mx = cx + (b.from[0] + b.to[0]) / 2;
      const mz = cz + (b.from[1] + b.to[1]) / 2;
      const dx = b.to[0] - b.from[0];
      const dz = b.to[1] - b.from[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      _dummy.position.set(mx, h - 0.04, mz);
      _dummy.scale.set(len, 1, 1);
      _dummy.rotation.set(0, Math.atan2(dz, dx), 0);
      _dummy.updateMatrix();
      beams.setMatrixAt(i, _dummy.matrix);
    });
    beams.instanceMatrix.needsUpdate = true;
    _dummy.scale.setScalar(1);
    _dummy.rotation.set(0, 0, 0);

    // walkway platforms
    const walkMat = this._mat(0x666666, {
      roughness: 0.6, metalness: 0.5,
      transparent: true, opacity: 0.6,
    });
    const walkGeo = new THREE.BoxGeometry(w, 0.05, d);
    const walk = this._create(walkGeo, walkMat, 1);
    _dummy.position.set(cx, h - 0.1, cz);
    _dummy.updateMatrix();
    walk.setMatrixAt(0, _dummy.matrix);
    walk.instanceMatrix.needsUpdate = true;

    // handrails around walkway perimeter
    const handrailMat = this._mat(0xddcc00, { roughness: 0.4, metalness: 0.5 });
    const hrGeo = new THREE.BoxGeometry(1, 0.04, 0.04);
    const hrSegments = [];
    for (let x = -w / 2; x < w / 2; x += 2) {
      hrSegments.push({ px: cx + x + 1, pz: cz - d / 2 });
      hrSegments.push({ px: cx + x + 1, pz: cz + d / 2 });
    }
    for (let z = -d / 2; z < d / 2; z += 2) {
      hrSegments.push({ px: cx - w / 2, pz: cz + z + 1, rotY: Math.PI / 2 });
      hrSegments.push({ px: cx + w / 2, pz: cz + z + 1, rotY: Math.PI / 2 });
    }
    const hrs = this._create(hrGeo, handrailMat, hrSegments.length);
    hrSegments.forEach((s, i) => {
      _dummy.position.set(s.px, h + 0.9, s.pz);
      _dummy.scale.set(2, 1, 1);
      _dummy.rotation.set(0, s.rotY || 0, 0);
      _dummy.updateMatrix();
      hrs.setMatrixAt(i, _dummy.matrix);
    });
    hrs.instanceMatrix.needsUpdate = true;
    _dummy.scale.setScalar(1);
    _dummy.rotation.set(0, 0, 0);
  }

  /* ═══════════════════════════════════════════════════════════
     OVERHEAD PIPES
     ═══════════════════════════════════════════════════════════ */

  createOverheadPipes(cx, cz) {
    const colors = [0xcc3333, 0x3366cc, 0x33aa33, 0xccaa33, 0x888888];
    const pipeR = 0.12;
    const pipeH = 5;
    const spacing = 0.6;
    const runLen = 40;

    // E-W runs
    const ewCount = colors.length;
    const ewGeo = new THREE.CylinderGeometry(pipeR, pipeR, runLen, 8);
    const ewPipes = [];
    colors.forEach((col, i) => {
      const mat = this._mat(col, { roughness: 0.3, metalness: 0.7 });
      const im = this._create(ewGeo, mat, 1);
      _dummy.position.set(cx, pipeH + i * spacing, cz);
      _dummy.rotation.set(0, 0, Math.PI / 2);
      _dummy.updateMatrix();
      im.setMatrixAt(0, _dummy.matrix);
      im.instanceMatrix.needsUpdate = true;
      ewPipes.push(im);
    });

    // N-S runs (perpendicular, shorter)
    const nsLen = 30;
    const nsGeo = new THREE.CylinderGeometry(pipeR, pipeR, nsLen, 8);
    colors.forEach((col, i) => {
      const mat = this._mat(col, { roughness: 0.3, metalness: 0.7 });
      const im = this._create(nsGeo, mat, 1);
      _dummy.position.set(cx + runLen * 0.3, pipeH + i * spacing + 0.3, cz);
      _dummy.rotation.set(Math.PI / 2, 0, 0);
      _dummy.updateMatrix();
      im.setMatrixAt(0, _dummy.matrix);
      im.instanceMatrix.needsUpdate = true;
    });

    // vertical risers at ends
    const riserGeo = new THREE.CylinderGeometry(pipeR * 0.8, pipeR * 0.8, pipeH, 8);
    const riserMat = this._mat(0x777777, { roughness: 0.3, metalness: 0.7 });
    const riserPositions = [
      [cx - runLen / 2, cz],
      [cx + runLen / 2, cz],
      [cx + runLen * 0.3, cz - nsLen / 2],
      [cx + runLen * 0.3, cz + nsLen / 2],
    ];
    const risers = this._create(riserGeo, riserMat, riserPositions.length);
    riserPositions.forEach((p, i) => {
      _dummy.position.set(p[0], pipeH / 2, p[1]);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      risers.setMatrixAt(i, _dummy.matrix);
    });
    risers.instanceMatrix.needsUpdate = true;
    _dummy.rotation.set(0, 0, 0);
  }

  /* ═══════════════════════════════════════════════════════════
     WARNING SIGNS
     ═══════════════════════════════════════════════════════════ */

  createWarnings(signs) {
    if (!signs || signs.length === 0) return;
    const postMat = this._mat(0x666666, { roughness: 0.4, metalness: 0.7 });
    const signMat = this._mat(0xffcc00, { roughness: 0.5 });

    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6);
    const signGeo = new THREE.BoxGeometry(0.6, 0.4, 0.03);

    const posts = this._create(postGeo, postMat, signs.length);
    const boards = this._create(signGeo, signMat, signs.length);

    signs.forEach((s, i) => {
      _dummy.position.set(s[0], 1.1, s[1]);
      _dummy.rotation.set(0, s[2] || 0, 0);
      _dummy.updateMatrix();
      posts.setMatrixAt(i, _dummy.matrix);

      _dummy.position.set(s[0], 2.0, s[1]);
      _dummy.updateMatrix();
      boards.setMatrixAt(i, _dummy.matrix);
    });

    posts.instanceMatrix.needsUpdate = true;
    boards.instanceMatrix.needsUpdate = true;
    _dummy.rotation.set(0, 0, 0);
  }

  /* ═══════════════════════════════════════════════════════════
     DISPOSE
     ═══════════════════════════════════════════════════════════ */

  dispose() {
    for (const im of this._instancedMeshes) {
      this._scene.remove(im);
      // Group entries (e.g. cloned oak GLBs) need a deep traversal — only
      // InstancedMesh / Mesh instances expose .geometry directly.
      if (im.isInstancedMesh || im.isMesh) {
        im.geometry?.dispose();
        const mats = Array.isArray(im.material) ? im.material : [im.material];
        for (const m of mats) m?.dispose();
      } else {
        im.traverse((c) => {
          if (!c.isMesh) return;
          c.geometry?.dispose();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          for (const m of mats) m?.dispose();
        });
      }
    }
    this._instancedMeshes.length = 0;

    for (const light of this._lights) {
      this._scene.remove(light);
      if (light.dispose) light.dispose();
    }
    this._lights.length = 0;
  }
}
