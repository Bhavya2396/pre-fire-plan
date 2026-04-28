import * as THREE from 'three';

const _screenPos = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class WaypointSystem {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.waypoints = new Map();
    this.active = null;
    this.time = 0;

    this.beaconMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff6b1a) },
      },
      vertexShader: `
        uniform float uTime;
        varying float vY;
        void main(){
          vec3 p = position;
          p.y += sin(uTime * 2.0) * 0.3;
          vY = p.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vY;
        void main(){
          float a = 0.6 + sin(vY * 8.0) * 0.15;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.arrowEl = document.getElementById('objective-arrow');
    this.distEl = document.getElementById('objective-distance');
    this.labelEl = document.getElementById('objective-label');
  }

  register(id, position, label) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = position.y + 3;

    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.4, 0),
      this.beaconMat.clone()
    );
    diamond.scale.set(1, 1.6, 1);
    group.add(diamond);

    const ringGeo = new THREE.RingGeometry(0.6, 0.8, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6b1a, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -2.5;
    group.add(ring);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 2.5, 4),
      new THREE.MeshBasicMaterial({ color: 0xff6b1a, transparent: true, opacity: 0.2 })
    );
    pillar.position.y = -1.25;
    group.add(pillar);

    group.visible = false;
    this.scene.add(group);
    this.waypoints.set(id, { group, label, worldPos: position.clone() });
  }

  setActive(id) {
    this.waypoints.forEach((wp, key) => {
      wp.group.visible = (key === id);
    });
    this.active = id;
    const wp = this.waypoints.get(id);
    if (wp && this.labelEl) {
      this.labelEl.textContent = wp.label;
    }
  }

  clearActive() {
    this.waypoints.forEach(wp => { wp.group.visible = false; });
    this.active = null;
    if (this.arrowEl) this.arrowEl.style.opacity = '0';
    if (this.distEl) this.distEl.textContent = '';
    if (this.labelEl) this.labelEl.textContent = '';
  }

  update(delta, playerPos) {
    this.time += delta;

    this.waypoints.forEach(wp => {
      if (wp.group.visible) {
        wp.group.children[0].rotation.y += delta * 1.5;
        wp.group.position.y = wp.worldPos.y + 3 + Math.sin(this.time * 2) * 0.3;

        const mat = wp.group.children[0].material;
        if (mat.uniforms) mat.uniforms.uTime.value = this.time;
      }
    });

    if (!this.active) return;
    const wp = this.waypoints.get(this.active);
    if (!wp) return;

    const dx = wp.worldPos.x - playerPos.x;
    const dz = wp.worldPos.z - playerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (this.distEl) this.distEl.textContent = `${Math.round(dist)}m`;

    _screenPos.copy(wp.worldPos);
    _screenPos.y += 3;
    _screenPos.project(this.camera);

    if (this.arrowEl) {
      if (_screenPos.z > 1 || Math.abs(_screenPos.x) > 0.8 || Math.abs(_screenPos.y) > 0.8) {
        this.arrowEl.style.opacity = '1';
        const angle = Math.atan2(-_screenPos.x, _screenPos.y);
        const r = 120;
        const ax = window.innerWidth / 2 + Math.sin(angle) * r;
        const ay = window.innerHeight / 2 - Math.cos(angle) * r;
        this.arrowEl.style.left = `${ax}px`;
        this.arrowEl.style.top = `${ay}px`;
        this.arrowEl.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
      } else {
        this.arrowEl.style.opacity = '0';
      }
    }
  }

  dispose() {
    this.waypoints.forEach(wp => {
      wp.group.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      this.scene.remove(wp.group);
    });
    this.waypoints.clear();
  }
}
