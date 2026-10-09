// Запись движения (J): зажмите мышь на объекте и ведите — кадры идут в реальном времени,
// а объект (или кость персонажа) повторяет движение указателя. Отпустили — запись готова.
import { app } from '../app.js';
import { registerTool, boneScreen, layerBox, drawBBox, drawOrigin, setOrigin } from '../tools.js';
import { setKey, evalCh } from '../anim.js';
import { M, RAD, clamp, normAngle } from '../util.js';
import { boneMats } from '../scene.js';
import { registerIcon } from '../icons.js';
import { registerMenu } from '../ext.js';
import {
  sceneAt, docAt, whyNot, selectedBone, parentWorld, toParentV, unwrapDeg, resolveTarget, targetKey, targetAlive,
  smoothVals, fitKeys, saveChans, restoreChans, plural, drawPill, strokeDocPath, centerPivot, chanRef, offerTrim,
} from './record/keyfit.js';

registerIcon('record', '<circle cx="10" cy="13" r="7"/><circle cx="10" cy="13" r="3" fill="currentColor"/><path d="M16.5 4.5c1.8.9 3.2 2.6 3.8 4.6M15.3 7.4c.9.5 1.6 1.4 1.9 2.4"/>');

const opt = (k, d) => (app.toolOpts[k] === undefined ? d : app.toolOpts[k]);
const RED = '#ff4d5e';

let R = null;          // идёт запись
let fade = null;       // след последней записи (гаснет)

function startFrame() {
  const d = app.doc;
  let f = app.frame;
  if (f <= 0 || f >= d.end) f = Math.max(1, d.start);
  return f;
}

// IK: повернуть кости цепочки так, чтобы точка gl кости effId оказалась в target (пространство слоя костей)
function ikSolve(B, f, chain, effId, gl, target) {
  for (let it = 0; it < 14; it++) {
    for (const bone of chain) {
      const Mt = boneMats(B, f);
      const e = M.apply(Mt.get(effId), gl[0], gl[1]);
      const m = Mt.get(bone.id);
      const o = M.apply(m, 0, 0);
      if (Math.hypot(e[0] - o[0], e[1] - o[1]) < 1e-6) continue;
      let d = normAngle(Math.atan2(target[1] - o[1], target[0] - o[0]) - Math.atan2(e[1] - o[1], e[0] - o[0])) * RAD;
      if (m[0] * m[3] - m[1] * m[2] < 0) d = -d;
      let nv = evalCh(bone.ang, f) + d;
      if (bone.lim) nv = clamp(nv, bone.min, bone.max);
      setKey(bone.ang, f, nv, 'smooth');
    }
    const e = M.apply(boneMats(B, f).get(effId), gl[0], gl[1]);
    if (Math.hypot(e[0] - target[0], e[1] - target[1]) < 0.25) break;
  }
}

function ikChain(B, b) {
  const byId = new Map(B.bones.map((x) => [x.id, x]));
  const chain = [b];
  let cur = b;
  while (chain.length < 6 && cur.parent != null) {
    const p = byId.get(cur.parent);
    if (!p || p.lock || p.parent == null || !byId.has(p.parent)) break; // корневую кость не крутим
    chain.push(p);
    cur = p;
  }
  return chain;
}

// Положение указателя (экран) в момент t — по записанным образцам
function pointerAt(r, t) {
  const s = r.samples;
  let i = s.length - 1;
  while (i > 0 && s[i].t > t) i--;
  const a = s[i], b = s[i + 1];
  if (!b || b.t <= a.t || t <= a.t) return [a.sx, a.sy];
  const k = (t - a.t) / (b.t - a.t);
  return [a.sx + (b.sx - a.sx) * k, a.sy + (b.sy - a.sy) * k];
}

// Что движется — для подсказок
const what = (tg) => (tg.kind === 'bone' ? 'кость' : 'объект');

function start(e) {
  const res = resolveTarget(e);
  const why = whyNot(res && res.L);
  if (why) { app.toast(why, 3500); return; }
  if (res.pick) { app.setActive(res.pick.id); app.rescene(); }
  const { tg, hb: hit } = res;
  const L = tg.L;
  if (tg.kind === 'bone' && app.boneLayerFor(app.active) === tg.B) { app.sel.bones.clear(); app.sel.bones.add(tg.b.id); }
  const d = app.doc;
  const f0 = startFrame();
  app.setFrame(f0);
  const S = app.scene();
  const P0 = parentWorld(tg, S);
  const press = docAt(f0, e.sx, e.sy);
  const r = {
    tg, f0, last: f0 - 1, fEnd: Math.max(f0, d.end), fps: d.fps || 24,
    speed: parseFloat(opt('recSpeed', '1.0')) || 1,
    t0: performance.now(), samples: [{ t: performance.now(), sx: e.sx, sy: e.sy }], picked: !!res.pick,
    press, moved: false, trail: [], vals: new Map(), raf: 0,
    rotate: tg.kind === 'layer' && opt('recRotate', false),
    tolPos: app.pxToDoc(2) / (M.scaleFactor(P0) || 1),
  };
  if (tg.kind === 'layer') {
    r.mode = 'layer';
    if (r.rotate) {
      r.saved = saveChans([tg.pos]);
      r.origin0 = L.origin.slice();
      r.pivotMoved = centerPivot(L);
      r.pivotTo = L.origin.slice();
    }
    r.pos0 = evalCh(tg.pos, f0).slice();
    r.rot0 = evalCh(tg.rot, f0);
    r.chans = r.rotate ? [tg.pos, tg.rot] : [tg.pos];
  } else {
    const B = tg.B, b = tg.b;
    const byId = new Map(B.bones.map((x) => [x.id, x]));
    const isRoot = b.parent == null || !byId.has(b.parent);
    const ik = !!opt('recIK', false);
    const recB = S.layers.get(B.id);
    const Wb = M.mul(recB.bc.world, recB.bc.Mt.get(b.id));
    if (ik && isRoot) {
      r.mode = 'bonemove';
      r.pos0 = evalCh(b.pos, f0).slice();
      r.chans = [b.pos];
    } else if (ik) {
      r.mode = 'ik';
      r.chain = ikChain(B, b);
      r.gl = [Math.max(hit ? (hit.tip ? 1 : hit.t) : 1, 0.35) * b.len, 0];
      const eff = M.apply(Wb, r.gl[0], r.gl[1]);
      r.effOff = [eff[0] - press[0], eff[1] - press[1]];
      r.chans = r.chain.map((x) => x.ang);
    } else {
      r.mode = 'rotate';
      const Pi = M.inv(P0), c = M.apply(Pi, press[0], press[1]), p = evalCh(b.pos, f0);
      const ang0 = evalCh(b.ang, f0);
      r.ang0 = ang0;
      r.angOff = Math.hypot(c[0] - p[0], c[1] - p[1]) > 1e-6 ? ang0 - Math.atan2(c[1] - p[1], c[0] - p[0]) * RAD : 0;
      r.chans = [b.ang];
    }
  }
  // каналы до записи (позиция — до переноса точки вращения, если он был)
  r.saved = r.saved ? r.saved.concat(saveChans(r.chans.slice(1))) : saveChans(r.chans);
  for (const c of r.chans) r.vals.set(c, []);
  R = r;
  window.addEventListener('wheel', onWheel, WHEEL);
  fade = null;
  writeFrame(r, f0);
  r.last = f0;
  app.render();
  app.refresh(['timeline', 'optbar', 'status']);
  r.raf = requestAnimationFrame(tick);
}

function writeFrame(r, k) {
  const tg = r.tg;
  const t = r.t0 + ((k - r.f0) / (r.fps * r.speed)) * 1000;
  const [sx, sy] = pointerAt(r, t);
  const [x, y] = docAt(k, sx, sy);
  const dx = x - r.press[0], dy = y - r.press[1];
  if (Math.hypot(dx, dy) > app.pxToDoc(3)) r.moved = true;
  const S = sceneAt(k);
  if (r.mode === 'layer' || r.mode === 'bonemove') {
    const d = toParentV(parentWorld(tg, S), dx, dy);
    const v = [r.pos0[0] + d[0], r.pos0[1] + d[1]];
    setKey(tg.pos, k, v, 'smooth');
    r.vals.get(tg.pos).push(v);
    r.trail.push([x, y]);
    if (r.rotate) {
      // предпросмотр поворота по направлению движения (итог пересчитывается при отпускании)
      const thr = r.tolPos * 4;
      if (!r.anchor) r.anchor = v;
      else if (Math.hypot(v[0] - r.anchor[0], v[1] - r.anchor[1]) > thr) {
        const a = Math.atan2(v[1] - r.anchor[1], v[0] - r.anchor[0]) * RAD;
        r.dir = unwrapDeg(r.dir, a);
        if (r.dir0 == null) r.dir0 = r.dir;
        r.anchor = v;
      }
      const rot = r.rot0 + (r.dir0 == null ? 0 : r.dir - r.dir0);
      setKey(tg.rot, k, rot, 'smooth');
      r.vals.get(tg.rot).push(rot);
    }
  } else if (r.mode === 'rotate') {
    const b = tg.b;
    const P = parentWorld(tg, S), c = M.apply(M.inv(P), x, y), p = evalCh(b.pos, k);
    const arr = r.vals.get(b.ang);
    const prev = arr.length ? arr[arr.length - 1] : r.ang0;
    let ang = Math.hypot(c[0] - p[0], c[1] - p[1]) > 1e-6 ? unwrapDeg(prev, Math.atan2(c[1] - p[1], c[0] - p[0]) * RAD + r.angOff) : prev;
    if (b.lim) ang = clamp(ang, b.min, b.max);
    setKey(b.ang, k, ang, 'smooth');
    arr.push(ang);
    const Mt = boneMats(tg.B, k), rec = S.layers.get(tg.B.id);
    r.trail.push(M.apply(M.mul(rec.bc.world, Mt.get(b.id)), b.len, 0));
  } else if (r.mode === 'ik') {
    const B = tg.B;
    // старт решения — поза предыдущего кадра (так цепочка не «прыгает»)
    for (const bone of r.chain) {
      const arr = r.vals.get(bone.ang);
      setKey(bone.ang, k, arr.length ? arr[arr.length - 1] : evalCh(bone.ang, k), 'smooth');
    }
    const rec = S.layers.get(B.id);
    const target = M.apply(M.inv(rec.world), x + r.effOff[0], y + r.effOff[1]);
    ikSolve(B, k, r.chain, tg.b.id, r.gl, target);
    for (const bone of r.chain) r.vals.get(bone.ang).push(evalCh(bone.ang, k));
    r.trail.push(M.apply(M.mul(rec.bc.world, boneMats(B, k).get(tg.b.id)), r.gl[0], r.gl[1]));
  }
}

function frameAtTime(r, now) {
  return Math.min(r.fEnd, r.f0 + Math.floor(((now - r.t0) / 1000) * r.fps * r.speed));
}

function tick() {
  const r = R;
  if (!r) return;
  const f = frameAtTime(r, performance.now());
  if (f !== app.frame) app.setFrame(f);
  while (r.last < f) writeFrame(r, ++r.last);
  app.render();
  if (r.last >= r.fEnd) { finish('end'); return; }
  r.raf = requestAnimationFrame(tick);
}

// Поворот по направлению движения — по итоговым (сглаженным) положениям
function rotationFromPath(pos, rot0, thr) {
  const n = pos.length, w = 2;
  const ang = new Array(n).fill(null);
  let prev = null;
  for (let i = 0; i < n; i++) {
    const a = pos[Math.max(0, i - w)], b = pos[Math.min(n - 1, i + w)];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > thr) prev = unwrapDeg(prev, Math.atan2(b[1] - a[1], b[0] - a[0]) * RAD);
    ang[i] = prev;
  }
  const first = ang.find((a) => a != null);
  if (first == null) return null;
  for (let i = 0; i < n && ang[i] == null; i++) ang[i] = first;
  const sm = smoothVals(ang, 3);
  return sm.map((a) => rot0 + a - sm[0]);
}

function finish(reason) {
  const r = R;
  if (!r) return;
  stopRec();
  if (reason === 'up') {
    const f = frameAtTime(r, performance.now());
    while (r.last < f) writeFrame(r, ++r.last);
  }
  restoreChans(r.saved);
  const n = r.last - r.f0 + 1;
  if (!r.moved || n < 2) {
    if (r.origin0) r.tg.L.origin = r.origin0;
    app.setFrame(r.f0);
    quietRefresh();
    const sel = r.picked ? `Выбран ${r.tg.name}. ` : '';
    let msg = r.moved ? 'Слишком коротко — держите кнопку мыши дольше' : `Движения не было. Зажмите кнопку мыши и ведите — ${what(r.tg)} повторит движение`;
    if (r.fEnd <= r.f0) msg = `Анимация кончается на кадре ${r.fEnd} — записывать некуда. Увеличьте конец «Диапазона» внизу (у таймлайна)`;
    app.toast(sel + msg, 4000);
    return;
  }
  const simplify = opt('recSimplify', true);
  let keys = 0;
  if (r.pivotMoved) {
    // вернуть перенос точки вращения (он входит в тот же шаг отмены)
    r.tg.L.origin = r.origin0;
    setOrigin(r.tg.L, r.pivotTo);
  }
  if (r.mode === 'layer' || r.mode === 'bonemove') {
    let pos = r.vals.get(r.tg.pos);
    if (simplify) pos = smoothVals(pos, 2);
    keys = fitKeys(r.tg.pos, r.f0, pos, { tol: r.tolPos, speed: 0.12, all: !simplify });
    if (r.rotate) {
      const rv = rotationFromPath(pos, r.rot0, r.tolPos * 3);
      if (rv) fitKeys(r.tg.rot, r.f0, rv, { tol: 0.8, all: !simplify });
    }
  } else {
    for (const c of r.chans) {
      let v = r.vals.get(c);
      if (simplify) v = smoothVals(v, 2);
      keys = Math.max(keys, fitKeys(c, r.f0, v, { tol: 0.6, speed: 0.12, all: !simplify }));
    }
  }
  const f1 = r.last;
  app.setFrame(r.f0);
  app.commit('Запись движения');
  fade = { pts: r.trail, t: performance.now() };
  animateFade();
  let tail = '';
  if (reason === 'end') tail = n < r.fps ? ` (анимация кончается на кадре ${f1} — для записи подольше увеличьте конец «Диапазона» внизу)` : ' (дошли до конца анимации)';
  const piv = r.pivotMoved ? ' Точка вращения перенесена в центр объекта.' : '';
  app.toast(`Записано: ${r.tg.name}, кадры ${r.f0}–${f1}${tail}, ${keys} ${plural(keys, ['ключ', 'ключа', 'ключей'])}.${piv} Пробел — посмотреть, Ctrl+Z — отменить`, 4500);
  offerTrim(r.chans.map((c) => chanRef(r.tg.L, c)), f1, what(r.tg));
}

// Перерисовать без пометки «есть несохранённые изменения» (документ вернулся к прежнему виду)
function quietRefresh() {
  app.render();
  app.refresh(['inspector', 'timeline', 'optbar', 'status']);
}

function cancel(msg = 'Запись отменена') {
  const r = R;
  if (!r) return;
  stopRec();
  restoreChans(r.saved);
  if (r.origin0) r.tg.L.origin = r.origin0;
  app.setFrame(r.f0);
  quietRefresh();
  if (msg) app.toast(msg);
}

function animateFade() {
  const step = () => {
    if (!fade) return;
    app.render();
    if (performance.now() - fade.t < 1800) requestAnimationFrame(step);
    else { fade = null; app.render(); }
  };
  requestAnimationFrame(step);
}

// Во время записи клавиши не должны менять кадр/инструмент; Esc — отмена
function onKey(ev) {
  if (!R) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  if (ev.type === 'keydown' && ev.key === 'Escape') cancel();
}
window.addEventListener('keydown', onKey, true);
window.addEventListener('keyup', onKey, true);
// колесо мыши во время записи сдвинуло бы вид — объект бы «прыгнул» (слушатель есть только во время записи)
const WHEEL = { capture: true, passive: false };
function onWheel(ev) { if (R) { ev.preventDefault(); ev.stopImmediatePropagation(); } }
function stopRec() {
  if (R) cancelAnimationFrame(R.raf);
  R = null;
  window.removeEventListener('wheel', onWheel, WHEEL);
}
window.addEventListener('blur', () => { if (R) finish('blur'); });
app.on('docloaded', () => { stopRec(); fade = null; });

// Подсветка цели
function drawTarget(ctx, tg, color) {
  if (tg.kind === 'bone') {
    const s = boneScreen(tg.B, tg.b);
    if (!s) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(s.o[0], s.o[1]); ctx.lineTo(s.t[0], s.t[1]); ctx.stroke();
    ctx.restore();
    return;
  }
  const bb = layerBox(tg.L);
  if (bb) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    drawBBox(ctx, bb, color);
    ctx.restore();
  }
  drawOrigin(ctx, tg.L);
}

registerTool({
  id: 'record', name: 'Запись движения', icon: 'record', key: 'j', group: 'anim', simple: true, cursor: 'crosshair', coalesce: true,
  avail: () => true,
  hint: 'Зажмите кнопку мыши на объекте и ведите — он повторяет движение, кадры идут в реальном времени. Отпустите — готово. Esc — отмена. У персонажа тяните за кость. Alt — записать выбранный слой, где бы ни нажали.',
  options: () => [
    { type: 'select', key: 'recSpeed', label: 'Скорость', def: '1.0', items: { '0.25': '0.25× — медленно', '0.5': '0.5×', '1.0': '1× — как в жизни' } },
    { type: 'check', key: 'recSimplify', label: 'Упростить ключи', def: true },
    { type: 'check', key: 'recRotate', label: 'Поворот по движению', def: false, show: () => !app.active || app.active.type !== 'bone' || !selectedBone(app.active) },
    { type: 'check', key: 'recIK', label: 'Кость: тянуть цепочку (IK)', def: false, show: () => !!app.active && !!app.boneLayerFor(app.active) },
  ],
  down(e) { if (!R) start(e); },
  move(e) {
    if (!R) return;
    R.samples.push({ t: performance.now(), sx: e.sx, sy: e.sy });
    if (R.samples.length > 4000) R.samples.splice(0, 2000);
  },
  up(e) {
    if (!R) return;
    R.samples.push({ t: performance.now(), sx: e.sx, sy: e.sy });
    finish('up');
  },
  cancel() { cancel(null); },
  hover(e) {
    app.setCursor('crosshair');
    const res = resolveTarget(e);
    if (targetKey(res) !== targetKey(this.hv)) app.render();
    this.hv = res;
  },
  overlay(ctx) {
    const r = R;
    if (r) {
      strokeDocPath(ctx, r.trail, { color: RED, width: 2.5 });
      drawTarget(ctx, r.tg, RED);
      const blink = Math.floor(performance.now() / 400) % 2 === 0;
      const box = drawPill(ctx, `ЗАПИСЬ  ·  кадр ${app.frame} из ${r.fEnd}  ·  Esc — отмена`, { bg: 'rgba(214,40,57,.92)', dot: blink ? '#fff' : 'rgba(255,255,255,.35)' });
      const k = clamp((app.frame - r.f0) / Math.max(1, r.fEnd - r.f0), 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(box.x + 14, box.y + box.h + 4, box.w - 28, 3);
      ctx.fillStyle = RED;
      ctx.fillRect(box.x + 14, box.y + box.h + 4, (box.w - 28) * k, 3);
      return;
    }
    if (fade) {
      const a = 1 - (performance.now() - fade.t) / 1800;
      if (a > 0) strokeDocPath(ctx, fade.pts, { color: RED, width: 2.5, dash: [7, 5], alpha: a });
    }
    const res = targetAlive(this.hv) ? this.hv : resolveTarget(null);
    if (!res) { drawPill(ctx, 'Наведите на объект, зажмите кнопку мыши и ведите', { dot: RED }); return; }
    if (whyNot(res.L)) return;
    drawTarget(ctx, res.tg, '#ff8a95');
    drawPill(ctx, `Зажмите и ведите: ${res.tg.name} · с кадра ${startFrame()}`, { dot: RED });
  },
});

registerMenu('Анимация', () => [
  { label: 'Запись движения мышью', icon: 'record', key: 'J', action: () => app.cmd.setTool('record') },
]);
