// player.js — сборка тела из конфигурации и физика игрока.
// Тело: позвоночник + профиль толщины + список частей. Всё из seed.

import { Spine, Profile } from './spine.js';
import { creaturePalette, buildPalette } from './palette.js';
import { createPart, updatePart, PART } from './parts.js';
import { makeRng, clamp, lerp, lerpAngle, damp, TAU } from './rng.js';
import { computeStats } from './stats.js';

/**
 * Конфигурация тела — это и есть «геном»: то, что сохраняется и правится в редакторе.
 */
export function defaultConfig(seed = 1) {
  return {
    seed,
    segCount: 11,
    segLen: 9,
    halfWidth: 15,
    profile: [0.24, 0.78, 1.0, 0.93, 0.70, 0.42, 0.16],
    diet: 'herb',
    parts: [
      { type: PART.MOUTH_HERB, t: 0.04, side: 0, size: 0.8, rot: 0 },
      { type: PART.EYE, t: 0.17, side: 1, size: 0.62, rot: 0 },
      { type: PART.EYE, t: 0.17, side: -1, size: 0.62, rot: 0 },
      { type: PART.FIN, t: 0.46, side: 1, size: 0.9, rot: 0.25 },
      { type: PART.FIN, t: 0.46, side: -1, size: 0.9, rot: 0.25 },
      { type: PART.FLAGELLUM, t: 0.99, side: 0, size: 1.0, rot: 0 },
    ],
  };
}

/** Случайное существо из seed — «кнопка рандома» в редакторе и враги. */
export function randomConfig(seed) {
  const rng = makeRng(seed);
  const segCount = rng.int(8, 14);
  const carn = rng.chance(0.45);
  const prof = [];
  const bulge = rng.range(0.75, 1.15);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    prof.push(clamp(Math.sin(Math.pow(t, 0.75) * Math.PI) * bulge * rng.range(0.85, 1.15) + 0.12, 0.12, 1.25));
  }
  const parts = [
    { type: carn ? PART.MOUTH_CARN : PART.MOUTH_HERB, t: 0.04, side: 0, size: rng.range(0.6, 1.0), rot: 0 },
  ];
  const eyes = rng.int(1, 2);
  const et = rng.range(0.13, 0.26);
  for (let i = 0; i < eyes; i++) parts.push({ type: PART.EYE, t: et, side: i === 0 ? 1 : -1, size: rng.range(0.42, 0.8), rot: 0 });
  if (rng.chance(0.75)) {
    const ft = rng.range(0.35, 0.6), fs = rng.range(0.6, 1.2), fr = rng.range(0, 0.5);
    parts.push({ type: PART.FIN, t: ft, side: 1, size: fs, rot: fr });
    parts.push({ type: PART.FIN, t: ft, side: -1, size: fs, rot: fr });
  }
  const tails = rng.int(1, 3);
  for (let i = 0; i < tails; i++) {
    parts.push({ type: PART.FLAGELLUM, t: rng.range(0.88, 1), side: tails === 1 ? 0 : (i % 2 ? 1 : -1), size: rng.range(0.7, 1.3), rot: rng.range(-0.2, 0.2) });
  }
  if (rng.chance(0.35)) {
    const st = rng.range(0.3, 0.7), ss = rng.range(0.5, 1);
    parts.push({ type: PART.SPIKE, t: st, side: 1, size: ss, rot: 0 });
    parts.push({ type: PART.SPIKE, t: st, side: -1, size: ss, rot: 0 });
  }
  if (rng.chance(0.18)) parts.push({ type: PART.POISON, t: rng.range(0.5, 0.8), side: 0, size: rng.range(0.5, 0.9), rot: 0 });

  return {
    seed,
    segCount,
    segLen: rng.range(7, 12),
    halfWidth: rng.range(10, 20),
    profile: prof,
    diet: carn ? 'carn' : 'herb',
    parts,
  };
}

/**
 * Собирает «живое» тело из конфигурации: позвоночник, профиль, палитра, части.
 * Возвращаемый объект — то, что понимают render.js и parts.js.
 */
export function buildBody(cfg, x = 0, y = 0, angle = 0) {
  const spine = new Spine({
    count: cfg.segCount,
    segLen: (i, n) => cfg.segLen * (1 - (i / n) * 0.28),
    // Небольшой предел изгиба в суставе: тело гнётся дугой, а не сворачивается кольцом.
    bend: (i, n) => 0.11 + 0.07 * (i / n),
    follow: (i, n) => 1 - 0.35 * Math.pow(i / n, 1.5),
  });
  spine.place(x, y, angle);

  const body = {
    cfg,
    seed: cfg.seed,
    spine,
    profile: new Profile(cfg.profile),
    halfWidth: cfg.halfWidth,
    pal: creaturePalette(cfg.seed),
    parts: cfg.parts.map((p, i) => createPart(p.type, { ...p, seed: cfg.seed + i * 37 })),
    breathe: 1,
    squash: 1,
    bulge: 1,
    flash: 0,
    alpha: 1,
    speed01: 0,
    litSide: 1,
    lookX: undefined,
    lookY: undefined,
    x, y, angle,
  };
  return body;
}

/** Пересоздать части тела из конфигурации (после правок в редакторе). */
export function rebuildParts(body, cfg = body.cfg) {
  body.cfg = cfg;
  body.parts = cfg.parts.map((p, i) => createPart(p.type, { ...p, seed: body.seed + i * 37 }));
  body.profile = new Profile(cfg.profile);
}

export class Player {
  constructor(cfg, x, y) {
    this.cfg = cfg;
    this.body = buildBody(cfg, x, y, 0);
    this.stats = computeStats(cfg);
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.angle = 0;
    this.speed = 0;
    this.stamina = 1;
    this.boosting = false;
    this.hp = this.stats.maxHp;
    this.invuln = 0;
    this.dead = false;
    this.dyingT = -1;
    this.shakeT = 0;
    this.time = 0;
    this.attackCd = 0;
    this.dna = 0;
    this.growth = 0;        // прогресс до следующего уровня, 0..1
    this.level = 1;
    this.morph = null;      // анимация эволюции
  }

  get maxHp() { return this.stats.maxHp; }
  get mass() { return this.stats.mass; }
  get maxSpeed() { return this.stats.speed * 1.45; }
  get turnRate() { return this.stats.turn; }

  /** Точка рта в мире. */
  mouthAt(out) { this.body.spine.sample(0.03, out); return out; }

  /** Открыть рот (при укусе и поедании) — рисовалка сама отработает деформацию. */
  openMouth() {
    for (const p of this.body.parts) {
      if (p.type.startsWith('mouth')) p.open = 1;
    }
  }

  /**
   * Эволюция: тело плавно интерполируется из старой конфигурации в новую.
   * Части появляются сразу, но с пружинкой.
   */
  applyConfig(cfg, morphTime = 1.2) {
    const from = {
      halfWidth: this.body.halfWidth,
      segLen: this.cfg.segLen,
      profile: Array.from(this.body.profile.p),
    };
    this.cfg = cfg;
    this.stats = computeStats(cfg);
    this.hp = Math.min(this.hp + 1, this.stats.maxHp);
    rebuildParts(this.body, cfg);
    for (const p of this.body.parts) { p.spring = -0.45; p.springV = 0; }
    this.morph = { t: 0, dur: morphTime, from, to: { halfWidth: cfg.halfWidth, segLen: cfg.segLen, profile: cfg.profile.slice() } };
  }

  /** Физический шаг (фиксированный dt). target — точка в мировых координатах. */
  update(dt, target, wantBoost) {
    this.time += dt;
    const b = this.body;
    if (this.attackCd > 0) this.attackCd -= dt;

    // Плавное превращение тела при эволюции.
    if (this.morph) {
      const m = this.morph;
      m.t = Math.min(1, m.t + dt / m.dur);
      const k = m.t * m.t * (3 - 2 * m.t);
      b.halfWidth = lerp(m.from.halfWidth, m.to.halfWidth, k);
      const pf = b.profile.p;
      for (let i = 0; i < pf.length; i++) {
        pf[i] = lerp(m.from.profile[i] ?? 1, m.to.profile[i] ?? 1, k);
      }
      if (m.t >= 1) this.morph = null;
    }

    // --- Выносливость и ускорение ---
    this.boosting = !!wantBoost && this.stamina > 0.02 && !this.dead;
    if (this.boosting) this.stamina = Math.max(0, this.stamina - dt * 0.42);
    else this.stamina = Math.min(1, this.stamina + dt * 0.24);

    let desiredSpeed = 0;
    if (target && !this.dead) {
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      // Скорость зависит от расстояния до пальца: близко — почти стоим.
      const t = clamp((dist - 6) / 110, 0, 1);
      desiredSpeed = t * this.maxSpeed * (this.boosting ? 1.95 : 1);
      if (dist > 4) {
        const want = Math.atan2(dy, dx);
        // Поворотливость падает на большой скорости — инерция ощущается.
        const agility = this.turnRate * (0.55 + 0.45 * (1 - this.speed / this.maxSpeed));
        this.angle = lerpAngle(this.angle, want, damp(agility, dt));
      }
    }
    if (this.dead) desiredSpeed = 0;

    // Разгон быстрее торможения — «мышца» толкает, вода тормозит мягко.
    const accel = desiredSpeed > this.speed ? 3.4 : 2.0;
    this.speed = lerp(this.speed, desiredSpeed, damp(accel, dt));

    this.px = this.x; this.py = this.y;
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;

    // Дрожь от урона: затухающий шум по позиции.
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeT * this.shakeT * 26;
      sx = Math.sin(this.time * 61) * k;
      sy = Math.cos(this.time * 47) * k;
    }

    // --- Тело ---
    b.speed01 = clamp(this.speed / this.maxSpeed, 0, 1);
    spineStep(b, this.x + sx, this.y + sy, this.angle, dt);

    if (this.invuln > 0) this.invuln -= dt;
    b.flash = Math.max(0, b.flash - dt * 4);
    b.squash = lerp(b.squash, 1, damp(7, dt));

    // Дыхание в покое: пульсация 0.7 Гц, гаснет при быстром плавании.
    const breathe = 1 + Math.sin(this.time * TAU * 0.7) * 0.035 * (1 - b.speed01 * 0.8);
    b.breathe = breathe;

    updateBodyParts(b, dt, this.time);
  }

  /** Урон: вспышка, сжатие, дрожь, кратковременная потеря контроля. */
  hurt(amount) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - Math.max(0.2, amount - this.stats.def * 0.1));
    this.invuln = 0.8;
    this.body.flash = 1;
    this.body.squash = 0.72;
    this.shakeT = 0.35;
    this.speed *= 0.35;
    if (this.hp <= 0) this.die();
    return true;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.dyingT = 0;
  }

  /** Анимация смерти игрока: тело обмякает, теряет цвет и всплывает. */
  updateDying(dt) {
    this.dyingT += dt;
    const b = this.body, k = clamp(this.dyingT / 1.8, 0, 1);
    b.spine.soft = k;
    b.spine.relax = lerp(0.94, 1, k);
    b.alpha = 1 - k * 0.85;
    const step = Math.round(k * 6);
    if (step !== this._fadeStep) { this._fadeStep = step; b.pal = buildPalette(b.pal.params, step / 6); }
    b.speed01 = 0;
    this.speed = lerp(this.speed, 0, damp(2, dt));
    this.y -= (12 + k * 22) * dt;
    this.angle = lerpAngle(this.angle, -Math.PI / 2, damp(0.7, dt));
    spineStep(b, this.x, this.y, this.angle, dt);
    updateBodyParts(b, dt, this.time);
  }
}

/**
 * Общий шаг тела: решаем цепочку, двигаем волну плавания,
 * готовим координаты для крепления частей.
 */
export function spineStep(body, hx, hy, angle, dt) {
  const sp = body.spine;
  sp.savePrev();
  sp.solve(hx, hy, angle);
  sp.advanceWave(dt, body.speed01);
  // Координаты «здесь и сейчас» нужны частям для крепления.
  sp.buildRender(1, waveAmp(body), waveK(body), 0.10);
  body.x = hx; body.y = hy; body.angle = angle;
}

/** Амплитуда волны плавания зависит от скорости. */
export function waveAmp(body) {
  return body.halfWidth * (0.07 + body.speed01 * 0.34) * (body.dying !== undefined ? 0.4 : 1);
}

/**
 * Пространственная частота волны: примерно один период на длину тела.
 * Слишком высокая частота ломает обводку зигзагом.
 */
export function waveK(body) {
  return (Math.PI * 1.25) / (body.spine.n - 1);
}

export function updateBodyParts(body, dt, time) {
  for (let i = 0; i < body.parts.length; i++) updatePart(body.parts[i], body, dt, time);
}

/**
 * Подготовка координат к отрисовке: интерполяция между физическими кадрами
 * для тела и для всех цепочек-частей. Вызывается один раз за кадр.
 */
export function prepareRender(body, alpha) {
  body.spine.buildRender(alpha, waveAmp(body), waveK(body), 0.10);
  for (let i = 0; i < body.parts.length; i++) {
    const ch = body.parts[i].chain;
    if (ch) ch.buildRender(alpha, body.halfWidth * 0.16 * (0.35 + body.speed01), 0.62, 0.25);
  }
}
