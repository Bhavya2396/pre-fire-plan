import * as THREE from 'three';

/**
 * Procedural industrial equipment built entirely from Three.js geometry.
 *
 * The previous valve GLBs were small, low-contrast and often hidden behind
 * pipes/tanks. These procedural builds:
 *   • read clearly at gameplay distance (~2–3 m)
 *   • are sized predictably (no per-GLB targetSize tuning)
 *   • EXPOSE their interactive sub-parts directly via userData:
 *       - userData.handwheel  → the rotating sub-group (drives EquipmentAnimator)
 *       - userData.lever      → the rotating lever sub-group
 *       - userData.glass      → the breakable glass pane (MCP)
 *       - userData.button     → the call button beneath the glass
 *   • are tagged on every child mesh with `userData.interactable = true`
 *     and the same `interactionData` we pass in, so the existing
 *     InteractionSystem raycast picks them up natively.
 *
 * Everything is built around local origin (x=0, z=0, ground at y=0) so the
 * caller can position the whole group with `group.position.set(...)`.
 */

/* Industry standard valve body colours — muted/desaturated so they
   look like painted cast iron, not plastic toys. */
const VALVE_BODY_COLORS = {
  gate:      0x8b2020, // dark fire-safety red
  butterfly: 0x1a4c80, // dark steel blue — utility/water
  ball:      0x7a6200, // dark amber — isolation/ball valve
  cooling:   0x1a4c80,
  fire:      0x8b2020,
};

/* ── Industrial palette — NO emissive on interactive equipment.
   Glow/bloom was confusing at distance and made objects look like
   neon signs. Emissive is now 0 everywhere; the active-step arrow
   (built by EquipmentAnimator) guides the player instead. */
function _bodyMat(color) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.45,
  });
}

function _flangeMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x3a3a3a, roughness: 0.5, metalness: 0.9,
  });
}

function _stemMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x282828, roughness: 0.4, metalness: 0.9,
  });
}

/* Concrete pedestal used by every assembly style as a hard ground
   anchor. Even when the valve isn't perfectly snapped to a tank shell
   or wall, this gives it a believable foundation instead of letting
   the riser/stub float in mid-air. */
function _groundPedestal(width = 0.55, depth = 0.55, height = 0.20) {
  const grp = new THREE.Group();
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: 0x9a958c, roughness: 0.95, metalness: 0.05,
    }),
  );
  block.position.y = height / 2;
  block.receiveShadow = true;
  block.castShadow = true;
  grp.add(block);
  /* Subtle weathering band along the bottom — adds visual weight so
     the pedestal doesn't look like a clean test cube. */
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.02, 0.03, depth * 1.02),
    new THREE.MeshStandardMaterial({
      color: 0x5e574e, roughness: 0.95, metalness: 0.05,
    }),
  );
  band.position.y = 0.015;
  grp.add(band);
  return grp;
}

/* ──────────────────────────────────────────────────────────────────
   HANDWHEEL — re-used by multiple valve types
   Returned group has userData.spin = innerWheelGroup
   ────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────
   HANDWHEEL — dark cast-iron, 6 spokes, VERTICAL face toward player.
   Like a car steering wheel: the disc stands upright and the player
   grabs the rim and turns it clockwise/counterclockwise.
   EquipmentAnimator billboards the outer group so the face always
   looks at the camera; the inner spin group rotates on Z.
   ────────────────────────────────────────────────────────────────── */
function buildHandwheel(radius = 0.32) {
  const grp = new THREE.Group();
  const wheel = new THREE.Group();
  grp.add(wheel);

  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a, roughness: 0.72, metalness: 0.28,
  });

  /* Rim in the XY plane — face points toward +Z (toward the player).
     No rotation needed; default torus is already in XY plane. */
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.14, 12, 32),
    ironMat,
  );
  wheel.add(rim);

  /* 6 spokes in the XY plane — rotation.z spaces them 30° apart. */
  for (let i = 0; i < 6; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 1.88, radius * 0.095, radius * 0.095),
      ironMat,
    );
    spoke.rotation.z = (i * Math.PI) / 6;
    wheel.add(spoke);
  }

  /* Hub boss — short cylinder along Z (protrudes toward the player,
     like a real handwheel centre cap). */
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.20, radius * 0.28, 14),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.7 }),
  );
  hub.rotation.x = Math.PI / 2;   // Y-cylinder → Z-axis (protrudes toward camera)
  wheel.add(hub);

  grp.userData.spin        = wheel;
  grp.userData.wheelGroup  = grp;   // outer group is what gets billboarded
  return grp;
}

/* ──────────────────────────────────────────────────────────────────
   GATE VALVE — horizontal pipe body with a FRONT-FACING stem column
   and handwheel mounted like a ship's helm / car steering wheel.

   Layout (viewed from the player's side):

        [O]        ← handwheel face toward player (billboarded)
         |
      [column]     ← stem tube running along +Z toward player
   ════[BODY]════  ← horizontal cylinder, pipe along X-axis
   pipe        pipe

   The handwheel sits at the END of the forward stem column so the
   player faces it head-on and turns it clockwise/anticlockwise.
   ────────────────────────────────────────────────────────────────── */

export function buildGateValve(opts = {}) {
  const colorKey  = opts.colorKey || 'gate';
  const tag       = opts.tag      || 'GV';
  const bodyColor = VALVE_BODY_COLORS[colorKey] || VALVE_BODY_COLORS.gate;
  const grp = new THREE.Group();

  const boltMat = new THREE.MeshStandardMaterial({
    color: 0x1e1e1e, roughness: 0.50, metalness: 0.95,
  });

  const BODY_Y = 0.65;
  const BODY_R = 0.20;
  const BODY_L = 0.30;
  const PIPE_R = 0.095;
  const PIPE_L = 0.32;

  /* ── Main horizontal body (axis along X) */
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(BODY_R, BODY_R, BODY_L, 22),
    _bodyMat(bodyColor),
  );
  body.rotation.z = Math.PI / 2;
  body.position.y = BODY_Y;
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  /* ── Pipe stubs + shoulder flanges + bolt studs either side */
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R, PIPE_R, PIPE_L, 16),
      _stemMat(),
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(sx * (BODY_L / 2 + PIPE_L / 2), BODY_Y, 0);
    pipe.castShadow = true;
    grp.add(pipe);

    const fl = new THREE.Mesh(
      new THREE.CylinderGeometry(BODY_R * 0.88, BODY_R * 0.88, 0.055, 18),
      _flangeMat(),
    );
    fl.rotation.z = Math.PI / 2;
    fl.position.set(sx * (BODY_L / 2 - 0.01), BODY_Y, 0);
    grp.add(fl);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const stud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.07, 6),
        boltMat,
      );
      stud.rotation.z = Math.PI / 2;
      stud.position.set(
        sx * (BODY_L / 2 - 0.01),
        BODY_Y + Math.sin(a) * (BODY_R * 0.70),
        Math.cos(a) * (BODY_R * 0.70),
      );
      grp.add(stud);
    }

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R * 1.5, PIPE_R * 1.5, 0.04, 12),
      _flangeMat(),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sx * (BODY_L / 2 + PIPE_L - 0.02), BODY_Y, 0);
    grp.add(cap);
  }

  /* ── YOKE PLATE — circular flange on the front face of the body.
     This is the "bonnet boss" that the steering column exits through. */
  const yoke = new THREE.Mesh(
    new THREE.CylinderGeometry(BODY_R * 0.64, BODY_R * 0.64, 0.030, 16),
    _flangeMat(),
  );
  yoke.rotation.x = Math.PI / 2;
  yoke.position.set(0, BODY_Y, BODY_R + 0.015);
  grp.add(yoke);

  /* ── STEERING COLUMN: stem tube going from yoke face toward player (+Z).
     This is the "column" in the ship-wheel / car-wheel analogy. */
  const COL_L    = 0.26;
  const COL_Z0   = BODY_R + 0.030;

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.055, COL_L, 12),
    _stemMat(),
  );
  column.rotation.x = Math.PI / 2;
  column.position.set(0, BODY_Y, COL_Z0 + COL_L * 0.5);
  column.castShadow = true;
  grp.add(column);

  /* Collar ring where column meets the wheel hub — like a bearing housing. */
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.072, 0.072, 0.028, 14),
    _flangeMat(),
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, BODY_Y, COL_Z0 + COL_L + 0.014);
  grp.add(collar);

  /* ── STEM GROUP + WHEEL — at the end of the column.
     The outer wheelGroup is what EquipmentAnimator billboards so the
     disc always faces the camera exactly (steering-wheel look). */
  const stemGroup = new THREE.Group();
  stemGroup.position.set(0, BODY_Y, COL_Z0 + COL_L + 0.028);
  grp.add(stemGroup);

  const wheelGroup = buildHandwheel(0.28);
  stemGroup.add(wheelGroup);

  const WHEEL_Y = stemGroup.position.y;

  /* ── Label above the valve body */
  const tagText = _makeTextSprite(tag, '#222', '#fff4c0');
  tagText.scale.set(0.22, 0.08, 1);
  tagText.position.set(0, BODY_Y + BODY_R + 0.12, 0);
  grp.add(tagText);

  /* ── Status LED on top of body */
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x220000, roughness: 0.5, metalness: 0.3 }),
  );
  led.position.set(0.10, BODY_Y + BODY_R + 0.04, 0);
  grp.add(led);

  const dial = _buildPositionDial();
  dial.position.set(-0.10, BODY_Y + BODY_R + 0.04, 0.02);
  dial.rotation.x = -Math.PI / 2;
  grp.add(dial);

  grp.userData.handwheel  = wheelGroup.userData.spin;
  grp.userData.stemGroup  = stemGroup;
  grp.userData.wheelGroup = wheelGroup;
  grp.userData.statusLED  = led;
  grp.userData.dialNeedle = dial.userData.needle;
  grp.userData.wheelY     = WHEEL_Y;
  grp.userData.kind       = 'gate-valve';
  return grp;
}

/* Small position-indicator dial — quarter-arc with a needle that
   sweeps from CLOSED (0°) to OPEN (90°) as the player turns. */
function _buildPositionDial() {
  const grp = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.CircleGeometry(0.07, 16),
    new THREE.MeshBasicMaterial({ color: 0x222222 }),
  );
  grp.add(bg);
  const arc = new THREE.Mesh(
    new THREE.RingGeometry(0.045, 0.06, 16, 1, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x44ff88, side: THREE.DoubleSide }),
  );
  arc.position.z = 0.0005;
  grp.add(arc);
  const needle = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.008, 0.005),
    new THREE.MeshBasicMaterial({ color: 0xffaa22 }),
  );
  needle.position.set(0.025, 0, 0.001);
  const pivot = new THREE.Group();
  pivot.add(needle);
  grp.add(pivot);
  grp.userData.needle = pivot;
  return grp;
}

/* ──────────────────────────────────────────────────────────────────
   BUTTERFLY VALVE — lug-body disc inline in pipe. The gearbox
   actuator sits on the FRONT face of the disc (toward the player)
   with the handwheel column extending further forward, like a ship's
   helm at dock — the operator faces the wheel head-on.

   Side view (player at right):
        [O]       ← wheel face toward player (billboarded)
         |
     [GEARBOX]   ← on front face of disc
   ═══[DISC]═══  ← lug disc inline, pipe along X-axis
   pipe       pipe
   ────────────────────────────────────────────────────────────────── */

export function buildButterflyValve(opts = {}) {
  const colorKey  = opts.colorKey || 'butterfly';
  const tag       = opts.tag      || 'BFV';
  const bodyColor = VALVE_BODY_COLORS[colorKey];
  const grp = new THREE.Group();

  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x111111, roughness: 0.65, metalness: 0.45,
  });
  const boltMat = new THREE.MeshStandardMaterial({
    color: 0x1e1e1e, roughness: 0.45, metalness: 0.95,
  });
  const boreMat = new THREE.MeshStandardMaterial({
    color: 0x888888, roughness: 0.25, metalness: 0.9,
  });

  const BODY_Y = 0.62;
  const DISC_R = 0.32;
  const DISC_D = 0.22;
  const PIPE_R = 0.10;
  const PIPE_L = 0.28;

  /* ── LUG DISC BODY (axis along X) */
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_D, 22),
    _bodyMat(bodyColor),
  );
  body.rotation.z = Math.PI / 2;
  body.position.y = BODY_Y;
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_R * 0.88, PIPE_R * 0.88, DISC_D + 0.02, 18),
    boreMat,
  );
  bore.rotation.z = Math.PI / 2;
  bore.position.y = BODY_Y;
  grp.add(bore);

  /* ── LUG BOSSES at ±Y and ±Z */
  for (const [ly, lz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const lug = new THREE.Mesh(
      new THREE.BoxGeometry(DISC_D + 0.05, 0.11, 0.09),
      _bodyMat(bodyColor),
    );
    lug.position.set(0, BODY_Y + ly * (DISC_R + 0.02), lz * (DISC_R + 0.02));
    lug.castShadow = true;
    grp.add(lug);
  }

  /* ── BOLT STUDS on disc faces (±X) */
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const stud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.05, 6),
        boltMat,
      );
      stud.rotation.z = Math.PI / 2;
      stud.position.set(
        sx * (DISC_D / 2 + 0.025),
        BODY_Y + Math.sin(a) * (DISC_R * 0.72),
        Math.cos(a) * (DISC_R * 0.72),
      );
      grp.add(stud);
    }
  }

  /* ── PIPE STUBS either side */
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R, PIPE_R, PIPE_L, 16),
      _stemMat(),
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(sx * (DISC_D / 2 + PIPE_L / 2), BODY_Y, 0);
    pipe.castShadow = true;
    grp.add(pipe);

    const fl = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R * 1.52, PIPE_R * 1.52, 0.048, 14),
      _flangeMat(),
    );
    fl.rotation.z = Math.PI / 2;
    fl.position.set(sx * (DISC_D / 2 + 0.024), BODY_Y, 0);
    grp.add(fl);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R * 1.40, PIPE_R * 1.40, 0.04, 12),
      _flangeMat(),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sx * (DISC_D / 2 + PIPE_L - 0.02), BODY_Y, 0);
    grp.add(cap);
  }

  /* ── FRONT GEARBOX — mounted on the +Z face of the disc.
     This is what the operator faces when operating the valve.
     The gearbox housing protrudes forward from the disc face. */
  const GB_W  = 0.22;
  const GB_H  = 0.24;
  const GB_D  = 0.18;   // gearbox depth along Z
  const GB_Z0 = DISC_R; // gearbox starts at disc front face

  const gearbox = new THREE.Mesh(
    new THREE.BoxGeometry(GB_W, GB_H, GB_D),
    darkMat,
  );
  gearbox.position.set(0, BODY_Y, GB_Z0 + GB_D * 0.5);
  gearbox.castShadow = true;
  grp.add(gearbox);

  /* Bolt details on gearbox body face (the back face, at z = GB_Z0) */
  for (const [bx, by] of [[-0.08, 0.09], [0.08, 0.09], [-0.08, -0.09], [0.08, -0.09]]) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.04, 6),
      boltMat,
    );
    b.rotation.x = Math.PI / 2;
    b.position.set(bx, BODY_Y + by, GB_Z0 + 0.02);
    grp.add(b);
  }

  /* Position indicator slot on gearbox front face */
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.08, 0.008),
    new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.5 }),
  );
  slot.position.set(0, BODY_Y, GB_Z0 + GB_D - 0.004);
  grp.add(slot);

  /* ── STEERING COLUMN: exits gearbox front face toward player */
  const COL_L  = 0.20;
  const COL_Z0 = GB_Z0 + GB_D;

  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.048, COL_L, 12),
    _stemMat(),
  );
  column.rotation.x = Math.PI / 2;
  column.position.set(0, BODY_Y, COL_Z0 + COL_L * 0.5);
  column.castShadow = true;
  grp.add(column);

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.066, 0.066, 0.026, 14),
    _flangeMat(),
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, BODY_Y, COL_Z0 + COL_L + 0.013);
  grp.add(collar);

  /* ── STEM GROUP + WHEEL */
  const stemGroup = new THREE.Group();
  stemGroup.position.set(0, BODY_Y, COL_Z0 + COL_L + 0.026);
  grp.add(stemGroup);

  const wheelGroup = buildHandwheel(0.26);
  stemGroup.add(wheelGroup);

  const WHEEL_Y = stemGroup.position.y;

  /* ── TAG + LED */
  const tagText = _makeTextSprite(tag, '#222', '#fff4c0');
  tagText.scale.set(0.28, 0.09, 1);
  tagText.position.set(0, BODY_Y + DISC_R + 0.12, 0);
  grp.add(tagText);

  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x220000, roughness: 0.5, metalness: 0.3 }),
  );
  led.position.set(0.10, BODY_Y + DISC_R + 0.05, 0);
  grp.add(led);

  grp.userData.handwheel  = wheelGroup.userData.spin;
  grp.userData.stemGroup  = stemGroup;
  grp.userData.wheelGroup = wheelGroup;
  grp.userData.statusLED  = led;
  grp.userData.wheelY     = WHEEL_Y;
  grp.userData.kind       = 'butterfly-valve';
  return grp;
}

/* ──────────────────────────────────────────────────────────────────
   BALL/LEVER VALVE — quarter-turn lever. The lever arm POINTS
   TOWARD THE PLAYER (+Z), so the operator faces the tip of the
   handle. Rotating 90° sweeps the arm left or right — exactly how
   real pipeline ball valves are operated from the front.

   View from player side:
       ←arm tip → [GRIP]  ← this tip points at player
           ↑
         [HUB]            ← on top of body
       pipe—[BODY]—pipe
   ────────────────────────────────────────────────────────────────── */

export function buildLeverValve(opts = {}) {
  const colorKey = opts.colorKey || 'ball';
  const tag      = opts.tag      || 'BV';
  const grp = new THREE.Group();

  const boltMat = new THREE.MeshStandardMaterial({
    color: 0x1e1e1e, roughness: 0.50, metalness: 0.95,
  });

  const BODY_Y = 0.60;
  const BODY_R = 0.18;
  const PIPE_R = 0.095;
  const PIPE_L = 0.26;

  /* ── Spheroidal ball valve body */
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(BODY_R, 16, 12),
    _bodyMat(VALVE_BODY_COLORS[colorKey]),
  );
  body.scale.set(1.12, 0.92, 1.12);
  body.position.y = BODY_Y;
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  /* ── Pipe stubs + flanges either side */
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R, PIPE_R, PIPE_L, 14),
      _stemMat(),
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(sx * (BODY_R * 1.12 + PIPE_L / 2), BODY_Y, 0);
    pipe.castShadow = true;
    grp.add(pipe);

    const fl = new THREE.Mesh(
      new THREE.CylinderGeometry(BODY_R * 0.82, BODY_R * 0.82, 0.048, 14),
      _flangeMat(),
    );
    fl.rotation.z = Math.PI / 2;
    fl.position.set(sx * (BODY_R * 1.12 - 0.01), BODY_Y, 0);
    grp.add(fl);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const stud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.013, 0.058, 6),
        boltMat,
      );
      stud.rotation.z = Math.PI / 2;
      stud.position.set(
        sx * (BODY_R * 1.12 - 0.01),
        BODY_Y + Math.sin(a) * (BODY_R * 0.60),
        Math.cos(a) * (BODY_R * 0.60),
      );
      grp.add(stud);
    }

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R * 1.42, PIPE_R * 1.42, 0.038, 10),
      _flangeMat(),
    );
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sx * (BODY_R * 1.12 + PIPE_L - 0.02), BODY_Y, 0);
    grp.add(cap);
  }

  /* ── STEM: vertical, rising from top of body */
  const STEM_BOT = BODY_Y + BODY_R * 0.88;
  const STEM_H   = 0.14;

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, STEM_H, 10),
    _stemMat(),
  );
  stem.position.y = STEM_BOT + STEM_H * 0.5;
  grp.add(stem);

  const nut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.038, 8),
    _flangeMat(),
  );
  nut.position.y = STEM_BOT + 0.019;
  grp.add(nut);

  /* ── LEVER GROUP — rotates around Y (quarter-turn sweep).
     The lever arm extends along +Z (toward the player) so when the
     player faces the valve they see the arm tip coming at them.
     Rotating 90° swings the arm to the left or right — the natural
     quarter-turn action for an industrial ball valve. */
  const leverGroup = new THREE.Group();
  leverGroup.position.y = STEM_BOT + STEM_H + 0.019;
  grp.add(leverGroup);

  /* Hub — the pivot block at the top of the stem */
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, 0.062, 10),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.8 }),
  );
  leverGroup.add(hub);

  /* Lever arm — extends along +Z (toward player) */
  const leverMat = new THREE.MeshStandardMaterial({
    color: 0xc8940a, roughness: 0.55, metalness: 0.45,
  });
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.52),
    leverMat,
  );
  arm.position.z = 0.24;   // arm centre along +Z
  arm.castShadow = true;
  leverGroup.add(arm);

  /* Grip tip — tapered cylinder at the end of the arm */
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.022, 0.14, 10),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.55 }),
  );
  tip.rotation.x = Math.PI / 2;  // Y-cylinder → Z-axis
  tip.position.z = 0.50;
  leverGroup.add(tip);

  /* Open/closed stop plate under the lever */
  const stop = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.038, 0.055),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }),
  );
  stop.position.y = -0.038;
  leverGroup.add(stop);

  /* ── TAG + LED */
  const tagText = _makeTextSprite(tag, '#222', '#fff4c0');
  tagText.scale.set(0.26, 0.09, 1);
  tagText.position.set(0, BODY_Y + BODY_R + 0.12, 0);
  grp.add(tagText);

  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.017, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x220000, roughness: 0.5, metalness: 0.3 }),
  );
  led.position.set(0.10, BODY_Y + BODY_R + 0.04, 0);
  grp.add(led);

  grp.userData.handwheel   = leverGroup;
  grp.userData.statusLED   = led;
  grp.userData.quarterTurn = true;
  grp.userData.wheelY      = leverGroup.position.y;
  grp.userData.kind        = 'lever-valve';
  return grp;
}

/* ──────────────────────────────────────────────────────────────────
   MANUAL CALL POINT (MCP) — red wall-mount with a glass pane and a
   yellow button visible behind. Glass is exposed via userData.glass
   so EquipmentAnimator can shatter (hide) it in the world.
   Total size ~ 0.30 × 0.30 × 0.10 m.
   ────────────────────────────────────────────────────────────────── */

export function buildMCP(opts = {}) {
  const grp = new THREE.Group();

  // Backplate / housing — fire-safety red, no emissive
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.42, 0.10),
    new THREE.MeshStandardMaterial({
      color: 0xcc1100,
      roughness: 0.5,
      metalness: 0.2,
    }),
  );
  housing.position.y = 0.21;
  housing.castShadow = true;
  housing.receiveShadow = true;
  grp.add(housing);

  // White text label "BREAK GLASS" along the top
  const labelTop = _makeTextSprite('BREAK GLASS', '#fff', '#cc1100');
  labelTop.scale.set(0.36, 0.06, 1);
  labelTop.position.set(0, 0.40, 0.06);
  grp.add(labelTop);

  // Yellow call button visible behind glass
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffd000,
      emissive: 0xffaa00,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.4,
    }),
  );
  button.rotation.x = Math.PI / 2;
  button.position.set(0, 0.21, 0.054);
  grp.add(button);

  // PRESS label on the button
  const pressLbl = _makeTextSprite('PRESS', '#222', '#ffd000');
  pressLbl.scale.set(0.10, 0.03, 1);
  pressLbl.position.set(0, 0.21, 0.078);
  grp.add(pressLbl);

  // Glass pane — slightly cyan-white, transparent. Frames the button.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.30, 0.30, 0.012),
    new THREE.MeshStandardMaterial({
      color: 0xeaf6ff,
      transparent: true,
      opacity: 0.55,
      roughness: 0.05,
      metalness: 0.0,
    }),
  );
  glass.position.set(0, 0.21, 0.075);
  glass.castShadow = false;
  glass.userData.kind = 'mcp-glass';
  grp.add(glass);

  // Frame around the glass
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x222222, roughness: 0.5, metalness: 0.6,
  });
  const frameGeo = new THREE.BoxGeometry(0.34, 0.02, 0.02);
  const fT = new THREE.Mesh(frameGeo, frameMat); fT.position.set(0,  0.36, 0.075); grp.add(fT);
  const fB = new THREE.Mesh(frameGeo, frameMat); fB.position.set(0,  0.06, 0.075); grp.add(fB);
  const frameGeoV = new THREE.BoxGeometry(0.02, 0.34, 0.02);
  const fL = new THREE.Mesh(frameGeoV, frameMat); fL.position.set(-0.16, 0.21, 0.075); grp.add(fL);
  const fR = new THREE.Mesh(frameGeoV, frameMat); fR.position.set( 0.16, 0.21, 0.075); grp.add(fR);

  grp.userData.glass = glass;
  grp.userData.button = button;
  grp.userData.kind = 'mcp';
  return grp;
}

/* ──────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────── */

function _makeTextSprite(text, fg = '#000', bg = '#fff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.font = 'bold 80px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  return new THREE.Sprite(mat);
}

/* Apply interaction tags to every mesh inside an equipment group so
 * the existing InteractionSystem raycast picks any sub-mesh up. */
export function tagInteractable(group, interactionData) {
  group.traverse((c) => {
    if (c.isMesh) {
      c.userData.interactable = true;
      c.userData.interactionData = interactionData;
    }
  });
}

/* ──────────────────────────────────────────────────────────────────
   VALVE ASSEMBLIES — valve + connecting pipework + bracket.
   These make the valve read as part of the surrounding equipment
   (tank shell, dyke wall, manifold pad) rather than a free-standing
   widget. Each style returns a Group whose userData.handwheel is
   forwarded from the underlying valve so the interaction system
   keeps working unchanged.
   ────────────────────────────────────────────────────────────────── */

const PIPE_MAT = () => new THREE.MeshStandardMaterial({
  color: 0x4a4a4a, roughness: 0.55, metalness: 0.85,
});

const PAINTED_PIPE_MAT = (color = 0x8a3a30) => new THREE.MeshStandardMaterial({
  color, roughness: 0.55, metalness: 0.45,
});

const CONCRETE_MAT = () => new THREE.MeshStandardMaterial({
  color: 0x9c9890, roughness: 0.92, metalness: 0.05,
});

const STEEL_BRACKET_MAT = () => new THREE.MeshStandardMaterial({
  color: 0x39414a, roughness: 0.5, metalness: 0.7,
});

function _flangeWithBolts(radius = 0.20) {
  const grp = new THREE.Group();
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.05, 18),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.85 }),
  );
  grp.add(flange);
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.4, metalness: 0.95 });
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6),
      boltMat,
    );
    bolt.position.set(Math.cos(a) * radius * 0.78, 0, Math.sin(a) * radius * 0.78);
    grp.add(bolt);
  }
  return grp;
}

function _buildValveByKind(kind, opts) {
  if (kind === 'gate')      return buildGateValve(opts);
  if (kind === 'butterfly') return buildButterflyValve(opts);
  if (kind === 'lever')     return buildLeverValve(opts);
  return buildGateValve(opts);
}

/**
 * Build a valve assembly with surrounding pipework + bracket.
 *
 * spec:
 *   kind:     'gate' | 'butterfly' | 'lever'
 *   style:    'tank-side' | 'pipe-riser' | 'manifold-pad' | 'wall-stub'
 *   colorKey: passed to the valve builder
 *   tag:      passed to the valve builder
 *   facing:   yaw rotation in radians (which way the wheel/lever faces)
 *   pipeColor: hex for the painted pipework
 */
export function buildValveAssembly(spec) {
  const kind = spec.kind || 'gate';
  const style = spec.style || 'manifold-pad';
  const facing = spec.facing || 0;
  const pipeColor = spec.pipeColor ?? 0x8a3a30;

  const root = new THREE.Group();

  if (style === 'tank-side') {
    /* The valve body is a HORIZONTAL cylinder (pipe along X-axis) with
       BODY_Y = 0.65 m above the valve group origin. The valve itself
       sits on the ground (y = 0) so body centre lands at 0.65 m —
       matching the horizontal pipe level. The old elbow+riser is gone;
       a straight pipe run exits toward the tank shell (-X direction)
       at body height, and a steel strut from the pedestal supports it. */
    const PED_H   = 0.18;
    const PIPE_Y  = 0.65;  // matches gate-valve BODY_Y exactly
    const VALVE_X = 0.20;  // lateral offset inside assembly (centre of valve)

    const pedestal = _groundPedestal(0.55, 0.55, PED_H);
    pedestal.position.set(0.0, 0, 0);
    root.add(pedestal);

    /* Vertical steel support column from pedestal top to the pipe. */
    const strutH = PIPE_Y - PED_H;
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, strutH, 0.12),
      STEEL_BRACKET_MAT(),
    );
    strut.position.set(VALVE_X, PED_H + strutH * 0.5, 0);
    root.add(strut);

    /* Pipe clamp saddle at the top of the strut (visual anchor). */
    const saddle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12, 1, false, 0, Math.PI),
      STEEL_BRACKET_MAT(),
    );
    saddle.rotation.x = Math.PI;
    saddle.position.set(VALVE_X, PIPE_Y + 0.01, 0);
    root.add(saddle);

    /* Horizontal stub toward tank shell (-X) at body-pipe height.
       Sized so the open end sits ~0.85 m from the valve centre. */
    const stub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.90, 14),
      PAINTED_PIPE_MAT(pipeColor),
    );
    stub.rotation.z = Math.PI / 2;
    stub.position.set(VALVE_X - 0.45 - 0.45, PIPE_Y, 0);
    stub.castShadow = true;
    root.add(stub);

    /* Tank-wall bracket plate (tank-side end of the stub). */
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.38, 0.48),
      STEEL_BRACKET_MAT(),
    );
    bracket.position.set(VALVE_X - 0.45 - 0.90, PIPE_Y, 0);
    root.add(bracket);

    /* Valve at ground level → BODY_Y (0.65 m) aligns with PIPE_Y. */
    const valve = _buildValveByKind(kind, { colorKey: spec.colorKey, tag: spec.tag });
    valve.position.set(VALVE_X, 0, 0);
    root.add(valve);

    root.userData.handwheel   = valve.userData.handwheel;
    root.userData.wheelGroup  = valve.userData.wheelGroup;
    root.userData.quarterTurn = valve.userData.quarterTurn;
    root.userData.kind        = `assembly-${kind}`;
    root.userData.valveModel  = valve;

  } else if (style === 'pipe-riser') {
    /* Vertical riser from pedestal up to a butterfly/gate valve.
       VALVE_BASE_Y is the valve GROUP origin. The valve body centre
       (BODY_Y = 0.62 for butterfly) sits at VALVE_BASE_Y + BODY_Y.
       Riser top connects to the BOTTOM of the valve body (at
       VALVE_BASE_Y + BODY_Y − BODY_R). With VALVE_BASE_Y = 0.35 m
       and butterfly BODY_Y = 0.62, DISC_R = 0.32:
         body centre = 0.35 + 0.62 = 0.97 m (good chest height)
         riser top   = 0.35 + 0.62 − 0.32 = 0.65 m               */
    const PEDESTAL_H   = 0.20;
    const BODY_Y_BFV   = 0.62;  // butterfly BODY_Y constant
    const DISC_R_BFV   = 0.32;  // butterfly DISC_R constant
    const VALVE_BASE_Y = 0.35;  // valve group origin — body at 0.97 m
    const RISER_TOP    = VALVE_BASE_Y + BODY_Y_BFV - DISC_R_BFV; // 0.65 m

    const pedestal = _groundPedestal(0.55, 0.55, PEDESTAL_H);
    root.add(pedestal);

    const baseFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16),
      _flangeMat(),
    );
    baseFlange.position.y = PEDESTAL_H + 0.025;
    root.add(baseFlange);

    const riserH = RISER_TOP - (PEDESTAL_H + 0.05);
    const riserBottom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, Math.max(riserH, 0.05), 14),
      PAINTED_PIPE_MAT(pipeColor),
    );
    riserBottom.position.y = PEDESTAL_H + 0.05 + Math.max(riserH, 0.05) * 0.5;
    riserBottom.castShadow = true;
    root.add(riserBottom);

    const flLow = _flangeWithBolts(0.16);
    flLow.position.y = RISER_TOP - 0.025;
    root.add(flLow);

    const valve = _buildValveByKind(kind, { colorKey: spec.colorKey, tag: spec.tag });
    valve.position.y = VALVE_BASE_Y;
    root.add(valve);

    /* Outlet pipe at the valve body centre height, heading sideways. */
    const outletY = VALVE_BASE_Y + BODY_Y_BFV;
    const outlet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.80, 14),
      PAINTED_PIPE_MAT(pipeColor),
    );
    outlet.rotation.z = Math.PI / 2;
    outlet.position.set(0.55, outletY, 0);
    root.add(outlet);

    root.userData.handwheel   = valve.userData.handwheel;
    root.userData.wheelGroup  = valve.userData.wheelGroup;
    root.userData.quarterTurn = valve.userData.quarterTurn;
    root.userData.kind        = `assembly-${kind}`;
    root.userData.valveModel  = valve;

  } else if (style === 'wall-stub') {
    /* Horizontal pipe exits the dyke wall at PIPE_Y height with a gate
       valve inline. The valve body (BODY_Y = 0.65 m) must sit at PIPE_Y
       so pipe stubs align. Valve placed at y = PIPE_Y − BODY_Y = 0 so
       its internal body centre lands exactly at PIPE_Y = 0.65 m. */
    const PED_H  = 0.18;
    const PIPE_Y = 0.65;   // matches gate-valve BODY_Y exactly
    const VALVE_X = 0.22;

    const pedestal = _groundPedestal(0.55, 0.55, PED_H);
    pedestal.position.set(-0.05, 0, 0);
    root.add(pedestal);

    /* Tall steel wall-plate behind the assembly. */
    const wallPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 1.10, 0.56),
      STEEL_BRACKET_MAT(),
    );
    wallPlate.position.set(-0.38, 0.55, 0);
    root.add(wallPlate);

    /* Vertical strut from pedestal to pipe level. */
    const strutH = PIPE_Y - PED_H;
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, strutH, 0.12),
      STEEL_BRACKET_MAT(),
    );
    strut.position.set(VALVE_X, PED_H + strutH * 0.5, 0);
    root.add(strut);

    /* Pipe clamp saddle. */
    const saddle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12, 1, false, 0, Math.PI),
      STEEL_BRACKET_MAT(),
    );
    saddle.rotation.x = Math.PI;
    saddle.position.set(VALVE_X, PIPE_Y + 0.01, 0);
    root.add(saddle);

    /* Left stub runs from wall plate to valve inlet (−X). */
    const stubL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.45, 14),
      PAINTED_PIPE_MAT(pipeColor),
    );
    stubL.rotation.z = Math.PI / 2;
    stubL.position.set(VALVE_X - 0.45, PIPE_Y, 0);
    stubL.castShadow = true;
    root.add(stubL);

    /* Right stub exits the valve outlet toward the open (+X). */
    const stubR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.38, 14),
      PAINTED_PIPE_MAT(pipeColor),
    );
    stubR.rotation.z = Math.PI / 2;
    stubR.position.set(VALVE_X + 0.55, PIPE_Y, 0);
    stubR.castShadow = true;
    root.add(stubR);

    /* Valve at y = 0 → body centre sits at BODY_Y = 0.65 m = PIPE_Y. */
    const valve = _buildValveByKind(kind, { colorKey: spec.colorKey, tag: spec.tag });
    valve.position.set(VALVE_X, 0, 0);
    root.add(valve);

    root.userData.handwheel   = valve.userData.handwheel;
    root.userData.wheelGroup  = valve.userData.wheelGroup;
    root.userData.quarterTurn = valve.userData.quarterTurn;
    root.userData.kind        = `assembly-${kind}`;
    root.userData.valveModel  = valve;

  } else {
    /* manifold-pad: concrete pad + two pipe saddles + horizontal pipe
       with an inline lever/ball valve. Pipe sits at PIPE_Y = 0.65 m.
       The lever valve has BODY_Y = 0.60 m, so place the valve group at
       y = PIPE_Y − BODY_Y = 0.05 m so the body centre aligns with the
       assembly pipe. Saddle height is tuned to end at PIPE_Y. */
    const PED_H  = 0.20;
    const PIPE_Y = 0.65;   // pipe centre height
    const BODY_Y_LEVER = 0.60;  // lever valve BODY_Y constant

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, PED_H, 1.2),
      CONCRETE_MAT(),
    );
    pad.position.y = PED_H * 0.5;
    pad.receiveShadow = true;
    pad.castShadow = true;
    root.add(pad);

    /* Saddles rise from pad top to pipe centre. */
    const saddleH = PIPE_Y - PED_H;
    for (const sx of [-0.85, 0.85]) {
      const saddle = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, saddleH, 0.28),
        STEEL_BRACKET_MAT(),
      );
      saddle.position.set(sx, PED_H + saddleH * 0.5, 0);
      root.add(saddle);

      /* Pipe clamp cap on top of each saddle. */
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.05, 12, 1, false, 0, Math.PI),
        STEEL_BRACKET_MAT(),
      );
      cap.rotation.x = Math.PI;
      cap.position.set(sx, PIPE_Y + 0.01, 0);
      root.add(cap);
    }

    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1.7, 16),
      PAINTED_PIPE_MAT(pipeColor),
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, PIPE_Y, 0);
    pipe.castShadow = true;
    root.add(pipe);

    /* Valve at y = PIPE_Y − BODY_Y so internal body sits at PIPE_Y. */
    const valve = _buildValveByKind(kind, { colorKey: spec.colorKey, tag: spec.tag });
    valve.position.set(0, PIPE_Y - BODY_Y_LEVER, 0);
    root.add(valve);

    root.userData.handwheel   = valve.userData.handwheel;
    root.userData.wheelGroup  = valve.userData.wheelGroup;
    root.userData.quarterTurn = valve.userData.quarterTurn;
    root.userData.kind        = `assembly-${kind}`;
    root.userData.valveModel  = valve;
  }

  root.rotation.y = facing;
  return root;
}

/* ════════════════════════════════════════════════════════════════════
   INDUSTRIAL PIPE RUN
   ════════════════════════════════════════════════════════════════════
   Replaces the old tiny pipeline.glb with a properly-sized procedural
   pipe run that sits on saddle supports and never clips the ground. */

const PIPE_RADIUS = 0.12;
const PIPE_RADIAL_SEG = 14;

function _pipeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x6a6a6a, roughness: 0.45, metalness: 0.8,
  });
}

function _pipeFlange(radius = PIPE_RADIUS) {
  const grp = new THREE.Group();
  const flangeR = radius * 1.55;
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(flangeR, flangeR, 0.04, PIPE_RADIAL_SEG),
    _flangeMat(),
  );
  disc.rotation.z = Math.PI / 2;
  grp.add(disc);

  const BOLT_COUNT = 6;
  const boltR = flangeR * 0.82;
  const boltMat = _stemMat();
  for (let i = 0; i < BOLT_COUNT; i++) {
    const a = (i / BOLT_COUNT) * Math.PI * 2;
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.06, 6),
      boltMat,
    );
    bolt.position.set(0, Math.sin(a) * boltR, Math.cos(a) * boltR);
    bolt.rotation.z = Math.PI / 2;
    grp.add(bolt);
  }
  return grp;
}

function _pipeSaddle(pipeY) {
  const grp = new THREE.Group();
  const saddleW = 0.08;
  const saddleD = 0.32;
  const legH = pipeY - PIPE_RADIUS - 0.02;
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x484848, roughness: 0.5, metalness: 0.7,
  });

  const baseH = 0.06;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(saddleW + 0.08, baseH, saddleD + 0.06),
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.4 }),
  );
  base.position.y = baseH * 0.5;
  base.receiveShadow = true;
  grp.add(base);

  for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(saddleW, legH, saddleW),
      legMat,
    );
    leg.position.set(0, baseH + legH * 0.5, sz * (saddleD * 0.4));
    leg.castShadow = true;
    grp.add(leg);
  }

  const clamp = new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_RADIUS + 0.02, PIPE_RADIUS + 0.02, 0.05, PIPE_RADIAL_SEG, 1, false, 0, Math.PI),
    legMat,
  );
  clamp.rotation.set(0, 0, Math.PI / 2);
  clamp.rotation.order = 'YXZ';
  clamp.rotateX(Math.PI);
  clamp.position.set(0, pipeY + PIPE_RADIUS * 0.3, 0);
  grp.add(clamp);

  return grp;
}

export function buildIndustrialPipe(length = 4, options = {}) {
  const {
    pipeColor = 0xc4a830,
    pipeY = 0.55,
    withFlanges = true,
    saddleCount = null,
  } = options;

  const root = new THREE.Group();

  const pipeMat = new THREE.MeshStandardMaterial({
    color: pipeColor, roughness: 0.55, metalness: 0.6,
  });
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_RADIUS, PIPE_RADIUS, length, PIPE_RADIAL_SEG),
    pipeMat,
  );
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, pipeY, 0);
  pipe.castShadow = true;
  pipe.receiveShadow = true;
  root.add(pipe);

  if (withFlanges) {
    const fL = _pipeFlange();
    fL.position.set(-length * 0.5, pipeY, 0);
    root.add(fL);

    const fR = _pipeFlange();
    fR.position.set(length * 0.5, pipeY, 0);
    root.add(fR);
  }

  const nSaddles = saddleCount ?? Math.max(2, Math.round(length / 2.2));
  const saddleSpacing = length * 0.75 / Math.max(1, nSaddles - 1);
  const startX = -saddleSpacing * (nSaddles - 1) * 0.5;
  for (let i = 0; i < nSaddles; i++) {
    const saddle = _pipeSaddle(pipeY);
    saddle.position.x = startX + i * saddleSpacing;
    saddle.castShadow = true;
    root.add(saddle);
  }

  return root;
}
