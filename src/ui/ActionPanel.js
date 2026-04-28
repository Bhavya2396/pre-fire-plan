const PANEL_CONFIGS = {
  // sound_mcp_alarm is no longer a panel step — it's a direct in-world
  // smash interaction (see Game._startWorldSmash). The panel config is
  // intentionally omitted here so InteractionSystem skips ActionPanel
  // and routes to the direct flow.
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
  // position_tender_1 / connect_hose_1 are now physical interactions
  // (proximity walk-in + click hose pile + click hydrant). Their old
  // quiz definitions were removed in T7 to drop the dead modal path.
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
  // position_tender_2 / connect_hose_2: see note above on _1.
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

const RING_C = 339.3;

export default class ActionPanel {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.visible = false;

    this._currentConfig = null;
    this._currentStep = 0;
    this._wrongAttempts = 0;

    this._grabActive = false;
    this._totalDragAngle = 0;
    this._targetAngle = 0;

    this._el = null;
    this._ghud = null;

    this._build();
    this._bindKeys();
    this._bindBusEvents();
  }

  // ── DOM construction ───────────────────────────────────

  _build() {
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

  // ── Keyboard shortcuts ─────────────────────────────────

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

  // ── EventBus bindings ──────────────────────────────────

  _bindBusEvents() {
    this.eventBus.on('action-panel:open', (stepId) => this.open(stepId));
    this.eventBus.on('action-panel:accumulate-drag', (absAngle) => this.accumulateDrag(absAngle));
  }

  // ── Public API ─────────────────────────────────────────

  has(stepId) { return !!PANEL_CONFIGS[stepId]; }

  open(stepId) {
    const cfg = PANEL_CONFIGS[stepId];
    if (!cfg) return false;
    this._currentConfig = { ...cfg, stepId };
    this._currentStep = 0;
    this._wrongAttempts = 0;
    this.visible = true;
    this._el.style.display = '';
    document.exitPointerLock();
    this._render();
    return true;
  }

  close(completed = false) {
    this.visible = false;
    this._el.style.display = 'none';
    this._grabActive = false;
    this._detachGrabListeners();
    this._ghud.style.display = 'none';
    const stepId = this._currentConfig?.stepId;
    this._currentConfig = null;
    if (completed) {
      this.eventBus.emit('action-panel:complete', stepId, this._wrongAttempts);
    } else {
      this.eventBus.emit('action-panel:cancel', stepId);
    }
  }

  accumulateDrag(absAngle) {
    if (!this._grabActive) return;

    this._totalDragAngle = absAngle;

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

  // ── Grab-mode internals ────────────────────────────────

  _startGrab(step) {
    this._grabActive = true;
    this._totalDragAngle = 0;
    this._targetAngle = (step.rotations || 2) * Math.PI * 2;
    this._grabSign = step.direction === 'ccw' ? -1 : 1;
    this._grabMouseDown = false;

    this._el.querySelector('.ap-container').style.display = 'none';
    this._el.querySelector('.ap-backdrop').style.opacity = '0.15';

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

    // Local mouse handlers — works without pointer-lock since the panel is open
    this._grabMouseDown = false;
    this._onGrabMouseDown = (e) => { if (e.button === 0) this._grabMouseDown = true; };
    this._onGrabMouseUp = (e) => { if (e.button === 0) this._grabMouseDown = false; };
    this._onGrabMouseMove = (e) => {
      if (!this._grabActive || !this._grabMouseDown) return;
      const rawDx = (e.movementX || 0) * 0.012;
      // Bidirectional visual: wheel always rotates with the cursor.
      // Drag right => wheel spins clockwise; drag left => CCW.
      this.eventBus.emit('action-panel:rotate-tick', rawDx * this._grabSign);

      // Progress only counts movement in the correct direction.
      const delta = rawDx * this._grabSign;
      if (delta > 0) {
        this._totalDragAngle += delta;
        this.accumulateDrag(this._totalDragAngle);
      }
    };
    document.addEventListener('mousedown', this._onGrabMouseDown);
    document.addEventListener('mouseup',   this._onGrabMouseUp);
    document.addEventListener('mousemove', this._onGrabMouseMove);

    this.eventBus.emit('action-panel:rotate-start', step.direction || 'cw', step.rotations || 2, this._currentConfig.stepId);
  }

  _detachGrabListeners() {
    if (this._onGrabMouseDown) document.removeEventListener('mousedown', this._onGrabMouseDown);
    if (this._onGrabMouseUp)   document.removeEventListener('mouseup',   this._onGrabMouseUp);
    if (this._onGrabMouseMove) document.removeEventListener('mousemove', this._onGrabMouseMove);
    this._onGrabMouseDown = null;
    this._onGrabMouseUp = null;
    this._onGrabMouseMove = null;
  }

  _cancelGrab() {
    this._grabActive = false;
    this._detachGrabListeners();
    this._ghud.style.display = 'none';
    this._el.querySelector('.ap-container').style.display = '';
    this._el.querySelector('.ap-backdrop').style.opacity = '';
    this.eventBus.emit('action-panel:rotate-end');
  }

  _completeGrab() {
    this._grabActive = false;
    this._detachGrabListeners();
    this.eventBus.emit('action-panel:rotate-end');
    this.eventBus.emit('audio:play', 'valve_steam');

    const instr = this._ghud.querySelector('.vgh-instruction');
    const hint = this._ghud.querySelector('.vgh-hint');
    const pctEl = this._ghud.querySelector('.vgh-pct');
    if (instr) instr.textContent = '✓  VALVE FULLY OPERATED';
    if (hint) hint.textContent = 'Returning to checklist…';
    if (pctEl) pctEl.textContent = '100%';

    setTimeout(() => {
      this._ghud.style.display = 'none';
      this._el.querySelector('.ap-container').style.display = '';
      this._el.querySelector('.ap-backdrop').style.opacity = '';
      const feedbackEl = this._el.querySelector('.ap-feedback');
      if (feedbackEl) { feedbackEl.textContent = 'VALVE OPERATED — CONFIRMED'; feedbackEl.className = 'ap-feedback correct'; }
      this._advanceStep();
    }, 1400);
  }

  // ── Rendering ──────────────────────────────────────────

  _render() {
    if (!this._currentConfig) return;
    const cfg = this._currentConfig;
    const el = this._el;

    el.querySelector('.ap-title').textContent = cfg.title;
    el.querySelector('.ap-desc').textContent = cfg.description;
    el.querySelector('.ap-container').style.display = '';
    el.querySelector('.ap-backdrop').style.opacity = '';

    const stepsEl = el.querySelector('.ap-steps');
    stepsEl.innerHTML = cfg.steps.map((s, i) => {
      let cls = 'ap-step';
      if (i < this._currentStep) cls += ' done';
      if (i === this._currentStep) cls += ' active';
      const icon = i < this._currentStep ? '&#10003;' : (i + 1);
      return `<div class="${cls}"><span class="ap-step-num">${icon}</span><span class="ap-step-label">${s.label}</span></div>`;
    }).join('');

    const step = cfg.steps[this._currentStep];
    const questionEl = el.querySelector('.ap-question');
    const optionsEl = el.querySelector('.ap-options');
    const feedbackEl = el.querySelector('.ap-feedback');
    feedbackEl.textContent = '';
    feedbackEl.className = 'ap-feedback';

    if (step.action === 'choice') {
      questionEl.textContent = step.question;
      questionEl.style.display = '';
      optionsEl.style.display = '';
      optionsEl.innerHTML = step.options.map((opt, i) =>
        `<button class="ap-option" data-idx="${i}"><span class="ap-opt-key">${i + 1}</span>${opt}</button>`
      ).join('');
      optionsEl.querySelectorAll('.ap-option').forEach(btn => {
        btn.addEventListener('click', () => this._handleChoice(parseInt(btn.dataset.idx)));
      });
    } else if (step.action === 'rotate') {
      questionEl.style.display = 'none';
      optionsEl.style.display = 'none';
      optionsEl.innerHTML = '';
      feedbackEl.textContent = 'APPROACHING VALVE…';
      feedbackEl.className = 'ap-feedback';
      setTimeout(() => { if (this._currentConfig) this._startGrab(step); }, 400);
    } else if (step.action === 'smash') {
      this._startSmash(step);
    }

    const progress = this._currentStep / cfg.steps.length;
    el.querySelector('.ap-progress-fill').style.width = `${progress * 100}%`;
    el.querySelector('.ap-progress-text').textContent = `Step ${this._currentStep + 1} of ${cfg.steps.length}`;
  }

  // ── Smash-glass interaction (MCP) ──────────────────────
  //
  // Player must click the glass `step.clicks` times (default 3). Each
  // click reveals a new layer of cracks via a procedural SVG overlay.
  // The final click triggers a world-side shard burst (`mcp:shatter`)
  // and advances the SOP step.
  _startSmash(step) {
    const total = step.clicks || 3;
    this._smashClicks = 0;
    this._smashTotal = total;

    const questionEl = this._el.querySelector('.ap-question');
    const optionsEl = this._el.querySelector('.ap-options');
    const feedbackEl = this._el.querySelector('.ap-feedback');

    questionEl.textContent = 'BREAK THE GLASS — STRIKE TO ACTIVATE';
    questionEl.style.display = '';
    optionsEl.style.display = '';
    feedbackEl.textContent = `${total} STRIKES NEEDED`;
    feedbackEl.className = 'ap-feedback';

    optionsEl.innerHTML = `
      <div class="ap-glass-target" id="ap-glass">
        <div class="ap-glass-pane"></div>
        <svg class="ap-glass-cracks" viewBox="0 0 200 200" preserveAspectRatio="none">
          <g id="ap-crack-1" class="ap-crack">
            <polyline points="40,40 90,95 130,70 175,150"/>
            <polyline points="100,30 110,90 145,135"/>
            <polyline points="60,160 95,100 130,55"/>
          </g>
          <g id="ap-crack-2" class="ap-crack">
            <polyline points="20,180 70,90 35,30"/>
            <polyline points="170,40 130,80 180,120"/>
            <polyline points="100,90 5,100"/>
            <polyline points="100,90 195,80"/>
          </g>
          <g id="ap-crack-3" class="ap-crack">
            <polyline points="0,100 200,100"/>
            <polyline points="100,0 100,200"/>
            <polyline points="20,20 180,180"/>
            <polyline points="180,20 20,180"/>
          </g>
        </svg>
        <div class="ap-glass-overlay">
          <div class="ap-glass-prompt">CLICK GLASS TO STRIKE</div>
          <div class="ap-glass-counter">${total} REMAINING</div>
        </div>
      </div>
    `;

    const glass = optionsEl.querySelector('.ap-glass-target');
    glass.addEventListener('click', () => this._handleSmashClick(glass));
  }

  _handleSmashClick(glassEl) {
    if (!this._currentConfig) return;
    if (this._smashClicks >= this._smashTotal) return;

    this._smashClicks++;
    const remaining = this._smashTotal - this._smashClicks;
    this.eventBus.emit('audio:play', 'valve_grind');

    const crack = glassEl.querySelector(`#ap-crack-${this._smashClicks}`);
    if (crack) crack.classList.add('on');

    glassEl.classList.add('shake');
    setTimeout(() => glassEl.classList.remove('shake'), 220);

    const counter = glassEl.querySelector('.ap-glass-counter');
    const prompt = glassEl.querySelector('.ap-glass-prompt');
    if (counter) counter.textContent = remaining > 0 ? `${remaining} REMAINING` : 'GLASS SHATTERED';
    if (prompt && remaining === 0) prompt.textContent = '✓  ALARM ACTIVATED';

    if (this._smashClicks >= this._smashTotal) {
      glassEl.classList.add('shattered');
      this.eventBus.emit('mcp:shatter');
      this.eventBus.emit('audio:play', 'valve_steam');
      const feedbackEl = this._el.querySelector('.ap-feedback');
      if (feedbackEl) {
        feedbackEl.textContent = 'GLASS BROKEN — ALARM RAISED';
        feedbackEl.className = 'ap-feedback correct';
      }
      setTimeout(() => this._advanceStep(), 900);
    }
  }

  _handleChoice(idx) {
    if (!this._currentConfig) return;
    const step = this._currentConfig.steps[this._currentStep];
    if (step.action !== 'choice') return;

    const feedbackEl = this._el.querySelector('.ap-feedback');
    const buttons = this._el.querySelectorAll('.ap-option');

    if (idx === step.correct) {
      buttons[idx]?.classList.add('correct');
      feedbackEl.textContent = 'CORRECT';
      feedbackEl.className = 'ap-feedback correct';
      buttons.forEach(b => { b.disabled = true; });
      setTimeout(() => this._advanceStep(), 700);
    } else {
      this._wrongAttempts++;
      buttons[idx]?.classList.add('wrong');
      buttons[idx].disabled = true;
      feedbackEl.textContent = 'INCORRECT — Try again';
      feedbackEl.className = 'ap-feedback wrong';
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
