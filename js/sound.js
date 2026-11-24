// =============================================================
//  サウンド：Web Audio で効果音・BGMを合成
//  assets/sounds/<名前>.wav を置くと、その音で差し替わる
// =============================================================

export const SOUND_NAMES = [
  // 試合中に鳴る音（ユーザー素材で差し替え想定）
  'bgm_start', 'bgm_game', 'item_press', 'call', 'judge', 'item_judge', 'fanfare', 'turn',
  // 試合外（メニュー等）の合成音
  'click', 'hover', 'key', 'title', 'ready', 'shuffle', 'draw', 'bgm_title',
];
/** 試合中はこれ以外鳴らさない */
const MATCH_SE = ['item_press', 'call', 'judge', 'item_judge', 'fanfare', 'turn'];
const MATCH_BGM = ['bgm_start', 'bgm_game'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.vol = { master: 0.8, se: 0.85, bgm: 0.35 };
    this.muted = false;
    try {
      const v = JSON.parse(localStorage.getItem('numer0n_vol') || 'null');
      if (v) Object.assign(this.vol, v);
      this.muted = localStorage.getItem('numer0n_mute') === '1';
    } catch (e) {}
    this.bgmName = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.seBus = this.ctx.createGain(); this.seBus.connect(this.master);
    this.bgmBus = this.ctx.createGain(); this.bgmBus.connect(this.master);
    // 簡易リバーブ
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(1.6);
    const wet = this.ctx.createGain(); wet.gain.value = 0.22;
    this.verb.connect(wet); wet.connect(this.master);
    this._applyVol();
    this._loadOverrides();
  }

  _applyVol() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : this.vol.master;
    this.seBus.gain.value = this.vol.se;
    this.bgmBus.gain.value = this.vol.bgm;
  }
  setVolume(k, v) { this.vol[k] = v; this._applyVol(); localStorage.setItem('numer0n_vol', JSON.stringify(this.vol)); }
  setMuted(m) { this.muted = m; this._applyVol(); localStorage.setItem('numer0n_mute', m ? '1' : '0'); }

  async _loadOverrides() {
    if (location.protocol === 'file:') return;
    await Promise.all(SOUND_NAMES.map(async (n) => {
      try {
        const r = await fetch(`assets/sounds/${n}.wav`, { cache: 'force-cache' });
        if (!r.ok) return;
        const ab = await r.arrayBuffer();
        this.buffers[n] = await this.ctx.decodeAudioData(ab);
        if (n === this.bgmName) this.bgm(n, true);
      } catch (e) { /* なければ合成音 */ }
    }));
  }

  _impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    return b;
  }

  // ---------------- 合成の部品 ----------------
  _env(g, t, a, peak, d, sus = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + d);
  }
  tone(freq, dur, { type = 'sine', gain = 0.3, at = 0, slide = null, attack = 0.005, verb = 0.3, filter = null, bus = null } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = ctx.createGain(); this._env(g, t, attack, gain, dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = filter.type || 'lowpass'; f.frequency.value = filter.freq; f.Q.value = filter.q || 1; o.connect(f); node = f; }
    node.connect(g); g.connect(bus || this.seBus);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s); s.connect(this.verb); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  noise(dur, { gain = 0.3, at = 0, freq = 2000, type = 'bandpass', q = 1, slide = null, attack = 0.003, verb = 0.2, bus = null } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const len = Math.ceil(ctx.sampleRate * (dur + 0.05));
    if (!this._noiseBuf || this._noiseBuf.length < len) {
      const b = ctx.createBuffer(1, Math.max(len, ctx.sampleRate * 2), ctx.sampleRate);
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = b;
    }
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = ctx.createGain(); this._env(g, t, attack, gain, dur);
    src.connect(f); f.connect(g); g.connect(bus || this.seBus);
    if (verb) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s); s.connect(this.verb); }
    src.start(t); src.stop(t + dur + 0.1);
  }
  boom(at = 0, gain = 0.8) {
    this.tone(120, 0.7, { at, gain, slide: 32, type: 'sine', verb: 0.1 });
    this.noise(0.35, { at, gain: gain * 0.4, freq: 400, type: 'lowpass', verb: 0.3 });
  }
  chord(freqs, dur, opts = {}) { freqs.forEach((f) => this.tone(f, dur, opts)); }

  // ---------------- 再生 ----------------
  play(name, opt = {}) {
    if (!this.ctx) return;
    if (this.inMatch && !MATCH_SE.includes(name)) return;
    if (this.buffers[name]) {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name];
      const g = this.ctx.createGain(); g.gain.value = opt.gain || 1;
      src.connect(g); g.connect(this.seBus); src.start();
      return;
    }
    const fn = this['s_' + name];
    if (fn) fn.call(this, opt);
  }

  s_click() { this.tone(1400, 0.04, { type: 'square', gain: 0.06, verb: 0, filter: { freq: 3000 } }); this.tone(2100, 0.05, { gain: 0.05, at: 0.01, verb: 0.1 }); }
  s_hover() { this.tone(2400, 0.02, { gain: 0.015, verb: 0 }); }
  s_key(o) { const f = 660 + (o.n || 0) * 40; this.tone(f, 0.08, { type: 'triangle', gain: 0.14, verb: 0.15 }); this.tone(f * 2, 0.05, { gain: 0.05 }); }
  s_ready() { [784, 1175].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.18, at: i * 0.08 })); }
  s_title() {
    this.boom(0, 0.6);
    [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => this.tone(f, 0.9, { type: 'sawtooth', gain: 0.07, at: 0.05 + i * 0.07, filter: { freq: 2200 }, verb: 0.5 }));
    this.noise(1.2, { gain: 0.15, freq: 300, slide: 8000, type: 'bandpass', q: 2, verb: 0.6 });
  }
  s_start() {
    this.noise(1.1, { gain: 0.25, freq: 200, slide: 9000, q: 3, verb: 0.5 });
    [196, 261.6, 329.6, 392, 523.3, 659.3, 784].forEach((f, i) => this.tone(f, 0.35, { type: 'sawtooth', gain: 0.07, at: i * 0.07, filter: { freq: 3000 }, verb: 0.4 }));
    this.boom(0.55, 1);
    this.chord([261.6, 392, 523.3, 659.3, 1046.5], 1.6, { type: 'sawtooth', gain: 0.06, at: 0.55, filter: { freq: 2500 }, verb: 0.6 });
    this.tone(2093, 1.2, { gain: 0.06, at: 0.6, verb: 0.8 });
  }
  s_draw() { this.noise(0.12, { gain: 0.25, freq: 3500, type: 'highpass', verb: 0.15 }); this.tone(900, 0.08, { type: 'triangle', gain: 0.06, at: 0.03 }); }
  s_turn() { this.tone(659, 0.18, { type: 'triangle', gain: 0.2, verb: 0.4 }); this.tone(988, 0.35, { type: 'triangle', gain: 0.2, at: 0.11, verb: 0.5 }); }
  s_call() {
    this.boom(0, 0.9);
    this.noise(0.25, { gain: 0.35, freq: 5000, type: 'highpass', verb: 0.4 });
    this.tone(1760, 0.6, { gain: 0.1, verb: 0.6 }); this.tone(2637, 0.4, { gain: 0.05, verb: 0.6 });
  }
  s_drum(o) {
    const dur = o.dur || 1.0, n = Math.floor(dur / 0.055);
    for (let i = 0; i < n; i++) this.noise(0.05, { gain: 0.06 + 0.22 * (i / n), at: i * 0.055, freq: 900, q: 0.8, verb: 0.1 });
    this.tone(55, dur, { type: 'sine', gain: 0.25, verb: 0, attack: dur * 0.8 });
  }
  s_eat(o) {
    const f = 1046.5 * Math.pow(1.122, o.n || 0);
    this.noise(0.2, { gain: 0.3, freq: 3000, type: 'highpass' });
    this.tone(f, 0.9, { type: 'sine', gain: 0.25, verb: 0.6 }); this.tone(f * 2, 0.5, { gain: 0.08, verb: 0.6 });
    this.tone(f * 1.5, 0.6, { type: 'triangle', gain: 0.07, at: 0.02 });
    this.boom(0, 0.45);
  }
  s_bite(o) {
    const f = 659.3 * Math.pow(1.122, o.n || 0);
    this.tone(f, 0.7, { type: 'triangle', gain: 0.22, verb: 0.5 }); this.tone(f * 1.5, 0.4, { gain: 0.06, verb: 0.5 });
    this.noise(0.12, { gain: 0.15, freq: 2000 });
  }
  s_zero() { this.tone(130, 0.45, { type: 'square', gain: 0.1, filter: { freq: 700 }, verb: 0.2 }); this.tone(123, 0.45, { type: 'square', gain: 0.08, filter: { freq: 700 }, at: 0.02 }); }
  s_judge() {
    this.noise(0.2, { gain: 0.3, freq: 3000, type: 'highpass' });
    this.chord([1046.5, 1318.5, 1568], 0.8, { type: 'triangle', gain: 0.1, verb: 0.6 });
    this.boom(0, 0.5);
  }
  s_item_judge() { [1318.5, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, { type: 'sine', gain: 0.14, at: i * 0.07, verb: 0.4 })); this.boom(0.2, 0.35); }
  s_fanfare() {
    this.boom(0, 1.1); this.boom(0.35, 0.8);
    this.noise(2.5, { gain: 0.2, freq: 6000, type: 'highpass', verb: 0.8, attack: 0.3 });
    const seq = [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093];
    seq.forEach((f, i) => this.tone(f, 0.25, { type: 'square', gain: 0.06, at: i * 0.06, filter: { freq: 4000 }, verb: 0.5 }));
    this.chord([523.3, 659.3, 784, 1046.5], 2.6, { type: 'sawtooth', gain: 0.05, at: 0.45, filter: { freq: 3000 }, verb: 0.8 });
  }
  s_item_attack(o) {
    const k = o.pitch || 1;
    this.tone(2400 * k, 0.45, { type: 'sawtooth', gain: 0.12, slide: 180 * k, filter: { freq: 4000 }, verb: 0.4 });
    this.noise(0.5, { gain: 0.3, freq: 8000, slide: 300, q: 2, verb: 0.4 });
    this.boom(0.05, 0.7);
    [0, 0.12, 0.24].forEach((a, i) => this.tone(880 * k * (1 + i * 0.5), 0.3, { type: 'square', gain: 0.05, at: 0.2 + a, filter: { freq: 3000 }, verb: 0.6 }));
  }
  s_item_defense(o) {
    const k = o.pitch || 1;
    this.tone(300 * k, 0.9, { type: 'sine', gain: 0.2, slide: 1400 * k, verb: 0.6 });
    this.noise(1.0, { gain: 0.15, freq: 600, slide: 9000, q: 4, verb: 0.6 });
    this.chord([523.3 * k, 784 * k, 1046.5 * k], 1.2, { type: 'triangle', gain: 0.06, at: 0.35, verb: 0.8 });
  }
  s_item_press() {
    this.tone(880, 0.12, { type: 'square', gain: 0.1, filter: { freq: 3000 }, verb: 0.2 });
    this.tone(1320, 0.25, { type: 'square', gain: 0.09, at: 0.09, filter: { freq: 3500 }, verb: 0.4 });
    this.noise(0.3, { gain: 0.2, freq: 1500, slide: 7000, q: 2, verb: 0.3 });
  }
  s_info() { [1318.5, 1568, 2093].forEach((f, i) => this.tone(f, 0.15, { type: 'sine', gain: 0.12, at: i * 0.07, verb: 0.4 })); }
  s_shuffle() { for (let i = 0; i < 7; i++) this.noise(0.06, { gain: 0.22, at: i * 0.08, freq: 3000 + Math.random() * 2000, type: 'highpass', verb: 0.1 }); }
  s_tick(o) { this.tone(o.last ? 1500 : 1000, 0.05, { type: 'square', gain: 0.07, filter: { freq: 3000 }, verb: 0 }); }
  s_timeup() { this.tone(440, 0.8, { type: 'sawtooth', gain: 0.12, slide: 110, filter: { freq: 1500 }, verb: 0.4 }); this.boom(0, 0.6); }
  s_win() {
    const N = (n) => 261.63 * Math.pow(2, n / 12);
    const mel = [[0, 0.12], [4, 0.12], [7, 0.12], [12, 0.36], [7, 0.12], [12, 0.6]];
    let at = 0;
    for (const [n, d] of mel) { this.tone(N(n + 12), d + 0.1, { type: 'square', gain: 0.07, at, filter: { freq: 3500 }, verb: 0.4 }); this.tone(N(n), d + 0.1, { type: 'triangle', gain: 0.1, at, verb: 0.3 }); at += d; }
    this.chord([N(0), N(4), N(7), N(12), N(16)], 2.2, { type: 'sawtooth', gain: 0.04, at, filter: { freq: 2800 }, verb: 0.7 });
    this.boom(at, 0.9);
    this.noise(2.0, { gain: 0.12, at, freq: 7000, type: 'highpass', verb: 0.8, attack: 0.1 });
  }
  s_lose() {
    const N = (n) => 220 * Math.pow(2, n / 12);
    [7, 5, 3, 0].forEach((n, i) => this.tone(N(n), 0.5, { type: 'sawtooth', gain: 0.07, at: i * 0.28, filter: { freq: 1200 }, verb: 0.5 }));
    this.tone(N(-12), 1.6, { type: 'sine', gain: 0.2, at: 1.1, verb: 0.4 });
  }
  s_draw_game() { this.chord([392, 523.3, 587.3], 1.2, { type: 'triangle', gain: 0.08, verb: 0.6 }); }

  /** 動画の音をSE音量・ミュートに連動させる */
  attachMedia(el) {
    if (!this.ctx || el._snd) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      const g = this.ctx.createGain();
      src.connect(g); g.connect(this.seBus);
      el._snd = true; el._gain = g;
    } catch (e) { console.warn('media route failed', e); }
  }
  /** 動画の音量（フェード用） */
  mediaVolume(el, v, sec = 0) {
    if (!this.ctx || !el._gain) { el.volume = v; return; }
    const g = el._gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    if (sec > 0) g.linearRampToValueAtTime(v, t + sec); else g.setValueAtTime(v, t);
  }
  /** 動画再生時：BGMを即停止 → 終わったらフェードで再開 */
  pauseBgm() {
    if (!this.ctx) return;
    const g = this.bgmBus.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(0, this.ctx.currentTime);
  }
  resumeBgm(sec = 2) {
    if (!this.ctx) return;
    const g = this.bgmBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(this.vol.bgm, t + sec);
  }
  duck(on) {
    if (!this.ctx) return;
    this.bgmBus.gain.setTargetAtTime(on ? this.vol.bgm * 0.15 : this.vol.bgm, this.ctx.currentTime, 0.25);
  }

  // ---------------- BGM ----------------
  /** 試合モード：指定の音以外を鳴らさない */
  setMatch(on) {
    this.inMatch = !!on;
    if (on && this.bgmName && !MATCH_BGM.includes(this.bgmName)) this.stopBgm(), (this.bgmName = null);
  }

  /** 素材の長さ（ms）。無ければ null */
  lengthOf(name) { const b = this.buffers[name]; return b ? Math.round(b.duration * 1000) : null; }

  /** ゲームスタートBGMを1回流し、終わったら resolve */
  jingle(name, fallbackMs) {
    this.stopBgm(); this.bgmName = null;
    if (!this.ctx) return new Promise((r) => setTimeout(r, fallbackMs));
    if (this.buffers[name]) {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name];
      src.connect(this.bgmBus); src.start();
      this._jingle = src;
      return new Promise((r) => { src.onended = r; setTimeout(r, this.buffers[name].duration * 1000 + 300); });
    }
    this.s_start();
    return new Promise((r) => setTimeout(r, fallbackMs));
  }

  bgm(name, force) {
    if (name && this.inMatch && !MATCH_BGM.includes(name)) name = null;
    if (!this.ctx) { this.bgmName = name; return; }
    if (this.bgmName === name && !force && (this._bgmSrc || this._seqTimer)) return;
    this.stopBgm();
    this.bgmName = name;
    if (!name) return;
    if (this.buffers[name]) {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers[name]; src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(1, this.ctx.currentTime + 1.2);
      src.connect(g); g.connect(this.bgmBus); src.start();
      this._bgmSrc = src; this._bgmGain = g;
      return;
    }
    this._startSeq(name);
  }
  stopBgm() {
    if (this._jingle) { try { this._jingle.stop(); } catch (e) {} this._jingle = null; }
    if (this._bgmSrc) { const g = this._bgmGain, s = this._bgmSrc; try { g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.6); s.stop(this.ctx.currentTime + 0.7); } catch (e) {} this._bgmSrc = null; }
    if (this._seqTimer) { clearInterval(this._seqTimer); this._seqTimer = null; }
  }
  setTension(k) { this.tension = k; }

  _startSeq(name) {
    const ctx = this.ctx;
    const bpm = name === 'bgm_game' ? 112 : name === 'bgm_result' ? 96 : 88;
    const step = 60 / bpm / 2; // 8分
    // Am - F - C - G 系の進行（ゲーム中は暗め）
    const prog = name === 'bgm_game'
      ? [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]]
      : [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const m = (n) => 440 * Math.pow(2, (n - 69) / 12);
    let i = 0;
    let next = ctx.currentTime + 0.1;
    const B = this.bgmBus;
    const sched = () => {
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(i / 8) % prog.length, ch = prog[bar], pos = i % 8;
        const at = next - ctx.currentTime;
        if (pos === 0) ch.forEach((n) => this.tone(m(n), step * 8, { type: 'sawtooth', gain: 0.022, at, attack: 0.4, filter: { freq: 900 }, verb: 0.6, bus: B }));
        // ベース
        this.tone(m(ch[0] - 24), step * 0.9, { type: 'square', gain: pos % 2 ? 0.05 : 0.08, at, filter: { freq: 380 }, verb: 0, bus: B });
        // ハイハット
        if (name === 'bgm_game') this.noise(0.03, { gain: pos % 2 ? 0.035 : 0.02, at, freq: 9000, type: 'highpass', verb: 0, bus: B });
        // キック
        if (name === 'bgm_game' && pos % 4 === 0) this.tone(90, 0.18, { gain: 0.16, slide: 40, at, verb: 0, bus: B });
        // アルペジオ
        if (pos % 2 === 0 || (this.tension || 0) > 0.5) {
          const n = ch[(pos >> 1) % 3] + 12 + (pos >= 6 ? 12 : 0);
          this.tone(m(n), step * 0.8, { type: 'triangle', gain: 0.025, at, filter: { freq: 2500 }, verb: 0.5, bus: B });
        }
        next += step; i++;
      }
    };
    sched();
    this._seqTimer = setInterval(sched, 60);
  }
}
