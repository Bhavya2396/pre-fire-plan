/**
 * ActionPanel — full-screen modal for physical interactions.
 *
 * Interaction types:
 *   'choice' — multiple choice question (keyboard 1-4 or click)
 *   'rotate' — direct 3D valve grab: the panel hides, player grabs the valve
 *              in-world with the mouse, a minimal centered HUD shows progress.
 *              main.js wires onRotateStepStart / onRotateStepEnd to toggle
 *              Player.grabMode and drive valve rotation directly.
 */

const PANEL_CONFIGS = {
  close_roof_drain: {
    title: 'CLOSE ROOF DRAIN VALVE',
    description: 'Roof drain to be closed immediately, if possible. This prevents burning product from draining into the dyke and sewer system.',
    steps: [
      { label: 'Identify the correct valve', action: 'choice', question: 'Which valve tag is the roof drain for Tank 101-A?',
        options: ['RD-102B', 'RD-101A', 'DV-101', 'CW-101B'], correct: 1 },
      { label: 'Select the correct rotation direction to CLOSE', action: 'choice', question: 'Which direction closes a gate valve?',
        options: ['Counter-clockwise', 'Clockwise', 'Pull upward'], correct: 1 },
      { label: 'Turn the hand-wheel clockwise to CLOSE', action: 'rotate', rotations: 2, direction: 'cw' },
      { label: 'Read the position indicator', action: 'choice', question: 'The position indicator now shows:',
        options: ['OPEN', 'THROTTLED', 'CLOSED'], correct: 2 },
    ],
  },
  close_dyke_valve: {
    title: 'CLOSE DYKE DRAIN VALVE',
    description: 'Closing of Dyke Valve shall be done to ensure containment of oil inside dyke area.',
    steps: [
      { label: 'Identify the dyke drain valve', action: 'choice', question: 'What is the tag number for the dyke drain valve?',
        options: ['CW-101B', 'MV-101A', 'DV-101', 'RD-101A'], correct: 2 },
      { label: 'Check lock-out status', action: 'choice', question: 'Is the valve locked out?',
        options: ['Yes — padlock present', 'No — free to operate'], correct: 1 },
      { label: 'Turn hand-wheel clockwise to SHUT', action: 'rotate', rotations: 2, direction: 'cw' },
      { label: 'Verify closure', action: 'choice', question: 'What must you verify after closing?',
        options: ['Flow rate increased', 'No product leaking from drain', 'Valve handle is warm'], correct: 1 },
    ],
  },
  isolate_manifold: {
    title: 'STOP OPERATIONS & ISOLATE TANK 101-A AT MANIFOLD',
    description: 'All receipt, dispense and transfer operations must be stopped. Tank 101-A must then be isolated in the tank manifold. This requires lock-out tag-out (LOTO).',
    steps: [
      { label: 'Stop ongoing operations', action: 'choice', question: 'Which operations must be stopped immediately?',
        options: ['Cooling water only', 'Receipt, dispense and transfer operations', 'Fire alarm system', 'Lighting systems'], correct: 1 },
      { label: 'Exception for emptying', action: 'choice', question: 'Can emptying out of tank be done during an emergency?',
        options: ['No — all operations must stop', 'Yes — as per consultation with senior operation personnel', 'Yes — automatically'], correct: 1 },
      { label: 'Select the correct valve', action: 'choice', question: 'The manifold has 4 valves. Which isolates Tank 101-A?',
        options: ['MV-102A', 'MV-101B', 'MV-101A', 'MV-100'], correct: 2 },
      { label: 'Remove safety clip', action: 'choice', question: 'What is the safety clip number to remove?',
        options: ['SLC-018', 'SLC-042', 'SLC-099'], correct: 0 },
      { label: 'Rotate lever to CLOSED — drag clockwise (quarter-turn)', action: 'rotate', rotations: 0.25, direction: 'cw' },
      { label: 'Apply LOTO tag', action: 'choice', question: 'What must the LOTO tag state?',
        options: ['"Under maintenance"', '"Do not operate — emergency isolation"', '"Scheduled shutdown"'], correct: 1 },
      { label: 'Verify isolation', action: 'choice', question: 'Downstream pressure gauge reads:',
        options: ['3.2 bar', '0.0 bar', '1.1 bar'], correct: 1 },
      { label: 'Observe tank for abnormalities', action: 'choice', question: 'After isolation, what must you immediately observe the tank for?',
        options: ['Paint colour changes only', 'Any other abnormalities (leaks, deformation, unusual sounds)', 'Nothing — isolation is complete'], correct: 1 },
    ],
  },
  open_cooling_valve: {
    title: 'ACTIVATE COOLING WATER — TANK 101-B',
    description: 'Cooling water isolation valve to be opened for cooling purpose if found necessary. Cooling of adjacent tanks through water monitors is not recommended.',
    steps: [
      { label: 'Cooling method assessment', action: 'choice', question: 'Is cooling adjacent tanks through water monitors recommended?',
        options: ['Yes — use monitors for direct cooling', 'No — but water shielding from heat radiation can be done from monitors if required', 'No — cooling is not needed'], correct: 1 },
      { label: 'Identify the cooling valve', action: 'choice', question: 'Which valve activates cooling water for Tank 101-B?',
        options: ['DV-101', 'CW-101A', 'CW-101B', 'RD-101A'], correct: 2 },
      { label: 'Select rotation direction to OPEN', action: 'choice', question: 'Which direction opens a valve?',
        options: ['Clockwise', 'Counter-clockwise', 'Either direction'], correct: 1 },
      { label: 'Open the valve — drag counter-clockwise', action: 'rotate', rotations: 2, direction: 'ccw' },
      { label: 'Read shell temperature', action: 'choice', question: 'IR pyrometer reads 68°C on the south face. Is this within safe limits (<150°C)?',
        options: ['No — evacuate immediately', 'Yes — continue monitoring', 'Uncertain — re-check in 5 min'], correct: 1 },
    ],
  },
  position_tender_1: {
    title: 'POSITION FIRE TENDER — H-28',
    description: 'The first fire tender has arrived on Road 10. Guide the driver to Hydrant H-28.',
    steps: [
      { label: 'Identify tender approach road', action: 'choice', question: 'Which road is the first tender approaching from?',
        options: ['Road 12 (east)', 'Road 10 (west)', 'Road 8 (north)'], correct: 1 },
      { label: 'Select correct hydrant', action: 'choice', question: 'Which hydrant services Road 10?',
        options: ['H-20', 'H-27', 'H-28', 'H-15'], correct: 2 },
      { label: 'Maximum distance from hydrant', action: 'choice', question: 'What is the maximum permitted hose run?',
        options: ['30 metres', '15 metres', '10 metres', '5 metres'], correct: 1 },
      { label: 'Confirm vehicle secured', action: 'choice', question: 'What must the driver confirm before operations begin?',
        options: ['Engine off, doors locked', 'Chocks placed, brake set, PTO engaged', 'Lights off, siren silenced'], correct: 1 },
    ],
  },
  connect_hose_1: {
    title: 'CONNECT HOSE — HYDRANT H-28',
    description: 'Two 15m hoses connected from Hydrant 10/H-28 to fire tender. One nearby Hydrant (10/H-27) shall be used for providing foam to HVLRM through JRCP.',
    steps: [
      { label: 'Identify foam supply hydrant', action: 'choice', question: 'Which nearby hydrant provides foam to HVLRM through JRCP?',
        options: ['H-28', 'H-27', 'H-20', 'H-15'], correct: 1 },
      { label: 'JRCP placement', action: 'choice', question: 'Where can JRCP placement be done for prompt foam application?',
        options: ['On the ground beside the tender', 'Over the foam tank on fire tender', 'On the hydrant directly'], correct: 1 },
      { label: 'Connect JRCP to HVLRM', action: 'choice', question: 'The JRCP connects to which foam monitor for supplying finished foam on top of the tank?',
        options: ['HVLRM 10/12', 'HVLRM 12/04', 'Direct attack only'], correct: 0 },
      { label: 'Open hydrant valve — drag counter-clockwise', action: 'rotate', rotations: 2, direction: 'ccw' },
      { label: 'Verify water pressure', action: 'choice', question: 'Tender inlet gauge reads 7.8 bar. Is this within operational range (6-10 bar)?',
        options: ['Too low — check for blockage', 'Within range — proceed', 'Too high — throttle back'], correct: 1 },
    ],
  },
  open_spray_101b: {
    title: 'OPEN ISOLATION VALVES — WATER SPRAY SYSTEM — TANK 101-B',
    description: '1 AMC will open the isolation valves for water spray system for adjacent tank (101B). Monitor temperature and assess whether valve can be closed based on FW availability and flame intensity.',
    steps: [
      { label: 'Count active spray nozzles', action: 'choice', question: 'You count 24 of 24 nozzles discharging. Is this acceptable?',
        options: ['No — too many', 'Yes — all nozzles operational', 'No — need at least 30'], correct: 1 },
      { label: 'Assess spray pattern', action: 'choice', question: 'The spray pattern appears:',
        options: ['Uneven — some dry spots on shell', 'Even coverage around entire circumference', 'Only covering the top half'], correct: 1 },
      { label: 'Record shell temperatures', action: 'choice', question: 'South face: 72°C, West: 58°C, North: 45°C. Which face requires monitoring?',
        options: ['North (coolest)', 'West (moderate)', 'South (hottest — facing fire)'], correct: 2 },
      { label: 'Log spray ring status', action: 'choice', question: 'What status should be logged?',
        options: ['INACTIVE — needs repair', 'ACTIVE — all nozzles operational', 'PARTIAL — some blocked'], correct: 1 },
      { label: 'Decision on closing valve', action: 'choice', question: 'After significant temperature reduction, decision on closing valve can be taken based on:',
        options: ['Time of day only', 'FW availability, FW network pressure, flame intensity, temperature of exposed tank', 'Number of personnel on site'], correct: 1 },
    ],
  },
  position_tender_2: {
    title: 'POSITION 2ND TENDER — H-20',
    description: 'Park fire tender close to Hydrant 12/H-20 along Road no. 12. HEFG requirement is for dyke spillage and fire cases.',
    steps: [
      { label: 'Confirm arrival road', action: 'choice', question: 'The 2nd turnout arrives via which road?',
        options: ['Road 10', 'Road 12', 'Road 8'], correct: 1 },
      { label: 'Select target hydrant', action: 'choice', question: 'Which hydrant is on Road 12?',
        options: ['H-28', 'H-27', 'H-20', 'H-15'], correct: 2 },
      { label: 'Identify equipment carried', action: 'choice', question: 'The 2nd turnout carries which key equipment?',
        options: ['Water cannon only', 'HEFG + trolley-mounted foam monitor', 'Rescue platform'], correct: 1 },
      { label: 'MEFG placement', action: 'choice', question: 'Where should MEFG foam generators be placed?',
        options: ['Road 10 and Road 12 — foam into the dyke', 'Only Road 10', 'Inside the dyke'], correct: 0 },
    ],
  },
  connect_hose_2: {
    title: 'CONNECT HOSE — HYDRANT H-20',
    description: 'Two 15m hoses from Hydrant 12/H-20 to fire tender. With the help of MEFG (at Roads 10 & 12) finished foam is supplied on tank dyke area in case of dyke spillage/fire.',
    steps: [
      { label: 'Select suction hose type', action: 'choice', question: 'The HEFG requires which suction hose?',
        options: ['65mm lay-flat', '100mm hard suction', '38mm booster line'], correct: 1 },
      { label: 'Connect JRCP to HVLRM 12/04', action: 'choice', question: 'The JRCP connects to which monitor?',
        options: ['HVLRM 10/12', 'HVLRM 12/04', 'Direct attack only'], correct: 1 },
      { label: 'Open hydrant H-20 — drag counter-clockwise', action: 'rotate', rotations: 2, direction: 'ccw' },
      { label: 'Set foam concentration', action: 'choice', question: 'What AFFF proportion should the HEFG be set to?',
        options: ['1%', '3%', '6%', '10%'], correct: 1 },
      { label: 'Verify foam quality', action: 'choice', question: 'Foam blanket has good expansion at 1,200 L/min. Status?',
        options: ['Flow too low — increase', 'Operational — proceed with attack', 'Foam ratio incorrect'], correct: 1 },
    ],
  },
  check_boilover: {
    title: 'URGENT EVACUATION CONDITION — BOIL-OVER RISK ASSESSMENT',
    description: 'As advised by CEC/IC, mainly during pre-indication stage of Boil Over which can be detected by change of Tank shell\'s paint and increase in flames. A boil-over occurs when a heat wave reaches the water pad at the tank base.',
    steps: [
      { label: 'Observe paint discoloration height', action: 'choice', question: 'Paint discoloration is visible at approximately what height?',
        options: ['2 metres', '4 metres', '8 metres', '12 metres'], correct: 1 },
      { label: 'Listen for boil-over precursors', action: 'choice', question: 'You listen at the tank shell. What do you hear?',
        options: ['Loud rumbling and surging', 'Steady fire sound only — no rumbling', 'High-pitched whistling'], correct: 1 },
      { label: 'Check for froth-over', action: 'choice', question: 'At the floating roof seal, do you observe frothy overflow?',
        options: ['Yes — foamy product overflowing', 'No — no froth or overflow visible', 'Steam jets at the seal'], correct: 1 },
      { label: 'Interpret thermocouple data', action: 'choice', question: 'Readings: 4m = 220°C, 6m = 180°C, 8m = 95°C. Where is the heat wave front?',
        options: ['Between 6m and 8m', 'Between 4m and 6m', 'At the base'], correct: 0 },
      { label: 'Calculate time to boil-over', action: 'choice', question: 'Water pad: 0.3m at base. Heat wave descent: ~0.5m/hr. Heat wave between 6-8m. Estimated time?',
        options: ['Less than 1 hour', 'About 8 hours', 'More than 12 hours'], correct: 2 },
      { label: 'Final risk assessment', action: 'choice', question: 'Based on all observations, the boil-over risk is:',
        options: ['HIGH — evacuate immediately', 'MEDIUM — increase monitoring frequency', 'LOW — continue foam application'], correct: 2 },
    ],
  },
};

// ── Circumference constant for SVG ring (2π × 54) ────────
const RING_C = 339.3;

export class ActionPanel {
  constructor(audioManager) {
    this.audio = audioManager;
    this.visible = false;

    // Public callbacks wired by main.js
    this.onComplete        = null; // (stepId, wrongAttempts)
    this.onCancel          = null; // (stepId)
    this.onRotate          = null; // (stepId, totalAngle) — kept for backward compat
    this.onRotateStepStart = null; // (direction, rotations) — fires when grab mode begins
    this.onRotateStepEnd   = null; // () — fires when grab mode ends (complete or cancelled)

    this._currentConfig  = null;
    this._currentStep    = 0;
    this._wrongAttempts  = 0;

    // Grab-mode state (driven externally via accumulateDrag)
    this._grabActive      = false;
    this._totalDragAngle  = 0;
    this._targetAngle     = 0; // rotations × 2π

    this._el    = null;
    this._ghud  = null; // grab-mode HUD element

    this._build();
    this._bindKeys();
  }

  // ── DOM construction ──────────────────────────────────

  _build() {
    // Main panel
    const el = document.createElement('div');
    el.id = 'action-panel';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="ap-backdrop"></div>
      <div class="ap-container">
        <div class="ap-header">
          <h2 class="ap-title"></h2>
          <button class="ap-close">ESC</button>
        </div>
        <p class="ap-desc"></p>
        <div class="ap-steps"></div>
        <div class="ap-action-area">
          <div class="ap-question"></div>
          <div class="ap-options"></div>
          <div class="ap-feedback"></div>
        </div>
        <div class="ap-footer">
          <div class="ap-progress-bar"><div class="ap-progress-fill"></div></div>
          <span class="ap-progress-text"></span>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this._el = el;
    el.addEventListener('click', e => e.stopPropagation());
    el.querySelector('.ap-close').addEventListener('click', () => this.close(false));

    // Minimal grab-mode HUD (shown instead of the panel during rotate steps)
    const ghud = document.createElement('div');
    ghud.id = 'valve-grab-hud';
    ghud.style.display = 'none';
    ghud.innerHTML = `
      <div class="vgh-instruction"></div>
      <svg class="vgh-ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5"/>
        <circle class="vgh-progress" cx="60" cy="60" r="54" fill="none"
          stroke="#ff6b1a" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"
          transform="rotate(-90 60 60)"/>
        <text x="60" y="65" class="vgh-pct" text-anchor="middle">0%</text>
      </svg>
      <div class="vgh-hint">HOLD LEFT BUTTON + DRAG TO TURN</div>
      <button class="vgh-cancel">CANCEL  [ESC]</button>
    `;
    document.body.appendChild(ghud);
    this._ghud = ghud;
    ghud.querySelector('.vgh-cancel').addEventListener('click', () => this._cancelGrab());
  }

  // ── keyboard shortcuts ────────────────────────────────

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this._grabActive) { this._cancelGrab(); e.preventDefault(); e.stopPropagation(); return; }
        if (this.visible) { this.close(false); e.preventDefault(); e.stopPropagation(); return; }
      }
      if (!this.visible) return;
      const step = this._currentConfig?.steps[this._currentStep];
      if (step?.action === 'choice') {
        const num = parseInt(e.key);
        if (num >= 1 && num <= (step.options?.length || 0)) {
          this._handleChoice(num - 1);
          e.preventDefault(); e.stopPropagation();
        }
      }
    }, true);
  }

  // ── public API ────────────────────────────────────────

  has(stepId) { return !!PANEL_CONFIGS[stepId]; }

  open(stepId) {
    const cfg = PANEL_CONFIGS[stepId];
    if (!cfg) return false;
    this._currentConfig = { ...cfg, stepId };
    this._currentStep   = 0;
    this._wrongAttempts = 0;
    this.visible        = true;
    this._el.style.display = '';
    document.exitPointerLock();
    this._render();
    return true;
  }

  close(completed = false) {
    this.visible = false;
    this._el.style.display = 'none';
    this._grabActive = false;
    this._ghud.style.display = 'none';
    const stepId = this._currentConfig?.stepId;
    this._currentConfig = null;
    if (completed && this.onComplete) this.onComplete(stepId, this._wrongAttempts);
    if (!completed && this.onCancel)  this.onCancel(stepId);
  }

  /**
   * Called by main.js every frame (or on mouse events) while grab mode is active.
   * absAngle — absolute radians turned IN THE CORRECT DIRECTION since grab started.
   */
  accumulateDrag(absAngle) {
    if (!this._grabActive) return;

    this._totalDragAngle = absAngle;

    // Update grab HUD
    const pct = Math.min(1, absAngle / this._targetAngle);
    const offset = RING_C * (1 - pct);
    const ring = this._ghud.querySelector('.vgh-progress');
    if (ring) ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
    const pctEl = this._ghud.querySelector('.vgh-pct');
    if (pctEl) pctEl.textContent = `${Math.floor(pct * 100)}%`;

    if (pct >= 1) {
      this._completeGrab();
    }
  }

  // ── grab-mode internals ───────────────────────────────

  _startGrab(step) {
    this._grabActive     = true;
    this._totalDragAngle = 0;
    this._targetAngle    = (step.rotations || 2) * Math.PI * 2;

    // Hide main panel, show grab HUD
    this._el.querySelector('.ap-container').style.display = 'none';
    this._el.querySelector('.ap-backdrop').style.opacity  = '0.15';

    const dirLabel = step.direction === 'ccw' ? 'COUNTER-CLOCKWISE ↺' : 'CLOCKWISE ↻';
    const turnLabel = step.rotations < 1
      ? `QUARTER-TURN ${dirLabel}`
      : `${step.rotations} full turn${step.rotations > 1 ? 's' : ''} ${dirLabel}`;
    const handleType = step.rotations < 1 ? 'LEVER' : 'VALVE';
    this._ghud.querySelector('.vgh-instruction').textContent = `OPERATE ${handleType} — ${turnLabel}`;
    const ring = this._ghud.querySelector('.vgh-progress');
    if (ring) ring.setAttribute('stroke-dashoffset', RING_C.toString());
    const pctEl = this._ghud.querySelector('.vgh-pct');
    if (pctEl) pctEl.textContent = '0%';
    this._ghud.style.display = '';

    if (this.onRotateStepStart) {
      this.onRotateStepStart(step.direction || 'cw', step.rotations || 2, this._currentConfig.stepId);
    }
  }

  _cancelGrab() {
    this._grabActive = false;
    this._ghud.style.display = 'none';
    this._el.querySelector('.ap-container').style.display = '';
    this._el.querySelector('.ap-backdrop').style.opacity  = '';
    if (this.onRotateStepEnd) this.onRotateStepEnd();
    // Re-request pointer lock will happen in main.js via onRotateStepEnd
  }

  _completeGrab() {
    this._grabActive = false;
    if (this.onRotateStepEnd) this.onRotateStepEnd();
    if (this.audio) { try { this.audio.play('valve_steam'); } catch (_) { /* ok */ } }

    // Show a clear completion banner on the grab HUD before returning to modal
    const instr = this._ghud.querySelector('.vgh-instruction');
    const hint  = this._ghud.querySelector('.vgh-hint');
    const pctEl = this._ghud.querySelector('.vgh-pct');
    if (instr) instr.textContent = '✓  VALVE FULLY OPERATED';
    if (hint)  hint.textContent  = 'Returning to checklist…';
    if (pctEl) pctEl.textContent = '100%';

    // Brief confirmation pause — then swap back to modal
    setTimeout(() => {
      this._ghud.style.display = 'none';
      this._el.querySelector('.ap-container').style.display = '';
      this._el.querySelector('.ap-backdrop').style.opacity  = '';
      const feedbackEl = this._el.querySelector('.ap-feedback');
      if (feedbackEl) { feedbackEl.textContent = 'VALVE OPERATED — CONFIRMED'; feedbackEl.className = 'ap-feedback correct'; }
      this._advanceStep();
    }, 1400);
  }

  // ── rendering ─────────────────────────────────────────

  _render() {
    if (!this._currentConfig) return;
    const cfg = this._currentConfig;
    const el  = this._el;

    el.querySelector('.ap-title').textContent = cfg.title;
    el.querySelector('.ap-desc').textContent  = cfg.description;
    el.querySelector('.ap-container').style.display = '';
    el.querySelector('.ap-backdrop').style.opacity  = '';

    const stepsEl = el.querySelector('.ap-steps');
    stepsEl.innerHTML = cfg.steps.map((s, i) => {
      let cls = 'ap-step';
      if (i < this._currentStep) cls += ' done';
      if (i === this._currentStep) cls += ' active';
      const icon = i < this._currentStep ? '&#10003;' : (i + 1);
      return `<div class="${cls}"><span class="ap-step-num">${icon}</span><span class="ap-step-label">${s.label}</span></div>`;
    }).join('');

    const step        = cfg.steps[this._currentStep];
    const questionEl  = el.querySelector('.ap-question');
    const optionsEl   = el.querySelector('.ap-options');
    const feedbackEl  = el.querySelector('.ap-feedback');
    feedbackEl.textContent = '';
    feedbackEl.className   = 'ap-feedback';

    if (step.action === 'choice') {
      questionEl.textContent  = step.question;
      questionEl.style.display = '';
      optionsEl.style.display  = '';
      optionsEl.innerHTML = step.options.map((opt, i) =>
        `<button class="ap-option" data-idx="${i}"><span class="ap-opt-key">${i + 1}</span>${opt}</button>`
      ).join('');
      optionsEl.querySelectorAll('.ap-option').forEach(btn => {
        btn.addEventListener('click', () => this._handleChoice(parseInt(btn.dataset.idx)));
      });
    } else if (step.action === 'rotate') {
      questionEl.style.display = 'none';
      optionsEl.style.display  = 'none';
      optionsEl.innerHTML = '';
      // Briefly show "preparing grab mode..." then switch
      feedbackEl.textContent = 'APPROACHING VALVE…';
      feedbackEl.className   = 'ap-feedback';
      setTimeout(() => { if (this._currentConfig) this._startGrab(step); }, 400);
    }

    const progress = this._currentStep / cfg.steps.length;
    el.querySelector('.ap-progress-fill').style.width = `${progress * 100}%`;
    el.querySelector('.ap-progress-text').textContent = `Step ${this._currentStep + 1} of ${cfg.steps.length}`;
  }

  _handleChoice(idx) {
    if (!this._currentConfig) return;
    const step    = this._currentConfig.steps[this._currentStep];
    if (step.action !== 'choice') return;

    const feedbackEl = this._el.querySelector('.ap-feedback');
    const buttons    = this._el.querySelectorAll('.ap-option');

    if (idx === step.correct) {
      buttons[idx]?.classList.add('correct');
      feedbackEl.textContent = 'CORRECT';
      feedbackEl.className   = 'ap-feedback correct';
      buttons.forEach(b => { b.disabled = true; });
      setTimeout(() => this._advanceStep(), 700);
    } else {
      this._wrongAttempts++;
      buttons[idx]?.classList.add('wrong');
      buttons[idx].disabled  = true;
      feedbackEl.textContent = 'INCORRECT — Try again';
      feedbackEl.className   = 'ap-feedback wrong';
    }
  }

  _advanceStep() {
    this._currentStep++;
    if (this._currentStep >= this._currentConfig.steps.length) {
      const el = this._el;
      el.querySelector('.ap-progress-fill').style.width = '100%';
      el.querySelector('.ap-progress-text').textContent = 'PROCEDURE COMPLETE';
      el.querySelector('.ap-question').style.display = 'none';
      el.querySelector('.ap-options').innerHTML = '';
      el.querySelector('.ap-options').style.display = 'none';
      el.querySelector('.ap-feedback').textContent = this._wrongAttempts === 0
        ? 'PERFECT — No errors' : `COMPLETED — ${this._wrongAttempts} error(s)`;
      el.querySelector('.ap-feedback').className = 'ap-feedback correct';
      el.querySelector('.ap-steps').innerHTML = this._currentConfig.steps.map(s =>
        `<div class="ap-step done"><span class="ap-step-num">&#10003;</span><span class="ap-step-label">${s.label}</span></div>`
      ).join('');
      setTimeout(() => this.close(true), 900);
    } else {
      this._render();
    }
  }

  dispose() {
    if (this._el?.parentNode) this._el.parentNode.removeChild(this._el);
    if (this._ghud?.parentNode) this._ghud.parentNode.removeChild(this._ghud);
  }
}
