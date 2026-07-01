/* =============================================================================
   data.js — игровые данные для сайта Rust Wipe Hub
   -----------------------------------------------------------------------------
   Как использовать:
   1) Подключи файл в index.html ПЕРЕД своим script.js:
        <script src="data.js"></script>
        <script src="script.js"></script>
   2) В script.js данные доступны как глобальные переменные:
        MONUMENTS, BIOMES, RESOURCES
      Пример рендера карточек монументов:
        MONUMENTS.forEach(m => { ... создать карточку ... });

   ВАЖНО: данные актуальны примерно на 2026 год. Facepunch каждый месяц может
   менять монументы, лут и радиацию — перед публикацией стоит быстро сверить
   спорные цифры (кол-во учёных, радиацию) с текущим вайпом. Все данные вынесены
   сюда специально, чтобы их было легко править в одном месте.

   Поля монумента:
     tier       — 0 сейф-зона, 1 зелёная, 2 синяя, 3 красная
     card       — какая карта нужна для главного пазла: 'none'|'green'|'blue'|'red'
     fuses      — сколько предохранителей (Electric Fuse) нужно
     scientists — примерное число NPC-учёных ('0' если нет)
     radiation  — 'none'|'low'|'medium'|'high'
     recycler   — есть ли рециклер на месте
     reward     — что даёт пазл (часто карта следующего уровня)
     loot       — основной лут
     safe       — можно ли новичку в стартовом шмоте
============================================================================= */

const MONUMENTS = [
  /* ---------- TIER 0: сейф-зоны (PvP запрещён, турели) ---------- */
  {
    id: "outpost",
    name: "Outpost",
    nameRu: "Аутпост",
    tier: 0, card: "none", fuses: 0, scientists: "0",
    radiation: "none", recycler: true,
    reward: "—",
    loot: "Верстак, торговые автоматы, рециклеры, ремонт, research table",
    safe: true,
    notes: "Главный хаб: покупка/продажа, рециклинг, изучение чертежей. Оружие доставать нельзя — турели убьют."
  },
  {
    id: "bandit",
    name: "Bandit Camp",
    nameRu: "Бандитский лагерь",
    tier: 0, card: "none", fuses: 0, scientists: "0",
    radiation: "none", recycler: true,
    reward: "—",
    loot: "Казино/рулетка, скупка лута за скрап, магазин AirWolf (вертолёты), верстак",
    safe: true,
    notes: "Вторая сейф-зона. Тут покупают мини-коптер/скрап-хели и играют в азартные игры."
  },

  /* ---------- TIER 1: зелёная карта / стартовые монументы ---------- */
  {
    id: "supermarket",
    name: "Abandoned Supermarket",
    nameRu: "Заброшенный супермаркет",
    tier: 1, card: "none", fuses: 0, scientists: "0",
    radiation: "none", recycler: true,
    reward: "Зелёная карта (спавн на столе)",
    loot: "Много еды, базовый лут, иногда military crate",
    safe: true,
    notes: "Один из лучших стартов: почти всегда спавнит зелёную карту на столе в подсобке."
  },
  {
    id: "gas-station",
    name: "Oxum's Gas Station",
    nameRu: "Заправка Oxum's",
    tier: 1, card: "none", fuses: 0, scientists: "0",
    radiation: "none", recycler: true,
    reward: "Зелёная карта (спавн в офисе)",
    loot: "Базовый лут, компоненты, рециклер",
    safe: true,
    notes: "Пара с супермаркетом — быстрый круг за зелёными картами за ~5 минут."
  },
  {
    id: "lighthouse",
    name: "Lighthouse",
    nameRu: "Маяк",
    tier: 1, card: "none", fuses: 0, scientists: "0",
    radiation: "none", recycler: true,
    reward: "Зелёная карта (стол внутри)",
    loot: "Базовый лут, рециклер",
    safe: true,
    notes: "Тихий прибрежный монумент, мало PvP. Хорош на старте вайпа."
  },
  {
    id: "mining-outpost",
    name: "Mining Outpost",
    nameRu: "Шахтёрский аутпост",
    tier: 1, card: "none", fuses: 0, scientists: "0",
    radiation: "none", recycler: true,
    reward: "—",
    loot: "Рециклер, research table, ремонт, базовый лут",
    safe: true,
    notes: "Пазла нет. Полезен как мини-хаб: изучить чертёж и переработать лут вдали от Аутпоста."
  },
  {
    id: "junkyard",
    name: "Junkyard",
    nameRu: "Свалка",
    tier: 1, card: "none", fuses: 0, scientists: "0",
    radiation: "low", recycler: true,
    reward: "—",
    loot: "Магнитный кран (кузова машин), компоненты, рециклер",
    safe: true,
    notes: "Хорошее место фарма компонентов и запчастей. PvP умеренное."
  },
  {
    id: "satellite",
    name: "Satellite Dish",
    nameRu: "Спутниковая тарелка",
    tier: 1, card: "green", fuses: 1, scientists: "0",
    radiation: "low", recycler: true,
    reward: "Лут-комната",
    loot: "Компоненты, military crate, скрап",
    safe: true,
    notes: "Простой зелёный пазл. Частая точка PvP на старте."
  },
  {
    id: "sewer-branch",
    name: "Sewer Branch",
    nameRu: "Канализация (Sewer Branch)",
    tier: 1, card: "green", fuses: 1, scientists: "0",
    radiation: "low", recycler: true,
    reward: "Синяя карта",
    loot: "3+ ящика, компоненты",
    safe: true,
    notes: "Компактный, быстрый зелёный пазл с наградой в виде синей карты. Любимец старта вайпа."
  },
  {
    id: "small-harbor",
    name: "Small Harbor",
    nameRu: "Малый порт",
    tier: 1, card: "green", fuses: 1, scientists: "0 (без Cargo)",
    radiation: "low", recycler: true,
    reward: "Синяя карта",
    loot: "Ящики, нефтепереработка (refinery), рециклер",
    safe: true,
    notes: "Зелёный пазл даёт синюю карту. Есть НПЗ для переработки сырой нефти."
  },
  {
    id: "large-harbor",
    name: "Large Harbor",
    nameRu: "Большой порт",
    tier: 1, card: "green", fuses: 1, scientists: "0 (без Cargo)",
    radiation: "low", recycler: true,
    reward: "Синяя карта",
    loot: "Много ящиков, refinery, рециклер",
    safe: true,
    notes: "Крупнее малого порта, больше лута по количеству. Награда — синяя карта."
  },
  {
    id: "dome",
    name: "The Dome",
    nameRu: "Купол (Dome)",
    tier: 1, card: "green", fuses: 1, scientists: "0",
    radiation: "low", recycler: true,
    reward: "Синяя карта + фрагменты чертежей",
    loot: "Military crate, рециклер, BP-фрагменты",
    safe: true,
    notes: "После рероботы 2026 появилась зелёная лут-комната с таймером — быстрый ранний фарм, если успеть."
  },

  /* ---------- TIER 2: синяя карта / средние монументы ---------- */
  {
    id: "water-treatment",
    name: "Water Treatment Plant",
    nameRu: "Водоочистная станция",
    tier: 2, card: "blue", fuses: 1, scientists: "мало",
    radiation: "medium", recycler: true,
    reward: "Красная карта",
    loot: "Military/elite crates, компоненты",
    safe: false,
    notes: "Самый простой способ добыть красную карту соло: нужен 1 предохранитель и синяя карта."
  },
  {
    id: "trainyard",
    name: "Train Yard",
    nameRu: "Депо (Train Yard)",
    tier: 2, card: "blue", fuses: 1, scientists: "мало",
    radiation: "low", recycler: true,
    reward: "Ведёт к красной карте",
    loot: "Ящики в вагонах/зданиях, 3 рециклера",
    safe: false,
    notes: "Цепочка green→blue→red. Радиация лёгкая. Хороший фарм скрапа (400–500 за круг)."
  },
  {
    id: "power-plant",
    name: "Power Plant",
    nameRu: "Электростанция",
    tier: 2, card: "blue", fuses: 1, scientists: "мало",
    radiation: "medium", recycler: true,
    reward: "Красная карта",
    loot: "Military/elite crates, дизель, компоненты",
    safe: false,
    notes: "Нужно ≥25% защиты от радиации или хазмат. Пазл на реакцию/таймер: зелёная → синяя → красная карта."
  },
  {
    id: "airfield",
    name: "Airfield",
    nameRu: "Аэродром",
    tier: 2, card: "blue", fuses: 2, scientists: "есть",
    radiation: "low", recycler: true,
    reward: "Красная карта",
    loot: "~20 ящиков, высокая плотность лута",
    safe: false,
    notes: "Много лута, но всегда людно — жди PvP. Нужны зелёная + синяя карты и 2 предохранителя."
  },

  /* ---------- TIER 3: красная карта / эндгейм ---------- */
  {
    id: "launch-site",
    name: "Launch Site",
    nameRu: "Стартовая площадка",
    tier: 3, card: "red", fuses: 2, scientists: "~9 + Bradley APC",
    radiation: "high", recycler: true,
    reward: "Топовый лут",
    loot: "6+ elite crates, C4, ракетницы, tech-мусор",
    safe: false,
    notes: "Самый большой монумент. Нужен хазмат (высокая радиация) и разбор с танком Bradley. Только в полном шмоте."
  },
  {
    id: "military-tunnels",
    name: "Military Tunnels",
    nameRu: "Военные туннели",
    tier: 3, card: "red", fuses: 2, scientists: "~29",
    radiation: "high", recycler: true,
    reward: "Красная карта / эндгейм-лут",
    loot: "Elite crates, топовые компоненты",
    safe: false,
    notes: "Самая плотная толпа учёных в игре. Нужны все три карты (green+blue+red) и хазмат. Соло — боль, лучше группой."
  },
  {
    id: "arctic-research",
    name: "Arctic Research Base",
    nameRu: "Арктическая база",
    tier: 3, card: "red", fuses: 1, scientists: "6–8",
    radiation: "medium", recycler: true,
    reward: "Научный сейф / эндгейм-лут",
    loot: "Elite crates, компоненты",
    safe: false,
    notes: "В снежном биоме. Возможен спавн патрульного вертолёта. Не забудь тёплую одежду от холода."
  },
  {
    id: "missile-silo",
    name: "Missile Silo",
    nameRu: "Ракетная шахта",
    tier: 3, card: "red", fuses: 2, scientists: "26+",
    radiation: "high", recycler: true,
    reward: "Эндгейм-лут",
    loot: "Elite crates, высокий tier-лут",
    safe: false,
    notes: "Пятиуровневый подземный бункер. Красная карта открывает лифт. Тяжёлый монумент, идут группой."
  },

  /* ---------- Водные / событийные ---------- */
  {
    id: "small-oil",
    name: "Small Oil Rig",
    nameRu: "Малая нефтяная вышка",
    tier: 2, card: "blue", fuses: 0, scientists: "есть",
    radiation: "none", recycler: true,
    reward: "Locked crate (по таймеру)",
    loot: "Elite crates, компоненты, синяя карта на месте",
    safe: false,
    notes: "Добираешься по воде. Синяя карта открывает верхний этаж, лакед-крейт зовёт патрульный вертолёт."
  },
  {
    id: "large-oil",
    name: "Large Oil Rig",
    nameRu: "Большая нефтяная вышка",
    tier: 3, card: "blue", fuses: 0, scientists: "много + Heavy Scientist",
    radiation: "none", recycler: true,
    reward: "Locked crate (по таймеру)",
    loot: "Elite crates, топовый лут, дизель",
    safe: false,
    notes: "6 этажей, на верху босс Heavy Scientist. Награда за лакед-крейт, но вызывает вертолёт. Соло тяжело."
  },
  {
    id: "cargo-ship",
    name: "Cargo Ship",
    nameRu: "Грузовое судно (Cargo)",
    tier: 3, card: "none", fuses: 0, scientists: "есть",
    radiation: "none", recycler: true,
    reward: "Locked crate",
    loot: "Elite crates, компоненты, скрап",
    safe: false,
    notes: "Плавает вокруг острова как событие. Заходишь с лодки, чистишь учёных, ждёшь открытия лакед-крейта."
  },
  {
    id: "underwater-labs",
    name: "Underwater Labs",
    nameRu: "Подводные лаборатории",
    tier: 2, card: "green", fuses: 1, scientists: "есть",
    radiation: "none", recycler: true,
    reward: "Компоненты / карты",
    loot: "Compоненты, tier-2/3 лут, скрап",
    safe: false,
    notes: "Заходишь через moonpool с подлодки/дайв-снаряжения. Мало кто фармит в середине вайпа — безопасный источник компонентов."
  }
];

/* =============================================================================
   БИОМЫ. В Rust рудные ноды (камень/металл/сера) спавнятся во ВСЕХ биомах —
   разница в основном в климате, еде, ткани и животных, а не в руде.
============================================================================= */
const BIOMES = [
  {
    id: "temperate",
    name: "Temperate / Forest",
    nameRu: "Умеренный (лес и поля)",
    climate: "Комфортный",
    resources: "Дерево, конопля (ткань), ягоды, грибы, тыквы, кукуруза",
    animals: "Кабан, олень, курица, иногда медведь/волк",
    tips: "Лучший биом для старта: тепло, много еды и ткани. Здесь удобно ставить первую базу."
  },
  {
    id: "arid",
    name: "Arid / Desert",
    nameRu: "Пустыня",
    climate: "Жарко днём, прохладно ночью",
    resources: "Кактусы (ткань + вода из мякоти), мало пресной воды",
    animals: "Кабан, олень; меньше живности",
    tips: "Следи за жаждой — воды мало. Кактус выручает с водой и тканью. Открытые пространства = больше PvP на дальняк."
  },
  {
    id: "arctic",
    name: "Arctic / Snow",
    nameRu: "Арктика (снег)",
    climate: "Холодно — нужна тёплая одежда",
    resources: "Руда хорошо видна на снегу; мало растений/еды",
    animals: "Волки, медведи",
    tips: "Без тёплой одежды/костра быстро замёрзнешь. Здесь стоит Arctic Research Base (red-card эндгейм)."
  },
  {
    id: "tundra",
    name: "Tundra",
    nameRu: "Тундра",
    climate: "Прохладно (переходный биом)",
    resources: "Смешанные: немного дерева, руда, редкая растительность",
    animals: "Олень, кабан, волк",
    tips: "Буфер между лесом и снегом. Умеренно по ресурсам и опасностям."
  }
];

/* =============================================================================
   РЕСУРСЫ — где и как добывать ключевые ресурсы.
============================================================================= */
const RESOURCES = [
  {
    id: "wood",
    name: "Wood",
    nameRu: "Дерево",
    source: "Рубка деревьев (топор/бензопила), пни, коллектибл-палки",
    where: "Любой биом, больше всего в лесу",
    tip: "Бей по светящемуся маркеру (X) на дереве для бонуса и быстрого сбора."
  },
  {
    id: "stone",
    name: "Stone",
    nameRu: "Камень",
    source: "Каменные ноды, разбросанные булыжники",
    where: "Все биомы, гуще в скалистых/горных зонах",
    tip: "Ноды дают камень+металл+серу по очереди. Бей по «сладкой точке» кайлом для эффективности."
  },
  {
    id: "metal-ore",
    name: "Metal Ore",
    nameRu: "Металлическая руда",
    source: "Металлические ноды, переплавка в печи → metal fragments",
    where: "Все биомы, скалистые участки",
    tip: "Руду плавь в печи (furnace), чтобы получить фрагменты металла для крафта."
  },
  {
    id: "sulfur-ore",
    name: "Sulfur Ore",
    nameRu: "Серная руда",
    source: "Серные ноды, переплавка в серу → порох",
    where: "Все биомы, особенно скалы/горы",
    tip: "Сера → порох → патроны и взрывчатка. Главный ресурс для рейда (см. калькулятор рейда)."
  },
  {
    id: "cloth",
    name: "Cloth",
    nameRu: "Ткань",
    source: "Конопля (hemp), кактусы, сбор с трупов животных частично",
    where: "Лес и пустыня (кактус)",
    tip: "Ткань нужна для брони, спальника и низкосортного топлива."
  },
  {
    id: "leather",
    name: "Leather",
    nameRu: "Кожа",
    source: "Охота на животных (кабан, олень, волк, медведь)",
    where: "Любой биом с живностью",
    tip: "Кожа + ткань идут на раннюю броню (roadsign/leather)."
  },
  {
    id: "lowgrade",
    name: "Low Grade Fuel",
    nameRu: "Низкосортное топливо",
    source: "Крафт из animal fat + ткань, либо переработка сырой нефти на НПЗ",
    where: "НПЗ есть в портах и на нефтяных вышках",
    tip: "Топливо для фонаря, паяльной лампы, ловушек и транспорта."
  },
  {
    id: "crude",
    name: "Crude Oil",
    nameRu: "Сырая нефть",
    source: "Нефтяные бочки, качалки (pump jack), карьер, нефтяные вышки",
    where: "Пустыня/побережье, монументы с нефтью",
    tip: "Перерабатывается в низкосортное топливо на Oil Refinery (1 нефть → 3 топлива)."
  },
  {
    id: "scrap",
    name: "Scrap",
    nameRu: "Скрап",
    source: "Рециклинг компонентов, придорожные/подводные бочки, ящики, монументы",
    where: "Все монументы (рециклеры), дороги",
    tip: "Валюта для Аутпоста и research table. Компоненты выгоднее переработать в скрап."
  },
  {
    id: "components",
    name: "Components",
    nameRu: "Компоненты",
    source: "Придорожные бочки, ящики, тела учёных",
    where: "Дороги, монументы",
    tip: "Шестерни/пружины/трубы и т.д. — нужны для крафта оружия и для переработки в скрап."
  },
  {
    id: "hqm",
    name: "High Quality Metal",
    nameRu: "Металл высокого качества (HQM)",
    source: "HQM-ноды (редкие), HQM-карьер, переработка некоторых предметов",
    where: "Скалистые зоны, карьеры",
    tip: "Дефицитный ресурс для брони, оружия и апгрейда базы до металла/HQM. Экономь."
  }
];

/* Экспорт для сборщиков (не мешает работе через <script src> в статичном сайте). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MONUMENTS, BIOMES, RESOURCES };
}
