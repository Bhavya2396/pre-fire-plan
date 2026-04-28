export class UIManager {
  constructor() {
    this.el = {};
    ['loading-screen','loading-bar','loading-status','start-screen','start-btn',
     'hud','phase-label','timer','step-counter','warnings-counter','crosshair',
     'interact-prompt','interact-label','interact-hint','valve-ui','valve-progress','valve-label',
     'narration','narration-speaker','narration-text','checklist','checklist-title','checklist-items',
     'radio-ui','radio-channel-num','radio-messages','radio-hint',
     'notification','score-screen','score-grid','score-grade','score-restart',
     'minimap-canvas','objective-arrow','objective-distance','objective-label',
     'equipment-bar','equip-items','observe-ui','observe-progress','observe-label'
    ].forEach(id => {
      this.el[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
    });

    this.narrationQueue = [];
    this.narrationActive = false;
    this.notifTimeout = null;
    this._typewriterTimer = null;
    this._narrationHideTimer = null;

    this.tts = null;
    this.onNarrationStart = null;
    this.onNarrationEnd = null;
  }

  setTTS(ttsManager) {
    this.tts = ttsManager;
  }

  setLoadingProgress(p) { this.el.loadingBar.style.width = `${Math.round(p * 100)}%`; }
  setLoadingStatus(t) { this.el.loadingStatus.textContent = t; }
  hideLoading() { this.el.loadingScreen.classList.add('hidden'); }
  showStart() { this.el.startScreen.classList.remove('hidden'); }
  hideStart() { this.el.startScreen.classList.add('hidden'); }
  showHud() { this.el.hud.classList.remove('hidden'); }

  setPhase(text) { this.el.phaseLabel.textContent = text; }
  setTimer(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    this.el.timer.textContent = `${m}:${s}`;
  }
  setStepCounter(current, total) { this.el.stepCounter.textContent = `STEP ${current}/${total}`; }
  setWarnings(n) { this.el.warningsCounter.textContent = `WARNINGS: ${n}`; }

  setCrosshairActive(active) {
    this.el.crosshair.classList.toggle('active', active);
  }

  showInteractPrompt(label, hint) {
    this.el.interactLabel.textContent = label;
    this.el.interactHint.textContent = hint || '';
    this.el.interactPrompt.classList.remove('hidden');
  }
  hideInteractPrompt() { this.el.interactPrompt.classList.add('hidden'); }

  showValveUI(progress) {
    this.el.valveUi.classList.remove('hidden');
    const circumference = 339.292;
    this.el.valveProgress.style.strokeDashoffset = circumference * (1 - progress);
  }
  hideValveUI() { this.el.valveUi.classList.add('hidden'); }

  // Public entry — queues if a line is already playing, never cuts audio mid-sentence.
  showNarration(speaker, text /* duration param ignored — derived from TTS timing */) {
    if (this.narrationActive) {
      this.narrationQueue.push({ speaker, text });
    } else {
      this._playNarration(speaker, text);
    }
  }

  _playNarration(speaker, text) {
    this.narrationActive = true;
    if (this._typewriterTimer)    clearTimeout(this._typewriterTimer);
    if (this._narrationHideTimer) clearTimeout(this._narrationHideTimer);

    this.el.narrationSpeaker.textContent = speaker;
    this.el.narrationText.textContent    = '';
    this.el.narration.classList.remove('hidden');
    if (this.onNarrationStart) this.onNarrationStart();

    // TTSManager queues the utterance and returns the estimated playback duration.
    const ttsDurationMs = this.tts ? this.tts.speak(text) : 0;

    // Typewriter: ~18 ms per character — fast enough to read but visually clear.
    const CHAR_MS   = 18;
    const chars     = Array.from(text);
    const typeMs    = chars.length * CHAR_MS;

    // Keep the panel visible long enough for both typewriter AND speech to finish,
    // then add a 1.2 s reading pause before hiding.
    const holdMs = Math.max(ttsDurationMs, typeMs) + 1200;
    let elapsed = 0;
    let i = 0;

    const typewriter = () => {
      if (i < chars.length) {
        this.el.narrationText.textContent += chars[i++];
        elapsed += CHAR_MS;
        this._typewriterTimer = setTimeout(typewriter, CHAR_MS);
      } else {
        // Wait for the remaining hold time after typewriter finishes.
        const remaining = Math.max(0, holdMs - elapsed);
        this._narrationHideTimer = setTimeout(() => {
          this.el.narration.classList.add('hidden');
          this.narrationActive = false;
          if (this.onNarrationEnd) this.onNarrationEnd();
          // Dequeue the next narration, if any.
          if (this.narrationQueue.length > 0) {
            const next = this.narrationQueue.shift();
            this._playNarration(next.speaker, next.text);
          }
        }, remaining);
      }
    };
    typewriter();
  }

  setChecklist(title, items) {
    this.el.checklistTitle.textContent = title;
    this.el.checklistItems.innerHTML = '';
    items.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = `cl-item ${item.status}`;
      div.id = `cl-${idx}`;
      const icon = item.status === 'done' ? '✓' : item.status === 'active' ? '▸' : '○';
      div.innerHTML = `<span class="cl-check">${icon}</span><span>${item.text}</span>`;
      this.el.checklistItems.appendChild(div);
    });
    this.el.checklist.classList.remove('hidden');
  }

  updateChecklistItem(idx, status) {
    const el = document.getElementById(`cl-${idx}`);
    if (!el) return;
    el.className = `cl-item ${status}`;
    const check = el.querySelector('.cl-check');
    check.textContent = status === 'done' ? '✓' : status === 'active' ? '▸' : status === 'error' ? '✗' : '○';
  }
  hideChecklist() { this.el.checklist.classList.add('hidden'); }

  showRadioUI() { this.el.radioUi.classList.remove('hidden'); }
  hideRadioUI() { this.el.radioUi.classList.add('hidden'); }
  setRadioChannel(ch) { this.el.radioChannelNum.textContent = ch.toString().padStart(2, '0'); }
  showRadioMessages(messages, onSelect) {
    this.el.radioMessages.innerHTML = '';
    this.el.radioMessages.classList.remove('hidden');
    this._radioMsgCallbacks = [];
    messages.forEach((msg, i) => {
      const div = document.createElement('div');
      div.className = 'radio-msg';
      div.innerHTML = `<span class="msg-key">[${i + 1}]</span><span>${msg.text}</span>`;
      this.el.radioMessages.appendChild(div);
      this._radioMsgCallbacks.push({ msg, element: div });
    });
    this._radioOnSelect = onSelect;
  }

  selectRadioByKey(keyIndex) {
    if (!this._radioMsgCallbacks || keyIndex >= this._radioMsgCallbacks.length) return;
    const { msg, element } = this._radioMsgCallbacks[keyIndex];
    element.classList.add('highlight');
    if (this._radioOnSelect) this._radioOnSelect(msg);
  }
  hideRadioMessages() {
    this.el.radioMessages.classList.add('hidden');
    this.el.radioMessages.innerHTML = '';
  }

  showNotification(text, duration = 3000) {
    if (this.notifTimeout) clearTimeout(this.notifTimeout);
    this.el.notification.textContent = text;
    this.el.notification.classList.remove('hidden');
    this.notifTimeout = setTimeout(() => this.el.notification.classList.add('hidden'), duration);
  }

  showEquipmentBar() { this.el.equipmentBar.classList.remove('hidden'); }
  addEquipSlot(name, icon) {
    const slot = document.createElement('div');
    slot.className = 'equip-slot active';
    slot.id = `equip-${name}`;
    slot.innerHTML = `<span class="equip-slot-icon">${icon}</span><span class="equip-slot-label">${name.toUpperCase()}</span>`;
    this.el.equipItems.appendChild(slot);
    this.el.equipmentBar.classList.remove('hidden');
  }

  showObserveUI(progress) {
    this.el.observeUi.classList.remove('hidden');
    const circumference = 276.46;
    this.el.observeProgress.style.strokeDashoffset = circumference * (1 - progress);
  }
  hideObserveUI() { this.el.observeUi.classList.add('hidden'); }

  showScore(data) {
    this.el.scoreGrid.innerHTML = '';
    data.rows.forEach(r => {
      const div = document.createElement('div');
      div.className = 'score-row';
      div.innerHTML = `<span class="label">${r.label}</span><span class="val">${r.value}</span>`;
      this.el.scoreGrid.appendChild(div);
    });
    this.el.scoreGrade.textContent = data.grade;
    this.el.scoreScreen.classList.remove('hidden');
  }
}
