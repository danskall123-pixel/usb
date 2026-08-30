// editor.js — редактор организма. Мир на паузе за размытым фоном,
// существо продолжает жить: дышит, шевелит жгутиками, следит за пальцем.

import { buildBody, rebuildParts, spineStep, updateBodyParts, prepareRender, randomConfig } from './player.js';
import { drawCreature, PART, CATALOG, anchor } from './parts.js';
import { computeStats, configCost, SHOWN } from './stats.js';
import { drawRing } from './render.js';
import { clamp, lerp, damp, TAU, makeRng } from './rng.js';

const TMP = [0, 0, 0];

/** Части, доступные по уровню роста. */
export const UNLOCKS = {
  1: [PART.EYE, PART.FLAGELLUM, PART.MOUTH_HERB],
  2: [PART.FIN, PART.MOUTH_CARN],
  3: [PART.SPIKE, PART.ARMOR],
  4: [PART.POISON, PART.MOUTH_OMNI],
  5: [PART.ELECTRO],
};

export function unlockedParts(level) {
  const out = [];
  for (let l = 1; l <= level; l++) out.push(...(UNLOCKS[l] || []));
  return out;
}

/** Точки крепления на теле: пары (t, side) вдоль позвоночника. */
function attachPoints(cfg) {
  const pts = [];
  for (let i = 1; i <= 7; i++) {
    const t = i / 8;
    pts.push({ t, side: 1 }, { t, side: -1 }, { t, side: 0 });
  }
  pts.push({ t: 0.04, side: 0 }, { t: 0.99, side: 0 });
  return pts;
}

export class Editor {
  constructor(canvas, i18n) {
    this.canvas = canvas;
    this.t = i18n;
    this.open = false;
    this.anim = 0;              // 0..1 — появление панели
    this.cfg = null;
    this.body = null;
    this.stats = null;
    this.prevStats = null;
    this.dna = 0;
    this.level = 1;
    this.time = 0;

    this.cam = { x: 0, y: 0, zoom: 1.7 };
    this.drag = null;           // текущее перетаскивание
    this.history = [];          // откат последнего действия
    this.deltas = [];           // всплывающие +3 / −1
    this.palette = [];          // доступные части в нижней панели
    this.selected = -1;
    this.preview = 0;           // режим «проплыть по экрану»
    this.onDone = null;
    this.symmetry = true;
    this.attach = [];
    this.hoverIdx = -1;
  }

  /** Открыть редактор с конфигурацией игрока. */
  start(cfg, dna, level, onDone) {
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.baseCfg = JSON.parse(JSON.stringify(cfg));
    this.dna = dna;
    this.level = level;
    this.onDone = onDone;
    this.open = true;
    this.anim = 0;
    this.time = 0;
    this.history.length = 0;
    this.deltas.length = 0;
    this.palette = unlockedParts(level);
    this.selected = -1;
    this.preview = 0;
    this.attach = attachPoints(this.cfg);
    this._rebuild(true);
    this.stats = computeStats(this.cfg);
    this.prevStats = { ...this.stats };
    this.cam.x = 0; this.cam.y = 0;
    this.cam.zoom = 1.7;
  }

  _rebuild(fresh = false) {
    if (fresh || !this.body) {
      this.body = buildBody(this.cfg, 0, 0, 0);
      this.body.spine.place(0, 0, 0);
    } else {
      rebuildParts(this.body, this.cfg);
      this.body.halfWidth = this.cfg.halfWidth;
    }
    this.body.speed01 = 0.12;
  }

  /** Снимок для отката. */
  _snapshot() {
    this.history.push(JSON.stringify(this.cfg));
    if (this.history.length > 24) this.history.shift();
  }

  undo() {
    const s = this.history.pop();
    if (!s) return;
    this.cfg = JSON.parse(s);
    this._rebuild();
    this._restat();
  }

  /** Пересчёт статов + всплывающие дельты. */
  _restat() {
    const next = computeStats(this.cfg);
    for (const k of SHOWN) {
      const d = next[k] - this.stats[k];
      if (Math.abs(d) > 0.05) {
        // Одна всплывашка на стат: повторные изменения обновляют её, а не наслаиваются.
        const ex = this.deltas.find((x) => x.key === k);
        if (ex) { ex.v += d; ex.life = 1.1; }
        else this.deltas.push({ key: k, v: d, life: 1.1 });
      }
    }
    this.prevStats = this.stats;
    this.stats = next;
  }

  randomize() {
    this._snapshot();
    const seed = (Math.random() * 1e9) | 0;
    const r = randomConfig(seed);
    // Размер оставляем свой — меняются только форма и части.
    r.halfWidth = this.cfg.halfWidth;
    r.segLen = this.cfg.segLen;
    r.segCount = this.cfg.segCount;
    r.seed = this.cfg.seed;
    r.parts = r.parts.filter((p) => this.palette.includes(p.type));
    this.cfg = r;
    this._rebuild(true);
    this._restat();
  }

  /** Экранные координаты -> мировые координаты редактора. */
  toWorld(sx, sy, W, H, out) {
    out.x = this.cam.x + (sx - W / 2) / this.cam.zoom;
    out.y = this.cam.y + (sy - H * 0.42) / this.cam.zoom;
    return out;
  }

  /** Обработка касаний: перетаскивание частей, ручки тела, pinch, панель. */
  handleInput(input, W, H) {
    const layout = this._layout(W, H);
    const touches = input.touches;

    // Pinch-zoom и панорамирование двумя пальцами.
    if (input.pinch.active) {
      this.cam.zoom = clamp(this.cam.zoom * (1 + input.pinch.ddist / 320), 0.7, 4);
      this.cam.x -= input.pinch.dcx / this.cam.zoom;
      this.cam.y -= input.pinch.dcy / this.cam.zoom;
      this.drag = null;
      return;
    }

    const tap = input.consumeTap();
    if (tap) this._tap(tap, layout, W, H);

    if (!touches.length) {
      if (this.drag) this._dropDrag();
      return;
    }

    const p = touches[0];
    const w = this.toWorld(p.x, p.y, W, H, { x: 0, y: 0 });

    if (!this.drag) {
      // Начало перетаскивания: часть тела, ручка длины/толщины или новая часть из панели.
      if (p.y > layout.panelY) return;         // тап по панели обработает _tap
      this._beginDrag(w, p);
    } else {
      this._moveDrag(w);
    }
  }

  _tap(tap, layout, W, H) {
    // Панель частей внизу.
    if (tap.y > layout.panelY) {
      const idx = Math.floor((tap.x - layout.padX) / layout.slot);
      if (idx >= 0 && idx < this.palette.length) {
        this.selected = this.selected === idx ? -1 : idx;
      }
      return;
    }
    // Кнопки сверху обрабатываются в ui.js через DOM.
  }

  _beginDrag(w, touch) {
    // 1) Ручка конца позвоночника — тянем длину тела.
    const sp = this.body.spine;
    const tailX = sp.rx[sp.n - 1], tailY = sp.ry[sp.n - 1];
    const grab = 26 / this.cam.zoom;

    if (Math.hypot(w.x - tailX, w.y - tailY) < grab) {
      this._snapshot();
      this.drag = { kind: 'length' };
      return;
    }

    // 2) Существующая часть.
    let best = -1, bestD = grab * 1.4;
    for (let i = 0; i < this.body.parts.length; i++) {
      anchor(this.body.parts[i], this.body, TMP);
      const d = Math.hypot(w.x - TMP[0], w.y - TMP[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      this._snapshot();
      this.drag = { kind: 'part', index: best, type: this.cfg.parts[best].type, from: { ...this.cfg.parts[best] } };
      return;
    }

    // 3) Новая часть из панели (если выбрана).
    if (this.selected >= 0) {
      const type = this.palette[this.selected];
      if (configCost(this.cfg) + CATALOG[type].cost <= this.dna) {
        this._snapshot();
        this.cfg.parts.push({ type, t: 0.5, side: 1, size: 0.8, rot: 0 });
        this._rebuild();
        this.drag = { kind: 'part', index: this.cfg.parts.length - 1, type, isNew: true };
      }
      return;
    }

    // 4) Тянем вбок по телу — меняем толщину профиля в этой точке.
    let bestT = -1, bestDist = 40 / this.cam.zoom;
    for (let i = 0; i < sp.n; i++) {
      const d = Math.hypot(w.x - sp.rx[i], w.y - sp.ry[i]);
      if (d < bestDist) { bestDist = d; bestT = i / (sp.n - 1); }
    }
    if (bestT >= 0) {
      this._snapshot();
      this.drag = { kind: 'width', t: bestT };
    }
  }

  _moveDrag(w) {
    const d = this.drag;
    const sp = this.body.spine;

    if (d.kind === 'length') {
      // Длина тела = расстояние от головы до пальца.
      const len = clamp(Math.hypot(w.x, w.y), 40, 190);
      this.cfg.segLen = len / (this.cfg.segCount - 1);
      this.body.spine.len.fill(0);
      for (let i = 0; i < sp.n; i++) sp.len[i] = this.cfg.segLen * (1 - (i / sp.n) * 0.28);
      this._restatThrottled();
      return;
    }

    if (d.kind === 'width') {
      // Толщина в точке: профиль — кривая, а не одно число.
      sp.sample(d.t, TMP);
      const dist = Math.hypot(w.x - TMP[0], w.y - TMP[1]);
      const k = clamp(dist / this.cfg.halfWidth, 0.12, 1.6);
      const pf = this.cfg.profile;
      const idx = clamp(Math.round(d.t * (pf.length - 1)), 0, pf.length - 1);
      pf[idx] = k;
      // Соседние точки тянутся мягче — профиль остаётся гладким.
      if (idx > 0) pf[idx - 1] = lerp(pf[idx - 1], k, 0.35);
      if (idx < pf.length - 1) pf[idx + 1] = lerp(pf[idx + 1], k, 0.35);
      this.body.profile.p.set(pf);
      this._restatThrottled();
      return;
    }

    if (d.kind === 'part') {
      // Часть «прилипает» к ближайшей валидной точке крепления.
      let best = null, bestD = Infinity;
      for (const a of this.attach) {
        sp.sample(a.t, TMP);
        const hw = this.cfg.halfWidth * this.body.profile.at(a.t);
        const ax = TMP[0] - Math.sin(TMP[2]) * hw * a.side * 0.9;
        const ay = TMP[1] + Math.cos(TMP[2]) * hw * a.side * 0.9;
        const dd = Math.hypot(w.x - ax, w.y - ay);
        if (dd < bestD) { bestD = dd; best = a; }
      }
      this.hoverIdx = -1;
      const part = this.cfg.parts[d.index];
      if (best && bestD < 70 / this.cam.zoom) {
        part.t = best.t;
        part.side = best.side;
        d.valid = true;
      } else {
        d.valid = false;
      }
      // Размер части — по удалению пальца от точки крепления.
      part.size = clamp(0.4 + bestD / (this.cfg.halfWidth * 3), 0.35, 1.7);
      this._syncPart(d.index);
      this._restatThrottled();
    }
  }

  /** Симметрия: зеркальная часть создаётся/двигается автоматически. */
  _syncPart(index) {
    const p = this.cfg.parts[index];
    if (!this.symmetry || p.side === 0) { this._rebuild(); return; }
    const mirrorIdx = this.cfg.parts.findIndex((o, i) =>
      i !== index && o.type === p.type && Math.abs(o.t - p.t) < 0.001 && o.side === -p.side);
    if (mirrorIdx >= 0) {
      const m = this.cfg.parts[mirrorIdx];
      m.t = p.t; m.size = p.size; m.rot = p.rot; m.side = -p.side;
    }
    this._rebuild();
  }

  _dropDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;

    if (d.kind === 'part') {
      const part = this.cfg.parts[d.index];
      if (!part) return;
      if (d.valid === false) {
        // Невалидное место: новая часть исчезает, старая возвращается назад.
        if (d.isNew) this.cfg.parts.splice(d.index, 1);
        else Object.assign(part, d.from);
        this._rebuild();
      } else {
        // Отдача при установке: пружинка масштаба.
        const bp = this.body.parts[d.index];
        if (bp) { bp.spring = -0.5; bp.springV = 0; }
        // Симметричная копия для парных частей.
        if (this.symmetry && part.side !== 0 && d.isNew) {
          const has = this.cfg.parts.some((o, i) => i !== d.index && o.type === part.type &&
            Math.abs(o.t - part.t) < 0.001 && o.side === -part.side);
          if (!has && configCost(this.cfg) + CATALOG[part.type].cost <= this.dna) {
            this.cfg.parts.push({ ...part, side: -part.side });
            this._rebuild();
          }
        }
      }
    }
    this._restat();
  }

  _restatThrottled() {
    this._statT = (this._statT || 0) + 1;
    if (this._statT % 6 === 0) this._restat();
  }

  /** Удалить выбранную часть двойным касанием (жест — долгое касание). */
  removePart(index) {
    if (index < 0 || index >= this.cfg.parts.length) return;
    this._snapshot();
    this.cfg.parts.splice(index, 1);
    this._rebuild();
    this._restat();
  }

  update(dt, input, W, H) {
    if (!this.open) return;
    this.time += dt;
    this.anim = Math.min(1, this.anim + dt * 3.4);

    this.handleInput(input, W, H);

    // Существо продолжает жить: дыхание, жгутики, взгляд за пальцем.
    const b = this.body;
    b.breathe = 1 + Math.sin(this.time * TAU * 0.75) * 0.045;
    b.speed01 = this.preview > 0 ? 0.7 : 0.14;

    if (input.touches.length) {
      const w = this.toWorld(input.touches[0].x, input.touches[0].y, W, H, { x: 0, y: 0 });
      b.lookX = w.x; b.lookY = w.y;
    } else { b.lookX = undefined; b.lookY = undefined; }

    if (this.preview > 0) {
      // Превью: существо проплывает по экрану с новыми статами.
      this.preview -= dt;
      const st = this.stats;
      // Существо проплывает поперёк экрана: границы считаем от масштаба камеры.
      const half = W / 2 / this.cam.zoom + 60;
      this.previewX = (this.previewX ?? -half) + st.speed * dt * 1.2;
      const y = Math.sin(this.time * 1.6) * 26;
      const ang = Math.atan2(Math.cos(this.time * 1.6) * 26 * 1.6, st.speed * 1.2);
      spineStep(b, this.previewX, y, ang, dt);
      if (this.previewX > half) this.previewX = -half;
    } else {
      this.previewX = undefined;
      spineStep(b, 0, 0, 0, dt);
    }
    updateBodyParts(b, dt, this.time);

    for (let i = this.deltas.length - 1; i >= 0; i--) {
      this.deltas[i].life -= dt;
      if (this.deltas[i].life <= 0) this.deltas.splice(i, 1);
    }
  }

  _layout(W, H) {
    const panelH = 92;
    return {
      panelY: H - panelH - 18,
      panelH,
      padX: 14,
      slot: Math.min(74, (W - 28) / Math.max(1, this.palette.length)),
    };
  }

  /** Отрисовка редактора поверх размытого мира. */
  draw(ctx, W, H, alpha) {
    if (!this.open) return;
    const L = this._layout(W, H);
    const a = this.anim;

    // Затемнение мира.
    ctx.save();
    ctx.fillStyle = `hsl(196 45% 5% / ${0.55 * a})`;
    ctx.fillRect(0, 0, W, H);

    // Сцена редактора.
    ctx.save();
    ctx.translate(W / 2, H * 0.42);
    ctx.scale(this.cam.zoom * (0.94 + a * 0.06), this.cam.zoom * (0.94 + a * 0.06));
    ctx.translate(-this.cam.x, -this.cam.y);

    // Точки крепления подсвечиваются во время перетаскивания.
    if (this.drag && this.drag.kind === 'part') {
      const sp = this.body.spine;
      for (const at of this.attach) {
        sp.sample(at.t, TMP);
        const hw = this.cfg.halfWidth * this.body.profile.at(at.t);
        const x = TMP[0] - Math.sin(TMP[2]) * hw * at.side * 0.9;
        const y = TMP[1] + Math.cos(TMP[2]) * hw * at.side * 0.9;
        const cur = this.cfg.parts[this.drag.index];
        const on = cur && Math.abs(cur.t - at.t) < 0.001 && cur.side === at.side;
        ctx.beginPath();
        ctx.arc(x, y, on ? 6 : 3.2, 0, TAU);
        ctx.fillStyle = on ? 'hsl(160 90% 62% / .95)' : 'hsl(186 80% 70% / .35)';
        ctx.fill();
      }
    }

    prepareRender(this.body, alpha);
    drawCreature(ctx, this.body, 2);

    // Ручка длины на хвосте (в превью инструменты прячем).
    const sp = this.body.spine;
    const hx = sp.rx[sp.n - 1], hy = sp.ry[sp.n - 1];
    if (this.preview <= 0) {
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, TAU);
    ctx.fillStyle = 'hsl(186 90% 70% / .25)';
    ctx.fill();
    ctx.strokeStyle = 'hsl(186 90% 78% / .8)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    }

    // Ось симметрии.
    if (this.symmetry && this.preview <= 0) {
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'hsl(186 60% 80% / .18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sp.rx[0] + 30, sp.ry[0]);
      ctx.lineTo(hx - 20, hy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // --- Панель статов ---
    this._drawStats(ctx, W, H, a);

    // --- Панель частей ---
    this._drawPalette(ctx, W, H, L, a);
    ctx.restore();
  }

  _drawStats(ctx, W, H, a) {
    const x = 14, y = 148 + (1 - a) * 12;
    const rows = SHOWN;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';

    for (let i = 0; i < rows.length; i++) {
      const k = rows[i];
      const yy = y + i * 20;
      ctx.fillStyle = 'hsl(186 40% 88% / .7)';
      ctx.fillText(this.t(k), x, yy);

      // Полоска стата — анимируется, а не прыгает.
      const v = this.stats[k];
      const max = k === 'speed' ? 190 : k === 'maxHp' ? 30 : 24;
      this._bars = this._bars || {};
      this._bars[k] = lerp(this._bars[k] ?? v, v, 0.15);
      const w = clamp(this._bars[k] / max, 0, 1) * 84;
      ctx.fillStyle = 'hsl(196 45% 10% / .8)';
      ctx.fillRect(x + 78, yy - 8, 84, 7);
      const g = ctx.createLinearGradient(x + 78, 0, x + 162, 0);
      g.addColorStop(0, 'hsl(160 80% 46%)');
      g.addColorStop(1, 'hsl(186 90% 62%)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 78, yy - 8, w, 7);
    }

    // Всплывающие дельты.
    ctx.textAlign = 'left';
    for (const d of this.deltas) {
      const i = rows.indexOf(d.key);
      if (i < 0) continue;
      const yy = y + i * 20 - (1.1 - d.life) * 16;
      ctx.globalAlpha = a * clamp(d.life, 0, 1);
      ctx.fillStyle = d.v > 0 ? 'hsl(150 85% 62%)' : 'hsl(2 85% 66%)';
      ctx.fillText((d.v > 0 ? '+' : '') + d.v.toFixed(1), 170, yy);
    }
    ctx.restore();
  }

  _drawPalette(ctx, W, H, L, a) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - a) * 40);

    // Подложка панели.
    const py = L.panelY;
    ctx.fillStyle = 'hsl(196 45% 7% / .78)';
    roundRect(ctx, 8, py, W - 16, L.panelH, 16);
    ctx.fill();
    ctx.strokeStyle = 'hsl(186 60% 70% / .18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < this.palette.length; i++) {
      const type = this.palette[i];
      const cx = L.padX + L.slot * i + L.slot / 2;
      const cy = py + L.panelH / 2 - 6;
      const sel = i === this.selected;
      const afford = configCost(this.cfg) + CATALOG[type].cost <= this.dna;

      ctx.save();
      ctx.globalAlpha = a * (afford ? 1 : 0.35);
      if (sel) {
        ctx.fillStyle = 'hsl(160 80% 50% / .18)';
        roundRect(ctx, cx - L.slot / 2 + 4, py + 6, L.slot - 8, L.panelH - 12, 12);
        ctx.fill();
      }
      // Иконка части рисуется той же процедурной графикой, что и в игре.
      drawPartIcon(ctx, type, cx, cy, 15, this.body.pal, this.time);

      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = 'hsl(186 40% 90%)';
      ctx.font = '600 9px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.t(type), cx, py + L.panelH - 16);
      ctx.fillStyle = 'hsl(160 80% 62%)';
      ctx.fillText(CATALOG[type].cost + '', cx, py + L.panelH - 5);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** Скруглённый прямоугольник (roundRect есть не везде в iOS 16). */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Иконка части для панели — маленькая процедурная зарисовка,
 * а не картинка: тот же код рисования, что и на теле.
 */
export function drawPartIcon(ctx, type, x, y, s, pal, time) {
  ctx.save();
  ctx.translate(x, y);
  switch (type) {
    case PART.EYE: {
      ctx.fillStyle = 'hsl(0 0% 96%)';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.62, 0, TAU); ctx.fill();
      const px = Math.cos(time * 1.2) * s * 0.2, py = Math.sin(time * 0.9) * s * 0.14;
      ctx.fillStyle = pal.accentDeep;
      ctx.beginPath(); ctx.arc(px, py, s * 0.32, 0, TAU); ctx.fill();
      ctx.fillStyle = 'hsl(0 0% 8%)';
      ctx.beginPath(); ctx.arc(px, py, s * 0.17, 0, TAU); ctx.fill();
      break;
    }
    case PART.FLAGELLUM: {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = s * 0.22; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const px = -s * 0.8 + t * s * 1.7;
        const py = Math.sin(t * 5 + time * 4) * s * 0.32 * t;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      break;
    }
    case PART.FIN: {
      const g = ctx.createLinearGradient(-s, 0, s, 0);
      g.addColorStop(0, pal.membrane); g.addColorStop(1, pal.accent);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, s * 0.5);
      ctx.quadraticCurveTo(0, -s * 0.9, s * 0.8, -s * 0.1);
      ctx.quadraticCurveTo(s * 0.1, s * 0.3, -s * 0.7, s * 0.5);
      ctx.fill();
      break;
    }
    case PART.SPIKE: {
      const g = ctx.createLinearGradient(0, s, 0, -s);
      g.addColorStop(0, pal.accentDeep); g.addColorStop(1, 'hsl(40 25% 92%)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, s * 0.6);
      ctx.quadraticCurveTo(0, -s * 0.2, 0, -s * 0.8);
      ctx.quadraticCurveTo(0, -s * 0.2, s * 0.34, s * 0.6);
      ctx.closePath(); ctx.fill();
      break;
    }
    case PART.ARMOR: {
      const g = ctx.createLinearGradient(0, -s, 0, s);
      g.addColorStop(0, pal.light); g.addColorStop(0.5, pal.accentDeep); g.addColorStop(1, pal.deep);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.78, 0, 0, TAU); ctx.fill();
      break;
    }
    case PART.POISON: {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, s * 0.1, 0, 0, s);
      g.addColorStop(0, pal.glow); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = pal.glow;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.45 * (1 + Math.sin(time * 3) * 0.08), 0, TAU); ctx.fill();
      break;
    }
    case PART.ELECTRO: {
      ctx.fillStyle = 'hsl(196 100% 72%)';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'hsl(190 100% 84%)';
      ctx.lineWidth = s * 0.12;
      const rng = makeRng(((time * 6) | 0) + 3);
      ctx.beginPath();
      for (let b = 0; b < 3; b++) {
        let ang = rng.range(0, TAU), px = 0, py = 0;
        ctx.moveTo(0, 0);
        for (let i = 0; i < 3; i++) {
          ang += rng.range(-0.9, 0.9);
          px += Math.cos(ang) * s * 0.4; py += Math.sin(ang) * s * 0.4;
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      break;
    }
    default: { // рты
      const carn = type === PART.MOUTH_CARN, omni = type === PART.MOUTH_OMNI;
      ctx.fillStyle = pal.mid;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.72, s * 0.6, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(0, 0, s * 0.05, 0, 0, s * 0.6);
      g.addColorStop(0, 'hsl(350 55% 34%)'); g.addColorStop(1, 'hsl(348 45% 12%)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.56, s * 0.44, 0, 0, TAU); ctx.fill();
      if (carn || omni) {
        ctx.fillStyle = 'hsl(45 25% 93%)';
        const n = carn ? 7 : 5;
        for (let i = 0; i < n; i++) {
          const a2 = (i / n) * TAU;
          const cx = Math.cos(a2) * s * 0.56, cy = Math.sin(a2) * s * 0.44;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a2 + 0.5) * s * 0.1, cy + Math.sin(a2 + 0.5) * s * 0.1);
          ctx.lineTo(cx - Math.cos(a2) * s * 0.22, cy - Math.sin(a2) * s * 0.22);
          ctx.lineTo(cx + Math.cos(a2 - 0.5) * s * 0.1, cy + Math.sin(a2 - 0.5) * s * 0.1);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = pal.light;
        ctx.lineWidth = s * 0.08; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a2 = (i / 8) * TAU;
          const w = Math.sin(time * 2 + i) * 0.3;
          const cx = Math.cos(a2) * s * 0.62, cy = Math.sin(a2) * s * 0.5;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a2 + w) * s * 0.2, cy + Math.sin(a2 + w) * s * 0.2);
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
