import scenario from '../config/scenario.json';

const { phases, phaseOrder, phaseSteps, guidance, radioMessages, narrations } = scenario;

export default class ScenarioRunner {
  constructor(eventBus) {
    this._eventBus = eventBus;

    this.phase = null;
    this.steps = [];
    this.currentStep = 0;
    this.warnings = 0;
    this.startTime = 0;
    this.elapsed = 0;
    this.running = false;
    this.radioChannel = 1;
    this.radioActive = false;
    this.fireStarted = false;

    this._phaseIndex = 0;

    /* Routing notes:
       - `interaction:simple` is owned by Game.js (it knows the rich
         hose/equip/valve branching logic). The runner used to register
         an empty handler here for the same event; that handler has
         been removed to avoid the appearance that the runner does
         simple-click routing.
       - `interaction:valve-complete` is dual-handled in Game and here
         today (Game forwards, then this guard no-ops because the step
         is already done). Kept here as a safety net for non-Game
         callers but documented so future refactors don't duplicate. */
    this._onValveComplete = (data) => {
      if (data?.stepId) this.completeStep(data.stepId);
    };
    this._onObserveComplete = (data) => {
      if (data?.stepId) this.completeStep(data.stepId);
    };
    this._onRadioTransmit = (msg) => {
      if (msg) this.handleRadioMessage(msg);
    };

    this._eventBus.on('interaction:valve-complete', this._onValveComplete);
    this._eventBus.on('interaction:observe-complete', this._onObserveComplete);
    this._eventBus.on('radio:transmit', this._onRadioTransmit);
  }

  start() {
    this.running = true;
    this.startTime = performance.now();
    this.elapsed = 0;

    this._setPhase('PATROL');

    this._eventBus.emit('ui:narration', narrations.patrol_intro);

    /* Safety net: if the player can't navigate the PATROL proximity loop
       within 45 s (e.g. the waypoints are confusing), auto-complete PATROL
       and start the fire so they aren't stuck on the onboarding phase.
       The patrol_skipped narration informs them the fire has broken out. */
    this._patrolTimer = setTimeout(() => {
      if (this.phase === 'PATROL') {
        // Force-complete all remaining PATROL steps.
        for (const step of this.steps) step.done = true;
        this._eventBus.emit('ui:notification', {
          text: 'FIRE DETECTED — Responding automatically',
          type: 'emergency',
        });
        this._advancePhase();
      }
    }, 45_000);
  }

  completeStep(stepId) {
    const idx = this.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return false;

    const step = this.steps[idx];
    if (step.done) return false;

    // HARD-BLOCK out-of-order completion. Previously we silently marked
    // the step done with a warning; that allowed players to skip ahead
    // and finish the SOP without doing earlier steps. Now we refuse the
    // completion entirely and tell them what to do first.
    const firstUndone = this.steps.findIndex((s) => !s.done);
    if (firstUndone !== -1 && firstUndone !== idx) {
      const blocking = this.steps[firstUndone];
      this.warnings++;
      this._eventBus.emit('ui:warnings', this.warnings);
      this._eventBus.emit('ui:notification', {
        text: `BLOCKED: complete "${blocking.text}" first`,
        type: 'warning',
      });
      return false;
    }

    step.done = true;
    this._eventBus.emit('scenario:step-complete', { stepId, step });

    const nextUndone = this.steps.findIndex((s) => !s.done);
    if (nextUndone !== -1) {
      this.currentStep = nextUndone;
      this._showStepGuidance(this.steps[nextUndone].id);
    }

    this._eventBus.emit('ui:checklist-update', {
      steps: this.steps,
      current: this.currentStep,
    });

    const allDone = this.steps.every((s) => s.done);
    if (allDone) {
      this._advancePhase();
    }
    return true;
  }

  update(delta, playerPos = null) {
    if (!this.running) return;
    this.elapsed += delta;
    this._eventBus.emit('ui:timer', { elapsed: this.elapsed });

    // Proximity step ticking. Steps with `proximity: { pos, radius }`
    // self-complete when the player walks inside their radius. Used
    // for the PATROL onboarding phase.
    if (playerPos && this.steps && this.steps.length > 0) {
      const step = this.steps[this.currentStep];
      if (step && !step.done && step.proximity) {
        const px = step.proximity.pos[0];
        const pz = step.proximity.pos[2];
        const dx = playerPos.x - px;
        const dz = playerPos.z - pz;
        if ((dx * dx + dz * dz) <= step.proximity.radius * step.proximity.radius) {
          this.completeStep(step.id);
        }
      }
    }
  }

  getCurrentStepId() {
    if (!this.running) return null;
    const step = this.steps[this.currentStep];
    return step ? step.id : null;
  }

  isStepActive(stepId) {
    if (!this.running) return false;
    const step = this.steps[this.currentStep];
    return step && step.id === stepId;
  }

  getRemainingSteps() {
    return this.steps.filter(s => !s.done).map(s => s.id);
  }

  forceComplete() {
    if (!this.running) return;
    this.steps.forEach(s => { s.done = true; });
    this.running = false;
    this._eventBus.emit('scenario:phase-change', {
      phase: 'COMPLETE',
      title: phases.COMPLETE?.title || 'COMPLETE',
      fullName: phases.COMPLETE?.name || 'SIMULATION COMPLETE',
    });
    if (narrations.complete_intro) {
      this._eventBus.emit('ui:narration', narrations.complete_intro);
    }
    this._eventBus.emit('scenario:complete', {
      elapsed: this.elapsed,
      warnings: this.warnings,
    });
  }

  getRadioMessages() {
    const msgs = radioMessages[this.phase];
    if (!msgs) return [];
    return msgs.filter((msg) => {
      const step = this.steps.find((s) => s.id === msg.stepId);
      return step && !step.done;
    });
  }

  handleRadioMessage(msg) {
    if (msg.stepId) {
      this.completeStep(msg.stepId);
    }
    if (msg.response) {
      this._eventBus.emit('ui:narration', {
        speaker: 'CONTROL ROOM',
        text: msg.response,
      });
    }
  }

  _triggerFire() {
    this.fireStarted = true;
    this._eventBus.emit('fire:started');
    this._eventBus.emit('alarm:on');
    this._eventBus.emit('ui:notification', {
      text: narrations.fire_alert.text,
      type: 'emergency',
    });
    this._eventBus.emit('ui:narration', narrations.fire_alert);

    this._setPhase('OPS_RESPONSE');
  }

  _setPhase(name) {
    this.phase = name;
    this._phaseIndex = phaseOrder.indexOf(name);

    const stepDefs = phaseSteps[name] || [];
    this.steps = stepDefs.map((s) => ({ ...s, done: false }));
    this.currentStep = 0;

    this._eventBus.emit('scenario:phase-change', {
      phase: name,
      title: phases[name]?.title || name,
      fullName: phases[name]?.name || name,
    });

    this._eventBus.emit('ui:checklist', {
      phase: name,
      steps: this.steps,
    });

    // Phase intro narrations queue first; step guidance fires after a delay
    // so they don't overlap
    const phaseIntroMap = {
      OPS_RESPONSE:   narrations.ops_response_intro,
      FIRST_TURNOUT:  narrations.first_turnout_intro,
      SECOND_TURNOUT: narrations.second_turnout_intro,
    };
    const intro = phaseIntroMap[name];
    if (intro) {
      this._eventBus.emit('ui:narration', intro);
    }

    if (this.steps.length > 0) {
      const delay = intro ? 2400 : 0; // give intro time to be read
      setTimeout(() => this._showStepGuidance(this.steps[0].id), delay);
    }
  }

  _advancePhase() {
    if (this.phase === 'PATROL') {
      /* Disarm fallback timer — PATROL completed naturally or was
         force-skipped; either way we must not double-trigger. */
      if (this._patrolTimer) {
        clearTimeout(this._patrolTimer);
        this._patrolTimer = null;
      }
      this._triggerFire();
      return;
    }

    const nextIdx = this._phaseIndex + 1;
    const nextName = phaseOrder[nextIdx];
    if (nextIdx >= phaseOrder.length || nextName === 'COMPLETE') {
      this.running = false;
      this._eventBus.emit('scenario:phase-change', {
        phase: 'COMPLETE',
        title: phases.COMPLETE?.title || 'COMPLETE',
        fullName: phases.COMPLETE?.name || 'SIMULATION COMPLETE',
      });
      if (narrations.complete_intro) {
        this._eventBus.emit('ui:narration', narrations.complete_intro);
      }
      this._eventBus.emit('scenario:complete', {
        elapsed: this.elapsed,
        warnings: this.warnings,
      });
      return;
    }
    this._setPhase(nextName);
  }

  _showStepGuidance(stepId) {
    const entry = guidance[stepId];
    if (entry) {
      this._eventBus.emit('ui:narration', entry);
    }
    this._eventBus.emit('scenario:step-activated', stepId);
  }

}
