// =============================================================
//  CPU：候補を厳密に追跡して推理する
//   - cands   : 相手の番号の候補（自分の知識）
//   - oppView : 相手から見た自分の番号の候補（相手の知識の推定）
//  SHUFFLE / CHANGE も候補変換で正確に扱う
// =============================================================
import * as R from './rules.js';
import { Player } from './client.js';

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function perms(str) {
  if (str.length <= 1) return [str];
  const out = [];
  for (let i = 0; i < str.length; i++) {
    for (const p of perms(str.slice(0, i) + str.slice(i + 1))) out.push(str[i] + p);
  }
  return out;
}

function shuffleSet(cands) {
  const set = new Set();
  for (const c of cands) for (const p of perms(c)) set.add(p);
  return [...set];
}

function changeSet(cands, pos, hl, allowed) {
  const set = new Set();
  for (const c of cands) {
    if (R.hlOf(c[pos]) !== hl) continue;
    for (const d of R.changeCandidates(c, pos, allowed)) set.add(c.slice(0, pos) + d + c.slice(pos + 1));
  }
  return [...set];
}

function sample(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step + Math.random() * step)]);
  return out;
}

/** 情報の期待残り候補数（小さいほど良い） */
function expectedRemain(cands, keyFn) {
  const m = new Map();
  for (const c of cands) { const k = keyFn(c); m.set(k, (m.get(k) || 0) + 1); }
  let s = 0;
  for (const v of m.values()) s += v * v;
  return s / cands.length;
}

export class Knowledge {
  constructor(me, D, myNums, oppNums) {
    this.me = me;
    this.D = D;
    this.myNums = myNums || '0123456789';
    this.oppNums = oppNums || '0123456789';
    this.cands = R.allNumbers(D, this.oppNums);
    this.oppView = R.allNumbers(D, this.myNums);
    this.lastId = 0;
  }
  ingest(log) {
    for (const e of log) {
      if (e.id <= this.lastId) continue;
      this.lastId = e.id;
      const mine = e.by === this.me;
      const tgt = mine ? 'cands' : 'oppView';
      switch (e.type) {
        case 'call':
          this[tgt] = this[tgt].filter((c) => { const j = R.judge(c, e.num); return j.eat === e.eat && j.bite === e.bite; });
          break;
        case 'highlow':
          this[tgt] = this[tgt].filter((c) => (e.mode === 'v12' ? R.hlOf(c[e.pos]) : e.mode === 'v3' ? R.highLowCount(c) : R.highLowOf(c)) === e.result);
          break;
        case 'slash':
          this[tgt] = this[tgt].filter((c) => R.slashOf(c) === e.value);
          break;
        case 'target':
          this[tgt] = this[tgt].filter((c) => R.targetOf(c, e.digit) === e.pos);
          break;
        case 'double': {
          // e.by が自分の番号を開示した
          const t = mine ? 'oppView' : 'cands';
          this[t] = this[t].filter((c) => c[e.pos] === e.digit);
          break;
        }
        case 'effect': {
          const t = mine ? 'oppView' : 'cands'; // e.by の番号が変わった
          if (e.item === 'shuffle') this[t] = shuffleSet(this[t]);
          if (e.item === 'change') this[t] = changeSet(this[t], e.pos, e.hl, mine ? this.myNums : this.oppNums);
          break;
        }
      }
    }
    if (!this.cands.length) this.cands = R.allNumbers(this.D, this.oppNums); // 念のため
  }

  bestGuess(level) {
    const c = this.cands;
    if (level === 'easy' || c.length > 900) return rnd(c);
    if (c.length <= 2) return rnd(c);
    const pool = sample(c, level === 'hard' ? 260 : 80);
    const evalSet = sample(c, 900);
    let best = null, bestScore = Infinity;
    for (const g of pool) {
      const sc = expectedRemain(evalSet, (x) => { const j = R.judge(x, g); return j.eat * 10 + j.bite; });
      if (sc < bestScore - 1e-9 || (Math.abs(sc - bestScore) < 1e-9 && Math.random() < 0.5)) { bestScore = sc; best = g; }
    }
    return best || rnd(c);
  }
}

export class CpuAgent {
  constructor(store, uid, level = 'normal') {
    this.uid = uid;
    this.level = level;
    this.kn = null;
    this.busy = false;
    this.defTurn = -1;
    this.player = new Player(store, uid, { isCpu: true, onState: (s) => this.onState(s) });
    this._iv = setInterval(() => this.onState(this.player.state), 700);
  }
  destroy() { clearInterval(this._iv); this.player.destroy(); }

  onState(s) {
    if (!s) return;
    if (s.phase === 'setup') { this.kn = null; if (!(s.setup[this.uid] && s.setup[this.uid].ready)) this.doSetup(s); return; }
    if (s.phase === 'gameover') { this.doNext(s); return; }
    if (s.phase !== 'play') return;
    if (!this.kn || this.kn.game !== s.game) {
      this.kn = new Knowledge(this.uid, s.settings.digits, R.allowedNums(s.settings, this.uid), R.allowedNums(s.settings, R.other(s, this.uid)));
      this.kn.game = s.game;
    }
    this.kn.ingest(s.log);
    const now = this.player.now();
    const p = s.pending;
    if (p && p.type === 'double_choose' && p.responder === this.uid) { this.doDoubleChoose(s, p); return; }
    if (p && p.type === 'effect' && p.by === this.uid) { this.doEffect(p); return; }
    if (R.canAct(s, this.uid, now)) { this.doTurn(s); return; }
    if (R.canDefend(s, this.uid, now) && this.defTurn !== s.turnNo) { this.doDefense(s); }
  }

  async doSetup(s) {
    if (this.busy) return;
    this.busy = true;
    await sleep(1200 + Math.random() * 1500);
    const st = s.settings;
    const pool = R.allowedItems(st, this.uid);
    let pref = ['highlow', 'change', 'slash', 'shuffle', 'target', 'double', 'time'];
    if (this.level !== 'hard') pref = pref.slice(0, 6).sort(() => Math.random() - 0.5).concat(['time']);
    let items = [];
    for (const k of pref) {
      if (items.length >= st.equip) break;
      if (!pool.includes(k)) continue;
      if (st.noHLSlash && ((k === 'slash' && items.includes('highlow')) || (k === 'highlow' && items.includes('slash')))) continue;
      items.push(k);
    }
    const num = rnd(R.allNumbers(st.digits, R.allowedNums(st, this.uid)));
    await this.player.setup(num, items.slice(0, st.equip));
    this.busy = false;
  }

  async doNext(s) {
    if (this.busy || s.nextReady[this.uid]) return;
    this.busy = true;
    await sleep(2500);
    // マッチ終了時は人間側のリマッチを待つ（人間が押したら応じる）
    const cur = this.player.state;
    if (cur && cur.phase === 'gameover' && (!cur.matchOver || Object.keys(cur.nextReady).length)) await this.player.next();
    this.busy = false;
  }

  async doDoubleChoose(s, p) {
    if (this.busy) return;
    this.busy = true;
    await sleep(1500 + Math.random() * 1000);
    // 相手の番号のうち、自分にとって一番情報が得られる桁を開示させる
    const D = s.settings.digits;
    const revealed = s.reveals[p.by] || {};
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < D; i++) {
      if (revealed[i] != null) continue;
      // 自分のcandsではなく「相手の番号」候補が必要 → 開示するのは相手(p.by)の番号＝自分のcands
      const sc = expectedRemain(this.kn.cands, (c) => c[i]);
      if (sc < bestScore) { bestScore = sc; best = i; }
    }
    if (this.level === 'easy') best = Math.floor(Math.random() * D);
    await this.player.chooseDouble(best);
    this.busy = false;
  }

  async doTurn(s) {
    if (this.busy) return;
    this.busy = true;
    const turnNo = s.turnNo;
    await sleep(1600 + Math.random() * 2200);
    let cur = this.player.state;
    if (!cur || !R.canAct(cur, this.uid, this.player.now()) || cur.turnNo !== turnNo) { this.busy = false; return; }
    this.kn.ingest(cur.log);
    const n = this.kn.cands.length;
    const mine = cur.items[this.uid] || {};
    const has = (k) => mine[k] === 'unused' && R.usedCount(cur, this.uid) < R.useLimit(cur.settings);

    // ---- 攻撃アイテム ----
    if (!cur.attackUsed && !cur.itemsLocked) {
      let use = null, args = null;
      const useRate = this.level === 'easy' ? 0.15 : this.level === 'normal' ? 0.55 : 1;
      if (has('double') && n >= 2 && n <= (this.level === 'hard' ? 4 : 3)) use = 'double';
      else if (n > 6 && Math.random() < useRate) {
        let best = null, bestScore = n * (this.level === 'hard' ? 0.45 : 0.6);
        const c = this.kn.cands;
        if (has('highlow')) {
          const ver = cur.settings.hlVer;
          if (ver === 'v12') {
            for (let pos = 0; pos < cur.settings.digits; pos++) { const sc = expectedRemain(c, (x) => R.hlOf(x[pos])); if (sc < bestScore) { bestScore = sc; best = ['highlow', { pos }]; } }
          } else {
            const sc = expectedRemain(c, ver === 'v3' ? R.highLowCount : R.highLowOf); if (sc < bestScore) { bestScore = sc; best = ['highlow']; }
          }
        }
        if (has('slash')) { const sc = expectedRemain(c, R.slashOf); if (sc < bestScore) { bestScore = sc; best = ['slash']; } }
        if (has('target')) {
          for (let d = 0; d <= 9; d++) {
            const sc = expectedRemain(c, (x) => R.targetOf(x, d));
            if (sc < bestScore) { bestScore = sc; best = ['target', { digit: d }]; }
          }
        }
        if (best) { use = best[0]; args = best[1]; }
      }
      if (use && await this.player.declare()) {
        await sleep(1100 + Math.random() * 800);
        if (await this.player.attack(use)) this.effectPlan = { key: use, args };
        this.busy = false;
        return; // 結果を待ってから再度行動
      }
    }

    // ---- コール ----
    const g = this.kn.bestGuess(this.level);
    await this.player.call(g);
    this.busy = false;
  }

  async doDefense(s) {
    if (this.busy) return;
    this.defTurn = s.turnNo;
    const mine = s.items[this.uid] || {};
    const hasS = mine.shuffle === 'unused', hasC = mine.change === 'unused';
    if (R.usedCount(s, this.uid) >= R.useLimit(s.settings)) return;
    if (!hasS && !hasC) return;
    const view = this.kn.oppView;
    const th = this.level === 'hard' ? 10 : this.level === 'normal' ? 4 : 2;
    if (view.length > th) return;
    if (this.level === 'easy' && Math.random() < 0.5) return;
    this.busy = true;
    // ターン交代（判定表示の後）から少しあけて使う
    const base = s.turnStartAt || this.player.now();
    const wait = base + 1500 + Math.random() * 2000 - this.player.now();
    await sleep(Math.max(900, wait));
    const cur = this.player.state;
    if (!cur || !R.canDefend(cur, this.uid, this.player.now())) { this.busy = false; return; }
    const sec = this.player.secret;
    const D = cur.settings.digits;
    let plan = null, planSize = view.length * 2 - 1;
    if (hasS) {
      const sz = shuffleSet(view).length;
      if (sz > planSize) { planSize = sz; plan = { key: 'shuffle' }; }
    }
    if (hasC) {
      for (let pos = 0; pos < D; pos++) {
        const sz = changeSet(view, pos, R.hlOf(sec[pos]), this.kn.myNums).length;
        if (sz > planSize) { planSize = sz; plan = { key: 'change', pos }; }
      }
    }
    if (!plan) { this.busy = false; return; }
    if (!(await this.player.declare())) { this.busy = false; return; }
    await sleep(1000 + Math.random() * 700);
    if (plan.key === 'shuffle') {
      const ps = perms(sec).filter((p) => p !== sec);
      const ns = Math.random() < 0.1 ? sec : rnd(ps);
      if (await this.player.defend('shuffle')) this.effectPlan = { key: 'shuffle', args: {}, secret: ns };
    } else {
      const d = rnd(R.changeCandidates(sec, plan.pos, this.kn.myNums));
      const ns = sec.slice(0, plan.pos) + d + sec.slice(plan.pos + 1);
      if (await this.player.defend('change')) this.effectPlan = { key: 'change', args: { pos: plan.pos, hl: R.hlOf(sec[plan.pos]) }, secret: ns };
    }
    this.busy = false;
  }

  /** 映像が終わったらアイテムの効果を決める */
  async doEffect(p) {
    if (this._effId === p.id) return;
    this._effId = p.id;
    const wait = (p.from || this.player.now()) + 700 + Math.random() * 1200 - this.player.now();
    await sleep(Math.max(300, wait));
    const plan = this.effectPlan && this.effectPlan.key === p.key ? this.effectPlan : null;
    this.effectPlan = null;
    if (plan) await this.player.effect(plan.args, plan.secret);
    else this.player.autoEffect();
  }
}
