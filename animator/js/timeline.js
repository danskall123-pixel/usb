// Таймлайн: транспорт, линейка, каналы слоёв/костей/камеры, ключи (перетаскивание, копирование, интерполяция).
import { app } from './app.js';
import { h, clamp } from './util.js';
import { icon } from './icons.js';
import { INTERP, INTERP_COLOR, animSettings, keyIndex, shiftKeys, delKey, setKey, evalCh } from './anim.js';
import { layerOwnChannels, pointChannels, styleChannels, boneChannels, boneColor } from './model.js';
import { showMenu, numField, selectField, iconBtn, dialog, checkField } from './ui.js';
import { registry } from './ext.js';

let NAME_W = 210;
const RULER = 24, ROW = 22;
const CH_LABELS = { fill: 'Цвет', stroke: 'Обводка', width: 'Толщина', reveal: 'Показано букв', amt: 'Количество', color: 'Цвет', size: 'Размер' };
const TYPE_COL = { vector: '#ffb054', group: '#9aa3ad', bone: '#4c9dff', switch: '#d38bff', image: '#57c9a6', audio: '#ff6fd8' };

export function initTimeline(root) {
  const bar = h('div', { class: 'tl-bar' });
  const wrap = h('div', { class: 'tl-wrap' });
  const canvas = h('canvas', { tabindex: 0, 'aria-label': 'Таймлайн' });
  wrap.append(canvas);
  root.append(bar, wrap);
  const ctx = canvas.getContext('2d');
  const st = { fw: 14, sx: 0, sy: 0, expanded: new Set(), sel: new Set(), mode: null, rows: [], drag: 0, copy: false, box: null, graph: false, graphRow: null, gsel: null, grange: null };
  app.tlSel = st.sel;
  let dpr = 1, raf = 0;

  // ---------- панель транспорта ----------
  const frameField = numField('Кадр', app.frame, { min: 0, step: 1, prec: 0, onCommit: (v) => app.setFrame(v), width: 48 });
  const playBtn = h('button', { class: 'icon-btn play', title: 'Воспроизвести / пауза (Пробел)', onclick: () => app.emit('toggleplay') }, icon('play', 18));
  const startF = numField('', 1, { min: 0, step: 1, prec: 0, title: 'Начало диапазона', onCommit: (v) => { app.doc.start = Math.round(v); if (app.doc.end < app.doc.start) app.doc.end = app.doc.start; app.commit('Диапазон'); }, width: 42 });
  const endF = numField('–', 72, { min: 1, step: 1, prec: 0, title: 'Конец диапазона', onCommit: (v) => { app.doc.end = Math.max(Math.round(v), app.doc.start); app.commit('Диапазон'); }, width: 42 });
  const fpsF = numField('FPS', 24, { min: 1, max: 120, step: 1, prec: 0, onCommit: (v) => { app.doc.fps = Math.round(v); app.commit('Частота кадров'); app.emit('fps'); }, width: 36 });
  const loopBtn = h('button', { class: 'icon-btn tog', title: 'Зациклить воспроизведение', onclick: () => { app.opts.loop = !app.opts.loop; app.refresh(['timeline']); } }, icon('loop', 18));
  const onionBtn = h('button', { class: 'icon-btn tog', title: 'Луковая кожа', onclick: () => { app.opts.onion = !app.opts.onion; app.refresh(['timeline', 'optbar']); app.render(); } }, icon('onion', 18));
  const onionSet = h('button', { class: 'icon-btn mini', title: 'Настройки луковой кожи', onclick: onionDialog }, icon('down', 14));
  const graphBtn = h('button', { class: 'icon-btn tog', title: 'Режим кривых (графики значений выбранного канала)', onclick: () => { st.graph = !st.graph; graphBtn.classList.toggle('on', st.graph); draw(); } }, icon('graph', 18));
  const interpSel = selectField(null, animSettings.interp, INTERP, (v) => { animSettings.interp = v; });
  interpSel.title = 'Интерполяция новых ключей';
  bar.append(
    h('div', { class: 'tl-grp' },
      iconBtn('first', 'В начало (Home — кадр 0)', () => app.setFrame(app.frame === app.doc.start ? 0 : app.doc.start)),
      iconBtn('prevkey', 'Предыдущий ключ (Shift+←)', () => app.jumpKey(-1)),
      iconBtn('prev', 'Предыдущий кадр (←)', () => app.setFrame(app.frame - 1)),
      playBtn,
      iconBtn('next', 'Следующий кадр (→)', () => app.setFrame(app.frame + 1)),
      iconBtn('nextkey', 'Следующий ключ (Shift+→)', () => app.jumpKey(1)),
      iconBtn('last', 'В конец (End)', () => app.setFrame(app.doc.end)),
    ),
    h('div', { class: 'tl-grp' }, frameField),
    h('div', { class: 'tl-grp' }, h('span', { class: 'tl-lab' }, 'Диапазон'), startF, endF, fpsF, loopBtn),
    h('div', { class: 'tl-grp' }, onionBtn, onionSet, graphBtn),
    h('div', { class: 'tl-grp' },
      h('span', { class: 'tl-lab' }, 'Новые ключи'), interpSel,
      iconBtn('key', 'Ключ всех каналов слоя на кадре (K)', () => app.keyLayer()),
      iconBtn('keydel', 'Удалить ключи слоя на кадре', () => app.unkeyLayer()),
    ),
    h('div', { class: 'tl-grp right' },
      iconBtn('plus', 'Крупнее (Ctrl+колесо)', () => zoom(1.25)),
      h('button', { class: 'icon-btn', title: 'Мельче', onclick: () => zoom(0.8) }, h('span', { class: 'minus' }, '−')),
    ),
  );

  function onionDialog() {
    const o = app.opts;
    const set = (k) => (v) => { o[k] = v; app.render(); };
    dialog({
      title: 'Луковая кожа',
      width: 340,
      body: h('div', { class: 'form' },
        checkField('Включить', o.onion, (v) => { o.onion = v; app.refresh(['timeline', 'optbar']); app.render(); }),
        numField('Кадров до', o.onionBefore, { min: 0, max: 12, step: 1, prec: 0, onCommit: set('onionBefore') }),
        numField('Кадров после', o.onionAfter, { min: 0, max: 12, step: 1, prec: 0, onCommit: set('onionAfter') }),
        numField('Шаг', o.onionStep, { min: 1, max: 24, step: 1, prec: 0, onCommit: set('onionStep') }),
        numField('Непрозрачн.', o.onionOpacity, { min: 0.05, max: 1, step: 0.05, prec: 2, onCommit: set('onionOpacity') }),
        checkField('Только активный слой', o.onionActive, set('onionActive')),
        h('p', { class: 'insp-note' }, 'Красным — предыдущие кадры, синим — следующие.'),
      ),
      buttons: [{ label: 'Готово', primary: true }],
    });
  }

  // ---------- строки ----------
  function buildRows() {
    const doc = app.doc, out = [];
    const cam = doc.cam;
    out.push({ id: 'cam', label: 'Камера', depth: 0, exp: true, col: '#e0e0e0', chans: [cam.pos, cam.zoom, cam.roll], kind: 'cam' });
    if (st.expanded.has('cam')) {
      out.push({ id: 'cam:pos', label: 'Положение', depth: 1, chans: [cam.pos], sub: true });
      out.push({ id: 'cam:zoom', label: 'Зум', depth: 1, chans: [cam.zoom], sub: true });
      out.push({ id: 'cam:roll', label: 'Наклон', depth: 1, chans: [cam.roll], sub: true });
    }
    const walk = (arr, depth) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const L = arr[i];
        const rid = 'L' + L.id;
        out.push({ id: rid, label: L.name, depth, layer: L, exp: L.type !== 'audio', col: TYPE_COL[L.type] || (registry.layerTypes[L.type] && registry.layerTypes[L.type].color) || '#cfd5dc', chans: layerOwnChannels(L), kind: 'layer' });
        if (st.expanded.has(rid)) {
          const d = depth + 1;
          out.push({ id: rid + ':pos', label: 'Положение', depth: d, layer: L, chans: [L.pos], sub: true });
          out.push({ id: rid + ':rot', label: 'Поворот', depth: d, layer: L, chans: [L.rot], sub: true });
          out.push({ id: rid + ':scl', label: 'Масштаб', depth: d, layer: L, chans: [L.scl], sub: true });
          out.push({ id: rid + ':op', label: 'Непрозрачность', depth: d, layer: L, chans: [L.op], sub: true });
          if (L.type === 'vector') {
            out.push({ id: rid + ':pts', label: 'Точки', depth: d, layer: L, chans: pointChannels(L), sub: true });
            out.push({ id: rid + ':sty', label: 'Стиль', depth: d, layer: L, chans: styleChannels(L), sub: true });
          }
          if (L.type === 'switch') out.push({ id: rid + ':sw', label: 'Переключение', depth: d, layer: L, chans: [L.sw], sub: true });
          const xt = registry.layerTypes[L.type];
          if (xt && xt.channels) {
            // строки каналов типов слоёв из модулей: rows(L) → [{ label, chans }] или по имени поля
            const rows = xt.rows ? xt.rows(L) : xt.channels(L).map((c) => {
              const key = Object.keys(L).find((k) => L[k] === c);
              return { label: (xt.channelLabels && xt.channelLabels[key]) || CH_LABELS[key] || key || 'Канал', chans: [c] };
            });
            rows.forEach((rw, j) => out.push({ id: rid + ':x' + j, label: rw.label, depth: d, layer: L, chans: rw.chans, sub: true }));
          }
          if (L.type === 'bone') for (const b of L.bones) out.push({ id: rid + ':b' + b.id, label: b.name, depth: d, layer: L, bone: b, col: boneColor(L, b.id), chans: boneChannels(b), names: ['Положение', 'Угол', 'Масштаб'], sub: true });
        }
        if (L.children && L.open) walk(L.children, depth + 1);
      }
    };
    walk(doc.layers, 0);
    return out;
  }

  // ---------- геометрия ----------
  const W = () => canvas.width / dpr, H = () => canvas.height / dpr;
  const fx = (f) => NAME_W + f * st.fw - st.sx;
  const xf = (x) => Math.floor((x - NAME_W + st.sx) / st.fw);
  const rowAt = (y) => { const i = Math.floor((y - RULER + st.sy) / ROW); return i >= 0 && i < st.rows.length ? i : -1; };
  const maxSy = () => Math.max(0, st.rows.length * ROW - (H() - RULER) + 6);
  function zoom(k, ax = NAME_W + (W() - NAME_W) / 2) {
    const f = (ax - NAME_W + st.sx) / st.fw;
    st.fw = clamp(st.fw * k, 3, 60);
    st.sx = Math.max(0, f * st.fw - (ax - NAME_W));
    draw();
  }
  function ensureVisible(f) {
    const x = fx(f);
    if (x < NAME_W + 10) st.sx = Math.max(0, f * st.fw - 30);
    else if (x > W() - 20) st.sx = f * st.fw - (W() - NAME_W) + 60;
  }

  const resize = () => {
    NAME_W = wrap.clientWidth < 640 ? 130 : 210;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
    canvas.style.width = wrap.clientWidth + 'px';
    canvas.style.height = wrap.clientHeight + 'px';
    draw();
  };
  new ResizeObserver(resize).observe(wrap);

  function keyMap(chans) {
    const m = new Map();
    for (const c of chans) for (const k of c.k) if (!m.has(k.f)) m.set(k.f, k.i);
    return m;
  }

  function diamond(x, y, r, col, sel, shape) {
    ctx.beginPath();
    if (shape === 'step') ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
    else if (shape === 'linear') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); }
    else if (shape === 'ease' || shape === 'in' || shape === 'out') ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
    else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,.6)';
    ctx.stroke();
  }

  function draw() {
    raf = 0;
    if (!app.doc) return;
    st.rows = buildRows();
    st.sy = clamp(st.sy, 0, maxSy());
    const w = W(), hh = H(), doc = app.doc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1c1e22';
    ctx.fillRect(0, 0, w, hh);
    const f0 = Math.max(0, xf(NAME_W)), f1 = xf(w) + 1;
    // диапазон
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    const rs = fx(doc.start), re = fx(doc.end + 1);
    if (rs > NAME_W) ctx.fillRect(NAME_W, RULER, rs - NAME_W, hh);
    if (re < w) ctx.fillRect(Math.max(NAME_W, re), RULER, w - re, hh);
    // кадр 0 — поза покоя
    if (fx(0) + st.fw > NAME_W) { ctx.fillStyle = 'rgba(76,157,255,.08)'; ctx.fillRect(Math.max(NAME_W, fx(0)), RULER, st.fw, hh); }
    // строки
    ctx.save();
    ctx.beginPath(); ctx.rect(0, RULER, w, hh - RULER); ctx.clip();
    const i0 = Math.max(0, Math.floor(st.sy / ROW)), i1 = Math.min(st.rows.length, Math.ceil((st.sy + hh - RULER) / ROW));
    const dragD = st.mode === 'drag' ? st.drag : 0;
    for (let i = i0; i < i1; i++) {
      const r = st.rows[i], y = RULER + i * ROW - st.sy;
      const active = r.layer && r.layer.id === app.activeId && !r.sub;
      const boneSel = r.bone && app.sel.bones.has(r.bone.id);
      ctx.fillStyle = active ? '#2b3a52' : boneSel ? '#3a2b30' : i % 2 ? '#202227' : '#1d1f23';
      ctx.fillRect(0, y, w, ROW);
      // вертикальные метки каждые 5/10 кадров
      if (st.fw >= 6) {
        ctx.fillStyle = 'rgba(255,255,255,.035)';
        for (let f = Math.floor(f0 / 5) * 5; f <= f1; f += 5) if (f % 10 === 0) ctx.fillRect(fx(f), y, 1, ROW);
      }
      // аудио
      if (r.layer && r.layer.type === 'audio') drawWave(r.layer, y);
      // ключи
      const km = st.graph ? new Map() : keyMap(r.chans);
      const cy = y + ROW / 2, rad = Math.min(6, Math.max(3, st.fw * 0.42));
      for (const [f, it] of km) {
        if (f < f0 - 1 || f > f1 + 1) continue;
        const sel = st.sel.has(r.id + '|' + f);
        const ff = sel && f > 0 ? Math.max(1, f + dragD) : f;
        diamond(fx(ff) + st.fw / 2, cy, rad, f === 0 ? '#7d8592' : INTERP_COLOR[it] || '#5fb3ff', sel, it);
        if (sel && dragD && st.copy && f > 0) diamond(fx(f) + st.fw / 2, cy, rad * 0.7, 'rgba(255,255,255,.25)', false, it);
      }
      // колонка имён
      const gRow = st.graph && r.id === graphRowId();
      ctx.fillStyle = gRow ? '#3b4f2e' : active ? '#2f4466' : boneSel ? '#45303a' : i % 2 ? '#24262b' : '#212328';
      ctx.fillRect(0, y, NAME_W, ROW);
      const x = 8 + r.depth * 13;
      ctx.fillStyle = '#9aa3ad';
      if (r.exp) {
        ctx.beginPath();
        if (st.expanded.has(r.id)) { ctx.moveTo(x, cy - 2.5); ctx.lineTo(x + 8, cy - 2.5); ctx.lineTo(x + 4, cy + 2.5); }
        else { ctx.moveTo(x + 2, cy - 4); ctx.lineTo(x + 7, cy); ctx.lineTo(x + 2, cy + 4); }
        ctx.fill();
      }
      if (r.col) { ctx.fillStyle = r.col; ctx.fillRect(x + 12, cy - 4, r.sub ? 4 : 8, 8); }
      ctx.fillStyle = r.sub ? '#9aa3ad' : r.layer && !r.layer.vis ? '#6c737c' : '#d7dbe0';
      ctx.font = (r.sub ? '11px ' : '12px ') + 'Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(r.label, NAME_W - x - 30), x + 24, cy + 0.5);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, y + ROW - 1, w, 1);
    }
    ctx.restore();
    if (st.graph) drawGraph(w, hh, f0, f1);
    ctx.fillStyle = '#121316';
    ctx.fillRect(NAME_W - 1, RULER, 1, hh);
    if (!st.rows.length) { ctx.fillStyle = '#6c737c'; ctx.font = '12px Inter, system-ui'; ctx.fillText('Нет слоёв', NAME_W + 12, RULER + 16); }
    drawRuler(w, f0, f1);
    // курсор кадра
    const px = fx(app.frame) + st.fw / 2;
    if (px >= NAME_W) {
      ctx.fillStyle = '#ff4d5a';
      ctx.fillRect(Math.round(px) - 0.5, RULER, 1.5, hh);
      const lab = String(app.frame);
      ctx.font = 'bold 11px Inter, system-ui';
      const tw = ctx.measureText(lab).width + 10;
      roundRect(px - tw / 2, 3, tw, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(lab, px, 12);
      ctx.textAlign = 'left';
    }
    // рамка выделения
    if (st.box) {
      const b = st.box;
      ctx.strokeStyle = '#7fb6ff';
      ctx.fillStyle = 'rgba(90,150,255,.1)';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.setLineDash([]);
    }
    // полоса прокрутки по вертикали
    const ms = maxSy();
    if (ms > 0) {
      const vh = hh - RULER, th = Math.max(20, (vh * vh) / (vh + ms));
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      roundRect(w - 6, RULER + ((vh - th) * st.sy) / ms, 4, th, 2);
      ctx.fill();
    }
  }

  // ---------- режим кривых ----------
  const COMP_COL = ['#ff6b6b', '#6bdc6b', '#5fb3ff', '#ffd84d', '#d38bff', '#57c9a6', '#ffad5c', '#ff6fd8'];
  const AX = ['X', 'Y', 'Z', 'W'];
  function graphRowId() {
    if (st.graphRow && st.rows.some((r) => r.id === st.graphRow)) return st.graphRow;
    return 'L' + app.activeId;
  }
  function graphComps() {
    let r = st.rows.find((x) => x.id === graphRowId());
    const A = app.active;
    // по умолчанию: выделенная кость или трансформация активного слоя
    if ((!st.graphRow || !r) && A) {
      const b = A.type === 'bone' && A.bones.find((x) => app.sel.bones.has(x.id));
      if (b) r = { id: 'L' + A.id + ':b' + b.id, label: b.name, chans: boneChannels(b), names: ['Положение', 'Угол', 'Масштаб'] };
      else r = { id: 'L' + A.id, label: A.name, chans: [A.pos, A.rot, A.scl, A.op], names: ['Положение', 'Поворот', 'Масштаб', 'Непрозр.'] };
    }
    if (r && r.kind === 'layer' && r.layer) { const X = r.layer; r = { id: r.id, label: X.name, chans: [X.pos, X.rot, X.scl, X.op], names: ['Положение', 'Поворот', 'Масштаб', 'Непрозр.'] }; }
    if (r && r.kind === 'cam') r = { ...r, names: ['Положение', 'Зум', 'Наклон'] };
    if (!r) return null;
    const comps = [];
    r.chans.forEach((c, ci) => {
      const v = c.k[0].v;
      const nm = r.names ? r.names[ci] : r.chans.length === 1 ? r.label : r.label + ' ' + (ci + 1);
      if (typeof v === 'number') comps.push({ c, j: -1, name: nm });
      else if (Array.isArray(v)) v.forEach((_, j) => comps.push({ c, j, name: nm + ' ' + (v.length === 4 ? 'RGBA'[j] : AX[j]) }));
    });
    // если что-то анимировано — показываем только анимированные каналы (иначе статичные значения сжимают масштаб)
    const anim = comps.filter((cp) => cp.c.k.length > 1);
    return { r, comps: anim.length ? anim : comps };
  }
  const compVal = (c, j, f) => { const v = evalCh(c, f); return j < 0 ? v : v[j]; };
  function gGeom(hh) { return { top: RULER + 14, bot: hh - 12 }; }
  function drawGraph(w, hh, f0, f1) {
    const { top, bot } = gGeom(hh);
    ctx.save();
    ctx.beginPath(); ctx.rect(NAME_W, RULER, w - NAME_W, hh - RULER); ctx.clip();
    ctx.fillStyle = '#18191c';
    ctx.fillRect(NAME_W, RULER, w - NAME_W, hh - RULER);
    const g = graphComps();
    ctx.font = '12px Inter, system-ui';
    ctx.textBaseline = 'middle';
    if (!g || !g.comps.length || g.comps.length > 12) {
      ctx.fillStyle = '#8b939d';
      ctx.fillText(g && g.comps.length > 12 ? 'Слишком много каналов: разверните слой (▸) и выберите строку канала слева.' : 'Выберите строку канала слева (разверните слой ▸).', NAME_W + 16, RULER + 24);
      ctx.restore();
      return;
    }
    let mn = Infinity, mx = -Infinity;
    if (st.mode === 'gdrag' && st.grange) [mn, mx] = st.grange;
    else {
      for (const cp of g.comps) {
        for (let f = Math.max(0, f0); f <= f1; f++) { const v = compVal(cp.c, cp.j, f); if (v < mn) mn = v; if (v > mx) mx = v; }
        for (const k of cp.c.k) { const v = cp.j < 0 ? k.v : k.v[cp.j]; if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      if (!isFinite(mn)) { mn = 0; mx = 1; }
      if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
      const pad = (mx - mn) * 0.12;
      mn -= pad; mx += pad;
      st.grange = [mn, mx];
    }
    const vy = (v) => bot - ((v - mn) / (mx - mn)) * (bot - top);
    const raw = (mx - mn) / 5, p10 = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p10;
    const step = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p10;
    ctx.font = '10px Inter, system-ui';
    for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) {
      const y = Math.round(vy(v)) + 0.5;
      ctx.fillStyle = Math.abs(v) < step / 2 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.06)';
      ctx.fillRect(NAME_W, y, w - NAME_W, 1);
      ctx.fillStyle = '#6c737c';
      ctx.fillText(String(+v.toFixed(4)), NAME_W + 4, y - 7);
    }
    const sub = st.fw >= 10 ? 4 : st.fw >= 5 ? 2 : 1;
    g.comps.forEach((cp, ni) => {
      const col = COMP_COL[ni % COMP_COL.length];
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const a = Math.max(0, f0) * sub, b = f1 * sub;
      for (let s = a; s <= b; s++) {
        const f = s / sub, x = fx(f) + st.fw / 2, y = vy(compVal(cp.c, cp.j, f));
        if (s === a) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (const k of cp.c.k) {
        if (k.f < f0 - 1 || k.f > f1 + 1) continue;
        const v = cp.j < 0 ? k.v : k.v[cp.j];
        const sel = st.gsel && st.gsel.c === cp.c && st.gsel.j === cp.j && st.gsel.f === k.f;
        ctx.beginPath();
        ctx.arc(fx(k.f) + st.fw / 2, vy(v), sel ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = k.f === 0 ? '#7d8592' : col;
        ctx.fill();
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.7)';
        ctx.stroke();
      }
    });
    // легенда
    ctx.font = '11px Inter, system-ui';
    let lx = w - 14;
    for (let ni = g.comps.length - 1; ni >= 0; ni--) {
      const t = g.comps[ni].name, tw = ctx.measureText(t).width;
      lx -= tw + 22;
      ctx.fillStyle = COMP_COL[ni % COMP_COL.length];
      ctx.fillRect(lx, RULER + 9, 10, 3);
      ctx.fillStyle = '#c4cad1';
      ctx.fillText(t, lx + 14, RULER + 11);
    }
    ctx.restore();
  }
  function graphHit(x, y) {
    const g = graphComps();
    if (!g || g.comps.length > 12 || !st.grange) return null;
    const { top, bot } = gGeom(H());
    const [mn, mx] = st.grange;
    const vy = (v) => bot - ((v - mn) / (mx - mn)) * (bot - top);
    let best = null, bd = 8;
    for (const cp of g.comps) for (const k of cp.c.k) {
      const v = cp.j < 0 ? k.v : k.v[cp.j];
      const d = Math.hypot(fx(k.f) + st.fw / 2 - x, vy(v) - y);
      if (d < bd) { bd = d; best = { c: cp.c, j: cp.j, f: k.f, v }; }
    }
    return best;
  }

  function fitText(t, max) {
    ctx.font = '12px Inter, system-ui, sans-serif';
    if (ctx.measureText(t).width <= max) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }
  function roundRect(x, y, w, hh, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, r) : ctx.rect(x, y, w, hh); }

  function drawRuler(w, f0, f1) {
    ctx.fillStyle = '#26282d';
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, RULER - 1, w, 1);
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const step = steps.find((s) => s * st.fw >= 36) || 1000;
    ctx.font = '10px Inter, system-ui';
    ctx.textBaseline = 'alphabetic';
    for (let f = Math.max(0, Math.floor(f0 / step) * step); f <= f1; f += step) {
      const x = fx(f) + st.fw / 2;
      if (x < NAME_W) continue;
      ctx.fillStyle = '#5c636d';
      ctx.fillRect(Math.round(x), RULER - 8, 1, 7);
      ctx.fillStyle = f === 0 ? '#7fb6ff' : '#9aa3ad';
      ctx.fillText(String(f), x + 3, RULER - 10);
    }
    if (st.fw >= 5) {
      ctx.fillStyle = '#3f444c';
      for (let f = f0; f <= f1; f++) { const x = fx(f) + st.fw / 2; if (x >= NAME_W) ctx.fillRect(Math.round(x), RULER - 4, 1, 3); }
    }
    ctx.fillStyle = '#26282d';
    ctx.fillRect(0, 0, NAME_W, RULER);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '11px Inter, system-ui';
    const fps = app.doc.fps;
    ctx.fillText(`${(app.frame / fps).toFixed(2)} с · ${fps} к/с`, 10, 16);
  }

  function drawWave(L, y) {
    const a = app.audio.get(L.asset);
    if (!a || !a.buffer) return;
    const peaks = a.peaksFor(app.doc.fps);
    ctx.fillStyle = 'rgba(255,111,216,.55)';
    const mid = y + ROW / 2;
    const f0 = Math.max(0, xf(NAME_W)), f1 = xf(W()) + 1;
    for (let f = f0; f <= f1; f++) {
      const i = f - L.start;
      if (i < 0 || i >= peaks.length) continue;
      const v = peaks[i] * (ROW / 2 - 2);
      ctx.fillRect(fx(f) + 1, mid - v, Math.max(1, st.fw - 2), v * 2);
    }
  }

  // ---------- операции с ключами ----------
  function selByChannel() {
    const byId = new Map(st.rows.map((r) => [r.id, r]));
    const m = new Map();
    for (const s of st.sel) {
      const j = s.lastIndexOf('|'), r = byId.get(s.slice(0, j)), f = +s.slice(j + 1);
      if (!r) continue;
      for (const c of r.chans) if (keyIndex(c, f) >= 0) { if (!m.has(c)) m.set(c, new Set()); m.get(c).add(f); }
    }
    return m;
  }
  function moveSel(d, copy) {
    if (!d) return;
    const m = selByChannel();
    for (const [c, frames] of m) shiftKeys(c, frames, d, copy);
    const ns = new Set();
    for (const s of st.sel) { const j = s.lastIndexOf('|'), f = +s.slice(j + 1); ns.add(s.slice(0, j) + '|' + (f > 0 ? Math.max(1, f + d) : f)); }
    st.sel.clear();
    ns.forEach((x) => st.sel.add(x));
    app.commit(copy ? 'Копирование ключей' : 'Сдвиг ключей');
  }
  function deleteSel() {
    const m = selByChannel();
    let n = 0;
    for (const [c, frames] of m) for (const f of frames) if (delKey(c, f)) n++;
    st.sel.clear();
    if (n) app.commit('Удаление ключей');
    else app.toast('Ключи кадра 0 (поза покоя) не удаляются');
    draw();
  }
  function setInterp(i) {
    for (const [c, frames] of selByChannel()) for (const k of c.k) if (frames.has(k.f)) k.i = i;
    app.commit('Интерполяция: ' + INTERP[i]);
  }
  function copySel() {
    const byId = new Map(st.rows.map((r) => [r.id, r]));
    const items = [];
    let base = Infinity;
    for (const s of st.sel) {
      const j = s.lastIndexOf('|'), rid = s.slice(0, j), f = +s.slice(j + 1), r = byId.get(rid);
      if (!r) continue;
      r.chans.forEach((c, ci) => { const ki = keyIndex(c, f); if (ki >= 0) { items.push({ rid, ci, f, v: JSON.parse(JSON.stringify(c.k[ki].v)), i: c.k[ki].i }); base = Math.min(base, f); } });
    }
    if (!items.length) return false;
    app.clipboard = { type: 'keys', base, items };
    app.toast(`Скопировано ключей: ${items.length}`);
    return true;
  }
  function paste() {
    const cb = app.clipboard;
    if (!cb || cb.type !== 'keys') return false;
    const byId = new Map(st.rows.map((r) => [r.id, r]));
    let n = 0;
    st.sel.clear();
    for (const it of cb.items) {
      const r = byId.get(it.rid);
      const c = r && r.chans[it.ci];
      if (!c) continue;
      const f = app.frame + (it.f - cb.base);
      setKey(c, f, it.v, it.i);
      st.sel.add(it.rid + '|' + f);
      n++;
    }
    if (n) app.commit('Вставка ключей'); else app.toast('Нет подходящих каналов для вставки');
    return true;
  }
  app.timelineOps = {
    deleteSel, copySel, paste, hasSel: () => st.sel.size > 0,
    selectAll: () => { for (const r of st.rows) for (const f of keyMap(r.chans).keys()) st.sel.add(r.id + '|' + f); draw(); },
    // Map(канал → Set(кадров)) выделенных ключей
    selection: () => selByChannel(),
    // строки таймлайна { id, label, layer?, bone?, chans } и выделение 'rowId|кадр'
    rows: () => st.rows,
    selectedIds: () => st.sel,
    setSelected: (ids) => { st.sel.clear(); for (const x of ids) st.sel.add(x); draw(); },
    redraw: () => draw(),
  };

  function hitKey(x, y) {
    const i = rowAt(y);
    if (i < 0 || x < NAME_W) return null;
    const r = st.rows[i], f = Math.round((x - NAME_W + st.sx - st.fw / 2) / st.fw);
    const km = keyMap(r.chans);
    for (const ff of [f, f - 1, f + 1]) {
      if (!km.has(ff)) continue;
      if (Math.abs(fx(ff) + st.fw / 2 - x) <= Math.max(6, st.fw / 2)) return { r, f: ff, id: r.id + '|' + ff };
    }
    return null;
  }

  function selectRow(r) {
    if (r.kind === 'cam') return;
    if (r.layer) app.setActive(r.layer.id);
    if (r.bone) { app.sel.bones.clear(); app.sel.bones.add(r.bone.id); app.refresh(); app.render(); }
  }

  // ---------- мышь ----------
  const pos = (ev) => { const b = canvas.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.focus({ preventScroll: true });
    app.focus = 'timeline';
    if (ev.button === 2) return;
    const [x, y] = pos(ev);
    canvas.setPointerCapture(ev.pointerId);
    st.x0 = x; st.y0 = y; st.moved = false;
    if (y < RULER && x > NAME_W) { st.mode = 'scrub'; app.emit('stop'); app.setFrame(Math.max(0, xf(x))); app.emit('scrub'); return; }
    if (x < NAME_W) {
      const i = rowAt(y);
      st.mode = null;
      if (i < 0) return;
      const r = st.rows[i], ax = 8 + r.depth * 13;
      if (r.exp && x >= ax - 4 && x <= ax + 12) { if (st.expanded.has(r.id)) st.expanded.delete(r.id); else st.expanded.add(r.id); draw(); return; }
      st.graphRow = r.id;
      selectRow(r);
      draw();
      return;
    }
    if (st.graph) {
      const gk = graphHit(x, y);
      if (gk) { st.gsel = gk; st.mode = 'gdrag'; st.gv0 = gk.v; app.setFrame(gk.f); draw(); return; }
      st.gsel = null; st.mode = 'scrub'; app.setFrame(Math.max(0, xf(x))); return;
    }
    const k = hitKey(x, y);
    if (k) {
      if (ev.shiftKey) { if (st.sel.has(k.id)) st.sel.delete(k.id); else st.sel.add(k.id); }
      else if (!st.sel.has(k.id)) { st.sel.clear(); st.sel.add(k.id); }
      st.mode = 'drag'; st.drag = 0; st.copy = ev.altKey; st.key = k;
      draw();
      return;
    }
    st.mode = 'box';
    if (!ev.shiftKey) st.sel.clear();
    st.box = { x0: x, y0: y, x1: x, y1: y };
    draw();
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = pos(ev);
    if (!st.mode) { canvas.style.cursor = y < RULER ? 'ew-resize' : hitKey(x, y) ? 'grab' : 'default'; return; }
    if (Math.hypot(x - st.x0, y - st.y0) > 3) st.moved = true;
    if (st.mode === 'scrub') { app.setFrame(Math.max(0, xf(x))); app.emit('scrub'); }
    else if (st.mode === 'gdrag') {
      const { top, bot } = gGeom(H()), [mn, mx] = st.grange;
      let v = st.gv0 - ((y - st.y0) * (mx - mn)) / (bot - top);
      if (ev.shiftKey) v = Math.round(v);
      const key = st.gsel.c.k.find((k) => k.f === st.gsel.f);
      if (key) { if (st.gsel.j < 0) key.v = v; else { key.v = key.v.slice(); key.v[st.gsel.j] = v; } }
      app.changed();
      draw();
    }
    else if (st.mode === 'drag') { const d = Math.round((x - st.x0) / st.fw); if (d !== st.drag) { st.drag = d; draw(); } st.copy = ev.altKey; }
    else if (st.mode === 'box') { st.box.x1 = x; st.box.y1 = y; draw(); }
  });
  const up = (ev) => {
    const [x] = pos(ev);
    if (st.mode === 'gdrag') { if (st.moved) app.commit('Правка кривой'); }
    else if (st.mode === 'drag') {
      if (st.drag) moveSel(st.drag, st.copy);
      else if (!st.moved) app.setFrame(st.key.f);
    } else if (st.mode === 'box') {
      const b = st.box;
      if (!st.moved) app.setFrame(Math.max(0, xf(x)));
      else {
        const xa = Math.min(b.x0, b.x1), xb = Math.max(b.x0, b.x1), ya = Math.min(b.y0, b.y1), yb = Math.max(b.y0, b.y1);
        st.rows.forEach((r, i) => {
          const ry = RULER + i * ROW - st.sy + ROW / 2;
          if (ry < ya || ry > yb) return;
          for (const f of keyMap(r.chans).keys()) { const kx = fx(f) + st.fw / 2; if (kx >= xa && kx <= xb) st.sel.add(r.id + '|' + f); }
        });
      }
      st.box = null;
    }
    st.mode = null; st.drag = 0;
    draw();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', (ev) => {
    const [x, y] = pos(ev);
    if (x < NAME_W) { const i = rowAt(y); if (i >= 0 && st.rows[i].layer && !st.rows[i].sub) app.emit('renameLayer', st.rows[i].layer); }
  });
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    app.focus = 'timeline';
    const [x, y] = pos(ev);
    const k = hitKey(x, y);
    if (k && !st.sel.has(k.id)) { st.sel.clear(); st.sel.add(k.id); draw(); }
    const has = st.sel.size > 0;
    const i = rowAt(y);
    const r = i >= 0 ? st.rows[i] : null;
    const f = Math.max(0, xf(x));
    showMenu([
      { title: has ? `Ключей выделено: ${st.sel.size}` : 'Таймлайн' },
      { label: 'Интерполяция', disabled: !has, sub: Object.entries(INTERP).map(([id, name]) => ({ label: name, action: () => setInterp(id) })) },
      { label: 'Копировать ключи', key: 'Ctrl+C', disabled: !has, action: copySel },
      { label: 'Вставить на текущий кадр', key: 'Ctrl+V', disabled: !app.clipboard || app.clipboard.type !== 'keys', action: paste },
      { label: 'Удалить ключи', key: 'Del', disabled: !has, action: deleteSel },
      { sep: true },
      { label: `Ключ в строке на кадре ${f}`, disabled: !r, action: () => { for (const c of r.chans) setKey(c, f, evalCh(c, f)); app.commit('Новый ключ'); } },
      { label: 'Выделить все ключи', key: 'Ctrl+A', action: () => app.timelineOps.selectAll() },
      { label: 'Снять выделение', disabled: !has, action: () => { st.sel.clear(); draw(); } },
      ...(() => {
        const ext = registry.timelineMenu.flatMap((fn) => { try { return fn({ row: r, frame: f, selCount: st.sel.size, selection: selByChannel }) || []; } catch (e) { console.error(e); return []; } });
        return ext.length ? [{ sep: true }, ...ext] : [];
      })(),
    ], ev.clientX, ev.clientY);
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [x] = pos(ev);
    if (ev.ctrlKey || ev.metaKey) { zoom(Math.exp(-ev.deltaY * 0.004), Math.max(NAME_W, x)); return; }
    const horiz = ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || maxSy() === 0;
    if (horiz) st.sx = Math.max(0, st.sx + (ev.deltaX || ev.deltaY));
    else st.sy = clamp(st.sy + ev.deltaY, 0, maxSy());
    draw();
  }, { passive: false });

  app.on('frame', (f) => { if (app.playing || st.mode !== 'scrub') ensureVisible(f); });

  app.registerPanel('timeline', () => {
    frameField.set(app.frame);
    startF.set(app.doc.start);
    endF.set(app.doc.end);
    fpsF.set(app.doc.fps);
    loopBtn.classList.toggle('on', !!app.opts.loop);
    onionBtn.classList.toggle('on', !!app.opts.onion);
    playBtn.replaceChildren(icon(app.playing ? 'pause' : 'play', 18));
    if (!raf) raf = requestAnimationFrame(draw);
  });
  app.on('docloaded', () => { st.sel.clear(); st.sx = 0; st.sy = 0; });
  resize();
}
