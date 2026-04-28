const KEY_MAP = {
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
};

export default class InputManager {
  constructor(canvas, eventBus) {
    this._canvas = canvas;
    this._eventBus = eventBus;
    this._enabled = false;

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      crouch: false,
    };

    this.isLocked = false;

    this.mouseButtons = {
      left: false,
      right: false,
      middle: false,
    };

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
  }

  enable() {
    if (this._enabled) return;
    this._enabled = true;

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    this._canvas.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;

    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    this._resetState();
  }

  requestPointerLock() {
    this._canvas.requestPointerLock();
  }

  /* ---- Internal ---- */

  _resetState() {
    for (const key of Object.keys(this.keys)) this.keys[key] = false;
    this.mouseButtons.left = false;
    this.mouseButtons.right = false;
    this.mouseButtons.middle = false;
  }

  /* When the game is paused / focus lost, clicking the canvas should
     always re-acquire pointer lock. This fires before the normal
     mousedown handler so the click also registers as gameplay input. */
  _tryReacquireLock() {
    if (!this.isLocked && this._enabled) {
      this._canvas.requestPointerLock();
    }
  }

  _onKeyDown(e) {
    if (e.repeat) return;

    const mapped = KEY_MAP[e.code];
    if (mapped) this.keys[mapped] = true;

    // Single, canonical keydown emission (e.code). Subscribers should
    // match against the raw code ('KeyR', 'Escape', etc.). Aliases like
    // 'radio' / 'escape' were removed to prevent double-handling races.
    this._eventBus.emit('input:keydown', e.code);
  }

  _onKeyUp(e) {
    const mapped = KEY_MAP[e.code];
    if (mapped) this.keys[mapped] = false;

    this._eventBus.emit('input:keyup', e.code);
  }

  _onMouseMove(e) {
    if (!this.isLocked || !this._enabled) return;

    this._eventBus.emit('input:mousemove', {
      movementX: e.movementX,
      movementY: e.movementY,
    });
  }

  _onMouseDown(e) {
    /* Re-acquire pointer lock first (no-op if already locked). */
    this._tryReacquireLock();

    const btn = this._buttonName(e.button);
    if (btn) this.mouseButtons[btn] = true;

    this._eventBus.emit('input:mousedown', { button: btn, raw: e.button });
  }

  _onMouseUp(e) {
    const btn = this._buttonName(e.button);
    if (btn) this.mouseButtons[btn] = false;

    this._eventBus.emit('input:mouseup', { button: btn, raw: e.button });
  }

  _onPointerLockChange() {
    this.isLocked = document.pointerLockElement === this._canvas;
    this._eventBus.emit('input:pointerlock', this.isLocked);

    if (!this.isLocked) this._resetState();
  }

  _buttonName(button) {
    switch (button) {
      case 0: return 'left';
      case 1: return 'middle';
      case 2: return 'right';
      default: return null;
    }
  }
}
