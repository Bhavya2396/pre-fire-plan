// Words spoken per second at the chosen rate — used to estimate display durations.
const WORDS_PER_SEC = 2.6;

export class TTSManager {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice  = null;
    this.enabled = true;
    this._queue   = [];   // { text, rate, onEnd }[]
    this._busy    = false;
    this._findVoice();
  }

  // ── Voice selection ────────────────────────────────────────────────────────
  _findVoice() {
    const pick = () => {
      const voices = this.synth.getVoices();
      if (!voices.length) return;
      // Priority: authoritative industrial-sounding English voices
      this.voice =
        voices.find(v => v.name === 'Daniel'              && v.lang === 'en-GB') ||
        voices.find(v => v.name === 'Arthur'              && v.lang === 'en-GB') ||
        voices.find(v => v.name.includes('Daniel')        && v.lang.startsWith('en')) ||
        voices.find(v => v.name === 'Google UK English Male')  ||
        voices.find(v => v.name.includes('UK English Male'))   ||
        voices.find(v => v.name === 'Samantha'            && v.lang === 'en-US') ||
        voices.find(v => v.name.includes('Google')        && v.lang.startsWith('en')) ||
        voices.find(v => v.lang.startsWith('en-')         && v.localService) ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0];
    };
    pick();
    if (this.synth.addEventListener) {
      this.synth.addEventListener('voiceschanged', pick);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Queue a spoken line.  Never interrupts currently-playing speech.
   * Returns an estimated playback duration in ms so callers can sync display.
   */
  speak(text, rate = 0.93) {
    if (!this.enabled || !this.synth) return this._estimateMs(text, rate);

    const clean = this._clean(text);
    if (!clean) return 0;

    const ms = this._estimateMs(clean, rate);
    this._queue.push({ text: clean, rate });
    if (!this._busy) this._processNext();
    return ms;
  }

  /** Immediately silence everything and clear the queue. */
  stop() {
    this._queue   = [];
    this._busy    = false;
    if (this.synth) this.synth.cancel();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _clean(text) {
    return text
      .replace(/[📡🔥⚠️✓✗▸○—–]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _estimateMs(text, rate) {
    const words = text.trim().split(/\s+/).length;
    // add 600 ms for sentence-initial pause + end pause
    return Math.round((words / (WORDS_PER_SEC * rate)) * 1000) + 600;
  }

  _processNext() {
    if (!this._queue.length) { this._busy = false; return; }
    this._busy = true;

    const { text, rate } = this._queue.shift();
    const utter = new SpeechSynthesisUtterance(text);
    if (this.voice)  utter.voice  = this.voice;
    utter.rate   = rate;
    utter.pitch  = 0.88;   // slightly lower = more authoritative / radio-like
    utter.volume = 1.0;

    utter.onend   = () => this._processNext();
    utter.onerror = (e) => {
      // Ignore 'interrupted' errors (browser tab switch etc.)
      if (e.error !== 'interrupted') console.warn('TTS error:', e.error);
      this._processNext();
    };

    // Safari / iOS bug: synthesis stalls if we don't poke it
    try { this.synth.speak(utter); } catch (_) { this._processNext(); }
  }
}
