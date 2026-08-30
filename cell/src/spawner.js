// spawner.js — мир: пулы еды и существ, спавн вокруг камеры, отсечение
// далёкого, столкновения, поедание и урон.

import { Creature } from './creature.js';
import { randomConfig } from './player.js';
import { P } from './particles.js';
import { makeRng, clamp, TAU } from './rng.js';

const MOUTH = [0, 0, 0];
const MOUTH2 = [0, 0, 0];

/** Еда: растительная (для травоядных) и мясная (остатки существ). */
class Food {
  constructor() { this.alive = false; }
  set(x, y, r, meat, seed) {
    this.x = x; this.y = y; this.r = r;
    this.meat = meat;
    this.alive = true;
    this.hue = meat ? 8 + (seed % 20) : 96 + (seed % 60);
    this.wob = (seed % 100) / 100 * TAU;
    this.vx = 0; this.vy = 0;
    this.mass = r * 0.2;
    this.value = meat ? r * 1.6 : r * 1.05;
    return this;
  }
}

export class World {
  constructor(seed, bg, particles) {
    this.rng = makeRng(seed ^ 0xabcd);
    this.bg = bg;
    this.particles = particles;
    this.creatures = [];
    this.foods = [];
    this.foodPool = [];
    this.player = null;
    this.level = 1;
    this.worldRadius = 2600;
    this.maxCreatures = 16;
    this.maxFood = 130;
    this.onEat = null;        // (value, x, y, meat) => void
    this.onHit = null;        // (kind, x, y, power) => void
    this.time = 0;
  }

  _food() {
    for (const f of this.foodPool) if (!f.alive) return f;
    const f = new Food();
    this.foodPool.push(f);
    this.foods.push(f);
    return f;
  }

  /** Наполнение мира под текущий уровень роста. */
  populate(cx, cy) {
    for (let i = 0; i < this.maxFood; i++) {
      const a = this.rng.range(0, TAU), d = this.rng.range(70, 1200);
      this._food().set(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
        this.rng.range(5, 11), this.rng.chance(0.18), this.rng.int(0, 999));
    }
    for (let i = 0; i < this.maxCreatures; i++) this.spawnCreature(cx, cy, true);
  }

  /** Спавн существа за краем экрана, размер — относительно игрока. */
  spawnCreature(cx, cy, anywhere = false) {
    if (this.creatures.length >= this.maxCreatures) return null;
    const a = this.rng.range(0, TAU);
    const d = anywhere ? this.rng.range(300, 1600) : this.rng.range(700, 1100);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;

    // Три класса относительно игрока: добыча / равный / угроза.
    const roll = this.rng.next();
    const tier = roll < 0.45 ? 0.62 : roll < 0.8 ? 1.0 : 1.55;
    const seed = this.rng.int(1, 1e9);
    const cfg = randomConfig(seed);
    const pw = this.player ? this.player.body.halfWidth : 15;
    const scale = (pw * tier) / cfg.halfWidth;
    cfg.halfWidth *= scale;
    cfg.segLen *= clamp(scale, 0.6, 1.6);

    const c = new Creature(cfg, x, y, this.rng.range(0, TAU));
    c.tier = tier;
    this.creatures.push(c);
    return c;
  }

  update(dt, cam) {
    this.time += dt;
    const p = this.player;

    // Еду сносит течением, она слегка колышется.
    for (const f of this.foods) {
      if (!f.alive) continue;
      const c = this.bg.current(f.x, f.y);
      f.x += c[0] * dt * 0.5;
      f.y += c[1] * dt * 0.5;
    }

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      c.update(dt, this);
      if (!c.alive) {
        // Труп оставляет мясо.
        this._food().set(c.x, c.y, clamp(c.radius * 0.6, 5, 14), true, this.rng.int(0, 999));
        this.creatures.splice(i, 1);
        continue;
      }
      // Отсечение: слишком далёкие существа заменяются новыми у края экрана.
      if (Math.hypot(c.x - cam.x, c.y - cam.y) > 2000) {
        this.creatures.splice(i, 1);
      }
    }

    this._interact(dt);
    this._replenish(cam);
  }

  /** Столкновения: поедание еды, укусы, урон. */
  _interact(dt) {
    const p = this.player;
    const parts = this.particles;

    // Игрок ест еду.
    if (p && !p.dead) {
      p.mouthAt(MOUTH);
      for (const f of this.foods) {
        if (!f.alive) continue;
        const dx = f.x - MOUTH[0], dy = f.y - MOUTH[1];
        const d2 = dx * dx + dy * dy;
        const reach = p.body.halfWidth * 1.5 + f.r;
        if (d2 < reach * reach) {
          f.alive = false;
          p.openMouth();
          for (let k = 0; k < 6; k++) {
            parts.absorb(f.x + (Math.random() - 0.5) * f.r * 2, f.y + (Math.random() - 0.5) * f.r * 2,
              MOUTH[0], MOUTH[1], f.hue, 3);
          }
          this.onEat?.(f.value, f.x, f.y, f.meat);
        }
      }

      // Игрок и существа: кто чей обед.
      for (const c of this.creatures) {
        if (!c.alive || c.dying >= 0) continue;
        const dx = c.x - p.x, dy = c.y - p.y;
        const rr = c.radius + p.body.halfWidth;
        if (dx * dx + dy * dy > rr * rr * 1.6) continue;

        // Игрок кусает ртом.
        c.mouth(MOUTH2);
        p.mouthAt(MOUTH);
        const toPrey = Math.hypot(c.x - MOUTH[0], c.y - MOUTH[1]);
        if (toPrey < c.radius + p.body.halfWidth * 0.7 && p.attackCd <= 0) {
          p.attackCd = 0.42;
          p.openMouth();
          const res = c.hurt(p.stats.dmg, p.x, p.y, this);
          this.onHit?.('bite', c.x, c.y, p.stats.dmg);
          parts.burst(MOUTH[0], MOUTH[1], 7, c.body.pal.h, 150, 2.4);
          if (res === 'dead') this.onEat?.(c.mass * 2.2, c.x, c.y, true);
        }

        // Существо кусает игрока своим ртом.
        const toPlayer = Math.hypot(p.x - MOUTH2[0], p.y - MOUTH2[1]);
        if (c.carn && c.mass > p.mass * 0.75 && toPlayer < p.body.halfWidth + c.radius * 0.7 && c.attackCd <= 0) {
          c.attackCd = 0.7;
          if (p.hurt(c.stats.dmg * 0.5)) {
            this.onHit?.('hurt', p.x, p.y, c.stats.dmg);
            parts.burst(p.x, p.y, 10, 0, 190, 3);
            this.bg.disturb(p.x, p.y, 1);
          }
        }
      }
    }

    // Существа едят еду и друг друга.
    for (const c of this.creatures) {
      if (!c.alive || c.dying >= 0 || c.eatCd > 0) continue;
      c.mouth(MOUTH2);
      if (!c.carn) {
        for (const f of this.foods) {
          if (!f.alive || f.meat) continue;
          const dx = f.x - MOUTH2[0], dy = f.y - MOUTH2[1];
          const reach = c.radius + f.r;
          if (dx * dx + dy * dy < reach * reach) {
            f.alive = false; c.eatCd = 1.2;
            this.particles.burst(f.x, f.y, 4, f.hue, 70, 2, P.ABSORB);
          }
        }
      } else {
        for (const o of this.creatures) {
          if (o === c || !o.alive || o.dying >= 0) continue;
          if (o.mass > c.mass * 0.85) continue;
          const dx = o.x - MOUTH2[0], dy = o.y - MOUTH2[1];
          const reach = c.radius * 0.8 + o.radius;
          if (dx * dx + dy * dy < reach * reach && c.attackCd <= 0) {
            c.attackCd = 0.8;
            o.hurt(c.stats.dmg, c.x, c.y, this);
          }
        }
      }
    }
  }

  /** Поддержание плотности мира вокруг камеры. */
  _replenish(cam) {
    let aliveFood = 0;
    for (const f of this.foods) if (f.alive) aliveFood++;
    if (aliveFood < this.maxFood) {
      const a = this.rng.range(0, TAU), d = this.rng.range(520, 1100);
      this._food().set(cam.x + Math.cos(a) * d, cam.y + Math.sin(a) * d,
        this.rng.range(5, 11), this.rng.chance(0.15), this.rng.int(0, 999));
    }
    if (this.creatures.length < this.maxCreatures && this.rng.chance(0.03)) {
      this.spawnCreature(cam.x, cam.y);
    }
  }

  /** Еда рисуется процедурно: колышущаяся клякса с ядром. */
  drawFood(ctx, view, time) {
    for (const f of this.foods) {
      if (!f.alive) continue;
      if (f.x < view.x0 || f.x > view.x1 || f.y < view.y0 || f.y > view.y1) continue;

      const wob = Math.sin(time * 1.7 + f.wob) * 0.12;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(time * 0.3 + f.wob);

      const g = ctx.createRadialGradient(-f.r * 0.3, -f.r * 0.3, f.r * 0.15, 0, 0, f.r * 1.15);
      g.addColorStop(0, `hsl(${f.hue} 80% 74%)`);
      g.addColorStop(0.65, `hsl(${f.hue} 70% ${f.meat ? 44 : 52}%)`);
      g.addColorStop(1, `hsl(${f.hue} 60% 30%)`);
      ctx.fillStyle = g;

      ctx.beginPath();
      const lobes = f.meat ? 5 : 6;
      for (let i = 0; i <= lobes; i++) {
        const a = (i / lobes) * TAU;
        const r = f.r * (1 + Math.sin(a * 3 + f.wob) * 0.16 + wob);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else {
          const pa = ((i - 0.5) / lobes) * TAU;
          const pr = f.r * (1.18 + Math.sin(pa * 3 + f.wob) * 0.16 + wob);
          ctx.quadraticCurveTo(Math.cos(pa) * pr, Math.sin(pa) * pr, x, y);
        }
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = `hsl(${f.hue} 90% 86% / .5)`;
      ctx.beginPath();
      ctx.arc(-f.r * 0.22, -f.r * 0.22, f.r * 0.28, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  reset() {
    this.creatures.length = 0;
    for (const f of this.foods) f.alive = false;
  }
}
