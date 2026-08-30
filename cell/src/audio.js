// audio.js — весь звук синтезируется Web Audio API. Ни одного файла.
// AudioContext создаётся только после первого касания экрана (требование iOS).

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.noiseBuf = null;
    this.ambient = null;
    this.lastBite = 0;
  }

  /** Вызывается из первого touchstart. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this._makeNoise(1.4);
      this._startAmbient();
    } catch (e) { this.ctx = null; }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.5 : 0, this.ctx.currentTime, 0.05);
    }
    return this.enabled;
  }

  /** Буфер белого шума — заполняется один раз, дальше только читается. */
  _makeNoise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      // Слегка «коричневый» шум — мягче белого, ближе к воде.
      last = (last + Math.random() * 2 - 1) * 0.5;
      d[i] = last;
    }
    return buf;
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  }

  /** Эмбиент: два медленно расстроенных осциллятора + шумовой «поток». */
  _startAmbient() {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.05;
    g.connect(this.master);

    for (const f of [55, 82.5, 110]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = c.createGain();
      lg.gain.value = f * 0.01;
      lfo.connect(lg); lg.connect(o.frequency);
      const og = c.createGain();
      og.gain.value = 0.3;
      o.connect(og); og.connect(g);
      o.start(); lfo.start();
    }

    // Шум воды через узкий фильтр.
    const ns = this._noiseSource();
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.7;
    const ng = c.createGain();
    ng.gain.value = 0.09;
    ns.connect(f); f.connect(ng); ng.connect(g);
    ns.start();
    this.ambient = g;
  }

  /** Огибающая ADSR через экспоненту. */
  _env(gain, t, a, d, peak = 1) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  /** Укус: короткий шум через полосовой фильтр с падающей частотой. */
  bite() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    if (t - this.lastBite < 0.04) return;
    this.lastBite = t;

    const s = this._noiseSource();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.12);
    f.Q.value = 3.5;
    const g = c.createGain();
    this._env(g, t, 0.006, 0.13, 0.5);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 0.2);
  }

  /** Поедание: мягкий «пуф» с восходящей фильтрацией. */
  eat() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 0.1);
    const g = c.createGain();
    this._env(g, t, 0.01, 0.12, 0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.24);
  }

  /** Урон: низкий тон с питч-бендом вниз. */
  hurt() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.32);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const g = c.createGain();
    this._env(g, t, 0.008, 0.34, 0.45);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.4);
  }

  /** Эволюция: восходящее арпеджио. */
  evolve() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime;
    const notes = [261.6, 329.6, 392, 523.3, 659.3];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      const o = c.createOscillator();
      o.type = i > 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      this._env(g, t, 0.02, 0.34, 0.26);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.4);
    });
  }

  /** Ускорение: шумовой свист, живёт пока держат второй палец. */
  boost(on) {
    if (!this.ctx) return;
    if (on && !this._boostNode) {
      const c = this.ctx;
      const s = this._noiseSource();
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.6;
      const g = c.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.12, c.currentTime, 0.08);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start();
      this._boostNode = { s, g, f };
      // Свист «уезжает» вверх, пока ускоряемся.
      f.frequency.setTargetAtTime(1500, c.currentTime, 0.5);
    } else if (!on && this._boostNode) {
      const { s, g } = this._boostNode;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.1);
      setTimeout(() => { try { s.stop(); } catch (e) { /* уже остановлен */ } }, 400);
      this._boostNode = null;
    }
  }

  /** Смерть: низкий спад с расстройкой. */
  death() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    for (const d of [0, 3]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(220 + d, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 1.1);
      const g = c.createGain();
      this._env(g, t, 0.05, 1.1, 0.3);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 1.2);
    }
  }

  /** Спецорган: электро-щелчок либо ядовитый выдох. */
  skill(electro) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const s = this._noiseSource();
    const f = c.createBiquadFilter();
    f.type = electro ? 'highpass' : 'lowpass';
    f.frequency.setValueAtTime(electro ? 2200 : 900, t);
    f.frequency.exponentialRampToValueAtTime(electro ? 600 : 180, t + 0.35);
    const g = c.createGain();
    this._env(g, t, 0.01, 0.36, electro ? 0.4 : 0.28);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 0.45);
  }

  /** Мягкий «клик» интерфейса. */
  ui() {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.05);
    const g = c.createGain();
    this._env(g, t, 0.004, 0.07, 0.12);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }
}
