import { InteractionType } from './InteractionSystem.js';

const PHASES = {
  PATROL: { name: 'PHASE 0 — PATROL', title: 'PATROL' },
  OPS_RESPONSE: { name: 'PHASE 1 — OPERATIONS RESPONSE', title: 'OPERATIONS RESPONSE' },
  FIRST_TURNOUT: { name: 'PHASE 2 — 1ST TURNOUT', title: '1ST TURNOUT TACTICAL' },
  SECOND_TURNOUT: { name: 'PHASE 3 — 2ND TURNOUT', title: '2ND TURNOUT' },
  COMPLETE: { name: 'SIMULATION COMPLETE', title: 'COMPLETE' },
};

const STEP_GUIDANCE = {
  close_roof_drain: {
    speaker: 'SYSTEM',
    text: 'Walk north toward the burning tank. Find the ROOF DRAIN VALVE with a red handwheel on the south-east side of Tank 101-A. Click on it to open the valve procedure panel.',
  },
  close_dyke_valve: {
    speaker: 'SYSTEM',
    text: 'Head to the WEST WALL of the dyke enclosure. The dyke drain valve controls outflow through the bund wall. Close it to ensure containment of oil inside the dyke area.',
  },
  isolate_manifold: {
    speaker: 'SYSTEM',
    text: 'Move to the PIPE MANIFOLD area between the two tanks. All receipt, dispense and transfer operations must be stopped. Click the valve to begin isolation — this requires lock-out tag-out.',
  },
  alert_fire_safety: {
    speaker: 'SYSTEM',
    text: 'Run to the CONTROL STATION south-east of the dyke. Inform Fire & Safety at 333/444/3576 or VHF channel 8, or by breaking nearby MCP. Pick up the emergency radio.',
  },
  report_tank_data: {
    speaker: 'SYSTEM',
    text: 'Radio equipped. The tank information — Tank Level, Temperature, Transfer status — shall be shared to SIC (F&S) upon their arrival. Press R, tune to Channel 8, and hold PTT.',
  },
  open_cooling_valve: {
    speaker: 'SYSTEM',
    text: 'Go to Tank 101-B on the east side. The cooling water isolation valve must be opened if necessary. Note: cooling adjacent tanks through water monitors is not recommended.',
  },
  start_product_transfer: {
    speaker: 'SYSTEM',
    text: 'Use the radio to coordinate product transfer from the affected tank to another tank with sufficient ullage. Press R to open radio, tune to Channel 8, and hold PTT.',
  },
  position_tender_1: {
    speaker: 'DISPATCH',
    text: 'First turnout arriving on Road 10. Fire tender must park close to Hydrant 10/H-28. Within 3 minutes. Run to H-28 south of the dyke.',
  },
  connect_hose_1: {
    speaker: 'SIC',
    text: 'Tender is in position. Two 15m hoses from H-28 to tender. Nearby Hydrant H-27 provides foam to HVLRM through JRCP. Click to begin the connection procedure.',
  },
  open_spray_101b: {
    speaker: 'SIC',
    text: 'AMC will open isolation valves for water spray system on adjacent Tank 101-B. Click the spray ring area to verify operation.',
  },
  request_2nd_turnout: {
    speaker: 'SIC',
    text: 'SIC will contact control room for 2nd turnout along with HEFG & trolley-mounted foam monitor. HEFG is for dyke spillage and fire. Press R, tune to Channel 8, hold PTT.',
  },
  position_tender_2: {
    speaker: 'DISPATCH',
    text: 'Second turnout arriving on Road 12. Park fire tender close to Hydrant 12/H-20. Run south to H-20.',
  },
  connect_hose_2: {
    speaker: 'SIC',
    text: 'Second tender parked. Two 15m hoses from H-20. MEFG at Roads 10 and 12 supplies foam to dyke. JRCP connects to HVLRM 12/04. Click to begin connection.',
  },
  request_foam: {
    speaker: 'SIC',
    text: 'SIC will contact control room for sending foam nurser. Continuous foam application can be done from Fire Tender if throw and range is sufficient. Press R, Channel 8, hold PTT.',
  },
  check_boilover: {
    speaker: 'SIC',
    text: 'URGENT EVACUATION ASSESSMENT. Boil-over can be detected by change of tank shell paint and increase in flames. Click Tank 101-A to inspect.',
  },
};

export class ScenarioManager {
  constructor(ui, interaction, audioMgr, sceneManager) {
    this.ui = ui;
    this.interaction = interaction;
    this.audio = audioMgr;
    this.sceneMgr = sceneManager;

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
    this.onFireStart = null;
    this.onPhaseChange = null;
    this.onComplete = null;
    this.onStepActivated = null;
    this.onSimpleComplete = null;

    this.interaction.onInteract = (data) => this._handleSimpleInteract(data);
    this.interaction.onValveComplete = (data) => this._handleValveComplete(data);
    this.interaction.onObserveComplete = (data) => this._handleObserveComplete(data);

    document.addEventListener('wheel', (e) => {
      if (this.radioActive) {
        e.preventDefault();
        this.radioChannel = Math.max(1, Math.min(16, this.radioChannel + (e.deltaY > 0 ? 1 : -1)));
        this.ui.setRadioChannel(this.radioChannel);
      }
    }, { passive: false });

    // Radio keyboard handling is now managed by RadioPanel
  }

  start() {
    this.running = true;
    this.startTime = performance.now();
    this._setPhase('PATROL');

    this.ui.showNarration(
      'DISPATCH',
      'Night shift, Sector 40. You are on routine patrol of the tank farm. Tank 101-A is a 70 metre floating roof tank holding 50,000 cubic metres of petroleum crude. Walk toward the tanks to begin.',
      6000
    );

    setTimeout(() => this._triggerFire(), 12000);
  }

  _triggerFire() {
    this.fireStarted = true;
    if (this.onFireStart) this.onFireStart();
    this.sceneMgr.setFireActive(true);
    this.sceneMgr.setAlarmActive(true);
    this.audio.play('fire_alarm');
    this.audio.fadeIn('fire_burning', 2);

    this.ui.showNotification('EMERGENCY — FULL SURFACE FIRE DETECTED', 4000);

    setTimeout(() => {
      this.ui.showNarration(
        'EMERGENCY ALERT',
        'Full surface fire on Tank 101-A. 50,000 cubic metres of petroleum crude is burning. Risk: environmental, slop over, vapour cloud formation, rupture, deformation on nearby tanks. Initiate emergency operations response immediately.',
        8000
      );
    }, 2000);

    setTimeout(() => this._setPhase('OPS_RESPONSE'), 5000);
  }

  _setPhase(phaseName) {
    const p = PHASES[phaseName];
    this.phase = phaseName;
    this.ui.setPhase(p.name);

    if (phaseName === 'OPS_RESPONSE') {
      this.steps = [
        { id: 'close_roof_drain', text: 'Close roof drain valve (Tank 101-A)', status: 'active', done: false },
        { id: 'close_dyke_valve', text: 'Close dyke containment valve', status: 'pending', done: false },
        { id: 'isolate_manifold', text: 'Stop operations & isolate tank at manifold', status: 'pending', done: false },
        { id: 'alert_fire_safety', text: 'Inform Fire & Safety (pick up radio)', status: 'pending', done: false },
        { id: 'report_tank_data', text: 'Radio: Share tank data to SIC on Channel 8', status: 'pending', done: false },
        { id: 'open_cooling_valve', text: 'Open cooling water isolation valve for Tank 101-B', status: 'pending', done: false },
        { id: 'start_product_transfer', text: 'Radio: Initiate product transfer from Tank 101-A', status: 'pending', done: false },
      ];
      this.currentStep = 0;
    } else if (phaseName === 'FIRST_TURNOUT') {
      this.steps = [
        { id: 'position_tender_1', text: 'Guide fire tender to Hydrant H-28', status: 'active', done: false },
        { id: 'connect_hose_1', text: 'Open H-28 water supply', status: 'pending', done: false },
        { id: 'open_spray_101b', text: 'Open isolation valves — water spray on 101-B', status: 'pending', done: false },
        { id: 'request_2nd_turnout', text: 'Radio: Request 2nd turnout on Channel 8', status: 'pending', done: false },
      ];
      this.currentStep = 0;

      setTimeout(() => {
        this.ui.showNarration(
          'DISPATCH',
          'First turnout approaching on Road 10. Foam tender with proper equipment. Park close to Hydrant 10/H-28 within 3 minutes. Run to Hydrant H-28 on Road 10 to guide them in.',
          7000
        );
      }, 500);
    } else if (phaseName === 'SECOND_TURNOUT') {
      this.steps = [
        { id: 'position_tender_2', text: 'Guide 2nd tender to Hydrant H-20', status: 'active', done: false },
        { id: 'connect_hose_2', text: 'Open H-20 water supply', status: 'pending', done: false },
        { id: 'request_foam', text: 'Radio: Request foam nurser on Channel 8', status: 'pending', done: false },
        { id: 'check_boilover', text: 'Inspect tank shell for boil-over signs', status: 'pending', done: false },
      ];
      this.currentStep = 0;

      setTimeout(() => {
        this.ui.showNarration(
          'DISPATCH',
          'Second turnout arriving on Road 12 with HEFG and trolley-mounted foam monitor. HEFG requirement is for dyke spillage and fire cases. Park close to Hydrant 12/H-20.',
          7000
        );
      }, 500);
    } else if (phaseName === 'COMPLETE') {
      this.running = false;
      this.audio.fadeOut('fire_alarm', 2);
      this.audio.fadeOut('fire_burning', 3);
      this.sceneMgr.setAlarmActive(false);
      if (this.onComplete) this.onComplete(this._buildScore());
      return;
    }

    if (this.steps.length > 0) {
      this.ui.setChecklist(PHASES[phaseName].title, this.steps);
      this.ui.setStepCounter(0, this.steps.length);
      if (this.onStepActivated) this.onStepActivated(this.steps[0].id);

      if (phaseName === 'OPS_RESPONSE') {
        setTimeout(() => this._showStepGuidance(this.steps[0].id), 9000);
      }
    }
    if (this.onPhaseChange) this.onPhaseChange(phaseName);
  }

  _showStepGuidance(stepId) {
    const guidance = STEP_GUIDANCE[stepId];
    if (guidance) {
      this.ui.showNarration(guidance.speaker, guidance.text, 7000);
    }
  }

  _activateStep(stepId) {
    if (this.onStepActivated) this.onStepActivated(stepId);
    setTimeout(() => this._showStepGuidance(stepId), 800);
  }

  completeStep(stepId) { this._completeStep(stepId); }

  _completeStep(stepId) {
    const idx = this.steps.findIndex(s => s.id === stepId);
    if (idx === -1 || this.steps[idx].done) return;

    if (idx !== this.currentStep) {
      this.warnings++;
      this.ui.setWarnings(this.warnings);
      this.ui.showNotification('SEQUENCE WARNING — Step out of order', 2500);
    }

    this.steps[idx].done = true;
    this.steps[idx].status = 'done';
    this.ui.updateChecklistItem(idx, 'done');

    let nextStep = -1;
    for (let i = 0; i < this.steps.length; i++) {
      if (!this.steps[i].done) { nextStep = i; break; }
    }

    if (nextStep >= 0) {
      this.currentStep = nextStep;
      this.steps[nextStep].status = 'active';
      this.ui.updateChecklistItem(nextStep, 'active');
      this._activateStep(this.steps[nextStep].id);
    }

    const doneCount = this.steps.filter(s => s.done).length;
    this.ui.setStepCounter(doneCount, this.steps.length);

    if (this.steps.every(s => s.done)) {
      this.ui.showNotification('PHASE COMPLETE', 2000);
      setTimeout(() => this._advancePhase(), 3000);
    }
  }

  _advancePhase() {
    const order = ['PATROL', 'OPS_RESPONSE', 'FIRST_TURNOUT', 'SECOND_TURNOUT', 'COMPLETE'];
    const idx = order.indexOf(this.phase);
    if (idx < order.length - 1) {
      this._setPhase(order[idx + 1]);
    }
  }

  _handleSimpleInteract(data) {
    if (data.completed) return;
    if (data._panelOpen) return;

    // Radio pickup completes immediately (no ActionPanel)
    if (data.equipItem) {
      data.completed = true;
      if (data.stepId) this._completeStep(data.stepId);
      if (data.stepId === 'alert_fire_safety') {
        this.radioActive = true;
        this.radioChannel = 8;
        this.ui.showNarration(
          'SYSTEM',
          'Radio acquired — Fire & Safety informed via VHF Channel 8. Share tank information to SIC (F&S) upon arrival: Tank Level, Temperature, Transfer status. Press R to open radio, tune to Channel 8, hold PTT.',
          7000
        );
      }
      if (data.notification) this.ui.showNotification(data.notification, 3000);
      if (data.narration) this.ui.showNarration(data.narration.speaker || 'SYSTEM', data.narration.text, data.narration.duration || 5000);
    } else {
      data._panelOpen = true;
    }

    if (this.onSimpleComplete) this.onSimpleComplete(data);
  }

  _handleValveComplete(data) {
    if (data.completed) return;
    data.completed = true;
    this.audio.play('valve_turn');

    if (data.stepId) {
      this._completeStep(data.stepId);
    }
    if (data.notification) {
      this.ui.showNotification(data.notification, 3000);
    }
    if (data.narration) {
      this.ui.showNarration(data.narration.speaker || 'SYSTEM', data.narration.text, data.narration.duration || 5000);
    }
    if (data.onComplete) {
      data.onComplete();
    }
  }

  _handleObserveComplete(data) {
    if (data.completed) return;
    data.completed = true;

    if (data.stepId) {
      this._completeStep(data.stepId);
    }
    this.ui.showNotification(data.notification || 'OBSERVATION COMPLETE', 3000);
  }

  handleRadioMessage(msg) {
    if (msg.stepId) {
      this._completeStep(msg.stepId);
    }
    this.ui.showNarration('CONTROL ROOM', msg.response, 7000);
  }

  getAvailableRadioMessages() {
    if (!this.radioActive) return [];

    const msgs = [];
    if (this.phase === 'OPS_RESPONSE') {
      if (!this.steps.find(s => s.id === 'report_tank_data')?.done) {
        msgs.push({
          text: 'REPORT: Tank 101-A, Level 12.3m, Temp 42°C, Transfer STOPPED, Full surface fire',
          stepId: 'report_tank_data',
          response: 'Control room received. Tank 101-A data logged. Level 12.3 metres, temperature 42 degrees, transfer stopped. Site Incident Commander en route to your position. Roof drain valve status noted. Continue with cooling operations on Tank 101-B.'
        });
      }
      if (!this.steps.find(s => s.id === 'start_product_transfer')?.done) {
        msgs.push({
          text: 'REQUEST: Begin product transfer from Tank 101-A to tank with sufficient ullage',
          stepId: 'start_product_transfer',
          response: 'Control room acknowledged. Consulting with senior operation personnel. Product transfer from Tank 101-A to be initiated — receiving tank ullage confirmed. Transfer piping being aligned. Await first turnout on Road 10.'
        });
      }
    } else if (this.phase === 'FIRST_TURNOUT') {
      if (!this.steps.find(s => s.id === 'request_2nd_turnout')?.done) {
        msgs.push({
          text: 'REQUEST: Send 2nd turnout with HEFG and trolley-mounted foam monitor',
          stepId: 'request_2nd_turnout',
          response: 'Second turnout dispatched with Heavy Equipment Foam Generator and trolley-mounted foam monitor. Estimated arrival in 4 minutes via Road 12. Prepare Hydrant H-20 for their arrival.'
        });
      }
    } else if (this.phase === 'SECOND_TURNOUT') {
      if (!this.steps.find(s => s.id === 'request_foam')?.done) {
        msgs.push({
          text: 'REQUEST: Send foam nurser for continuous foam application on Tank 101-A',
          stepId: 'request_foam',
          response: 'Foam nurser dispatched. Continuous foam application authorized for Tank 101-A. After this, inspect the tank shell for boil-over indicators. Look for paint discoloration and increased steam emissions.'
        });
      }
    }
    return msgs;
  }

  update(delta) {
    if (!this.running) return;
    this.elapsed = (performance.now() - this.startTime) / 1000;
    this.ui.setTimer(this.elapsed);
  }

  _buildScore() {
    const time = this.elapsed;
    let grade = 'A';
    if (this.warnings > 3 || time > 600) grade = 'D';
    else if (this.warnings > 2 || time > 480) grade = 'C';
    else if (this.warnings > 1 || time > 360) grade = 'B';

    return {
      rows: [
        { label: 'TOTAL TIME', value: `${Math.floor(time / 60)}m ${Math.floor(time % 60)}s` },
        { label: 'SEQUENCE WARNINGS', value: this.warnings.toString() },
        { label: 'PHASES COMPLETED', value: '3 / 3' },
        { label: 'RESPONSE GRADE', value: grade },
      ],
      grade,
    };
  }
}
