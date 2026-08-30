// ui.js — экраны и HUD на обычном DOM. Переходы — fade + масштаб,
// никаких мгновенных подмен. Ни одной картинки: формы собраны из CSS.

import { clamp } from './rng.js';
import { drawPartIcon } from './editor.js';

export class UI {
  constructor(i18n) {
    this.i18n = i18n;
    this.el = {};
    const ids = [
      'screens', 'menu', 'editorUI', 'pause', 'death', 'levelup', 'hud',
      'hpFill', 'stamFill', 'dnaVal', 'growthFill', 'levelVal', 'fps',
      'edDna', 'edSym', 'btnContinue', 'deathStats', 'logo', 'minimap',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.current = null;
    this.mini = this.el.minimap?.getContext('2d');
  }

  /** Показать экран с плавным переходом. */
  show(name) {
    const list = ['menu', 'editorUI', 'pause', 'death', 'levelup'];
    for (const n of list) {
      const el = this.el[n];
      if (!el) continue;
      el.classList.toggle('show', n === name);
    }
    this.el.hud?.classList.toggle('dim', !!name);
    this.current = name;
  }

  hideAll() { this.show(null); }

  setHud(player, need) {
    const e = this.el;
    if (e.hpFill) e.hpFill.style.width = (clamp(player.hp / player.maxHp, 0, 1) * 100).toFixed(1) + '%';
    if (e.stamFill) e.stamFill.style.width = (player.stamina * 100).toFixed(1) + '%';
    if (e.dnaVal) e.dnaVal.textContent = player.dna | 0;
    if (e.growthFill) e.growthFill.style.width = (clamp(player.dna / need, 0, 1) * 100).toFixed(1) + '%';
    if (e.levelVal) e.levelVal.textContent = player.level;
  }

  setFps(v) { if (this.el.fps) this.el.fps.textContent = Math.round(v) + ' FPS'; }
  setEditorDna(v) { if (this.el.edDna) this.el.edDna.textContent = Math.round(v); }

  /** Миникарта: игрок, существа и еда точками. Рисуется на маленьком canvas. */
  drawMinimap(player, world, R = 1400) {
    const c = this.mini;
    if (!c) return;
    const s = this.el.minimap.width;
    c.clearRect(0, 0, s, s);
    c.fillStyle = 'hsl(196 45% 8% / .55)';
    c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); c.fill();

    const k = (s / 2 - 3) / R;
    c.fillStyle = 'hsl(120 60% 60% / .6)';
    for (const f of world.foods) {
      if (!f.alive) continue;
      const dx = (f.x - player.x) * k, dy = (f.y - player.y) * k;
      if (dx * dx + dy * dy > (s / 2 - 3) ** 2) continue;
      c.fillRect(s / 2 + dx, s / 2 + dy, 1.4, 1.4);
    }
    for (const cr of world.creatures) {
      const dx = (cr.x - player.x) * k, dy = (cr.y - player.y) * k;
      if (dx * dx + dy * dy > (s / 2 - 3) ** 2) continue;
      const big = cr.mass > player.mass * 1.2;
      c.fillStyle = big ? 'hsl(2 85% 62% / .9)' : 'hsl(46 90% 62% / .8)';
      c.beginPath(); c.arc(s / 2 + dx, s / 2 + dy, big ? 2.6 : 1.9, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'hsl(160 90% 66%)';
    c.beginPath(); c.arc(s / 2, s / 2, 2.6, 0, Math.PI * 2); c.fill();
  }

  /** Заголовок меню рисуется геометрией на canvas — не шрифтовая картинка. */
  drawLogo(time, pal) {
    const cv = this.el.logo;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    // «Клетка»: ядро, мембрана и жгутик, всё живёт во времени.
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.28;
    const wob = 1 + Math.sin(time * 1.6) * 0.03;

    c.save();
    c.translate(cx, cy);
    c.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const rr = r * wob * (1 + Math.sin(a * 3 + time) * 0.06 + Math.sin(a * 5 - time * 1.3) * 0.03);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.86;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
    const g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.2);
    g.addColorStop(0, 'hsl(165 80% 70%)');
    g.addColorStop(0.6, 'hsl(178 70% 46%)');
    g.addColorStop(1, 'hsl(196 70% 26%)');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'hsl(186 90% 80% / .5)';
    c.lineWidth = 1.5;
    c.stroke();

    // Ядро.
    c.fillStyle = 'hsl(150 90% 74% / .9)';
    c.beginPath();
    c.arc(-r * 0.12, r * 0.05, r * 0.3, 0, Math.PI * 2);
    c.fill();

    // Жгутик.
    c.strokeStyle = 'hsl(165 80% 62%)';
    c.lineWidth = r * 0.13;
    c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = -r * 0.9 - t * r * 1.5;
      const y = Math.sin(t * 4.5 + time * 3.4) * r * 0.42 * t;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.restore();
  }

  /** Итоги уровня/смерти. */
  setDeathStats(level, dna, seconds) {
    if (!this.el.deathStats) return;
    const t = this.i18n.t;
    this.el.deathStats.textContent =
      `${t('level')} ${level} · ${t('dna')} ${dna | 0} · ${t('survived')} ${Math.round(seconds)}s`;
  }
}

export { drawPartIcon };
