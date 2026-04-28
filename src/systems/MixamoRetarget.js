/**
 * MixamoRetarget — minimal name-mapping helper.
 *
 * Mixamo FBX exports use `mixamorig:Hips` style bone names, while many
 * GLB rigs (including Sketchfab Mixamo re-exports) strip the colon
 * resulting in `mixamorigHips`. AnimationClip tracks reference bones
 * by name, so this module rewrites the track names in-place to match
 * whatever convention the target skeleton uses.
 *
 * The helper also offers `cloneRig(skeletonGltf)` — a SkeletonUtils.clone
 * wrapper that gives every NPC an independent skeleton so their mixers
 * don't fight each other.
 */
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/* Returns a Set of bone names present on the target rig. */
function collectBoneNames(rigRoot) {
  const names = new Set();
  rigRoot.traverse((o) => {
    if (o.isBone || o.isSkinnedMesh) names.add(o.name);
  });
  return names;
}

/* Try a few common Mixamo name transforms until one of them resolves
   to a bone on the target rig. Returns the rewritten track name. */
function remapBoneName(trackName, targetBones) {
  // Track names are formatted as "BoneName.property" — split once.
  const dotIdx = trackName.indexOf('.');
  if (dotIdx === -1) return trackName;
  const bone = trackName.slice(0, dotIdx);
  const prop = trackName.slice(dotIdx);

  if (targetBones.has(bone)) return trackName;

  const candidates = [
    bone.replace('mixamorig:', 'mixamorig'), // colon → none
    bone.replace('mixamorig:', ''),          // strip prefix entirely
    bone.replace('mixamorig', 'mixamorig:'), // none → colon
    bone.replace('mixamorig', ''),           // strip stripped prefix
  ];
  for (const c of candidates) {
    if (targetBones.has(c)) return c + prop;
  }
  return trackName; // give up — track will be ignored by the mixer
}

/* Returns a NEW AnimationClip whose track names are rewritten to match
   `targetRig`. The original clip is left untouched so it can be
   retargeted onto multiple rigs. */
export function retargetClip(clip, targetRig) {
  const targetBones = collectBoneNames(targetRig);
  const remapped = clip.clone();
  for (const t of remapped.tracks) {
    t.name = remapBoneName(t.name, targetBones);
  }
  return remapped;
}

/* Deep-clones a rigged GLB scene, preserving SkinnedMesh/Skeleton
   relationships. This is the recommended way to spawn many animated
   NPCs from one source GLB. */
export function cloneRig(gltfScene) {
  return cloneSkeleton(gltfScene);
}
