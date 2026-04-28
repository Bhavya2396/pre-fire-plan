import scenario from '../config/scenario.json';

export default class ScoringSystem {
  constructor(eventBus) {
    this._eventBus = eventBus;
    this._startTime = 0;
    this._warnings = 0;
    this._wrongAnswers = 0;
    this._stepsCompleted = 0;
    this._totalSteps = Object.values(scenario.phaseSteps || {})
      .reduce((sum, arr) => sum + arr.length, 0);

    this._eventBus.on('scenario:phase-change', () => {
      if (!this._startTime) this._startTime = performance.now();
    });

    this._eventBus.on('scenario:step-complete', () => {
      this._stepsCompleted++;
    });

    this._eventBus.on('action-panel:complete', (stepId, wrongAttempts) => {
      this._wrongAnswers += wrongAttempts || 0;
    });

    /* Wrong-channel radio attempts count as warnings (same weight as
       out-of-order step completions). The radio panel itself throttles
       this to once per ~1.5 s so spamming the PTT only costs once. */
    this._eventBus.on('radio:wrong-channel', () => {
      this._warnings++;
      this._eventBus.emit('ui:warnings', this._warnings);
      this._eventBus.emit('ui:notification', {
        text: 'WRONG CHANNEL — Tune to CH 08 first', type: 'warning',
      });
    });

    /* Wrong-direction valve grabs used to be free (only visual flash +
       audio clunk). For symmetry with the radio penalty and to make
       the procedural turning feedback pedagogically meaningful, count
       a sustained wrong-direction grab as one warning. EquipmentAnimator
       throttles this event to ≤1/sec so a stray flick costs nothing. */
    this._lastValveWrong = 0;
    this._eventBus.on('valve:wrong-direction', () => {
      const now = performance.now();
      if (now - this._lastValveWrong < 2000) return;
      this._lastValveWrong = now;
      this._warnings++;
      this._eventBus.emit('ui:warnings', this._warnings);
    });

    this._eventBus.on('scenario:complete', (data) => {
      /* Use the MAX of locally-tracked warnings (radio + valve) and the
         scenario runner's count (out-of-order step blocks) so neither
         counter clobbers the other. ScenarioRunner only knows about
         its own out-of-order blocks; ScoringSystem owns interaction
         penalties. The merged value is what the player sees. */
      this._warnings = Math.max(this._warnings, data.warnings || 0);
      this._showFinalScore(data.elapsed);
    });
  }

  _showFinalScore(elapsed) {
    const m = Math.floor(elapsed / 60);
    const s = Math.floor(elapsed % 60);
    const timeStr = `${m}m ${s}s`;

    let grade;
    const penalty = this._warnings * 2 + this._wrongAnswers;
    if (penalty === 0) grade = 'A+';
    else if (penalty <= 3) grade = 'A';
    else if (penalty <= 6) grade = 'B';
    else if (penalty <= 10) grade = 'C';
    else grade = 'D';

    this._eventBus.emit('ui:score', {
      elapsed,
      warnings: this._warnings,
      rows: [
        { label: 'TOTAL TIME', value: timeStr },
        { label: 'STEPS COMPLETED', value: `${this._stepsCompleted}/${this._totalSteps}` },
        { label: 'OUT-OF-ORDER WARNINGS', value: this._warnings.toString() },
        { label: 'WRONG ANSWERS', value: this._wrongAnswers.toString() },
        { label: 'OVERALL GRADE', value: grade },
      ],
      grade,
    });
  }
}
