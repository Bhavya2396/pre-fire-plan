export default class HUD {
  constructor(eventBus) {
    this.eventBus = eventBus;

    this.el = {};
    [
      'loading-screen', 'loading-bar', 'loading-status',
      'start-screen', 'hud',
      'phase-label', 'timer', 'step-counter', 'warnings-counter',
      'crosshair',
      'interact-prompt', 'interact-label', 'interact-hint',
      'valve-ui', 'valve-progress',
      'narration', 'narration-speaker', 'narration-text',
      'checklist', 'checklist-title', 'checklist-items',
      'notification',
      'observe-ui', 'observe-progress',
      'equipment-bar', 'equip-items',
      'score-screen', 'score-grid', 'score-grade', 'score-restart',
      'heat-overlay',
    ].forEach((id) => {
      this.el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
    });

    this._narrationQueue = [];
    this._narrationActive = false;
    this._typewriterTimer = null;
    this._narrationHideTimer = null;
    this._notifTimeout = null;

    /* Notification queue. _showNotification() used to overwrite any
       previous notification on the spot — rapid-fire training prompts
       stomped each other (e.g. "HOSE PICKED UP" vanished the moment
       "Walk to hydrant" arrived). The queue lets each one read for
       its full duration before the next slides in. */
    this._notifQueue = [];

    /* Bottom-of-screen slot manager. Anything anchored to the bottom
       of the viewport (hose HUD, valve grab HUD, future overlays)
       should call acquireBottomSlot(id, height) instead of hard-coding
       `bottom:` px values, so they auto-stack without overlap. */
    this._bottomSlots = new Map(); // id → { height, bottom }
    this._bottomBase = 100;        // px above viewport bottom for first slot
    this._bottomGap  = 12;         // gap between slots

    this._bindEvents();
  }

  acquireBottomSlot(id, height) {
    if (this._bottomSlots.has(id)) {
      return this._bottomSlots.get(id).bottom;
    }
    let bottom = this._bottomBase;
    for (const slot of this._bottomSlots.values()) {
      bottom = Math.max(bottom, slot.bottom + slot.height + this._bottomGap);
    }
    this._bottomSlots.set(id, { height, bottom });
    return bottom;
  }

  releaseBottomSlot(id) {
    this._bottomSlots.delete(id);
  }

  _bindEvents() {
    const bus = this.eventBus;

    bus.on('ui:loading-progress', (fraction, text) => {
      if (this.el.loadingBar) this.el.loadingBar.style.width = `${Math.round(fraction * 100)}%`;
      if (text && this.el.loadingStatus) this.el.loadingStatus.textContent = text;
    });

    bus.on('ui:hide-loading', () => {
      if (this.el.loadingScreen) this.el.loadingScreen.classList.add('hidden');
    });

    bus.on('ui:show-start', () => {
      if (this.el.startScreen) this.el.startScreen.classList.remove('hidden');
    });

    bus.on('ui:hide-start', () => {
      if (this.el.startScreen) this.el.startScreen.classList.add('hidden');
    });

    bus.on('ui:show-hud', () => {
      if (this.el.hud) this.el.hud.classList.remove('hidden');
    });

    bus.on('ui:hide-hud', () => {
      if (this.el.hud) this.el.hud.classList.add('hidden');
    });

    bus.on('ui:crosshair', (active) => {
      if (this.el.crosshair) this.el.crosshair.classList.toggle('active', active);
    });

    bus.on('ui:interact-prompt', (label, hint) => {
      if (this.el.interactLabel) this.el.interactLabel.textContent = label;
      if (this.el.interactHint) this.el.interactHint.textContent = hint || '';
      if (this.el.interactPrompt) this.el.interactPrompt.classList.remove('hidden');
    });

    bus.on('ui:hide-interact', () => {
      if (this.el.interactPrompt) this.el.interactPrompt.classList.add('hidden');
    });

    bus.on('ui:valve-progress', (progress) => {
      if (this.el.valveUi) this.el.valveUi.classList.remove('hidden');
      if (this.el.valveProgress) {
        const C = 339.292;
        this.el.valveProgress.style.strokeDashoffset = C * (1 - progress);
      }
    });

    bus.on('ui:hide-valve', () => {
      if (this.el.valveUi) this.el.valveUi.classList.add('hidden');
    });

    bus.on('ui:observe-progress', (progress) => {
      if (this.el.observeUi) this.el.observeUi.classList.remove('hidden');
      if (this.el.observeProgress) {
        const C = 276.46;
        this.el.observeProgress.style.strokeDashoffset = C * (1 - progress);
      }
    });

    bus.on('ui:hide-observe', () => {
      if (this.el.observeUi) this.el.observeUi.classList.add('hidden');
    });

    bus.on('ui:equip', (name, icon) => {
      if (!this.el.equipItems) return;
      const slot = document.createElement('div');
      slot.className = 'equip-slot active';
      slot.innerHTML = `<span class="equip-slot-icon">${icon}</span><span class="equip-slot-label">${name}</span>`;
      this.el.equipItems.appendChild(slot);
      if (this.el.equipmentBar) this.el.equipmentBar.classList.remove('hidden');
    });

    // ScenarioRunner emits {speaker, text} as a single object OR two separate args
    bus.on('ui:narration', (speakerOrObj, textArg) => {
      let speaker, text;
      if (typeof speakerOrObj === 'object' && speakerOrObj !== null) {
        speaker = speakerOrObj.speaker;
        text = speakerOrObj.text;
      } else {
        speaker = speakerOrObj;
        text = textArg;
      }
      this._queueNarration(speaker, text);
    });

    // ScenarioRunner emits {phase, steps}
    bus.on('ui:checklist', (data) => {
      const title = data.phase || data.title || '';
      const steps = data.steps || data.items || [];
      this._steps = steps;
      this._showChecklist(title, steps);
      this._updateStepCounter();
    });

    // ScenarioRunner emits {steps, current}
    bus.on('ui:checklist-update', (data) => {
      if (data.steps) {
        this._steps = data.steps;
        this._updateFullChecklist(data.steps, data.current);
      }
    });

    bus.on('ui:hide-checklist', () => {
      if (this.el.checklist) this.el.checklist.classList.add('hidden');
    });

    // ScenarioRunner emits {text, type} OR (text, duration)
    bus.on('ui:notification', (textOrObj, durationArg) => {
      let text, duration = 3000;
      if (typeof textOrObj === 'object' && textOrObj !== null) {
        text = textOrObj.text;
        duration = textOrObj.duration || 3000;
      } else {
        text = textOrObj;
        if (durationArg) duration = durationArg;
      }
      this._showNotification(text, duration);
    });

    // ScenarioRunner emits {elapsed}
    bus.on('ui:timer', (data) => {
      const seconds = typeof data === 'number' ? data : (data?.elapsed || 0);
      this._setTimer(seconds);
    });

    bus.on('ui:phase', (text) => {
      if (this.el.phaseLabel) this.el.phaseLabel.textContent = text;
    });

    bus.on('ui:step-counter', (current, total) => {
      if (this.el.stepCounter) this.el.stepCounter.textContent = `STEP ${current}/${total}`;
    });

    bus.on('ui:warnings', (n) => {
      if (this.el.warningsCounter) this.el.warningsCounter.textContent = `WARNINGS: ${n}`;
    });

    bus.on('scenario:phase-change', (data) => {
      if (this.el.phaseLabel) this.el.phaseLabel.textContent = data.fullName || data.title || '';
    });

    bus.on('scenario:step-complete', () => {
      this._updateStepCounter();
    });

    bus.on('ui:score', (data) => {
      this._showScore(data);
    });
  }

  _setTimer(seconds) {
    if (!this.el.timer) return;
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    this.el.timer.textContent = `${m}:${s}`;
  }

  _queueNarration(speaker, text) {
    if (!text) return;
    if (this._narrationActive) {
      this._narrationQueue.push({ speaker, text });
    } else {
      this._playNarration(speaker, text);
    }
  }

  _playNarration(speaker, text) {
    this._narrationActive = true;
    this.eventBus.emit('narration:start', { speaker, text });
    if (this._typewriterTimer) clearTimeout(this._typewriterTimer);
    if (this._narrationHideTimer) clearTimeout(this._narrationHideTimer);

    if (this.el.narrationSpeaker) {
      this.el.narrationSpeaker.textContent = `${speaker || ''}\u00a0\u00a0·\u00a0\u00a0click to skip`;
    }
    if (this.el.narrationText) this.el.narrationText.textContent = '';
    if (this.el.narration) this.el.narration.classList.remove('hidden');

    /* Speed-tuned values:
       CHAR_MS  8  (was 18) → 100-char line finishes in ~0.8 s
       HOLD_MS  600          → lingers briefly then advances
       Total for a 120-char line: ~1.6 s  (was ~5 s)
       Player can click the narration box to skip to full text instantly. */
    const CHAR_MS = 8;
    const HOLD_MS = 600;
    const chars = Array.from(text);
    let i = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (this._typewriterTimer) { clearTimeout(this._typewriterTimer); this._typewriterTimer = null; }
      if (this.el.narrationText) this.el.narrationText.textContent = text;
      this._narrationHideTimer = setTimeout(() => this._advanceNarration(), HOLD_MS);
    };

    /* Click anywhere on the narration panel = skip to full text. */
    const skipOnce = () => {
      if (this.el.narration) this.el.narration.removeEventListener('click', skipOnce);
      finish();
    };
    if (this.el.narration) this.el.narration.addEventListener('click', skipOnce);
    this._narrationSkipHandler = skipOnce;

    const typewriter = () => {
      if (i < chars.length) {
        if (this.el.narrationText) this.el.narrationText.textContent += chars[i++];
        this._typewriterTimer = setTimeout(typewriter, CHAR_MS);
      } else {
        done = true;
        this._narrationHideTimer = setTimeout(() => this._advanceNarration(), HOLD_MS);
      }
    };
    typewriter();
  }

  _advanceNarration() {
    /* Remove any pending skip listener from the previous narration. */
    if (this._narrationSkipHandler && this.el.narration) {
      this.el.narration.removeEventListener('click', this._narrationSkipHandler);
      this._narrationSkipHandler = null;
    }
    if (this.el.narration) this.el.narration.classList.add('hidden');
    this._narrationActive = false;
    if (this._narrationQueue.length > 0) {
      const next = this._narrationQueue.shift();
      this._playNarration(next.speaker, next.text);
    } else {
      this.eventBus.emit('narration:end');
    }
  }

  _showChecklist(title, steps) {
    if (this.el.checklistTitle) this.el.checklistTitle.textContent = title;
    if (this.el.checklistItems) {
      this.el.checklistItems.innerHTML = '';
      steps.forEach((step, idx) => {
        const div = document.createElement('div');
        const status = step.done ? 'done' : idx === 0 ? 'active' : 'pending';
        div.className = `cl-item ${status}`;
        div.id = `cl-${idx}`;
        const icon = step.done ? '✓' : idx === 0 ? '▸' : '○';
        div.innerHTML = `<span class="cl-check">${icon}</span><span>${step.text}</span>`;
        this.el.checklistItems.appendChild(div);
      });
    }
    if (this.el.checklist) this.el.checklist.classList.remove('hidden');
  }

  _updateFullChecklist(steps, current) {
    steps.forEach((step, idx) => {
      const el = document.getElementById(`cl-${idx}`);
      if (!el) return;
      const status = step.done ? 'done' : idx === current ? 'active' : 'pending';
      el.className = `cl-item ${status}`;
      const check = el.querySelector('.cl-check');
      if (check) check.textContent = step.done ? '✓' : idx === current ? '▸' : '○';
    });
    this._updateStepCounter();
  }

  _updateStepCounter() {
    if (!this.el.stepCounter || !this._steps) return;
    const total = this._steps.length;
    const done = this._steps.filter((s) => s.done).length;
    this.el.stepCounter.textContent = `STEP ${done}/${total}`;
  }

  _showNotification(text, duration = 3000) {
    if (!this.el.notification) return;
    /* Queue rapid-fire notifications — without this, two prompts
       fired within the same tick stomp each other and the player
       only sees the second one. */
    this._notifQueue.push({ text, duration });
    if (!this._notifTimeout) this._drainNotifQueue();
  }

  _drainNotifQueue() {
    if (this._notifQueue.length === 0) {
      this._notifTimeout = null;
      this.el.notification.classList.add('hidden');
      return;
    }
    const { text, duration } = this._notifQueue.shift();
    this.el.notification.textContent = text;
    this.el.notification.classList.remove('hidden');
    this._notifTimeout = setTimeout(() => {
      this._notifTimeout = null;
      // Brief gap so consecutive notifications visibly separate.
      setTimeout(() => this._drainNotifQueue(), 120);
    }, duration);
  }

  _showScore(data) {
    if (this.el.scoreGrid) {
      this.el.scoreGrid.innerHTML = '';

      // Prefer ScoringSystem's rich rows + grade if present, otherwise
      // fall back to a simple {elapsed, warnings} payload.
      let rows = data.rows;
      let grade = data.grade;

      if (!rows) {
        const elapsed = data.elapsed || 0;
        const warnings = data.warnings || 0;
        const m = Math.floor(elapsed / 60);
        const s = Math.floor(elapsed % 60);
        grade = grade || (warnings === 0 ? 'A+' : warnings <= 2 ? 'A' : warnings <= 5 ? 'B' : 'C');
        rows = [
          { label: 'TIME', value: `${m}m ${s}s` },
          { label: 'WARNINGS', value: warnings.toString() },
        ];
      }

      rows.forEach((r) => {
        const div = document.createElement('div');
        div.className = 'score-row';
        div.innerHTML = `<span class="label">${r.label}</span><span class="val">${r.value}</span>`;
        this.el.scoreGrid.appendChild(div);
      });

      if (this.el.scoreGrade && grade) this.el.scoreGrade.textContent = grade;
    }
    if (this.el.scoreScreen) this.el.scoreScreen.classList.remove('hidden');
  }

  setHeatOpacity(opacity) {
    if (this.el.heatOverlay) this.el.heatOverlay.style.opacity = opacity.toFixed(2);
  }
}
