// Procedural sound: every sound is synthesized with WebAudio, no audio files. One global, Sfx = makeAudio(AudioContext).
// Without an AudioContext (Node tests, old browsers) every call is a silent no-op. The context is created on the first user gesture.
// Layers: ambient (detuned drone pad, slow wind, sparse bell/drip tones through one echo), battle (drum pulse + rising dissonant drone,
// built only while a fight lasts) and one-shot SFX (Sfx.play('hit')). Music state is checked about 4 times a second from update(dt);
// nothing runs while muted or while the tab is hidden. Voices (one-shot oscillators/noise bursts) are capped at VOICE_CAP.
// Audio randomness uses Math.random on purpose: it never feeds gameplay or generation, so seeded runs still repeat.
const AUDIO = {
  voiceCap: 16,       // concurrent one-shot voices (music is exempt: a handful of nodes)
  tick: 0.25,         // s between music-state checks (4 Hz)
  calm: 4,            // s with no alerted enemy before the battle layer fades back to ambient
  beat: 0.55,         // s per drum beat in battle
  sfxVol: 0.9, musicVol: 0.45,
  store: 'honeyhan-audio',
};
// Per-theme flavour: root note (Hz), scale (semitones above the root), wind band (Hz) and level, chime kind, mean seconds between chimes.
const AUDIO_THEMES = {
  tavern:  { root: 55.0, sc: [0, 3, 5, 7, 10], wind: 300,  wg: 0.5, chime: 'drip',  gap: 7 },
  orchard: { root: 61.7, sc: [0, 2, 3, 7, 8],  wind: 700,  wg: 0.8, chime: 'bell',  gap: 9 },
  library: { root: 49.0, sc: [0, 1, 5, 7],     wind: 260,  wg: 0.3, chime: 'pluck', gap: 8 },
  cellar:  { root: 46.2, sc: [0, 1, 6, 8],     wind: 220,  wg: 0.4, chime: 'drip',  gap: 5 },
  market:  { root: 58.3, sc: [0, 3, 7, 10],    wind: 500,  wg: 0.4, chime: 'pluck', gap: 6 },
  chapel:  { root: 55.0, sc: [0, 3, 7, 12],    wind: 900,  wg: 1.0, chime: 'bell',  gap: 10 },
  jungle:  { root: 51.9, sc: [0, 2, 3, 5, 7],  wind: 450,  wg: 0.6, chime: 'drip',  gap: 6 },
  final:   { root: 41.2, sc: [0, 1, 3, 6],     wind: 180,  wg: 0.7, chime: 'bell',  gap: 12 },
};

function makeAudio(Ctor, opts) {
  opts = opts || {};
  const store = opts.store !== undefined ? opts.store : (typeof localStorage !== 'undefined' ? localStorage : null);
  let ctx = null, master = null, sfxBus = null, musBus = null, echo = null, noiseBuf = null;
  let muted = false, vol = 0.7, hidden = false, voices = 0;
  let amb = null, bat = null;                        // the ambient layer (built once) and the battle layer (built on demand)
  let th = AUDIO_THEMES.tavern, mode = 'ambient';
  let accT = 0, calmT = 0, batT = 0, lastAlerts = 0, nextChime = 0, nextBeat = 0, beatNo = 0, batOffAt = 0;
  let stepD = 0;
  const last = Object.create(null);                  // per-sound time of the last play (throttle)
  const noop = () => {};

  try { const s = store && JSON.parse(store.getItem(AUDIO.store) || 'null'); if (s) { muted = !!s.muted; if (s.vol >= 0 && s.vol <= 1) vol = s.vol; } } catch (e) { /* no storage */ }
  const save = () => { try { if (store) store.setItem(AUDIO.store, JSON.stringify({ muted, vol })); } catch (e) { /* ignore */ } };
  const on = () => !!ctx && !muted && !hidden;

  // ---- engine ----
  function endVoice() {                              // shared onended handler: free the voice and its small chain
    voices--;
    try { this.disconnect(); const c = this._c; if (c) for (let i = 0; i < c.length; i++) c[i].disconnect(); } catch (e) { /* already gone */ }
  }
  function build() {
    master = ctx.createGain(); master.gain.value = muted ? 0 : vol; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = AUDIO.sfxVol; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = AUDIO.musicVol; musBus.connect(master);
    const n = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 2));      // one 2 s white-noise buffer, shared by every noise voice and the wind
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate || 44100);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    echo = ctx.createDelay(1); echo.delayTime.value = 0.46;                // sparse tones go through one feedback echo (cheap stand-in for reverb)
    const fb = ctx.createGain(), lp = ctx.createBiquadFilter(); fb.gain.value = 0.4; lp.type = 'lowpass'; lp.frequency.value = 1700;
    echo.connect(lp); lp.connect(fb); fb.connect(echo); lp.connect(musBus);
    buildAmbient();
  }
  function osc(type, f, dest) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (dest) o.connect(dest); return o; }
  function buildAmbient() {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(musBus);
    const padG = ctx.createGain(); padG.gain.value = 0.16;
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 340; padF.Q.value = 0.7;
    padG.connect(padF); padF.connect(g);
    const r = th.root;
    const o = [osc('sine', r, padG), osc('sawtooth', r * 1.5 * 1.004, padG), osc('triangle', r * 2 * 0.994, padG), osc('sawtooth', r * 0.998, padG)];
    const lfo = osc('sine', 0.06, null), lg = ctx.createGain(); lg.gain.value = 0.06; lfo.connect(lg); lg.connect(padG.gain);   // the pad breathes slowly
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 0.9; wf.frequency.value = th.wind;
    const wg = ctx.createGain(); wg.gain.value = 0.05 * th.wg;
    wind.connect(wf); wf.connect(wg); wg.connect(g);
    const wl = osc('sine', 0.08, null), wlg = ctx.createGain(); wlg.gain.value = th.wind * 0.35; wl.connect(wlg); wlg.connect(wf.frequency);   // the wind sweeps
    for (const x of o) x.start(); lfo.start(); wind.start(); wl.start();
    amb = { g, o, wf, wg, wlg, padF, lfo, wl, wind, padG };
  }
  function applyTheme() {
    if (!amb) return;
    const t = ctx.currentTime, r = th.root, k = [1, 1.5 * 1.004, 2 * 0.994, 0.998];
    for (let i = 0; i < 4; i++) amb.o[i].frequency.setTargetAtTime(r * k[i], t, 2.5);   // glide to the new key: an unhurried crossfade
    amb.wf.frequency.setTargetAtTime(th.wind, t, 2.5); amb.wlg.gain.setTargetAtTime(th.wind * 0.35, t, 2.5); amb.wg.gain.setTargetAtTime(0.05 * th.wg, t, 2.5);
  }
  function startBattle() {
    if (bat || !ctx) return;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(musBus);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 2; f.connect(g);
    const dg = ctx.createGain(); dg.gain.value = 0.22; dg.connect(f);
    const r = th.root * 2;
    const o1 = osc('sawtooth', r, dg), o2 = osc('sawtooth', r * 1.414, dg), o3 = osc('square', r * 0.5, dg);   // a tritone over a low square: dissonant
    const lfo = osc('sine', 5.5, null), lg = ctx.createGain(); lg.gain.value = 0.07; lfo.connect(lg); lg.connect(dg.gain);   // trembling
    o1.start(); o2.start(); o3.start(); lfo.start();
    bat = { g, f, o: [o1, o2, o3], lfo, base: r, nodes: [g, f, dg, lg] };
    nextBeat = ctx.currentTime + 0.1; beatNo = 0; batT = 0;
  }
  function stopBattle() {
    if (!bat) return;
    const b = bat; bat = null;
    try { for (const x of b.o) { x.stop(); x.disconnect(); } b.lfo.stop(); b.lfo.disconnect(); for (const n of b.nodes) n.disconnect(); } catch (e) { /* ignore */ }
  }
  function syncRun() {
    if (!ctx) return;
    if (master) master.gain.value = muted ? 0 : vol;
    const want = on();
    try {
      if (want && ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(noop); }
      else if (!want && ctx.state === 'running') { const p = ctx.suspend(); if (p && p.catch) p.catch(noop); }
    } catch (e) { /* ignore */ }
  }

  // ---- voices ----
  // tone: an oscillator gliding f0 to f1 over dur with an attack/decay envelope. noise: a filtered burst of the shared buffer.
  function room(music) { if (!music && voices >= AUDIO.voiceCap) return false; voices++; return true; }
  function tone(type, f0, f1, dur, v, delay, bus) {
    if (!room(false)) return;
    const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus); o._c = [g]; o.onended = endVoice;
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, v, ft, f0, f1, q, delay, att) {
    if (!room(false)) return;
    const t = ctx.currentTime + (delay || 0), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), a = att || 0.008;
    s.buffer = noiseBuf; f.type = ft; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s._c = [f, g]; s.onended = endVoice;
    s.start(t, Math.random() * 1.4, dur + 0.02);
  }
  // One-shot recipes. v: volume scale. Kept short; each tone/noise call is one voice.
  const S = {
    swing:  v => noise(0.22, 0.22 * v, 'bandpass', 500, 1800, 1.2, 0, 0.07),
    hit:    v => { noise(0.12, 0.45 * v, 'lowpass', 1300, 300, 0.8); tone('sine', 150, 55, 0.14, 0.5 * v); },
    block:  v => { tone('triangle', 820, 790, 0.35, 0.3 * v); tone('triangle', 1250, 1210, 0.25, 0.2 * v); noise(0.05, 0.25 * v, 'highpass', 3000, 3000); },
    parry:  v => { tone('triangle', 1100, 1080, 0.5, 0.3 * v); tone('triangle', 1780, 1750, 0.4, 0.2 * v); tone('sine', 2650, 2600, 0.3, 0.1 * v); noise(0.05, 0.3 * v, 'highpass', 4000, 4000); },
    ehurt:  v => { tone('sawtooth', 260, 140, 0.2, 0.16 * v); noise(0.1, 0.12 * v, 'bandpass', 900, 500, 1); },
    edie:   v => { tone('sawtooth', 210, 50, 0.55, 0.2 * v); noise(0.35, 0.18 * v, 'lowpass', 700, 150, 0.7, 0.05); },
    phurt:  v => { tone('sine', 95, 48, 0.28, 0.6 * v); noise(0.2, 0.3 * v, 'lowpass', 500, 150, 0.7); },
    step:   v => noise(0.07, 0.1 * v, 'lowpass', 380, 220, 0.7),
    dash:   v => noise(0.3, 0.3 * v, 'bandpass', 400, 3000, 1.0, 0, 0.08),
    wand_fire:      v => { noise(0.5, 0.3 * v, 'bandpass', 1000, 300, 0.9, 0, 0.1); tone('sawtooth', 140, 320, 0.3, 0.12 * v); },
    wand_frost:     v => { tone('sine', 1800, 2700, 0.35, 0.18 * v); tone('sine', 2400, 3200, 0.25, 0.1 * v, 0.05); noise(0.3, 0.12 * v, 'highpass', 4500, 6000); },
    wand_lightning: v => { noise(0.25, 0.4 * v, 'highpass', 1800, 4000, 0.7); tone('square', 70, 28, 0.25, 0.2 * v); },
    wand_force:     v => { tone('sine', 220, 40, 0.4, 0.5 * v); noise(0.25, 0.25 * v, 'lowpass', 900, 120, 0.7); },
    wand_sleep:     v => { tone('sine', 440, 330, 0.7, 0.2 * v); tone('sine', 554, 415, 0.7, 0.14 * v, 0.1); },
    bow:    v => { tone('triangle', 320, 110, 0.09, 0.35 * v); noise(0.07, 0.2 * v, 'bandpass', 2200, 1500, 1); },
    door:   v => { noise(0.5, 0.3 * v, 'lowpass', 500, 180, 0.8, 0, 0.1); tone('sawtooth', 72, 52, 0.45, 0.15 * v); },
    chest:  v => { tone('sawtooth', 120, 230, 0.28, 0.08 * v); tone('sine', 1500, 1500, 0.35, 0.12 * v, 0.2); tone('sine', 2250, 2250, 0.3, 0.08 * v, 0.26); },
    pickup: v => { tone('sine', 880, 880, 0.16, 0.22 * v); tone('sine', 1320, 1320, 0.22, 0.2 * v, 0.07); },
    stairs: v => { noise(0.18, 0.28 * v, 'lowpass', 260, 130, 0.8); noise(0.18, 0.25 * v, 'lowpass', 260, 130, 0.8, 0.2); noise(0.18, 0.22 * v, 'lowpass', 260, 130, 0.8, 0.4); },
    levelup: v => { tone('sine', 523, 523, 0.5, 0.2 * v); tone('sine', 659, 659, 0.5, 0.2 * v, 0.12); tone('sine', 784, 784, 0.5, 0.2 * v, 0.24); tone('sine', 1047, 1047, 0.7, 0.22 * v, 0.36); },
    alert:  v => { tone('sawtooth', 440, 466, 0.5, 0.12 * v); tone('sawtooth', 311, 330, 0.5, 0.12 * v); tone('sine', 1250, 900, 0.3, 0.12 * v); },
  };
  const GAP = { step: 0.12, hit: 0.05, swing: 0.1, ehurt: 0.08, block: 0.1, parry: 0.1 };   // per-sound minimum seconds between plays

  function play(name, v) {
    if (!on()) return;
    const fn = S[name]; if (!fn) return;
    const t = ctx.currentTime, g = GAP[name] === undefined ? 0.03 : GAP[name];
    if (t - (last[name] === undefined ? -9 : last[name]) < g) return;
    if (voices >= AUDIO.voiceCap) return;
    last[name] = t; fn(v === undefined ? 1 : v);
  }

  // ---- music ----
  function chime() {                                 // one sparse tone from the theme's scale, bell / drip / pluck, through the echo
    const deg = th.sc[(Math.random() * th.sc.length) | 0], oct = 3 + ((Math.random() * 3) | 0), f = th.root * Math.pow(2, oct + deg / 12);
    if (th.chime === 'bell') { tone('sine', f, f, 3.2, 0.1, 0, echo); tone('sine', f * 2.76, f * 2.76, 1.4, 0.04, 0, echo); }
    else if (th.chime === 'drip') tone('sine', f * 2, f, 0.12, 0.1, 0, echo);
    else tone('triangle', f, f, 0.6, 0.1, 0, echo);
  }
  function drum(t, accent) {                         // a low thud: a sine drop (voice exempt from the cap: two or three a second at most)
    if (voices >= AUDIO.voiceCap + 4) return;
    voices++;
    const o = ctx.createOscillator(), g = ctx.createGain(), v = accent ? 0.55 : 0.3;
    o.frequency.setValueAtTime(accent ? 110 : 85, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(musBus); o._c = [g]; o.onended = endVoice; o.start(t); o.stop(t + 0.24);
  }
  function setMode(m) {
    if (m === mode) return;
    mode = m; const t = ctx.currentTime;
    if (m === 'battle') {
      startBattle(); batT = 0;
      bat.g.gain.setTargetAtTime(1, t, 0.7); amb.g.gain.setTargetAtTime(0.15, t, 0.9);
    } else {
      if (bat) { bat.g.gain.setTargetAtTime(0, t, 1.0); batOffAt = t + 5; }
      amb.g.gain.setTargetAtTime(1, t, 1.4);
    }
  }
  // The 4 Hz step: alertCount = enemies hunting you right now.
  function step4(alerts) {
    const t = ctx.currentTime;
    if (alerts > lastAlerts && !(mode === 'battle' && alerts > 1 && lastAlerts > 0)) play('alert', 1);   // a guard just noticed you (a sting)
    lastAlerts = alerts;
    if (alerts > 0) { calmT = 0; if (mode !== 'battle') setMode('battle'); }
    else if (mode === 'battle' && (calmT += AUDIO.tick) >= AUDIO.calm) setMode('ambient');
    if (mode === 'battle' && bat) {
      batT += AUDIO.tick;
      const k = Math.min(batT, 40) / 40;               // the drone climbs over the fight
      bat.o[0].frequency.setTargetAtTime(bat.base * (1 + 0.25 * k), t, 0.5); bat.o[1].frequency.setTargetAtTime(bat.base * 1.414 * (1 + 0.25 * k), t, 0.5);
      bat.f.frequency.setTargetAtTime(500 + 1200 * k, t, 0.5);
      while (nextBeat < t + 0.5) { drum(nextBeat, beatNo % 4 === 0); if (beatNo % 4 === 1) drum(nextBeat + AUDIO.beat * 0.5, false); beatNo++; nextBeat += AUDIO.beat * (1 - 0.25 * k); }
    } else {
      if (bat && t > batOffAt) stopBattle();
      if (mode === 'ambient' && t >= nextChime) { if (nextChime > 0) chime(); nextChime = t + th.gap * (0.5 + Math.random()); }
    }
  }

  const api = {
    play,
    get mode() { return mode; }, get voices() { return voices; }, get muted() { return muted; }, get volume() { return vol; }, get started() { return !!ctx; },
    alertFn: null,                                   // set by the game: () => number of enemies hunting the player
    unlock() {                                       // first user gesture: create (or resume) the context
      if (!Ctor) return false;
      if (!ctx) { try { ctx = new Ctor(); build(); } catch (e) { ctx = null; Ctor = null; return false; } }
      syncRun(); return true;
    },
    setMuted(m) { muted = !!m; save(); syncRun(); },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); save(); syncRun(); },
    setHidden(h) { hidden = !!h; syncRun(); },
    setTheme(id) {
      const n = AUDIO_THEMES[id] || AUDIO_THEMES.tavern;
      if (n === th) return; th = n; if (ctx) applyTheme();
    },
    update(dt) {                                     // every frame: one add and a compare; the work runs 4 times a second
      if (!on()) return;
      accT += dt > 0.5 ? 0.5 : dt;
      if (accT < AUDIO.tick) return;
      accT %= AUDIO.tick;
      step4(api.alertFn ? api.alertFn() : 0);
    },
    walk(dt, speed, running, crouching) {            // footsteps by distance walked: quiet crouched, louder running, none standing still
      if (!ctx || !on() || speed < 0.4) { stepD = 0; return; }
      stepD += speed * dt;
      const stride = running ? 1.9 : crouching ? 1.2 : 1.45;
      if (stepD >= stride) { stepD -= stride; play('step', running ? 1.7 : crouching ? 0.35 : 1); }
    },
    mark(text) {                                     // the combat text decides block / parry sounds
      if (text.charCodeAt(0) === 80 && text.startsWith('PARRY')) play('parry', 1);
      else if (text.includes('BLOCK') || text.startsWith('GUARD BROKEN')) play('block', 1);
    },
    nextMusicAt() { return nextChime; },
  };
  return api;
}

const Sfx = makeAudio(typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
if (typeof window !== 'undefined' && window.addEventListener) {
  const gesture = () => { if (Sfx.unlock()) { removeEventListener('pointerdown', gesture, true); removeEventListener('keydown', gesture, true); } };
  addEventListener('pointerdown', gesture, true); addEventListener('keydown', gesture, true);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => Sfx.setHidden(document.hidden));
}
