export default class Minimap {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.canvas = document.getElementById('minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.size = 180;
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.worldRadius = 140;
    this.objectivePos = null;
    this._objectiveLabel = '';
    this._landmarks = [];

    this._bindEvents();
  }

  _bindEvents() {
    this.eventBus.on('waypoint:set', (pos, label) => this.setObjective(pos, label));
    this.eventBus.on('waypoint:clear', () => this.setObjective(null));
  }

  // ── Landmark management ─────────────────────────────────

  addLandmark(pos, type, label) {
    this._landmarks.push({ x: pos.x, z: pos.z, type, label });
  }

  setObjective(worldPos, label) {
    this.objectivePos = worldPos ? { x: worldPos.x, z: worldPos.z } : null;
    this._objectiveLabel = label || '';
  }

  // ── Coordinate transform ────────────────────────────────

  _worldToMap(wx, wz, playerX, playerZ) {
    const scale = this.size / (this.worldRadius * 2);
    return {
      x: this.size / 2 + (wx - playerX) * scale,
      y: this.size / 2 + (wz - playerZ) * scale,
    };
  }

  // ── Main draw call ──────────────────────────────────────

  update(playerPos, playerAngle) {
    const ctx = this.ctx;
    const s = this.size;
    const c = s / 2;
    const px = playerPos.x;
    const pz = playerPos.z;

    ctx.clearRect(0, 0, s, s);

    // Background disc
    ctx.fillStyle = '#0a0a0acc';
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.fill();

    // Border ring
    ctx.strokeStyle = '#ff6b1a44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.stroke();

    // Range rings
    ctx.strokeStyle = '#ffffff08';
    [0.25, 0.5, 0.75].forEach(r => {
      ctx.beginPath();
      ctx.arc(c, c, (c - 2) * r, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 2, 0, Math.PI * 2);
    ctx.clip();

    const scale = s / (this.worldRadius * 2);

    // Roads (Road 10 at z=30, Road 12 at z=55)
    ctx.strokeStyle = '#33333366';
    ctx.lineWidth = 3 * scale;
    [30, 55].forEach(z => {
      const p1 = this._worldToMap(-90, z, px, pz);
      const p2 = this._worldToMap(90, z, px, pz);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    // Dyke outline (cx=-5, cz=0, 70×50)
    const dyke = this._worldToMap(-5, 0, px, pz);
    ctx.strokeStyle = '#88888844';
    ctx.lineWidth = 1;
    const dw = 70 * scale, dh = 50 * scale;
    ctx.strokeRect(dyke.x - dw / 2, dyke.y - dh / 2, dw, dh);

    // Landmarks
    this._landmarks.forEach(lm => {
      const p = this._worldToMap(lm.x, lm.z, px, pz);
      if (p.x < -10 || p.x > s + 10 || p.y < -10 || p.y > s + 10) return;

      if (lm.type === 'tank') {
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 * scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (lm.type === 'tank_fire') {
        ctx.strokeStyle = '#ff4400';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ff440044';
        ctx.fill();
      } else if (lm.type === 'hydrant') {
        ctx.fillStyle = '#2288ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (lm.type === 'valve') {
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      } else if (lm.type === 'radio') {
        ctx.fillStyle = '#44cc44';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      } else if (lm.type === 'control') {
        ctx.fillStyle = '#8888ff';
        ctx.fillRect(p.x - 3, p.y - 2, 6, 4);
      }
    });

    // Objective marker (pulsing ring)
    if (this.objectivePos) {
      const op = this._worldToMap(this.objectivePos.x, this.objectivePos.z, px, pz);
      const t = performance.now() * 0.003;
      const pulse = 3 + Math.sin(t) * 2;
      ctx.strokeStyle = '#ff6b1a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(op.x, op.y, pulse + 3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#ff6b1acc';
      ctx.beginPath();
      ctx.arc(op.x, op.y, pulse + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Player arrow (rotation indicator)
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(playerAngle);
    ctx.fillStyle = '#ff6b1a';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North indicator
    ctx.fillStyle = '#ff6b1a88';
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', c, 14);

    // Objective distance display
    if (this.objectivePos) {
      const dx = this.objectivePos.x - px;
      const dz = this.objectivePos.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const distEl = document.getElementById('objective-distance');
      if (distEl) distEl.textContent = `${Math.round(dist)}m`;
    }
  }

  dispose() {
    this.canvas = null;
    this.ctx = null;
  }
}
