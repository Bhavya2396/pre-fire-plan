# Gap Analysis & Engineering Brief

**To:** Senior Game Engineer + Technical Designer
**From:** Build lead
**Re:** Pre-Fire Plan Simulation — current state vs production-grade Unity/Unreal training sim
**Status:** Web build (Three.js + Vite) running end-to-end. Functional but missing the "felt-real" layer.

Read `VISION.md` first for context on what we are trying to build. This memo is about **what is missing and how to close it**.

---

## 1. TL;DR

We have a working scenario engine, a config-driven world, an event bus, and most of the SOP loop wired up. What we **don't yet have** are the touches that make a serious training sim feel like one:

1. **In-place equipment animation has regressed.** Earlier we had valve handwheels and levers actually mounted on the GLBs that turned/pulled with the player's input. They are now replaced by floating "callout" widgets above the equipment. **This must come back** — the wheel on the valve should physically spin clockwise as the player drags. Same for levers, MCP glass, padlock removal, etc.
2. **Hose / foam is third-person only.** When the trainee picks up the hose or pulls the trigger, they should see a **first-person viewmodel of the hose + nozzle** in front of the camera with **foam particles emitting from the nozzle tip in screen space**, not just a generic spray spawning at the fire. This is the single biggest "feels like a video game" win we can make.
3. **NPCs are static GLB props.** No walk cycles, no reactions to fire, no path-finding. This is fine for v0 but breaks immersion when a fire ignites and nobody moves.
4. **Audio is sparse.** Footsteps are good. Valve creak, steam release, distant alarm reverb, radio static between transmissions, ambient process hum — all missing or under-mixed.
5. **No animation state machine** on equipment. Right now interactions are all-or-nothing. Real equipment has idle → approach → engage → operate → settle → disabled states with proper transitions.

The rest of this doc breaks each of those down with specific file paths, code patterns, and effort estimates.

---

## 2. Stack comparison: what we have vs Unity/Unreal native

| Capability | Unity/Unreal | Our Three.js build | Gap severity |
|---|---|---|---|
| Render pipeline | URP/HDRP/Lumen | Three.js + `postprocessing` (Bloom, SSAO, SMAA, Vignette) | **Low.** Acceptable for browser. |
| Lighting | Baked GI + lightmaps | Runtime IBL (HDRI) + dynamic lights | **Medium.** Slow shadows on >50 lights. Mitigation: bake fake AO into ground textures. |
| GLB/FBX import | Native importer w/ animation graphs | three.js `GLTFLoader`, FBX broken in our pipeline | **High.** No animation retargeting. |
| Animation state machine | Mecanim / AnimGraph | None — manually tweened with GSAP | **High.** See §3.1. |
| Physics | PhysX | None — we have a 50-line `CollisionSystem` (AABB + cylinder) | **Medium-high.** No rigid body, no joints, no soft bodies. Ammo.js / Rapier.js available if needed. |
| Particles | VFX Graph / Niagara | Custom GLSL shaders + `THREE.Points` | **Medium.** Works for fire/foam but no editor. |
| NavMesh / AI | Built-in | None | **High.** Need pathfinding for NPCs (option: `recast-navigation-js`). |
| First-person viewmodel system | Built-in | None | **High.** See §3.2. |
| Audio mixer + spatial | FMOD / Wwise / native | `THREE.Audio` (PannerNode-based) | **Medium.** Works, but no buses, no ducking. |
| Cinematics | Timeline / Sequencer | GSAP timelines (we have intro cutscene) | **Low.** Sufficient. |
| Tooling for level design | Editor + scene serialisation | `world.json` hand-written | **Medium.** No visual editor; mitigated by hot-reload. |
| Profiler | Built-in | Browser devtools + `stats.js` (not yet wired) | **Low-medium.** Add stats overlay + draw-call counter. |
| Asset hot-reload | Yes | Vite HMR (page reload only — not in-place) | **Low.** Acceptable for our cycle. |

**Conclusion:** Three.js is the right call for a browser-deliverable training sim that an instructor can open without installing anything. The gap isn't the engine — it's the systems we haven't built yet on top of it.

---

## 3. Critical regressions to fix THIS week

### 3.1 In-place valve/lever animation (REGRESSION)

**What we had earlier**

Each interactive valve/lever had a real GLB part — `industrial_valve.glb`, `gate_valve.glb`, `butterfly_valve.glb`, `padlock.glb` — placed at the right position on the host equipment. When the player dragged the lever in the action panel modal, we identified the rotating sub-mesh in the valve's GLB hierarchy (e.g. the handwheel spokes, the lever arm) and rotated **that specific node**, so the wheel visibly span clockwise on the actual valve in the world.

**What we have now**

`EquipmentAnimator` (`src/systems/EquipmentAnimator.js`) spawns a **separate floating handwheel widget** above the host model. The original GLB does not move. This is wrong — it reads as a UI callout, not as the player operating real equipment.

**Fix**

Change `EquipmentAnimator` to:

1. On `scenario:step-activated`, locate the host GLB via `worldBuilder.getPlacedModel(modelId)`.
2. Walk the GLB hierarchy looking for a child whose name matches a list of conventions:
   - `handwheel`, `wheel`, `valve_handle`, `Cube_Wheel`, `Spinner`
   - For levers: `lever`, `handle`, `Bar`, `Arm`
   - For padlocks: `shackle`, `Loop`, `padlock_top`
   - Fallback: largest child within X% of the bounding-box top
3. Cache that node as `model.userData.spinPart`.
4. On `action-panel:rotate-start`, store `spinPart.userData._origRotation`.
5. On `action-panel:accumulate-drag`, set `spinPart.rotation.y = origRotY + totalAngle * sign` (or `.x` / `.z` depending on the valve's orientation — store axis hint per model in `world.json`).
6. Keep the floating widget **only as a directional arrow** above the model (showing CW vs CCW), not as the spinning piece itself.
7. On completion, lock the rotation to the closed-position offset and play `valve_steam` audio at the model's world position (spatial).

Add per-model overrides in `world.json`:

```json
{
  "model": "industrial_valve",
  "id": "manifold_valve",
  "interaction": {
    "type": "lever",
    "spinPart": "Cube_Wheel",     // mesh name to rotate
    "axis": "y",                  // y / x / z
    "closedAngle": 1.5707963      // PI/2 — final rest pose
  }
}
```

**Files to change:** `EquipmentAnimator.js`, `WorldBuilder.js` (read `interaction` field), `world.json` (add axis hints per valve).

**Effort:** 1 day.

---

### 3.2 First-person hose viewmodel + foam from nozzle

**What we have**

`FireSystem.js` handles a hose state machine (`idle → carrying → attached → charged`). When charged, holding click sprays foam at the fire — but the foam emits from the **fire's location**, not from where the player is pointing. There is no hose mesh visible to the player.

**What we need**

A **viewmodel layer**: a separate camera or render pass that draws a hose + nozzle GLB attached to the FPS camera, positioned in the lower-right of the screen, with idle bob and fire animation. Foam particles spawn from the nozzle tip world-position and travel in the camera's forward direction with gravity + dispersion.

**Implementation sketch**

1. Create `src/systems/FirstPersonRig.js`:
   - On `hose:pickup`, load `water_hose.glb` + `fire_nozzle.glb` (already in assets).
   - Attach to `renderer.camera` as a child group at offset `(0.25, -0.3, -0.6)`.
   - Render with `mesh.layers.set(2)` and add a **second `WebGLRenderer.render` call** with a camera that only renders layer 2, no depth-clear so it draws on top.
   - Or simpler: scale the viewmodel small and put it `renderOrder: 999` with `depthTest: false` on a top-most layer.
2. Attach idle bob — sine wave on local position, multiplied by `player.isMoving`.
3. On `hose:fire-start`, play a "raise" tween (rotate nozzle up by 5°), start emitting foam from `nozzleTip` empty in the GLB.
4. `EffectsSystem` foam emitter takes a `(originVec3, directionVec3)` instead of just `targetVec3`.
5. Drive the hose mesh's CatmullRomCurve3 with a chain from `nozzle_tip → player.position → hydrant.position` so the hose visually trails behind.
6. Add a screen-space white-flash on the muzzle when foam starts (matches AAA shooter feel).

**Files to change:** new `FirstPersonRig.js`, `FireSystem.js` (emit origin from nozzle tip), `Game.js` (instantiate rig).

**Effort:** 2-3 days.

---

### 3.3 NPC animation (capsule-stick was disabled, GLB is static)

**What we have**

We disabled the capsule-and-sphere stick figures (good). We now have static `firefighter.glb` placed near the fire station + control room. They don't move.

**What we need**

At minimum, a few canned animation cycles using a real animation system:

1. **Idle pose** (currently fine — static T-pose-ish)
2. **Walk + run cycle** when fire ignites: NPCs path from current position to `FIRE_TRUCK_1` spawn point.
3. **Kneeling-pointing pose** for the SIC giving instructions near the dyke.

**Options ranked by effort**

| Option | Effort | Quality |
|---|---|---|
| Use Mixamo FBX animations on a Mixamo-rigged character, blend with three.js `AnimationMixer` | 2 days | Good |
| Use ready-rigged GLB with built-in animations from Sketchfab | 0.5 day | OK |
| Procedural IK + simple bone driver | 1 week | Excellent but overkill |

**Recommendation:** Buy/source a single rigged firefighter character with `idle.glb`, `walk.glb`, `run.glb`, `kneel.glb` clips already embedded. Replace `firefighter.glb` placement entry with a class that owns an `AnimationMixer` and blends clips on `npc:state` events.

**Files to change:** Replace `NPCSystem.js` body with proper `THREE.AnimationMixer` driven entity class.

**Effort:** 1-2 days depending on asset sourcing.

---

## 4. Major gaps by domain

### 4.1 Equipment animation state machine

Right now an interaction is one binary flip. Real equipment has stages:

```
DISABLED → IDLE → APPROACH → ENGAGE → OPERATE → SETTLE → DONE
                ↓ player walks away              ↓ cancelled
              IDLE                              IDLE
```

For each state we should be able to play an animation, set emissive, gate input, etc. Today we conflate ENGAGE and OPERATE, and SETTLE doesn't exist (the panel just closes).

**Action:** Add a tiny state machine class. Drive it from `InteractionSystem` events. Wire visual responses per state in `EquipmentAnimator`.

**Effort:** 2 days.

### 4.2 Audio (under-built)

Currently loaded:
- `fire_alarm`, `evacuation_alarm`, `fire_burning`, `radio_static`, `valve_turn`, `truck_siren`, `valve_steam`, `valve_grind`

Missing:
- **Per-step micro-cues**: handwheel-creak-loop while turning, lever-clunk on engage, padlock click, MCP glass-break, radio mic-click on press.
- **Process hum** at the dyke (continuous, low-pass) for ambience.
- **Wind & jungle ambience** (matches Numaligarh location).
- **Footstep variants** by ground type: currently we synth a single footstep regardless of surface. Use a small library: `step_concrete`, `step_asphalt`, `step_gravel`, `step_metal_grate` and switch based on raycast-down hit material.
- **Reverb for distant alarm** (use `ConvolverNode` with a free industrial IR).
- **Per-NPC voice lines** (canned WAV clips for SIC, dispatch, fire chief).

**Action:** Source 12-15 free SFX from freesound.org. Add `AudioSystem.playLoop()`, `AudioSystem.playOneShot(name, position)`, and ambient zone triggers.

**Effort:** 1.5 days.

### 4.3 Player feel

Current FPS is functional. Missing:

- **Lean** (Q/E to peek around corners) — useful in tight spaces near the dyke.
- **Sprint stamina** + breathing audio when sprinting.
- **Camera shake** on fire ignition / boil-over / explosion.
- **Mouse smoothing toggle** + sensitivity slider in pause menu.
- **Pause menu** — currently `Esc` only closes panels. There's no actual pause / resume / quit.
- **Crouch peek** at low valves (we have crouch but no benefit yet).

**Effort:** 1 day for all.

### 4.4 Scenario authoring

`scenario.json` is a flat list. For instructors we want:

- **Branching**: "if cooling water not opened in 60s, fire spreads to 101-B"
- **Time pressure** with countdown UI
- **Random valve tags** (so trainees don't just memorise "RD-101A")
- **Multi-trainee role splits** (operator / first responder / SIC)
- **Mid-scenario boil-over event** (currently only a question, not a real escalation)

**Action:** Extend scenario schema to support conditions and event hooks. Add a `ScenarioEvent` system for timed/conditional triggers.

**Effort:** 3-4 days.

### 4.5 Instructor tools

Missing entirely:

- Live spectator view (orbit camera, see what trainee sees)
- Scenario reset / jump-to-step
- Inject failure (e.g. "force valve stuck")
- Session record + export (JSON event log + screen capture)
- Debrief screen with timeline

**Effort:** 1 week (full instructor mode).

### 4.6 Performance & budget

- Add `stats.js` FPS overlay (debug build only)
- Add draw-call counter
- LOD for far GLBs (cooling towers, industrial plant) using `THREE.LOD`
- Frustum culling is automatic but we should manually disable update on out-of-view animated meshes
- Texture compression: use KTX2/Basis for all >1MB textures
- GLB mesh decimation pass for `industrial_plant.glb` (48k lines = huge)

**Effort:** 2 days.

### 4.7 Persistence & save

`SaveSystem.js` exists but isn't wired to mid-scenario state. For a training sim this matters:
- Resume after browser refresh
- Instructor can save snapshot mid-drill and replay

**Effort:** 1.5 days.

### 4.8 Onboarding / accessibility

- First-run interactive tutorial (5-step walkthrough of WASD, mouse, click, R for radio, Esc for panel)
- Subtitle toggle for narration (already we have text in HUD — promote)
- Colour-blind mode (replace red emergency with patterned indicator)
- Reduced-motion mode (disable bob, reduce camera shake)
- Keyboard remap

**Effort:** 1.5 days.

### 4.9 Cinematics & moments

Worth investing in 4-5 set-piece moments:

1. **Fire ignition** — slow zoom on tank, audio swell, then snap back to FPS (we have intro cutscene infra, reuse).
2. **First valve closed** — quick haptic flash + spark of green.
3. **Truck arrival** — siren rises in volume, camera briefly looks at truck approaching road from far away, then back.
4. **2nd turnout** — same with the bigger truck.
5. **Boil-over precursor** — camera shake + low-frequency rumble building over 5s.
6. **Extinguished** — wide aerial pull-back showing the foam-blanketed tank with smoke fading.

**Effort:** 2 days using existing GSAP infra.

---

## 5. Prioritised roadmap

### Sprint 1 (this week) — Make every interaction "feel right"

| # | Task | Owner | Effort |
|---|---|---|---|
| P0 | **In-place valve/lever animation** (§3.1) | Engineer | 1 day |
| P0 | **First-person hose viewmodel + foam** (§3.2) | Engineer | 2-3 days |
| P0 | Equipment state machine (§4.1) | Engineer | 2 days |
| P1 | Audio polish — creak, clunk, ambience (§4.2) | Engineer | 1.5 days |
| P1 | Camera shake + pause menu (§4.3) | Engineer | 1 day |

Ship: trainee opens valve → handwheel actually turns → hose visible in hands → foam from nozzle → audio creak → confirm pulse. **This is the bar.**

### Sprint 2 — Make the world live

| # | Task | Effort |
|---|---|---|
| P0 | NPC animations + walk-to-truck on fire (§3.3) | 1.5 days |
| P1 | 4-5 cinematic beats (§4.9) | 2 days |
| P2 | Performance pass + LOD (§4.6) | 2 days |
| P2 | First-run tutorial + accessibility (§4.8) | 1.5 days |

### Sprint 3 — Make it production

| # | Task | Effort |
|---|---|---|
| P0 | Branching scenario + boil-over event (§4.4) | 3-4 days |
| P1 | Instructor mode (§4.5) | 5 days |
| P2 | Save / resume / replay (§4.7) | 1.5 days |

---

## 6. Asset interaction matrix (reference)

This is the contract every interactable should fulfil. **Anything missing a column = bug.**

| Step | Host GLB | Spinning sub-mesh | Action type | Audio cue | Visual confirm |
|---|---|---|---|---|---|
| `sound_mcp_alarm` | `fire_alarm_button.glb` | (button push) | press + glass-break | glass shatter + alarm tone | red beacon flashes |
| `close_roof_drain` | `butterfly_valve.glb` | handle disc | rotate CW 2 turns | creak loop → clunk → steam hiss | green flash + handle locked |
| `close_dyke_valve` | `gate_valve.glb` | handwheel | rotate CW 2 turns | creak loop → clunk | green flash |
| `isolate_manifold` | `industrial_valve.glb` | handwheel + lever | rotate CW quarter-turn (lever) | grind → clunk | LOTO padlock attaches |
| `alert_fire_safety` | `walkie_talkie.glb` | (pickup) | grab + raise | radio click | radio appears in HUD |
| `report_tank_data` / `start_product_transfer` / `request_2nd_turnout` / `request_foam` | radio panel | n/a | press transmit | mic key + static + reply | radio panel ack |
| `open_cooling_valve` | `industrial_valve.glb` | handwheel | rotate CCW 2 turns | creak → water rush | water spray ring activates on 101-B |
| `position_tender_1/2` | `fire_truck.glb` | (positioning) | guide via marker | siren spool-down | truck parks at hydrant |
| `connect_hose_1/2` | `water_hose.glb` + `fire_hydrant.glb` | hose end + hydrant cap | grab + connect + open | click + water rush | hose pressurises |
| `open_spray_101b` | spray ring (procedural) | n/a | observe + tick | water mist sound | green coverage indicator |
| `check_boilover` | `tank_main.glb` | n/a | observe 3s | low rumble | scan reticle confirms |

**Today only the radio + hydrant flows partially fulfil this. The valve column is the regression.**

---

## 7. Decisions we need from you

1. **Animation source for NPCs** — buy a Mixamo character pack ($) or DIY rig?
2. **Physics library** — leave with manual collision, or pull in Rapier.js (~250kb gzipped) for proper hose physics?
3. **Audio source** — freesound.org CC0 only, or budget for a small SFX pack?
4. **Instructor mode priority** — needed for v1, or v2?
5. **Multi-trainee** — design for now or defer?
6. **VR build** — keep on roadmap or kill?

---

## 8. What "done" looks like (revised)

A trainee opens the URL, completes the scenario in 5-8 minutes, and afterwards reports:

> *"It felt like I was actually closing those valves. I could hear the wheel groan. The hose kicked in my hands when I pulled the trigger. I forgot it was a browser tab."*

If we're not getting that quote, we're not done.

---

**Reply with line-item agreement / pushback per section before we begin Sprint 1.**
