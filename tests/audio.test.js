// Audio state machine with a stubbed AudioContext, plain Node: node tests/audio.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math, JSON });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/audio.js'), 'utf8'), ctx, { filename: 'js/audio.js' });
const { makeAudio, Sfx, AUDIO } = vm.runInContext('({ makeAudio, Sfx, AUDIO })', ctx);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

// A stub context: every node is a permissive object; sources are recorded so the test can end them.
const sources = [];
class Param { constructor() { this.value = 0; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} setTargetAtTime() {} }
class Node {
  constructor(src) { this.gain = new Param(); this.frequency = new Param(); this.delayTime = new Param(); this.Q = new Param(); this.onended = null; if (src) sources.push(this); }
  connect() {} disconnect() {} start() {} stop() {}
}
class StubCtx {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 1000; this.destination = new Node(); StubCtx.last = this; }
  createGain() { return new Node(); } createBiquadFilter() { return new Node(); } createDelay() { return new Node(); }
  createOscillator() { return new Node(true); } createBufferSource() { return new Node(true); }
  createBuffer(c, n) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  resume() { this.state = 'running'; return Promise.resolve(); } suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

// 1. No AudioContext: everything is a silent no-op
check('global Sfx exists without AudioContext', !!Sfx && Sfx.unlock() === false);
let threw = false;
try { Sfx.play('hit'); Sfx.update(1); Sfx.walk(1, 5, true, false); Sfx.mark('PARRY'); Sfx.setTheme('chapel'); Sfx.setMuted(true); Sfx.setMuted(false); } catch (e) { threw = true; }
check('no-AudioContext calls never throw', !threw);

// 2. Ambient -> battle -> ambient with hysteresis
let alerts = 0;
const a = makeAudio(StubCtx, { store: mem() });
a.alertFn = () => alerts;
check('silent before the first gesture', (a.update(1), a.play('hit'), a.voices === 0 && a.mode === 'ambient' && !a.started));
check('unlock creates the context', a.unlock() === true && a.started);
const c = StubCtx.last, run = secs => { for (let t = 0; t < secs; t += 0.05) { c.currentTime += 0.05; a.update(0.05); } };
run(1); check('quiet floor stays ambient', a.mode === 'ambient');
alerts = 2; run(0.5); check('alerted enemy: battle', a.mode === 'battle');
alerts = 0; run(3); check('3 s after: still battle (hysteresis)', a.mode === 'battle');
alerts = 1; run(0.5); alerts = 0; run(3); check('re-alert resets the 4 s timer', a.mode === 'battle');
run(1.5); check('about 4 s of calm: back to ambient', a.mode === 'ambient');
alerts = 1; run(0.3); alerts = 0; run(AUDIO.calm - 0.5); check('no flapping on a brief alert', a.mode === 'battle');

// 3. Mute: no voices, no work
const m = makeAudio(StubCtx, { store: mem() }); m.alertFn = () => 1; m.unlock();
m.setMuted(true); m.play('hit'); m.update(5);
check('muted: no sfx and no state change', m.voices === 0 && m.mode === 'ambient' && m.muted);
m.setMuted(false); StubCtx.last.currentTime += 1; m.play('hit'); check('unmuted: sfx play again', m.voices > 0);
m.setHidden(true); const v0 = m.voices; StubCtx.last.currentTime += 1; m.play('pickup'); check('hidden tab: silent', m.voices === v0);

// 4. Settings persist
const st = mem(); const p = makeAudio(StubCtx, { store: st }); p.setMuted(true); p.setVolume(0.4);
const q = makeAudio(StubCtx, { store: st }); check('mute and volume persist', q.muted && Math.abs(q.volume - 0.4) < 1e-9);
check('broken storage does not throw', (() => { try { makeAudio(StubCtx, { store: { getItem() { throw 1; }, setItem() { throw 1; } } }).setMuted(true); return true; } catch (e) { return false; } })());

// 5. Voice cap and release
const v = makeAudio(StubCtx, { store: mem() }); v.unlock(); const vc = StubCtx.last;
const names = ['swing', 'hit', 'block', 'parry', 'ehurt', 'edie', 'phurt', 'dash', 'wand_fire', 'wand_frost', 'wand_lightning', 'wand_force', 'wand_sleep', 'bow', 'door', 'chest', 'pickup', 'stairs', 'levelup', 'alert'];
sources.length = 0;
for (let i = 0; i < 3; i++) for (const n of names) { vc.currentTime += 1; v.play(n); }
check('voices capped at ' + AUDIO.voiceCap, v.voices <= AUDIO.voiceCap && v.voices > 0, 'voices=' + v.voices);
const live = sources.filter(s => s.onended); for (const s of live) s.onended();
check('ended voices are released', v.voices === 0, 'voices=' + v.voices);
const w = makeAudio(StubCtx, { store: mem() }); w.unlock(); w.play('hit'); const vv = w.voices; w.play('hit');
check('rapid repeats of one sound are throttled', w.voices === vv);

// 6. Footsteps: none still, quiet crouched, more when running
const f = makeAudio(StubCtx, { store: mem() }); f.unlock(); const fc = StubCtx.last;
const steps = (speed, run, crouch) => { f.walk(0, 0, false, false); let n = 0; for (let i = 0; i < 100; i++) { fc.currentTime += 0.1; const b = f.voices; f.walk(0.1, speed, run, crouch); if (f.voices > b) n++; sources.filter(s => s.onended).forEach(s => s.onended()); sources.length = 0; } return n; };
check('no footsteps when standing still', steps(0, false, false) === 0);
check('footsteps while walking', steps(3, false, false) > 0);
check('running steps more often than crouching', steps(6, true, false) > steps(1.5, false, true));

console.log(fails ? `\n${fails} FAILED` : '\nall audio checks passed');
process.exit(fails ? 1 : 0);
