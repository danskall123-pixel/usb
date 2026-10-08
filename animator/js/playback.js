// Воспроизведение (с синхронным звуком) и озвучка при прокрутке таймлайна.
import { app } from './app.js';
import { audioCtx } from './io.js';

export function initPlayback() {
  let raf = 0, t0 = 0, f0 = 0, sources = [];

  const audioLayers = () => app.idx.list.filter((L) => L.type === 'audio' && L.vis && app.audio.get(L.asset) && app.audio.get(L.asset).buffer);

  function startAudio(frame, dur) {
    stopAudio();
    const list = audioLayers();
    if (!list.length) return;
    const ac = audioCtx();
    ac.resume();
    const fps = app.doc.fps;
    for (const L of list) {
      const a = app.audio.get(L.asset);
      const off = (frame - L.start) / fps;
      if (off >= a.buffer.duration) continue;
      const src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = a.buffer;
      g.gain.value = L.vol;
      src.connect(g).connect(ac.destination);
      if (off >= 0) src.start(0, off, dur); else if (!dur) src.start(ac.currentTime - off);
      else continue;
      sources.push(src);
    }
  }
  function stopAudio() { for (const s of sources) try { s.stop(); } catch (e) { /* уже */ } sources = []; }

  function tick(now) {
    const d = app.doc;
    let f = f0 + Math.floor(((now - t0) / 1000) * d.fps);
    if (f > d.end) {
      if (app.opts.loop) {
        t0 += ((d.end - f0 + 1) * 1000) / d.fps;
        f0 = d.start;
        f = f0 + Math.floor(((now - t0) / 1000) * d.fps);
        if (f > d.end) { t0 = now; f = d.start; }
        startAudio(f);
      } else { stop(); app.setFrame(d.end); return; }
    }
    if (f !== app.frame) app.setFrame(f);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    const d = app.doc;
    if (app.frame < d.start || app.frame >= d.end) app.setFrame(d.start);
    app.playing = true;
    f0 = app.frame;
    t0 = performance.now();
    startAudio(f0);
    raf = requestAnimationFrame(tick);
    app.refresh(['timeline']);
    app.render();
  }
  function stop() {
    if (!app.playing) return;
    cancelAnimationFrame(raf);
    stopAudio();
    app.playing = false;
    app.refresh(['timeline']);
    app.render();
  }

  app.on('toggleplay', () => (app.playing ? stop() : play()));
  app.on('stop', stop);
  app.on('docloaded', stop);
  app.on('scrub', () => { if (!app.playing) startAudio(app.frame, 1 / app.doc.fps + 0.02); });
}
