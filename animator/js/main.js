// Точка входа: сборка интерфейса, меню, горячие клавиши, справка, запуск.
import { app } from './app.js';
import { h } from './util.js';
import { icon } from './icons.js';
import { INTERP, animSettings, evalCh } from './anim.js';
import { clonePath, cloneLayer, newDoc, newLayer, siblings } from './model.js';
import { initViewport } from './viewport.js';
import { initToolbox, initOptbar, initLayers, initInspector, initSideTabs, setTool, layerMenu } from './panels.js';
import { registry } from './ext.js';
import { initTimeline } from './timeline.js';
import { initPlayback } from './playback.js';
import { tools, toolForKey } from './tools.js';
import { saveProject, openProject, importImage, importAudio, exportDialog, scheduleAutosave, loadAutosave, flushAutosave } from './io.js';
import { buildDemo } from './demo.js';
import { toast, showMenu, closeMenu, dialog, confirmDialog, numField, selectField } from './ui.js';

app.on('toast', toast);
app.on('commit', scheduleAutosave);

const $ = (s) => document.querySelector(s);

// ---------- команды ----------
async function cmdNew() {
  if (registry.templates.length) { templateDialog(); return; }
  if (!(await confirmDialog('Новый проект', 'Текущий проект будет закрыт. Он останется в автосохранении до первого изменения нового. Сохраните его в файл, если нужен.', 'Создать'))) return;
  app.newDocument();
  app.fitView();
}

// Выбор шаблона нового проекта (шаблоны регистрируют модули расширений)
function templateDialog() {
  const all = [{ id: 'empty', name: 'Пустой проект', description: 'Чистый лист с одним векторным слоем', build: null }, ...registry.templates];
  let d = null;
  const pick = (t) => {
    d.close();
    if (t.build) { app.loadDoc(t.build()); app.frame = app.doc.start > 0 && t.id !== 'empty' ? app.doc.start : 0; app.refresh(); app.render(); }
    else app.newDocument();
    app.fitView();
    app.toast('Новый проект: ' + t.name);
  };
  d = dialog({
    title: 'Новый проект',
    width: 620,
    body: h('div', null,
      h('p', { class: 'muted' }, 'Текущий проект будет закрыт (сохраните его в файл, если нужен). С чего начнём?'),
      h('div', { class: 'tpl-grid' }, all.map((t) => h('button', { class: 'tpl-card', onclick: () => pick(t) },
        (() => { try { const p = t.preview && t.preview(); return p ? h('span', { class: 'tpl-prev' }, p) : null; } catch (e) { console.error(e); return null; } })(),
        h('b', null, t.name), h('span', null, t.description || '')))),
    ),
    buttons: [{ label: 'Отмена' }],
  });
}
async function cmdDemo() {
  if (!(await confirmDialog('Открыть пример', 'Открыть демонстрационный проект с персонажем на костях? Текущий проект будет закрыт.', 'Открыть'))) return;
  openDemo();
}
function openDemo() {
  app.loadDoc(buildDemo());
  const rig = app.idx.list.find((L) => L.type === 'bone');
  if (rig) { app.activeId = rig.id; app.tool = 'bmanip'; app.fixTool(); }
  app.frame = 1;
  app.refresh();
  app.render();
  app.fitView();
}

function copyPaths() {
  const L = app.active;
  if (!L || L.type !== 'vector') return false;
  const ids = new Set(app.sel.paths);
  for (const id of app.sel.pts) { const x = app.idx.points.get(id); if (x) ids.add(x.path.id); }
  if (!ids.size) return false;
  const f = app.frame;
  const paths = L.paths.filter((p) => ids.has(p.id)).map((p) => {
    const c = JSON.parse(JSON.stringify(p));
    for (const pt of c.pts) {
      pt.pos.k = [{ f: 0, v: evalCh(pt.pos, f), i: 'smooth' }];
      pt.curv.k = [{ f: 0, v: evalCh(pt.curv, f), i: 'smooth' }];
    }
    for (const k of ['fill', 'stroke', 'width']) c[k].k = [{ f: 0, v: evalCh(c[k], f), i: 'smooth' }];
    return c;
  });
  app.clipboard = { type: 'paths', paths };
  app.toast(`Скопировано фигур: ${paths.length}`);
  return true;
}
function cmdCopy() {
  if (app.focus === 'timeline' && app.timelineOps.copySel()) return;
  if (copyPaths()) return;
  if (app.active) { app.clipboard = { type: 'layer', json: JSON.stringify(app.active, (k, v) => (k[0] === '_' ? undefined : v)) }; app.toast('Слой скопирован'); }
}
function cmdCut() { if (copyPaths()) app.deleteSelectedPoints(); }
function cmdPaste() {
  const cb = app.clipboard;
  if (!cb) return;
  if (cb.type === 'keys') { app.timelineOps.paste(); return; }
  if (cb.type === 'paths') {
    const L = app.ensureVector();
    if (!L) return;
    app.sel.pts.clear();
    for (const p of cb.paths) {
      const c = clonePath(app.doc, p);
      for (const pt of c.pts) { pt.bone = null; app.sel.pts.add(pt.id); }
      L.paths.push(c);
    }
    app.restructure();
    app.commit('Вставка фигур');
    return;
  }
  if (cb.type === 'layer') {
    const c = cloneLayer(app.doc, JSON.parse(cb.json));
    const A = app.active;
    if (A) { const sib = siblings(app.doc, app.idx, A); sib.splice(sib.indexOf(A) + 1, 0, c); } else app.doc.layers.push(c);
    app.restructure();
    app.activeId = c.id;
    app.clearSel();
    app.fixTool();
    app.commit('Вставка слоя');
  }
}
function cmdDelete() {
  if (app.focus === 'timeline' && app.timelineOps.hasSel()) { app.timelineOps.deleteSel(); return; }
  if (app.focus === 'layers') { app.deleteLayer(); return; }
  if (app.deleteSelectedPoints()) return;
  if (app.deleteSelectedBones()) return;
}
function cmdSelectAll() {
  if (app.focus === 'timeline') { app.timelineOps.selectAll(); return; }
  const L = app.active;
  if (!L) return;
  if (L.type === 'vector') for (const p of L.paths) for (const pt of p.pts) app.sel.pts.add(pt.id);
  if (L.type === 'bone') for (const b of L.bones) app.sel.bones.add(b.id);
  app.refresh(); app.render();
}
function cmdDeselect() {
  app.clearSel();
  if (app.tlSel) app.tlSel.clear();
  app.refresh(); app.render();
}

function projectSettings() {
  const d = app.doc;
  const o = { name: d.name, w: d.w, h: d.h, fps: d.fps, start: d.start, end: d.end, bg: d.bg };
  const presets = { '': 'Пресет…', '1280x720': 'HD 1280×720', '1920x1080': 'Full HD 1920×1080', '1080x1080': 'Квадрат 1080×1080', '1080x1920': 'Вертикальное 1080×1920', '3840x2160': '4K 3840×2160' };
  const wF = numField('Ширина', o.w, { min: 16, max: 8192, step: 2, prec: 0, onCommit: (v) => { o.w = Math.round(v); } });
  const hF = numField('Высота', o.h, { min: 16, max: 8192, step: 2, prec: 0, onCommit: (v) => { o.h = Math.round(v); } });
  dialog({
    title: 'Настройки проекта',
    width: 420,
    body: h('div', { class: 'form' },
      h('label', { class: 'sel' }, h('span', null, 'Название'), h('input', { class: 'txt', value: o.name, oninput: (e) => { o.name = e.target.value; }, onkeydown: (e) => e.stopPropagation() })),
      selectField('Размер', '', presets, (v) => { if (!v) return; const [w, hh] = v.split('x').map(Number); o.w = w; o.h = hh; wF.set(w); hF.set(hh); }),
      h('div', { class: 'insp-row' }, wF, hF),
      h('div', { class: 'insp-row' },
        numField('FPS', o.fps, { min: 1, max: 120, step: 1, prec: 0, onCommit: (v) => { o.fps = Math.round(v); } }),
        numField('Кадры с', o.start, { min: 0, step: 1, prec: 0, onCommit: (v) => { o.start = Math.round(v); } }),
        numField('по', o.end, { min: 1, step: 1, prec: 0, onCommit: (v) => { o.end = Math.round(v); } }),
      ),
      h('label', { class: 'sel' }, h('span', null, 'Цвет фона'), h('input', { type: 'color', value: o.bg, oninput: (e) => { o.bg = e.target.value; } })),
    ),
    buttons: [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => {
      Object.assign(d, { name: o.name || d.name, w: o.w, h: o.h, fps: o.fps, start: o.start, end: Math.max(o.end, o.start), bg: o.bg });
      app.commit('Настройки проекта');
      app.fitView();
      updateTitle();
    } }],
  });
}

const KEYS = [
  ['Пробел', 'Воспроизвести / пауза (удерживать + тянуть — двигать вид)'],
  ['← / →', 'Предыдущий / следующий кадр'],
  ['Shift + ← / →', 'Предыдущий / следующий ключ'],
  ['Home / End', 'Кадр 0 (поза покоя) / последний кадр'],
  ['K', 'Ключ всех каналов активного слоя на текущем кадре'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Отменить / повторить'],
  ['Ctrl+C / V / X', 'Копировать / вставить / вырезать (точки, фигуры, слой, ключи)'],
  ['Ctrl+D', 'Дублировать слой'],
  ['Ctrl+A / Esc', 'Выделить всё / снять выделение'],
  ['Delete', 'Удалить выделенные точки, кости или ключи'],
  ['Ctrl+S / Ctrl+O', 'Сохранить в файл / открыть'],
  ['Ctrl+E', 'Экспорт (видео, GIF, PNG, SVG)'],
  ['Колесо / Ctrl+0 / Ctrl+1', 'Зум / вписать / 100%'],
  ['Правая или средняя кнопка', 'Двигать вид'],
  ["'", 'Сетка вкл/выкл'],
  ['F1 или ?', 'Эта справка'],
];

function helpDialog() {
  const toolRows = Object.values(tools).map((t) => h('tr', null, h('td', null, h('kbd', null, t.key.toUpperCase())), h('td', null, icon(t.icon, 16), ' ', t.name), h('td', { class: 'muted' }, t.hint)));
  dialog({
    title: 'Справка',
    width: 760,
    body: h('div', { class: 'help' },
      h('h3', null, 'Как это устроено (как в Moho)'),
      h('ul', null,
        h('li', null, h('b', null, 'Кадр 0 — поза покоя.'), ' На нём рисуют, строят скелет и привязывают точки. Изменения на других кадрах автоматически становятся ключами.'),
        h('li', null, h('b', null, 'Векторы — точки с кривизной.'), ' Кривые гладкие сами по себе; инструмент «Кривизна» делает углы острыми/скруглёнными. Замкнутые контуры заливаются.'),
        h('li', null, h('b', null, 'Кости'), ' живут в слое «Кости» и деформируют все векторные слои внутри него: гибко (по силе костей), через привязку точек или привязку целого слоя.'),
        h('li', null, h('b', null, 'Таймлайн'), ' показывает ключи; их можно тянуть, копировать с Alt, менять интерполяцию правой кнопкой.'),
        h('li', null, 'Всё автоматически сохраняется в браузере. Для переноса — «Файл → Сохранить в файл».'),
      ),
      h('h3', null, 'Персонаж на костях за 6 шагов'),
      h('ol', null,
        h('li', null, 'Нарисуйте части (кисть F, фигуры R) в отдельных векторных слоях.'),
        h('li', null, 'Выделите слой → «Слой → Обернуть в слой костей» и перетащите остальные слои внутрь.'),
        h('li', null, 'Выберите слой костей, кадр 0, инструмент «Добавить кость» (A): тяните кость за костью — получится цепочка.'),
        h('li', null, 'Голова/предметы: выберите их слой, инструмент «Привязать слой» (L), кликните кость.'),
        h('li', null, 'Для гибких частей настройте «Силу кости» (S) или привяжите точки (I).'),
        h('li', null, 'Перейдите на кадр 12, 24… и двигайте кости «Управлением костями» (Z) — ключи создаются сами. Пробел — смотреть.'),
      ),
      h('h3', null, 'Инструменты'),
      h('table', { class: 'keys' }, toolRows),
      h('h3', null, 'Горячие клавиши'),
      h('table', { class: 'keys' }, KEYS.concat(registry.shortcuts.filter((s) => s.label).map((s) => [(s.shift ? 'Shift+' : '') + (s.alt ? 'Alt+' : '') + (s.keyLabel || s.key.toUpperCase()), s.label]))
        .filter((x, i, a) => a.findIndex((y) => y[0] === x[0] && y[1] === x[1]) === i)
        .map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', { colspan: 2 }, v)))),
      h('p', { class: 'muted' }, 'Клавиши инструментов работают в любой раскладке. Один и тот же ключ выбирает инструмент по типу слоя (например, T — точки на векторном слое и кость на слое костей).'),
    ),
    buttons: [{ label: 'Понятно', primary: true }],
  });
}

function aboutDialog() {
  dialog({
    title: 'О редакторе',
    body: h('div', null,
      h('p', null, h('b', null, 'Аниматор 2D'), ' — браузерный редактор векторной 2D-анимации с костями в духе Moho/Anime Studio.'),
      h('p', { class: 'muted' }, 'Работает полностью в браузере и офлайн, без серверов и зависимостей. Проекты — в формате .anim2d.json.'),
    ),
  });
}

const MENUS = {
  Файл: () => [
    { label: 'Новый проект', key: 'Ctrl+N', action: cmdNew },
    { label: 'Открыть…', icon: 'open', key: 'Ctrl+O', action: () => openProject() },
    { label: 'Сохранить в файл', icon: 'save', key: 'Ctrl+S', action: saveProject },
    { label: 'Открыть пример', icon: 'bone', action: cmdDemo },
    { sep: true },
    { label: 'Импорт изображения…', icon: 'image', action: () => importImage() },
    { label: 'Импорт звука…', icon: 'audio', action: () => importAudio() },
    { sep: true },
    { label: 'Экспорт…', icon: 'export', key: 'Ctrl+E', action: () => exportDialog() },
    { label: 'Экспорт видео…', icon: 'film', action: () => exportDialog('video') },
    { label: 'Экспорт GIF…', action: () => exportDialog('gif') },
    { label: 'Экспорт PNG-кадров (ZIP)…', action: () => exportDialog('zip') },
    { sep: true },
    { label: 'Настройки проекта…', icon: 'settings', action: projectSettings },
  ],
  Правка: () => [
    { label: () => 'Отменить' + (app.history.undoLabel ? ': ' + app.history.undoLabel : ''), icon: 'undo', key: 'Ctrl+Z', disabled: () => !app.history.canUndo, action: () => app.undo() },
    { label: () => 'Повторить' + (app.history.redoLabel ? ': ' + app.history.redoLabel : ''), icon: 'redo', key: 'Ctrl+Shift+Z', disabled: () => !app.history.canRedo, action: () => app.redo() },
    { sep: true },
    { label: 'Вырезать', key: 'Ctrl+X', action: cmdCut },
    { label: 'Копировать', icon: 'copy', key: 'Ctrl+C', action: cmdCopy },
    { label: 'Вставить', key: 'Ctrl+V', disabled: () => !app.clipboard, action: cmdPaste },
    { label: 'Удалить', icon: 'trash', key: 'Del', action: cmdDelete },
    { sep: true },
    { label: 'Выделить всё', key: 'Ctrl+A', action: cmdSelectAll },
    { label: 'Снять выделение', key: 'Esc', action: cmdDeselect },
  ],
  Слой: () => layerMenu(app.active).concat([
    { sep: true },
    { label: 'Импорт изображения…', icon: 'image', action: () => importImage() },
    { label: 'Импорт звука…', icon: 'audio', action: () => importAudio() },
  ]),
  Анимация: () => [
    { label: () => (app.playing ? 'Пауза' : 'Воспроизвести'), icon: 'play', key: 'Пробел', action: () => app.emit('toggleplay') },
    { label: 'Ключ на кадре (все каналы слоя)', icon: 'key', key: 'K', action: () => app.keyLayer() },
    { label: 'Удалить ключи слоя на кадре', icon: 'keydel', action: () => app.unkeyLayer() },
    { sep: true },
    { label: 'Предыдущий ключ', icon: 'prevkey', key: 'Shift+←', action: () => app.jumpKey(-1) },
    { label: 'Следующий ключ', icon: 'nextkey', key: 'Shift+→', action: () => app.jumpKey(1) },
    { label: 'Кадр 0 — поза покоя', key: 'Home', action: () => app.setFrame(0) },
    { sep: true },
    { label: 'Интерполяция новых ключей', sub: Object.entries(INTERP).map(([k, v]) => ({ label: v, checked: animSettings.interp === k, action: () => { animSettings.interp = k; app.refresh(['timeline']); } })) },
    { label: 'Луковая кожа', icon: 'onion', checked: app.opts.onion, action: () => { app.opts.onion = !app.opts.onion; app.refresh(); app.render(); } },
    { label: 'Зациклить воспроизведение', icon: 'loop', checked: app.opts.loop, action: () => { app.opts.loop = !app.opts.loop; app.refresh(['timeline']); } },
  ],
  Вид: () => [
    { label: 'Вписать в окно', icon: 'fit', key: 'Ctrl+0', action: () => app.fitView() },
    { label: 'Масштаб 100%', key: 'Ctrl+1', action: () => app.zoomView(1 / app.view.z) },
    { label: 'Приблизить', key: '+', action: () => app.zoomView(1.25) },
    { label: 'Отдалить', key: '−', action: () => app.zoomView(0.8) },
    { sep: true },
    { label: 'Сетка', icon: 'grid', key: "'", checked: app.opts.grid, action: () => toggleOpt('grid') },
    { label: 'Привязка к сетке', icon: 'snap', checked: app.opts.snap, action: () => toggleOpt('snap') },
    { label: 'Показывать кости', icon: 'bones', checked: app.opts.showBones, action: () => toggleOpt('showBones') },
    { label: 'Простой режим (только основные инструменты)', checked: !!app.opts.simple, action: () => { app.opts.simple = !app.opts.simple; try { localStorage.setItem('anim2d.simple', app.opts.simple ? '1' : ''); } catch (e) { /* нет доступа */ } app.fixTool(); app.refresh(); } },
    { label: 'Шаг сетки…', action: () => {
      dialog({ title: 'Шаг сетки', width: 300, body: numField('Шаг', app.opts.gridSize, { min: 2, max: 500, step: 1, prec: 0, onCommit: (v) => { app.opts.gridSize = v; app.render(); } }) });
    } },
    { sep: true },
    { label: 'Полный экран', key: 'F11', action: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) },
  ],
  Справка: () => [
    { label: 'Справка и горячие клавиши', icon: 'help', key: 'F1', action: helpDialog },
    { label: 'О редакторе', action: aboutDialog },
  ],
};

function toggleOpt(k) { app.opts[k] = !app.opts[k]; app.refresh(['optbar']); app.render(); }

function buildMenubar(el) {
  const bar = h('nav', { class: 'menus', 'aria-label': 'Главное меню' });
  let openName = null;
  const open = (name, btn) => {
    openName = name;
    const r = btn.getBoundingClientRect();
    bar.querySelectorAll('.mb').forEach((b) => b.classList.toggle('open', b === btn));
    const extra = (registry.menus[name] || []).flatMap((fn) => { try { return fn() || []; } catch (e) { console.error(e); return []; } });
    showMenu(MENUS[name]().concat(extra.length ? [{ sep: true }, ...extra] : []), r.left, r.bottom + 2, { anchor: btn, minWidth: 240, onClose: () => { openName = null; btn.classList.remove('open'); } });
  };
  for (const name of Object.keys(MENUS)) {
    const btn = h('button', { class: 'mb' }, name);
    btn.addEventListener('click', () => (openName === name ? closeMenu() : open(name, btn)));
    btn.addEventListener('pointerenter', () => { if (openName && openName !== name) open(name, btn); });
    bar.append(btn);
  }
  const title = h('div', { class: 'doc-title' });
  const extBtns = h('div', { class: 'mb-ext' });
  registry.onMenubar = () => { extBtns.replaceChildren(...registry.menubarButtons.map((fn) => { try { return fn(); } catch (e) { console.error(e); return ''; } })); };
  const saved = h('span', { class: 'saved', title: 'Автосохранение в браузере' });
  el.append(
    h('div', { class: 'logo', title: 'Аниматор 2D' }, icon('bone', 20), h('span', null, 'Аниматор 2D')),
    bar,
    h('div', { class: 'mb-tools' },
      h('button', { class: 'icon-btn', title: 'Отменить (Ctrl+Z)', onclick: () => app.undo() }, icon('undo', 18)),
      h('button', { class: 'icon-btn', title: 'Повторить (Ctrl+Shift+Z)', onclick: () => app.redo() }, icon('redo', 18)),
    ),
    title, saved,
    h('div', { class: 'mb-right' },
      extBtns,
      h('button', { class: 'btn sm', title: 'Сохранить проект в файл (Ctrl+S)', onclick: saveProject }, icon('save', 16), 'Сохранить'),
      h('button', { class: 'btn sm primary', title: 'Экспорт (Ctrl+E)', onclick: () => exportDialog() }, icon('export', 16), 'Экспорт'),
      h('button', { class: 'icon-btn', title: 'Справка (F1)', onclick: helpDialog }, icon('help', 18)),
    ),
  );
  app.on('autosaved', () => { saved.textContent = 'сохранено'; saved.classList.add('on'); setTimeout(() => saved.classList.remove('on'), 1500); });
  app.on('commit', () => { saved.textContent = '•'; });
  return title;
}

let titleEl;
function updateTitle() {
  if (!titleEl || !app.doc) return;
  titleEl.textContent = app.doc.name;
  document.title = app.doc.name + ' — Аниматор 2D';
}

// ---------- горячие клавиши ----------
function codeKey(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad') && /\d$/.test(c)) return c.slice(-1);
  return (e.key || '').toLowerCase();
}

function onKey(e) {
  const tg = e.target;
  const typing = (tg.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(tg.type)) || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable;
  if (typing) return;
  if (document.querySelector('.modal-back')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = codeKey(e);
  if (ctrl) {
    const map = {
      z: () => (e.shiftKey ? app.redo() : app.undo()), y: () => app.redo(), s: saveProject, o: () => openProject(), n: cmdNew,
      e: () => exportDialog(), c: cmdCopy, v: cmdPaste, x: cmdCut, a: cmdSelectAll, d: () => app.duplicateLayer(),
      0: () => app.fitView(), 1: () => app.zoomView(1 / app.view.z),
    };
    if (map[k]) { e.preventDefault(); closeMenu(); map[k](); }
    return;
  }
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) { app.spaceHeld = true; app.spaceUsed = false; }
    return;
  }
  // горячие клавиши модулей (в т.ч. Escape, Enter, стрелки) — раньше стандартных
  for (const sc of registry.shortcuts) {
    if (sc.key === k && !!sc.shift === e.shiftKey && !!sc.alt === e.altKey && (!sc.when || sc.when())) { e.preventDefault(); sc.run(e); return; }
  }
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); e.shiftKey ? app.jumpKey(-1) : app.setFrame(app.frame - 1); return;
    case 'ArrowRight': e.preventDefault(); e.shiftKey ? app.jumpKey(1) : app.setFrame(app.frame + 1); return;
    case 'Home': e.preventDefault(); app.setFrame(0); return;
    case 'End': e.preventDefault(); app.setFrame(app.doc.end); return;
    case 'Delete': case 'Backspace': e.preventDefault(); cmdDelete(); return;
    case 'Escape': closeMenu(); cmdDeselect(); return;
    case 'F1': case '?': e.preventDefault(); helpDialog(); return;
    case '+': case '=': app.zoomView(1.25); return;
    case '-': case '_': app.zoomView(0.8); return;
  }
  if (e.code === 'Quote') { toggleOpt('grid'); return; }
  if (e.altKey) return;
  if (k === 'k') { app.keyLayer(); return; }
  const t = toolForKey(k);
  if (t) { e.preventDefault(); setTool(t.id); }
}

function onKeyUp(e) {
  if (e.key === ' ' || e.code === 'Space') {
    const used = app.spaceUsed;
    app.spaceHeld = false;
    app.spaceUsed = false;
    const tg = e.target;
    if ((tg.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(tg.type)) || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA' || document.querySelector('.modal-back')) return;
    if (!used) app.emit('toggleplay');
  }
}

// ---------- разделители ----------
function splitter(el, target, { axis, min, max, key, invert }) {
  try { const v = +localStorage.getItem(key); if (v) target.style[axis === 'y' ? 'height' : 'width'] = v + 'px'; } catch (e) { /* нет доступа */ }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const start = axis === 'y' ? e.clientY : e.clientX;
    const s0 = axis === 'y' ? target.offsetHeight : target.offsetWidth;
    const mv = (ev) => {
      const d = (axis === 'y' ? ev.clientY : ev.clientX) - start;
      const v = Math.max(min, Math.min(max, s0 + (invert ? -d : d)));
      target.style[axis === 'y' ? 'height' : 'width'] = v + 'px';
    };
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      try { localStorage.setItem(key, axis === 'y' ? target.offsetHeight : target.offsetWidth); } catch (e) { /* нет доступа */ }
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
}

// ---------- запуск ----------
async function boot() {
  titleEl = buildMenubar($('#menubar'));
  initToolbox($('#toolbox'));
  initOptbar($('#optbar'));
  initLayers($('#layers'));
  initInspector($('#inspector'));
  initSideTabs($('#side-tabs'), $('#side-body'), $('#inspector'));
  initViewport($('#viewport'));
  initTimeline($('#timeline'));
  initPlayback();
  splitter($('#tl-split'), $('#timeline'), { axis: 'y', min: 120, max: 600, key: 'anim2d.tlh', invert: true });
  splitter($('#side-split'), $('#side'), { axis: 'x', min: 240, max: 520, key: 'anim2d.sidew', invert: true });

  const status = $('#status');
  const sHint = h('span', { class: 'st-hint' }), sPos = h('span', { class: 'st-pos' }), sSel = h('span', { class: 'st-sel' });
  status.append(sHint, sSel, sPos);
  app.registerPanel('status', () => {
    const t = tools[app.tool];
    sHint.textContent = t ? t.hint : '';
    const n = app.sel.pts.size, b = app.sel.bones.size, p = app.sel.paths.size;
    sSel.textContent = [n && `точек: ${n}`, p && `фигур: ${p}`, b && `костей: ${b}`].filter(Boolean).join(' · ');
  });
  app.on('status', (msg, e) => { if (e) sPos.textContent = `x ${Math.round(e.x)}  y ${Math.round(e.y)}`; });
  app.on('commit', updateTitle);
  app.on('docloaded', updateTitle);

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { app.spaceHeld = false; });
  window.addEventListener('beforeunload', () => { if (app.dirty) flushAutosave().catch(() => {}); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.dirty) flushAutosave().catch(() => {}); });

  // перетаскивание файлов на окно
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    if (/json|anim2d/i.test(f.name) || f.type === 'application/json') openProject(f);
    else if (f.type.startsWith('image/')) importImage(f);
    else if (f.type.startsWith('audio/')) importAudio(f);
  });

  try { app.opts.simple = localStorage.getItem('anim2d.simple') === '1'; } catch (e) { /* нет доступа */ }
  await loadExtensions();
  registry.onMenubar && registry.onMenubar();

  const restored = await loadAutosave();
  if (!restored) {
    openDemo();
    const first = registry.hooks.firstRun || [];
    if (first.length) setTimeout(() => first.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }), 300);
    else setTimeout(() => toast('Добро пожаловать! Это пример: тяните кости инструментом «Управление костями» (Z), Пробел — воспроизведение, F1 — справка.', 7000), 400);
  } else {
    app.fitView();
    toast('Восстановлен последний проект');
  }
  updateTitle();
}

// ---------- модули расширений (js/ext/*.js) ----------
// ?ext=presets,text — загрузить только указанные модули; ?ext= — ни одного
const EXTENSIONS = ['presets', 'record', 'followpath', 'motionpath', 'keyops', 'library', 'fbf', 'text', 'particles', 'poses', 'guide'];
async function loadExtensions() {
  const q = new URLSearchParams(location.search).get('ext');
  const list = q === null ? EXTENSIONS : q ? q.split(',').filter(Boolean) : [];
  // все файлы грузятся параллельно (modulepreload), а выполняются строго по порядку — стабильный порядок инструментов и меню
  for (const n of list) document.head.append(h('link', { rel: 'modulepreload', href: new URL(`./ext/${n}.js`, import.meta.url).href }));
  for (const n of list) {
    try { await import(`./ext/${n}.js`); } catch (e) { console.error(`Модуль «${n}» не загружен:`, e); }
  }
}

// Доступ из консоли браузера для отладки и скриптов
window.anim2d = app;
app.cmd = { cmdNew, openDemo: () => openDemo(), helpDialog, projectSettings, saveProject, openProject, exportDialog, setTool };

export { newDoc, newLayer };
boot();
