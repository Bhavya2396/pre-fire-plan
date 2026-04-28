import * as THREE from 'three';

/**
 * Converts repeated geometry in TankFarm into InstancedMesh draw calls.
 * Each group of identical geometries is merged into a single instanced draw.
 */
export class InstancedWorld {
  constructor(scene) {
    this.scene = scene;
    this.instances = [];
  }

  createFencePosts(extent = 105, fenceHeight = 2.2) {
    const positions = [];

    for (let x = -extent; x <= extent; x += 5) {
      for (const z of [-90, 90]) {
        if (z === 90 && Math.abs(x) < 10) continue;
        positions.push([x, fenceHeight / 2, z]);
      }
    }
    for (let z = -90; z <= 90; z += 5) {
      for (const x of [-extent, extent]) {
        positions.push([x, fenceHeight / 2, z]);
      }
    }

    const geo = new THREE.BoxGeometry(0.12, fenceHeight, 0.12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.55, metalness: 0.6 });
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    positions.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    this.scene.add(mesh);
    this.instances.push(mesh);
    return mesh;
  }

  createBollards(positions) {
    const geo = new THREE.CylinderGeometry(0.1, 0.12, 1, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xdddd00, roughness: 0.4, metalness: 0.3 });
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    mesh.castShadow = true;

    const dummy = new THREE.Object3D();
    positions.forEach(([x, z], i) => {
      dummy.position.set(x, 0.5, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    this.scene.add(mesh);
    this.instances.push(mesh);
    return mesh;
  }

  createLightPoles(positions, poleMat, lightMat) {
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 10, 6);
    const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
    poleMesh.castShadow = true;

    const armGeo = new THREE.BoxGeometry(1.5, 0.08, 0.08);
    const armMesh = new THREE.InstancedMesh(armGeo, poleMat, positions.length);

    const lampGeo = new THREE.BoxGeometry(0.6, 0.15, 0.3);
    const lampMesh = new THREE.InstancedMesh(lampGeo, lightMat, positions.length);

    const dummy = new THREE.Object3D();
    positions.forEach(([x, z], i) => {
      dummy.position.set(x, 5, z);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x + 0.75, 9.8, z);
      dummy.updateMatrix();
      armMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x + 1.2, 9.7, z);
      dummy.updateMatrix();
      lampMesh.setMatrixAt(i, dummy.matrix);
    });

    poleMesh.instanceMatrix.needsUpdate = true;
    armMesh.instanceMatrix.needsUpdate = true;
    lampMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(poleMesh, armMesh, lampMesh);
    this.instances.push(poleMesh, armMesh, lampMesh);

    const lights = [];
    positions.forEach(([x, z]) => {
      const light = new THREE.PointLight(0xffcc88, 0.15, 25, 2);
      light.position.set(x + 1, 9.5, z);
      this.scene.add(light);
      lights.push(light);
    });
    return { poleMesh, armMesh, lampMesh, lights };
  }

  createTreeLine(extent = 115) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2810, roughness: 0.95 });
    const coniferMat = new THREE.MeshStandardMaterial({ color: 0x1a3a1a, roughness: 0.95 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2a5a2a, roughness: 0.92 });

    const pts = [];
    const rng = (seed) => {
      let s = seed;
      return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    };
    const rand = rng(42);

    for (let row = 0; row < 2; row++) {
      const off = row * 8;
      for (let x = -extent - off; x <= extent + off; x += 6 + rand() * 4) {
        pts.push([x + (rand() - 0.5) * 4, -95 - off, rand()]);
        pts.push([x + (rand() - 0.5) * 4, 95 + off, rand()]);
      }
      for (let z = -95 - off; z <= 95 + off; z += 6 + rand() * 4) {
        pts.push([-extent - off, z + (rand() - 0.5) * 4, rand()]);
        pts.push([extent + off, z + (rand() - 0.5) * 4, rand()]);
      }
    }

    const trunks = [];
    const conifers = [];
    const canopies = [];

    pts.forEach(([x, z, r], i) => {
      const trunkH = 1.2 + r * 0.8;
      trunks.push({ x, z, h: trunkH, r });
      if (i % 3 === 0) {
        conifers.push({ x, z, trunkH, h: 5 + r * 3, radius: 1.2 + r * 0.6 });
      } else {
        canopies.push({ x, z, trunkH, radius: 1.6 + r * 1.0 });
      }
    });

    // Instanced trunks
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length);
    const dummy = new THREE.Object3D();

    trunks.forEach((t, i) => {
      dummy.position.set(t.x, t.h / 2, t.z);
      dummy.scale.set(1, t.h / 1.6, 1);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
    });
    trunkMesh.instanceMatrix.needsUpdate = true;

    // Instanced conifers
    const coneGeo = new THREE.ConeGeometry(1.5, 7, 8);
    const coniferMesh = new THREE.InstancedMesh(coneGeo, coniferMat, conifers.length);
    conifers.forEach((c, i) => {
      dummy.position.set(c.x, c.trunkH + c.h / 2, c.z);
      dummy.scale.set(c.radius / 1.5, c.h / 7, c.radius / 1.5);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      coniferMesh.setMatrixAt(i, dummy.matrix);
    });
    coniferMesh.instanceMatrix.needsUpdate = true;

    // Instanced canopies
    const sphereGeo = new THREE.SphereGeometry(2, 6, 6);
    const canopyMesh = new THREE.InstancedMesh(sphereGeo, canopyMat, canopies.length);
    canopies.forEach((c, i) => {
      dummy.position.set(c.x, c.trunkH + c.radius * 0.85, c.z);
      dummy.scale.setScalar(c.radius / 2);
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(i, dummy.matrix);
    });
    canopyMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(trunkMesh, coniferMesh, canopyMesh);
    this.instances.push(trunkMesh, coniferMesh, canopyMesh);

    return { trunkMesh, coniferMesh, canopyMesh, count: pts.length };
  }

  createSteelFramework(cx = -42, cz = -46, w = 44, d = 26, h = 18) {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.55, metalness: 0.7 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x887722, roughness: 0.6, metalness: 0.5 });

    // Vertical posts: 5x3 grid = 15
    const postGeo = new THREE.BoxGeometry(0.35, h, 0.35);
    const postPositions = [];
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        const x = cx - w / 2 + (col / 4) * w;
        const z = cz - d / 2 + (row / 2) * d;
        postPositions.push([x, h / 2, z]);
      }
    }
    const postMesh = new THREE.InstancedMesh(postGeo, steelMat, postPositions.length);
    postMesh.castShadow = true;
    const dummy = new THREE.Object3D();
    postPositions.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      postMesh.setMatrixAt(i, dummy.matrix);
    });
    postMesh.instanceMatrix.needsUpdate = true;

    // Horizontal beams at 4 levels, E-W + N-S
    const levels = [4, 8, 12, h - 0.3];
    const beamEW = [];
    const beamNS = [];
    for (const y of levels) {
      for (let row = 0; row < 3; row++) {
        const z = cz - d / 2 + (row / 2) * d;
        beamEW.push([cx, y, z]);
      }
      for (let col = 0; col < 5; col++) {
        const x = cx - w / 2 + (col / 4) * w;
        beamNS.push([x, y, cz]);
      }
    }

    const ewGeo = new THREE.BoxGeometry(w, 0.25, 0.25);
    const ewMesh = new THREE.InstancedMesh(ewGeo, beamMat, beamEW.length);
    beamEW.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      ewMesh.setMatrixAt(i, dummy.matrix);
    });
    ewMesh.instanceMatrix.needsUpdate = true;

    const nsGeo = new THREE.BoxGeometry(0.25, 0.25, d);
    const nsMesh = new THREE.InstancedMesh(nsGeo, beamMat, beamNS.length);
    beamNS.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      nsMesh.setMatrixAt(i, dummy.matrix);
    });
    nsMesh.instanceMatrix.needsUpdate = true;

    // Grated walkways at top
    const grateMat = new THREE.MeshStandardMaterial({ color: 0x444448, roughness: 0.7, metalness: 0.4 });
    const walkways = [
      [0, -d / 2, w + 0.6, 1.2], [0, d / 2, w + 0.6, 1.2],
      [-w / 2, 0, 1.2, d + 0.6], [w / 2, 0, 1.2, d + 0.6],
    ];
    const walkGeo = new THREE.BoxGeometry(1, 0.08, 1);
    const walkMesh = new THREE.InstancedMesh(walkGeo, grateMat, walkways.length);
    walkways.forEach(([dx, dz, ww, dd], i) => {
      dummy.position.set(cx + dx, h - 0.1, cz + dz);
      dummy.scale.set(ww, 1, dd);
      dummy.updateMatrix();
      walkMesh.setMatrixAt(i, dummy.matrix);
    });
    walkMesh.instanceMatrix.needsUpdate = true;

    // Handrails
    const railData = [
      [0, -d / 2 - 0.6, w, 0.05], [0, d / 2 + 0.6, w, 0.05],
      [-w / 2 - 0.6, 0, 0.05, d], [w / 2 + 0.6, 0, 0.05, d],
    ];
    const railGeo = new THREE.BoxGeometry(1, 0.04, 1);
    const railMesh = new THREE.InstancedMesh(railGeo, beamMat, railData.length);
    railData.forEach(([dx, dz, ww, dd], i) => {
      dummy.position.set(cx + dx, h + 1.0, cz + dz);
      dummy.scale.set(ww, 1, dd);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i, dummy.matrix);
    });
    railMesh.instanceMatrix.needsUpdate = true;

    [postMesh, ewMesh, nsMesh, walkMesh, railMesh].forEach(m => {
      this.scene.add(m);
      this.instances.push(m);
    });
  }

  createOverheadPipes(cx = -42, cz = -46) {
    const palette = [0x5278a0, 0xc86a2e, 0x4e804e, 0xaaaaae, 0xc8a832];
    const mats = palette.map(c =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.85 }));

    const rng = (seed) => {
      let s = seed;
      return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    };
    const rand = rng(99);

    // E-W pipes
    const ewPipes = [];
    for (const y of [10, 14]) {
      for (let z = -60; z <= -32; z += 4) {
        ewPipes.push({ y, z, matIdx: Math.floor(rand() * palette.length) });
      }
    }

    const pipeGeo = new THREE.CylinderGeometry(0.16, 0.16, 56, 8);
    const ewByMat = new Map();
    ewPipes.forEach(p => {
      if (!ewByMat.has(p.matIdx)) ewByMat.set(p.matIdx, []);
      ewByMat.get(p.matIdx).push(p);
    });

    const dummy = new THREE.Object3D();
    ewByMat.forEach((pipes, matIdx) => {
      const mesh = new THREE.InstancedMesh(pipeGeo, mats[matIdx], pipes.length);
      pipes.forEach((p, i) => {
        dummy.position.set(cx, p.y, p.z);
        dummy.rotation.set(0, 0, Math.PI / 2);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.instances.push(mesh);
    });

    // N-S branch pipes
    const nsGeo = new THREE.CylinderGeometry(0.14, 0.14, 28, 8);
    const nsPipes = [];
    for (const y of [10, 14]) {
      for (let x = -64; x <= -20; x += 6) {
        if (Math.abs(x + 42) < 4) continue;
        nsPipes.push({ x, y, matIdx: Math.floor(rand() * palette.length) });
      }
    }

    const nsByMat = new Map();
    nsPipes.forEach(p => {
      if (!nsByMat.has(p.matIdx)) nsByMat.set(p.matIdx, []);
      nsByMat.get(p.matIdx).push(p);
    });

    nsByMat.forEach((pipes, matIdx) => {
      const mesh = new THREE.InstancedMesh(nsGeo, mats[matIdx], pipes.length);
      pipes.forEach((p, i) => {
        dummy.position.set(p.x, p.y, cz);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.instances.push(mesh);
    });

    // Vertical risers from columns
    const colPos = [[-55, -55], [-42, -55], [-29, -55], [-55, -38], [-42, -38], [-29, -38]];
    const riserGeo = new THREE.CylinderGeometry(0.14, 0.14, 16, 8);
    const riserMesh = new THREE.InstancedMesh(riserGeo, mats[1], colPos.length * 2);
    let ri = 0;
    colPos.forEach(([px, pz]) => {
      for (const dx of [-0.6, 0.6]) {
        dummy.position.set(px + dx, 8, pz + 0.3);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        riserMesh.setMatrixAt(ri++, dummy.matrix);
      }
    });
    riserMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(riserMesh);
    this.instances.push(riserMesh);
  }

  dispose() {
    this.instances.forEach(m => {
      m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
      else m.material.dispose();
      this.scene.remove(m);
    });
    this.instances = [];
  }
}
