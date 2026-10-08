// Модель документа: слои, контуры, точки, кости.
import { ch } from './anim.js';

export const LAYER_TYPES = {
  vector: 'Векторный',
  group: 'Группа',
  bone: 'Кости',
  switch: 'Переключатель',
  image: 'Изображение',
  audio: 'Аудио',
};

export const BLEND_MODES = {
  'source-over': 'Обычный',
  multiply: 'Умножение',
  screen: 'Экран',
  overlay: 'Перекрытие',
  lighter: 'Добавление',
  darken: 'Затемнение',
  lighten: 'Осветление',
  'color-dodge': 'Осветление основы',
  'color-burn': 'Затемнение основы',
  difference: 'Разница',
  'hard-light': 'Жёсткий свет',
  'soft-light': 'Мягкий свет',
};

export const BONE_COLORS = ['#ff5a5a', '#ffb13b', '#ffe14d', '#7ddc5a', '#3fd0c9', '#4c9dff', '#9b7bff', '#ff6fd8'];

export function newDoc() {
  return {
    v: 1,
    name: 'Без названия',
    w: 1280,
    h: 720,
    fps: 24,
    start: 1,
    end: 72,
    bg: '#ffffff',
    nid: 1,
    cam: { pos: ch([0, 0]), zoom: ch(1), roll: ch(0) },
    layers: [],
    assets: {},
  };
}

export function newLayer(doc, type, name) {
  const L = {
    id: doc.nid++,
    type,
    name: name || LAYER_TYPES[type],
    vis: true,
    lock: false,
    open: true,
    pos: ch([0, 0]),
    rot: ch(0),
    scl: ch([1, 1]),
    op: ch(1),
    origin: [0, 0],
    bind: null,
    blend: 'source-over',
    blur: 0,
    shOn: false, shCol: '#000000', shA: 0.45, shX: 6, shY: 6, shBlur: 8,
  };
  if (type === 'vector') L.paths = [];
  if (type === 'group' || type === 'bone' || type === 'switch') L.children = [];
  if (type === 'group') { L.mask = false; L.maskShow = true; }
  if (type === 'bone') { L.bones = []; L.showStr = false; }
  if (type === 'switch') L.sw = ch('', 'step');
  if (type === 'image') { L.asset = null; L.w = 100; L.h = 100; }
  if (type === 'audio') { L.asset = null; L.start = 1; L.vol = 1; }
  return L;
}

export function newPoint(doc, x, y, curv = 1, w = 1) {
  return { id: doc.nid++, pos: ch([x, y]), curv: ch(curv), w, bone: null };
}

export function newPath(doc, pts, closed, style) {
  return {
    id: doc.nid++,
    closed: !!closed,
    pts,
    fill: ch(style.fill.slice()),
    stroke: ch(style.stroke.slice()),
    width: ch(style.width),
    hf: !!style.hf,
    hs: !!style.hs,
  };
}

export function newBone(doc, parent, x, y, ang, len, n) {
  return {
    id: doc.nid++,
    name: 'Кость ' + (n || 1),
    parent,
    pos: ch([x, y]),
    ang: ch(ang),
    scl: ch(1),
    len,
    str: Math.round(Math.max(16, len * 0.45)),
    lock: false,
    lim: false,
    min: -90,
    max: 90,
  };
}

export function buildIndex(doc) {
  const idx = {
    layers: new Map(), parent: new Map(), depth: new Map(),
    points: new Map(), paths: new Map(), bones: new Map(), list: [],
  };
  const walk = (arr, parent, depth) => {
    for (const L of arr) {
      idx.layers.set(L.id, L);
      idx.parent.set(L.id, parent);
      idx.depth.set(L.id, depth);
      idx.list.push(L);
      if (L.paths) for (const p of L.paths) {
        idx.paths.set(p.id, { path: p, layer: L });
        for (const pt of p.pts) idx.points.set(pt.id, { pt, path: p, layer: L });
      }
      if (L.bones) L.bones.forEach((b, i) => idx.bones.set(b.id, { bone: b, layer: L, i }));
      if (L.children) walk(L.children, L, depth + 1);
    }
  };
  walk(doc.layers, null, 0);
  return idx;
}

export const siblings = (doc, idx, L) => { const p = idx.parent.get(L.id); return p ? p.children : doc.layers; };

export function boneAncestor(idx, L) {
  let p = idx.parent.get(L.id);
  while (p) {
    if (p.type === 'bone') return p;
    p = idx.parent.get(p.id);
  }
  return null;
}

export function isAncestor(idx, a, b) {
  let p = idx.parent.get(b.id);
  while (p) { if (p === a) return true; p = idx.parent.get(p.id); }
  return false;
}

export function descendants(L, out = []) {
  if (L.children) for (const c of L.children) { out.push(c); descendants(c, out); }
  return out;
}

export const boneColor = (B, boneId) => {
  const i = B.bones.findIndex((b) => b.id === boneId);
  return BONE_COLORS[(i < 0 ? 0 : i) % BONE_COLORS.length];
};

export function boneChildren(B, id) { return B.bones.filter((b) => b.parent === id); }

export function boneDescendants(B, id, out = new Set()) {
  for (const b of B.bones) if (b.parent === id && !out.has(b.id)) { out.add(b.id); boneDescendants(B, b.id, out); }
  return out;
}

// --- Каналы для таймлайна ---
export const transformChannels = (L) => [L.pos, L.rot, L.scl, L.op];
export function pointChannels(L, out = []) {
  if (L.paths) for (const p of L.paths) for (const pt of p.pts) out.push(pt.pos, pt.curv);
  return out;
}
export function styleChannels(L, out = []) {
  if (L.paths) for (const p of L.paths) out.push(p.fill, p.stroke, p.width);
  return out;
}
export const boneChannels = (b) => [b.pos, b.ang, b.scl];
export function layerOwnChannels(L) {
  const out = transformChannels(L);
  pointChannels(L, out);
  styleChannels(L, out);
  if (L.bones) for (const b of L.bones) out.push(...boneChannels(b));
  if (L.sw) out.push(L.sw);
  return out;
}

// Глубокое копирование слоя с новыми id (ссылки на кости внутри копии переназначаются)
export function cloneLayer(doc, L) {
  const c = JSON.parse(JSON.stringify(L));
  const boneMap = new Map(), layerMap = new Map();
  const pass1 = (X) => {
    layerMap.set(X.id, doc.nid); X.id = doc.nid++;
    if (X.paths) for (const p of X.paths) { p.id = doc.nid++; for (const pt of p.pts) pt.id = doc.nid++; }
    if (X.bones) for (const b of X.bones) { boneMap.set(b.id, doc.nid); b.id = doc.nid++; }
    if (X.children) X.children.forEach(pass1);
  };
  const pass2 = (X) => {
    if (X.bind != null && boneMap.has(X.bind)) X.bind = boneMap.get(X.bind);
    if (X.paths) for (const p of X.paths) for (const pt of p.pts) if (pt.bone != null && boneMap.has(pt.bone)) pt.bone = boneMap.get(pt.bone);
    if (X.bones) for (const b of X.bones) if (b.parent != null && boneMap.has(b.parent)) b.parent = boneMap.get(b.parent);
    if (X.sw) for (const k of X.sw.k) if (k.v && layerMap.has(+k.v)) k.v = String(layerMap.get(+k.v));
    if (X.children) X.children.forEach(pass2);
  };
  pass1(c);
  pass2(c);
  return c;
}

export function clonePath(doc, p) {
  const c = JSON.parse(JSON.stringify(p));
  c.id = doc.nid++;
  for (const pt of c.pts) pt.id = doc.nid++;
  return c;
}

// Собрать ассеты, на которые есть ссылки (для сохранения без мусора)
export function usedAssets(doc) {
  const used = new Set();
  const walk = (arr) => { for (const L of arr) { if (L.asset) used.add(L.asset); if (L.children) walk(L.children); } };
  walk(doc.layers);
  return used;
}

export function migrate(doc) {
  // Заполнить поля, добавленные в новых версиях
  const def = newLayer({ nid: 0 }, 'vector');
  const walk = (arr) => {
    for (const L of arr) {
      for (const k of ['blend', 'blur', 'shOn', 'shCol', 'shA', 'shX', 'shY', 'shBlur', 'origin']) if (L[k] === undefined) L[k] = def[k];
      if (L.children) walk(L.children);
    }
  };
  walk(doc.layers || []);
  doc.assets = doc.assets || {};
  if (!doc.cam) doc.cam = newDoc().cam;
  return doc;
}
