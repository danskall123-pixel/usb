// creature.js — существо мира: тело + ИИ (блуждание, преследование,
// бегство, стайное поведение boids) + урон, поедание и смерть.

import { buildBody, spineStep, updateBodyParts, waveAmp } from './player.js';
import { computeStats } from './stats.js';
import { buildPalette } from './palette.js';
import { makeNoise } from './noise.js';
import { clamp, lerp, lerpAngle, damp, makeRng, TAU } from './rng.js';

const AI = { WANDER: 0, CHASE: 1, FLEE: 2, SCHOOL: 3 };
const aiNoise = makeNoise(555);

export class Creature {
  constructor(cfg, x, y, angle = 0) {
    this.reset(cfg, x, y, angle);
  }

  reset(cfg, x, y, angle = 0) {
    this.cfg = cfg;
    this.body = buildBody(cfg, x, y, angle);
    this.stats = computeStats(cfg);
    this.x = x; this.y = y;
    this.angle = angle;
    this.speed = 0;
    this.hp = this.stats.maxHp;
    this.alive = true;
    this.dying = -1;              // >=0 — идёт анимация смерти
    this.invuln = 0;
    this.state = AI.WANDER;
    this.think = Math.random() * 0.3;
    this.target = null;
    this.t = Math.random() * 1000;
    this.seed = cfg.seed;
    this.rng = makeRng(cfg.seed ^ 77);
    this.wanderBase = Math.random() * TAU;
    this.eatCd = 0;
    this.attackCd = 0;
    // Радиус для столкновений и «съедобности».
    this.radius = cfg.halfWidth * 1.05;
    this.mass = this.stats.mass;
    this.carn = this.stats.carn > 0;
    return this;
  }

  /** Точка рта в мире (для укуса и всасывания еды). */
  mouth(out) {
    this.body.spine.sample(0.03, out);
    return out;
  }

  /**
   * Шаг ИИ и физики.
   * world: { player, creatures, foods, bg, particles, fx }
   */
  update(dt, world) {
    this.t += dt;
    const b = this.body;

    if (this.dying >= 0) return this._updateDying(dt, world);

    // --- Решение раз в ~0.3 с (разнесено по кадрам) ---
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.22 + this.rng.next() * 0.2;
      this._decide(world);
    }

    // --- Желаемое направление по состоянию ---
    let wantAngle = this.angle;
    let wantSpeed = this.stats.speed * 0.42;

    switch (this.state) {
      case AI.CHASE:
        if (this.target && this.target.alive !== false) {
          wantAngle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
          wantSpeed = this.stats.speed;
        } else this.state = AI.WANDER;
        break;
      case AI.FLEE:
        if (this.target) {
          wantAngle = Math.atan2(this.y - this.target.y, this.x - this.target.x);
          wantSpeed = this.stats.speed * 1.15;
        } else this.state = AI.WANDER;
        break;
      case AI.SCHOOL: {
        const v = boids(this, world.creatures, this._bv || (this._bv = [0, 0]));
        if (v[0] || v[1]) {
          wantAngle = Math.atan2(v[1], v[0]);
          wantSpeed = this.stats.speed * 0.72;
        }
        break;
      }
      default: {
        // Блуждание по шуму — плавные, «живые» траектории.
        const n = aiNoise.fbmS2(this.seed * 0.07, this.t * 0.09, 2);
        wantAngle = this.wanderBase + n * Math.PI * 1.6;
        wantSpeed = this.stats.speed * 0.4;
      }
    }

    // Мягкий разворот на границе мира — существа не уплывают в бесконечность.
    const homeR = world.worldRadius || 2600;
    const dh = Math.hypot(this.x, this.y);
    if (dh > homeR) wantAngle = Math.atan2(-this.y, -this.x);

    const agility = this.stats.turn * (0.6 + 0.4 * (1 - this.speed / this.stats.speed));
    this.angle = lerpAngle(this.angle, wantAngle, damp(agility, dt));
    this.speed = lerp(this.speed, wantSpeed, damp(wantSpeed > this.speed ? 2.6 : 1.8, dt));

    // Течение слегка сносит.
    let cx = 0, cy = 0;
    if (world.bg) { const c = world.bg.current(this.x, this.y); cx = c[0] * 0.35; cy = c[1] * 0.35; }

    this.x += (Math.cos(this.angle) * this.speed + cx) * dt;
    this.y += (Math.sin(this.angle) * this.speed + cy) * dt;

    b.speed01 = clamp(this.speed / this.stats.speed, 0, 1);
    b.breathe = 1 + Math.sin(this.t * TAU * 0.65) * 0.035 * (1 - b.speed01 * 0.7);
    b.flash = Math.max(0, b.flash - dt * 4);
    b.squash = lerp(b.squash, 1, damp(7, dt));
    if (this.invuln > 0) this.invuln -= dt;
    if (this.eatCd > 0) this.eatCd -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;

    // Взгляд — на цель, иначе вперёд.
    if (this.target) { b.lookX = this.target.x; b.lookY = this.target.y; }
    else { b.lookX = undefined; b.lookY = undefined; }

    spineStep(b, this.x, this.y, this.angle, dt);
    updateBodyParts(b, dt, this.t);
  }

  /** Выбор поведения: угроза важнее добычи, добыча важнее стаи. */
  _decide(world) {
    const sense = this.stats.sense;
    let threat = null, threatD = Infinity;
    let prey = null, preyD = Infinity;

    const consider = (o, oMass) => {
      const dx = o.x - this.x, dy = o.y - this.y;
      const d = dx * dx + dy * dy;
      if (d > sense * sense) return;
      if (oMass > this.mass * 1.25) { if (d < threatD) { threatD = d; threat = o; } }
      else if (this.carn && oMass < this.mass * 0.8) { if (d < preyD) { preyD = d; prey = o; } }
    };

    const p = world.player;
    if (p && !p.dead) consider(p, p.mass);
    for (const c of world.creatures) {
      if (c === this || !c.alive || c.dying >= 0) continue;
      consider(c, c.mass);
    }

    // Травоядные ищут еду.
    if (!prey && !this.carn && world.foods) {
      for (const f of world.foods) {
        if (!f.alive) continue;
        const dx = f.x - this.x, dy = f.y - this.y;
        const d = dx * dx + dy * dy;
        if (d < sense * sense && d < preyD) { preyD = d; prey = f; }
      }
    }

    if (threat) { this.state = AI.FLEE; this.target = threat; }
    else if (prey) { this.state = AI.CHASE; this.target = prey; }
    else if (this.rng.chance(0.5)) { this.state = AI.SCHOOL; this.target = null; }
    else { this.state = AI.WANDER; this.target = null; }
  }

  /** Урон: вспышка, сжатие, отброс. */
  hurt(amount, fromX, fromY, world) {
    if (this.invuln > 0 || this.dying >= 0) return false;
    const dmg = Math.max(0.2, amount - this.stats.def * 0.12);
    this.hp -= dmg;
    this.invuln = 0.8;
    this.body.flash = 1;
    this.body.squash = 0.74;
    if (fromX !== undefined) {
      const a = Math.atan2(this.y - fromY, this.x - fromX);
      this.x += Math.cos(a) * 6; this.y += Math.sin(a) * 6;
      this.angle = lerpAngle(this.angle, a, 0.5);
    }
    if (world?.particles) {
      world.particles.burst(this.x, this.y, 8, this.body.pal.h, 160, 2.6);
    }
    if (this.hp <= 0) { this.die(world); return 'dead'; }
    return true;
  }

  /** Смерть: тело обмякает, теряет цвет, всплывает и распадается. */
  die(world) {
    if (this.dying >= 0) return;
    this.dying = 0;
    this.state = AI.WANDER;
    this.target = null;
    if (world?.particles) world.particles.burst(this.x, this.y, 10, this.body.pal.h, 90, 3, 1);
  }

  _updateDying(dt, world) {
    this.dying += dt;
    const b = this.body;
    const k = clamp(this.dying / 1.6, 0, 1);
    b.spine.soft = k;                       // ограничения ослабевают — тело обмякает
    b.spine.relax = lerp(0.94, 1, k);
    b.alpha = 1 - k * 0.9;
    // Обесцвечивание ступенями — строки цвета не пересобираются каждый кадр.
    const step = Math.round(k * 6);
    if (step !== this._fadeStep) { this._fadeStep = step; b.pal = buildPalette(b.pal.params, step / 6); }
    b.speed01 = 0;
    this.speed = lerp(this.speed, 0, damp(2, dt));
    this.y -= (14 + k * 26) * dt;           // всплывает
    this.x += Math.sin(this.dying * 2.2) * 10 * dt;
    this.angle = lerpAngle(this.angle, -Math.PI / 2, damp(0.8, dt));

    spineStep(b, this.x, this.y, this.angle, dt);
    updateBodyParts(b, dt, this.t);

    // Распад на частицы.
    if (world?.particles && Math.random() < dt * 14 * (0.2 + k)) {
      const i = (Math.random() * b.spine.n) | 0;
      world.particles.spawn(1, b.spine.rx[i], b.spine.ry[i],
        (Math.random() - 0.5) * 40, -20 - Math.random() * 30,
        0.8 + Math.random(), b.halfWidth * 0.3, b.pal.h, 1.6);
    }
    if (this.dying > 1.7) this.alive = false;
  }
}

/**
 * Стайное поведение: разделение, выравнивание, сплочение.
 * Считается только по соседям того же «веса» — стая не смешивается с чужаками.
 */
function boids(self, list, out) {
  let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, cnt = 0;
  const R = 130, R2 = R * R, SEP = 46, SEP2 = SEP * SEP;

  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === self || !o.alive || o.dying >= 0) continue;
    if (o.mass > self.mass * 1.6 || o.mass < self.mass * 0.6) continue;
    const dx = o.x - self.x, dy = o.y - self.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > R2 || d2 < 1) continue;
    cnt++;
    cx += o.x; cy += o.y;
    ax += Math.cos(o.angle); ay += Math.sin(o.angle);
    if (d2 < SEP2) { const f = (SEP2 - d2) / SEP2; sx -= dx * f; sy -= dy * f; }
  }
  if (!cnt) { out[0] = 0; out[1] = 0; return out; }

  cx = cx / cnt - self.x; cy = cy / cnt - self.y;
  const cl = Math.hypot(cx, cy) || 1;
  const al = Math.hypot(ax, ay) || 1;
  const sl = Math.hypot(sx, sy) || 1;

  out[0] = (cx / cl) * 0.5 + (ax / al) * 0.9 + (sx / sl) * 1.4;
  out[1] = (cy / cl) * 0.5 + (ay / al) * 0.9 + (sy / sl) * 1.4;
  return out;
}

export { AI };
