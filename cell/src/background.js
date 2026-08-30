// background.js — процедурный мир: параллакс, каустика, лучи, взвесь,
// пузыри и невидимые течения. Ни одной картинки: всё из шума.

import { makeNoise } from './noise.js';
import { scenePalette } from './palette.js';
import { makeRng, clamp, TAU } from './rng.js';

export class Background {
  constructor(seed) {
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.pal = scenePalette(seed, 0);
    this.time = 0;
    this.W = 0; this.H = 0; this.dpr = 1;

    // Каустика: тайл считается ОДИН раз (периодический шум — стыки не видны),
    // а живость даёт сдвиг двух копий друг относительно друга.
    this.cau = this._makeCausticTile(160, 14, seed);

    // Дальние силуэты — статичный offscreen-слой, перерисовывается редко.
    this.far = document.createElement('canvas');
    this.farCtx = this.far.getContext('2d');

    // Взвесь (планктон): броуновское движение + разбегание от игрока.
    this.dustN = 320;
    this.dust = new Float32Array(this.dustN * 5); // x,y,vx,vy,depth
    const rng = makeRng(seed ^ 991);
    for (let i = 0; i < this.dustN; i++) {
      const o = i * 5;
      this.dust[o] = rng.range(-900, 900);
      this.dust[o + 1] = rng.range(-900, 900);
      this.dust[o + 2] = rng.range(-4, 4);
      this.dust[o + 3] = rng.range(-4, 4);
      this.dust[o + 4] = rng.range(0.35, 1);
    }

    // Пузыри.
    this.bubN = 46;
    this.bub = new Float32Array(this.bubN * 5); // x,y,r,speed,phase
    for (let i = 0; i < this.bubN; i++) {
      const o = i * 5;
      this.bub[o] = rng.range(-900, 900);
      this.bub[o + 1] = rng.range(-700, 700);
      this.bub[o + 2] = rng.range(1.2, 4.2);
      this.bub[o + 3] = rng.range(18, 46);
      this.bub[o + 4] = rng.range(0, TAU);
    }

    this.quality = 1;   // понижается автоматически при просадке FPS
    this._cv = [0, 0];
  }

  /**
   * Тайл каустики: периодический value-шум -> ridged -> степень.
   * Периодичность по модулю period делает тайл бесшовным.
   */
  _makeCausticTile(N, period, seed) {
    const rng = makeRng(seed ^ 0x1234);
    const P = period;
    const val = new Float32Array(P * P * 4);
    for (let i = 0; i < val.length; i++) val[i] = rng.next();

    const smooth = (t) => t * t * (3 - 2 * t);
    const at = (gx, gy, oct) => {
      const p = P * oct;
      const off = oct === 1 ? 0 : (oct === 2 ? P * P : P * P + 4 * P * P);
      const i = ((gx % p) + p) % p, j = ((gy % p) + p) % p;
      return val[(off + j * p + i) % val.length];
    };
    const octave = (x, y, oct) => {
      const gx = Math.floor(x), gy = Math.floor(y);
      const fx = smooth(x - gx), fy = smooth(y - gy);
      const a = at(gx, gy, oct), b = at(gx + 1, gy, oct);
      const c = at(gx, gy + 1, oct), d = at(gx + 1, gy + 1, oct);
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };

    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(N, N);
    const d = img.data;
    let k = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x / N) * P, v = (y / N) * P;
        let n = octave(u, v, 1) * 0.6 + octave(u * 2, v * 2, 2) * 0.3;
        n /= 0.9;
        const r = 1 - Math.abs(n * 2 - 1);          // ridged: тонкие «жилы»
        // Порог со сглаживанием: остаются только редкие яркие прожилки,
        // иначе слой превращается в равномерную молочную дымку.
        const th = clamp((r - 0.78) / 0.19, 0, 1);
        const q = th * th * (3 - 2 * th);
        d[k++] = 214; d[k++] = 255; d[k++] = 246; d[k++] = (q * 255) | 0;
      }
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }

  /** Лучи света — статичный offscreen, двигается параллаксом. */
  _drawRays() {
    const W = this.rays.width, H = this.rays.height;
    const c = this.raysCtx;
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = (i / 7) * W + 30;
      const g = c.createLinearGradient(x, 0, x + 120, H);
      g.addColorStop(0, this.pal.ray);
      g.addColorStop(1, 'transparent');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x - 34, -10);
      c.lineTo(x + 52, -10);
      c.lineTo(x + 186, H + 10);
      c.lineTo(x + 28, H + 10);
      c.closePath();
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.grad = null;
    this.far.width = Math.max(1, Math.round(W));
    this.far.height = Math.max(1, Math.round(H * 0.6));
    this._drawFar();
    if (!this.rays) { this.rays = document.createElement('canvas'); this.raysCtx = this.rays.getContext('2d'); }
    if (!this.cauLayer) { this.cauLayer = document.createElement('canvas'); this.cauLayerCtx = this.cauLayer.getContext('2d'); }
    this.cauLayer.width = Math.max(1, Math.round(W * 0.5));
    this.cauLayer.height = Math.max(1, Math.round(H * 0.5));
    this.cauMask = null;
    this.rays.width = Math.max(1, Math.round(W + 420));
    this.rays.height = Math.max(1, Math.round(H));
    this._drawRays();
  }

  /** Дальние мутные силуэты — рисуются один раз на ресайз. */
  _drawFar() {
    const c = this.farCtx, W = this.far.width, H = this.far.height;
    c.clearRect(0, 0, W, H);
    const rng = makeRng(this.seed ^ 4242);
    for (let i = 0; i < 9; i++) {
      const x = rng.range(-40, W + 40);
      const y = rng.range(H * 0.25, H);
      const r = rng.range(H * 0.22, H * 0.7);
      const g = c.createRadialGradient(x, y, r * 0.1, x, y, r);
      g.addColorStop(0, this.pal.far);
      g.addColorStop(1, 'transparent');
      c.globalAlpha = rng.range(0.25, 0.6);
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, r * rng.range(0.6, 1.3), r, rng.range(0, 3), 0, TAU);
      c.fill();
    }
    // Стираем верх слоя градиентом — иначе виден резкий горизонтальный край.
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'destination-out';
    const fade = c.createLinearGradient(0, 0, 0, H * 0.55);
    fade.addColorStop(0, 'hsl(0 0% 0% / 1)');
    fade.addColorStop(1, 'hsl(0 0% 0% / 0)');
    c.fillStyle = fade;
    c.fillRect(0, 0, W, H * 0.55);
    c.globalCompositeOperation = 'source-over';
  }

  /** Скорость течения в точке мира. Возвращает [vx,vy] (переиспользуемый массив). */
  current(x, y, out = this._cv) {
    this.noise.curl2(x * 0.0016, y * 0.0016 + this.time * 0.02, out);
    out[0] *= 26; out[1] *= 26;
    return out;
  }

  update(dt, player) {
    this.time += dt;

    // Планктон: броуновское дрожание + течение + разбегание от игрока.
    const d = this.dust;
    for (let i = 0; i < this.dustN; i++) {
      const o = i * 5;
      d[o + 2] += (Math.random() - 0.5) * 46 * dt;
      d[o + 3] += (Math.random() - 0.5) * 46 * dt;

      const cur = this.current(d[o], d[o + 1]);
      d[o + 2] += cur[0] * dt * 0.6;
      d[o + 3] += cur[1] * dt * 0.6;

      if (player) {
        const dx = d[o] - player.x, dy = d[o + 1] - player.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 9000 && dist2 > 1) {
          const f = (1 - dist2 / 9000) * 260 / Math.sqrt(dist2);
          d[o + 2] += dx * f * dt;
          d[o + 3] += dy * f * dt;
        }
      }

      d[o + 2] *= 0.94; d[o + 3] *= 0.94;
      d[o] += d[o + 2] * dt;
      d[o + 1] += d[o + 3] * dt;
    }

    // Пузыри всплывают, покачиваясь.
    const b = this.bub;
    for (let i = 0; i < this.bubN; i++) {
      const o = i * 5;
      b[o + 1] -= b[o + 3] * dt;
      b[o] += Math.sin(this.time * 1.6 + b[o + 4]) * 9 * dt;
      if (player && b[o + 1] < player.y - 700) {
        b[o + 1] = player.y + 700;
        b[o] = player.x + (Math.random() - 0.5) * 1400;
      }
    }
  }

  /** Фон: градиент воды, дальние силуэты, каустика, лучи. */
  drawFar(ctx, cam) {
    const { W, H } = this;
    if (!this.grad) {
      this.grad = ctx.createLinearGradient(0, 0, 0, H);
      this.grad.addColorStop(0, this.pal.top);
      this.grad.addColorStop(0.5, this.pal.surface);
      this.grad.addColorStop(1, this.pal.bottom);
    }
    ctx.fillStyle = this.grad;
    ctx.fillRect(0, 0, W, H);

    // Слой 1 — дальние силуэты, самый медленный параллакс.
    const p1 = 0.06;
    ctx.globalAlpha = 0.55;
    const fx = -((cam.x * p1) % this.far.width);
    for (let i = -1; i <= 1; i++) {
      ctx.drawImage(this.far, fx + i * this.far.width, H - this.far.height - cam.y * p1 * 0.3);
    }
    ctx.globalAlpha = 1;

    // Слой 2 — каустика: две копии тайла ползут навстречу друг другу.
    // Собирается в половинном разрешении и гасится к глубине маской.
    if (this.quality > 0.3 && this.cauLayer) {
      const lc = this.cauLayerCtx, lw = this.cauLayer.width, lh = this.cauLayer.height;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.clearRect(0, 0, lw, lh);
      lc.globalCompositeOperation = 'lighter';
      const tw = this.cau.width;
      for (let pass = 0; pass < 2; pass++) {
        const sc = (pass ? 1.9 : 1.35) * 0.5;
        const sp = pass ? -1 : 1;
        const size = tw * sc;
        lc.globalAlpha = pass ? 0.55 : 0.85;
        let ox = (-(cam.x * 0.22) + this.time * 7 * sp) * 0.5 % size;
        let oy = (-(cam.y * 0.22) + this.time * 4 * sp) * 0.5 % size;
        if (ox > 0) ox -= size;
        if (oy > 0) oy -= size;
        for (let y = oy; y < lh; y += size) {
          for (let x = ox; x < lw; x += size) lc.drawImage(this.cau, x, y, size, size);
        }
      }
      // Глубина: каустика живёт у поверхности и гаснет вниз.
      lc.globalCompositeOperation = 'destination-out';
      lc.globalAlpha = 1;
      if (!this.cauMask) {
        this.cauMask = lc.createLinearGradient(0, 0, 0, lh);
        this.cauMask.addColorStop(0, 'hsl(0 0% 0% / 0)');
        this.cauMask.addColorStop(0.55, 'hsl(0 0% 0% / .55)');
        this.cauMask.addColorStop(1, 'hsl(0 0% 0% / 1)');
      }
      lc.fillStyle = this.cauMask;
      lc.fillRect(0, 0, lw, lh);
      lc.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.13 * this.quality;
      ctx.drawImage(this.cauLayer, 0, 0, W, H);
      ctx.restore();
    }

    // Слой 3 — лучи света (готовый offscreen, только сдвиг).
    if (this.rays) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 + Math.sin(this.time * 0.4) * 0.15;
      const rw = this.rays.width;
      let rx = (-(cam.x * 0.12)) % rw;
      if (rx > 0) rx -= rw;
      for (let x = rx; x < W; x += rw) ctx.drawImage(this.rays, x, 0);
      ctx.restore();
    }
  }

  /** Взвесь и пузыри — рисуются уже в мировых координатах. */
  drawNear(ctx, cam, view) {
    const d = this.dust;
    ctx.fillStyle = this.pal.dust;
    for (let i = 0; i < this.dustN; i++) {
      const o = i * 5;
      const x = d[o], y = d[o + 1];
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      const dep = d[o + 4];
      ctx.globalAlpha = 0.12 + dep * 0.3;
      const r = dep * 1.5;
      ctx.fillRect(x - r * 0.5, y - r * 0.5, r, r);
    }
    ctx.globalAlpha = 1;

    const b = this.bub;
    ctx.strokeStyle = 'hsl(190 60% 92% / 0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < this.bubN; i++) {
      const o = i * 5;
      const x = b[o], y = b[o + 1], r = b[o + 2];
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'hsl(190 70% 96% / 0.13)';
      ctx.fill();
    }
  }

  /** Планктон разлетается от взрыва/укуса. */
  disturb(x, y, power = 1) {
    const d = this.dust;
    for (let i = 0; i < this.dustN; i++) {
      const o = i * 5;
      const dx = d[o] - x, dy = d[o + 1] - y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 22000 && dist2 > 1) {
        const f = (1 - dist2 / 22000) * 420 * power / Math.sqrt(dist2);
        d[o + 2] += dx * f;
        d[o + 3] += dy * f;
      }
    }
  }
}
