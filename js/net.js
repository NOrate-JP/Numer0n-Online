// =============================================================
//  通信層：LocalStore（CPU戦） / FirebaseNet（オンライン）
// =============================================================
import { firebaseConfig } from './firebase-config.js';
import { MAX_MEMBERS } from './rules.js';

const clean = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

// -------------------------------------------------------------
//  ローカル（CPU戦）
// -------------------------------------------------------------
export class LocalStore {
  constructor() {
    this.state = null;
    this.subs = new Set();
    this._secrets = {};
  }
  now() { return Date.now(); }
  subscribe(cb) {
    this.subs.add(cb);
    if (this.state) setTimeout(() => cb(this.state), 0);
    return () => this.subs.delete(cb);
  }
  async update(fn) {
    const cur = this.state ? clean(this.state) : null;
    const r = fn(cur);
    if (r === undefined) return false;
    this.state = clean(r);
    const snap = this.state;
    setTimeout(() => { for (const cb of this.subs) cb(snap); }, 0);
    return true;
  }
  saveSecret(uid, d) {
    this._secrets[uid] = clean(d);
    for (const w of this._secretWatch || []) if (w.uid === uid) setTimeout(() => w.cb(this._secrets[uid]), 0);
  }
  async loadSecret(uid) { return this._secrets[uid] || null; }
  watchSecret(uid, cb) {
    this._secretWatch = this._secretWatch || [];
    const w = { uid, cb }; this._secretWatch.push(w);
    setTimeout(() => cb(this._secrets[uid] || null), 0);
    return () => { this._secretWatch = this._secretWatch.filter((x) => x !== w); };
  }
}

// -------------------------------------------------------------
//  Firebase（Realtime Database + 匿名ログイン）
// -------------------------------------------------------------
const FB_VER = '10.12.2';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function firebaseConfigured() {
  return !!(firebaseConfig && firebaseConfig.apiKey && !/YOUR_|xxxx/i.test(firebaseConfig.apiKey) && firebaseConfig.databaseURL);
}

export class FirebaseNet {
  async init() {
    if (this.ready) return this;
    const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth.js`);
    const db = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-database.js`);
    this.m = db;
    this.app = appMod.initializeApp(firebaseConfig);
    this.auth = authMod.getAuth(this.app);
    this.db = db.getDatabase(this.app);
    await authMod.signInAnonymously(this.auth);
    this.uid = await new Promise((res) => {
      const un = authMod.onAuthStateChanged(this.auth, (u) => { if (u) { un(); res(u.uid); } });
    });
    this.offset = 0;
    db.onValue(db.ref(this.db, '.info/serverTimeOffset'), (snap) => { this.offset = snap.val() || 0; });
    this.ready = true;
    return this;
  }

  now() { return Date.now() + (this.offset || 0); }

  ref(path) { return this.m.ref(this.db, path); }

  async createRoom(name, settings) {
    const { get, set } = this.m;
    let code;
    for (let i = 0; i < 20; i++) {
      code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const snap = await get(this.ref(`rooms/${code}/meta`));
      if (!snap.exists()) break;
    }
    await set(this.ref(`rooms/${code}/meta`), {
      host: this.uid, createdAt: Date.now(), status: 'lobby', settings: clean(settings),
      players: { [this.uid]: { name, seat: 0, role: 'player', online: true, joinedAt: Date.now() } },
    });
    return code;
  }

  async joinRoom(code, name) {
    const { runTransaction } = this.m;
    code = code.toUpperCase().trim();
    let reason = 'notfound';
    const res = await runTransaction(this.ref(`rooms/${code}/meta`), (meta) => {
      if (!meta) { reason = 'notfound'; return meta; }
      meta.players = meta.players || {};
      if (meta.players[this.uid]) {
        meta.players[this.uid].name = name;
        meta.players[this.uid].online = true;
        return meta;
      }
      const ids = Object.keys(meta.players);
      if (ids.length >= MAX_MEMBERS) { reason = 'full'; return; }
      const playersNow = ids.filter((k) => (meta.players[k].role || 'player') === 'player');
      const taken = playersNow.map((k) => meta.players[k].seat);
      if (playersNow.length < 2 && meta.status === 'lobby') {
        meta.players[this.uid] = { name, seat: taken.includes(0) ? 1 : 0, role: 'player', online: true, joinedAt: Date.now() };
      } else {
        meta.players[this.uid] = { name, seat: -1, role: 'spectator', online: true, joinedAt: Date.now() };
      }
      return meta;
    });
    if (!res.committed || !res.snapshot.exists() || !res.snapshot.val().players || !res.snapshot.val().players[this.uid]) {
      throw new Error(reason);
    }
    return code;
  }

  /** ルームに入ったあと呼ぶ。meta購読・オンライン状態・stateストアを返す */
  enterRoom(code, onMeta) {
    const { onValue, onDisconnect, set } = this.m;
    this.code = code;
    const onlineRef = this.ref(`rooms/${code}/meta/players/${this.uid}/online`);
    set(onlineRef, true);
    onDisconnect(onlineRef).set(false);
    this._metaUnsub = onValue(this.ref(`rooms/${code}/meta`), (snap) => onMeta(snap.val()));
    this.store = new FirebaseStore(this, code);
    return this.store;
  }

  async leaveRoom() {
    const { set, runTransaction } = this.m;
    if (!this.code) return;
    const code = this.code;
    if (this._metaUnsub) this._metaUnsub();
    if (this.store) this.store.close();
    try {
      await runTransaction(this.ref(`rooms/${code}/meta`), (meta) => {
        if (!meta) return meta;
        if (meta.players) delete meta.players[this.uid];
        // ホストが抜けたらCPUも消す（CPUはホストの端末で動いているため）
        if (meta.host === this.uid && meta.players) for (const k of Object.keys(meta.players)) if (meta.players[k].cpu) delete meta.players[k];
        if (!meta.players || !Object.keys(meta.players).length) return null;
        if (meta.host === this.uid) meta.host = Object.keys(meta.players)[0];
        if (meta.status === 'playing') meta.status = 'lobby';
        return meta;
      });
      await set(this.ref(`secrets/${code}/${this.uid}`), null);
    } catch (e) { console.warn(e); }
    this.code = null;
  }

  /** ホスト用：CPUをプレイヤーとして追加 */
  async addCpu(level = 'normal') {
    return this.updateMeta((m) => {
      const ps = Object.values(m.players || {}).filter((v) => (v.role || 'player') === 'player');
      if (ps.length >= 2 || m.status !== 'lobby' || m.host !== this.uid) return m;
      const id = 'cpu_' + Math.random().toString(36).slice(2, 8);
      const label = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' }[level] || '';
      m.players[id] = { name: `CPU（${label}）`, role: 'player', seat: ps.some((v) => v.seat === 0) ? 1 : 0, cpu: true, level, online: true, joinedAt: Date.now() };
      return m;
    });
  }
  async removeMember(uid) {
    return this.updateMeta((m) => { if (m.players && m.players[uid] && m.players[uid].cpu) delete m.players[uid]; return m; });
  }

  /** 役割を変更（対戦 ⇔ 観戦）。対戦は最大2人 */
  async setRole(uid, role) {
    return this.updateMeta((m) => {
      const p = m.players && m.players[uid];
      if (!p || m.status !== 'lobby') return m;
      if (role === 'player') {
        const ps = Object.entries(m.players).filter(([k, v]) => k !== uid && (v.role || 'player') === 'player');
        if (ps.length >= 2) return m;
        p.role = 'player';
        p.seat = ps.some(([, v]) => v.seat === 0) ? 1 : 0;
      } else {
        p.role = 'spectator'; p.seat = -1;
      }
      return m;
    });
  }

  async updateMeta(fn) {
    const { runTransaction } = this.m;
    const r = await runTransaction(this.ref(`rooms/${this.code}/meta`), (m) => (m ? fn(m) : m));
    return r.committed;
  }
}

export class FirebaseStore {
  constructor(net, code) {
    this.net = net;
    this.code = code;
    this.subs = new Set();
    this.last = null;
    this.stateRef = net.ref(`rooms/${code}/state`);
    this._unsub = net.m.onValue(this.stateRef, (snap) => {
      this.last = snap.val();
      for (const cb of this.subs) cb(this.last);
    });
  }
  close() { if (this._unsub) this._unsub(); this.subs.clear(); }
  now() { return this.net.now(); }
  subscribe(cb) {
    this.subs.add(cb);
    if (this.last) setTimeout(() => cb(this.last), 0);
    return () => this.subs.delete(cb);
  }
  async update(fn) {
    try {
      const res = await this.net.m.runTransaction(this.stateRef, (cur) => {
        const r = fn(cur ? clean(cur) : null);
        if (r === undefined) return cur === null ? null : undefined;
        return clean(r);
      });
      return res.committed && res.snapshot.exists();
    } catch (e) {
      console.warn('transaction failed', e);
      return false;
    }
  }
  async reset(value) {
    await this.net.m.set(this.stateRef, value ? clean(value) : null);
  }
  saveSecret(uid, d) {
    this.net.m.set(this.net.ref(`secrets/${this.code}/${uid}`), clean(d)).catch((e) => console.warn(e));
  }
  watchSecret(uid, cb) {
    return this.net.m.onValue(this.net.ref(`secrets/${this.code}/${uid}`), (snap) => cb(snap.val()), (err) => { console.warn('secret read denied', err); cb(null, true); });
  }
  watchSecret(uid, cb) {
    return this.net.m.onValue(this.net.ref(`secrets/${this.code}/${uid}`), (snap) => cb(snap.val()), (err) => { console.warn('secret read denied', err); cb(null, true); });
  }
  async loadSecret(uid) {
    const snap = await this.net.m.get(this.net.ref(`secrets/${this.code}/${uid}`));
    return snap.val();
  }
}
