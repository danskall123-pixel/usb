// Общие помощники для «анимации жестом» (record.js, followpath.js):
// цель анимации (слой или кость), пространство родителя, подгонка ключей под значения по кадрам.
import { app } from '../../app.js';
import { M, RAD, DEG, normAngle } from '../../util.js';
import { setKey, evalCh } from '../../anim.js';
import { evaluate, camMatrix } from '../../scene.js';
import { layerBox, setOrigin } from '../../tools.js';

// Сцена на кадре f (текущий кадр — из кэша редактора)
export function sceneAt(f) { return f === app.frame ? app.scene() : evaluate(app.doc, f); }

// Экранные координаты холста → документ с камерой кадра f
export function docAt(f, sx, sy) {
  const m = M.mul(app.viewMatrix(), camMatrix(app.doc, f));
  return M.apply(M.inv(m), sx, sy);
}

// Почему слой нельзя анимировать жестом (null — можно)
export function whyNot(L) {
  if (!L) return 'Сначала выберите слой, который нужно анимировать, — кликните его в панели «Слои»';
  if (L.lock) return `Слой «${L.name}» заблокирован — снимите замок в панели «Слои»`;
  if (L.type === 'audio') return 'Звуковой слой нельзя двигать — выберите слой с рисунком';
  if (!L.vis) return `Слой «${L.name}» скрыт — включите его (значок глаза в панели «Слои»)`;
  return null;
}

// Для поворота: если точка вращения далеко от рисунка — перенести её в центр (слой не сдвигается).
// Возвращает true, если перенесли.
export function centerPivot(L) {
  const bb = layerBox(L);
  if (!bb) return false;
  const [ox, oy] = L.origin, mx = (bb.x1 - bb.x0) * 0.15, my = (bb.y1 - bb.y0) * 0.15;
  if (ox >= bb.x0 - mx && ox <= bb.x1 + mx && oy >= bb.y0 - my && oy <= bb.y1 + my) return false;
  setOrigin(L, [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2]);
  return true;
}

// Цель: слой целиком или одна кость слоя костей
export function layerTarget(L) { return { kind: 'layer', L, name: `слой «${L.name}»`, pos: L.pos, rot: L.rot }; }
export function boneTarget(B, b) { return { kind: 'bone', L: B, B, b, name: `кость «${b.name}»`, pos: b.pos, rot: b.ang }; }

// Единственная выделенная кость активного слоя костей
export function selectedBone(B) {
  if (!B || B.type !== 'bone' || app.sel.bones.size !== 1) return null;
  const [id] = app.sel.bones;
  return B.bones.find((b) => b.id === id) || null;
}

// Матрица «пространство родителя цели → документ» на сцене S (в этом пространстве живёт канал pos)
export function parentWorld(tg, S) {
  const rec = S.layers.get(tg.L.id);
  if (!rec) return M.id();
  if (tg.kind === 'bone') {
    const pm = (tg.b.parent != null && rec.bc && rec.bc.Mt.get(tg.b.parent)) || M.id();
    return M.mul(rec.bc ? rec.bc.world : rec.world, pm);
  }
  return M.mul(rec.world, M.inv(rec.local));
}

// Сдвиг в документе → сдвиг в пространстве родителя
export function toParentV(P, dx, dy) { return M.applyV(M.inv(P), dx, dy); }

// Непрерывный угол (градусы): ближайший к prev эквивалент a
export function unwrapDeg(prev, a) { return prev == null ? a : prev + normAngle((a - prev) * DEG) * RAD; }

export const distV = (a, b) => (Array.isArray(a) ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Math.abs(a - b));

// Лёгкое сглаживание значений по кадрам (крайние значения не меняются)
export function smoothVals(vals, passes = 1) {
  let v = vals.map((x) => (Array.isArray(x) ? x.slice() : x));
  const n = v.length;
  for (let p = 0; p < passes && n > 2; p++) {
    const o = v.map((x) => (Array.isArray(x) ? x.slice() : x));
    for (let i = 1; i < n - 1; i++) {
      if (Array.isArray(v[i])) o[i] = v[i].map((x, j) => (v[i - 1][j] + 2 * x + v[i + 1][j]) / 4);
      else o[i] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4;
    }
    v = o;
  }
  return v;
}

// Подогнать ключи канала c под значения vals (кадры f0, f0+1, …).
// Старые ключи участка заменяются. Ключи добавляются жадно (как в RDP) в кадры с наибольшим
// отклонением, пока кривая не пройдёт ближе tol ко всем значениям; all — ключ на каждом кадре.
// Форма соседнего участка перед f0 сохраняется (при необходимости ставится страховочный ключ).
// speed — допуск растёт с скоростью (на быстром движении мелкое отклонение незаметно).
// Возвращает число ключей на участке.
export function fitKeys(c, f0, vals, { tol, speed = 0, interp = 'smooth', all = false } = {}) {
  const n = vals.length;
  if (!n) return 0;
  const tolAt = (i) => (speed ? Math.max(tol, speed * distV(vals[Math.max(0, i - 1)], vals[Math.min(n - 1, i + 1)]) / 2) : tol);
  f0 = Math.max(1, f0);
  const f1 = f0 + n - 1;
  const before = c.k.filter((k) => k.f < f0);
  const guard = [];
  let gInterp = 'smooth';
  if (before.length) {
    const pk = before[before.length - 1];
    gInterp = pk.i;
    const g0 = before[Math.max(0, before.length - 2)].f;
    for (let f = g0 + 1; f < f0; f++) if (f !== pk.f) guard.push([f, evalCh(c, f)]);
  }
  c.k = c.k.filter((k) => k.f === 0 || k.f < f0 || k.f > f1);
  setKey(c, f0, vals[0], interp);
  setKey(c, f1, vals[n - 1], interp);
  if (all) for (let i = 1; i < n - 1; i++) setKey(c, f0 + i, vals[i], interp);
  const limit = n + guard.length + 2;
  for (let it = 0; it < limit; it++) {
    // худший кадр — по превышению допуска
    let wf = -1, wd = 1, wv = null, wi = interp;
    for (let i = 1; i < n - 1; i++) {
      const d = distV(evalCh(c, f0 + i), vals[i]) / tolAt(i);
      if (d > wd) { wd = d; wf = f0 + i; wv = vals[i]; wi = interp; }
    }
    for (const [f, v] of guard) {
      const d = distV(evalCh(c, f), v) / tol;
      if (d > wd) { wd = d; wf = f; wv = v; wi = gInterp; }
    }
    if (wf < 0) break;
    setKey(c, wf, wv, wi);
  }
  // проход «прополки»: убрать ключи, без которых кривая всё равно укладывается в допуск
  if (!all) {
    const fits = () => {
      for (let i = 1; i < n - 1; i++) if (distV(evalCh(c, f0 + i), vals[i]) > tolAt(i)) return false;
      for (const [f, v] of guard) if (distV(evalCh(c, f), v) > tol) return false;
      return true;
    };
    for (let j = c.k.length - 1; j >= 0; j--) {
      const key = c.k[j];
      if (key.f <= f0 && !guard.some((g) => g[0] === key.f)) continue;
      if (key.f >= f1) continue;
      c.k.splice(j, 1);
      if (!fits()) c.k.splice(j, 0, key);
    }
  }
  return c.k.filter((k) => k.f >= f0 && k.f <= f1).length;
}

// Сохранить / восстановить каналы (для отмены и перезаписи)
export function saveChans(chans) { return chans.map((c) => [c, JSON.stringify(c.k)]); }
export function restoreChans(saved) { for (const [c, s] of saved) c.k = JSON.parse(s); }

// Русские формы множественного числа: plural(5, ['кадр', 'кадра', 'кадров'])
export function plural(n, f) {
  const a = Math.abs(n) % 100, b = a % 10;
  return f[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b > 1 && b < 5 ? 1 : 2];
}

// Плашка с текстом по центру сверху холста (экранные координаты)
export function drawPill(ctx, text, { y = 14, bg = 'rgba(20,22,26,.86)', fg = '#fff', dot = null, x = null } = {}) {
  ctx.save();
  ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", sans-serif';
  const pad = 12, dotW = dot ? 16 : 0;
  const w = ctx.measureText(text).width + pad * 2 + dotW, hh = 28;
  const cw = ctx.canvas.width / (ctx.getTransform().a || 1);
  const px = x == null ? Math.round(cw / 2 - w / 2) : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, y, w, hh, 14); else ctx.rect(px, y, w, hh);
  ctx.fill();
  if (dot) { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(px + pad + 5, y + hh / 2, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + pad + dotW, y + hh / 2 + 0.5);
  ctx.restore();
  return { x: px, y, w, h: hh };
}

// Ломаная в координатах документа → на экран
export function strokeDocPath(ctx, pts, { color = '#4c9dff', width = 3, dash = null, outline = true, alpha = 1 } = {}) {
  if (pts.length < 2) return;
  const m = app.docToScreenM();
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const [sx, sy] = M.apply(m, x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
  if (outline) { ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = width + 3; ctx.setLineDash(dash || []); ctx.stroke(); }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.restore();
}
