// Панели: инструменты, параметры инструмента, слои, свойства.
import { app } from './app.js';
import { h } from './util.js';
import { icon } from './icons.js';
import { setKey, evalCh } from './anim.js';
import { tools, TOOL_ORDER, GROUPS, cleanupPaths, placeFrame } from './tools.js';
import { BLEND_MODES, typeLabel, boneAncestor } from './model.js';
import { numField, rangeField, checkField, selectField, colorField, showMenu, iconBtn } from './ui.js';
import { registry } from './ext.js';

const TYPE_ICON0 = { vector: 'vector', group: 'group', bone: 'bone', switch: 'switch', image: 'image', audio: 'audio' };
export const TYPE_ICON = new Proxy(TYPE_ICON0, { get: (o, k) => o[k] || (registry.layerTypes[k] && registry.layerTypes[k].icon) || 'vector' });
const LAYER_TYPES = new Proxy({}, { get: (o, k) => typeLabel(k) });
export const layerIcon = (L) => { for (const fn of registry.hooks.layerIcon || []) { const r = fn(L); if (r) return r; } return TYPE_ICON[L.type]; };
export const layerLabel = (L) => { for (const fn of registry.hooks.layerLabel || []) { const r = fn(L); if (r) return r; } return LAYER_TYPES[L.type]; };
const creatableTypes = () => ['vector', 'group', 'bone', 'switch'].concat(Object.keys(registry.layerTypes).filter((t) => registry.layerTypes[t].creatable));

export function setTool(id) {
  const t = tools[id];
  if (!t) return;
  if (!t.avail()) { app.toast(`«${t.name}» недоступен для этого слоя`); return; }
  if (app.tool !== id) {
    const prev = tools[app.tool];
    if (prev && prev.cancel) prev.cancel();
    cleanupPaths(app.active);
  }
  app.tool = id;
  app.lastTool[app.ctxKind()] = id;
  app.setCursor && app.setCursor(t.cursor || 'default');
  app.refresh(['toolbox', 'optbar', 'status']);
  app.render();
}

app.on('fixtool', () => {
  const t = tools[app.tool];
  const kind = app.ctxKind();
  const want = app.lastTool[kind];
  // текущий инструмент остаётся, если он доступен; на слое костей рисующие инструменты сменяются костяными
  const ok = (x) => x && x.avail() && (!app.opts.simple || x.simple);
  if (ok(t) && !(kind === 'bone' && (t.group === 'draw' || t.group === 'fill'))) return;
  const fall = { vector: 'transform', bone: 'bmanip', other: 'ltransform' }[kind];
  const id = want && ok(tools[want]) ? want : ok(tools[fall]) ? fall : 'hand';
  app.tool = id;
  app.refresh(['toolbox', 'optbar', 'status']);
});

// ---------- Панель инструментов ----------
export function initToolbox(el) {
  app.registerPanel('toolbox', () => {
    el.textContent = '';
    el.classList.toggle('simple', !!app.opts.simple);
    let grp = null;
    const gOrder = Object.keys(GROUPS);
    const ids = TOOL_ORDER.filter((id) => !app.opts.simple || tools[id].simple)
      .map((id, i) => [id, i]).sort((a, b) => (gOrder.indexOf(tools[a[0]].group) - gOrder.indexOf(tools[b[0]].group)) || a[1] - b[1]).map((x) => x[0]);
    for (const id of ids) {
      const t = tools[id];
      if (t.group !== grp) {
        grp = t.group;
        el.append(h('div', { class: 'tb-group', title: GROUPS[grp] || grp }, GROUPS[grp] || grp));
      }
      const av = t.avail();
      el.append(h('button', {
        class: 'tb-btn' + (app.tool === id ? ' on' : '') + (av ? '' : ' na'),
        title: `${t.name} (${t.key.toUpperCase()})${av ? '' : ' — недоступно для текущего слоя'}`,
        'aria-label': t.name, 'aria-pressed': app.tool === id,
        onclick: () => setTool(id),
      }, icon(t.icon, 20), h('span', { class: 'tb-key' }, t.key.toUpperCase())));
    }
  });
}

// ---------- Параметры инструмента ----------
export function initOptbar(el) {
  app.registerPanel('optbar', () => {
    el.textContent = '';
    const t = tools[app.tool];
    el.append(h('div', { class: 'ob-tool' }, icon(t.icon, 18), h('span', null, t.name)));
    const opts = h('div', { class: 'ob-opts' });
    for (const o of (t.options ? t.options() : [])) {
      if (o.show && !o.show()) continue;
      const cur = app.toolOpts[o.key] === undefined ? o.def : app.toolOpts[o.key];
      const setv = (v) => { app.toolOpts[o.key] = v; app.refresh(['optbar']); app.render(); };
      if (o.type === 'check') opts.append(checkField(o.label, cur, setv));
      else if (o.type === 'range') opts.append(rangeField(o.label, cur, { min: o.min, max: o.max, step: 1, prec: 0, onLive: (v) => { app.toolOpts[o.key] = v; app.render(); } }));
      else if (o.type === 'number') opts.append(numField(o.label, cur, { min: o.min, max: o.max, step: 1, prec: 0, onCommit: setv, width: 44 }));
      else if (o.type === 'select') opts.append(selectField(o.label, cur, o.items, setv));
      else if (o.type === 'button') opts.append(h('button', { class: 'btn sm', onclick: o.action }, o.label));
    }
    el.append(opts, h('div', { class: 'ob-hint' }, t.hint || ''));
    const tog = (ic, title, key, after) => h('button', {
      class: 'icon-btn tog' + (app.opts[key] ? ' on' : ''), title, 'aria-pressed': !!app.opts[key],
      onclick: () => { app.opts[key] = !app.opts[key]; after && after(); app.refresh(['optbar', 'timeline']); app.render(); },
    }, icon(ic, 18));
    el.append(h('div', { class: 'ob-right' },
      tog('grid', 'Сетка', 'grid'),
      tog('snap', 'Привязка к сетке', 'snap'),
      tog('bones', 'Показывать кости', 'showBones'),
      tog('onion', 'Луковая кожа (кадры до/после)', 'onion'),
      ...registry.optbarButtons.map((fn) => { try { return fn() || ''; } catch (e) { console.error(e); return ''; } }),
      iconBtn('fit', 'Вписать в окно (Ctrl+0)', () => app.fitView()),
      h('button', { class: 'btn sm ghost', title: 'Масштаб 100% (Ctrl+1)', onclick: () => app.zoomView(1 / app.view.z) }, '100%'),
    ));
  });
}

// ---------- Слои ----------
export function layerMenu(L) {
  const sub = (type) => ({ label: LAYER_TYPES[type], icon: TYPE_ICON[type], action: () => app.addLayer(type) });
  const extraNew = (registry.menus['Новый слой'] || []).flatMap((fn) => { try { return fn() || []; } catch (e) { console.error(e); return []; } });
  return [
    { label: 'Новый слой', sub: creatableTypes().map(sub).concat(extraNew.length ? [{ sep: true }, ...extraNew] : []) },
    { sep: true },
    { label: 'Переименовать', disabled: !L, action: () => L && renameLayer(L) },
    { label: 'Дублировать', icon: 'copy', key: 'Ctrl+D', disabled: !L, action: () => app.duplicateLayer(L) },
    { label: 'Удалить', icon: 'trash', disabled: !L, action: () => app.deleteLayer(L) },
    { sep: true },
    { label: 'Обернуть в группу', icon: 'group', disabled: !L, action: () => app.wrapLayer(L, 'group') },
    { label: 'Обернуть в слой костей', icon: 'bone', disabled: !L, action: () => app.wrapLayer(L, 'bone') },
    { label: 'Поднять', icon: 'up', disabled: !L, action: () => app.shiftLayer(L, 1) },
    { label: 'Опустить', icon: 'down', disabled: !L, action: () => app.shiftLayer(L, -1) },
    { sep: true },
    { label: 'Ключ на текущем кадре', icon: 'key', key: 'K', disabled: !L, action: () => app.keyLayer(L) },
    { label: 'Удалить ключи на кадре', icon: 'keydel', disabled: !L, action: () => app.unkeyLayer(L) },
  ];
}

let renaming = null;
function renameLayer(L) { renaming = L.id; app.refresh(['layers']); }
app.on('renameLayer', (L) => { app.setActive(L.id); renameLayer(L); });

export function initLayers(el) {
  const list = h('div', { class: 'layers-list', role: 'tree', 'aria-label': 'Слои' });
  const addBtn = iconBtn('plus', 'Новый слой', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const extraNew = (registry.menus['Новый слой'] || []).flatMap((fn) => { try { return fn() || []; } catch (er) { console.error(er); return []; } });
    showMenu(creatableTypes().map((t) => ({ label: LAYER_TYPES[t], icon: TYPE_ICON[t], action: () => app.addLayer(t) })).concat(extraNew.length ? [{ sep: true }, ...extraNew] : [])
      .concat([{ sep: true }, { label: 'Изображение…', icon: 'image', action: () => app.emit('importImage') }, { label: 'Аудио…', icon: 'audio', action: () => app.emit('importAudio') }])
      .concat(registry.sideTabs.some((t) => t.id === 'library') ? [{ sep: true }, { label: 'Из библиотеки…', icon: 'group', action: () => app.showSideTab('library') }] : []), r.left, r.bottom + 4);
  });
  el.append(
    h('div', { class: 'panel-head' }, h('span', null, 'Слои'), h('div', { class: 'panel-tools' },
      addBtn,
      iconBtn('copy', 'Дублировать слой (Ctrl+D)', () => app.duplicateLayer()),
      iconBtn('group', 'Обернуть в группу', () => app.wrapLayer(app.active, 'group')),
      iconBtn('trash', 'Удалить слой', () => app.deleteLayer()),
    )),
    list,
  );
  el.addEventListener('pointerdown', () => { app.focus = 'layers'; });
  list.addEventListener('contextmenu', (e) => { if (e.target === list) { e.preventDefault(); showMenu(layerMenu(null), e.clientX, e.clientY); } });

  let dragId = null;
  const clearDrop = () => list.querySelectorAll('.drop-a,.drop-b,.drop-in').forEach((x) => x.classList.remove('drop-a', 'drop-b', 'drop-in'));

  function row(L, depth) {
    const active = L.id === app.activeId;
    const name = renaming === L.id
      ? h('input', { class: 'lname-in', value: L.name, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { renaming = null; app.refresh(['layers']); } }, onblur: (e) => { renaming = null; const v = e.target.value.trim(); if (v && v !== L.name) { L.name = v; app.commit('Переименование'); } else app.refresh(['layers']); } })
      : h('span', { class: 'lname', title: L.name }, L.name);
    const isMaskSrc = (() => { const p = app.idx.parent.get(L.id); return p && p.type === 'group' && p.mask && p.children[0] === L; })();
    const B = boneAncestor(app.idx, L);
    const bindName = L.bind != null && B ? (B.bones.find((b) => b.id === L.bind) || {}).name : null;
    const r = h('div', {
      class: 'lrow' + (active ? ' active' : '') + (L.vis ? '' : ' hidden'),
      draggable: renaming === L.id ? 'false' : 'true', role: 'treeitem', 'aria-selected': active,
      style: { paddingLeft: 4 + depth * 14 + 'px' },
    },
      L.children ? h('button', { class: 'lexp', 'aria-label': L.open ? 'Свернуть' : 'Развернуть', onclick: (e) => { e.stopPropagation(); L.open = !L.open; app.refresh(['layers', 'timeline']); } }, icon(L.open ? 'down' : 'right', 14)) : h('span', { class: 'lexp-sp' }),
      icon(layerIcon(L), 16, 'ltype t-' + L.type),
      name,
      isMaskSrc ? h('span', { class: 'lbadge', title: 'Маска группы' }, icon('mask', 12)) : null,
      bindName ? h('span', { class: 'lbadge', title: 'Привязан к кости «' + bindName + '»' }, icon('link', 12)) : null,
      h('button', { class: 'lvis', title: L.vis ? 'Скрыть' : 'Показать', onclick: (e) => { e.stopPropagation(); L.vis = !L.vis; app.commit(L.vis ? 'Показать слой' : 'Скрыть слой'); } }, icon(L.vis ? 'eye' : 'eyeoff', 16)),
      h('button', { class: 'llock' + (L.lock ? ' on' : ''), title: L.lock ? 'Разблокировать' : 'Заблокировать', onclick: (e) => { e.stopPropagation(); L.lock = !L.lock; app.commit('Блокировка'); } }, icon(L.lock ? 'lock' : 'unlock', 15)),
    );
    r.addEventListener('click', () => app.setActive(L.id));
    r.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) renameLayer(L); });
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); app.setActive(L.id); showMenu(layerMenu(L), e.clientX, e.clientY); });
    r.addEventListener('dragstart', (e) => { dragId = L.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(L.id)); r.classList.add('dragging'); });
    r.addEventListener('dragend', () => { dragId = null; clearDrop(); r.classList.remove('dragging'); });
    const zone = (e) => {
      const b = r.getBoundingClientRect(), y = (e.clientY - b.top) / b.height;
      if (L.children && y > 0.28 && y < 0.72) return 'in';
      return y < 0.5 ? 'a' : 'b';
    };
    r.addEventListener('dragover', (e) => {
      if (dragId == null || dragId === L.id) return;
      e.preventDefault();
      clearDrop();
      r.classList.add('drop-' + zone(e));
    });
    r.addEventListener('dragleave', () => r.classList.remove('drop-a', 'drop-b', 'drop-in'));
    r.addEventListener('drop', (e) => {
      e.preventDefault();
      const D = app.idx.layers.get(dragId);
      clearDrop();
      if (!D || D === L) return;
      const z = zone(e);
      if (z === 'in') { app.moveLayer(D, L, L.children.length); return; }
      const parent = app.idx.parent.get(L.id);
      const arr = parent ? parent.children : app.doc.layers;
      const i = arr.indexOf(L);
      app.moveLayer(D, parent, z === 'a' ? i + 1 : i);
    });
    return r;
  }

  app.registerPanel('layers', () => {
    list.textContent = '';
    const walk = (arr, depth) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const L = arr[i];
        list.append(row(L, depth));
        if (L.children && L.open) walk(L.children, depth + 1);
      }
    };
    walk(app.doc.layers, 0);
    if (!app.doc.layers.length) list.append(h('div', { class: 'empty' }, 'Нет слоёв. Нажмите «+» или просто начните рисовать.'));
    const inp = list.querySelector('.lname-in');
    if (inp) { inp.focus(); inp.select(); }
    const act = list.querySelector('.lrow.active');
    if (act && act.scrollIntoViewIfNeeded) act.scrollIntoViewIfNeeded(false);
  });
}

// Автоматический липсинк: фаза рта по громкости звука на каждом кадре
function autoLipsync(L, A) {
  const peaks = app.audio.get(A.asset).peaksFor(app.doc.fps);
  const kids = L.children, n = kids.length;
  L.sw.k = [L.sw.k[0]];
  let prev = -1;
  for (let i = 0; i <= peaks.length; i++) {
    const f = A.start + i;
    if (f < 1) continue;
    const p = i < peaks.length ? peaks[i] : 0;
    const lvl = p < 0.08 ? 0 : Math.min(n - 1, 1 + Math.floor(Math.pow(p, 0.8) * (n - 1)));
    if (lvl !== prev) { setKey(L.sw, f, String(kids[lvl].id), 'step'); prev = lvl; }
  }
  app.commit('Автолипсинк');
  app.toast(`Липсинк: ключей ${L.sw.k.length - 1}`);
}

// ---------- Свойства ----------
const PALETTE = ['#000000', '#3b3b45', '#8a8f99', '#ffffff', '#ff4d4d', '#ff8a3d', '#ffc94d', '#ffe99a', '#7ddc5a', '#2fb36f', '#3fd0c9', '#4c9dff', '#3359d6', '#9b7bff', '#ff6fd8', '#c46a3a', '#f6c99f', '#8d5a3b'];

export function initInspector(el) {
  let sig = '', updaters = [];
  el.addEventListener('pointerdown', () => { app.focus = 'inspector'; });
  const sec = (title, ...kids) => h('section', { class: 'insp-sec' }, h('div', { class: 'insp-title' }, title), ...kids);
  const row = (...kids) => h('div', { class: 'insp-row' }, ...kids);
  const live = () => app.changed();
  const f = () => app.frame;
  const upd = (field, get) => { updaters.push(() => field.set(get())); return field; };

  function targetPaths() {
    const L = app.active;
    if (!L || L.type !== 'vector') return [];
    const ids = new Set(app.sel.paths);
    for (const id of app.sel.pts) { const x = app.idx.points.get(id); if (x && x.layer === L) ids.add(x.path.id); }
    return L.paths.filter((p) => ids.has(p.id));
  }

  function styleSection() {
    const tp = targetPaths();
    const st = app.style;
    const get = (k) => (tp.length ? (k === 'hf' || k === 'hs' ? tp[0][k] : evalCh(tp[0][k], f())) : st[k]);
    const apply = (k, v, commit) => {
      if (k === 'hf' || k === 'hs') { st[k] = v; for (const p of tp) p[k] = v; }
      else { st[k] = Array.isArray(v) ? v.slice() : v; for (const p of tp) setKey(p[k], f(), v); }
      if (tp.length) { if (commit) app.commit('Стиль'); else live(); }
      else if (commit) app.rebuildInspector();
    };
    const fill = colorField('Заливка', get('fill'), { enabled: get('hf'), onToggle: (v) => apply('hf', v, true), onLive: (c) => apply('fill', c), onCommit: (c) => apply('fill', c, true) });
    const stroke = colorField('Контур', get('stroke'), { enabled: get('hs'), onToggle: (v) => apply('hs', v, true), onLive: (c) => apply('stroke', c), onCommit: (c) => apply('stroke', c, true) });
    const width = upd(numField('Толщина', get('width'), { min: 0, max: 400, step: 0.25, prec: 2, onLive: (v) => apply('width', v), onCommit: (v) => apply('width', v, true) }), () => get('width'));
    const pal = h('div', { class: 'palette', title: 'Клик — заливка, Shift+клик или правая кнопка — контур' }, PALETTE.map((c) => {
      const b = h('button', { class: 'pal', style: { background: c }, 'aria-label': 'Цвет ' + c });
      const set = (k) => { const v = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), get(k)[3]]; apply(k, v, true); app.rebuildInspector(); };
      b.addEventListener('click', (e) => set(e.shiftKey ? 'stroke' : 'fill'));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); set('stroke'); });
      return b;
    }));
    const info = h('div', { class: 'insp-note' }, tp.length ? `Применяется к выделенным фигурам: ${tp.length}` + (f() > 0 ? ' (анимируется)' : '') : 'Стиль новых фигур');
    return sec('Стиль', fill, stroke, row(width), pal, info);
  }

  function layerSection(L) {
    const kids = [];
    const nm = h('input', { class: 'txt', value: L.name, 'aria-label': 'Имя слоя', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }, onchange: (e) => { L.name = e.target.value || L.name; app.commit('Переименование'); } });
    kids.push(row(icon(layerIcon(L), 16), nm));
    const ch2 = (c, i, v) => { const cur = evalCh(c, f()).slice(); cur[i] = v; setKey(c, placeFrame(L), cur); };
    const px = upd(numField('X', evalCh(L.pos, f())[0], { step: 1, prec: 1, onLive: (v) => { ch2(L.pos, 0, v); live(); }, onCommit: () => app.commit('Положение слоя') }), () => evalCh(L.pos, f())[0]);
    const py = upd(numField('Y', evalCh(L.pos, f())[1], { step: 1, prec: 1, onLive: (v) => { ch2(L.pos, 1, v); live(); }, onCommit: () => app.commit('Положение слоя') }), () => evalCh(L.pos, f())[1]);
    const rot = upd(numField('Поворот', evalCh(L.rot, f()), { step: 1, prec: 1, unit: '°', onLive: (v) => { setKey(L.rot, placeFrame(L), v); live(); }, onCommit: () => app.commit('Поворот слоя') }), () => evalCh(L.rot, f()));
    const sx = upd(numField('Масшт X', evalCh(L.scl, f())[0], { step: 0.01, prec: 3, onLive: (v) => { ch2(L.scl, 0, v); live(); }, onCommit: () => app.commit('Масштаб слоя') }), () => evalCh(L.scl, f())[0]);
    const sy = upd(numField('Y', evalCh(L.scl, f())[1], { step: 0.01, prec: 3, onLive: (v) => { ch2(L.scl, 1, v); live(); }, onCommit: () => app.commit('Масштаб слоя') }), () => evalCh(L.scl, f())[1]);
    const op = upd(rangeField('Непрозрачн.', evalCh(L.op, f()), { min: 0, max: 1, step: 0.01, onLive: (v) => { setKey(L.op, f(), v); live(); }, onCommit: () => app.commit('Непрозрачность') }), () => evalCh(L.op, f()));
    kids.push(row(px, py), row(rot), row(sx, sy), op);
    kids.push(row(
      numField('Ось X', L.origin[0], { step: 1, prec: 1, title: 'Точка вращения X', onLive: (v) => { L.origin[0] = v; live(); }, onCommit: () => app.commit('Точка вращения') }),
      numField('Y', L.origin[1], { step: 1, prec: 1, title: 'Точка вращения Y', onLive: (v) => { L.origin[1] = v; live(); }, onCommit: () => app.commit('Точка вращения') }),
    ));
    if (L.type !== 'audio') kids.push(row(selectField('Наложение', L.blend || 'source-over', BLEND_MODES, (v) => { L.blend = v; app.commit('Режим наложения'); })));
    const B = boneAncestor(app.idx, L);
    if (B && B.bones.length) {
      const items = { '': '— нет (гибкая) —' };
      for (const b of B.bones) items[b.id] = b.name;
      kids.push(row(selectField('Кость', L.bind == null ? '' : L.bind, items, (v) => { L.bind = v === '' ? null : +v; app.commit('Привязка слоя'); })));
    }
    if (L.type === 'group') {
      kids.push(row(checkField('Маска: нижний слой обрезает остальные', L.mask, (v) => { L.mask = v; app.commit('Маска'); })));
      if (L.mask) kids.push(row(checkField('Показывать слой-маску', L.maskShow, (v) => { L.maskShow = v; app.commit('Маска'); })));
    }
    if (L.type === 'bone') {
      kids.push(row(checkField('Показывать области влияния костей', L.showStr, (v) => { L.showStr = v; app.commit('Вид костей'); })));
      kids.push(row(checkField('Точки вне зон влияния неподвижны', L.outside === 'static', (v) => { L.outside = v ? 'static' : 'follow'; app.commit('Влияние костей'); },
        'Иначе такие точки плавно следуют ближайшим костям (как в Moho)')));
    }
    if (L.type === 'switch') {
      const items = {};
      for (let i = L.children.length - 1; i >= 0; i--) items[L.children[i].id] = L.children[i].name;
      const cur = evalCh(L.sw, f());
      const curId = L.children.some((c) => String(c.id) === cur) ? cur : String((L.children[L.children.length - 1] || {}).id);
      if (L.children.length) kids.push(row(selectField('Показан', curId, items, (v) => { setKey(L.sw, f(), String(v), 'step'); app.commit('Переключение'); })));
      else kids.push(h('div', { class: 'insp-note' }, 'Добавьте дочерние слои — будет виден один из них (например, фазы рта).'));
      const auds = app.idx.list.filter((x) => x.type === 'audio' && app.audio.get(x.asset) && app.audio.get(x.asset).buffer);
      if (L.children.length > 1 && auds.length) {
        kids.push(h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', title: 'Нижний дочерний слой — закрытый рот, верхний — самый открытый', onclick: () => autoLipsync(L, auds[0]) }, 'Липсинк по звуку «' + auds[0].name + '»')));
      }
    }
    if (L.type === 'image') {
      kids.push(row(
        numField('Ширина', L.w, { min: 1, step: 1, prec: 0, onLive: (v) => { L.w = v; live(); }, onCommit: () => app.commit('Размер изображения') }),
        numField('Высота', L.h, { min: 1, step: 1, prec: 0, onLive: (v) => { L.h = v; live(); }, onCommit: () => app.commit('Размер изображения') }),
      ));
    }
    if (L.type === 'audio') {
      kids.push(row(
        numField('Старт', L.start, { min: 0, step: 1, prec: 0, unit: 'кадр', onCommit: (v) => { L.start = Math.round(v); app.commit('Аудио'); } }),
        numField('Громк.', L.vol, { min: 0, max: 2, step: 0.05, prec: 2, onCommit: (v) => { L.vol = v; app.commit('Аудио'); } }),
      ));
    }
    if (L.type !== 'audio') {
      const fx = h('details', { class: 'insp-fx', open: L.blur > 0 || L.shOn },
        h('summary', null, 'Эффекты'),
        row(numField('Размытие', L.blur, { min: 0, max: 200, step: 0.5, prec: 1, unit: 'px', onLive: (v) => { L.blur = v; live(); }, onCommit: () => app.commit('Размытие') })),
        row(checkField('Тень', L.shOn, (v) => { L.shOn = v; app.commit('Тень'); }),
          h('input', { type: 'color', value: L.shCol, 'aria-label': 'Цвет тени', oninput: (e) => { L.shCol = e.target.value; live(); }, onchange: () => app.commit('Тень') })),
        row(
          numField('X', L.shX, { step: 1, prec: 0, onLive: (v) => { L.shX = v; live(); }, onCommit: () => app.commit('Тень') }),
          numField('Y', L.shY, { step: 1, prec: 0, onLive: (v) => { L.shY = v; live(); }, onCommit: () => app.commit('Тень') }),
        ),
        row(
          numField('Размыт.', L.shBlur, { min: 0, step: 1, prec: 0, onLive: (v) => { L.shBlur = v; live(); }, onCommit: () => app.commit('Тень') }),
          numField('Альфа', L.shA, { min: 0, max: 1, step: 0.01, prec: 2, onLive: (v) => { L.shA = v; live(); }, onCommit: () => app.commit('Тень') }),
        ),
      );
      kids.push(fx);
    }
    if (L.type === 'vector') {
      const np = L.paths.reduce((s, p) => s + p.pts.length, 0);
      kids.push(h('div', { class: 'insp-note' }, `Фигур: ${L.paths.length} · точек: ${np}`));
    }
    return sec('Слой · ' + layerLabel(L), ...kids);
  }

  function pointsSection(L) {
    const pts = [...app.sel.pts].map((id) => app.idx.points.get(id)).filter((x) => x && x.layer === L);
    if (!pts.length) return null;
    const p0 = pts[0].pt;
    const kids = [h('div', { class: 'insp-note' }, `Выделено точек: ${pts.length}`)];
    kids.push(row(
      upd(numField('Кривизна', evalCh(p0.curv, f()), { min: 0, max: 3, step: 0.02, prec: 2, onLive: (v) => { for (const x of pts) setKey(x.pt.curv, f(), v); live(); }, onCommit: () => app.commit('Кривизна') }), () => evalCh(p0.curv, f())),
      numField('Толщ. ×', p0.w, { min: 0.05, max: 8, step: 0.02, prec: 2, title: 'Множитель толщины линии в точке', onLive: (v) => { for (const x of pts) x.pt.w = v; live(); }, onCommit: () => app.commit('Толщина линии') }),
    ));
    if (pts.length === 1) {
      const P = () => evalCh(p0.pos, f());
      kids.push(row(
        upd(numField('X', P()[0], { step: 1, prec: 1, onLive: (v) => { setKey(p0.pos, f(), [v, P()[1]]); live(); }, onCommit: () => app.commit('Точка') }), () => P()[0]),
        upd(numField('Y', P()[1], { step: 1, prec: 1, onLive: (v) => { setKey(p0.pos, f(), [P()[0], v]); live(); }, onCommit: () => app.commit('Точка') }), () => P()[1]),
      ));
    }
    const B = boneAncestor(app.idx, L);
    if (B && B.bones.length) {
      const items = { '': 'Гибкая (по силе костей)' };
      for (const b of B.bones) items[b.id] = b.name;
      const same = pts.every((x) => x.pt.bone === p0.bone);
      if (!same) items['~'] = '— разные —';
      kids.push(row(selectField('Кость', same ? (p0.bone == null ? '' : p0.bone) : '~', items, (v) => {
        if (v === '~') return;
        for (const x of pts) x.pt.bone = v === '' ? null : +v;
        app.commit('Привязка точек');
      })));
    }
    const paths = [...new Set(pts.map((x) => x.path))];
    kids.push(h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', onclick: () => { for (const x of pts) setKey(x.pt.curv, f(), 0); app.commit('Острые углы'); } }, 'Острые'),
      h('button', { class: 'btn sm', onclick: () => { for (const x of pts) setKey(x.pt.curv, f(), 1); app.commit('Гладкие'); } }, 'Гладкие'),
      h('button', { class: 'btn sm', onclick: () => { for (const p of paths) if (p.pts.length >= 3) p.closed = !p.closed; app.commit('Замкнуть/разомкнуть'); } }, paths.some((p) => p.closed) ? 'Разомкнуть' : 'Замкнуть'),
      h('button', { class: 'btn sm danger', onclick: () => app.deleteSelectedPoints() }, 'Удалить'),
    ));
    return sec('Точки', ...kids);
  }

  function boneSection(B) {
    const bones = B.bones.filter((b) => app.sel.bones.has(b.id));
    if (!bones.length) return sec('Кости', h('div', { class: 'insp-note' }, `Костей: ${B.bones.length}. ` + (B.bones.length ? 'Выделите кость, чтобы изменить параметры.' : 'Инструмент «Добавить кость» (A) на кадре 0.')));
    if (bones.length > 1) return sec('Кости', h('div', { class: 'insp-note' }, `Выделено костей: ${bones.length}`), h('button', { class: 'btn sm danger', onclick: () => app.deleteSelectedBones() }, 'Удалить кости'));
    const b = bones[0];
    const P = () => evalCh(b.pos, f());
    const kids = [
      row(h('input', { class: 'txt', value: b.name, 'aria-label': 'Имя кости', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }, onchange: (e) => { b.name = e.target.value || b.name; app.commit('Имя кости'); } })),
      row(
        upd(numField('Угол', evalCh(b.ang, f()), { step: 1, prec: 1, unit: '°', onLive: (v) => { setKey(b.ang, f(), v); live(); }, onCommit: () => app.commit('Угол кости') }), () => evalCh(b.ang, f())),
        upd(numField('Масшт', evalCh(b.scl, f()), { step: 0.01, prec: 3, onLive: (v) => { setKey(b.scl, f(), v); live(); }, onCommit: () => app.commit('Масштаб кости') }), () => evalCh(b.scl, f())),
      ),
      row(
        upd(numField('X', P()[0], { step: 1, prec: 1, onLive: (v) => { setKey(b.pos, f(), [v, P()[1]]); live(); }, onCommit: () => app.commit('Положение кости') }), () => P()[0]),
        upd(numField('Y', P()[1], { step: 1, prec: 1, onLive: (v) => { setKey(b.pos, f(), [P()[0], v]); live(); }, onCommit: () => app.commit('Положение кости') }), () => P()[1]),
      ),
      row(
        numField('Длина', b.len, { min: 1, step: 1, prec: 1, onLive: (v) => { b.len = v; live(); }, onCommit: () => app.commit('Длина кости') }),
        numField('Сила', b.str, { min: 0, step: 1, prec: 0, title: 'Радиус влияния на точки', onLive: (v) => { b.str = v; live(); }, onCommit: () => app.commit('Сила кости') }),
      ),
      row(checkField('Замок IK (цепочка не идёт дальше)', b.lock, (v) => { b.lock = v; app.commit('Замок IK'); })),
      row(checkField('Ограничить угол', b.lim, (v) => { b.lim = v; app.commit('Ограничение угла'); })),
    ];
    if (b.lim) kids.push(row(
      numField('Мин', b.min, { step: 1, prec: 0, unit: '°', onLive: (v) => { b.min = v; live(); }, onCommit: () => app.commit('Ограничение угла') }),
      numField('Макс', b.max, { step: 1, prec: 0, unit: '°', onLive: (v) => { b.max = v; live(); }, onCommit: () => app.commit('Ограничение угла') }),
    ));
    const par = b.parent != null ? B.bones.find((x) => x.id === b.parent) : null;
    kids.push(h('div', { class: 'insp-note' }, 'Родитель: ' + (par ? par.name : '— (корневая)')));
    kids.push(h('div', { class: 'btn-row' }, h('button', { class: 'btn sm danger', onclick: () => app.deleteSelectedBones() }, 'Удалить кость')));
    return sec('Кость', ...kids);
  }

  function build() {
    el.textContent = '';
    updaters = [];
    const L = app.active;
    // стиль фигур показываем для векторных слоёв и обычных типов; у типов из модулей — свои настройки
    if (!L || !registry.layerTypes[L.type] || registry.layerTypes[L.type].showStyle) el.append(styleSection());
    if (L) {
      if (L.type === 'vector') { const ps = pointsSection(L); if (ps) el.append(ps); }
      if (L.type === 'bone') el.append(boneSection(L));
      const helpers = { sec, row, upd, live, f, h, icon, numField, rangeField, checkField, selectField, colorField };
      for (const s of registry.inspector) {
        try { if (s.when(L)) { const e = s.build(L, helpers); if (e) el.append(e); } } catch (e) { console.error('Секция свойств', s.id, e); }
      }
      el.append(layerSection(L));
    } else el.append(sec('Слой', h('div', { class: 'insp-note' }, 'Слой не выбран')));
  }

  app.rebuildInspector = () => { sig = ''; app.refresh(['inspector']); };
  app.registerPanel('inspector', () => {
    const s = [app.activeId, [...app.sel.pts].join(','), [...app.sel.paths].join(','), [...app.sel.bones].join(','), app.history.i, app.doc && app.doc.nid,
      app.frame === 0 ? 0 : 1].join('|');
    if (s !== sig || !el.firstChild) { sig = s; build(); return; }
    for (const u of updaters) u();
  });
}

// ---------- Вкладки правой панели («Свойства» + вкладки модулей) ----------
export function initSideTabs(bar, body, inspectorEl) {
  let current = 'props';
  const mounted = new Map([['props', inspectorEl]]);
  const show = (id) => {
    current = id;
    for (const [k, el] of mounted) el.hidden = k !== id;
    if (!mounted.has(id)) {
      const tab = registry.sideTabs.find((t) => t.id === id);
      const el = h('div', { class: 'side-tab-body' });
      body.append(el);
      mounted.set(id, el);
      try { tab.mount(el); } catch (e) { console.error('Вкладка', id, e); }
    }
    const tab = registry.sideTabs.find((t) => t.id === id);
    if (tab && tab.refresh) try { tab.refresh(); } catch (e) { console.error(e); }
    renderBar();
  };
  // вкладки не влезают в одну строку → только значки (подпись у активной), затем совсем без подписей
  const fit = () => {
    bar.classList.remove('compact', 'compact2');
    if (bar.scrollHeight > 40) bar.classList.add('compact');
    if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('compact2');
  };
  new ResizeObserver(() => fit()).observe(bar.parentElement);
  const renderBar = () => {
    bar.textContent = '';
    const all = [{ id: 'props', title: 'Свойства', icon: 'settings' }, ...registry.sideTabs];
    bar.hidden = all.length < 2;
    for (const t of all) {
      bar.append(h('button', { class: 'side-tab' + (t.id === current ? ' on' : ''), role: 'tab', 'aria-selected': t.id === current, title: t.title, onclick: () => show(t.id) },
        icon(t.icon || 'plus', 15), h('span', { class: 'side-tab-l' }, t.title)));
    }
    fit();
  };
  registry.onTabs = renderBar;
  app.showSideTab = show;
  app.registerPanel('sidetabs', () => {
    const tab = registry.sideTabs.find((t) => t.id === current);
    if (tab && tab.refresh && mounted.has(current)) try { tab.refresh(); } catch (e) { console.error(e); }
  });
  renderBar();
}
