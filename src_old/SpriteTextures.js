import * as THREE from 'three';

/**
 * SpriteTextures — loads Kenney particle-pack PNGs from /public/particles/.
 * All textures are tinted at render time in the shader; the PNGs are greyscale
 * alpha maps (white = opaque, black = transparent) so additive blending tints them.
 *
 * Fallback: if a file isn't found the loader returns a 1x1 white placeholder
 * which is harmless (Three.js default behaviour).
 */

const loader = new THREE.TextureLoader();
const CACHE = {};

function load(path) {
  if (CACHE[path]) return CACHE[path];
  const tex = loader.load(path);
  tex.colorSpace = THREE.SRGBColorSpace;
  CACHE[path] = tex;
  return tex;
}

/* ── Single sprites ──────────────────────────────────── */

export function fireSprite()   { return load('/particles/fire_01.png');   }
export function fire2Sprite()  { return load('/particles/fire_02.png');   }
export function smokeSprite()  { return load('/particles/smoke_03.png');  }
export function smoke2Sprite() { return load('/particles/smoke_07.png');  }
export function emberSprite()  { return load('/particles/spark_05.png');  }
export function spark2Sprite() { return load('/particles/spark_07.png');  }
export function waterSprite()  { return load('/particles/circle_01.png'); }
export function steamSprite()  { return load('/particles/smoke_05.png');  }
export function foamSprite()   { return load('/particles/smoke_02.png');  }
export function flareSprite()  { return load('/particles/flare_01.png');  }
export function lightSprite()  { return load('/particles/light_01.png');  }
export function traceSprite()  { return load('/particles/trace_04.png');  }
export function scorch1()      { return load('/particles/scorch_01.png'); }
export function scorch2()      { return load('/particles/scorch_02.png'); }
export function scorch3()      { return load('/particles/scorch_03.png'); }
export function dirtSprite()   { return load('/particles/dirt_01.png');   }

/* ── Flame variants (for multi-sprite fire) ─────────── */

export const FLAME_SPRITES = [
  '/particles/flame_01.png',
  '/particles/flame_02.png',
  '/particles/flame_03.png',
  '/particles/flame_04.png',
  '/particles/flame_05.png',
  '/particles/flame_06.png',
].map(load);

export const SMOKE_SPRITES = [
  '/particles/smoke_01.png',
  '/particles/smoke_02.png',
  '/particles/smoke_04.png',
  '/particles/smoke_06.png',
  '/particles/smoke_08.png',
  '/particles/smoke_10.png',
].map(load);
