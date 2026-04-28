/**
 * RadioPanel — full-screen interactive radio UI.
 * Player must: scroll/click to tune to CH 8, then hold PTT to transmit.
 */

const CHANNELS = { EMERGENCY: 8, CONTROL: 6, OPS: 5, SITE: 4 };

const STEP_GUIDE = {
  report_tank_data: {
    heading: 'INITIAL FIRE REPORT',
    steps: [
      '1. Tune radio to <strong>VHF Channel 8</strong> (Emergency)',
      '2. Hold <strong>PTT</strong> to transmit tank status',
      '3. Report: Level, Temp, Transfer status',
    ],
    refInfo: [
      'Tank 101-A — Level: <strong>12.3m</strong>',
      'Temperature: <strong>42°C</strong>',
      'Transfer: <strong>STOPPED</strong>',
      'Roof Drain: <strong>CLOSED</strong>',
    ],
  },
  request_2nd_turnout: {
    heading: 'REQUEST 2ND TURNOUT',
    steps: [
      '1. Confirm Channel <strong>8</strong> (Emergency)',
      '2. Hold <strong>PTT</strong> to request 2nd turnout',
      '3. Specify: HEFG + Trolley-mounted foam monitor',
    ],
    refInfo: [
      'Arrival via: <strong>Road 12</strong>',
      'Hydrant: <strong>12/H-20</strong>',
      'Support: <strong>HEFG + MEFG + Foam Monitor</strong>',
    ],
  },
  request_foam: {
    heading: 'REQUEST FOAM NURSER',
    steps: [
      '1. Confirm Channel <strong>8</strong> (Emergency)',
      '2. Hold <strong>PTT</strong> to request foam nurser',
      '3. Specify: Continuous foam application on 101-A',
    ],
    refInfo: [
      'Application: <strong>Top-of-tank foam flooding</strong>',
      'Duration: <strong>≥65 min continuous supply</strong>',
      'Support: <strong>HVLRM on Roads 10 &amp; 12</strong>',
    ],
  },
};

export class RadioPanel {
  constructor(audioManager) {
    this.audio = audioManager;
    this.visible = false;
    this.channel = 1;
    this.equipped = false;

    this.pttHeld = false;
    this.pttElapsed = 0;
    this.pttDuration = 1.8;
    this._pttFrame = null;
    this._pttLast = 0;

    this.pendingMessages = [];
    this.log = [];
    this.currentStepId = null;

    this.onTransmit = null;
    this.onClose = null;

    this._el = null;
    this._build();
    this._bindKeys();
  }

  // ── DOM ───────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'radio-panel';
    el.className = 'hidden';
    el.innerHTML = `
      <div id="rp-inner">

        <!-- Left: procedure guide -->
        <div id="rp-guide">
          <div id="rp-guide-title">VHF RADIO PROCEDURE</div>
          <div id="rp-guide-heading"></div>
          <ul id="rp-guide-steps"></ul>
          <div id="rp-guide-divider"></div>
          <div id="rp-guide-ref-title">REFERENCE DATA</div>
          <ul id="rp-guide-ref"></ul>
        </div>

        <!-- Center: radio device -->
        <div id="rp-device">
          <div id="rp-antenna"></div>
          <div id="rp-body">
            <div id="rp-screen">
              <div id="rp-screen-top">
                <span id="rp-screen-label">VHF</span>
                <div id="rp-signal">
                  <span class="sig-bar" data-h="4"></span>
                  <span class="sig-bar" data-h="7"></span>
                  <span class="sig-bar" data-h="10"></span>
                  <span class="sig-bar" data-h="13"></span>
                  <span class="sig-bar" data-h="16"></span>
                </div>
              </div>
              <div id="rp-ch-display">
                <span id="rp-ch-num">01</span>
              </div>
              <div id="rp-screen-status"></div>
            </div>

            <div id="rp-buttons">
              <button id="rp-ch-up" title="Channel Up">▲</button>
              <div id="rp-ptt-wrap">
                <button id="rp-ptt">
                  <span id="rp-ptt-label">PTT</span>
                  <div id="rp-ptt-fill"></div>
                </button>
                <div id="rp-ptt-hint">HOLD TO TRANSMIT</div>
              </div>
              <button id="rp-ch-down" title="Channel Down">▼</button>
            </div>

            <div id="rp-msg-select" class="hidden">
              <div id="rp-msg-title">SELECT MESSAGE</div>
              <div id="rp-msg-list"></div>
            </div>
          </div>
        </div>

        <!-- Right: transmission log -->
        <div id="rp-log">
          <div id="rp-log-title">TRANSMISSION LOG</div>
          <div id="rp-log-entries"></div>
        </div>

      </div>
      <div id="rp-close-hint">[R] or [ESC] — Holster Radio</div>
    `;
    document.body.appendChild(el);
    this._el = el;
    this._bindDevice();
  }

  _bindDevice() {
    document.getElementById('rp-ch-up').addEventListener('click', () => this._changeChannel(1));
    document.getElementById('rp-ch-down').addEventListener('click', () => this._changeChannel(-1));

    this._el.addEventListener('wheel', (e) => {
      if (!this.visible) return;
      e.preventDefault();
      this._changeChannel(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    const ptt = document.getElementById('rp-ptt');
    ptt.addEventListener('mousedown', () => this._startPTT());
    ptt.addEventListener('mouseup', () => this._endPTT());
    ptt.addEventListener('mouseleave', () => this._endPTT());
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'KeyR' || e.code === 'Escape') { this.close(); return; }
      if (e.code === 'ArrowUp') this._changeChannel(1);
      if (e.code === 'ArrowDown') this._changeChannel(-1);
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1) this._selectMessage(n - 1);
    });
  }

  // ── Public API ────────────────────────────────────────

  open(stepId, messages) {
    if (!this.equipped) return;
    this.visible = true;
    this.currentStepId = stepId;
    this.pendingMessages = messages || [];
    this._el.classList.remove('hidden');
    document.exitPointerLock();
    this._updateGuide(stepId);
    this._renderMsgList();
    this._updateScreen();
  }

  close() {
    this.visible = false;
    this._endPTT();
    this._el.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  setEquipped(v) {
    this.equipped = v;
  }

  setMessages(stepId, messages) {
    this.currentStepId = stepId;
    this.pendingMessages = messages || [];
    if (this.visible) {
      this._updateGuide(stepId);
      this._renderMsgList();
    }
  }

  // ── Channel ───────────────────────────────────────────

  _changeChannel(dir) {
    this.channel = Math.max(1, Math.min(16, this.channel + dir));
    this._updateScreen();
    document.getElementById('rp-msg-select').classList.add('hidden');
  }

  _updateScreen() {
    document.getElementById('rp-ch-num').textContent = this.channel.toString().padStart(2, '0');

    const isCorrect = this.channel === CHANNELS.EMERGENCY;
    const status = document.getElementById('rp-screen-status');

    if (isCorrect) {
      status.textContent = '◉ EMERGENCY COORD';
      status.className = 'correct';
      this._updateSignal(5);
      document.getElementById('rp-ptt-hint').textContent = 'HOLD TO TRANSMIT';
      if (this.pendingMessages.length > 0) {
        document.getElementById('rp-msg-select').classList.remove('hidden');
      }
    } else {
      status.textContent = `◌ CH ${this.channel.toString().padStart(2, '0')} — TUNE TO CH 08`;
      status.className = 'wrong';
      this._updateSignal(Math.floor(Math.random() * 3) + 1);
      document.getElementById('rp-ptt-hint').textContent = 'WRONG CHANNEL';
      document.getElementById('rp-msg-select').classList.add('hidden');
    }
  }

  _updateSignal(bars) {
    document.querySelectorAll('.sig-bar').forEach((b, i) => {
      b.classList.toggle('active', i < bars);
    });
  }

  // ── PTT ───────────────────────────────────────────────

  _startPTT() {
    if (this.pttHeld) return;
    if (this.channel !== CHANNELS.EMERGENCY) {
      this._logEntry('system', '✗ WRONG CHANNEL — Tune to CH 08');
      this.audio.play('radio_static');
      return;
    }
    if (this.pendingMessages.length === 0) return;

    this.pttHeld = true;
    this.pttElapsed = 0;
    this._pttLast = performance.now();
    document.getElementById('rp-ptt').classList.add('active');
    document.getElementById('rp-screen-status').textContent = '▐ TRANSMITTING...';
    this.audio.play('radio_static');
    this._tickPTT();
  }

  _tickPTT() {
    if (!this.pttHeld) return;
    const now = performance.now();
    this.pttElapsed += (now - this._pttLast) / 1000;
    this._pttLast = now;
    const prog = Math.min(1, this.pttElapsed / this.pttDuration);
    document.getElementById('rp-ptt-fill').style.height = `${prog * 100}%`;

    if (prog >= 1) {
      this._transmit();
      return;
    }
    this._pttFrame = requestAnimationFrame(() => this._tickPTT());
  }

  _endPTT() {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    cancelAnimationFrame(this._pttFrame);
    document.getElementById('rp-ptt').classList.remove('active');
    document.getElementById('rp-ptt-fill').style.height = '0%';
    this._updateScreen();
  }

  _transmit() {
    this.pttHeld = false;
    document.getElementById('rp-ptt').classList.remove('active');
    document.getElementById('rp-ptt-fill').style.height = '0%';

    const selected = this._getSelectedMessage();
    if (!selected) { this._updateScreen(); return; }

    this._logEntry('out', selected.text);
    this.audio.play('radio_static');

    // Response after 2s delay
    setTimeout(() => {
      this.audio.play('radio_static');
      this._logEntry('in', selected.response);
      if (this.onTransmit) this.onTransmit(selected);
      this.pendingMessages = this.pendingMessages.filter(m => m.stepId !== selected.stepId);
      this._renderMsgList();
      this._updateScreen();
      if (this.pendingMessages.length === 0) {
        document.getElementById('rp-msg-select').classList.add('hidden');
        document.getElementById('rp-screen-status').textContent = '✓ TRANSMISSION COMPLETE';
        document.getElementById('rp-screen-status').className = 'correct';
        // Auto-close after a short pause so the player can read the response
        setTimeout(() => this.close(), 2200);
      }
    }, 2000);
  }

  _getSelectedMessage() {
    const items = document.querySelectorAll('.rp-msg-item');
    let selected = null;
    items.forEach(item => {
      if (item.classList.contains('selected')) {
        const idx = parseInt(item.dataset.idx, 10);
        selected = this.pendingMessages[idx];
      }
    });
    return selected || this.pendingMessages[0] || null;
  }

  // ── Message list ──────────────────────────────────────

  _renderMsgList() {
    const list = document.getElementById('rp-msg-list');
    list.innerHTML = '';
    this.pendingMessages.forEach((msg, i) => {
      const div = document.createElement('div');
      div.className = 'rp-msg-item' + (i === 0 ? ' selected' : '');
      div.dataset.idx = i;
      div.innerHTML = `<span class="rp-msg-key">[${i + 1}]</span><span>${msg.text}</span>`;
      div.addEventListener('click', () => {
        document.querySelectorAll('.rp-msg-item').forEach(m => m.classList.remove('selected'));
        div.classList.add('selected');
      });
      list.appendChild(div);
    });
  }

  _selectMessage(idx) {
    const items = document.querySelectorAll('.rp-msg-item');
    items.forEach((m, i) => m.classList.toggle('selected', i === idx));
  }

  // ── Log ───────────────────────────────────────────────

  _logEntry(type, text) {
    const d = new Date();
    const ts = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
    const div = document.createElement('div');
    div.className = `rp-log-entry ${type}`;
    const prefix = type === 'out' ? '▶ YOU' : type === 'in' ? '◀ CTRL' : '◈ SYS';
    div.innerHTML = `<span class="rp-log-ts">${ts}</span><span class="rp-log-who">${prefix}</span><span class="rp-log-text">${text}</span>`;
    const entries = document.getElementById('rp-log-entries');
    entries.appendChild(div);
    entries.scrollTop = entries.scrollHeight;
  }

  // ── Guide panel ───────────────────────────────────────

  _updateGuide(stepId) {
    const guide = STEP_GUIDE[stepId];
    if (!guide) return;
    document.getElementById('rp-guide-heading').textContent = guide.heading;
    const steps = document.getElementById('rp-guide-steps');
    steps.innerHTML = '';
    guide.steps.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = s;
      steps.appendChild(li);
    });
    const ref = document.getElementById('rp-guide-ref');
    ref.innerHTML = '';
    guide.refInfo.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = s;
      ref.appendChild(li);
    });
  }

  dispose() {
    this._el?.remove();
  }
}
