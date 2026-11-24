// =============================================================
//  Player：1人分のクライアント。秘密の番号を持ち、
//  自分宛ての問い合わせ（コール判定・アイテム）に自動で答える。
//  人間・CPU 共通。
// =============================================================
import * as R from './rules.js';

export const MANUAL_TYPES = ['call', 'highlow', 'slash', 'target', 'double_reveal'];

export class Player {
  /**
   * @param store  { subscribe(cb), update(fn) => Promise<bool>, now(), saveSecret?(data), loadSecret?() }
   * @param uid
   */
  constructor(store, uid, opts = {}) {
    this.store = store;
    this.uid = uid;
    this.isCpu = !!opts.isCpu;
    this.onState = opts.onState || null;
    this.state = null;
    this.secrets = {};          // { ver: '123' }  ゲームごとにリセット
    this.secretGame = null;
    this._respId = null;
    this._finalSent = null;
    this._unsub = store.subscribe((s) => this._on(s));
    this._timer = setInterval(() => this._tick(), 500);
  }

  destroy() {
    clearInterval(this._timer);
    if (this._unsub) this._unsub();
  }

  now() { return this.store.now(); }

  get secret() {
    const s = this.state;
    if (!s) return null;
    const v = (s.secretVer && s.secretVer[this.uid]) || 0;
    if (this.secrets[v] != null) return this.secrets[v];
    // 予備：最新の版
    const keys = Object.keys(this.secrets).map(Number).sort((a, b) => b - a);
    return keys.length ? this.secrets[keys[0]] : null;
  }

  async restoreSecret() {
    if (!this.store.loadSecret) return;
    const d = await this.store.loadSecret(this.uid);
    if (d && d.vers) {
      this.secrets = Object.assign({}, d.vers);
      this.secretGame = d.game;
    }
  }

  _persist() {
    if (this.store.saveSecret) this.store.saveSecret(this.uid, { game: this.secretGame, vers: this.secrets });
  }

  _on(s) {
    this.state = s ? R.norm(JSON.parse(JSON.stringify(s))) : null;
    const st = this.state;
    if (st) {
      this._autoRespond(st);
      this._autoFinal(st);
    }
    if (this.onState) this.onState(st);
  }

  _tick() {
    const s = this.state;
    if (!s || s.phase !== 'play') return;
    const now = this.now();
    // 宣言しっぱなしの放置を解除
    if (s.pending && s.pending.type === 'declare' && now > s.pending.until + (s.pending.by === this.uid ? 0 : 3000)) {
      this.store.update((cur) => R.actCancelDeclare(cur, this.uid, this.now(), true));
      return;
    }
    // 公開ボタンを押さないまま放置 → 自動公開
    const p = s.pending;
    if (p && p.responder === this.uid && MANUAL_TYPES.includes(p.type) && now > (p.at || now) + R.REVEAL_LIMIT_MS) this.reveal();
    if (p && p.type === 'effect' && p.by === this.uid && !this.isCpu && now > p.until) this.autoEffect();
    if (s.pending || !s.turnDeadline) return;
    // 手番側は即座に、相手側は少し待ってからタイムアウト処理（切断対策）
    const grace = s.turn === this.uid ? 0 : 4000;
    if (now > s.turnDeadline + grace) {
      this.store.update((cur) => R.actTimeout(cur, this.now()));
    }
  }

  _autoRespond(s) {
    const p = s.pending;
    if (!p || p.responder !== this.uid) return;
    if (this._respId === p.id) return;
    if (p.type === 'double_choose') return; // 人が選ぶ（CPUはcpu.jsで処理）
    // 人間同士のオンライン対戦では、情報の公開は本人がボタンで行う
    if (s.manualReveal && !this.isCpu && MANUAL_TYPES.includes(p.type)) return;
    this._respond(p, p.type === 'call' ? 350 : 500);
  }

  _respond(p, delay = 0) {
    const sec = this.secret;
    if (!sec) return;
    let result;
    switch (p.type) {
      case 'call': result = R.judge(sec, p.num); break;
      case 'highlow': result = R.highLowOf(sec); break;
      case 'slash': result = R.slashOf(sec); break;
      case 'target': result = R.targetOf(sec, p.digit); break;
      case 'double_reveal': result = sec[p.pos]; break;
      default: return;
    }
    this._respId = p.id;
    setTimeout(() => {
      this.store.update((cur) => R.resolvePending(cur, this.uid, p.id, result, this.now()))
        .then((ok) => { if (!ok && this.state && this.state.pending && this.state.pending.id === p.id) this._respId = null; });
    }, delay);
  }

  _autoFinal(s) {
    if (s.phase !== 'gameover') return;
    if (s.final[this.uid]) return;
    const key = s.game + ':' + (s.log.length ? s.log[s.log.length - 1].id : 0);
    if (this._finalSent === key) return;
    const sec = this.secret;
    if (!sec) return;
    this._finalSent = key;
    const cur = (s.secretVer && s.secretVer[this.uid]) || 0;
    const hist = [];
    for (let v = 0; v <= cur; v++) if (this.secrets[v] != null) hist.push(this.secrets[v]);
    this.store.update((st) => R.setFinal(st, this.uid, sec, hist));
  }

  // ---------------- actions ----------------

  async setup(number, items) {
    const s = this.state;
    if (!s) return false;
    this.secrets = { 0: number };
    this.secretGame = s.game;
    this._persist();
    return this.store.update((cur) => R.submitSetup(cur, this.uid, items, this.now()));
  }

  async unready() {
    return this.store.update((cur) => R.cancelSetup(cur, this.uid));
  }

  /** アイテムボタンを押す */
  async declare() {
    return this.store.update((cur) => R.actDeclare(cur, this.uid, this.now()));
  }

  async cancelDeclare() {
    return this.store.update((cur) => R.actCancelDeclare(cur, this.uid, this.now()));
  }

  async call(num) {
    return this.store.update((cur) => R.actCall(cur, this.uid, num, this.now()));
  }

  async attack(key, args) {
    return this.store.update((cur) => R.actAttack(cur, this.uid, key, args || {}, this.now()));
  }

  /** 防御アイテムを使う（効果は映像のあとで effect() で決める） */
  async defend(key) {
    return this.store.update((cur) => R.actDefense(cur, this.uid, key, {}, this.now()));
  }

  /** アイテムの効果を決める。SHUFFLE / CHANGE は新しい番号も渡す */
  async effect(args, newSecret) {
    const s = this.state;
    if (!s) return false;
    let ver = null;
    if (newSecret) {
      ver = ((s.secretVer && s.secretVer[this.uid]) || 0) + 1;
      this.secrets[ver] = newSecret;
    }
    const ok = await this.store.update((cur) => R.actEffect(cur, this.uid, args || {}, this.now()));
    if (ver != null) { if (!ok) delete this.secrets[ver]; else this._persist(); }
    return ok;
  }

  /** 制限時間内に効果を決めなかった場合の自動処理 */
  autoEffect() {
    const s = this.state, p = s && s.pending;
    if (!p || p.type !== 'effect' || p.by !== this.uid || this._autoEff === p.id) return;
    this._autoEff = p.id;
    const sec = this.secret;
    if (p.key === 'target') return this.effect({ digit: Math.floor(Math.random() * 10) });
    if (p.key === 'shuffle') return this.effect({}, sec);
    if (p.key === 'change') {
      const nums = R.allowedNums(s.settings, this.uid);
      for (let pos = 0; pos < sec.length; pos++) {
        const c = R.changeCandidates(sec, pos, nums);
        if (c.length) return this.effect({ pos, hl: R.hlOf(sec[pos]) }, sec.slice(0, pos) + c[0] + sec.slice(pos + 1));
      }
      return this.effect({ pos: 0, hl: R.hlOf(sec[0]) }, sec);
    }
  }

  /** 情報公開ボタン */
  reveal() {
    const p = this.state && this.state.pending;
    if (!p || p.responder !== this.uid || !MANUAL_TYPES.includes(p.type) || this._respId === p.id) return false;
    this._respond(p, 0);
    return true;
  }

  async chooseDouble(pos) {
    const p = this.state && this.state.pending;
    if (!p || p.type !== 'double_choose' || p.responder !== this.uid) return false;
    return this.store.update((cur) => R.resolvePending(cur, this.uid, p.id, pos, this.now()));
  }

  async next() {
    return this.store.update((cur) => R.actNext(cur, this.uid, this.now()));
  }

  async resign() {
    return this.store.update((cur) => R.actResign(cur, this.uid, this.now()));
  }
}

// =============================================================
//  Watcher：観戦者。指定した視点のプレイヤーの番号を（許可された範囲で）読む
// =============================================================
export class Watcher {
  constructor(store, uid, opts = {}) {
    this.store = store;
    this.uid = uid;
    this.isWatcher = true;
    this.onState = opts.onState || null;
    this.pickView = opts.pickView || ((s) => s.seats[Math.floor(Math.random() * 2)]);
    this.state = null;
    this.view = null;
    this.secretError = false;
    this.viewSecrets = {};
    this._unsubSecret = null;
    this._unsub = store.subscribe((s) => {
      this.state = s ? R.norm(JSON.parse(JSON.stringify(s))) : null;
      if (this.state && (!this.view || !this.state.seats.includes(this.view))) this._watch(this.pickView(this.state));
      if (this.onState) this.onState(this.state);
    });
  }
  _watch(view) {
    this.view = view;
    if (this._unsubSecret) this._unsubSecret();
    this.viewSecrets = {};
    if (this.store.watchSecret) {
      this._unsubSecret = this.store.watchSecret(view, (d, err) => {
        this.secretError = !!err;
        this.viewSecrets = (d && d.vers) ? Object.assign({}, d.vers) : {};
        if (this.onState && this.state) this.onState(this.state);
      });
    }
  }
  /** 視点プレイヤーを切り替える */
  setView(uid) {
    if (!this.state || !this.state.seats.includes(uid)) return;
    this._watch(uid);
    if (this.onState) this.onState(this.state);
  }
  destroy() { if (this._unsub) this._unsub(); if (this._unsubSecret) this._unsubSecret(); }
  now() { return this.store.now(); }
  get secret() {
    const s = this.state; if (!s || !this.view) return null;
    const v = (s.secretVer && s.secretVer[this.view]) || 0;
    if (this.viewSecrets[v] != null) return this.viewSecrets[v];
    const keys = Object.keys(this.viewSecrets).map(Number).sort((a, b) => b - a);
    return keys.length ? this.viewSecrets[keys[0]] : null;
  }
  async restoreSecret() {}
  async declare() { return false; } async cancelDeclare() { return false; } async effect() { return false; }
  async call() { return false; } async attack() { return false; } async defend() { return false; }
  async chooseDouble() { return false; } async next() { return false; } async resign() { return false; }
  async setup() { return false; } async unready() { return false; }
}
