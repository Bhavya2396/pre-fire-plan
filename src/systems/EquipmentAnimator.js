import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Maps scenario step IDs → placed-model IDs in world.json.
 * Used for highlight + widget anchoring + completion flash.
 */
const STEP_TO_MODEL = {
  sound_mcp_alarm:    'manual_call_point',
  close_roof_drain:   'roof_drain_valve',
  close_dyke_valve:   'dyke_drain_valve',
  isolate_manifold:   'manifold_valve',
  alert_fire_safety:  'emergency_radio',
  open_cooling_valve: 'cooling_water_valve',
  position_tender_1:  'h_28',
  connect_hose_1:     'hose_h28',
  open_spray_101b:    'tank_101b',
  position_tender_2:  'h_20',
  connect_hose_2:     'hose_h20',
  check_boilover:     'tank_101a',
};

/**
 * EquipmentAnimator
 *  - Spawns a visible 3D "interaction widget" for the current step
 *    (handwheel for valves, button for MCP, glow ring for radio, scan
 *     reticle for tank observation) so the player always sees what to do.
 *  - Animates the widget in real-time as the player drags / observes.
 *  - Pulses + flashes on activation and completion.
 */
export default class EquipmentAnimator {
  constructor(eventBus, worldBuilder, scene) {
    this._bus = eventBus;
    this._world = worldBuilder;
    this._scene = scene;

    // active highlight
    this._highlightedOrig = new Map(); // mat -> { color, intensity }
    this._highlightTimeline = null;

    // active widget (per active step)
    this._widget = null;        // THREE.Group rendered in scene
    this._widgetSpinPart = null; // child mesh that visually rotates
    this._widgetSpinTween = null;
    this._widgetFloatTween = null;
    this._widgetBlinkTween = null;

    // valve drag state
    this._currentRotation = 0;
    this._rotateSign = 1;
    this._isLeverValve = false;

    // floating arrow widget spawned above the active procedural valve
    this._arrowWidget = null;

    /* Handwheel billboard registry.
       Valve wheels now sit on a forward-facing steering column that exits
       the valve body toward the player. The wheel face is in the XY plane,
       pointing +Z (toward the player's approach direction). Billboard keeps
       the wheel face locked on the camera regardless of which rotY the
       valve assembly was placed with. The inner spin group rotates on Z
       (the camera-facing axis) giving the steering-wheel spin feel.
       { grp: wheelGroup outer, spinPart: inner wheel mesh group } */
    this._handwheelBillboards = []; // { grp, spinPart }

    // active shard burst tween (so we can dispose if the step changes)
    this._activeShardTweens = new Set();

    this._bind();
  }

  /* Called once per frame from Game._loop with the active camera. */
  update(camera) {
    if (!camera) return;
    for (const entry of this._handwheelBillboards) {
      const { grp } = entry;
      /* Billboard: make the outer group face the camera so the vertical
         wheel disc always presents its face to the player (steering-wheel
         style). lookAt only affects grp; the inner spin group's rotation.z
         is untouched and persists between frames. */
      grp.lookAt(camera.position);
    }
  }

  _bind() {
    this._bus.on('scenario:step-activated', (stepId) => this._activateStep(stepId));

    this._bus.on('action-panel:rotate-start', (direction, _rotations, _stepId) => {
      this._beginValveRotate(direction);
    });

    // Bidirectional visual feedback — `rotate-tick` carries a SIGNED
    // delta in radians.
    // • Handwheels: vertical disc on front-facing column; billboarded
    //   to face camera; spin group rotates on Z (camera-facing axis).
    // • Lever valves: lever arm points toward player along +Z; quarter-
    //   turn sweeps arm left/right in XZ plane via rotation.y.
    this._bus.on('action-panel:rotate-tick', (signedDelta) => {
      if (!this._widgetSpinPart) return;
      this._currentRotation += signedDelta;
      if (this._isLeverValve) {
        /* Quarter-turn lever: clamp visual to ±90°. */
        const clamped = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._currentRotation));
        this._widgetSpinPart.rotation.y = clamped;
      } else {
        /* Vertical handwheel (steering-wheel style) — spins around Z.
           rotation.z positive = CCW visually from the player's POV, so
           we negate so that a positive drag (right) reads as CW. */
        this._widgetSpinPart.rotation.z = -this._currentRotation;
      }
      this._updateValveProgress();
    });

    this._bus.on('action-panel:rotate-end', () => {
      // no-op — tick-based rotation has no carried state to clear
    });

    // Direction-discovery: when player drags the wrong way, the game
    // emits this with the (negative) delta — show a red rim flash and
    // a clunk so wrong direction is unmistakable.
    this._bus.on('valve:wrong-direction', () => this._wrongDirectionFlash());

    // Cursor / hover state — bumps the rim emissive on the procedural
    // valve when the crosshair is over its trigger.
    this._bus.on('interaction:hover', (data) => this._setHover(data));

    // Per-strike feedback while the player is hammering the MCP.
    // Each strike: white emissive flash on the model + shake the widget.
    this._bus.on('mcp:strike', (hitN) => this._mcpStrikeFlash('manual_call_point', hitN));

    // Final shatter — spawns procedural shard burst at the MCP.
    this._bus.on('mcp:shatter', () => this._spawnGlassShards('manual_call_point'));

    this._bus.on('action-panel:complete', (stepId) => this._completionPulse(stepId));
    this._bus.on('interaction:valve-complete', (data) => this._completionPulse(data?.stepId));
    this._bus.on('interaction:observe-complete', (data) => this._completionPulse(data?.stepId));

    this._bus.on('scenario:step-complete', ({ stepId }) => {
      // Clear widget immediately on completion (we re-create for the next step)
      if (this._stepId === stepId) this._clearWidget();
    });
  }

  /* ── Activate a step ───────────────────────────────────── */

  _activateStep(stepId) {
    this._clearHighlight();
    this._clearWidget();
    this._stepId = stepId;

    const modelId = STEP_TO_MODEL[stepId];
    if (!modelId) return;

    const model = this._world.getPlacedModel(modelId);
    if (!model) return;

    // ── PROCEDURAL EQUIPMENT FAST PATH ───────────────────
    // If the placed model is one of our procedural builds it already
    // contains the interactive sub-parts (handwheel/lever/glass) on
    // userData. Use them directly — no overlay widget needed.
    if (model.userData.handwheel) {
      this._widget = model;
      this._widgetSpinPart = model.userData.handwheel;
      this._currentRotation = 0;

      /* Lever valves: arm points toward player along +Z, sweeps
         left-right via rotation.y (quarter-turn). No billboard needed.
         Handwheels: disc in XY plane on forward column; billboard makes
         the face always look at the camera; inner spin uses rotation.z. */
      const valveModel = model.userData.valveModel || model;
      this._isLeverValve = !!(valveModel.userData?.quarterTurn);

      if (!this._isLeverValve) {
        /* Register the outer wheelGroup for per-frame billboard so the
           vertical disc always faces the camera (steering-wheel style). */
        const hwGroup = model.userData.wheelGroup
          || valveModel.userData?.wheelGroup
          || this._widgetSpinPart?.parent;
        if (hwGroup) {
          this._handwheelBillboards.push({ grp: hwGroup, spinPart: this._widgetSpinPart });
        }
      }

      /* No emissive pulse — a floating orange arrow above the valve
         guides the player. Emissive bloom was confusing at distance. */
      this._spawnProceduralArrow(model);
      return;
    }
    if (model.userData.glass) {
      this._widget = model;
      this._mcpModel = model;
      this._pulseProcedural(model);
      return;
    }

    this._highlightModel(model);

    // World-space bounding box of the placed GLB
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Per-step mount strategy — describes WHERE the widget sits relative
    // to the model and HOW it should animate so it reads as "bolted on"
    // hardware rather than a UI overlay.
    const mount = this._getMountInfo(stepId, box, size);

    const widget = this._buildWidgetForStep(stepId, size);
    if (!widget) return;

    widget.scale.setScalar(mount.scale);
    widget.position.copy(mount.position);
    if (mount.rotation) widget.rotation.copy(mount.rotation);
    this._scene.add(widget);
    this._widget = widget;

    // Subtle "alive" float — only for free-floating waypoint markers
    // (hydrant arrows etc). Embedded handwheels/beacons get no float.
    if (mount.float > 0) {
      const baseY = widget.position.y;
      this._widgetFloatTween = gsap.to(widget.position, {
        y: baseY + mount.float,
        duration: 1.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /* ── Mount strategy per step — keeps widgets EMBEDDED on the GLB ── */

  _getMountInfo(stepId, box, size) {
    // Footprint-relative widget scale, clamped so we don't get
    // micro-widgets on tiny radios or giant ones on tanks.
    const footprint = Math.min(size.x, size.z);
    const scaleFromFootprint = (mult, lo, hi) =>
      Math.max(lo, Math.min(hi, footprint * mult));

    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const topY = box.max.y;

    switch (stepId) {
      // ── VALVES — handwheel sits FLUSH on top of the valve body ──
      // Scale bumped up and clamp wider so the wheel reads clearly from
      // the grab distance (~2 m). The wheel is the gameplay element so
      // it should be obviously visible, not subtle.
      case 'close_roof_drain':
      case 'close_dyke_valve':
      case 'isolate_manifold':
      case 'open_cooling_valve':
        return {
          position: new THREE.Vector3(cx, topY + 0.04, cz),
          scale:    scaleFromFootprint(0.85, 0.55, 1.4),
          float:    0,
        };

      // ── MCP — small beacon mounted ON TOP of the call point box ──
      case 'sound_mcp_alarm':
        return {
          position: new THREE.Vector3(cx, topY + 0.04, cz),
          scale:    scaleFromFootprint(0.7, 0.32, 0.55),
          float:    0,
        };

      // ── RADIO — small arrow tag just above the desk-mounted radio ──
      case 'alert_fire_safety':
        return {
          position: new THREE.Vector3(cx, topY + 0.18, cz),
          scale:    0.45,
          float:    0.06,
        };

      // ── HYDRANTS — green "go here" arrow above the hydrant cap ──
      case 'position_tender_1':
      case 'position_tender_2':
        return {
          position: new THREE.Vector3(cx, topY + 0.35, cz),
          scale:    scaleFromFootprint(1.4, 0.7, 1.0),
          float:    0.15,
        };

      // ── HOSE — orange arrow above the coiled hose model ──
      case 'connect_hose_1':
      case 'connect_hose_2':
        return {
          position: new THREE.Vector3(cx, topY + 0.35, cz),
          scale:    scaleFromFootprint(1.2, 0.55, 0.9),
          float:    0.12,
        };

      // ── SPRAY RING / TANK — scan reticle hovers as a UI overlay ──
      case 'open_spray_101b':
      case 'check_boilover':
        return {
          position: new THREE.Vector3(cx, topY + 0.6, cz),
          scale:    1,
          float:    0,
        };

      default:
        return {
          position: new THREE.Vector3(cx, topY + 0.3, cz),
          scale:    0.6,
          float:    0.1,
        };
    }
  }

  /* ── Widget factory per step ───────────────────────────── */

  _buildWidgetForStep(stepId, modelSize) {
    if (stepId === 'sound_mcp_alarm') {
      return this._buildBeacon(0xff2222);
    }
    if (stepId === 'alert_fire_safety') {
      return this._buildArrow(0x33aaff);
    }
    if (stepId === 'check_boilover' || stepId === 'open_spray_101b') {
      return this._buildScanReticle(modelSize);
    }
    if (stepId === 'position_tender_1' || stepId === 'position_tender_2') {
      return this._buildArrow(0x33ff88);
    }
    if (stepId === 'connect_hose_1' || stepId === 'connect_hose_2') {
      return this._buildArrow(0xffaa22);
    }
    // Default: any valve gets a spinnable handwheel
    return this._buildHandwheel();
  }

  _buildHandwheel() {
    // The wheel is built at unit radius (~0.5m) and then scaled by the
    // mount strategy to fit the underlying GLB's footprint.
    const grp = new THREE.Group();

    // Centre hub — short stem rising from the GLB so the wheel reads as
    // mounted on the valve bonnet.
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.25, 12),
      new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.45, metalness: 0.85,
      }),
    );
    stem.position.y = 0.05;
    grp.add(stem);

    // Spinnable wheel sub-group — only this part rotates on drag
    const wheel = new THREE.Group();
    wheel.position.y = 0.18;
    grp.add(wheel);

    // Rim — orange painted cast-iron, no emissive glow
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xdd5500,
      roughness: 0.55,
      metalness: 0.45,
    });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.07, 12, 28),
      rimMat,
    );
    rim.rotation.x = Math.PI / 2;
    wheel.add(rim);

    // 4 spokes — no emissive
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0xcc4400,
      roughness: 0.55,
      metalness: 0.45,
    });
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.05, 0.07),
        spokeMat,
      );
      spoke.rotation.y = (i * Math.PI) / 2;
      wheel.add(spoke);
    }

    // Centre boss bolt
    const boss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12),
      new THREE.MeshStandardMaterial({
        color: 0x1c1c1c, roughness: 0.4, metalness: 0.9,
      }),
    );
    wheel.add(boss);

    // Direction-of-rotation ghost arc (subtle, doesn't write depth so it
    // sits cleanly on top of the underlying GLB handle without z-fighting)
    const arrowRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.022, 6, 26, Math.PI * 1.6),
      new THREE.MeshBasicMaterial({
        color: 0xffffaa,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    arrowRing.rotation.x = Math.PI / 2;
    arrowRing.position.y = 0.06;
    wheel.add(arrowRing);

    grp.userData.spinPart = wheel;
    return grp;
  }

  _buildBeacon(color) {
    // Anchored so the base ring sits exactly at local y=0.
    const grp = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.5 }),
    );
    base.position.y = 0.04;
    grp.add(base);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.3, transparent: true, opacity: 0.85,
      }),
    );
    dome.position.y = 0.08;
    grp.add(dome);
    grp.userData.beaconMat = dome.material;

    return grp;
  }

  _buildArrow(color) {
    // Tip is anchored at local y=0 — body extends upward — so when the
    // mount logic places the widget at `model.top + offset`, the arrow
    // visually POINTS at the model below it instead of hovering past it.
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.45, metalness: 0.2,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 8), mat);
    cone.rotation.x = Math.PI;
    cone.position.y = 0.35;
    grp.add(cone);
    return grp;
  }

  _buildScanReticle(modelSize) {
    const grp = new THREE.Group();
    const r = Math.max(2.0, Math.max(modelSize.x, modelSize.z) * 0.35);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x44ff88, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.9, r, 32, 1),
      ringMat,
    );
    ring.rotation.x = -Math.PI / 2;
    grp.add(ring);

    // crosshair
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, r * 1.6), crossMat);
    const h = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, 0.05, 0.05), crossMat);
    v.position.y = 0.05; h.position.y = 0.05;
    grp.add(v); grp.add(h);

    // slow rotation for scan effect
    this._widgetSpinTween = gsap.to(grp.rotation, {
      y: Math.PI * 2,
      duration: 6,
      repeat: -1,
      ease: 'none',
    });
    return grp;
  }

  /* ── Highlight active model ────────────────────────────── */

  _highlightModel(_model) {
    /* Intentionally empty — no emissive blasting on GLB geometry.
       The floating arrow widget provides navigation without glare. */
  }

  _clearHighlight() {
    if (this._highlightTimeline) {
      this._highlightTimeline.kill();
      this._highlightTimeline = null;
    }
    this._highlightedOrig.clear();
  }

  _clearWidget() {
    /* Stop billboarding any handwheels registered for this step. */
    this._handwheelBillboards.length = 0;
    this._isLeverValve = false;

    /* Remove the floating arrow widget spawned above procedural valves. */
    if (this._arrowWidget) {
      this._scene.remove(this._arrowWidget);
      this._arrowWidget.traverse((c) => {
        if (!c.isMesh) return;
        c.geometry?.dispose();
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material?.dispose();
      });
      this._arrowWidget = null;
    }

    if (this._widgetFloatTween) { this._widgetFloatTween.kill(); this._widgetFloatTween = null; }
    if (this._widgetSpinTween)  { this._widgetSpinTween.kill();  this._widgetSpinTween = null; }
    if (this._widgetBlinkTween) { this._widgetBlinkTween.kill(); this._widgetBlinkTween = null; }
    if (this._proceduralPulseTween) { this._proceduralPulseTween.kill(); this._proceduralPulseTween = null; }
    if (this._proceduralPulseRestore) { this._proceduralPulseRestore(); this._proceduralPulseRestore = null; }
    if (this._widget) {
      // Procedural equipment is a permanent world model — DON'T dispose it,
      // just detach our references. Only dispose throwaway overlay widgets.
      if (!this._widget.userData?.kind) {
        this._scene.remove(this._widget);
        this._widget.traverse((c) => {
          if (!c.isMesh) return;
          c.geometry?.dispose();
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material?.dispose();
        });
      }
      this._widget = null;
    }
    this._widgetSpinPart = null;
    this._currentRotation = 0;
    this._mcpModel = null;
  }

  /* ── Floating arrow pointer above active procedural valve ───────── */

  _spawnProceduralArrow(model) {
    /* World-space bounding box to find the top of the assembly. */
    const box = new THREE.Box3().setFromObject(model);
    const cx   = (box.min.x + box.max.x) * 0.5;
    const topY = box.max.y;
    const cz   = (box.min.z + box.max.z) * 0.5;

    const grp = new THREE.Group();

    /* Two chevrons stacked — outer faint, inner bright. Gives a
       "scan line" depth effect without any emissive bloom. */
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff6600, roughness: 0.6, metalness: 0.1,
      transparent: true, opacity: 0.92, depthWrite: false,
    });
    const matFaint = new THREE.MeshStandardMaterial({
      color: 0xff8833, roughness: 0.6, metalness: 0.1,
      transparent: true, opacity: 0.45, depthWrite: false,
    });

    /* Each chevron is two angled box segments forming a V shape pointing
       down — built from two thin boxes rotated ±35°. */
    const buildChevron = (m, scale = 1) => {
      const c = new THREE.Group();
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(scale * 0.28, scale * 0.06, scale * 0.06), m,
      );
      const armR = arm.clone();
      arm.rotation.z  =  Math.PI / 5;   // tilt left arm down-right
      armR.rotation.z = -Math.PI / 5;   // tilt right arm down-left
      arm.position.set(-scale * 0.12,  scale * 0.09, 0);
      armR.position.set( scale * 0.12,  scale * 0.09, 0);
      c.add(arm); c.add(armR);
      return c;
    };

    const cv1 = buildChevron(mat, 1.0);   cv1.position.y = 0.24;
    const cv2 = buildChevron(matFaint, 1.3); cv2.position.y = 0.46;
    grp.add(cv1); grp.add(cv2);

    grp.position.set(cx, topY + 0.55, cz);
    this._scene.add(grp);
    this._arrowWidget = grp;

    /* Vertical float — bob 0.18 m up and down in a 1.1 s sine loop. */
    const baseY = topY + 0.55;
    this._widgetFloatTween = gsap.to(grp.position, {
      y: baseY + 0.18,
      duration: 1.1,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }

  /* ── Soft activation pulse for procedural valves/MCP ────
     Pulses only the rim/handle/button emissive — does NOT touch
     surrounding GLB tanks like _highlightModel did. */
  _pulseProcedural(model) {
    const pulseMats = [];
    model.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) {
        if (!('emissiveIntensity' in m)) continue;
        /* Pulse parts that have ANY emissive base (handwheel rim/
           spokes/lever/button). Default base is now 0.18 so the
           threshold drops to 0.05 to still pick them up. */
        if ((m.emissiveIntensity ?? 0) > 0.05) {
          pulseMats.push({ mat: m, base: m.emissiveIntensity });
        }
      }
    });
    if (pulseMats.length === 0) return;

    const state = { v: 1 };
    this._proceduralPulseTween = gsap.to(state, {
      v: 1.9,
      duration: 0.7,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        for (const p of pulseMats) p.mat.emissiveIntensity = p.base * state.v;
      },
    });
    this._proceduralPulseRestore = () => {
      for (const p of pulseMats) p.mat.emissiveIntensity = p.base;
    };
  }

  /* ── Valve drag → spin handwheel widget ────────────────── */

  _beginValveRotate(direction) {
    this._currentRotation = 0;
    this._rotateSign = direction === 'ccw' ? -1 : 1;

    if (this._widget && this._widget.userData.spinPart) {
      this._widgetSpinPart = this._widget.userData.spinPart;
    }
    // Stop the float anim during rotation so the wheel reads as locked-in
    if (this._widgetFloatTween) this._widgetFloatTween.pause();
  }

  /* ── MCP per-strike crack flash (in-world feedback) ───── */

  _mcpStrikeFlash(modelId, hitN) {
    const model = this._world.getPlacedModel(modelId);
    if (!model) return;

    // Brief white emissive pulse on the call-point housing — reads as a
    // glass crack flash. Saturates more on each successive strike so the
    // 3rd one before shatter looks bright/hot.
    const intensity = 1.5 + hitN * 1.0;
    const mats = [];
    model.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) if ('emissive' in m) mats.push(m);
    });
    const orig = mats.map((m) => ({
      color: m.emissive.clone(),
      intensity: m.emissiveIntensity ?? 1,
    }));
    mats.forEach((m) => {
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = intensity;
    });

    // Quick shake on the widget (beacon) so the player sees impact.
    if (this._widget) {
      const baseX = this._widget.position.x;
      const baseZ = this._widget.position.z;
      gsap.fromTo(
        this._widget.position,
        { x: baseX + 0.04, z: baseZ - 0.04 },
        { x: baseX, z: baseZ, duration: 0.18, ease: 'elastic.out(1.4,0.4)' },
      );
    }

    gsap.to({ t: 0 }, {
      t: 1,
      duration: 0.35,
      ease: 'power2.out',
      onUpdate: function () {
        const t = this.targets()[0].t;
        mats.forEach((m, i) => {
          m.emissiveIntensity =
            orig[i].intensity + (intensity - orig[i].intensity) * (1 - t);
        });
      },
      onComplete: () => {
        mats.forEach((m, i) => {
          m.emissive.copy(orig[i].color);
          m.emissiveIntensity = orig[i].intensity;
        });
      },
    });
  }

  /* ── Glass break (MCP smash) ────────────────────────────────
     Procedural PlaneGeometry shards removed — replaced by the
     green-screen video overlay (_playGlassBreakVFX in Game.js).
     We still: hide the glass pane so the button is exposed, and
     fire a brief white flash on the MCP body for tactile feedback. */

  _spawnGlassShards(modelId) {
    const model = this._world.getPlacedModel(modelId);
    if (!model) return;

    // Hide the procedural glass pane so the MCP button is now visible.
    const glass = model.userData?.glass;
    if (glass) glass.visible = false;

    // Brief white flash on the MCP body — fades over 0.5s.
    const flashMats = [];
    model.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) if ('emissive' in m) flashMats.push(m);
    });
    const flashOrig = flashMats.map((m) => ({
      color: m.emissive.clone(),
      intensity: m.emissiveIntensity ?? 1,
    }));
    flashMats.forEach((m) => {
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = 3.0;
    });

    const state = { t: 0 };
    const tween = gsap.to(state, {
      t: 1,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => {
        flashMats.forEach((m, i) => {
          m.emissiveIntensity =
            flashOrig[i].intensity + (3.0 - flashOrig[i].intensity) * (1 - state.t);
        });
      },
      onComplete: () => {
        flashMats.forEach((m, i) => {
          m.emissive.copy(flashOrig[i].color);
          m.emissiveIntensity = flashOrig[i].intensity;
        });
        this._activeShardTweens.delete(tween);
      },
    });
    this._activeShardTweens.add(tween);
  }

  /* ── Hover state on procedural equipment rims ──────────── */

  _setHover(data) {
    // Restore previous hover material state
    if (this._hoverRestore) { this._hoverRestore(); this._hoverRestore = null; }
    if (!data) return;
    const modelId = STEP_TO_MODEL[data.stepId];
    if (!modelId) return;
    const model = this._world.getPlacedModel(modelId);
    if (!model) return;

    /* Bump only parts that already glow (rims/spokes/lever) by 2.4×.
       Threshold dropped to 0.05 to match the toned-down default base
       (0.18 on rim, 0.11 on spokes) introduced when we removed the
       bloom-cone halo on procedural valves. */
    const bumped = [];
    model.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) {
        if (!('emissiveIntensity' in m)) continue;
        if ((m.emissiveIntensity ?? 0) > 0.05) {
          bumped.push({ m, base: m.emissiveIntensity });
          m.emissiveIntensity = m.emissiveIntensity * 2.4;
        }
      }
    });
    this._hoverRestore = () => {
      for (const p of bumped) p.m.emissiveIntensity = p.base;
    };
  }

  /* ── Valve in-world feedback driven by current rotation ── */

  _updateValveProgress() {
    if (!this._widget) return;
    const stem = this._widget.userData?.stemGroup;
    const dial = this._widget.userData?.dialNeedle;

    // Drive stem rise + dial needle from |currentRotation|.
    // Assume one full turn (2π) ≈ fully open.
    const turns = Math.abs(this._currentRotation) / (Math.PI * 2);
    const open = Math.min(1, turns);

    if (stem && this._stemBaseY === undefined) this._stemBaseY = stem.position.y;
    if (stem && this._stemBaseY !== undefined) {
      stem.position.y = this._stemBaseY + open * 0.10;
    }
    if (dial) {
      // CLOSED at 0°, OPEN at 90° (Math.PI/2)
      dial.rotation.z = open * (Math.PI / 2);
    }
  }

  _wrongDirectionFlash() {
    if (!this._widget) return;
    // Find rim materials (high-emissive parts) and red-flash them.
    const mats = [];
    this._widget.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) {
        if (!('emissive' in m)) continue;
        if ((m.emissiveIntensity ?? 0) > 0.05) mats.push(m);
      }
    });
    if (mats.length === 0) return;
    const orig = mats.map((m) => ({
      color: m.emissive.clone(),
      intensity: m.emissiveIntensity ?? 1,
    }));
    mats.forEach((m) => { m.emissive.setHex(0xff0000); m.emissiveIntensity = 2.2; });
    gsap.to({ t: 0 }, {
      t: 1, duration: 0.22, ease: 'power2.out',
      onUpdate: function () {
        const t = this.targets()[0].t;
        mats.forEach((m, i) => { m.emissiveIntensity = 2.2 + (orig[i].intensity - 2.2) * t; });
      },
      onComplete: () => {
        mats.forEach((m, i) => { m.emissive.copy(orig[i].color); m.emissiveIntensity = orig[i].intensity; });
      },
    });
  }

  /* ── Completion flash ──────────────────────────────────── */

  _completionPulse(stepId) {
    const modelId = STEP_TO_MODEL[stepId];
    if (!modelId) return;
    const model = this._world.getPlacedModel(modelId);
    if (!model) return;

    // Flip status LED red→green and pin the dial to OPEN.
    const led = model.userData?.statusLED;
    if (led && led.material) {
      led.material.emissive.setHex(0x00ff44);
      led.material.color.setHex(0x004422);
      led.material.emissiveIntensity = 1.4;
    }
    const dial = model.userData?.dialNeedle;
    if (dial) {
      gsap.to(dial.rotation, { z: Math.PI / 2, duration: 0.4, ease: 'power2.out' });
    }

    const mats = [];
    model.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const list = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of list) if ('emissive' in m) mats.push(m);
    });

    const orig = mats.map(m => ({
      color: m.emissive.clone(),
      intensity: m.emissiveIntensity ?? 1,
    }));
    for (const m of mats) m.emissive.setHex(0x33ff66);

    const pulse = { v: 2.5 };
    gsap.to(pulse, {
      v: 0,
      duration: 1.0,
      ease: 'power2.out',
      onUpdate: () => { for (const m of mats) m.emissiveIntensity = pulse.v; },
      onComplete: () => {
        mats.forEach((m, i) => {
          m.emissive.copy(orig[i].color);
          m.emissiveIntensity = orig[i].intensity;
        });
      },
    });
  }

  dispose() {
    this._clearHighlight();
    this._clearWidget();
    for (const t of this._activeShardTweens) t.kill();
    this._activeShardTweens.clear();
  }
}
