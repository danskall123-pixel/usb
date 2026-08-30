// spine.js — позвоночник существа: цепочка сегментов с ограничением угла
// (follow-the-leader constraint chain) + бегущая волна плавания.
// Здесь нет ни одного «кадра анимации» — только математика.

import { clamp, wrapAngle, lerp, lerpAngle, TAU } from './rng.js';

export class Spine {
  /**
   * @param {object} o
   * @param {number} o.count      — число узлов (8..14 для тела, больше для жгутиков)
   * @param {number|function} o.segLen — длина сегмента (число или f(i,n))
   * @param {number|function} o.bend   — предельный изгиб в суставе, радианы
   * @param {number|function} o.follow — инерция угла 0..1 (1 = жёстко, 0.25 = хлыст)
   */
  constructor({ count = 10, segLen = 12, bend = 0.42, follow = 1 }) {
    const n = this.n = Math.max(2, count | 0);
    this.len = new Float32Array(n);
    this.maxBend = new Float32Array(n);
    this.follow = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      this.len[i] = typeof segLen === 'function' ? segLen(i, n) : segLen;
      this.maxBend[i] = typeof bend === 'function' ? bend(i, n) : bend;
      this.follow[i] = typeof follow === 'function' ? follow(i, n) : follow;
    }

    // Физическое состояние (обновляется в fixed timestep).
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.a = new Float32Array(n);
    // Предыдущее состояние — для интерполяции при отрисовке.
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pa = new Float32Array(n);
    // Координаты для рендера: интерполяция + волна плавания.
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    this.ra = new Float32Array(n);

    this.relax = 0.94;    // сила распрямления цепочки (1 = не распрямлять)
    this.soft = 0;        // 0 = живой, 1 = обмякшее тело (смерть)
    this.phase = 0;       // фаза волны плавания
  }

  /** Полная длина цепочки. */
  totalLength() {
    let s = 0;
    for (let i = 1; i < this.n; i++) s += this.len[i];
    return s;
  }

  /** Расставить цепочку прямой линией из точки (x,y) в направлении angle. */
  place(x, y, angle) {
    const { n } = this;
    for (let i = 0; i < n; i++) {
      this.a[i] = angle;
      this.x[i] = x - Math.cos(angle) * this.len[i] * i;
      this.y[i] = y - Math.sin(angle) * this.len[i] * i;
    }
    this.savePrev();
    this.buildRender(1, 0, 0, 0);
  }

  /** Запомнить состояние перед физическим шагом. */
  savePrev() {
    this.px.set(this.x);
    this.py.set(this.y);
    this.pa.set(this.a);
  }

  /**
   * Главный решатель. Голова ставится извне (физика существа),
   * остальные узлы подтягиваются с ограничением угла.
   */
  solve(hx, hy, ha) {
    const { n, x, y, a, len, maxBend, follow, soft } = this;
    x[0] = hx; y[0] = hy; a[0] = ha;

    // При «обмякании» сустав становится свободнее, а инерция — больше.
    const bendMul = 1 + soft * 2.2;
    const followMul = 1 - soft * 0.72;

    for (let i = 1; i < n; i++) {
      // Текущее направление сегмента «вперёд» (от узла i к узлу i-1).
      const bx = x[i] - x[i - 1];
      const by = y[i] - y[i - 1];
      let dir = Math.atan2(-by, -bx);
      if (!(bx || by)) dir = a[i - 1];

      // Ограничение изгиба относительно родительского сегмента.
      const limit = maxBend[i] * bendMul;
      let d = clamp(wrapAngle(dir - a[i - 1]), -limit, limit);
      // Лёгкое распрямление: накопленная кривизна сама уходит, тело не сворачивается кольцом.
      const target = a[i - 1] + d * this.relax;

      // Инерция угла: сегмент догоняет цель не мгновенно — отсюда хлыст хвоста.
      const f = clamp(follow[i] * followMul, 0.04, 1);
      let ang = lerpAngle(a[i], target, f);

      // После инерции повторно зажимаем в допуск, чтобы тело не «выворачивалось».
      ang = a[i - 1] + clamp(wrapAngle(ang - a[i - 1]), -limit, limit);

      a[i] = ang;
      x[i] = x[i - 1] - Math.cos(ang) * len[i];
      y[i] = y[i - 1] - Math.sin(ang) * len[i];
    }
  }

  /**
   * Собирает координаты для отрисовки: интерполяция между физ. кадрами
   * + поперечная синусоида (волна плавания), амплитуда растёт к хвосту.
   * @param {number} alpha — доля между px и x
   * @param {number} amp   — амплитуда волны в пикселях
   * @param {number} k     — пространственная частота (радиан на сегмент)
   * @param {number} headAmp — доля амплитуды у головы (0.1..0.3 — как у рыбы)
   */
  buildRender(alpha, amp, k, headAmp = 0.15) {
    const { n, rx, ry, ra, x, y, px, py, a, pa, phase } = this;

    for (let i = 0; i < n; i++) {
      const ix = lerp(px[i], x[i], alpha);
      const iy = lerp(py[i], y[i], alpha);
      const ia = lerpAngle(pa[i], a[i], alpha);

      // Огибающая амплитуды: минимум у головы, максимум у хвоста.
      const t = i / (n - 1);
      const env = headAmp + (1 - headAmp) * t * t * (3 - 2 * t);
      const off = amp * env * Math.sin(k * i - phase);

      // Смещение по нормали к сегменту.
      rx[i] = ix - Math.sin(ia) * off;
      ry[i] = iy + Math.cos(ia) * off;
      ra[i] = ia;
    }

    // Углы пересчитываем по фактической (уже изогнутой волной) линии —
    // иначе обводка тела «съезжает» с осевой.
    for (let i = 0; i < n; i++) {
      const i0 = i === 0 ? 0 : i - 1;
      const i1 = i === n - 1 ? n - 1 : i + 1;
      ra[i] = Math.atan2(ry[i0] - ry[i1], rx[i0] - rx[i1]);
    }
  }

  /** Продвинуть фазу волны. speed01 — нормированная скорость 0..1. */
  advanceWave(dt, speed01) {
    this.phase = (this.phase + dt * (5.0 + speed01 * 13.0)) % TAU;
  }

  /**
   * Точка крепления на теле: t в [0,1] вдоль позвоночника.
   * out = [x, y, angle]. Без аллокаций.
   */
  sample(t, out) {
    const { n, rx, ry, ra } = this;
    const f = clamp(t, 0, 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const k = f - i;
    out[0] = lerp(rx[i], rx[i + 1], k);
    out[1] = lerp(ry[i], ry[i + 1], k);
    out[2] = lerpAngle(ra[i], ra[i + 1], k);
    return out;
  }
}

/**
 * Профиль толщины тела: набор контрольных точек 0..1, интерполяция catmull-rom.
 * Это не одно число, а кривая — её и правит игрок в редакторе.
 */
export class Profile {
  constructor(points) {
    this.p = Float32Array.from(points); // например [0.35, 0.9, 1, 0.8, 0.45, 0.15]
  }

  /** Толщина в точке t ∈ [0,1] (множитель к базовой полуширине). */
  at(t) {
    const p = this.p, m = p.length - 1;
    const f = clamp(t, 0, 1) * m;
    const i = Math.floor(f);
    const k = f - i;
    const g = (j) => p[clamp(j, 0, m)];
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    const k2 = k * k, k3 = k2 * k;
    return 0.5 * ((2 * p1) + (-p0 + p2) * k +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
  }

  clone() { return new Profile(Array.from(this.p)); }
}
