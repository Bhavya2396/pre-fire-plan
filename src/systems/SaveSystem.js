const SAVE_KEY = 'prefire_save';

export default class SaveSystem {
  constructor(eventBus) {
    this._eventBus = eventBus;

    this._eventBus.on('save:request', () => this.save());
    this._eventBus.on('save:load', () => this.load());
    this._eventBus.on('save:clear', () => this.clear());
  }

  save() {
    try {
      const data = {};
      this._eventBus.emit('save:collect', data);
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this._eventBus.emit('ui:notification', 'PROGRESS SAVED', 2000);
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      this._eventBus.emit('save:restore', data);
      return data;
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  }

  clear() {
    localStorage.removeItem(SAVE_KEY);
  }
}
