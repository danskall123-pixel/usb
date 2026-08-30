// i18n.js — словарь ru/en. Переключатель в меню, выбор сохраняется.

const DICT = {
  ru: {
    title: 'КЛЕТКА',
    subtitle: 'выживи, вырасти, эволюционируй',
    continue: 'Продолжить', newGame: 'Новая жизнь', resume: 'Дальше',
    restart: 'Начать заново', menu: 'В меню', pause: 'Пауза',
    died: 'Тебя съели', level: 'ур.', dna: 'ДНК',
    evolve: 'Эволюция', editorTitle: 'Редактор организма',
    undo: 'откат', random: 'случайное', symmetry: 'симметрия',
    preview: 'превью', done: 'в океан', control: 'Управление',
    ctrlFollow: 'палец', ctrlStick: 'джойстик', lang: 'Язык',
    speed: 'скорость', turn: 'поворот', dmg: 'урон', def: 'защита', maxHp: 'здоровье',
    sense: 'чутьё',
    mouth_herb: 'рот', mouth_carn: 'пасть', mouth_omni: 'всеядный',
    eye: 'глаз', flagellum: 'жгутик', fin: 'плавник', spike: 'шип',
    poison: 'яд', electro: 'электро', armor: 'броня',
    hint: 'Веди пальцем. Второй палец — ускорение.',
    levelUp: 'Новый уровень роста',
    tapToStart: 'коснись экрана',
    eaten: 'съедено', survived: 'прожито',
  },
  en: {
    title: 'THE CELL',
    subtitle: 'survive, grow, evolve',
    continue: 'Continue', newGame: 'New life', resume: 'Resume',
    restart: 'Restart', menu: 'Menu', pause: 'Paused',
    died: 'You were eaten', level: 'lv.', dna: 'DNA',
    evolve: 'Evolve', editorTitle: 'Creature editor',
    undo: 'undo', random: 'random', symmetry: 'symmetry',
    preview: 'preview', done: 'dive in', control: 'Control',
    ctrlFollow: 'finger', ctrlStick: 'joystick', lang: 'Language',
    speed: 'speed', turn: 'turn', dmg: 'damage', def: 'defense', maxHp: 'health',
    sense: 'sense',
    mouth_herb: 'mouth', mouth_carn: 'jaws', mouth_omni: 'omni',
    eye: 'eye', flagellum: 'flagellum', fin: 'fin', spike: 'spike',
    poison: 'poison', electro: 'electro', armor: 'armor',
    hint: 'Drag to swim. Second finger — boost.',
    levelUp: 'New growth stage',
    tapToStart: 'tap to start',
    eaten: 'eaten', survived: 'survived',
  },
};

export class I18n {
  constructor(lang = 'ru') {
    this.lang = DICT[lang] ? lang : 'ru';
    this.t = this.t.bind(this);
  }
  t(key) { return DICT[this.lang][key] ?? DICT.ru[key] ?? key; }
  toggle() { this.lang = this.lang === 'ru' ? 'en' : 'ru'; this.apply(); return this.lang; }
  set(lang) { if (DICT[lang]) this.lang = lang; this.apply(); }

  /** Проставляет тексты во все элементы с data-i18n. */
  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = this.t(el.getAttribute('data-i18n'));
    });
    document.documentElement.lang = this.lang;
  }
}
