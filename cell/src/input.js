// input.js — только тач (плюс мышь для отладки на десктопе).
// Два режима: «плыть к пальцу» и виртуальный джойстик.
// Второй палец — ускорение. Скролл, bounce и двойной тап-зум подавлены.

import { clamp } from './rng.js';

export class Input {
  constructor(el) {
    this.el = el;
    this.mode = 'follow';          // 'follow' | 'joystick'
    this.touches = [];             // [{id, x, y, sx, sy, t0}]
    this.active = false;           // есть ли управляющее касание
    this.x = 0; this.y = 0;        // управляющая точка, CSS-пиксели
    this.boost = false;
    this.tap = null;               // одиночное касание для UI/редактора
    this.stick = { active: false, ox: 0, oy: 0, dx: 0, dy: 0, mag: 0 };
    this.pinch = { active: false, dist: 0, cx: 0, cy: 0, ddist: 0, dcx: 0, dcy: 0 };
    this.onFirstTouch = null;      // колбэк: разблокировка AudioContext

    const opt = { passive: false };
    el.addEventListener('touchstart', (e) => this._start(e), opt);
    el.addEventListener('touchmove', (e) => this._move(e), opt);
    el.addEventListener('touchend', (e) => this._end(e), opt);
    el.addEventListener('touchcancel', (e) => this._end(e), opt);

    // Мышь — только чтобы удобно отлаживать в десктопном браузере.
    el.addEventListener('mousedown', (e) => this._mouse(e, 'start'));
    window.addEventListener('mousemove', (e) => this._mouse(e, 'move'));
    window.addEventListener('mouseup', (e) => this._mouse(e, 'end'));
    this._keyBoost = false;
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') this._keyBoost = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this._keyBoost = false; });

    // Гасим системные жесты Safari.
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opt);
    document.addEventListener('gesturechange', (e) => e.preventDefault(), opt);
    document.addEventListener('dblclick', (e) => e.preventDefault(), opt);
  }

  _rect() { return this.el.getBoundingClientRect(); }

  _unlock() {
    if (this.onFirstTouch) { const cb = this.onFirstTouch; this.onFirstTouch = null; cb(); }
  }

  _start(e) {
    e.preventDefault();
    this._unlock();
    const r = this._rect();
    for (const t of e.changedTouches) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      this.touches.push({ id: t.identifier, x, y, sx: x, sy: y, t0: performance.now() });
    }
    this._sync(true);
  }

  _move(e) {
    e.preventDefault();
    const r = this._rect();
    for (const t of e.changedTouches) {
      const rec = this.touches.find((p) => p.id === t.identifier);
      if (rec) { rec.x = t.clientX - r.left; rec.y = t.clientY - r.top; }
    }
    this._sync(false);
  }

  _end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const i = this.touches.findIndex((p) => p.id === t.identifier);
      if (i < 0) continue;
      const rec = this.touches[i];
      const dt = performance.now() - rec.t0;
      const moved = Math.hypot(rec.x - rec.sx, rec.y - rec.sy);
      if (dt < 260 && moved < 14) this.tap = { x: rec.x, y: rec.y };
      this.touches.splice(i, 1);
    }
    this._sync(false);
  }

  _mouse(e, kind) {
    if (kind === 'start') this._unlock();
    const r = this._rect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (kind === 'start') this.touches = [{ id: -1, x, y, sx: x, sy: y, t0: performance.now() }];
    else if (kind === 'move' && this.touches.length) { this.touches[0].x = x; this.touches[0].y = y; }
    else if (kind === 'end') {
      if (this.touches.length) {
        const rec = this.touches[0];
        if (performance.now() - rec.t0 < 260 && Math.hypot(x - rec.sx, y - rec.sy) < 14) this.tap = { x, y };
      }
      this.touches = [];
    }
    this._sync(kind === 'start');
  }

  /** Пересобирает производное состояние из списка касаний. */
  _sync(isStart) {
    const n = this.touches.length;
    this.active = n > 0;

    if (this.mode === 'joystick') {
      const s = this.stick;
      if (n > 0) {
        const t = this.touches[0];
        if (isStart || !s.active) { s.ox = t.sx; s.oy = t.sy; s.active = true; }
        const dx = t.x - s.ox, dy = t.y - s.oy;
        const mag = Math.hypot(dx, dy);
        const max = 68;
        s.mag = clamp(mag / max, 0, 1);
        s.dx = mag > 0.001 ? dx / mag : 0;
        s.dy = mag > 0.001 ? dy / mag : 0;
      } else { s.active = false; s.mag = 0; }
      this.active = s.active && s.mag > 0.08;
    } else if (n > 0) {
      this.x = this.touches[0].x;
      this.y = this.touches[0].y;
    }

    // Ускорение — второй палец (или пробел при отладке).
    this.boost = n >= 2 || this._keyBoost;

    // Pinch — для камеры редактора.
    const p = this.pinch;
    if (n >= 2) {
      const [a, b] = this.touches;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (!p.active) { p.active = true; p.dist = dist; p.cx = cx; p.cy = cy; }
      p.ddist = dist - p.dist; p.dcx = cx - p.cx; p.dcy = cy - p.cy;
      p.dist = dist; p.cx = cx; p.cy = cy;
    } else if (p.active) { p.active = false; p.ddist = 0; p.dcx = 0; p.dcy = 0; }
  }

  /** Забрать и сбросить одиночный тап. */
  consumeTap() { const t = this.tap; this.tap = null; return t; }
}

/** Полностью отключает прокрутку/оттяжку страницы в Safari. */
export function lockViewport() {
  const stop = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', stop, { passive: false });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}
