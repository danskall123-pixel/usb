// Путь движения (U): нарисуйте путь мышью — активный слой (или выделенная кость) поедет по нему,
// начиная с текущего кадра. Ключи расставляются по длине пути, с плавным стартом и финишем.
import { app } from '../app.js';
import { registerTool, layerBox, drawBBox, drawOrigin, boneScreen } from '../tools.js';
import { evalCh } from '../anim.js';
import { M, RAD } from '../util.js';
import { registerIcon } from '../icons.js';
import { registerMenu, registerOverlay } from '../ext.js';
import {
  sceneAt, whyNot, layerTarget, boneTarget, selectedBone, parentWorld, toParentV, unwrapDeg,
  smoothVals, fitKeys, plural, drawPill, strokeDocPath, centerPivot,
} from './record/keyfit.js';

registerIcon('followpath', '<path d="M4 19c2.5-7 7-1.5 9.5-7.5S17.5 5 20.5 5" stroke-dasharray="2.6 2.4"/><circle cx="4.5" cy="18.5" r="2.2" fill="currentColor"/><path d="M16.8 3.4L20.8 5l-1.9 3.7"/>');

const opt = (k, d) => (app.toolOpts[k] === undefined ? d : app.toolOpts[k]);
const BLUE = '#4c9dff';
const FADE_MS = 1800;

let D = null;      // рисуется путь
let shown = null;  // применённый путь (гаснет)

function startFrame() {
  const d = app.doc;
  return app.frame <= 0 ? Math.max(1, d.start) : app.frame;
}

function target(L) {
  if (L.type === 'bone') {
    const b = selectedBone(L);
    if (b) return boneTarget(L, b);
  }
  return layerTarget(L);
}

const frameWord = (n) => plural(n, ['кадр', 'кадра', 'кадров']);
const easeIO = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// Путь: прореживание, сглаживание, таблица длин
function preparePath(raw) {
  const minD = app.pxToDoc(2);
  const pts = [raw[0]];
  for (const p of raw.slice(1)) {
    const q = pts[pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= minD) pts.push(p);
  }
  const last = raw[raw.length - 1], q = pts[pts.length - 1];
  if (pts.length > 1 && (q[0] !== last[0] || q[1] !== last[1])) pts[pts.length - 1] = last;
  else if (pts.length === 1) pts.push(last);
  const sm = smoothVals(pts, 3);
  const len = [0];
  for (let i = 1; i < sm.length; i++) len.push(len[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
  return { pts: sm, len, total: len[len.length - 1] };
}

// Точка на пути по длине дуги s
function pointAt(P, s) {
  const { pts, len } = P;
  if (s <= 0) return pts[0].slice();
  if (s >= P.total) return pts[pts.length - 1].slice();
  let lo = 0, hi = len.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] <= s) lo = m; else hi = m; }
  const k = (s - len[lo]) / (len[hi] - len[lo] || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * k, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * k];
}

// Направление пути (вектор) около s
function tangentAt(P, s) {
  const d = Math.max(app.pxToDoc(10), P.total * 0.02);
  const a = pointAt(P, Math.max(0, s - d)), b = pointAt(P, Math.min(P.total, s + d));
  return [b[0] - a[0], b[1] - a[1]];
}

function apply(raw) {
  const L = app.active;
  const why = whyNot(L);
  if (why) { app.toast(why, 3500); return; }
  const P = preparePath(raw);
  if (P.total < app.pxToDoc(12)) {
    app.toast('Путь слишком короткий — проведите мышью линию, по которой поедет объект', 3500);
    return;
  }
  const tg = target(L);
  const doc = app.doc;
  const dur = Math.max(2, Math.round(+opt('fpDur', 24) || 24));
  const ease = opt('fpEase', true), rotate = opt('fpRotate', false), back = opt('fpBack', false);
  const f0 = startFrame();
  const pivotMoved = rotate && tg.kind === 'layer' && centerPivot(L);
  const n = back ? dur * 2 + 1 : dur + 1;
  const fLast = f0 + n - 1;
  const pos0 = evalCh(tg.pos, f0).slice(), rot0 = evalCh(tg.rot, f0);
  const start = P.pts[0];
  // длина дуги на каждом кадре
  const arc = [];
  for (let i = 0; i < n; i++) {
    const leg = i <= dur ? i / dur : 1 - (i - dur) / dur;
    arc.push((ease ? easeIO(leg) : leg) * P.total);
  }
  const posV = [], rotV = [], dots = [];
  let ang = null, ang0 = null;
  const P0 = parentWorld(tg, sceneAt(f0));
  // у слоя верхнего уровня родителя нет; иначе пространство родителя может быть анимировано
  const topLevel = tg.kind === 'layer' && !app.idx.parent.get(L.id);
  for (let i = 0; i < n; i++) {
    const f = f0 + i;
    const Pw = topLevel || !i ? P0 : parentWorld(tg, sceneAt(f));
    const p = pointAt(P, arc[i]);
    dots.push(p);
    const d = toParentV(Pw, p[0] - start[0], p[1] - start[1]);
    posV.push([pos0[0] + d[0], pos0[1] + d[1]]);
    if (rotate) {
      const t = tangentAt(P, arc[i]);
      const tl = M.applyV(M.inv(Pw), t[0], t[1]);
      ang = unwrapDeg(ang, Math.atan2(tl[1], tl[0]) * RAD);
      if (ang0 == null) ang0 = ang;
      rotV.push(rot0 + ang - ang0);
    }
  }
  const tol = app.pxToDoc(1.5) / (M.scaleFactor(P0) || 1);
  const keys = fitKeys(tg.pos, f0, posV, { tol, speed: 0.06 });
  if (rotate) fitKeys(tg.rot, f0, smoothVals(rotV, 2), { tol: 1.2 });
  let extended = false;
  if (fLast > doc.end) { doc.end = fLast; extended = true; }
  app.setFrame(f0);
  app.commit('Путь движения');
  shown = { pts: P.pts, dots, t: performance.now() };
  animateFade();
  const range = back ? `туда ${f0}–${f0 + dur}, обратно ${f0 + dur}–${fLast}` : `кадры ${f0}–${fLast}`;
  let msg = `Готово: ${tg.name} едет по пути, ${range} (${keys} ${plural(keys, ['ключ', 'ключа', 'ключей'])}).`;
  if (extended) msg += ` Анимация продлена до кадра ${fLast}.`;
  if (pivotMoved) msg += ' Точка вращения перенесена в центр объекта.';
  if (tg.kind === 'layer' && L.type === 'bone') msg += ' Чтобы двигать одну кость — выделите её.';
  msg += ' Пробел — посмотреть.';
  app.toast(msg, 5000);
}

function animateFade() {
  const step = () => {
    if (!shown) return;
    app.render();
    if (performance.now() - shown.t < FADE_MS) requestAnimationFrame(step);
    else { shown = null; app.render(); }
  };
  requestAnimationFrame(step);
}

function drawTargetHint(ctx, L) {
  const tg = target(L);
  if (tg.kind === 'bone') {
    const s = boneScreen(tg.B, tg.b);
    if (!s) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = BLUE;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(s.o[0], s.o[1]); ctx.lineTo(s.t[0], s.t[1]); ctx.stroke();
    ctx.restore();
    return tg;
  }
  const bb = layerBox(L);
  if (bb) { ctx.save(); ctx.setLineDash([6, 4]); drawBBox(ctx, bb, BLUE); ctx.restore(); }
  drawOrigin(ctx, L);
  return tg;
}

function drawArrowHead(ctx, pts) {
  if (pts.length < 2) return;
  const m = app.docToScreenM();
  const b = M.apply(m, ...pts[pts.length - 1]);
  let a = null;
  for (let i = pts.length - 2; i >= 0; i--) {
    const q = M.apply(m, ...pts[i]);
    if (Math.hypot(b[0] - q[0], b[1] - q[1]) > 8) { a = q; break; }
  }
  if (!a) return;
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.save();
  ctx.fillStyle = BLUE;
  ctx.strokeStyle = 'rgba(0,0,0,.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(b[0] + Math.cos(an) * 6, b[1] + Math.sin(an) * 6);
  ctx.lineTo(b[0] + Math.cos(an + 2.5) * 11, b[1] + Math.sin(an + 2.5) * 11);
  ctx.lineTo(b[0] + Math.cos(an - 2.5) * 11, b[1] + Math.sin(an - 2.5) * 11);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

registerTool({
  id: 'followpath', name: 'Путь движения', icon: 'followpath', key: 'u', group: 'anim', simple: true, cursor: 'crosshair', coalesce: true,
  avail: () => true,
  hint: 'Нарисуйте мышью путь — выбранный слой поедет по нему с текущего кадра. Начинайте путь от самого объекта. На слое костей выделенная кость двигается по пути.',
  options: () => [
    { type: 'number', key: 'fpDur', label: 'Длительность (кадров)', def: 24, min: 2, max: 2000 },
    { type: 'check', key: 'fpEase', label: 'Плавный старт и финиш', def: true },
    { type: 'check', key: 'fpRotate', label: 'Поворачивать по пути', def: false },
    { type: 'check', key: 'fpBack', label: 'Туда и обратно', def: false },
  ],
  down(e) {
    D = null;
    const why = whyNot(app.active);
    if (why) { app.toast(why, 3500); return; }
    D = { pts: [[e.x, e.y]], sx: e.sx, sy: e.sy };
    shown = null;
    app.render();
  },
  move(e) {
    if (!D) return;
    const q = D.pts[D.pts.length - 1];
    if (Math.hypot(e.x - q[0], e.y - q[1]) >= app.pxToDoc(1)) D.pts.push([e.x, e.y]);
    D.sx = e.sx; D.sy = e.sy;
    app.render();
  },
  up(e) {
    if (!D) return;
    const raw = D.pts;
    raw.push([e.x, e.y]);
    D = null;
    apply(raw);
    app.render();
  },
  cancel() { D = null; },
  overlay(ctx) {
    const L = app.active;
    if (D) {
      strokeDocPath(ctx, D.pts, { color: BLUE, width: 3 });
      const dur = Math.max(2, Math.round(+opt('fpDur', 24) || 24));
      const f0 = startFrame();
      const f1 = f0 + (opt('fpBack', false) ? dur * 2 : dur);
      ctx.save();
      const st = M.apply(app.docToScreenM(), ...D.pts[0]);
      ctx.fillStyle = BLUE; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(st[0], st[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      drawPill(ctx, `${dur} ${frameWord(dur)}: кадры ${f0}–${f1}`, { x: D.sx + 16, y: D.sy + 14, bg: 'rgba(20,22,26,.8)' });
      return;
    }
    if (!L || L.lock || L.type === 'audio') return;
    const tg = drawTargetHint(ctx, L);
    if (!shown) drawPill(ctx, `Нарисуйте путь: ${tg.name} поедет по нему с кадра ${startFrame()}`, { dot: BLUE });
  },
});

// Применённый путь гаснет (виден и после смены инструмента)
registerOverlay((ctx) => {
  if (!shown || D) return;
  const a = 1 - (performance.now() - shown.t) / FADE_MS;
  if (a <= 0) return;
  strokeDocPath(ctx, shown.pts, { color: BLUE, width: 2.5, dash: [8, 6], alpha: a });
  ctx.save();
  ctx.globalAlpha = a;
  drawArrowHead(ctx, shown.pts);
  const m = app.docToScreenM();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.5;
  for (const p of shown.dots) {
    const [x, y] = M.apply(m, p[0], p[1]);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
});

app.on('docloaded', () => { D = null; shown = null; });

registerMenu('Анимация', () => [
  { label: 'Путь движения (нарисовать)', icon: 'followpath', key: 'U', action: () => app.cmd.setTool('followpath') },
]);

