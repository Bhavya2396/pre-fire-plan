# Pre-Fire Plan Simulation — Vision & Spec

A first-person training simulator that teaches the **on-site emergency response procedure for a tank-fire incident at an oil refinery**, modelled after the **Numaligarh Refinery (NRL)** in Assam, India.

The user assumes the role of a **trainee shift operator** on night patrol. A fire ignites on Tank 101-A. Their job is to execute the official emergency Standard Operating Procedure (SOP), in the correct order, while being assessed on time and decision quality.

---

## 1. Why this exists

Refinery fire-response training today is mostly:
- Classroom slide decks (passive, low retention)
- Annual mock drills (expensive, infrequent, no measurement)
- Paper SOPs (read once, never internalised)

We want a **repeatable, measurable, immersive sandbox** where a trainee can:
1. Walk the actual physical layout
2. Execute every SOP step with their own hands (open/close valves, raise alarms, work the radio)
3. Get instant feedback when they act out of order or make a wrong call
4. Receive a graded debrief at the end (timing, warnings, decisions)

---

## 2. The reference: Numaligarh Refinery aesthetic

Every visual decision is anchored to NRL's actual look (see `assets/NRL_*.png`):

| Element | Visual signature |
|---|---|
| Pipework | Raw galvanized steel + insulated white sections. **No painted colours.** |
| Buildings | **Green-clad metal sheds** with white trim bands + occasional **blue admin block** |
| Process | Tall **white distillation columns**, **white spherical LPG tanks** on legs, open scaffolding |
| Site | Dense **oak/jungle forest** wraps the entire perimeter |
| Safety markings | Muted ochre yellow handrails (not neon) + red-and-white striped flare stack |
| Lighting | Bright tropical daytime, with operating site lights for ambience |

If a procedural element looks "cartoon-coloured" or feels generic, it's wrong.

---

## 3. The pedagogy

The simulation follows a structured **WHY → WHAT → ACTION → CONFIRM** loop for every step:

1. **WHY** — Phase intro narration (Shift-in-Charge): explains why this phase matters
   _e.g. "OPERATIONS RESPONSE. Eight steps. We raise the alarm, contain the spill, isolate the tank, then call Fire & Safety."_
2. **WHAT** — Step guidance ("STEP N: <one-line purpose + location>")
3. **ACTION** — In-world interactive widget (handwheel, button, radio) + on-screen SOP modal with **identification questions + procedure drills + lever drag**
4. **CONFIRM** — Green flash on the equipment + audible confirmation + checklist tick

Doing steps **out of order** triggers a warning that counts against the final score.

### Phases

| # | Phase | Steps |
|---|---|---|
| 0 | PATROL | Walk the tank farm before fire ignites |
| 1 | OPS RESPONSE | 8 steps: MCP → roof drain → dyke valve → manifold isolation → radio pickup → report → cooling water → product transfer request |
| 2 | 1ST TURNOUT | Fire tender at H-28: position, connect hose, verify spray ring, request 2nd turnout |
| 3 | 2ND TURNOUT | HEFG at H-20: position, connect, request foam nurser, observe shell for boil-over |
| 4 | COMPLETE | Score screen: total time, warnings, grade |

---

## 4. Architecture (clean, event-driven)

```
src/
├── core/             EventBus · Renderer · AssetManager · InputManager
├── world/            WorldBuilder · ProceduralFactory · InstancedRenderer
├── systems/          PlayerController · CollisionSystem · InteractionSystem
│                     ScenarioRunner · AudioSystem · FireSystem · WeatherSystem
│                     EffectsSystem · NPCSystem · SaveSystem · ScoringSystem
│                     EquipmentAnimator
├── ui/               HUD · ActionPanel · RadioPanel · Minimap
├── config/           assets.json · world.json · scenario.json
└── Game.js           Orchestrator (wires events, owns lifecycle)
```

**Principles**
- **Config-driven**: World layout, asset list, and scenario flow live in JSON. Code interprets data.
- **Event-driven**: Systems communicate via `EventBus`. No system reaches into another's internals.
- **No god-objects**: `Game.js` only orchestrates; logic lives in dedicated systems.
- **Auto-scaling GLBs**: `targetSize` field auto-fits any model to a target longest-axis size, no manual scale guesswork.
- **Auto-colliders**: `collision: { type, radius?, shrink? }` on a placement auto-generates a box or cylinder collider.

---

## 5. Interactivity contract

Every scenario step that requires player action **must**:

1. **Highlight** the target equipment (orange emissive pulse) when activated
2. **Spawn a 3D widget** floating above the target as a visual call-out:
   - Valves → orange handwheel that physically spins on drag
   - MCP / alarms → flashing red dome beacon with point-light
   - Pickups (radio, etc.) → blue down-arrow cone
   - Observations (boil-over check) → green scan reticle
3. **Open the SOP modal** with: identification question + direction question + lever drag + verification question
4. **Animate in-world** as you operate — the handwheel turns CW or CCW in real time as you drag
5. **Confirm with green flash** + audio + checklist tick on completion

If a step doesn't visibly react to player input, it's broken.

---

## 6. Error-proofing

- Out-of-order steps → **warning notification + counter increment** (counts against grade)
- Cancelled action panels → state cleanly reset, can re-enter
- Asset load failures → logged, gracefully skipped (no crashes)
- Oversized GLBs → `WorldBuilder` logs `OVERSIZED` warning at >50m, `info` at >25m
- Player can't walk through tanks, warehouses, generators, containers, sheds (auto-colliders)
- Action-panel mouse listeners attached/detached cleanly (no zombie handlers)
- Pointer-lock state respected across modals (no stuck cameras)

---

## 7. Asset inventory & status

### GLB models (in `/public/models/`, registered in `assets.json`)

| Model | Used | Purpose |
|---|---|---|
| `tank_main`, `tank_secondary` | ✅ | Main 101-A (fire) + 101-B in dyke |
| `industrial_valve`, `gate_valve`, `butterfly_valve` | ✅ | Manifold + dyke + roof drain valves |
| `padlock` | ✅ | LOTO marker |
| `walkie_talkie` | ✅ | Emergency radio pickup |
| `fire_hydrant` | ✅ | H-28, H-27, H-20 + perimeter hydrants |
| `fire_nozzle`, `water_hose`, `water_monitor`, `hohlstrahlrohr` | ✅ | Hose kit at hydrant staging |
| `fire_truck` | ✅ | Spawned dynamically per turnout phase |
| `fire_extinguisher`, `hydrant_key` | ✅ | Safety gear at safety points |
| `control_station`, `control_desk` | ✅ | South-east control area |
| `fire_alarm_button` | ✅ | Manual Call Point on control room wall |
| `pipe_kit`, `pipeline`, `pipe_rack`, `catwalk` | ✅ | Process piping clusters |
| `industrial_plant`, `distillation_column`, `cooling_tower`, `heat_exchanger` | ✅ | North process backdrop |
| `chemical_tank`, `oil_tank` | ✅ | Storage tank clusters east + west |
| `transformer`, `diesel_generator`, `light_tower` | ✅ | Substation + lighting |
| `abandoned_warehouse`, `warehouse`, `old_shed` | ✅ | Perimeter outbuildings |
| `containers` | ✅ | Container storage yard |
| `traffic_cone`, `jersey_barrier` | ✅ | Road safety markers |
| `firefighter` | ⏸ Phase 2 | T-pose mesh — parked until Mixamo rig + skinned animations land |
| `oak_trees` | ✅ | Forest perimeter (Numaligarh jungle backdrop) |
| `green_tunnel` | ✅ | NRL signature covered walkway in pipe-rack corridor (north of dyke) |

### Procedural elements (`ProceduralFactory.js`)

- Ground (grass + concrete slab + gravel)
- Roads (10, 12, 15, Service)
- Dyke walls + gate posts (with gate gaps)
- Tank pads + ladders + drain channels
- Equipment shed
- **Flare stack** (white/red striped + flame sphere + beacon light)
- **Blue admin + fire station buildings**
- Galvanized ground pipes + cable trays + yellow handrails
- **Green-clad metal sheds** (NRL signature)
- **White spherical LPG tanks** on legs

---

## 8. Scoring

| Metric | Weight |
|---|---|
| Total elapsed time | Major |
| Warnings (out-of-order steps) | Major |
| Action-panel wrong attempts | Minor |

Final grade: PERFECT / GOOD / FAIR / NEEDS REVIEW.

---

## 9. Roadmap (locked decisions)

**Tech decisions locked for v1:**
- **NPCs**: **Mixamo FBX rigs** (not Sketchfab one-off rigs). Animation set: `Walking`, `Run`, `firefighter_idle`, `kneeling_pointing`, plus the Chimney drop (`carrying`, `Climbing Ladder`, `Pointing`, `Pulling Lever`).
- **Hose physics**: **No Rapier.js** for v1. Hose stays as a `CatmullRomCurve3` visual with a shader spray cone. Physics integration is parked for v2.
- **Platform**: **First-person desktop only**. **No VR / WebXR**. (Mouse-look + WASD + pointer lock is the input contract.)
- **Bundle size**: No hard ceiling — features win. Heavy GLBs (`green_tunnel`, `fire_truck`, `industrial_plant`) get LOD/decimation only if frame-rate budget is breached.

**Feature roadmap (post-cleanup):**
- [ ] **Phase 0 cleanup** (in progress): clean `world.json` layout, decongested zoning, green-tunnel signature
- [ ] **Phase 1 — In-mesh equipment animation**: drop the floating handwheel widget; rotate the actual `helm_01` / `Armature_9` / `pipe_handle` sub-meshes discovered in the GLB inspector
- [ ] **Phase 2 — Mixamo NPCs**: skinned firefighters running between fire station, truck, and hydrant on phase events; idle bob at staging
- [ ] **Phase 3 — Hose viewmodel**: nozzle parented to camera, jet origin = camera forward, dynamic CatmullRom hose tube to hydrant
- [ ] **Phase 4 — Boil-over event**: timed visual escalation with pre-warnings during 2nd turnout
- [ ] **Phase 5 — Audio richness**: integrate Chimney drop (diesel idle, radio static, factory ambience, metal footsteps, steam release, PA call) + ducking for narration
- [ ] **Phase 6 — Multiple scenarios + instructor dashboard**: live spectator view, scenario reset/jump, randomised valve tags
- [ ] **Phase 7 (deferred)** — Multi-trainee co-op (operator / firefighter / SIC role separation)

**Explicitly out of scope:** VR, gamepad, mobile/touch.

---

## 10. Done criteria for "production-ready v1"

A naive trainee, given only the start screen, must be able to:
- ✅ Walk around the facility freely without getting stuck
- ✅ Identify every interactive element via floating widget + emissive pulse
- ✅ Complete all 4 phases sequentially
- ✅ Hear logical narration matching what they see
- ✅ Receive a graded debrief at the end
- ✅ Re-run from scratch with one click

When a trainee finishes the scenario in **5–8 minutes** with **0–1 warnings** and **rates the experience as "felt real"**, we ship.
