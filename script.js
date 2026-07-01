/* =============================================================================
   script.js — логика сайта Rust Wipe Hub
   -----------------------------------------------------------------------------
   Содержит:
     1) Навигацию по вкладкам (SPA-стиль, без перезагрузки, с #hash-роутингом)
     2) Счётчик до force wipe (первый четверг месяца, 19:00 UTC)
     3) Рендер биомов / ресурсов / монументов (данные из data.js)
     4) 3D-карту острова на Three.js (OrbitControls) + заглушку под RustMaps API
     5) Калькуляторы рейда и апкипа (данные в редактируемых объектах)
   Данные (MONUMENTS, BIOMES, RESOURCES) приходят глобально из data.js.

   ВАЖНО: Three.js подключается ЛЕНИВО (dynamic import) внутри initMap(), а не
   на верхнем уровне модуля. Так основной сайт (таймер, таблицы, калькуляторы)
   работает даже если CDN с Three.js недоступен — падает только 3D-карта.
============================================================================= */

/* =============================================================================
   1. НАВИГАЦИЯ ПО ВКЛАДКАМ
   Паттерн ARIA tablist: клик + стрелки влево/вправо + Home/End.
   Синхронизируется с адресной строкой через #hash (deep-linking).
============================================================================= */
const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = Array.from(document.querySelectorAll('.panel'));
let mapInitialized = false; // 3D-сцену инициализируем лениво — при первом открытии

function activateTab(name, { focus = false, updateHash = true } = {}) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1; // roving tabindex
    if (isActive && focus) tab.focus();
  });
  panels.forEach((panel) => {
    const isActive = panel.id === `panel-${name}`;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });

  if (updateHash) history.replaceState(null, '', `#${name}`);

  // Ленивая инициализация тяжёлой 3D-сцены только когда вкладка реально открыта
  if (name === 'map' && !mapInitialized) {
    mapInitialized = true;
    initMap();
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab, { focus: false }));

  // Клавиатурная навигация по вкладкам
  tab.addEventListener('keydown', (e) => {
    let newIndex = null;
    if (e.key === 'ArrowRight') newIndex = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') newIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') newIndex = 0;
    else if (e.key === 'End') newIndex = tabs.length - 1;
    if (newIndex !== null) {
      e.preventDefault();
      activateTab(tabs[newIndex].dataset.tab, { focus: true });
    }
  });
});

/* =============================================================================
   2. СЧЁТЧИК ДО FORCE WIPE
   Правило: force wipe = ПЕРВЫЙ ЧЕТВЕРГ каждого месяца в 19:00 UTC.
============================================================================= */
const WIPE_HOUR_UTC = 19; // опорное время вайпа (UTC) — вынесено в константу

/**
 * Возвращает Date (UTC) первого четверга указанного месяца в WIPE_HOUR_UTC:00.
 * @param {number} year  полный год (например, 2026)
 * @param {number} month индекс месяца 0..11
 */
function firstThursdayUTC(year, month) {
  // День недели 1-го числа месяца (0=вс … 4=чт)
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  // Смещение до ближайшего четверга (4)
  const offset = (4 - firstDow + 7) % 7;
  const day = 1 + offset;
  return new Date(Date.UTC(year, month, day, WIPE_HOUR_UTC, 0, 0));
}

/**
 * Список ближайших `count` вайпов начиная с текущего момента (включая идущий сегодня,
 * если время ещё не наступило). Возвращает массив Date в порядке возрастания.
 */
function getUpcomingWipes(count) {
  const now = new Date();
  const result = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();

  // Идём по месяцам вперёд, пока не наберём нужное количество будущих дат
  while (result.length < count) {
    const wipe = firstThursdayUTC(year, month);
    if (wipe.getTime() > now.getTime()) result.push(wipe);
    // следующий месяц
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return result;
}

// Форматтеры даты/времени
const localDateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', weekday: 'short' });
const localTimeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const utcFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

const pad = (n) => String(n).padStart(2, '0');

// DOM-узлы таймера
const el = (id) => document.getElementById(id);
const hero = el('hero');
const cdDays = el('cd-days'), cdHours = el('cd-hours'), cdMins = el('cd-mins'), cdSecs = el('cd-secs');

/** Короткая строка «осталось» для таблицы */
function humanizeLeft(ms) {
  if (ms <= 0) return 'идёт';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `${d} д ${h} ч`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h} ч ${m} мин`;
}

let currentTarget = null; // ближайший вайп (Date)

/** Обновляет «метаданные» ближайшего вайпа (локально + UTC) и таблицу */
function renderWipeMeta() {
  const upcoming = getUpcomingWipes(6);
  currentTarget = upcoming[0];

  // Часовой пояс пользователя
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'локальный';
  el('tz-name').textContent = `(${tz})`;

  el('wipe-local').textContent = `${localDateFmt.format(currentTarget)}, ${localTimeFmt.format(currentTarget)}`;
  el('wipe-utc').textContent = `${utcFmt.format(currentTarget)} UTC`;

  // Таблица ближайших 6 вайпов
  const tbody = el('wipe-table');
  tbody.innerHTML = '';
  upcoming.forEach((wipe, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="tabular">${i + 1}</td>
      <td>${localDateFmt.format(wipe)}</td>
      <td class="tabular">${localTimeFmt.format(wipe)}</td>
      <td class="tabular">${utcFmt.format(wipe)}</td>
      <td class="tabular">${humanizeLeft(wipe.getTime() - Date.now())}</td>`;
    tbody.appendChild(tr);
  });
}

/** Тик таймера — раз в секунду */
function tickCountdown() {
  if (!currentTarget) return;
  const diff = currentTarget.getTime() - Date.now();

  if (diff <= 0) {
    // Вайп наступил: показываем «WIPE IS LIVE» и через минуту пересчитываем
    hero.classList.add('is-live');
    // Автопересчёт: как только «окно вайпа» прошло, берём следующую дату
    // (держим статус LIVE ~2 минуты, затем пересчёт)
    if (diff < -2 * 60 * 1000) {
      hero.classList.remove('is-live');
      renderWipeMeta();
    }
    return;
  }

  hero.classList.remove('is-live');
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  cdDays.textContent = pad(d);
  cdHours.textContent = pad(h);
  cdMins.textContent = pad(m);
  cdSecs.textContent = pad(s);
}

/* =============================================================================
   3. РЕНДЕР ДАННЫХ (биомы, ресурсы, монументы)
============================================================================= */

// --- Биомы ---
function renderBiomes() {
  const grid = el('biomes-grid');
  if (!grid || typeof BIOMES === 'undefined') return;
  grid.innerHTML = BIOMES.map((b) => `
    <article class="card">
      <h3 style="color:var(--color-primary); font-size:1.1rem">${b.nameRu}</h3>
      <p style="color:var(--color-fg-muted); margin-top:0; font-size:0.82rem">${b.name}</p>
      <p><strong>Климат:</strong> ${b.climate}</p>
      <p><strong>Ресурсы:</strong> ${b.resources}</p>
      <p><strong>Живность:</strong> ${b.animals}</p>
      <p style="color:var(--color-fg-muted)"><strong style="color:var(--color-secondary)">Совет:</strong> ${b.tips}</p>
    </article>`).join('');
}

// --- Ресурсы ---
function renderResources() {
  const tbody = el('resources-table');
  if (!tbody || typeof RESOURCES === 'undefined') return;
  tbody.innerHTML = RESOURCES.map((r) => `
    <tr>
      <td><strong>${r.nameRu}</strong><br><span style="color:var(--color-fg-muted); font-size:0.78rem">${r.name}</span></td>
      <td>${r.source}</td>
      <td>${r.where}</td>
      <td style="color:var(--color-fg-muted)">${r.tip}</td>
    </tr>`).join('');
}

// --- Монументы (с фильтром по сложности) ---
const TIER_META = {
  0: { label: 'Сейф-зона', cls: 'badge--safe' },
  1: { label: 'Tier 1', cls: 'badge--green' },
  2: { label: 'Tier 2', cls: 'badge--blue' },
  3: { label: 'Tier 3', cls: 'badge--red' },
};
const CARD_META = {
  none:  { label: 'Без карты', cls: 'badge--safe' },
  green: { label: 'Зелёная карта', cls: 'badge--green' },
  blue:  { label: 'Синяя карта', cls: 'badge--blue' },
  red:   { label: 'Красная карта', cls: 'badge--red' },
};
const RAD_META = {
  none:   { label: 'Без радиации', cls: 'badge--safe' },
  low:    { label: 'Радиация: низкая', cls: 'badge--green' },
  medium: { label: 'Радиация: средняя', cls: 'badge--blue' },
  high:   { label: 'Радиация: высокая', cls: 'badge--red' },
};

function badge(meta) {
  return `<span class="badge ${meta.cls}"><span class="dot" aria-hidden="true"></span>${meta.label}</span>`;
}

function renderMonuments(tierFilter = 'all') {
  const grid = el('monuments-grid');
  if (!grid || typeof MONUMENTS === 'undefined') return;

  const list = tierFilter === 'all'
    ? MONUMENTS
    : MONUMENTS.filter((m) => String(m.tier) === String(tierFilter));

  if (list.length === 0) {
    grid.innerHTML = `<p style="color:var(--color-fg-muted)">Нет монументов под этот фильтр.</p>`;
    return;
  }

  grid.innerHTML = list.map((m) => `
    <article class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:var(--space-sm)">
        <div>
          <h3 style="color:var(--color-fg); font-size:1.05rem; margin-bottom:2px">${m.nameRu}</h3>
          <p style="color:var(--color-fg-muted); margin:0; font-size:0.78rem">${m.name}</p>
        </div>
        ${badge(TIER_META[m.tier])}
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:6px; margin:var(--space-md) 0">
        ${badge(CARD_META[m.card] || CARD_META.none)}
        ${badge(RAD_META[m.radiation] || RAD_META.none)}
        ${m.safe ? badge({ label: 'Новичку ок', cls: 'badge--green' }) : badge({ label: 'Опасно новичку', cls: 'badge--red' })}
      </div>

      <dl style="margin:0; display:grid; grid-template-columns:auto 1fr; gap:4px var(--space-sm); font-size:0.85rem">
        <dt style="color:var(--color-fg-muted)">Учёные:</dt><dd style="margin:0">${m.scientists}</dd>
        <dt style="color:var(--color-fg-muted)">Предохранители:</dt><dd style="margin:0">${m.fuses}</dd>
        <dt style="color:var(--color-fg-muted)">Рециклер:</dt><dd style="margin:0">${m.recycler ? 'есть' : 'нет'}</dd>
        <dt style="color:var(--color-fg-muted)">Награда:</dt><dd style="margin:0">${m.reward}</dd>
      </dl>

      <p style="margin:var(--space-md) 0 var(--space-xs)"><strong>Лут:</strong> ${m.loot}</p>
      <p style="color:var(--color-fg-muted); font-size:0.85rem; margin:0">${m.notes}</p>
    </article>`).join('');
}

// Кнопки фильтра
document.querySelectorAll('.filter [data-tier]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter [data-tier]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    renderMonuments(btn.dataset.tier);
  });
});

// --- Серверы (типы серверов Rust, сгруппированы) ---
const SERVER_GROUPS = [
  { key: 'type',  title: 'Тип сервера' },
  { key: 'mode',  title: 'Режим геймплея' },
  { key: 'limit', title: 'Лимит группы' },
  { key: 'wipe',  title: 'Частота вайпа' },
];
const TONE_CLS = { green: 'badge--green', blue: 'badge--blue', red: 'badge--red', safe: 'badge--safe' };

function renderServers() {
  const root = el('servers-root');
  if (!root || typeof SERVERS === 'undefined') return;

  root.innerHTML = SERVER_GROUPS.map((g) => {
    const items = SERVERS.filter((s) => s.group === g.key);
    if (items.length === 0) return '';
    const cards = items.map((s) => `
      <article class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:var(--space-sm)">
          <div>
            <h3 style="color:var(--color-fg); font-size:1.05rem; margin-bottom:2px">${s.nameRu}</h3>
            <p style="color:var(--color-fg-muted); margin:0; font-size:0.78rem">${s.name}</p>
          </div>
          <span class="badge ${TONE_CLS[s.tone] || 'badge--safe'}"><span class="dot" aria-hidden="true"></span>${s.tag}</span>
        </div>
        <p style="margin:var(--space-md) 0 var(--space-xs)">${s.desc}</p>
        <p style="color:var(--color-fg-muted); font-size:0.85rem; margin:0"><strong style="color:var(--color-secondary)">Кому:</strong> ${s.tip}</p>
      </article>`).join('');
    return `
      <h3 style="margin:var(--space-2xl) 0 var(--space-md); color:var(--color-primary)">${g.title}</h3>
      <div class="grid grid--auto">${cards}</div>`;
  }).join('');
}

/* =============================================================================
   5. 3D-КАРТА ОСТРОВА (Three.js + OrbitControls)
   Это визуальная заглушка: процедурный «остров» с рельефом и морем.
   Ниже — комментарий, как позже подключить реальную карту по сиду через RustMaps.
============================================================================= */
async function initMap() {
  const stage = el('map-stage');
  const hint = el('map-hint');
  const fallback = el('map-fallback');

  // Проверка поддержки WebGL
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
    if (!gl) throw new Error('no webgl');
  } catch (err) {
    stage.classList.add('is-fallback');
    hint.style.display = 'none';
    return;
  }

  // Ленивая загрузка Three.js (bare-спецификаторы резолвятся через importmap в index.html).
  // Если CDN недоступен — показываем понятный fallback, не ломая остальной сайт.
  let THREE, OrbitControls;
  // Гонка «загрузка vs таймаут»: если CDN висит дольше 8 с — не ждём вечно
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
  try {
    THREE = await withTimeout(import('three'), 8000);
    ({ OrbitControls } = await withTimeout(import('three/addons/controls/OrbitControls.js'), 8000));
  } catch (err) {
    stage.classList.add('is-fallback');
    hint.style.display = 'none';
    if (fallback) {
      fallback.innerHTML = '<div><p><strong>Не удалось загрузить 3D-движок.</strong></p>'
        + '<p>Проверьте интернет-соединение (Three.js грузится с CDN) и обновите страницу.</p></div>';
    }
    return;
  }

  const width = stage.clientWidth;
  const height = stage.clientHeight;

  // Сцена / камера / рендерер
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c1917); // тёплый уголь (совпадает с --color-bg)
  scene.fog = new THREE.Fog(0x1c1917, 60, 160);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(0, 55, 75);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  stage.appendChild(renderer.domElement);

  // Управление: вращение + зум (OrbitControls)
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 40;
  controls.maxDistance = 140;
  controls.maxPolarAngle = Math.PI / 2.15; // не даём уйти под «воду»
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;

  // Уважение к prefers-reduced-motion — отключаем автоповорот
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    controls.autoRotate = false;
  }

  // Свет: тёплый «закат» + мягкий ambient
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xea580c, 1.4); // рыжий «ржавый» свет
  sun.position.set(-40, 60, 30);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xf97316, 0.5);
  rim.position.set(50, 30, -40);
  scene.add(rim);

  // --- Процедурный остров: плоскость с «горами» через синусы + случайный шум ---
  const SIZE = 100;
  const SEG = 120;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const half = SIZE / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // расстояние от центра (0..1): у краёв опускаем к «морю»
    const dist = Math.sqrt(x * x + z * z) / half;
    const island = Math.max(0, 1 - dist * dist); // купол
    const ridges = Math.sin(x * 0.15) * Math.cos(z * 0.13) * 4
                 + Math.sin(x * 0.05 + z * 0.07) * 6;
    const noise = (Math.random() - 0.5) * 1.2;
    let h = island * (10 + ridges) + noise;
    if (h < 0) h = 0; // прибрежная равнина
    pos.setY(i, h);
  }
  geo.computeVertexNormals();

  // Материал рельефа — тёплый камень/ржавчина
  const landMat = new THREE.MeshStandardMaterial({
    color: 0x57493f,     // тёплый камень
    flatShading: true,
    roughness: 0.95,
    metalness: 0.05,
  });
  const land = new THREE.Mesh(geo, landMat);
  scene.add(land);

  // «Море» — полупрозрачная плоскость чуть выше нуля
  const seaGeo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.MeshStandardMaterial({
    color: 0x0f1720, transparent: true, opacity: 0.75, roughness: 0.3, metalness: 0.4,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.y = 1.5;
  scene.add(sea);

  // Пара «монументов»-маркеров (столбики рыжего цвета) для наглядности
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xea580c, emissive: 0x7c2d12, emissiveIntensity: 0.5 });
  const marks = [[15, 12], [-20, -8], [5, -25]];
  marks.forEach(([mx, mz]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 10, 8), markerMat);
    m.position.set(mx, 8, mz);
    scene.add(m);
  });

  hint.textContent = 'ЛКМ — вращать · колесо — зум · заглушка (не реальная карта)';

  // Адаптив: пересчёт при ресайзе окна/контейнера
  function onResize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  // Цикл анимации
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  /* ---------------------------------------------------------------------------
     TODO: подключение РЕАЛЬНОЙ карты по сиду через RustMaps API.
     -------------------------------------------------------------------------
     Идея: пользователь вводит seed + размер карты, мы запрашиваем у RustMaps
     готовую карту (изображение/данные монументов) и накладываем текстурой на
     плоскость выше, а маркеры монументов ставим по координатам из ответа.

     Пример (псевдокод, НЕ включать без своего API-ключа RustMaps):

       const API_KEY = 'YOUR_RUSTMAPS_API_KEY';
       async function loadRealMap(seed, size) {
         // Документация: https://rustmaps.com/docs (эндпоинт v4 /maps/{size}/{seed})
         const res = await fetch(
           `https://api.rustmaps.com/v4/maps/${size}/${seed}`,
           { headers: { 'X-API-Key': API_KEY } }
         );
         const data = await res.json();
         // data.imageUrl -> загрузить как текстуру:
         //   const tex = new THREE.TextureLoader().load(data.imageUrl);
         //   land.material.map = tex; land.material.needsUpdate = true;
         // data.monuments[] -> расставить маркеры по data.monuments[i].coordinates
       }

     Пока оставляем процедурную заглушку выше.
  --------------------------------------------------------------------------- */
}

/* =============================================================================
   6. КАЛЬКУЛЯТОРЫ
   Данные вынесены в редактируемые объекты — правьте цифры здесь.
============================================================================= */

// --- Данные рейда: сколько «предметов» нужно, чтобы уничтожить постройку ---
// Значения примерные (баланс Rust меняется). Правьте под текущий вайп.
const RAID_DATA = {
  // Постройки и их условный HP (для справки)
  targets: {
    'wood-wall':      { label: 'Деревянная стена', hp: 250 },
    'stone-wall':     { label: 'Каменная стена',   hp: 500 },
    'sheet-wall':     { label: 'Металлическая стена', hp: 1000 },
    'armored-wall':   { label: 'HQM (бронированная) стена', hp: 2000 },
    'wood-door':      { label: 'Деревянная дверь', hp: 200 },
    'sheet-door':     { label: 'Металлическая дверь', hp: 250 },
    'garage-door':    { label: 'Гаражная дверь', hp: 600 },
    'armored-door':   { label: 'Бронированная дверь', hp: 800 },
  },
  // Инструменты и урон по типам построек (примерно).
  // sulfur — стоимость крафта одной единицы в сере (для сводки по сере).
  tools: {
    'c4':      { label: 'C4 (таймерка)', sulfur: 2200,
                 dmg: { 'wood-wall': 250, 'stone-wall': 250, 'sheet-wall': 250, 'armored-wall': 167,
                        'wood-door': 200, 'sheet-door': 250, 'garage-door': 300, 'armored-door': 400 } },
    'rocket':  { label: 'Ракета', sulfur: 1400,
                 dmg: { 'wood-wall': 133, 'stone-wall': 100, 'sheet-wall': 92, 'armored-wall': 50,
                        'wood-door': 200, 'sheet-door': 125, 'garage-door': 120, 'armored-door': 100 } },
    'satchel': { label: 'Сатчел', sulfur: 480,
                 dmg: { 'wood-wall': 63, 'stone-wall': 28, 'sheet-wall': 23, 'armored-wall': 13,
                        'wood-door': 100, 'sheet-door': 38, 'garage-door': 36, 'armored-door': 25 } },
    'explo-ammo': { label: 'Разрывные патроны (Explo 5.56)', sulfur: 25,
                 dmg: { 'wood-wall': 4, 'stone-wall': 1.4, 'sheet-wall': 3, 'armored-wall': 1.5,
                        'wood-door': 5, 'sheet-door': 3, 'garage-door': 3, 'armored-door': 2 } },
  },
};

// --- Данные апкипа: расход ресурсов на 1 building block в сутки (примерно) ---
const UPKEEP_DATA = {
  'twig':  { label: 'Солома (twig)', perDay: { wood: 0, stone: 0, metal: 0, hqm: 0 } },
  'wood':  { label: 'Дерево', perDay: { wood: 5, stone: 0, metal: 0, hqm: 0 } },
  'stone': { label: 'Камень', perDay: { wood: 0, stone: 10, metal: 0, hqm: 0 } },
  'metal': { label: 'Металл (sheet)', perDay: { wood: 0, stone: 0, metal: 15, hqm: 0 } },
  'hqm':   { label: 'HQM (бронь)', perDay: { wood: 0, stone: 0, metal: 0, hqm: 3 } },
};
const RES_LABELS = { wood: 'Дерево', stone: 'Камень', metal: 'Металл', hqm: 'HQM' };

// -- Заполняем выпадающие списки --
function fillSelect(select, entries) {
  select.innerHTML = entries.map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
}

const raidTargetSel = el('raid-target');
const raidToolSel = el('raid-tool');
const raidCountInput = el('raid-count');
const raidResult = el('raid-result');

fillSelect(raidTargetSel, Object.entries(RAID_DATA.targets).map(([k, v]) => [k, v.label]));
fillSelect(raidToolSel, Object.entries(RAID_DATA.tools).map(([k, v]) => [k, v.label]));

function calcRaid() {
  const targetKey = raidTargetSel.value;
  const toolKey = raidToolSel.value;
  const count = Math.max(1, parseInt(raidCountInput.value, 10) || 1);

  const target = RAID_DATA.targets[targetKey];
  const tool = RAID_DATA.tools[toolKey];
  const dmgPer = tool.dmg[targetKey] || 0;

  el('raid-hp').textContent = `Прочность: ~${target.hp} HP`;

  if (dmgPer <= 0) {
    raidResult.innerHTML = `<div class="row"><span>Этим инструментом эту постройку не пробить эффективно.</span></div>`;
    return;
  }

  const perOne = Math.ceil(target.hp / dmgPer); // на 1 объект
  const total = perOne * count;
  const sulfurTotal = total * tool.sulfur;

  raidResult.innerHTML = `
    <div class="row"><span>Нужно «${tool.label}» на 1 шт.</span><span class="num tabular">${perOne}</span></div>
    <div class="row"><span>Всего на ${count} шт.</span><span class="num tabular">${total}</span></div>
    <div class="row"><span>Примерно серы</span><span class="num tabular">${sulfurTotal.toLocaleString('ru-RU')}</span></div>`;
}

[raidTargetSel, raidToolSel, raidCountInput].forEach((n) => {
  n.addEventListener('input', calcRaid);
  n.addEventListener('change', calcRaid);
});

// -- Апкип --
const upMaterialSel = el('up-material');
const upBlocksInput = el('up-blocks');
const upResult = el('up-result');

fillSelect(upMaterialSel, Object.entries(UPKEEP_DATA).map(([k, v]) => [k, v.label]));

function calcUpkeep() {
  const matKey = upMaterialSel.value;
  const blocks = Math.max(1, parseInt(upBlocksInput.value, 10) || 1);
  const per = UPKEEP_DATA[matKey].perDay;

  const rows = Object.entries(per)
    .filter(([, val]) => val > 0)
    .map(([res, val]) => `<div class="row"><span>${RES_LABELS[res]} / сутки</span><span class="num tabular">${(val * blocks).toLocaleString('ru-RU')}</span></div>`)
    .join('');

  upResult.innerHTML = rows || `<div class="row"><span>Солома не требует апкипа.</span></div>`;
}

[upMaterialSel, upBlocksInput].forEach((n) => {
  n.addEventListener('input', calcUpkeep);
  n.addEventListener('change', calcUpkeep);
});

/* =============================================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================================= */
function init() {
  // Данные
  renderBiomes();
  renderResources();
  renderMonuments('all');
  renderServers();

  // Таймер
  renderWipeMeta();
  tickCountdown();
  setInterval(tickCountdown, 1000);          // обновление раз в секунду
  setInterval(renderWipeMeta, 60 * 1000);    // раз в минуту освежаем «осталось» в таблице

  // Калькуляторы
  calcRaid();
  calcUpkeep();

  // Вкладка из #hash (deep-linking), по умолчанию — home
  const initial = (location.hash || '#home').slice(1);
  const known = tabs.some((t) => t.dataset.tab === initial);
  activateTab(known ? initial : 'home', { updateHash: false });
}

// Реакция на изменение hash (кнопки назад/вперёд браузера)
window.addEventListener('hashchange', () => {
  const name = (location.hash || '#home').slice(1);
  if (tabs.some((t) => t.dataset.tab === name)) activateTab(name, { updateHash: false });
});

init();
