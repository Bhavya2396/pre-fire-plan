import * as THREE from 'three';
import { gsap } from 'gsap';

import EventBus from './core/EventBus.js';
import Renderer from './core/Renderer.js';
import AssetManager from './core/AssetManager.js';
import InputManager from './core/InputManager.js';
import WorldBuilder from './world/WorldBuilder.js';
import PlayerController from './systems/PlayerController.js';
import CollisionSystem from './systems/CollisionSystem.js';
import InteractionSystem from './systems/InteractionSystem.js';
import ScenarioRunner from './systems/ScenarioRunner.js';
import AudioSystem from './systems/AudioSystem.js';
import FireSystem from './systems/FireSystem.js';
import WeatherSystem from './systems/WeatherSystem.js';
import EffectsSystem from './systems/EffectsSystem.js';
import NPCSystem from './systems/NPCSystem.js';
import SaveSystem from './systems/SaveSystem.js';
import ScoringSystem from './systems/ScoringSystem.js';
import EquipmentAnimator from './systems/EquipmentAnimator.js';
import HUD from './ui/HUD.js';
import ActionPanel from './ui/ActionPanel.js';
import RadioPanel from './ui/RadioPanel.js';
import Minimap from './ui/Minimap.js';

// Steps where the player physically grabs the handwheel and drags it
// instead of going through a modal quiz. Direction = which way fully
// closes/opens the valve. Rotations = how many full turns required.
const DIRECT_VALVE_STEPS = {
  close_roof_drain:   { direction: 'cw',  rotations: 2,    label: 'CLOSE ROOF DRAIN VALVE',         dirHint: 'CLOCKWISE ↻' },
  close_dyke_valve:   { direction: 'cw',  rotations: 2,    label: 'CLOSE DYKE DRAIN VALVE',         dirHint: 'CLOCKWISE ↻' },
  isolate_manifold:   { direction: 'cw',  rotations: 0.25, label: 'ISOLATE MANIFOLD MV-101A',       dirHint: 'CLOCKWISE — quarter-turn' },
  open_cooling_valve: { direction: 'ccw', rotations: 2,    label: 'OPEN COOLING WATER CW-101B',     dirHint: 'COUNTER-CLOCKWISE ↺' },
};

class Game {
  constructor() {
    this.bus = new EventBus();
    this.canvas = document.getElementById('viewport');
    this.running = false;
    this._prevTime = 0;
    this._cutsceneActive = false;

    /* Reusable scratch vectors — the per-frame loop used to allocate
       a fresh Vector3 in three places (camera direction × 2 for the
       minimap angle, plus one for the objective arrow target/projection)
       which fed steady garbage into the GC every frame. Held on the
       instance and reused so the loop is allocation-free. */
    this._scratchDir = new THREE.Vector3();
    this._objArrowTarget = new THREE.Vector3();
    this._objArrowNDC = new THREE.Vector3();
  }

  async init() {
    const bus = this.bus;

    this.renderer = new Renderer(this.canvas, bus);
    this.assets = new AssetManager(bus);
    this.input = new InputManager(this.canvas, bus);

    this.hud = new HUD(bus);
    this.actionPanel = new ActionPanel(bus);
    this.radioPanel = new RadioPanel(bus);
    this.minimap = new Minimap(bus);

    this.player = new PlayerController(this.renderer.camera, bus);
    this.collision = new CollisionSystem();
    this.player.collisionSystem = this.collision;

    this.interaction = new InteractionSystem(
      this.renderer.camera, this.renderer.scene, bus
    );

    this.scenario = new ScenarioRunner(bus);
    this.audio = new AudioSystem(this.renderer.scene, this.renderer.camera, bus);
    this.fire = new FireSystem(this.renderer.scene, this.renderer.camera, bus);
    this.weather = new WeatherSystem(this.renderer.scene, bus);
    this.effects = new EffectsSystem(this.renderer.scene, bus);
    this.npc = new NPCSystem(this.renderer.scene, bus, this.assets);
    this.save = new SaveSystem(bus);
    this.scoring = new ScoringSystem(bus);

    this._wireEvents();

    /* Parallel-load HDR + GLB/audio/FBX. Previously these ran in series
       so the loading bar sat on "Loading environment..." for the full
       HDR roundtrip before any GLB started downloading. The two pools
       share network bandwidth fine and the WorldBuilder doesn't need
       the HDR until it places models, by which point both are done. */
    bus.emit('ui:loading-progress', 0, 'Loading environment & assets...');
    let envP = 0, assetsP = 0;
    const reportLoad = (label) => {
      const total = envP * 0.1 + assetsP * 0.8;
      bus.emit('ui:loading-progress', total, label);
    };
    await Promise.all([
      this.renderer.loadEnvironment((p) => {
        envP = p;
        reportLoad('Loading environment...');
      }),
      this.assets.loadAll((fraction, label) => {
        assetsP = fraction;
        reportLoad(label);
      }),
    ]);

    bus.emit('ui:loading-progress', 0.9, 'Building world...');
    this.world = new WorldBuilder(this.renderer.scene, this.assets, bus, this.collision);
    await this.world.build();

    this._setupCollisions();
    this._setupInteractables();
    this._setupFirePosition();

    this.animator = new EquipmentAnimator(bus, this.world, this.renderer.scene);

    // NPC spawning disabled — animations not loading correctly.
    // this.npc.spawnDefaultPosers();

    this.audio.init(this.assets);
    // Ambient backbone — plant hum + wind. Both fade in at audio.start()
    // so the world isn't dead silent during PATROL. Volumes are very low
    // so they don't compete with narration / alarms.
    this.audio.addAmbientLayer('industrial', 0.05);
    this.audio.addAmbientLayer('wind', 0.03);
    this._handleMouseForHose();
    this._setupMinimapLandmarks();
    this._setupResumeOverlay();
    this._initGlassBreakVFX();

    bus.emit('ui:loading-progress', 1, 'Ready');
    bus.emit('ui:hide-loading');
    bus.emit('ui:show-start');

    // Static shadow map is currently empty (we set autoUpdate=false in
    // Renderer). Schedule one re-bake AFTER the next frame so every GLB
    // has had a chance to upload its geometry. Subsequent shadow bakes
    // only happen if a system explicitly calls renderer.markShadowsDirty().
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.renderer.markShadowsDirty());
    });

    this._bindStart();
  }

  _wireEvents() {
    const bus = this.bus;

    bus.on('action-panel:complete', (stepId) => {
      if (this._panelData) {
        this._panelData.completed = true;
        this._panelData._panelOpen = false;
        this._panelData = null;
      }
      this.scenario.completeStep(stepId);
      this._returnToGameplay();
    });

    bus.on('action-panel:cancel', () => {
      if (this._panelData) {
        this._panelData._panelOpen = false;
        this._panelData = null;
      }
      this._returnToGameplay();
    });

    bus.on('action-panel:rotate-start', (direction, rotations, stepId) => {
      // The new direct in-world valve grab also emits this event so the
      // EquipmentAnimator can bind the spin part. Don't override the
      // direct controller's onGrabDelta callback in that case.
      if (this._directActive) return;
      this.player.grabMode = true;
      this._setupValveGrab(direction, rotations);
    });

    bus.on('action-panel:rotate-end', () => {
      if (this._directActive) return;
      this.player.grabMode = false;
      this.player.onGrabDelta = null;
      this.canvas.requestPointerLock();
    });

    bus.on('radio:transmit', (msg) => {
      this.scenario.handleRadioMessage(msg);
    });

    bus.on('radio:close', () => {
      this._returnToGameplay();
    });

    bus.on('interaction:simple', (data) => {
      this._handleSimpleInteraction(data);
    });

    bus.on('interaction:valve-complete', (data) => {
      if (data.stepId) this.scenario.completeStep(data.stepId);
      bus.emit('audio:play', 'valve_turn');
      if (data.notification) bus.emit('ui:notification', data.notification, 3000);
    });

    bus.on('interaction:observe-complete', (data) => {
      if (data.stepId) this.scenario.completeStep(data.stepId);
      bus.emit('ui:notification', data.notification || 'OBSERVATION COMPLETE', 3000);
    });

    bus.on('scenario:step-activated', (stepId) => {
      const pos = this._getWaypointForStep(stepId);
      if (pos) {
        const label = this._getLabelForStep(stepId);
        bus.emit('waypoint:set', { x: pos[0], z: pos[2] }, label);
        this._activeObjective = { x: pos[0], y: (pos[1] ?? 1.5), z: pos[2], label };
      } else {
        /* No waypoint defined for this step (e.g. radio-only or
           cutscene step). Clear the minimap dot AND the on-screen
           arrow so the previous step's marker doesn't linger. */
        this._activeObjective = null;
        bus.emit('waypoint:clear');
        this._hideObjectiveArrow();
      }
    });

    /* Single shutdown handler for end-of-scenario: clears the
       objective UI, kills the loop, and resets the hose so the
       score screen isn't sitting underneath a still-charged nozzle
       and a "HOSE CONNECTED" HUD chip. ScoringSystem owns the
       ui:score emission with rich rows/grade. */
    bus.on('scenario:complete', () => {
      this._activeObjective = null;
      bus.emit('waypoint:clear');
      this._hideObjectiveArrow();
      this.running = false;
      bus.emit('hose:drop');
      this._updateHoseHUD('idle');
    });

    bus.on('scenario:phase-change', (data) => {
      if (data.phase === 'FIRST_TURNOUT') this._spawnFireTruck(1);
      if (data.phase === 'SECOND_TURNOUT') this._spawnFireTruck(2);
    });

    // Once foam has been radioed in, swap the spray medium from raw
    // water to AFFF foam — visually creamy, ~60% faster knockdown.
    bus.on('scenario:step-complete', ({ stepId }) => {
      if (stepId === 'request_foam') {
        this.fire.setSprayMode('foam');
        bus.emit('ui:notification', 'FOAM NURSER ON LINE — Hose now delivering AFFF', 4000);
      }
    });

    // Hiss + brief steam puff feedback when the stream lands on the
    // tank. Throttled inside FireSystem to ~3 Hz.
    bus.on('tank:cooling', () => {
      bus.emit('audio:play', 'valve_steam');
    });

    bus.on('fire:extinguished', () => {
      bus.emit('ui:notification', 'FIRE EXTINGUISHED — FOAM BLANKET APPLIED', 5000);
      this.fire.stopFire();
      bus.emit('alarm:off');
      bus.emit('fire:stopped');

      setTimeout(() => {
        this.scenario.forceComplete();
      }, 3000);
    });

    bus.on('hose:state-change', (state) => {
      this._updateHoseHUD(state);
      /* When the player picks up / attaches / drops the hose during a
         connect_hose_X step, the waypoint resolver wants to flip the
         arrow from "hose pile" → "hydrant" (or back). Re-fire the
         step-activated wiring for the current step so the arrow moves
         in real time without waiting for the next step transition. */
      const cur = this.scenario?.getCurrentStepId?.();
      if (cur === 'connect_hose_1' || cur === 'connect_hose_2') {
        bus.emit('scenario:step-activated', cur);
      }
    });

    // Radio open is gated by:
    //   1. KeyR pressed
    //   2. radio is in the active step's allowed channels
    //   3. RadioPanel isn't already visible (it has its own R-to-close)
    //   4. 250 ms cooldown after last open/close to avoid the keydown
    //      that closed the panel re-opening it the same frame.
    this._radioCooldownUntil = 0;
    bus.on('input:keydown', (code) => {
      if (code !== 'KeyR') return;
      if (!this.scenario.radioActive) return;
      if (this.radioPanel.visible) return;
      if (performance.now() < this._radioCooldownUntil) return;
      const stepId = this._getCurrentRadioStepId();
      const msgs = this.scenario.getRadioMessages();
      if (msgs.length > 0) {
        this._radioCooldownUntil = performance.now() + 250;
        bus.emit('radio:open', stepId, msgs);
      }
    });
    // RadioPanel close also bumps the cooldown so a press-and-release
    // doesn't immediately re-open.
    bus.on('radio:close', () => {
      this._radioCooldownUntil = performance.now() + 250;
    });

    /* Escape during a direct world interaction (valve grab, MCP smash)
       used to leave the player wedged in grabMode forever — no Esc
       handler existed, only ActionPanel had one. Wire a single cancel
       path that mirrors the cleanup the natural completion would do
       so the player can always back out. */
    bus.on('input:keydown', (code) => {
      if (code !== 'Escape') return;
      if (!this._directActive) return;
      this._cancelDirectInteraction();
    });
  }

  _cancelDirectInteraction() {
    /* Common cleanup for both _startWorldValve and _startWorldSmash —
       the natural completion paths each do this; this is the "ESC
       pressed mid-grab" shortcut so we don't trap the player. */
    this._directActive = false;
    if (this.player) {
      this.player.grabMode = false;
      this.player.onGrabDelta = null;
    }
    this._valveInertia = null;
    this._valveCtx = null;
    if (this._onSmashClick) {
      this.canvas.removeEventListener('mousedown', this._onSmashClick);
      this._onSmashClick = null;
    }
    this._smashState = null;
    const ghud = document.getElementById('valve-grab-hud');
    if (ghud) ghud.style.display = 'none';
    this.bus.emit('action-panel:rotate-end');
    this.bus.emit('ui:notification', 'Cancelled', 1200);
  }

  _bindStart() {
    const startBtn = document.getElementById('start-btn');
    const scoreRestart = document.getElementById('score-restart');

    const startGame = () => {
      this.bus.emit('ui:hide-start');

      gsap.to('#start-screen', {
        opacity: 0,
        duration: 0.8,
        onComplete: () => {
          this.bus.emit('ui:show-hud');
          this.input.enable();
          this.player.enable();
          this.interaction.enable();
          this.audio.resumeContext();
          this.audio.start();
          this.running = true;
          this._prevTime = performance.now();

          this._playIntroCutscene(() => {
            this.input.requestPointerLock();
            this.scenario.start();
          });

          this._loop();
        },
      });
    };

    startBtn.addEventListener('click', startGame, { once: true });
    scoreRestart.addEventListener('click', () => location.reload());
  }

  _playIntroCutscene(onDone) {
    this._cutsceneActive = true;
    const cam = this.renderer.camera;
    const startPos = { x: 0, y: 8, z: 80 };
    const endPos = { x: this.player.position.x, y: this.player.eyeHeight, z: this.player.position.z };

    cam.position.set(startPos.x, startPos.y, startPos.z);
    cam.lookAt(-5, 6, 0);

    gsap.to(cam.position, {
      x: endPos.x,
      y: endPos.y,
      z: endPos.z,
      duration: 3.5,
      ease: 'power2.inOut',
      onComplete: () => {
        this._cutsceneActive = false;
        cam.position.set(this.player.position.x, this.player.eyeHeight, this.player.position.z);
        // Set the player's initial yaw to look north (toward dyke/tanks)
        this.player._yaw = 0;
        this.player._pitch = 0;
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        cam.quaternion.setFromEuler(euler);
        if (onDone) onDone();
      },
    });
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const now = performance.now();
    const delta = Math.min((now - this._prevTime) / 1000, 0.1);
    this._prevTime = now;
    const elapsed = now / 1000;

    if (!this._cutsceneActive) {
      this.player.update(delta);
    }

    this.scenario.update(delta, this.player.position);
    this.renderer.update(elapsed);
    this.fire.update(delta, this.player.position);
    this.audio.update(this.player.position);

    // Heat overlay + fire roar gain by distance from TANK_A.
    if (this.scenario.fireStarted) {
      const fp = this.world.getPositions().TANK_A;
      const dx = this.player.position.x - fp[0];
      const dz = this.player.position.z - fp[2];
      const fireDist = Math.sqrt(dx * dx + dz * dz);
      this.audio.setFireDistance(fireDist);
      // Heat overlay: opacity 0 at >15 m, ramps to 0.6 at <4 m.
      const NEAR = 4, FAR = 15, MAX = 0.6;
      const t = Math.max(0, Math.min(1, (FAR - fireDist) / (FAR - NEAR)));
      this.hud.setHeatOpacity(t * MAX);
    } else {
      this.hud.setHeatOpacity(0);
    }
    this.weather.update(delta);
    this.effects.update(delta);
    this.npc.update(delta, this.player.position);
    /* Billboard handwheels to face the player camera each frame. */
    this.animator.update(this.renderer.camera);

    // Wheel inertia: if the player has stopped dragging but the wheel
    // still has angular velocity, keep crediting progress (in correct
    // direction) and visually spinning until friction wins.
    if (this._valveInertia && this._valveCtx && this._valveInertia.vel > 0.05) {
      const friction = 2.5;
      this._valveInertia.vel = Math.max(0, this._valveInertia.vel - friction * delta);
      const adv = this._valveInertia.vel * delta;
      this._valveCtx.addTotal(adv);
      // Visual spin in the correct direction
      this.bus.emit('action-panel:rotate-tick', adv * this._valveCtx.sign);
      const total = this._valveCtx.getTotal();
      const pct = Math.min(1, total / this._valveCtx.targetAngle);
      if (this._valveCtx.ring) {
        this._valveCtx.ring.setAttribute(
          'stroke-dashoffset', (this._valveCtx.RING_C * (1 - pct)).toFixed(1),
        );
      }
      if (this._valveCtx.pctEl) this._valveCtx.pctEl.textContent = `${Math.floor(pct * 100)}%`;
      if (pct >= 1) this._completeWorldValve(this._valveCtx.data);
    }

    const interactData = this.interaction.update(delta);
    this._updateInteractPrompt(interactData);
    this._updateObjectiveArrow();

    /* Camera world direction once per frame, into a scratch vector. */
    this.renderer.camera.getWorldDirection(this._scratchDir);
    const angle = Math.atan2(-this._scratchDir.x, -this._scratchDir.z);
    this.minimap.update(this.player.position, angle);

    this.renderer.render();
  }

  _updateInteractPrompt(data) {
    if (data && !data.completed) {
      this.bus.emit('ui:crosshair', true);
      const label = data.prompt || data.type?.toUpperCase() || 'INTERACT';
      const hint = data.hint || 'Click to interact';
      this.bus.emit('ui:interact-prompt', label, hint);

      if (data.observeProgress !== undefined) {
        this.bus.emit('ui:observe-progress', data.observeProgress);
      } else {
        this.bus.emit('ui:hide-observe');
      }

      const vp = this.interaction.getValveProgress();
      if (vp >= 0) {
        this.bus.emit('ui:valve-progress', vp);
      } else {
        this.bus.emit('ui:hide-valve');
      }
    } else {
      this.bus.emit('ui:crosshair', false);
      this.bus.emit('ui:hide-interact');
      this.bus.emit('ui:hide-valve');
      this.bus.emit('ui:hide-observe');
    }
  }

  /* ── Off-screen objective arrow + on-screen label ─────── */

  _updateObjectiveArrow() {
    const arrow = document.getElementById('objective-arrow');
    const labelEl = document.getElementById('objective-label');
    const distEl = document.getElementById('objective-distance');
    const obj = this._activeObjective;
    if (!arrow || !labelEl || !distEl) return;
    if (!obj) {
      arrow.style.opacity = '0';
      labelEl.textContent = '';
      distEl.textContent = '';
      return;
    }

    const cam = this.renderer.camera;
    const target = this._objArrowTarget.set(obj.x, obj.y, obj.z);
    const dist = cam.position.distanceTo(target);
    distEl.textContent = `${Math.round(dist)}m`;
    labelEl.textContent = obj.label || 'OBJECTIVE';

    /* Project the (reused) target into NDC by copying it into our second
       scratch vector first — `project()` mutates the receiver. */
    const ndc = this._objArrowNDC.copy(target).project(cam);
    const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95;

    const w = window.innerWidth;
    const h = window.innerHeight;

    if (onScreen) {
      arrow.style.opacity = '0';
      return;
    }

    // Off-screen — pin the arrow to the screen edge in the direction of
    // the projected vector, with a 60 px margin.
    let x = ndc.x;
    let y = ndc.y;
    if (ndc.z >= 1) { x = -x; y = -y; } // behind the camera

    const margin = 60;
    const halfW = w / 2 - margin;
    const halfH = h / 2 - margin;
    // Scale so the largest of |x|/|y| reaches its half-extent
    const ax = Math.abs(x) || 1e-6;
    const ay = Math.abs(y) || 1e-6;
    const scale = Math.min(halfW / ax, halfH / ay);
    const sx = w / 2 + x * scale;
    const sy = h / 2 - y * scale;
    arrow.style.left = `${sx - 12}px`;
    arrow.style.top = `${sy - 12}px`;
    // Rotate the ▲ glyph to point at the objective from the screen centre
    const angle = Math.atan2(-y, x) - Math.PI / 2;
    arrow.style.transform = `rotate(${angle}rad)`;
    arrow.style.opacity = '1';
  }

  _hideObjectiveArrow() {
    const arrow = document.getElementById('objective-arrow');
    const labelEl = document.getElementById('objective-label');
    const distEl = document.getElementById('objective-distance');
    if (arrow) arrow.style.opacity = '0';
    if (labelEl) labelEl.textContent = '';
    if (distEl) distEl.textContent = '';
  }

  _handleSimpleInteraction(data) {
    if (data.completed || data._panelOpen) return;

    /* While a direct world interaction (valve grab, MCP smash) is active,
       the 3D interaction owns all mouse input via its own canvas listener.
       Allowing clicks to fall through here would trigger the default
       "complete step" path on the 2nd and 3rd smash strikes, finishing
       the step before the shard burst fires. Gate every click until the
       direct interaction ends. */
    if (this._directActive) return;

    // Gate: only allow interaction for the currently active scenario step.
    // Hose ATTACH is exempt (multi-click sequence: attach → charge),
    // but PICKUP must still be locked to the matching active step so
    // players can't grab a hose mid-radio or pre-fire.
    if (data.stepId && !this.scenario.isStepActive(data.stepId)) {
      const exempt = data.hoseAction === 'attach' && this.fire.getHoseState() !== 'idle';
      if (!exempt) {
        const currentId = this.scenario.getCurrentStepId();
        this.bus.emit('ui:notification', `Complete "${currentId}" first`, 2000);
        return;
      }
    }

    // ── Direct in-world manipulation (no modal) ────────────
    // Valves and MCP get pure 3D interactions: grab+drag the wheel,
    // smash glass on the model. Bypasses the quiz panel entirely.
    if (DIRECT_VALVE_STEPS[data.stepId]) {
      this._startWorldValve(data);
      return;
    }
    if (data.stepId === 'sound_mcp_alarm') {
      this._startWorldSmash(data);
      return;
    }

    if (data.hoseAction === 'pickup') {
      const st = this.fire.getHoseState();
      if (st === 'carrying') {
        const carriedFor = this.fire.getHoseId();
        const tagFor = (carriedFor || '').toUpperCase().replace('H', 'H-') || 'a hydrant';
        this.bus.emit('ui:notification', `Already carrying hose for ${tagFor}`, 2200);
        return;
      }
      if (st !== 'idle') {
        this.bus.emit('ui:notification', 'Drop the existing hose first', 2200);
        return;
      }
      this.bus.emit('hose:pickup', data.hoseId || null);
      const tag = (data.hoseId || 'h').toUpperCase().replace('H', 'H-');
      this.bus.emit('ui:notification', `HOSE PICKED UP — Walk to hydrant ${tag}`, 4000);
      /* Pickup itself doesn't complete the step — attaching at the
         hydrant does. We still mark this trigger completed so the pile
         doesn't keep prompting. invalidateCache() drops the pile's
         meshes from the active raycast list immediately. */
      data.completed = true;
      this.interaction.invalidateCache();
      return;
    }

    if (data.hoseAction === 'attach') {
      const st = this.fire.getHoseState();
      const carriedFor = this.fire.getHoseId();
      if (st === 'idle') {
        const tag = (data.hoseId || 'h').toUpperCase().replace('H', 'H-');
        this.bus.emit('ui:notification', `Pick up the hose for ${tag} first`, 2500);
        return;
      }
      if (st === 'carrying') {
        if (data.hoseId && carriedFor && carriedFor !== data.hoseId) {
          const expected = (carriedFor || '').toUpperCase().replace('H', 'H-');
          this.bus.emit('ui:notification', `Wrong hydrant — that hose is for ${expected}`, 2500);
          return;
        }
        const pos = this.world.getPositions();
        const hydKey = data.hoseId === 'h20' ? 'HYDRANT_H20' : 'HYDRANT_H28';
        this.bus.emit('hose:attach', new THREE.Vector3(...pos[hydKey]));
        this.bus.emit('ui:notification', 'HOSE CONNECTED — Click again to pressurize', 4000);
        return;
      }
      if (st === 'attached') {
        this.bus.emit('hose:charge');
        this.bus.emit('ui:notification', 'PRESSURIZED — Hold CLICK to spray at fire', 5000);
        data.completed = true;
        this.interaction.invalidateCache();
        if (data.stepId) this.scenario.completeStep(data.stepId);
        return;
      }
      // already charged/spraying — nothing more to do here.
      return;
    }

    if (data.equipItem) {
      data.completed = true;
      this.interaction.invalidateCache();
      if (data.stepId) this.scenario.completeStep(data.stepId);
      if (data.stepId === 'alert_fire_safety') {
        this.scenario.radioActive = true;
        this.bus.emit('radio:equip');
        this.bus.emit('ui:equip', 'RADIO', '📻');
      }
      if (data.notification) this.bus.emit('ui:notification', data.notification, 3000);
      return;
    }

    if (this.actionPanel.has(data.stepId)) {
      data._panelOpen = true;
      this._panelData = data;
      document.exitPointerLock();
      this.bus.emit('action-panel:open', data.stepId);
      return;
    }

    // Fallback: complete the step directly
    if (data.stepId) {
      data.completed = true;
      this.interaction.invalidateCache();
      this.scenario.completeStep(data.stepId);
      if (data.notification) this.bus.emit('ui:notification', data.notification, 3000);
    }
  }

  _setupValveGrab(direction, rotations) {
    let totalAngle = 0;
    const sign = direction === 'ccw' ? -1 : 1;

    this.player.onGrabDelta = (dx) => {
      // Raw signed delta (dx scaled into radians). Drives the visual
      // wheel in BOTH directions so the player sees their motion.
      const rawDelta = dx * 0.01;
      this.bus.emit('action-panel:rotate-tick', rawDelta * sign);

      // Progress accumulates ONLY in the correct direction.
      const delta = rawDelta * sign;
      if (delta > 0) totalAngle += delta;
      this.bus.emit('action-panel:accumulate-drag', totalAngle);
    };
  }

  /* ── Direct in-world VALVE grab (no modal) ─────────────── */
  //
  // Player clicks the valve trigger → pointer-lock STAYS ON, the wheel
  // widget in 3D world is wired to mouse movement: hold LMB and drag
  // horizontally to spin. Drag right = CW, drag left = CCW (signed).
  // Progress only counts movement in the required direction.
  _startWorldValve(data) {
    const cfg = DIRECT_VALVE_STEPS[data.stepId];
    if (!cfg) return;
    this._directActive = true;

    const sign = cfg.direction === 'ccw' ? -1 : 1;
    const targetAngle = cfg.rotations * Math.PI * 2;
    let totalAngle = 0;
    let lastWrongFlash = 0;
    // Inertia state — rotational velocity (rad/s) and last-input timestamp.
    // When the player releases, this keeps the wheel spinning briefly and
    // continues to credit progress (in the correct direction only) until
    // friction damps it to zero.
    this._valveInertia = { vel: 0, lastT: performance.now() };

    // Re-use the existing valve-grab HUD (already styled).
    const ghud = document.getElementById('valve-grab-hud');
    const ring = ghud?.querySelector('.vgh-progress');
    const pctEl = ghud?.querySelector('.vgh-pct');
    const instr = ghud?.querySelector('.vgh-instruction');
    const hint = ghud?.querySelector('.vgh-hint');
    const RING_C = 339.3;
    if (instr) instr.textContent = `${cfg.label} — ${cfg.dirHint}`;
    if (hint) hint.textContent = 'HOLD LEFT MOUSE + DRAG';
    if (ring) ring.setAttribute('stroke-dashoffset', RING_C.toString());
    if (pctEl) pctEl.textContent = '0%';
    if (ghud) ghud.style.display = '';

    // EquipmentAnimator already listens for 'rotate-start' to bind the
    // widget's spin part, and for 'rotate-tick' to apply visual delta.
    this.bus.emit('action-panel:rotate-start', cfg.direction, cfg.rotations, data.stepId);

    this.player.grabMode = true;

    /* Smooth drag physics ────────────────────────────────────
       Raw mouse deltas (movementX/Y) vary wildly by screen DPI and
       mouse speed. Applying them directly at 0.012 rad/px made the
       wheel slip like ice on a fast swipe. Instead:

       1. Convert raw pixels to a target angular velocity (rad/s).
       2. Smooth the velocity toward that target at a fixed blend each
          event — this gives the wheel a sense of weight (resists fast
          flicks, coasts gently after release).
       3. Cap the velocity so the wheel can never spin faster than one
          full turn per second (4 rad/s for gate, enough for quarter-
          turn lever).
       4. Keep the visible wheel perfectly in sync (always apply the
          smoothed delta to the visual).
    ─────────────────────────────────────────────────────────── */
    const SENSITIVITY  = 0.006;   // rad/px — lower = heavier feel
    const BLEND        = 0.22;    // velocity smoothing (0=no input, 1=instant)
    const MAX_VEL      = 3.5;     // rad/s ceiling
    let   smoothedVel  = 0;       // current angular velocity (rad/s)
    let   lastCallT    = performance.now();

    this.player.onGrabDelta = (rawPx) => {
      const now  = performance.now();
      const dt   = Math.max(0.004, (now - lastCallT) / 1000);
      lastCallT  = now;

      /* Clamp raw input per event so a violent 200px swipe doesn't
         launch the wheel into a full spin. */
      const clampedPx = Math.max(-60, Math.min(60, rawPx));
      const targetVel = clampedPx * SENSITIVITY / dt; // px → rad/s

      /* Ease toward the target — blending gives the "weighty" feel. */
      smoothedVel += (targetVel - smoothedVel) * BLEND;
      smoothedVel  = Math.max(-MAX_VEL, Math.min(MAX_VEL, smoothedVel));

      /* Delta for this event. */
      const delta = smoothedVel * dt;
      const rawDelta = delta;

      /* Visual: always track full signed delta so the wheel follows
         the hand even when turning the wrong way.
         The billboard wheel faces the camera along +Z; rotation.z
         positive = CCW visually. Dragging right (positive px) gives
         positive rawDelta — we pass it directly so it maps CW visually. */
      this.bus.emit('action-panel:rotate-tick', rawDelta * sign);

      /* Progress only credits motion in the correct direction. */
      const signedDelta = rawDelta * sign;
      if (signedDelta > 0) {
        totalAngle += signedDelta;
        this._valveInertia.vel = Math.abs(smoothedVel * sign);
        this._valveInertia.lastT = now;

        const detentSize = Math.PI / 6;
        const before = Math.floor((totalAngle - signedDelta) / detentSize);
        const after  = Math.floor(totalAngle / detentSize);
        if (after > before) this.bus.emit('audio:play', 'valve_turn');
      } else if (signedDelta < -0.01) {
        const n = performance.now();
        if (n - lastWrongFlash > 350) {
          lastWrongFlash = n;
          this.bus.emit('valve:wrong-direction');
          this.bus.emit('audio:play', 'valve_grind');
        }
      }

      const pct = Math.min(1, totalAngle / targetAngle);
      if (ring) ring.setAttribute('stroke-dashoffset', (RING_C * (1 - pct)).toFixed(1));
      if (pctEl) pctEl.textContent = `${Math.floor(pct * 100)}%`;

      if (pct >= 1) this._completeWorldValve(data);
    };

    /* Stash for the inertia coast tick in _loop(). */
    this._valveCtx = {
      sign, targetAngle,
      getTotal: () => totalAngle,
      addTotal: (d) => { totalAngle += d; },
      ring, pctEl, RING_C, data,
    };
  }

  _completeWorldValve(data) {
    if (!this._directActive) return;
    this._directActive = false;
    data.completed = true;
    this.interaction.invalidateCache();

    this.player.grabMode = false;
    this.player.onGrabDelta = null;
    this._valveInertia = null;
    this._valveCtx = null;
    this.bus.emit('action-panel:rotate-end');
    this.bus.emit('audio:play', 'valve_steam');

    const ghud = document.getElementById('valve-grab-hud');
    const instr = ghud?.querySelector('.vgh-instruction');
    const hint = ghud?.querySelector('.vgh-hint');
    if (instr) instr.textContent = '✓  VALVE FULLY OPERATED';
    if (hint) hint.textContent = '';
    setTimeout(() => { if (ghud) ghud.style.display = 'none'; }, 900);

    this.bus.emit('audio:play', 'valve_steam');
    this.bus.emit('audio:play', 'valve_turn');
    if (data.notification) this.bus.emit('ui:notification', data.notification, 3000);
    this.scenario.completeStep(data.stepId);
  }

  /* ── Direct in-world MCP SMASH (no modal) ──────────────── */
  //
  // Player clicks the MCP. Each click = one strike on the call point's
  // glass: world-space crack visualization + camera shake. 3rd strike
  // shatters with a procedural shard burst (handled by EquipmentAnimator).
  _startWorldSmash(data) {
    this._directActive = true;
    this._smashState = { hits: 0, total: 3, data };
    // Lock movement while the player is hammering the MCP.
    if (this.player) this.player.grabMode = true;

    // Reuse the valve-grab HUD as a "X HITS REMAINING" overlay.
    const ghud = document.getElementById('valve-grab-hud');
    const ring = ghud?.querySelector('.vgh-progress');
    const pctEl = ghud?.querySelector('.vgh-pct');
    const instr = ghud?.querySelector('.vgh-instruction');
    const hint = ghud?.querySelector('.vgh-hint');
    if (instr) instr.textContent = 'BREAK GLASS — STRIKE THE MCP';
    if (hint) hint.textContent = 'CLICK MCP 3 TIMES';
    if (ring) ring.setAttribute('stroke-dashoffset', '339.3');
    if (pctEl) pctEl.textContent = '3';
    if (ghud) ghud.style.display = '';

    // Install a click listener — only counts as a strike if the player
    // is still aimed at the MCP (interaction.current === MCP step). This
    // prevents accidental strikes from stray clicks elsewhere.
    this._onSmashClick = (e) => {
      if (e.button !== 0) return;
      const current = this.interaction.current;
      if (!current || current.stepId !== 'sound_mcp_alarm') {
        // off-target click: brief miss feedback, no strike registered
        this.bus.emit('ui:notification', 'AIM AT THE MCP', 900);
        return;
      }
      this._registerSmashStrike();
    };
    this.canvas.addEventListener('mousedown', this._onSmashClick);
  }

  _registerSmashStrike() {
    if (!this._smashState) return;
    this._smashState.hits++;
    const remaining = this._smashState.total - this._smashState.hits;

    // World-side feedback: crack flash on the MCP model itself.
    this.bus.emit('mcp:strike', this._smashState.hits);
    this.bus.emit('audio:play', 'valve_grind');
    document.body.classList.add('screen-shake');
    setTimeout(() => document.body.classList.remove('screen-shake'), 300);

    const ghud = document.getElementById('valve-grab-hud');
    const pctEl = ghud?.querySelector('.vgh-pct');
    const ring = ghud?.querySelector('.vgh-progress');
    if (pctEl) pctEl.textContent = `${Math.max(0, remaining)}`;
    if (ring) {
      const pct = this._smashState.hits / this._smashState.total;
      ring.setAttribute('stroke-dashoffset', (339.3 * (1 - pct)).toFixed(1));
    }

    if (this._smashState.hits >= this._smashState.total) {
      this._completeWorldSmash();
    }
  }

  _completeWorldSmash() {
    const data = this._smashState?.data;
    if (!this._directActive || !data) return;
    this._directActive = false;
    if (this.player) this.player.grabMode = false;
    this.canvas.removeEventListener('mousedown', this._onSmashClick);
    this._onSmashClick = null;
    this._smashState = null;

    // Spawns the shard burst on the actual MCP model in the world.
    this.bus.emit('mcp:shatter');
    this.bus.emit('audio:play', 'valve_steam');
    this.bus.emit('alarm:on');
    this._playGlassBreakVFX();

    const ghud = document.getElementById('valve-grab-hud');
    const instr = ghud?.querySelector('.vgh-instruction');
    const hint = ghud?.querySelector('.vgh-hint');
    if (instr) instr.textContent = '✓  ALARM ACTIVATED';
    if (hint) hint.textContent = '';
    setTimeout(() => { if (ghud) ghud.style.display = 'none'; }, 1100);

    data.completed = true;
    this.interaction.invalidateCache();
    if (data.notification) this.bus.emit('ui:notification', data.notification, 3000);
    this.scenario.completeStep(data.stepId);
  }

  _returnToGameplay() {
    this._hideResumeOverlay();
    this.canvas.requestPointerLock();
  }

  /* ── Pointer-lock resume overlay ──────────────────────────────────
     Shows a translucent "CLICK TO RESUME" card whenever the browser
     exits pointer lock during active gameplay (ESC key, tab switch,
     window blur, etc.). Clicking anywhere re-acquires the lock. */
  _setupResumeOverlay() {
    /* Build DOM element once. */
    let el = document.getElementById('_resume-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = '_resume-overlay';
      el.style.cssText = [
        'position:fixed', 'inset:0', 'display:none',
        'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.55)', 'backdrop-filter:blur(3px)',
        'z-index:9999', 'cursor:pointer', 'flex-direction:column',
        'font-family:monospace', 'user-select:none',
      ].join(';');
      el.innerHTML = `
        <div style="border:1px solid #ff6b1a88;padding:28px 48px;text-align:center;background:#0a0a0add;border-radius:4px">
          <div style="color:#ff6b1a;font-size:22px;letter-spacing:4px;margin-bottom:10px">PAUSED</div>
          <div style="color:#aaa;font-size:12px;letter-spacing:2px">CLICK TO RESUME</div>
        </div>`;
      document.body.appendChild(el);
    }
    this._resumeOverlayEl = el;

    /* Re-acquire on click anywhere on the overlay. */
    el.addEventListener('click', () => {
      this._hideResumeOverlay();
      this.canvas.requestPointerLock();
    });

    /* Listen for pointer lock state changes during gameplay. */
    document.addEventListener('pointerlockchange', () => {
      if (!this.running) return;
      const locked = document.pointerLockElement === this.canvas;

      const panelOpen  = !!this._panelData;
      const radioOpen  = this.radioPanel?.visible === true;
      const scoreOpen  = !document.getElementById('score-screen')?.classList.contains('hidden');
      const modalOpen  = panelOpen || radioOpen || scoreOpen;

      if (!locked && !modalOpen) {
        this._showResumeOverlay();
      } else {
        this._hideResumeOverlay();
      }
    });
  }

  _showResumeOverlay() {
    if (this._resumeOverlayEl) {
      this._resumeOverlayEl.style.display = 'flex';
    }
  }

  _hideResumeOverlay() {
    if (this._resumeOverlayEl) {
      this._resumeOverlayEl.style.display = 'none';
    }
  }

  _setupCollisions() {
    // Dyke south wall — split with gap for south gate at cx=-5 (gap width 5)
    this.collision.addBox(new THREE.Vector3(-23.75, 0, 25), new THREE.Vector3(16.25, 1, 0.3));
    this.collision.addBox(new THREE.Vector3(13.75, 0, 25), new THREE.Vector3(16.25, 1, 0.3));

    // Dyke north wall — solid
    this.collision.addBox(new THREE.Vector3(-5, 0, -25), new THREE.Vector3(35, 1, 0.3));

    // Dyke west wall — split with gap for west gate at cz=0 (gap width 5)
    this.collision.addBox(new THREE.Vector3(-40, 0, -13.75), new THREE.Vector3(0.3, 1, 11.25));
    this.collision.addBox(new THREE.Vector3(-40, 0, 13.75), new THREE.Vector3(0.3, 1, 11.25));

    // Dyke east wall — solid
    this.collision.addBox(new THREE.Vector3(30, 0, 0), new THREE.Vector3(0.3, 1, 25));

    // Tank cylinders + GLB colliders are auto-generated from world.json `collision` blocks.
  }

  _setupInteractables() {
    const pos = this.world.getPositions();
    const bus = this.bus;

    // worldPos: [x, y, z]. y is used as the trigger BOX CENTER height (default 1).
    // size: optional [w, h, d] of the invisible box (default [2, 2, 2]).
    const registerTrigger = (worldPos, data, size = [2, 2, 2]) => {
      const trigger = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      const yCenter = (worldPos.length >= 3 && typeof worldPos[1] === 'number')
        ? worldPos[1]
        : 1;
      trigger.position.set(worldPos[0], yCenter, worldPos[2]);
      this.renderer.scene.add(trigger);
      this.interaction.register(trigger, data);
    };

    registerTrigger(pos.ROOF_DRAIN, {
      type: 'simple', stepId: 'close_roof_drain', prompt: 'ROOF DRAIN VALVE — RD-101A',
      hint: 'Click to begin SOP procedure',
    });

    registerTrigger(pos.DYKE_VALVE, {
      type: 'simple', stepId: 'close_dyke_valve', prompt: 'DYKE DRAIN VALVE — DV-101',
      hint: 'Click to begin SOP procedure',
    });

    registerTrigger(pos.MANIFOLD, {
      type: 'simple', stepId: 'isolate_manifold', prompt: 'MANIFOLD VALVE MV-101A',
      hint: 'Click to begin isolation procedure',
    });

    registerTrigger([52, 0.9, 65], {
      type: 'simple', stepId: 'alert_fire_safety', equipItem: 'radio',
      prompt: 'EMERGENCY RADIO', hint: 'Click to pick up radio',
      notification: 'Radio acquired — Fire & Safety informed via Channel 8',
    }, [1.0, 0.6, 1.0]);

    registerTrigger(pos.COOLING_VALVE, {
      type: 'simple', stepId: 'open_cooling_valve', prompt: 'COOLING WATER VALVE CW-101B',
      hint: 'Click to open cooling water',
    });

    // ── Phase 2 — 1ST TURNOUT ──
    // position_tender_1 is now PROXIMITY-completed (defined in scenario.json:
    // walk into Hydrant H-28's radius). No click trigger needed.
    //
    // Physical hose flow for connect_hose_1:
    //  1) Click the hose pile (water_hose @ -13,0,37) → hose:pickup('h28')
    //  2) Click the hydrant H-28 → hose:attach (carrying ➜ attached)
    //  3) Click the hydrant H-28 again → hose:charge + completeStep
    registerTrigger([-14.5, 0.6, 36], {
      type: 'simple', stepId: 'connect_hose_1',
      hoseAction: 'pickup', hoseId: 'h28',
      prompt: 'FIRE HOSE — H-28', hint: 'Click to pick up the hose',
    }, [1.6, 1.2, 1.6]);

    registerTrigger(pos.HYDRANT_H28, {
      type: 'simple', stepId: 'connect_hose_1',
      hoseAction: 'attach', hoseId: 'h28',
      prompt: 'HYDRANT H-28', hint: 'Click to connect & pressurize',
    }, [1.8, 1.6, 1.8]);

    registerTrigger([pos.COOLING_VALVE[0] + 3, 1, pos.COOLING_VALVE[2]], {
      type: 'simple', stepId: 'open_spray_101b', prompt: 'SPRAY RING 101-B',
      hint: 'Click to verify spray operation',
    });

    // ── Phase 3 — 2ND TURNOUT ──
    // position_tender_2: PROXIMITY (scenario.json).
    registerTrigger([18, 0.6, 60], {
      type: 'simple', stepId: 'connect_hose_2',
      hoseAction: 'pickup', hoseId: 'h20',
      prompt: 'FIRE HOSE — H-20', hint: 'Click to pick up the hose',
    }, [1.6, 1.2, 1.6]);

    registerTrigger(pos.HYDRANT_H20, {
      type: 'simple', stepId: 'connect_hose_2',
      hoseAction: 'attach', hoseId: 'h20',
      prompt: 'HYDRANT H-20', hint: 'Click to connect & pressurize',
    }, [1.8, 1.6, 1.8]);

    // check_boilover uses the rich ActionPanel quiz (6 questions on
    // boil-over precursors). Copy now reads as a deliberate observation
    // gate so the player understands the click opens an inspection log,
    // not an instant completion.
    registerTrigger(pos.TANK_A, {
      type: 'simple', stepId: 'check_boilover',
      prompt: 'TANK 101-A SHELL — BOIL-OVER INSPECTION',
      hint: 'Observe paint/seal/shell carefully, then click to record findings',
      notification: 'Tank shell inspection complete',
    });

    // Phase 1 — OPS RESPONSE FIRST step (registered last just for clarity)
    if (pos.MCP) {
      registerTrigger(pos.MCP, {
        type: 'simple', stepId: 'sound_mcp_alarm', prompt: 'MANUAL CALL POINT (MCP)',
        hint: 'BREAK GLASS — Click to raise the plant-wide alarm',
        notification: 'MCP TRIGGERED — Plant evacuation alarm sounding',
      }, [1.0, 1.0, 1.0]);
    }
  }

  _setupFirePosition() {
    const pos = this.world.getPositions();
    this.fire.setFirePosition(new THREE.Vector3(pos.TANK_A[0], pos.TANK_A[1], pos.TANK_A[2]));
  }

  _getWaypointForStep(stepId) {
    const pos = this.world.getPositions();

    /* Hose flow is a multi-click sequence (pickup pile → walk to
       hydrant → click hydrant). The objective arrow should point at
       whichever target the player needs NEXT, not always the hydrant.
       Until the player has picked the hose up, send them to the pile;
       after that, redirect to the hydrant. */
    const hoseState = this.fire?.getHoseState?.() || 'idle';
    if (stepId === 'connect_hose_1' && hoseState === 'idle') {
      return [-13, 1.0, 37]; // hose pile near H-28
    }
    if (stepId === 'connect_hose_2' && hoseState === 'idle') {
      return [19,  1.0, 61]; // hose pile near H-20
    }

    const map = {
      // Patrol — proximity-driven onboarding
      inspect_tank_a:        [-15, 1.7, 4],
      check_roof_drain_pre:  [-15, 1.7, 6],
      return_to_control:     [0, 1.7, 18],
      sound_mcp_alarm: pos.MCP,
      close_roof_drain: pos.ROOF_DRAIN,
      close_dyke_valve: pos.DYKE_VALVE,
      isolate_manifold: pos.MANIFOLD,
      alert_fire_safety: pos.CONTROL,
      report_tank_data: pos.CONTROL,
      open_cooling_valve: pos.COOLING_VALVE,
      start_product_transfer: pos.CONTROL,
      position_tender_1: pos.HYDRANT_H28,
      connect_hose_1: pos.HYDRANT_H28,
      /* Spray-ring trigger lives at COOLING_VALVE.x + 3 (Game._setupInteractables);
         pointing the arrow at COOLING_VALVE itself made the player walk
         past the actual click target. Match the trigger location. */
      open_spray_101b: [pos.COOLING_VALVE[0] + 3, 1.0, pos.COOLING_VALVE[2]],
      request_2nd_turnout: pos.CONTROL,
      position_tender_2: pos.HYDRANT_H20,
      connect_hose_2: pos.HYDRANT_H20,
      request_foam: pos.CONTROL,
      check_boilover: pos.TANK_A,
    };
    return map[stepId] || null;
  }

  _getLabelForStep(stepId) {
    const map = {
      inspect_tank_a:         'TANK 101-A',
      check_roof_drain_pre:   'ROOF DRAIN',
      return_to_control:      'CONTROL POINT',
      sound_mcp_alarm:        'MCP CALL POINT',
      close_roof_drain:       'ROOF DRAIN VALVE',
      close_dyke_valve:       'DYKE DRAIN VALVE',
      isolate_manifold:       'MANIFOLD MV-101A',
      alert_fire_safety:      'EMERGENCY RADIO',
      report_tank_data:       'RADIO — CHANNEL 8',
      open_cooling_valve:     'COOLING VALVE',
      start_product_transfer: 'RADIO — CHANNEL 8',
      position_tender_1:      'HYDRANT H-28',
      connect_hose_1:         'HYDRANT H-28',
      open_spray_101b:        'TANK 101-B SPRAY',
      request_2nd_turnout:    'RADIO — CHANNEL 8',
      position_tender_2:      'HYDRANT H-20',
      connect_hose_2:         'HYDRANT H-20',
      request_foam:           'RADIO — CHANNEL 8',
      check_boilover:         'TANK 101-A SHELL',
    };
    return map[stepId] || 'OBJECTIVE';
  }

  _getCurrentRadioStepId() {
    return this.scenario.getCurrentStepId();
  }

  _setupMinimapLandmarks() {
    const pos = this.world.getPositions();
    this.minimap.addLandmark({ x: pos.TANK_A[0], z: pos.TANK_A[2] }, 'tank_fire', 'Tank 101-A');
    this.minimap.addLandmark({ x: pos.TANK_B[0], z: pos.TANK_B[2] }, 'tank', 'Tank 101-B');
    this.minimap.addLandmark({ x: pos.HYDRANT_H28[0], z: pos.HYDRANT_H28[2] }, 'hydrant', 'H-28');
    this.minimap.addLandmark({ x: pos.HYDRANT_H27[0], z: pos.HYDRANT_H27[2] }, 'hydrant', 'H-27');
    this.minimap.addLandmark({ x: pos.HYDRANT_H20[0], z: pos.HYDRANT_H20[2] }, 'hydrant', 'H-20');
    this.minimap.addLandmark({ x: pos.CONTROL[0], z: pos.CONTROL[2] }, 'control', 'Control');
    this.minimap.addLandmark({ x: pos.ROOF_DRAIN[0], z: pos.ROOF_DRAIN[2] }, 'valve', 'Roof Drain');
    this.minimap.addLandmark({ x: pos.DYKE_VALVE[0], z: pos.DYKE_VALVE[2] }, 'valve', 'Dyke Valve');
    this.minimap.addLandmark({ x: pos.COOLING_VALVE[0], z: pos.COOLING_VALVE[2] }, 'valve', 'Cooling');
    this.minimap.addLandmark({ x: pos.MANIFOLD[0], z: pos.MANIFOLD[2] }, 'valve', 'Manifold');
    if (pos.MCP) this.minimap.addLandmark({ x: pos.MCP[0], z: pos.MCP[2] }, 'valve', 'MCP Alarm');
  }

  _spawnFireTruck(truckNum) {
    const pos = this.world.getPositions();
    const key = truckNum === 1 ? 'FIRE_TRUCK_1' : 'FIRE_TRUCK_2';
    const p = pos[key];
    if (!p) return;

    const model = this.assets.getModel('fire_truck');
    if (!model) return;

    // Auto-fit so the truck's longest axis is ~9m (real fire tender length)
    model.scale.setScalar(1);
    model.rotation.y = 0;
    model.position.set(0, 0, 0);
    const probe = new THREE.Box3().setFromObject(model);
    const probeSize = new THREE.Vector3();
    probe.getSize(probeSize);
    const longest = Math.max(probeSize.x, probeSize.y, probeSize.z) || 1;
    const fit = 9 / longest;
    model.scale.setScalar(fit);

    /* The fire_truck GLB has its nose pointing along the model's local +Z.
       We need the truck to DRIVE FORWARD toward the park position.
       Truck 1 arrives from the west (+X direction), truck 2 from east (−X).
       rotation.y = PI/2 makes +Z face +X (drives east → correct for truck 1).
       rotation.y = −PI/2 makes +Z face −X (drives west → correct for truck 2).
       Adding Math.PI would flip it backward (reverse). */
    model.rotation.y = truckNum === 1 ? Math.PI / 2 : -Math.PI / 2;

    const facing = new THREE.Vector3(
      truckNum === 1 ? 1 : -1, 0, 0,
    );
    const startX = p[0] - facing.x * 30;
    const startZ = p[2];
    model.position.set(startX, 0, startZ);

    const box = new THREE.Box3().setFromObject(model);
    if (box.min.y < -0.01) model.position.y -= box.min.y;

    model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.renderer.scene.add(model);

    const endX = p[0];
    const endZ = p[2];
    const driveSeconds = 5.0;
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / (driveSeconds * 1000));
      // Ease-out so the truck decelerates as it parks.
      const e = 1 - Math.pow(1 - t, 2);
      model.position.x = startX + (endX - startX) * e;
      model.position.z = startZ + (endZ - startZ) * e;
      if (t < 1) requestAnimationFrame(tick);
      else this._spawnTruckResponders(truckNum, p);
    };
    requestAnimationFrame(tick);

    this.bus.emit('ui:notification', `Fire Tender ${truckNum} arriving`, 4000);
    this.bus.emit('audio:play', 'truck_siren');
  }

  /* When a truck parks, two firefighter responders dismount and
     run along a short path toward the hydrant — adds visible life
     to each turnout phase without blocking gameplay. */
  _spawnTruckResponders(/* truckNum, truckPos */) {
    // NPC spawning disabled — animations not loading correctly.
  }

  _updateHoseHUD(state) {
    let el = document.getElementById('hose-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hose-hud';
      // Bottom anchor is delegated to HUD.acquireBottomSlot so any
      // future bottom-anchored element (foam mode badge, etc.) can
      // stack above this one without a hard-coded px collision.
      const bottom = this.hud.acquireBottomSlot('hose-hud', 38);
      el.style.cssText = `position:fixed;bottom:${bottom}px;left:50%;transform:translateX(-50%);background:#0c0c0cee;border:1px solid #ff6b1a66;padding:10px 20px;font-family:var(--mono);font-size:11px;letter-spacing:2px;color:#ff6b1a;text-align:center;z-index:60;pointer-events:none`;
      document.body.appendChild(el);
    }
    const id = (this.fire.getHoseId?.() || '').toUpperCase();
    const hyd = id === 'H28' ? 'H-28' : id === 'H20' ? 'H-20' : 'the hydrant';
    const prompts = {
      idle: '',
      carrying: `CARRYING HOSE — Walk to Hydrant ${hyd}`,
      attached: 'HOSE ATTACHED — Click hydrant to pressurize',
      charged: 'NOZZLE READY — Hold CLICK to spray at fire',
      spraying: `SPRAYING — Fire: ${Math.round(this.fire.getFireHealth() * 100)}%`,
    };
    el.textContent = prompts[state] || '';
    el.style.display = state === 'idle' ? 'none' : '';
    /* When the hose returns to idle (drop / scenario:complete) free the
       bottom slot so other bottom-anchored UI doesn't get pushed up by
       a phantom 38px placeholder. */
    if (state === 'idle') this.hud.releaseBottomSlot?.('hose-hud');
  }

  _handleMouseForHose() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.fire.getHoseState() === 'charged') {
        this.bus.emit('hose:spray-start');
      }
    });
    this.canvas.addEventListener('mouseup', () => {
      if (this.fire.getHoseState() === 'spraying') {
        this.bus.emit('hose:spray-stop');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  GLASS BREAK VFX — green-screen video overlay on MCP smash
  // ═══════════════════════════════════════════════════════════════

  _initGlassBreakVFX() {
    // Pre-load the video so it's ready to play instantly on smash.
    const vid = document.createElement('video');
    vid.src = '/vfx/glass_break.mp4';
    vid.muted = true;
    vid.playsInline = true;
    vid.crossOrigin = 'anonymous';
    vid.preload = 'auto';
    this._glassVid = vid;

    // VideoTexture — Three.js will upload a new frame each render tick
    // while the video is playing.
    const tex = new THREE.VideoTexture(vid);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._glassVidTex = tex;

    // Camera-space fullscreen quad (child of camera so it always covers
    // the screen regardless of where the player looks).
    // z = -0.08: just past the 0.05 near-clip, so it always renders in
    // front of the world. PlaneGeometry 3×3 is far larger than what the
    // FOV 70° can show at 0.08m distance, guaranteeing full-screen fill.
    const geo = new THREE.PlaneGeometry(3, 3);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex:   { value: tex },
        uAlpha: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uTex;
        uniform float     uAlpha;
        varying vec2      vUv;

        void main() {
          vec4 c = texture2D(uTex, vUv);
          float r = c.r, g = c.g, b = c.b;

          // Green-screen key: remove pixels where green dominates.
          // greenness > 0 means more green than the brighter of r/b.
          float greenness = g - max(r, b);
          float keyMask   = 1.0 - smoothstep(0.15, 0.38, greenness);

          // Spill suppression: tone down residual green on edge pixels.
          vec3 col = vec3(r, min(g, (r + b) * 0.55 + 0.1), b);

          float a = keyMask * uAlpha * c.a;
          if (a < 0.02) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthTest:   false,
      depthWrite:  false,
      blending:    THREE.NormalBlending,
      side:        THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, -0.08);
    mesh.renderOrder = 9998;
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.renderer.camera.add(mesh);
    this._glassOverlayMesh = mesh;
    this._glassOverlayMat  = mat;

    // Auto-hide when video ends.
    vid.addEventListener('ended', () => {
      mesh.visible = false;
      mat.uniforms.uAlpha.value = 0;
      vid.currentTime = 0;
    });
  }

  _playGlassBreakVFX() {
    if (!this._glassVid || !this._glassOverlayMesh) return;
    const vid  = this._glassVid;
    const mesh = this._glassOverlayMesh;
    const mat  = this._glassOverlayMat;

    vid.currentTime = 0;
    mat.uniforms.uAlpha.value = 1.0;
    mesh.visible = true;

    vid.play().catch(() => {
      // Autoplay blocked — try again on next user gesture.
      const resume = () => {
        vid.play().catch(() => {});
        document.removeEventListener('pointerdown', resume);
      };
      document.addEventListener('pointerdown', resume, { once: true });
    });
  }
}

const game = new Game();
game.init().catch((err) => {
  console.error('Game initialization failed:', err);
  const status = document.getElementById('loading-status');
  if (status) status.textContent = `Error: ${err.message}`;
});
