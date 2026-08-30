// particles.js — пул частиц. Структура массивов, ноль аллокаций в кадре,
// автоснижение лимита при просадке FPS.

import { TAU, clamp } from './rng.js';

export const P = {
  SPARK: 0,    // укус: искры-осколки
  CHUNK: 1,    // куски тела при смерти
  ABSORB: 2,   // еда, втягиваемая ртом
  BUBBLE: 3,   // след ускорения
  RING: 4,     // ударная волна / вспышка эволюции
  GOO: 5,      // слизь, яд
};

const FIELDS = 12;

export class Particles {
  constructor(max = 700) {
    this.max = max;
    this.limit = max;
    this.n = 0;
    // x y vx vy life maxLife size rot vrot type hue drag
    this.a = new Float32Array(max * FIELDS);
    // Цель притяжения для ABSORB (рот существа).
    this.tx = new Float32Array(max);
    this.ty = new Float32Array(max);

    // Всплывающий текст — отдельный маленький пул.
    this.textMax = 24;
    this.tn = 0;
    this.tArr = new Float32Array(this.textMax * 5); // x y life maxLife hue
    this.tStr = new Array(this.textMax).fill('');
  }

  setLimit(v) { this.limit = clamp(v | 0, 60, this.max); }

  spawn(type, x, y, vx, vy, life, size, hue, drag = 2.2) {
    if (this.n >= this.limit) return -1;
    const i = this.n++, o = i * FIELDS;
    const a = this.a;
    a[o] = x; a[o + 1] = y; a[o + 2] = vx; a[o + 3] = vy;
    a[o + 4] = life; a[o + 5] = life; a[o + 6] = size;
    a[o + 7] = Math.random() * TAU; a[o + 8] = (Math.random() - 0.5) * 9;
    a[o + 9] = type; a[o + 10] = hue; a[o + 11] = drag;
    return i;
  }

  /** Взрыв искр (укус, урон). */
  burst(x, y, count, hue, speed = 140, size = 3, type = P.SPARK) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.spawn(type, x, y, Math.cos(a) * s, Math.sin(a) * s,
        0.35 + Math.random() * 0.5, size * (0.6 + Math.random()), hue);
    }
  }

  /** Кольцевая волна (эволюция, сильный удар). */
  ring(x, y, hue, size = 30, life = 0.5) {
    this.spawn(P.RING, x, y, 0, 0, life, size, hue, 0);
  }

  /** Частица еды, втягиваемая ртом: летит к цели с ускорением. */
  absorb(x, y, tx, ty, hue, size = 4) {
    const i = this.spawn(P.ABSORB, x, y, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40,
      0.45, size, hue, 0.6);
    if (i >= 0) { this.tx[i] = tx; this.ty[i] = ty; }
  }

  /** Пузырьковый след ускорения. */
  trail(x, y, vx, vy) {
    this.spawn(P.BUBBLE, x, y, vx, vy, 0.6 + Math.random() * 0.5,
      1 + Math.random() * 2.4, 190, 1.4);
  }

  text(str, x, y, hue = 150) {
    if (this.tn >= this.textMax) return;
    const i = this.tn++, o = i * 5;
    this.tArr[o] = x; this.tArr[o + 1] = y;
    this.tArr[o + 2] = 1.1; this.tArr[o + 3] = 1.1; this.tArr[o + 4] = hue;
    this.tStr[i] = str;
  }

  update(dt, bg) {
    const a = this.a;
    for (let i = 0; i < this.n; i++) {
      const o = i * FIELDS;
      a[o + 4] -= dt;
      if (a[o + 4] <= 0) { this._kill(i); i--; continue; }

      const type = a[o + 9];
      if (type === P.ABSORB) {
        // Всасывание с ускорением к рту.
        const dx = this.tx[i] - a[o], dy = this.ty[i] - a[o + 1];
        const d = Math.hypot(dx, dy) || 1;
        const pull = 1400 / Math.max(24, d);
        a[o + 2] += (dx / d) * pull * dt * 9;
        a[o + 3] += (dy / d) * pull * dt * 9;
      } else if (type === P.BUBBLE) {
        a[o + 3] -= 26 * dt;                    // пузырьки всплывают
      } else if (bg && type !== P.RING) {
        const c = bg.current(a[o], a[o + 1]);   // частицы сносит течением
        a[o + 2] += c[0] * dt * 0.5;
        a[o + 3] += c[1] * dt * 0.5;
      }

      const dr = Math.exp(-a[o + 11] * dt);
      a[o + 2] *= dr; a[o + 3] *= dr;
      a[o] += a[o + 2] * dt;
      a[o + 1] += a[o + 3] * dt;
      a[o + 7] += a[o + 8] * dt;
    }

    for (let i = 0; i < this.tn; i++) {
      const o = i * 5;
      this.tArr[o + 2] -= dt;
      this.tArr[o + 1] -= 34 * dt;
      if (this.tArr[o + 2] <= 0) {
        const last = --this.tn, lo = last * 5;
        for (let k = 0; k < 5; k++) this.tArr[o + k] = this.tArr[lo + k];
        this.tStr[i] = this.tStr[last];
        i--;
      }
    }
  }

  _kill(i) {
    const last = --this.n;
    if (i !== last) {
      const o = i * FIELDS, lo = last * FIELDS;
      for (let k = 0; k < FIELDS; k++) this.a[o + k] = this.a[lo + k];
      this.tx[i] = this.tx[last]; this.ty[i] = this.ty[last];
    }
  }

  draw(ctx, view) {
    const a = this.a;
    ctx.save();
    for (let i = 0; i < this.n; i++) {
      const o = i * FIELDS;
      const x = a[o], y = a[o + 1];
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      const t = a[o + 4] / a[o + 5];
      const type = a[o + 9], hue = a[o + 10], size = a[o + 6];

      switch (type) {
        case P.RING: {
          const r = size * (1 + (1 - t) * 3.4);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = t * 0.8;
          ctx.strokeStyle = `hsl(${hue} 90% 74%)`;
          ctx.lineWidth = 2 + t * 5;
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case P.BUBBLE: {
          ctx.globalAlpha = t * 0.5;
          ctx.strokeStyle = 'hsl(190 70% 92%)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, size * (0.5 + t), 0, TAU); ctx.stroke();
          break;
        }
        case P.CHUNK: {
          ctx.globalAlpha = t;
          ctx.fillStyle = `hsl(${hue} 55% ${34 + t * 22}%)`;
          ctx.save();
          ctx.translate(x, y); ctx.rotate(a[o + 7]);
          ctx.beginPath();
          ctx.ellipse(0, 0, size * (0.6 + t * 0.6), size * 0.72, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case P.GOO: {
          ctx.globalAlpha = t * 0.7;
          ctx.fillStyle = `hsl(${hue} 80% 60%)`;
          ctx.beginPath(); ctx.arc(x, y, size * t, 0, TAU); ctx.fill();
          break;
        }
        default: { // SPARK, ABSORB
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = t;
          ctx.fillStyle = `hsl(${hue} 90% ${58 + t * 30}%)`;
          const r = size * (type === P.ABSORB ? t * 0.6 + 0.5 : t);
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Всплывающий текст.
    if (this.tn) {
      ctx.textAlign = 'center';
      ctx.font = '700 13px -apple-system, system-ui, sans-serif';
      for (let i = 0; i < this.tn; i++) {
        const o = i * 5;
        const t = this.tArr[o + 2] / this.tArr[o + 3];
        ctx.globalAlpha = clamp(t * 1.6, 0, 1);
        ctx.fillStyle = `hsl(${this.tArr[o + 4]} 90% 72%)`;
        ctx.fillText(this.tStr[i], this.tArr[o], this.tArr[o + 1]);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  clear() { this.n = 0; this.tn = 0; }
}
