// Обучение и «простой режим»: приветствие при первом запуске, интерактивный тур по редактору,
// вкладка «Старт» (мультик за 3 шага), переключатель простого режима и разовые подсказки.
// Другие модули (Оживить, Запись движения, Библиотека, Позы) определяются во время работы — их может и не быть.
import { app } from '../app.js';
import { h } from '../util.js';
import { icon, registerIcon } from '../icons.js';
import { registry, registerSideTab, registerMenubarButton, registerMenu, registerHook, addStyle } from '../ext.js';
import { tools } from '../tools.js';
import { dialog, closeMenu, checkField } from '../ui.js';
import { descendants, layerOwnChannels } from '../model.js';
import { evalCh, keyIndex } from '../anim.js';

registerIcon('rocket', '<path d="M12 15l-3-3c1.6-4.6 5.4-8.6 12-9-.4 6.6-4.4 10.4-9 12z"/><circle cx="15" cy="9" r="1.7"/><path d="M9 12H5l2.5-3.5h4M12 15v4l3.5-2.5v-4"/><path d="M6.5 16.5C5 17.5 4.5 19.5 4.5 19.5s2-.5 3-2"/>');

// ---------- хранилище в браузере (личные настройки, не документ) ----------
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* нет доступа */ } };
const TIPS_KEY = 'anim2d.tips';
function tipsState() {
  try { const s = JSON.parse(lsGet(TIPS_KEY) || '{}'); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; }
}
const saveTips = (s) => lsSet(TIPS_KEY, JSON.stringify(s));
const tipsOff = () => !!tipsState().off;
function setTipsOff(off) {
  const s = tipsState();
  if (off) s.off = 1; else delete s.off;
  saveTips(s);
  app.refresh(['sidetabs']);
}

// ---------- что есть в редакторе прямо сейчас ----------
const hasTab = (id) => registry.sideTabs.some((t) => t.id === id);
const hasTool = (id) => !!tools[id];
const q = (s) => document.querySelector(s);
const k = (s) => h('kbd', null, s);

// ---------- простой режим ----------
function setSimple(on, quiet) {
  app.opts.simple = !!on;
  lsSet('anim2d.simple', on ? '1' : '');
  app.fixTool();
  app.refresh();
  app.render();
  if (!quiet) app.toast(on ? 'Простой режим: оставлены только главные инструменты' : 'Простой режим выключен: доступны все инструменты', 2600);
}

// ---------- действия «в один клик» ----------
// Рисовать: если выбран слой костей или часть персонажа, рисунок ляжет на новый слой (иначе кости будут его гнуть)
function drawWith(id) {
  if (!hasTool(id)) return;
  const L = app.active;
  if (L && (L.lock || app.boneLayerFor(L))) app.setActive(null);
  app.cmd.setTool(id);
  const A = app.active;
  const where = !A ? '. Рисунок ляжет на новый слой.' : A.type === 'vector' ? `. Рисунок ляжет на слой «${A.name}».` : '.';
  const what = id === 'shape' ? 'Тяните по холсту — получится фигура (вид фигуры выбирается вверху)' : 'Рисуйте мышью прямо на холсте';
  app.toast(what + where, 3800);
}

function openTab(id, msg) {
  if (!hasTab(id) || !app.showSideTab) return false;
  app.showSideTab(id);
  const side = q('#side');
  if (side && !side.offsetWidth) app.toast('Правая панель скрыта — расширьте окно браузера', 3000);
  else if (msg) app.toast(msg, 3200);
  return true;
}

function animateRecord() {
  if (!hasTool('record')) return;
  app.cmd.setTool('record');
  app.toast('Запись движения: зажмите мышь на объекте и ведите — движение запишется в реальном времени', 4200);
}

// Вручную ключами: перейти на кадр и выбрать подходящий инструмент
function manualKeys() {
  const L = app.active;
  if (!L) { app.toast('Сначала выберите слой в панели «Слои» — то, что будем двигать', 3200); return; }
  // с начала диапазона уходим на секунду вперёд, иначе движение будет мгновенным
  const st = Math.max(1, app.doc.start);
  const f = app.frame > st ? app.frame : Math.max(st, Math.min(st + 23, app.doc.end));
  app.setFrame(f);
  const bone = !!app.boneLayerFor(L);
  app.cmd.setTool(bone ? 'bmanip' : 'ltransform');
  app.toast(`Кадр ${f}: потяните ${bone ? 'кость' : 'объект'} на холсте — ключ появится сам. Потом нажмите Пробел.`, 4800);
}

function togglePlay() {
  app.emit('toggleplay');
}

function exportVideo(fmt) {
  markDone('export');
  app.cmd.exportDialog(fmt);
}

// ---------- отметки «шаг выполнен» (только на эту сессию) ----------
const done = new Set();
function markDone(id) {
  if (done.has(id)) return;
  done.add(id);
  renderTab();
}

// =====================================================================
// Приветствие при первом запуске
// =====================================================================
function welcome() {
  closeMenu();
  let d = null;
  const choice = (v) => () => d && d.close(v);
  d = dialog({
    title: 'Добро пожаловать в Аниматор 2D',
    width: 560,
    body: h('div', { class: 'gd-welcome' },
      h('div', { class: 'gd-hero' },
        h('div', { class: 'gd-hero-ic' }, icon('rocket', 30)),
        h('div', null,
          h('b', null, 'Мультик — это просто!'),
          h('p', null, 'Нарисуйте героя, оживите его в один клик и сохраните видео.',
            app.doc && /^Пример/.test(app.doc.name || '') ? ' Сейчас открыт пример — персонаж на костях, его можно сразу подвигать.' : ''),
        ),
      ),
      h('div', { class: 'gd-choices' },
        h('button', { class: 'gd-choice primary', onclick: choice('new') },
          h('b', null, 'Я новичок — показать, как всё работает'),
          h('span', null, 'Включим простой режим (только главные инструменты) и за минуту покажем, где что находится.')),
        h('button', { class: 'gd-choice', onclick: choice('pro') },
          h('b', null, 'Я уже умею — сразу к делу'),
          h('span', null, 'Все инструменты и без подсказок. Тур всегда можно открыть: «Справка» → «Обучение».')),
      ),
    ),
    buttons: [],
    onClose: (v) => {
      lsSet('anim2d.guide.welcome', '1');
      if (v === 'new') {
        setSimple(true, true);
        setTipsOff(false);
        setTimeout(() => startTour({ first: true }), 120);
      } else if (v === 'pro') {
        setSimple(false, true);
        setTipsOff(true);
        app.toast('Все инструменты доступны. Тур по редактору — в меню «Справка»', 3200);
      } else app.toast('Тур по редактору можно открыть в любой момент: «Справка» → «Обучение»', 3600);
    },
  });
  const foot = d.box.querySelector('.modal-foot');
  if (foot) foot.remove();
}

// Первый запуск (нет автосохранения). Если выбор уже делали — не спрашивать снова, а коротко напомнить.
registerHook('firstRun', () => {
  if (!lsGet('anim2d.guide.welcome')) { welcome(); return; }
  if (app.opts.simple && hasTab('start') && app.showSideTab) app.showSideTab('start');
  if (tipsOff()) return; // «Я уже умею» — без подсказок
  app.toast('Это пример: тяните кости инструментом «Управление костями» (Z), Пробел — воспроизведение. План «мультик за 3 шага» — во вкладке «Старт».', 6500);
});

// =====================================================================
// Интерактивный тур (затемнение с «окошком» вокруг элемента + пузырь с текстом)
// =====================================================================
const recordBtn = () => (hasTool('record') ? q(`#toolbox .tb-btn[aria-label="${tools.record.name}"]`) : null);
const presetsBtn = () => [...document.querySelectorAll('.mb-ext button')].find((b) => /Оживить/.test(b.textContent)) || null;

const STEPS = [
  {
    id: 'canvas', el: () => q('#viewport'), side: 'inside', title: 'Это сцена',
    text: () => ['Здесь живут ваши герои. Всё, что внутри рамки кадра, попадёт в мультик. ',
      'Колесо мыши — приблизить или отдалить, правая кнопка мыши — подвинуть вид.'],
  },
  {
    id: 'tools', el: () => q('#toolbox'), title: 'Инструменты',
    text: () => ['Кисть ', k('F'), ' — рисуйте от руки. Фигура ', k('R'), ' — круг, звезда или сердце одним движением. ',
      'Наведите мышь на кнопку — появится подсказка.',
      app.opts.simple ? ' Сейчас включён простой режим: здесь только самое нужное.' : ''],
  },
  {
    id: 'layers', el: () => q('#layers'), title: 'Слои',
    text: () => ['Каждая часть рисунка лежит на своём слое — как листы прозрачной плёнки: верхний закрывает нижние. ',
      'Глаз — скрыть слой, замок — защитить от случайных правок.'],
  },
  {
    id: 'presets', el: presetsBtn, pad: 4, side: 'bottom', title: '✨ Оживить',
    text: () => ['Готовые анимации в один клик: появление, прыжки, покачивание, движение камеры. ',
      'Выберите слой и нажмите на эффект — ключи создадутся сами.'],
  },
  {
    id: 'timeline', el: () => q('#timeline'), title: 'Таймлайн и кадры',
    text: () => [`Мультик — это кадры, ${app.doc.fps} в секунду. Кадр 0 — поза покоя. `,
      'Перейдите на другой кадр (клик по линейке или ', k('←'), ' ', k('→'), ') и сдвиньте объект — появится ключ ◆. ',
      'Движение между ключами программа достроит сама.'],
  },
  {
    id: 'play', el: () => q('#timeline .icon-btn.play'), pad: 4, title: 'Посмотреть',
    text: () => ['Запускает и останавливает мультик. То же самое — клавиша ', k('Пробел'), '.'],
  },
  {
    id: 'record', el: recordBtn, pad: 4, title: 'Запись движения',
    text: () => ['Самый простой способ оживить: выберите этот инструмент (', k('J'), '), зажмите мышь на объекте и ведите — ',
      'движение запишется в реальном времени, как в кукольном театре.'],
  },
  {
    id: 'export', el: () => q('.mb-right > .btn.primary'), pad: 4, side: 'bottom', title: 'Готовое видео',
    text: () => ['Сохраните мультик как видео или GIF и покажите друзьям. Сам проект сохраняется в браузере автоматически.'],
  },
  {
    id: 'start', el: () => q('.side-tab[title="Старт"]'), pad: 4, title: 'Вкладка «Старт»',
    text: () => ['Значок с ракетой — здесь всегда под рукой план «мультик за 3 шага» с кнопками, которые всё сделают за вас. ',
      'Справка — ', k('F1'), '. Удачи!'],
  },
];

let T = null; // текущий тур

function visRect(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return null;
  return r;
}

// прокрутить панель, чтобы элемент был виден (без scrollIntoView — он может сдвинуть весь макет)
function revealInBox(el) {
  const box = el && el.parentElement && el.parentElement.closest('#toolbox, .layers-list');
  if (!box) return;
  const br = box.getBoundingClientRect(), er = el.getBoundingClientRect();
  if (er.top < br.top) box.scrollTop -= br.top - er.top + 8;
  else if (er.bottom > br.bottom) box.scrollTop += er.bottom - br.bottom + 8;
}

function startTour({ first = false } = {}) {
  if (T) endTour();
  closeMenu();
  if (app.playing) app.emit('stop');
  const steps = STEPS.filter((s) => visRect(s.el()));
  if (!steps.length) { app.toast('Окно слишком маленькое для тура — расширьте его'); return; }
  const back = h('button', { class: 'btn sm', onclick: () => go(-1) }, 'Назад');
  const next = h('button', { class: 'btn sm primary', onclick: () => go(1) }, 'Далее');
  const skip = h('button', { class: 'btn sm ghost gd-skip', title: 'Закрыть тур (Esc)', onclick: () => endTour('skip') }, 'Пропустить');
  const count = h('span', { class: 'gd-b-count' });
  const dots = h('span', { class: 'gd-dots' }, steps.map(() => h('i')));
  const title = h('div', { class: 'gd-b-title', id: 'gd-b-title' });
  const text = h('div', { class: 'gd-b-text' });
  const arrow = h('div', { class: 'gd-arrow' });
  const bubble = h('div', { class: 'gd-bubble', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gd-b-title' },
    arrow,
    h('div', { class: 'gd-b-head' }, count, dots),
    title, text,
    h('div', { class: 'gd-b-foot' }, skip, back, next),
  );
  const hole = h('div', { class: 'gd-hole' });
  const block = h('div', { class: 'gd-block' });
  // клики мимо пузыря никуда не проходят, чтобы случайно ничего не нарисовать
  block.addEventListener('pointerdown', (e) => e.preventDefault());
  block.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  block.addEventListener('contextmenu', (e) => e.preventDefault());
  const root = h('div', { class: 'gd-tour nohole' }, block, hole, bubble);
  document.body.append(root);
  T = { steps, i: 0, first, root, hole, bubble, arrow, title, text, count, dots, back, next, key: '', raf: 0 };
  window.addEventListener('keydown', onTourKey, true);
  window.addEventListener('keyup', onTourKeyUp, true);
  window.addEventListener('resize', layoutTour);
  showStep(0);
  const loop = () => {
    if (!T) return;
    const el = T.steps[T.i].el();
    const r = visRect(el);
    const key = r ? [r.left, r.top, r.width, r.height, innerWidth, innerHeight].map(Math.round).join(',') : 'none' + innerWidth + 'x' + innerHeight;
    if (key !== T.key) layoutTour();
    T.raf = requestAnimationFrame(loop);
  };
  T.raf = requestAnimationFrame(loop);
}

function showStep(i) {
  if (!T) return;
  T.i = Math.max(0, Math.min(T.steps.length - 1, i));
  const s = T.steps[T.i], n = T.steps.length, last = T.i === n - 1;
  revealInBox(s.el());
  T.count.textContent = `Шаг ${T.i + 1} из ${n}`;
  [...T.dots.children].forEach((d, j) => d.classList.toggle('on', j <= T.i));
  T.title.textContent = s.title;
  T.text.replaceChildren(...[].concat(s.text()).filter(Boolean).map((x) => (x.nodeType ? x : document.createTextNode(x))));
  T.back.disabled = T.i === 0;
  T.next.textContent = last ? 'Начать!' : 'Далее';
  T.key = '';
  layoutTour();
  T.next.focus({ preventScroll: true });
}

function go(d) {
  if (!T) return;
  if (d > 0 && T.i === T.steps.length - 1) { endTour('done'); return; }
  showStep(T.i + d);
}

function endTour(reason) {
  if (!T) return;
  cancelAnimationFrame(T.raf);
  T.root.remove();
  window.removeEventListener('keydown', onTourKey, true);
  window.removeEventListener('keyup', onTourKeyUp, true);
  window.removeEventListener('resize', layoutTour);
  const first = T.first;
  T = null;
  lsSet('anim2d.guide.tour', '1');
  if (reason === 'done') {
    const side = q('#side');
    if (hasTab('start') && app.showSideTab && side && side.offsetWidth) {
      app.showSideTab('start');
      app.toast('Готово! План «мультик за 3 шага» — во вкладке «Старт» справа', 4200);
    } else app.toast('Готово! Удачи! Справка — клавиша F1', 3200); // узкое окно: правой панели не видно
  } else if (reason === 'skip') {
    if (first && hasTab('start') && app.showSideTab) app.showSideTab('start');
    app.toast('Тур можно повторить: «Справка» → «Обучение»', 3000);
  }
}

function onTourKey(e) {
  if (!T) return;
  e.stopPropagation(); // горячие клавиши редактора во время тура не срабатывают
  const onBtn = e.target && e.target.tagName === 'BUTTON' && T.root.contains(e.target);
  if (e.key === 'Escape') { e.preventDefault(); endTour('skip'); }
  else if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === 'Enter' && !onBtn)) { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') e.preventDefault();
}
function onTourKeyUp(e) { if (T) e.stopPropagation(); }

function layoutTour() {
  if (!T) return;
  const s = T.steps[T.i];
  const r = visRect(s.el());
  const vw = innerWidth, vh = innerHeight, M = 12, G = 14;
  const b = T.bubble, a = T.arrow;
  T.key = r ? [r.left, r.top, r.width, r.height, vw, vh].map(Math.round).join(',') : 'none' + vw + 'x' + vh;
  const bw = b.offsetWidth, bh = b.offsetHeight;
  a.className = 'gd-arrow';
  a.style.left = a.style.top = '';
  if (!r) {
    T.root.classList.add('nohole');
    b.style.left = Math.max(M, (vw - bw) / 2) + 'px';
    b.style.top = Math.max(M, (vh - bh) / 2) + 'px';
    return;
  }
  T.root.classList.remove('nohole');
  const pad = s.pad == null ? 6 : s.pad;
  const l = Math.max(2, r.left - pad), t = Math.max(2, r.top - pad);
  const rr = Math.min(vw - 2, r.right + pad), bb = Math.min(vh - 2, r.bottom + pad);
  Object.assign(T.hole.style, { left: l + 'px', top: t + 'px', width: rr - l + 'px', height: bb - t + 'px' });
  const cx = (l + rr) / 2, cy = (t + bb) / 2;
  const clampX = (x) => Math.max(M, Math.min(vw - bw - M, x));
  const clampY = (y) => Math.max(M, Math.min(vh - bh - M, y));
  const cand = {
    right: () => { const x = rr + G; return x + bw <= vw - M && { x, y: clampY(cy - bh / 2), side: 'l' }; },
    left: () => { const x = l - G - bw; return x >= M && { x, y: clampY(cy - bh / 2), side: 'r' }; },
    bottom: () => { const y = bb + G; return y + bh <= vh - M && { x: clampX(cx - bw / 2), y, side: 't' }; },
    top: () => { const y = t - G - bh; return y >= M && { x: clampX(cx - bw / 2), y, side: 'b' }; },
    inside: () => ({ x: clampX(cx - bw / 2), y: clampY(bb - bh - 28), side: '' }),
  };
  const order = s.side === 'inside' ? ['inside'] : s.side === 'bottom' ? ['bottom', 'left', 'right', 'top', 'inside'] : ['right', 'bottom', 'left', 'top', 'inside'];
  let p = null;
  for (const o of order) { p = cand[o](); if (p) break; }
  b.style.left = p.x + 'px';
  b.style.top = p.y + 'px';
  if (p.side) {
    a.classList.add(p.side);
    if (p.side === 'l' || p.side === 'r') a.style.top = Math.max(14, Math.min(bh - 28, cy - p.y - 7)) + 'px';
    else a.style.left = Math.max(14, Math.min(bw - 28, cx - p.x - 7)) + 'px';
  }
}

// =====================================================================
// Вкладка «Старт»: мультик за 3 шага
// =====================================================================
let tabEl = null, tabSig = '';

const TIPS = [
  [k('Home'), 'Кадр 0 — поза покоя: здесь рисуют и строят скелет. Анимация — на кадрах 1, 2, 3…'],
  [k('Пробел'), 'Воспроизвести или остановить мультик.'],
  [k('Ctrl+Z'), 'Отменить любое действие. Ctrl+Shift+Z — вернуть.'],
  [h('span', null, k('←'), ' ', k('→')), 'Кадр назад / вперёд. С Shift — к соседнему ключу.'],
  [k('K'), 'Поставить ключ всему слою на текущем кадре.'],
  [k('F1'), 'Справка со всеми инструментами и клавишами.'],
];

function card(n, cls, title, text, acts, isDone) {
  return h('section', { class: 'gd-card ' + cls + (isDone ? ' done' : '') },
    h('div', { class: 'gd-num', 'aria-hidden': 'true' }, isDone ? '✓' : n),
    h('h3', null, title, isDone ? h('span', { class: 'gd-done', title: 'Этот шаг вы уже сделали' }, 'готово') : null),
    h('p', null, text),
    h('div', { class: 'gd-acts' }, acts),
  );
}
const bigBtn = (label, ic, onclick, title, primary) => h('button', { class: 'btn sm gd-big' + (primary ? ' primary' : ''), title: title || '', onclick }, ic ? icon(ic, 16) : null, label);

function buildTab() {
  const kids = [];
  kids.push(h('div', { class: 'gd-head' },
    h('h2', null, 'Мультик за 3 шага'),
    h('p', { class: 'gd-sub' }, 'Нажимайте кнопки по порядку — остальное программа сделает сама.'),
  ));

  // 1. Нарисовать
  const a1 = [
    bigBtn('Кисть', 'freehand', () => drawWith('freehand'), 'Рисовать от руки (F)', true),
    hasTool('shape') ? bigBtn('Фигура', 'shape', () => drawWith('shape'), 'Круг, звезда, сердце… (R)') : null,
    hasTab('library') ? bigBtn('Из библиотеки', 'library', () => openTab('library', 'Выберите готового героя или предмет и нажмите на него'), 'Готовые персонажи, предметы и фоны') : null,
  ];
  kids.push(card('1', 'c1', 'Нарисуйте',
    hasTab('library') ? 'Рисуйте кистью, ставьте фигуры или возьмите готового героя из библиотеки.' : 'Рисуйте кистью от руки или ставьте готовые фигуры одним движением.',
    [a1, h('button', { class: 'gd-link', title: 'Создать новый пустой проект', onclick: () => app.cmd.cmdNew() }, 'Начать с чистого листа')], done.has('draw')));

  // 2. Оживить
  const a2 = [];
  if (hasTab('presets')) a2.push(bigBtn('Оживить', 'sparkle', () => openTab('presets', 'Выберите слой и нажмите на эффект — анимация готова'), 'Готовые анимации в один клик', true));
  if (hasTool('record')) a2.push(bigBtn('Запись движения', 'record', animateRecord, 'Ведите объект мышью — движение запишется (J)', !a2.length));
  if (hasTab('poses')) a2.push(bigBtn('Позы', 'poses', () => openTab('poses', 'Выберите позу — персонаж примет её на текущем кадре'), 'Готовые позы для персонажа на костях'));
  const auto = a2.length > 0;
  a2.push(auto
    ? h('button', { class: 'gd-link', title: 'Перейти на кадр и выбрать инструмент для перемещения', onclick: manualKeys }, 'Или вручную, ключами')
    : bigBtn('Показать как', 'key', manualKeys, 'Перейти на кадр 24 и выбрать инструмент перемещения', true));
  kids.push(card('2', 'c2', 'Оживите',
    auto ? 'Выберите слой и примените готовое движение — или покажите движение мышью.'
      : 'Перейдите на кадр 24 и сдвиньте рисунок — получится ключ. Движение между ключами программа достроит сама.',
    a2, done.has('anim')));

  // 3. Посмотреть
  kids.push(card('3', 'c3', 'Посмотрите', ['Запустите мультик. То же самое — клавиша ', k('Пробел'), '.'],
    [bigBtn(app.playing ? 'Пауза' : 'Смотреть', app.playing ? 'pause' : 'play', togglePlay, 'Воспроизвести / пауза (Пробел)', true)], done.has('play')));

  // 4. Сохранить видео
  kids.push(card('★', 'c4', 'Сохраните видео', 'Готово? Сохраните мультик и покажите друзьям.',
    [bigBtn('Видео', 'film', () => exportVideo('video'), 'Экспорт видео', true), bigBtn('GIF', 'image', () => exportVideo('gif'), 'Экспорт анимированного GIF')], done.has('export')));

  // советы
  kids.push(h('div', { class: 'insp-title gd-tips-title' }, 'Полезно знать'));
  kids.push(h('ul', { class: 'gd-tips' }, TIPS.map(([key, txt]) => h('li', null, h('span', { class: 'gd-tip-k' }, key), h('span', null, txt)))));

  // настройки
  kids.push(h('div', { class: 'insp-title gd-tips-title' }, 'Настройки'));
  kids.push(h('div', { class: 'gd-opts' },
    checkField('Простой режим — только главные инструменты', !!app.opts.simple, (v) => setSimple(v), 'Скрывает сложные инструменты. Включить все можно в любой момент.'),
    checkField('Подсказки для новичков', !tipsOff(), (v) => { setTipsOff(!v); if (v) app.toast('Подсказки включены — будут появляться по ходу работы'); }, 'Короткие советы внизу экрана, каждый — один раз'),
  ));
  kids.push(h('div', { class: 'btn-row' },
    h('button', { class: 'btn sm', onclick: () => startTour() }, icon('rocket', 15), 'Тур по редактору'),
    h('button', { class: 'btn sm', onclick: () => app.cmd.helpDialog() }, icon('help', 15), 'Справка'),
  ));
  return kids;
}

function renderTab(force) {
  if (!tabEl) return;
  if (!force && tabEl.hidden) return;
  const sig = [app.opts.simple, tipsOff(), hasTab('presets'), hasTab('library'), hasTab('poses'), hasTool('record'), hasTool('shape'), [...done].join(), app.playing].join('|');
  if (!force && sig === tabSig) return;
  tabSig = sig;
  const st = tabEl.scrollTop;
  tabEl.replaceChildren(...buildTab());
  tabEl.scrollTop = st;
}

registerSideTab({
  id: 'start', title: 'Старт', icon: 'rocket', order: -20,
  mount(el) { tabEl = el; el.classList.add('gd-start'); renderTab(true); },
  refresh() { renderTab(); },
});

// новичку (включён простой режим) при запуске сразу показать план «мультик за 3 шага»
let bootTab = false;
registerHook('docLoaded', () => {
  if (bootTab) return;
  bootTab = true;
  if (app.opts.simple && app.showSideTab) setTimeout(() => hasTab('start') && app.showSideTab('start'), 0);
});

// любое воспроизведение (кнопка, Пробел, вкладка) — шаг «Посмотрите» выполнен; кнопка Смотреть/Пауза следует за состоянием
app.on('playstate', (on) => { if (on) markDone('play'); renderTab(); checkTip(); });

// =====================================================================
// Кнопка «Простой режим» в верхней панели
// =====================================================================
let mbBtn = null;
function syncMb() {
  if (!mbBtn) return;
  const on = !!app.opts.simple;
  mbBtn.classList.toggle('on', on);
  mbBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  mbBtn.title = on ? 'Простой режим включён: показаны только главные инструменты. Нажмите, чтобы показать все.'
    : 'Простой режим: оставить только главные инструменты — удобно для начала';
}
registerMenubarButton(() => {
  mbBtn = h('button', { class: 'gd-mb', onclick: () => setSimple(!app.opts.simple) },
    h('span', { class: 'gd-sw', 'aria-hidden': 'true' }), h('span', { class: 'gd-mb-l' }, 'Простой режим'), h('span', { class: 'gd-mb-s' }, 'Просто'));
  mbBtn.setAttribute('aria-label', 'Простой режим');
  syncMb();
  return mbBtn;
});

// =====================================================================
// Меню «Справка»
// =====================================================================
registerMenu('Справка', () => [
  { label: 'Обучение: тур по редактору', icon: 'rocket', action: () => startTour() },
  { label: 'Мультик за 3 шага (вкладка «Старт»)', disabled: () => !hasTab('start'), action: () => openTab('start') },
  { label: 'Подсказки для новичков', checked: !tipsOff(), action: () => { setTipsOff(!tipsOff()); app.toast(tipsOff() ? 'Подсказки выключены' : 'Подсказки включены'); } },
  { label: 'Показать все подсказки заново', action: () => { saveTips({}); app.toast('Подсказки снова будут появляться по ходу работы'); app.refresh(['sidetabs']); } },
  { label: 'Окно приветствия', action: welcome },
]);

// =====================================================================
// Разовые подсказки по ходу работы (каждая — один раз, хранятся в браузере)
// =====================================================================
// still() — подсказка ещё к месту (тот же слой/кадр…). Отложенная подсказка без него не показывается,
// а уже показанная убирается, как только пользователь ушёл дальше.
let lastTipAt = 0, queue = [], qTimer = 0, shown = [];
const tipBusy = () => !!T || !!q('.modal-back') || performance.now() - lastTipAt < 3500;

function tip(id, text, { ms = 7000, still = null } = {}) {
  const s = tipsState();
  if (s.off || s[id]) return false;
  if (still && !still()) return false;
  if (tipBusy()) { // показать чуть позже, если ещё будет к месту
    queue = queue.filter((x) => x.id !== id).concat({ id, text, ms, still, at: performance.now() }).slice(-3);
    pumpTips();
    return false;
  }
  showTip(id, text, ms, still);
  return true;
}

function showTip(id, text, ms, still) {
  const s = tipsState();
  s[id] = 1;
  saveTips(s);
  lastTipAt = performance.now();
  const span = h('span', { class: 'gd-tip' }, h('b', null, 'Подсказка. '), text,
    h('button', { class: 'gd-tip-x', title: 'Скрыть подсказку', 'aria-label': 'Скрыть подсказку', onclick: () => hideTip(span) }, '✕'));
  app.toast(span, ms);
  shown.push({ id, span, still, at: performance.now() });
}

// отметить подсказку как уже не нужную (пользователь сам сделал то, о чём она)
function tipSeen(id) {
  const s = tipsState();
  queue = queue.filter((x) => x.id !== id);
  if (!s[id]) { s[id] = 1; saveTips(s); }
}

function hideTip(span) {
  shown = shown.filter((x) => x.span !== span);
  const t = span && span.closest('.toast');
  if (!t || t.classList.contains('out')) return;
  t.classList.add('out');
  setTimeout(() => t.remove(), 300);
}

// показанная подсказка устарела (другой слой, кадр, началось воспроизведение…) — убрать её
function checkTip() {
  for (const x of shown.slice()) {
    if (!x.span.isConnected) { shown = shown.filter((y) => y !== x); continue; }
    let ok = true;
    try { ok = !x.still || !!x.still(); } catch (e) { ok = false; }
    if (ok) continue;
    hideTip(x.span);
    // мелькнула и сразу устарела — её толком не прочли: пусть покажется в следующий раз
    if (performance.now() - x.at < 1500) { const s = tipsState(); delete s[x.id]; saveTips(s); }
  }
}
app.on('docloaded', () => checkTip());

function pumpTips() {
  if (qTimer) return;
  qTimer = setTimeout(() => {
    qTimer = 0;
    const s = tipsState(), now = performance.now();
    queue = queue.filter((x) => {
      if (s.off || s[x.id] || now - x.at > 20000) return false;
      try { return !x.still || !!x.still(); } catch (e) { return false; }
    });
    if (!queue.length) return;
    if (tipBusy()) { pumpTips(); return; }
    const x = queue.shift();
    showTip(x.id, x.text, x.ms, x.still);
    if (queue.length) pumpTips();
  }, 1200);
}

// покадровый слой (встроенный «Переключатель» с флагом fbf) — сам слой или его рисунок
function fbfOf(L) {
  if (!L || !app.idx) return null;
  if (L.type === 'switch' && L.fbf) return L;
  const p = app.idx.parent.get(L.id);
  return p && p.type === 'switch' && p.fbf ? p : null;
}

// После правки на кадре f у слоя (его частей или его скелета) есть ключ на f и видимое при просмотре движение:
// значения внутри диапазона сцены где-то отличаются от первого кадра. Расстановка на первом кадре и
// единственный ключ на первом кадре движения не дают.
function makesMotion(A, f) {
  if (!A || !app.doc || f > app.doc.end) return false;
  const st = app.doc.start, en = app.doc.end;
  const set = [A, ...descendants(A)];
  const B = app.boneLayerFor(A);
  if (B && !set.includes(B)) set.push(B);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const L of set) {
    let chans = [];
    try { chans = layerOwnChannels(L); } catch (e) { continue; }
    for (const c of chans) {
      if (!c || !Array.isArray(c.k) || c.k.length < 2 || keyIndex(c, f) < 0) continue;
      const v0 = evalCh(c, st);
      if (c.k.some((key) => key.f > st && key.f <= en && !same(evalCh(c, key.f), v0))) return true;
    }
  }
  return false;
}

// переход на кадр: подсказка, если пользователь задержался на нём (не во время воспроизведения/записи/предпросмотра)
let frameTimer = 0;
app.on('frame', () => {
  clearTimeout(frameTimer);
  checkTip();
  if (app.playing) return;
  frameTimer = setTimeout(() => {
    if (app.playing || app.tool === 'record' || !app.doc) return;
    const f = app.frame, st = app.doc.start;
    // первый кадр сцены — расстановка, а не анимация: про ключи говорим только дальше
    if (f > st) tip('frame', 'Это кадр анимации: всё, что вы здесь сдвинете или повернёте, станет ключом — ромбиком ◆ на таймлайне. Кадр 0 — поза покоя.',
      { still: () => app.frame > app.doc.start && !app.playing });
    else if (f === 0) tip('frame0', 'Кадр 0 — поза покоя: здесь рисуют и строят скелет. Изменения на нём действуют на весь мультик.',
      { still: () => app.frame === 0 });
  }, 800);
});

// выбор слоя костей пользователем (загрузка проекта событие 'active' не шлёт)
app.on('active', (id) => {
  checkTip();
  const L = app.active;
  if (L && L.type === 'bone') {
    tip('bone', 'Это слой костей — скелет персонажа. Инструмент «Управление костями» (Z): тяните за кость, и персонаж двигается. На кадре дальше первого получится анимация.',
      { still: () => app.activeId === id });
  }
});

// завершённые действия (метку действия ядро передаёт в событие 'commit')
const DRAW_RE = /^(Рисование|Фигура|Заливка|Добавление точки|Новый текст|Библиотека:)/;
const ANIM_RE = /^(Оживить:|Запись движения|Путь движения|Траектория|Ходьба|Промежуточная поза|Новый рисунок|Копия рисунка|Моргание|Рот болтает)/;
const MOVE_RE = /^(Трансформация слоя|Поза костей|Перемещение точек|Трансформация точек|Перемещение фигур|Перемещение текста|Положение слоя|Поворот слоя|Масштаб слоя|Непрозрачность|Угол кости|Положение кости|Масштаб кости|Ключ на кадре|Поза «)/;
app.on('commit', (label) => {
  label = String(label || '');
  const f = app.frame, A = app.active;
  if (DRAW_RE.test(label)) {
    markDone('draw');
    if (/^(Рисование|Фигура)/.test(label)) {
      if (fbfOf(A)) {
        // покадровый слой: оживляют не эффектом, а следующим рисунком
        tip('fbfdraw', ['Отличный рисунок! Теперь нажмите ', k('N'), ' — появится чистый лист для следующего кадра, а этот рисунок будет просвечивать. Так, рисунок за рисунком, и получается мультик.'],
          { ms: 8000, still: () => !!fbfOf(app.active) });
      } else {
        const msg = hasTab('presets') ? 'Отличный рисунок! Нажмите «✨ Оживить» вверху, чтобы анимировать его в один клик.'
          : hasTool('record') ? 'Отличный рисунок! Чтобы оживить его, выберите «Запись движения» (J) и ведите рисунок мышью.'
            : 'Отличный рисунок! Чтобы оживить его, перейдите на кадр 24 и сдвиньте рисунок инструментом «Трансформировать слой» (M).';
        tip('draw', msg, { still: () => !app.playing });
      }
    }
  }
  const moved = f > 0 && MOVE_RE.test(label) && makesMotion(A, f);
  if (ANIM_RE.test(label) || moved) markDone('anim');
  // расстановку на первом кадре («Расстановка слоя») ядро объясняет само — это не ключ
  if (moved) {
    tipSeen('frame'); // ключ уже сделан — подсказка «это кадр анимации» больше не нужна
    tip('key', `Ключ на кадре ${f} готов. Нажмите Пробел, чтобы посмотреть движение.`, { still: () => !app.playing });
  } else if (f === 0 && /^(Трансформация слоя|Поза костей)/.test(label)) {
    tip('rest', 'Вы изменили позу покоя (кадр 0) — она действует на все кадры. Чтобы анимировать, сначала перейдите на другой кадр стрелкой →.',
      { still: () => app.frame === 0 });
  }
  checkTip();
});

// общая синхронизация при обновлении интерфейса
app.registerPanel('guide', () => {
  syncMb();
  renderTab();
});

// =====================================================================
// Стили
// =====================================================================
addStyle(`
.gd-mb { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px 0 8px; border-radius: var(--radius); border: 1px solid var(--line2); background: var(--bg2); color: var(--text2); font-size: 12px; white-space: nowrap; }
.gd-mb:hover { background: var(--bg3); color: var(--text); }
.gd-sw { position: relative; width: 26px; height: 14px; border-radius: 7px; background: var(--bg4); flex: none; transition: background .15s; }
.gd-sw::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--text2); transition: left .15s, background .15s; }
.gd-mb.on { color: #fff; border-color: rgba(76,157,255,.45); background: var(--accent-bg); }
.gd-mb.on .gd-sw { background: var(--accent2); }
.gd-mb.on .gd-sw::after { left: 14px; background: #fff; }
.gd-mb-s { display: none; }
@media (max-width: 1100px) { .gd-mb-l { display: none; } .gd-mb-s { display: inline; } .gd-mb { gap: 6px; padding: 0 8px 0 7px; } }
/* пока видны «Сохранить» и «Экспорт», на узком окне подпись не влезает — остаётся только переключатель с подсказкой */
@media (max-width: 990px) and (min-width: 861px), (max-width: 720px) { .gd-mb-s { display: none; } .gd-mb { padding: 0 7px; } }

.gd-welcome .gd-hero { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
.gd-hero-ic { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex: none; color: #fff; background: linear-gradient(135deg, #4c9dff, #9b7bff); }
.gd-hero b { font-size: 16px; color: #fff; }
.gd-hero p { margin: 4px 0 0; color: var(--text2); line-height: 1.5; }
.gd-choices { display: flex; flex-direction: column; gap: 10px; }
.gd-choice { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; padding: 14px 16px; border-radius: 10px; border: 1px solid var(--line2); background: var(--bg2); color: var(--text); }
.gd-choice b { font-size: 14.5px; color: #fff; }
.gd-choice span { color: var(--text2); font-size: 12.5px; line-height: 1.45; }
.gd-choice:hover { border-color: var(--accent); background: #26354a; }
.gd-choice.primary { border-color: rgba(76,157,255,.6); background: linear-gradient(135deg, rgba(76,157,255,.22), rgba(155,123,255,.16)); }
.gd-choice.primary:hover { background: linear-gradient(135deg, rgba(76,157,255,.34), rgba(155,123,255,.24)); }

.gd-tour { position: fixed; inset: 0; z-index: 1800; }
.gd-block { position: absolute; inset: 0; }
.gd-tour.nohole .gd-block { background: rgba(8,9,11,.62); }
.gd-hole { position: absolute; border-radius: 10px; box-shadow: 0 0 0 200vmax rgba(8,9,11,.62); pointer-events: none; transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease; }
.gd-hole::after { content: ''; position: absolute; inset: -3px; border-radius: 12px; border: 2px solid var(--accent); animation: gd-pulse 1.6s ease-in-out infinite; }
.gd-tour.nohole .gd-hole { display: none; }
@keyframes gd-pulse { 50% { inset: -7px; opacity: .3; } }
.gd-bubble { position: absolute; left: 0; top: 0; width: 340px; max-width: calc(100vw - 24px); padding: 14px 16px 12px; border-radius: 12px; background: #2a2e35; border: 1px solid var(--line2); box-shadow: 0 18px 50px rgba(0,0,0,.55); color: var(--text); animation: gd-in .2s ease-out; }
@keyframes gd-in { from { opacity: 0; transform: translateY(6px); } }
.gd-arrow { position: absolute; width: 14px; height: 14px; background: #2a2e35; border: 1px solid var(--line2); transform: rotate(45deg); display: none; }
.gd-arrow.l { display: block; left: -8px; border-top: 0; border-right: 0; }
.gd-arrow.r { display: block; right: -8px; border-bottom: 0; border-left: 0; }
.gd-arrow.t { display: block; top: -8px; border-right: 0; border-bottom: 0; }
.gd-arrow.b { display: block; bottom: -8px; border-top: 0; border-left: 0; }
.gd-b-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.gd-b-count { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
.gd-dots { display: flex; gap: 4px; }
.gd-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--bg4); }
.gd-dots i.on { background: var(--accent); }
.gd-b-title { font-size: 15.5px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.gd-b-text { font-size: 13px; line-height: 1.55; color: var(--text); }
.gd-b-foot { display: flex; align-items: center; gap: 6px; margin-top: 14px; }
.gd-b-foot .gd-skip { margin-right: auto; padding-left: 0; }
.gd-b-foot .btn:disabled { opacity: .4; cursor: default; }

.gd-start h2 { margin: 2px 0 2px; font-size: 16px; color: #fff; }
.gd-sub { margin: 0 0 6px; color: var(--text2); font-size: 12.5px; line-height: 1.45; }
.gd-card { display: grid; grid-template-columns: 34px minmax(0, 1fr); column-gap: 10px; row-gap: 3px; padding: 11px 12px 12px; margin: 8px 0; border-radius: 10px; background: var(--bg2); border: 1px solid var(--line); }
.gd-card > :not(.gd-num) { grid-column: 2; }
.gd-num { grid-row: 1 / span 3; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; color: #fff; background: var(--accent2); }
.gd-card.c1 .gd-num { background: #f07b2c; }
.gd-card.c2 .gd-num { background: #8a6cf0; }
.gd-card.c3 .gd-num { background: #2a9d63; }
.gd-card.c4 .gd-num { background: #2f7fe6; }
.gd-card.done { border-color: rgba(47,179,111,.45); }
.gd-card.done .gd-num { background: #2fb36f; }
.gd-card h3 { display: flex; align-items: center; gap: 8px; margin: 1px 0 0; font-size: 14px; color: #fff; }
.gd-done { padding: 1px 7px; border-radius: 9px; background: rgba(47,179,111,.18); color: #7fd36b; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.gd-card p { margin: 0; color: var(--text2); font-size: 12px; line-height: 1.45; }
.gd-card kbd { font-size: 10px; }
.gd-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
.gd-big { padding: 6px 11px; font-weight: 600; }
.gd-link { padding: 2px 0; border: 0; background: none; color: var(--accent); font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
.gd-link:hover { color: #8cc0ff; }
.gd-tips-title { margin: 16px 0 4px; }
.gd-tips { margin: 0; padding: 0; list-style: none; }
.gd-tips li { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; border-top: 1px solid var(--line); color: var(--text2); font-size: 12px; line-height: 1.4; }
.gd-tips li:first-child { border-top: 0; }
.gd-tip-k { flex: none; min-width: 58px; }
.gd-opts { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 4px; }
.gd-tip b { color: var(--warm); font-weight: 600; }
.gd-tip kbd { font-size: 10.5px; }
.gd-tip-x { margin-left: 8px; padding: 0 5px; border: 0; border-radius: 4px; background: none; color: var(--text3); font-size: 11px; line-height: 18px; vertical-align: 1px; }
.gd-tip-x:hover { background: var(--bg3); color: var(--text); }
`, 'guide-css');
