// =============================================================
//  通信層：LocalStore（CPU戦） / FirebaseNet（オンライン）
// =============================================================
import { firebaseConfig } from './firebase-config.js';

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
  saveSecret(uid, d) { this._secrets[uid] = clean(d); }
  async loadSecret(uid) { return this._secrets[uid] || null; }
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
      players: { [this.uid]: { name, seat: 0, online: true, joinedAt: Date.now() } },
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
      if (ids.length >= 2) { reason = 'full'; return; }
      if (meta.status !== 'lobby') { reason = 'playing'; return; }
      const taken = ids.map((k) => meta.players[k].seat);
      meta.players[this.uid] = { name, seat: taken.includes(0) ? 1 : 0, online: true, joinedAt: Date.now() };
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
        if (!meta.players || !Object.keys(meta.players).length) return null;
        if (meta.host === this.uid) meta.host = Object.keys(meta.players)[0];
        if (meta.status === 'playing') meta.status = 'lobby';
        return meta;
      });
      await set(this.ref(`secrets/${code}/${this.uid}`), null);
    } catch (e) { console.warn(e); }
    this.code = null;
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
  async loadSecret(uid) {
    const snap = await this.net.m.get(this.net.ref(`secrets/${this.code}/${uid}`));
    return snap.val();
  }
}
