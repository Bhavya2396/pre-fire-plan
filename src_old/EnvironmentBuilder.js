import * as THREE from 'three';

export class EnvironmentBuilder {
  constructor(scene, assetLoader) {
    this.scene = scene;
    this.loader = assetLoader;
    this.meshes = [];
  }

  build() {
    this._buildFloor();
    this._buildWalls();
    this._buildCeiling();
    this._buildPillars();
    this._buildPipes();
    this._buildOverheadLightFixtures();
  }

  _buildFloor() {
    const repeat = [12, 12];
    const mat = new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/concrete/Color.jpg', repeat),
      normalMap: this.loader.loadDataTexture('/textures/concrete/NormalGL.jpg', repeat),
      roughnessMap: this.loader.loadDataTexture('/textures/concrete/Roughness.jpg', repeat),
      aoMap: this.loader.loadDataTexture('/textures/concrete/AO.jpg', repeat),
      roughness: 0.9,
      metalness: 0.0,
    });

    const geo = new THREE.PlaneGeometry(30, 30);
    geo.setAttribute('uv2', geo.attributes.uv);
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.meshes.push(floor);

    this._addFloorMarkings();
  }

  _addFloorMarkings() {
    const markingMat = new THREE.MeshStandardMaterial({
      color: 0xccaa00,
      roughness: 0.8,
      metalness: 0.1,
    });

    const createStripe = (x, z, width, depth, rotY = 0) => {
      const geo = new THREE.PlaneGeometry(width, depth);
      const stripe = new THREE.Mesh(geo, markingMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.rotation.z = rotY;
      stripe.position.set(x, 0.005, z);
      this.scene.add(stripe);
      this.meshes.push(stripe);
    };

    createStripe(0, 0, 0.15, 28);
    createStripe(-5, 0, 0.15, 20);
    createStripe(5, 0, 0.15, 20);

    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      roughness: 0.7,
      emissive: 0x330000,
    });

    [-8, 8].forEach((x) => {
      [-8, 8].forEach((z) => {
        const geo = new THREE.PlaneGeometry(3, 3);
        const zone = new THREE.Mesh(geo, hazardMat);
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(x, 0.003, z);
        this.scene.add(zone);
        this.meshes.push(zone);
      });
    });
  }

  _buildWalls() {
    const repeat = [6, 1.5];
    const mat = new THREE.MeshStandardMaterial({
      map: this.loader.loadTexture('/textures/metal/Color.jpg', repeat),
      normalMap: this.loader.loadDataTexture('/textures/metal/NormalGL.jpg', repeat),
      roughnessMap: this.loader.loadDataTexture('/textures/metal/Roughness.jpg', repeat),
      metalnessMap: this.loader.loadDataTexture('/textures/metal/Metalness.jpg', repeat),
      roughness: 0.7,
      metalness: 0.3,
    });

    const wallHeight = 7;
    const wallLength = 30;

    const walls = [
      { pos: [0, wallHeight / 2, -15], rot: [0, 0, 0] },
      { pos: [0, wallHeight / 2, 15], rot: [0, Math.PI, 0] },
      { pos: [-15, wallHeight / 2, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [15, wallHeight / 2, 0], rot: [0, -Math.PI / 2, 0] },
    ];

    walls.forEach(({ pos, rot }) => {
      const geo = new THREE.PlaneGeometry(wallLength, wallHeight);
      const wall = new THREE.Mesh(geo, mat);
      wall.position.set(...pos);
      wall.rotation.set(...rot);
      wall.receiveShadow = true;
      this.scene.add(wall);
      this.meshes.push(wall);
    });
  }

  _buildCeiling() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.95,
      metalness: 0.1,
    });

    const geo = new THREE.PlaneGeometry(30, 30);
    const ceiling = new THREE.Mesh(geo, mat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 7;
    this.scene.add(ceiling);
    this.meshes.push(ceiling);

    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.6,
      metalness: 0.5,
    });
    const beamGeo = new THREE.BoxGeometry(30, 0.4, 0.3);

    for (let z = -12; z <= 12; z += 4) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(0, 6.8, z);
      beam.castShadow = true;
      this.scene.add(beam);
      this.meshes.push(beam);
    }
  }

  _buildPillars() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xbbbbbb,
      roughness: 0.5,
      metalness: 0.3,
    });

    const geo = new THREE.BoxGeometry(0.5, 7, 0.5);

    const positions = [
      [-7, 0], [0, 0], [7, 0],
      [-7, -7], [0, -7], [7, -7],
      [-7, 7], [0, 7], [7, 7],
    ];

    positions.forEach(([x, z]) => {
      const pillar = new THREE.Mesh(geo, mat);
      pillar.position.set(x, 3.5, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      this.meshes.push(pillar);
    });
  }

  _buildPipes() {
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.4,
      metalness: 0.8,
    });

    const pipeGeo = new THREE.CylinderGeometry(0.08, 0.08, 30, 8);
    const pipeGeoVert = new THREE.CylinderGeometry(0.08, 0.08, 7, 8);

    const pipe1 = new THREE.Mesh(pipeGeo, pipeMat);
    pipe1.rotation.z = Math.PI / 2;
    pipe1.position.set(0, 5.5, -14);
    this.scene.add(pipe1);
    this.meshes.push(pipe1);

    const pipe2 = new THREE.Mesh(pipeGeo, pipeMat);
    pipe2.rotation.z = Math.PI / 2;
    pipe2.position.set(0, 4.5, -14);
    this.scene.add(pipe2);
    this.meshes.push(pipe2);

    const redPipeMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      roughness: 0.5,
      metalness: 0.6,
    });

    const pipe3 = new THREE.Mesh(pipeGeo, redPipeMat);
    pipe3.rotation.z = Math.PI / 2;
    pipe3.position.set(0, 3.5, 14.5);
    this.scene.add(pipe3);
    this.meshes.push(pipe3);

    [-10, -3, 4, 11].forEach((x) => {
      const vert = new THREE.Mesh(pipeGeoVert, pipeMat);
      vert.position.set(x, 3.5, -14.5);
      this.scene.add(vert);
      this.meshes.push(vert);
    });
  }

  _buildOverheadLightFixtures() {
    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      roughness: 0.3,
      metalness: 0.9,
    });

    const emissiveMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffe4b5,
      emissiveIntensity: 2,
      roughness: 0.2,
    });

    const fixtureGeo = new THREE.BoxGeometry(1.2, 0.08, 0.3);
    const bulbGeo = new THREE.PlaneGeometry(1.0, 0.2);

    const positions = [
      [-8, -8], [0, -8], [8, -8],
      [-8, 0],  [0, 0],  [8, 0],
      [-8, 8],  [0, 8],  [8, 8],
    ];

    positions.forEach(([x, z]) => {
      const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
      fixture.position.set(x, 6.6, z);
      this.scene.add(fixture);
      this.meshes.push(fixture);

      const bulb = new THREE.Mesh(bulbGeo, emissiveMat);
      bulb.position.set(x, 6.55, z);
      bulb.rotation.x = -Math.PI / 2;
      this.scene.add(bulb);
      this.meshes.push(bulb);
    });
  }

  dispose() {
    this.meshes.forEach((mesh) => {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
      this.scene.remove(mesh);
    });
    this.meshes = [];
  }
}
