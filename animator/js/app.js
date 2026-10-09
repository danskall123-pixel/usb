// Глобальное состояние редактора и базовые операции над документом.
import { M, clamp } from './util.js';
import { setKey, delKey, evalCh, animSettings, keyIndex } from './anim.js';
import {
  newDoc, newLayer, buildIndex, boneAncestor, siblings, isAncestor, cloneLayer,
  layerOwnChannels, transformChannels, boneDescendants, migrate, typeLabel,
} from './model.js';
import { registry } from './ext.js';
import { evaluate, invalidateWeights, boneMats } from './scene.js';
import { History, snapshot } from './history.js';

export const app = {
  doc: null,
  idx: null,
  S: null,
  frame: 0,
  playing: false,
  activeId: null,
  sel: { pts: new Set(), paths: new Set(), bones: new Set() },
  tool: 'transform',
  lastTool: { vector: 'transform', bone: 'bmanip', other: 'ltransform' },
  style: { fill: [255, 176, 84, 1], stroke: [36, 30, 40, 1], width: 4, hf: true, hs: true },
  view: { x: 0, y: 0, z: 0.5 },
  opts: {
    grid: false, snap: false, gridSize: 20,
    onion: false, onionBefore: 2, onionAfter: 1, onionStep: 1, onionOpacity: 0.35, onionActive: false,
    loop: true, showBones: true,
  },
  toolOpts: {},
  history: new History(),
  clipboard: null,
  images: new Map(),
  audio: new Map(),
  dirty: false,
  _refresh: {},
  _pending: new Set(),
  _rafRefresh: 0,
  _listeners: {},

  on(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
  emit(ev, ...a) { for (const fn of this._listeners[ev] || []) fn(...a); },

  get active() { return this.activeId != null && this.idx ? this.idx.layers.get(this.activeId) || null : null; },

  // ----- обновление UI -----
  registerPanel(name, fn) { this._refresh[name] = fn; },
  refresh(parts = ['all']) {
    for (const p of parts) this._pending.add(p);
    if (this._rafRefresh) return;
    this._rafRefresh = requestAnimationFrame(() => {
      this._rafRefresh = 0;
      const all = this._pending.has('all');
      const pend = this._pending;
      this._pending = new Set();
      for (const name in this._refresh) if (all || pend.has(name)) this._refresh[name]();
    });
  },
  render() { this._dirtyScene = true; this.emit('render'); },

  // ----- документ -----
  loadDoc(doc, { keepView = false } = {}) {
    this.doc = migrate(doc);
    this.idx = buildIndex(this.doc);
    this.frame = clamp(this.frame, 0, Math.max(this.doc.end, 1));
    if (!keepView) this.frame = 0;
    this.activeId = null;
    this.clearSel();
    const first = this.idx.list.find((L) => L.type === 'vector') || this.idx.list[0];
    if (first) this.activeId = first.id;
    this.history.reset(snapshot(this.doc));
    invalidateWeights();
    this.images = new Map();
    this.audio = new Map();
    this.emit('assets');
    this.fixTool();
    this.dirty = false;
    this.emit('docloaded');
    for (const hk of registry.hooks.docLoaded || []) try { hk(this.doc); } catch (e) { console.error(e); }
    this.refresh();
    this.render();
  },

  newDocument() {
    const d = newDoc();
    const L = newLayer(d, 'vector', 'Слой 1');
    d.layers.push(L);
    this.loadDoc(d);
  },

  restructure() {
    this.idx = buildIndex(this.doc);
    if (this.activeId != null && !this.idx.layers.has(this.activeId)) this.activeId = this.idx.list[0] ? this.idx.list[0].id : null;
    for (const id of [...this.sel.pts]) if (!this.idx.points.has(id)) this.sel.pts.delete(id);
    for (const id of [...this.sel.paths]) if (!this.idx.paths.has(id)) this.sel.paths.delete(id);
    for (const id of [...this.sel.bones]) if (!this.idx.bones.has(id)) this.sel.bones.delete(id);
  },

  // Живое изменение (во время перетаскивания)
  changed() {
    invalidateWeights();
    this.dirty = true;
    this.render();
    this.refresh(['inspector', 'timeline']);
  },

  // Завершённое действие → история
  commit(label = 'Изменение') {
    invalidateWeights();
    if (this.history.push(snapshot(this.doc), label)) {
      this.dirty = true;
      this.emit('commit');
    }
    this.refresh();
    this.render();
  },

  restoreSnap(snap) {
    const assets = this.doc.assets;
    this.doc = JSON.parse(snap);
    this.doc.assets = assets;
    this.restructure();
    invalidateWeights();
    this.fixTool();
    this.refresh();
    this.render();
  },
  undo() { const l = this.history.undoLabel, s = this.history.undo(); if (s) { this.restoreSnap(s); this.toast('↶ ' + (l || 'Отменено'), 900); } },
  redo() { const l = this.history.redoLabel, s = this.history.redo(); if (s) { this.restoreSnap(s); this.toast('↷ ' + (l || 'Повторено'), 900); } },

  scene() {
    if (this._dirtyScene || !this.S || this.S.f !== this.frame) this.rescene();
    return this.S;
  },
  rescene() { this._dirtyScene = false; this.S = evaluate(this.doc, this.frame); return this.S; },

  // ----- кадр -----
  setFrame(f) {
    f = Math.max(0, Math.round(f));
    if (f === this.frame) return;
    this.frame = f;
    this.emit('frame', f);
    this.render();
    this.refresh(['timeline', 'inspector', 'status']);
  },

  // ----- выделение -----
  clearSel() { this.sel.pts.clear(); this.sel.paths.clear(); this.sel.bones.clear(); },
  setActive(id) {
    if (id === this.activeId) return;
    this.activeId = id;
    this.sel.pts.clear();
    this.sel.paths.clear();
    const L = this.active;
    const B = L && (L.type === 'bone' ? L : boneAncestor(this.idx, L));
    if (!B) this.sel.bones.clear();
    else for (const b of [...this.sel.bones]) if (this.idx.bones.get(b).layer !== B) this.sel.bones.delete(b);
    this.fixTool();
    this.refresh();
    this.render();
  },
  ctxKind() {
    const L = this.active;
    if (!L) return 'other';
    if (L.type === 'vector') return 'vector';
    if (L.type === 'bone') return 'bone';
    return 'other';
  },
  boneLayerFor(L = this.active) {
    if (!L) return null;
    return L.type === 'bone' ? L : boneAncestor(this.idx, L);
  },
  fixTool() { this.emit('fixtool'); },

  // ----- слои -----
  insertLayer(L, { inside = true } = {}) {
    const A = this.active;
    if (A && inside && A.children) {
      A.children.push(L);
      A.open = true;
    } else if (A) {
      const sib = siblings(this.doc, this.idx, A);
      sib.splice(sib.indexOf(A) + 1, 0, L);
    } else this.doc.layers.push(L);
    this.restructure();
    this.activeId = L.id;
    this.clearSel();
    this.fixTool();
  },
  addLayer(type, name) {
    const n = this.idx.list.filter((l) => l.type === type).length + 1;
    const nm = name || ({ vector: 'Слой', group: 'Группа', bone: 'Кости', switch: 'Переключатель', image: 'Изображение', audio: 'Аудио' }[type] || typeLabel(type)) + ' ' + n;
    const L = newLayer(this.doc, type, nm);
    this.insertLayer(L);
    this.commit('Новый слой');
    return L;
  },
  ensureVector() {
    const A = this.active;
    for (const hk of registry.hooks.vectorTarget || []) {
      const r = hk(A);
      if (r) {
        if (r.lock) { this.toast('Слой заблокирован'); return null; }
        return r;
      }
    }
    if (A && A.type === 'vector') {
      if (A.lock) { this.toast('Слой заблокирован'); return null; }
      return A;
    }
    const n = this.idx.list.filter((l) => l.type === 'vector').length + 1;
    const L = newLayer(this.doc, 'vector', 'Слой ' + n);
    this.insertLayer(L, { inside: !!(A && A.children) });
    this.toast('Создан векторный слой «' + L.name + '»');
    this.refresh();
    return L;
  },
  deleteLayer(L = this.active) {
    if (!L) return;
    const sib = siblings(this.doc, this.idx, L);
    const i = sib.indexOf(L);
    sib.splice(i, 1);
    const next = sib[Math.min(i, sib.length - 1)] || this.idx.parent.get(L.id);
    this.restructure();
    this.activeId = next ? next.id : (this.idx.list[0] ? this.idx.list[0].id : null);
    this.clearSel();
    this.fixTool();
    this.commit('Удаление слоя');
  },
  duplicateLayer(L = this.active) {
    if (!L) return;
    const c = cloneLayer(this.doc, L);
    c.name = L.name + ' копия';
    const sib = siblings(this.doc, this.idx, L);
    sib.splice(sib.indexOf(L) + 1, 0, c);
    this.restructure();
    this.activeId = c.id;
    this.clearSel();
    this.commit('Дублирование слоя');
  },
  moveLayer(L, parent, index) {
    if (parent && (parent === L || isAncestor(this.idx, L, parent))) return false;
    const from = siblings(this.doc, this.idx, L);
    const fi = from.indexOf(L);
    const to = parent ? parent.children : this.doc.layers;
    if (from === to && index > fi) index--;
    from.splice(fi, 1);
    to.splice(clamp(index, 0, to.length), 0, L);
    this.restructure();
    // привязка к кости, которой больше нет среди предков — снять
    if (L.bind != null) {
      const B = boneAncestor(this.idx, L);
      if (!B || !B.bones.some((b) => b.id === L.bind)) L.bind = null;
    }
    this.commit('Перемещение слоя');
    return true;
  },
  shiftLayer(L, dir) {
    const sib = siblings(this.doc, this.idx, L);
    const i = sib.indexOf(L), j = i + dir;
    if (j < 0 || j >= sib.length) return;
    sib.splice(i, 1);
    sib.splice(j, 0, L);
    this.restructure();
    this.commit('Порядок слоёв');
  },
  wrapLayer(L, type) {
    if (!L) return;
    const sib = siblings(this.doc, this.idx, L);
    const i = sib.indexOf(L);
    const G = newLayer(this.doc, type, type === 'bone' ? 'Кости' : 'Группа');
    sib.splice(i, 1, G);
    G.children.push(L);
    this.restructure();
    this.activeId = type === 'bone' ? G.id : L.id;
    this.clearSel();
    this.fixTool();
    this.commit(type === 'bone' ? 'Обёрнуто в слой костей' : 'Обёрнуто в группу');
  },

  // ----- ключи -----
  writeCh(c, v) { setKey(c, this.frame, v); },
  keyLayer(L = this.active) {
    if (!L) return;
    const f = this.frame;
    for (const c of layerOwnChannels(L)) setKey(c, f, evalCh(c, f));
    this.commit('Ключ на кадре ' + f);
  },
  unkeyLayer(L = this.active) {
    if (!L) return;
    let n = 0;
    for (const c of layerOwnChannels(L)) if (delKey(c, this.frame)) n++;
    if (n) this.commit('Удаление ключей'); else this.toast('На этом кадре нет ключей');
  },
  allKeyFrames(L) {
    const s = new Set();
    const add = (X) => { for (const c of layerOwnChannels(X)) for (const k of c.k) s.add(k.f); if (X.children) X.children.forEach(add); };
    if (L) add(L);
    else { for (const X of this.doc.layers) add(X); for (const c of [this.doc.cam.pos, this.doc.cam.zoom, this.doc.cam.roll]) for (const k of c.k) s.add(k.f); }
    return [...s].sort((a, b) => a - b);
  },
  jumpKey(dir) {
    const frames = this.allKeyFrames(this.active);
    const f = this.frame;
    const t = dir > 0 ? frames.find((x) => x > f) : [...frames].reverse().find((x) => x < f);
    if (t != null) this.setFrame(t);
  },

  // ----- точки -----
  deleteSelectedPoints() {
    const L = this.active;
    if (!L || L.type !== 'vector' || (!this.sel.pts.size && !this.sel.paths.size)) return false;
    if (this.sel.paths.size) L.paths = L.paths.filter((p) => !this.sel.paths.has(p.id));
    for (const p of L.paths) p.pts = p.pts.filter((pt) => !this.sel.pts.has(pt.id));
    L.paths = L.paths.filter((p) => p.pts.length >= 2);
    for (const p of L.paths) if (p.pts.length < 3) p.closed = false;
    this.sel.pts.clear();
    this.sel.paths.clear();
    this.restructure();
    this.commit('Удаление точек');
    return true;
  },
  deleteSelectedBones() {
    const B = this.active;
    if (!B || B.type !== 'bone' || !this.sel.bones.size) return false;
    const M0 = boneMats(B, 0);
    for (const id of this.sel.bones) {
      const b = B.bones.find((x) => x.id === id);
      if (!b) continue;
      // дети переходят к родителю удаляемой кости, сохраняя положение покоя
      for (const c of B.bones.filter((x) => x.parent === id)) reparentBone(B, c, b.parent, M0);
      B.bones = B.bones.filter((x) => x.id !== id);
    }
    const dead = new Set(this.sel.bones);
    const walk = (X) => {
      if (X.bind != null && dead.has(X.bind)) X.bind = null;
      if (X.paths) for (const p of X.paths) for (const pt of p.pts) if (dead.has(pt.bone)) pt.bone = null;
      if (X.children) X.children.forEach(walk);
    };
    walk(B);
    this.sel.bones.clear();
    this.restructure();
    this.commit('Удаление костей');
    return true;
  },

  // ----- координаты -----
  viewMatrix() {
    const el = this.viewEl;
    const w = el ? el.clientWidth : 800, h = el ? el.clientHeight : 600;
    const z = this.view.z;
    return [z, 0, 0, z, w / 2 + this.view.x, h / 2 + this.view.y];
  },
  docToScreenM() { return M.mul(this.viewMatrix(), this.scene().cam); },
  toScreen(x, y) { return M.apply(this.docToScreenM(), x, y); },
  toDoc(sx, sy) { return M.apply(M.inv(this.docToScreenM()), sx, sy); },
  pxToDoc(px) { return px / (this.view.z * Math.abs(evalCh(this.doc.cam.zoom, this.frame) || 1)); },

  toast(msg, ms = 2200) { this.emit('toast', msg, ms); },
  status(msg) { this.emit('status', msg); },
};

// Смена родителя кости с сохранением её мировой позы покоя
export function reparentBone(B, b, newParent, M0 = boneMats(B, 0)) {
  const oldP = b.parent != null ? M0.get(b.parent) : M.id();
  const newP = newParent != null ? M0.get(newParent) : M.id();
  if (!oldP || !newP) { b.parent = newParent; return; }
  const T = M.mul(M.inv(newP), oldP);
  const dAng = (M.angle(oldP) - M.angle(newP)) * 180 / Math.PI;
  for (const k of b.pos.k) k.v = M.apply(T, k.v[0], k.v[1]);
  for (const k of b.ang.k) k.v = k.v + dAng;
  b.parent = newParent;
}

export { keyIndex, animSettings, transformChannels, boneDescendants };
