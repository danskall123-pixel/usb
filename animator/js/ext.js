// Реестры расширений. Модули из js/ext/*.js подключаются через них, не правя ядро.
// Этот файл ничего не импортирует, чтобы не создавать циклических зависимостей.

export const registry = {
  // Новые типы слоёв: type → {
  //   label: 'Текст', icon: 'text' (имя иконки), creatable: true (показывать в «Новый слой»),
  //   defaults(L) — заполнить поля нового слоя,
  //   channels(L) → [каналы] — анимируемые каналы (для таймлайна/ключей),
  //   draw(ctx, L, rec, S, o) — отрисовка (ctx уже в координатах документа; rec.world — матрица слоя),
  //   bounds(L, rec, S) → [[x, y], ...] — мировые точки содержимого (для рамки трансформации),
  //   svg(L, rec, S, { col, esc }) → строка SVG (без внешнего <g> слоя),
  // }
  layerTypes: {},
  // Секции панели «Свойства»: { id, order, when(L) → bool, build(L, helpers) → Element|null }
  inspector: [],
  // Вкладки правой панели: { id, title, icon, order, mount(el), refresh() }
  sideTabs: [],
  // Пункты меню верхней панели: имя меню ('Файл'|'Правка'|'Слой'|'Анимация'|'Вид'|'Справка') → [() => items]
  menus: {},
  // Пункты контекстного меню таймлайна: (ctx) => items
  timelineMenu: [],
  // Оверлеи холста (экранные координаты CSS-пикселей): (ctx, S) => void
  overlays: [],
  // Обработчики мыши холста до инструмента: { down(e) → true если перехвачено, move(e), up(e), hover(e) → курсор|null }
  viewportHandlers: [],
  // Кнопки справа в панели параметров инструмента: () => Element
  optbarButtons: [],
  // Кнопки в верхней панели (рядом с «Сохранить»): () => Element
  menubarButtons: [],
  // Горячие клавиши: { key (как KeyboardEvent.code без 'Key', в нижнем регистре), shift?, alt?, run(e), when?() }
  shortcuts: [],
  // Хуки
  hooks: {
    vectorTarget: [], // (activeLayer) → векторный слой, в который рисовать, или null
    docLoaded: [],    // (doc) => void
    firstRun: [],     // () => void — первый запуск (вместо приветственного уведомления)
    beforeCommit: [], // (label, doc) => void — нормализовать документ перед снимком истории
    layerIcon: [],    // (L) => имя иконки | null — своя иконка для конкретного слоя
    layerLabel: [],   // (L) => подпись типа | null
    onionSkip: [],    // (activeLayer) => true — не рисовать общую луковую кожу (у модуля своя)
  },
  // Шаблоны нового проекта: { id, name, description, order, build() → doc }
  templates: [],
};

export function registerLayerType(type, def) { registry.layerTypes[type] = def; }
export function registerInspector(sec) { registry.inspector.push(sec); registry.inspector.sort((a, b) => (a.order || 0) - (b.order || 0)); }
export function registerSideTab(tab) {
  registry.sideTabs = registry.sideTabs.filter((t) => t.id !== tab.id).concat(tab).sort((a, b) => (a.order || 0) - (b.order || 0));
  registry.onTabs && registry.onTabs();
}
export function registerMenu(name, fn) { (registry.menus[name] ||= []).push(fn); }
export function registerTimelineMenu(fn) { registry.timelineMenu.push(fn); }
export function registerOverlay(fn) { registry.overlays.push(fn); }
export function registerViewportHandler(h) { registry.viewportHandlers.push(h); }
export function registerOptbarButton(fn) { registry.optbarButtons.push(fn); }
export function registerMenubarButton(fn) { registry.menubarButtons.push(fn); registry.onMenubar && registry.onMenubar(); }
export function registerShortcut(s) { registry.shortcuts.push(s); }
export function registerHook(name, fn) { (registry.hooks[name] ||= []).push(fn); }
export function registerTemplate(t) { registry.templates.push(t); registry.templates.sort((a, b) => (a.order || 0) - (b.order || 0)); }

// Подключить CSS модуля
export function addStyle(css, id) {
  if (id && document.getElementById(id)) return;
  const s = document.createElement('style');
  if (id) s.id = id;
  s.textContent = css;
  document.head.append(s);
}
