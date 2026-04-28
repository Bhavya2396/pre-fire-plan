// Minimal GLB inspector. Parses the JSON chunk of a .glb (no extra deps).
// Reports geometry bounds, named nodes (esp. interactive parts: handwheel,
// lever, shackle, trigger), animation count, and overall mesh complexity.
//
// Usage: node tools/inspect-glb.js <file.glb> [<file2.glb> ...]

import { promises as fs } from 'fs';
import path from 'path';

const HEADER_MAGIC = 0x46546c67;     // 'glTF'
const CHUNK_JSON   = 0x4e4f534a;     // 'JSON'
const CHUNK_BIN    = 0x004e4942;     // 'BIN\0'

const INTERACTIVE_NAME_RE =
  /handle|hand_?wheel|wheel|spoke|spinner|lever|arm|bar|shackle|loop|padlock_top|trigger|button|cap|valve|spindle|crank|knob|door|hinge|nozzle|tip|outlet|nozzle_tip/i;

async function readGLB(file) {
  if (file.toLowerCase().endsWith('.gltf')) {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
  const buf = await fs.readFile(file);
  if (buf.readUInt32LE(0) !== HEADER_MAGIC) throw new Error('not a GLB');
  // const version = buf.readUInt32LE(4);
  const totalLen = buf.readUInt32LE(8);

  let offset = 12;
  let json = null;
  while (offset < totalLen) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) {
      json = JSON.parse(buf.slice(start, start + chunkLen).toString('utf8'));
      break; // bounds and node names live in JSON
    }
    offset = start + chunkLen;
  }
  if (!json) throw new Error('no JSON chunk');
  return json;
}

function applyMatrix(min, max, m) {
  // Transform AABB by 4x4 column-major matrix m (length 16).
  const corners = [
    [min[0], min[1], min[2]],
    [min[0], min[1], max[2]],
    [min[0], max[1], min[2]],
    [min[0], max[1], max[2]],
    [max[0], min[1], min[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]],
  ];
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const c of corners) {
    const x = m[0] * c[0] + m[4] * c[1] + m[8]  * c[2] + m[12];
    const y = m[1] * c[0] + m[5] * c[1] + m[9]  * c[2] + m[13];
    const z = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
    if (x < out.min[0]) out.min[0] = x;
    if (y < out.min[1]) out.min[1] = y;
    if (z < out.min[2]) out.min[2] = z;
    if (x > out.max[0]) out.max[0] = x;
    if (y > out.max[1]) out.max[1] = y;
    if (z > out.max[2]) out.max[2] = z;
  }
  return out;
}

function trsMatrix(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  // Build column-major TRS matrix from quaternion r and vectors t, s.
  const [x, y, z, w] = r;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0],
    (2 * (xy + wz)) * s[0],
    (2 * (xz - wy)) * s[0],
    0,
    (2 * (xy - wz)) * s[1],
    (1 - 2 * (xx + zz)) * s[1],
    (2 * (yz + wx)) * s[1],
    0,
    (2 * (xz + wy)) * s[2],
    (2 * (yz - wx)) * s[2],
    (1 - 2 * (xx + yy)) * s[2],
    0,
    t[0], t[1], t[2], 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[0 * 4 + j] * b[i * 4 + 0] +
        a[1 * 4 + j] * b[i * 4 + 1] +
        a[2 * 4 + j] * b[i * 4 + 2] +
        a[3 * 4 + j] * b[i * 4 + 3];
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  return trsMatrix(node.translation, node.rotation, node.scale);
}

function meshAABB(mesh, accessors) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.primitives || []) {
    const idx = prim.attributes?.POSITION;
    if (idx == null) continue;
    const acc = accessors[idx];
    if (!acc?.min || !acc?.max) continue;
    for (let i = 0; i < 3; i++) {
      if (acc.min[i] < min[i]) min[i] = acc.min[i];
      if (acc.max[i] > max[i]) max[i] = acc.max[i];
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

function inspect(json) {
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  const accessors = json.accessors || [];
  const sceneIdx = json.scene ?? 0;
  const scene = (json.scenes || [])[sceneIdx] || { nodes: [] };

  let worldMin = [Infinity, Infinity, Infinity];
  let worldMax = [-Infinity, -Infinity, -Infinity];
  let primCount = 0;
  let triCount = 0;
  const interestingNodes = [];

  function walk(nodeIdx, parentMatrix) {
    const n = nodes[nodeIdx];
    if (!n) return;
    const local = nodeMatrix(n);
    const world = multiply(parentMatrix, local);

    if (n.name && INTERACTIVE_NAME_RE.test(n.name)) {
      interestingNodes.push(n.name);
    }

    if (n.mesh != null) {
      const m = meshes[n.mesh];
      const aabb = meshAABB(m, accessors);
      if (aabb) {
        const w = applyMatrix(aabb.min, aabb.max, world);
        for (let i = 0; i < 3; i++) {
          if (w.min[i] < worldMin[i]) worldMin[i] = w.min[i];
          if (w.max[i] > worldMax[i]) worldMax[i] = w.max[i];
        }
      }
      for (const prim of m.primitives || []) {
        primCount++;
        const indicesAcc = prim.indices != null ? accessors[prim.indices] : null;
        const posAcc = prim.attributes?.POSITION != null ? accessors[prim.attributes.POSITION] : null;
        if (indicesAcc?.count) triCount += indicesAcc.count / 3;
        else if (posAcc?.count) triCount += posAcc.count / 3;
      }
    }
    for (const child of n.children || []) walk(child, world);
  }

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of scene.nodes || []) walk(r, identity);

  const size = [
    +(worldMax[0] - worldMin[0]).toFixed(3),
    +(worldMax[1] - worldMin[1]).toFixed(3),
    +(worldMax[2] - worldMin[2]).toFixed(3),
  ];
  const longest = Math.max(...size);

  return {
    bounds: {
      min: worldMin.map(v => +v.toFixed(3)),
      max: worldMax.map(v => +v.toFixed(3)),
      size,
      longest: +longest.toFixed(3),
    },
    counts: {
      nodes: nodes.length,
      meshes: meshes.length,
      primitives: primCount,
      tris: Math.round(triCount),
      materials: (json.materials || []).length,
      animations: (json.animations || []).length,
    },
    interactive: [...new Set(interestingNodes)],
    sampleNames: nodes.map(n => n.name).filter(Boolean).slice(0, 12),
  };
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node tools/inspect-glb.js <file.glb> [...]');
  process.exit(2);
}

const results = [];
for (const a of args) {
  try {
    const json = await readGLB(a);
    const info = inspect(json);
    results.push({ file: a, ...info });
  } catch (e) {
    results.push({ file: a, error: e.message });
  }
}
console.log(JSON.stringify(results, null, 2));
