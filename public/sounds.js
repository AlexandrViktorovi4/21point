(() => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let sfxGainNode = null;
  let unlocked = false;
  let musicStarted = false;

  function clamp01(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
  }

  let musicVol = clamp01(localStorage.getItem("21musicVol") ?? 0.45);
  let sfxVol = clamp01(localStorage.getItem("21sfxVol") ?? 0.75);

  // Файл громкий — ограничиваем потолок и делаем логарифмическую кривую
  const MUSIC_CEILING = 0.28;
  const SFX_CEILING = 0.85;

  function toMusicGain(slider) {
    const v = clamp01(slider);
    if (v <= 0) return 0;
    return Math.pow(v, 2.6) * MUSIC_CEILING;
  }

  function toSfxGain(slider) {
    const v = clamp01(slider);
    if (v <= 0) return 0;
    return Math.pow(v, 1.6) * SFX_CEILING;
  }

  // Clear old mute flags that could leave audio "off"
  localStorage.removeItem("21mute");
  localStorage.removeItem("21musicOn");
  localStorage.removeItem("21sfxOn");

  const TRACKS = [
    { id: "rofl", title: "Рофлотека", file: "audio/bg-music.mp3" },
    { id: "piggies", title: "Bad Piggies", file: "audio/bad-piggies.mp3" },
    { id: "athens", title: "Athens", file: "audio/athens.mp3" },
    { id: "eggs", title: "Яйца у птицы", file: "audio/eggs-birds.mp3" },
    { id: "enzro", title: "ENZRO — Ты не бойся ночи", file: "audio/enzro-night.mp3" },
  ];

  let trackId = localStorage.getItem("21track") || TRACKS[0].id;
  if (!TRACKS.some((t) => t.id === trackId)) trackId = TRACKS[0].id;

  function trackById(id) {
    return TRACKS.find((t) => t.id === id) || TRACKS[0];
  }

  const music = new Audio(trackById(trackId).file);
  music.loop = true;
  music.preload = "auto";
  music.volume = toMusicGain(musicVol);
  music.setAttribute("playsinline", "");
  music.style.display = "none";
  if (document.body) document.body.appendChild(music);
  else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(music));

  music.addEventListener("error", () => {
    console.warn("Не удалось загрузить музыку:", music.src, music.error);
  });

  async function setTrack(id, { autoplay = true } = {}) {
    const track = trackById(id);
    const wasPlaying = !music.paused && musicStarted;
    trackId = track.id;
    localStorage.setItem("21track", trackId);

    const nextSrc = new URL(track.file, window.location.href).href;
    if (music.src !== nextSrc) {
      music.pause();
      music.src = track.file;
      music.load();
      musicStarted = false;
    }

    applyMusicVolume();
    if (autoplay && unlocked && musicVol > 0.001) {
      return startMusic();
    }
    return wasPlaying;
  }

  function getCtx() {
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      sfxGainNode = ctx.createGain();
      sfxGainNode.gain.value = toSfxGain(sfxVol);
      sfxGainNode.connect(ctx.destination);
    }
    return ctx;
  }

  function sfxOut() {
    getCtx();
    return sfxGainNode;
  }

  function applyMusicVolume() {
    music.volume = toMusicGain(musicVol);
  }

  function applySfxVolume() {
    if (sfxGainNode) sfxGainNode.gain.value = toSfxGain(sfxVol);
  }

  async function startMusic() {
    applyMusicVolume();
    if (musicVol <= 0.001) {
      music.pause();
      return false;
    }
    try {
      music.muted = false;
      await music.play();
      musicStarted = true;
      return true;
    } catch (err) {
      console.warn("Музыка ждёт жест пользователя:", err?.message || err);
      return false;
    }
  }

  async function unlock() {
    const c = getCtx();
    if (c && c.state === "suspended") {
      try {
        await c.resume();
      } catch (_) {
        /* ignore */
      }
    }
    unlocked = true;
    applySfxVolume();
    await startMusic();
  }

  function envGain(c, start, peak, attack, release) {
    const g = c.createGain();
    const scaled = Math.max(0.0001, peak);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(scaled, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
    return g;
  }

  function canSfx() {
    return unlocked && sfxVol > 0.001;
  }

  function deal(when = 0) {
    if (!canSfx()) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime + when;
    const out = sfxOut();

    const noiseBuf = c.createBuffer(1, c.sampleRate * 0.08, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.18));
    }
    const noise = c.createBufferSource();
    noise.buffer = noiseBuf;
    const nf = c.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 1400 + Math.random() * 600;
    nf.Q.value = 0.8;
    const ng = envGain(c, t, 0.22, 0.004, 0.07);
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(out);
    noise.start(t);
    noise.stop(t + 0.09);

    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220 + Math.random() * 40, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const og = envGain(c, t, 0.08, 0.002, 0.05);
    osc.connect(og);
    og.connect(out);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  function dealMany(count) {
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++) deal(i * 0.09);
  }

  function chip() {
    if (!canSfx()) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.04);
    const g = envGain(c, t, 0.12, 0.005, 0.08);
    osc.connect(g);
    g.connect(sfxOut());
    osc.start(t);
    osc.stop(t + 0.1);
  }

  function turn() {
    if (!canSfx()) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime;
    [523.25, 659.25].forEach((f, i) => {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = envGain(c, t + i * 0.07, 0.07, 0.01, 0.12);
      osc.connect(g);
      g.connect(sfxOut());
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.15);
    });
  }

  function win() {
    if (!canSfx()) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = envGain(c, t + i * 0.1, 0.1, 0.015, 0.22);
      osc.connect(g);
      g.connect(sfxOut());
      osc.start(t + i * 0.1);
      osc.stop(t + i * 0.1 + 0.28);
    });
  }

  function bust() {
    if (!canSfx()) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    const g = envGain(c, t, 0.07, 0.01, 0.2);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500;
    osc.connect(f);
    f.connect(g);
    g.connect(sfxOut());
    osc.start(t);
    osc.stop(t + 0.25);
  }

  function click() {
    if (!canSfx()) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 640;
    const g = envGain(c, t, 0.05, 0.002, 0.03);
    osc.connect(g);
    g.connect(sfxOut());
    osc.start(t);
    osc.stop(t + 0.04);
  }

  function setMusicVolume(v) {
    musicVol = clamp01(v);
    localStorage.setItem("21musicVol", String(musicVol));
    applyMusicVolume();
    if (unlocked) {
      if (musicVol > 0.001) startMusic();
      else music.pause();
    }
    return musicVol;
  }

  function setSfxVolume(v) {
    sfxVol = clamp01(v);
    localStorage.setItem("21sfxVol", String(sfxVol));
    applySfxVolume();
    return sfxVol;
  }

  function getSettings() {
    return {
      musicVol,
      sfxVol,
      musicPlaying: !music.paused && musicStarted,
      musicOn: musicVol > 0.001,
      sfxOn: sfxVol > 0.001,
      trackId,
      tracks: TRACKS.map((t) => ({ id: t.id, title: t.title })),
    };
  }

  function getTracks() {
    return TRACKS.map((t) => ({ id: t.id, title: t.title }));
  }

  function isMuted() {
    return musicVol <= 0.001 && sfxVol <= 0.001;
  }

  window.GameAudio = {
    unlock,
    startMusic,
    setTrack,
    getTracks,
    deal,
    dealMany,
    chip,
    turn,
    win,
    bust,
    click,
    setMusicVolume,
    setSfxVolume,
    getSettings,
    isMuted,
  };

  const unlockOnce = () => {
    unlock();
  };

  window.addEventListener("pointerdown", unlockOnce, { once: true });
  window.addEventListener("keydown", unlockOnce, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      music.pause();
    } else if (unlocked && musicVol > 0.001) {
      startMusic();
    }
  });
})();
