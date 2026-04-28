import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import manifest from '../config/assets.json';

const MAX_TEX_SIZE = 1024;

/**
 * Downscale a texture's underlying image to MAX_TEX_SIZE on its longest
 * edge. Many freebie GLBs ship with 2K-4K diffuse + normal maps which
 * blow GPU upload time and VRAM with very little visible benefit at our
 * camera distances. Re-uploads via canvas; keeps the original Texture.
 */
function downscaleTexture(tex) {
  if (!tex || tex._downscaled) return;
  const img = tex.image;
  if (!img) return;
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) return;
  if (w <= MAX_TEX_SIZE && h <= MAX_TEX_SIZE) {
    tex._downscaled = true;
    return;
  }
  const scale = Math.min(MAX_TEX_SIZE / w, MAX_TEX_SIZE / h);
  const cw = Math.max(1, Math.floor(w * scale));
  const ch = Math.max(1, Math.floor(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  try {
    ctx.drawImage(img, 0, 0, cw, ch);
  } catch (_) {
    // Some textures aren't drawable (compressed formats); leave them.
    tex._downscaled = true;
    return;
  }
  tex.image = canvas;
  tex.needsUpdate = true;
  tex._downscaled = true;
}

export default class AssetManager {
  constructor(eventBus) {
    this._eventBus = eventBus;
    this._gltfLoader = new GLTFLoader();
    this._fbxLoader = new FBXLoader();
    this._textureLoader = new THREE.TextureLoader();
    this._audioLoader = new THREE.AudioLoader();

    this._models = new Map();
    this._buffers = new Map();
    this._textures = new Map();
    this._animations = new Map(); // name → AnimationClip
  }

  async loadAll(onProgress) {
    const models = manifest.models || [];
    const audio = manifest.audio || [];
    const animations = manifest.animations || [];
    const total = models.length + audio.length + animations.length;
    let loaded = 0;

    const advance = (label) => {
      loaded++;
      if (onProgress) onProgress(loaded / total, label);
    };

    // Parallel loading — browser will pipeline up to ~6 HTTP/1.1 requests
    // per origin (essentially unlimited on HTTP/2/Vite). This is the single
    // biggest load-time win: ~30 GLBs in parallel vs sequential cuts cold
    // load from ~30s+ to a few seconds on a warm connection.
    const modelTasks = models.map(async (entry) => {
      const [name, path] = Array.isArray(entry) ? entry : [entry.name, entry.path];
      try {
        const gltf = await this._gltfLoader.loadAsync(path);
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = true;

            // Walk material textures — downscale anything > 1024px.
            // Massive VRAM + upload-time win across 30+ GLBs.
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) {
              if (!m) continue;
              downscaleTexture(m.map);
              downscaleTexture(m.normalMap);
              downscaleTexture(m.roughnessMap);
              downscaleTexture(m.metalnessMap);
              downscaleTexture(m.emissiveMap);
              downscaleTexture(m.aoMap);
            }
          }
        });
        this._models.set(name, gltf);
      } catch (e) {
        console.warn(`AssetManager: model "${name}" failed to load`, e);
      }
      advance(`Loading ${name}...`);
    });

    const audioTasks = audio.map(async (entry) => {
      const [name, path] = Array.isArray(entry) ? entry : [entry.name, entry.path];
      try {
        const buffer = await this._audioLoader.loadAsync(path);
        this._buffers.set(name, buffer);
      } catch (e) {
        console.warn(`AssetManager: audio "${name}" failed to load`, e);
      }
      advance(`Loading audio...`);
    });

    /* Mixamo .fbx animation clips. We extract just the AnimationClip[s];
       the FBX scene/skeleton is discarded — clips are retargeted onto
       the firefighter.glb rig at NPC spawn time. */
    const animTasks = animations.map(async (entry) => {
      const [name, path] = Array.isArray(entry) ? entry : [entry.name, entry.path];
      try {
        const fbx = await this._fbxLoader.loadAsync(path);
        const clips = fbx.animations || [];
        if (clips.length === 0) {
          console.warn(`AssetManager: animation "${name}" had no clips`);
        } else {
          const clip = clips[0].clone();
          clip.name = name;
          this._animations.set(name, clip);
        }
      } catch (e) {
        console.warn(`AssetManager: animation "${name}" failed to load`, e);
      }
      advance(`Loading ${name}...`);
    });

    await Promise.all([...modelTasks, ...audioTasks, ...animTasks]);
  }

  getAnimation(name) {
    const clip = this._animations.get(name);
    if (!clip) {
      console.warn(`AssetManager: animation "${name}" not found`);
      return null;
    }
    return clip;
  }

  getAnimationNames() {
    return [...this._animations.keys()];
  }

  getModelGLTF(name) {
    return this._models.get(name) || null;
  }

  /* Returns a THREE.Group containing one InstancedMesh per primitive
     mesh inside the GLB. Use this for static props that appear many
     times (jersey barriers, traffic cones, light poles) — collapses
     N draw calls per prop into ~1.
       transforms: [{ position:[x,y,z], rotY?, scale? }, ...]
     The `scale` is uniform; if you need per-instance non-uniform
     fitting (e.g. each prop auto-sized via Box3 to a target dimension),
     stick with getModel() + clone(). */
  getInstanced(name, transforms) {
    const gltf = this._models.get(name);
    if (!gltf || !transforms || transforms.length === 0) return null;
    const root = new THREE.Group();

    const dummy = new THREE.Object3D();
    const meshTemplates = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((c) => {
      if (c.isMesh) meshTemplates.push(c);
    });

    for (const tmpl of meshTemplates) {
      const im = new THREE.InstancedMesh(
        tmpl.geometry, tmpl.material, transforms.length,
      );
      im.castShadow = true;
      im.receiveShadow = true;

      const localMatrix = tmpl.matrixWorld.clone();
      transforms.forEach((t, i) => {
        const px = t.position?.[0] ?? 0;
        const py = t.position?.[1] ?? 0;
        const pz = t.position?.[2] ?? 0;
        dummy.position.set(px, py, pz);
        dummy.rotation.set(0, t.rotY || 0, 0);
        dummy.scale.setScalar(t.scale || 1);
        dummy.updateMatrix();
        // Compose: instance transform × source-mesh's world transform.
        const m = new THREE.Matrix4().multiplyMatrices(dummy.matrix, localMatrix);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
    }
    return root;
  }

  getModel(name) {
    const gltf = this._models.get(name);
    if (!gltf) {
      console.warn(`AssetManager: model "${name}" not found`);
      return null;
    }
    return gltf.scene.clone(true);
  }

  getBuffer(name) {
    const buffer = this._buffers.get(name);
    if (!buffer) {
      console.warn(`AssetManager: audio buffer "${name}" not found`);
      return null;
    }
    return buffer;
  }

  loadTexture(path, repeat = { x: 1, y: 1 }, srgb = true) {
    const key = `${path}_${repeat.x}_${repeat.y}_${srgb}`;
    if (this._textures.has(key)) return this._textures.get(key);

    const tex = this._textureLoader.load(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat.x, repeat.y);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    this._textures.set(key, tex);
    return tex;
  }

  dispose() {
    this._models.forEach((gltf) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    });
    this._models.clear();

    this._buffers.clear();

    this._textures.forEach((tex) => tex.dispose());
    this._textures.clear();
  }
}
