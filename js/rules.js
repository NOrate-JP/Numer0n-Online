// =============================================================
//  Numer0n ONLINE - ルールエンジン（純粋関数）
//  すべての状態遷移はここで行う。Firebase / ローカル共通。
// =============================================================

export const ITEM_DEFS = {
  double:  { key: 'double',  name: 'DOUBLE',   jp: 'ダブル',     kind: 'attack',  color: '#f08a1c',
    desc: 'このターン2回連続でコールできる。代償として自分の番号の1桁（どの桁かは相手が指定）を開示する。2回目のコール時はアイテム使用不可。' },
  highlow: { key: 'highlow', name: 'HIGH&LOW', jp: 'ハイ＆ロー', kind: 'attack',  color: '#d23a48',
    desc: '相手の番号の各桁が HIGH(5〜9) か LOW(0〜4) かを左から順に知ることができる。' },
  target:  { key: 'target',  name: 'TARGET',   jp: 'ターゲット', kind: 'attack',  color: '#8b4fd8',
    desc: '0〜9から数字を1つ指定。相手の番号に含まれていればその位置が、含まれていなければ「無い」ことがわかる。' },
  slash:   { key: 'slash',   name: 'SLASH',    jp: 'スラッシュ', kind: 'attack',  color: '#1f9a72',
    desc: '相手の番号の「最大の数字 − 最小の数字」（スラッシュナンバー）を知ることができる。' },
  time:    { key: 'time',    name: 'TIME',     jp: 'タイム',     kind: 'attack',  color: '#2c8fd6',
    desc: 'このターンの考慮時間を延長する。' },
  shuffle: { key: 'shuffle', name: 'SHUFFLE',  jp: 'シャッフル', kind: 'defense', color: '#36a24a',
    desc: '自分の番号のカードを並べ替える。並べ替えたと見せかけてそのままにするフェイントも可能。' },
  change:  { key: 'change',  name: 'CHANGE',   jp: 'チェンジ',   kind: 'defense', color: '#d8407e',
    desc: '自分の番号の1桁を、手持ちの同じ分類（HIGH同士・LOW同士）の数字と交換する。交換した桁とHIGH/LOWは相手に伝わる。' },
};
export const ITEM_ORDER = ['double', 'highlow', 'target', 'slash', 'time', 'shuffle', 'change'];

export const DEFAULT_SETTINGS = {
  digits: 3,            // 桁数 3/4/5
  equip: 3,             // 装備できるアイテム数
  pool: { double: true, highlow: true, target: true, slash: true, time: true, shuffle: true, change: true },
  noHLSlash: false,     // HIGH&LOW と SLASH の同時装備禁止（第11回ルール）
  turnSec: 90,          // 考慮時間（0 = 無制限）
  cooldownSec: 10,      // 相手のジャッジ後、攻撃側が行動できない時間（防御タイム）
  timeItemSec: 60,      // TIMEの延長秒数
  winsNeeded: 1,        // 何ゲーム先取
  finalChance: false,   // 先攻が当てたら後攻に最後の1ターン（同時なら引き分け）
};

export const ORDER_MS = 6800;       // 先攻決め演出の時間
export const REVEAL_MS = 4200;      // コール判定演出の最低時間
export const INFO_MS = 3000;        // アイテム結果演出の時間

export const hlOf = (d) => (Number(d) >= 5 ? 'H' : 'L');

export function judge(secret, call) {
  let eat = 0, bite = 0;
  for (let i = 0; i < call.length; i++) {
    if (secret[i] === call[i]) eat++;
    else if (secret.includes(call[i])) bite++;
  }
  return { eat, bite };
}

export function isValidNumber(str, digits) {
  return typeof str === 'string' && str.length === digits && /^\d+$/.test(str) && new Set(str).size === digits;
}

export function slashOf(num) {
  const ds = num.split('').map(Number);
  return Math.max(...ds) - Math.min(...ds);
}

export function highLowOf(num) {
  return num.split('').map(hlOf).join('');
}

export function targetOf(num, digit) {
  return num.indexOf(String(digit));
}

/** CHANGEで使える数字（同じHIGH/LOW・番号に含まれない） */
export function changeCandidates(num, pos) {
  const cls = hlOf(num[pos]);
  const out = [];
  for (let d = 0; d <= 9; d++) {
    const c = String(d);
    if (hlOf(d) === cls && !num.includes(c)) out.push(c);
  }
  return out;
}

export function posLabel(i, digits) {
  if (digits === 3) return ['百の位', '十の位', '一の位'][i];
  if (digits === 4) return ['千の位', '百の位', '十の位', '一の位'][i];
  return `左から${i + 1}番目`;
}

export function sanitizeSettings(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  s.pool = Object.assign({}, DEFAULT_SETTINGS.pool, (raw && raw.pool) || {});
  s.digits = [3, 4, 5].includes(+s.digits) ? +s.digits : 3;
  const poolCount = ITEM_ORDER.filter((k) => s.pool[k]).length;
  s.equip = Math.max(0, Math.min(+s.equip || 0, poolCount));
  s.turnSec = Math.max(0, +s.turnSec || 0);
  s.cooldownSec = Math.max(0, +s.cooldownSec || 0);
  s.timeItemSec = Math.max(10, +s.timeItemSec || 60);
  s.winsNeeded = Math.max(1, Math.min(5, +s.winsNeeded || 1));
  s.finalChance = !!s.finalChance;
  s.noHLSlash = !!s.noHLSlash;
  return s;
}

export function validateItems(items, settings) {
  if (!Array.isArray(items)) return false;
  if (items.length !== settings.equip) return false;
  if (new Set(items).size !== items.length) return false;
  if (!items.every((k) => ITEM_DEFS[k] && settings.pool[k])) return false;
  if (settings.noHLSlash && items.includes('highlow') && items.includes('slash')) return false;
  return true;
}

// -------------------------------------------------------------
//  状態ヘルパー
// -------------------------------------------------------------

/** Firebaseは空配列・空オブジェクトを消すので、読み込み後に補完する */
export function norm(s) {
  if (!s) return s;
  s.log = Array.isArray(s.log) ? s.log.filter(Boolean) : (s.log ? Object.values(s.log) : []);
  s.setup = s.setup || {};
  s.items = s.items || {};
  s.reveals = s.reveals || {};
  s.wins = s.wins || {};
  s.final = s.final || {};
  s.nextReady = s.nextReady || {};
  s.secretVer = s.secretVer || {};
  s.settings = sanitizeSettings(s.settings);
  for (const u of s.seats || []) {
    s.items[u] = s.items[u] || {};
    s.reveals[u] = s.reveals[u] || {};
    s.wins[u] = s.wins[u] || 0;
    s.secretVer[u] = s.secretVer[u] || 0;
  }
  if (s.pending === undefined) s.pending = null;
  return s;
}

export const other = (s, uid) => (s.seats[0] === uid ? s.seats[1] : s.seats[0]);

function nextId(s) { s.seq = (s.seq || 0) + 1; return s.seq; }

function pushLog(s, e, now) {
  e.id = nextId(s);
  e.t = now;
  e.game = s.game;
  s.log.push(e);
  return e;
}

export function canAct(s, uid, now) {
  return !!s && s.phase === 'play' && s.turn === uid && !s.pending && now >= s.cooldownUntil - 250;
}

export function canDefend(s, uid) {
  return !!s && s.phase === 'play' && s.turn !== uid && !s.pending && !s.defenseLocked && !s.defenseUsed;
}

// -------------------------------------------------------------
//  マッチ / ゲーム進行
// -------------------------------------------------------------

export function newMatch(seats, settings, now) {
  const s = {
    v: 1, seats: seats.slice(0, 2), settings: sanitizeSettings(settings),
    phase: 'setup', game: 1, seq: 0, wins: {}, setup: {}, log: [], createdAt: now,
  };
  return norm(s);
}

export function submitSetup(s, uid, items, now) {
  s = norm(s);
  if (!s || s.phase !== 'setup' || !s.seats.includes(uid)) return undefined;
  if (!validateItems(items, s.settings)) return undefined;
  s.setup[uid] = { ready: true, items: items.slice() };
  if (s.seats.every((u) => s.setup[u] && s.setup[u].ready)) startGame(s, now);
  return s;
}

export function cancelSetup(s, uid) {
  s = norm(s);
  if (!s || s.phase !== 'setup') return undefined;
  delete s.setup[uid];
  return s;
}

function startGame(s, now) {
  const a = Math.floor(Math.random() * 10);
  let b = Math.floor(Math.random() * 9);
  if (b >= a) b++;
  const [u0, u1] = s.seats;
  const first = a < b ? u0 : u1;
  s.order = { draws: { [u0]: a, [u1]: b }, first };
  s.items = {};
  for (const u of s.seats) {
    s.items[u] = {};
    for (const k of s.setup[u].items) s.items[u][k] = 'unused';
  }
  s.reveals = {}; s.final = {}; s.nextReady = {}; s.secretVer = {};
  s.result = null; s.finalChance = null; s.pending = null; s.matchOver = false;
  s.phase = 'play';
  s.turnNo = 0;
  s.log = [];
  s.startAt = now + ORDER_MS;
  pushLog(s, { type: 'start', first, draws: s.order.draws }, now);
  beginTurn(s, first, s.startAt, true);
  norm(s);
}

function beginTurn(s, uid, base, isFirst) {
  const st = s.settings;
  s.turn = uid;
  s.turnNo = (s.turnNo || 0) + 1;
  s.cooldownUntil = isFirst ? base : base + Math.max(st.cooldownSec * 1000, REVEAL_MS);
  s.turnDeadline = st.turnSec > 0 ? s.cooldownUntil + st.turnSec * 1000 : 0;
  s.callsLeft = 1;
  s.attackUsed = false;
  s.defenseUsed = false;
  s.defenseLocked = false;
  s.itemsLocked = false;
}

function endTurn(s, now) {
  if (s.finalChance && s.turn !== s.finalChance.hitter) {
    // 後攻のラストチャンスが外れた
    return finishGame(s, s.finalChance.hitter, 'hit', now);
  }
  beginTurn(s, other(s, s.turn), now, false);
  return s;
}

function onHit(s, by, now) {
  if (s.finalChance) return finishGame(s, null, 'draw', now);
  if (s.settings.finalChance && s.order && by === s.order.first) {
    s.finalChance = { hitter: by };
    pushLog(s, { type: 'finalchance', hitter: by }, now);
    beginTurn(s, other(s, by), now, false);
    return s;
  }
  return finishGame(s, by, 'hit', now);
}

function finishGame(s, winner, reason, now) {
  s.phase = 'gameover';
  s.pending = null;
  s.result = { winner: winner || null, reason };
  if (winner) s.wins[winner] = (s.wins[winner] || 0) + 1;
  s.matchOver = !!(winner && s.wins[winner] >= s.settings.winsNeeded);
  pushLog(s, { type: 'end', winner: winner || null, reason }, now);
  return s;
}

// -------------------------------------------------------------
//  プレイヤーのアクション（不正なら undefined を返す）
// -------------------------------------------------------------

export function actCall(s, uid, num, now) {
  s = norm(s);
  if (!canAct(s, uid, now) || !isValidNumber(num, s.settings.digits)) return undefined;
  s.pending = { id: nextId(s), type: 'call', by: uid, responder: other(s, uid), num, at: now };
  s.defenseLocked = true;
  return s;
}

export function actAttack(s, uid, key, args, now) {
  s = norm(s);
  const def = ITEM_DEFS[key];
  if (!def || def.kind !== 'attack') return undefined;
  if (!canAct(s, uid, now) || s.attackUsed || s.itemsLocked) return undefined;
  if (s.items[uid][key] !== 'unused') return undefined;
  if (key === 'target') {
    const d = Number(args && args.digit);
    if (!(d >= 0 && d <= 9)) return undefined;
  }
  s.items[uid][key] = 'used';
  s.attackUsed = true;
  s.defenseLocked = true;
  const opp = other(s, uid);
  const e = { type: 'item', by: uid, item: key };
  if (key === 'target') e.digit = Number(args.digit);
  if (key === 'time') e.sec = s.settings.timeItemSec;
  pushLog(s, e, now);
  switch (key) {
    case 'time':
      if (s.turnDeadline) s.turnDeadline += s.settings.timeItemSec * 1000;
      s.cooldownUntil = Math.max(s.cooldownUntil, now + 2200);
      break;
    case 'double':
      s.pending = { id: nextId(s), type: 'double_choose', by: uid, responder: opp, at: now };
      break;
    case 'highlow':
    case 'slash':
      s.pending = { id: nextId(s), type: key, by: uid, responder: opp, at: now };
      break;
    case 'target':
      s.pending = { id: nextId(s), type: 'target', by: uid, responder: opp, digit: Number(args.digit), at: now };
      break;
  }
  return s;
}

/** 防御アイテム。info: change → { pos, hl } */
export function actDefense(s, uid, key, info, now) {
  s = norm(s);
  const def = ITEM_DEFS[key];
  if (!def || def.kind !== 'defense') return undefined;
  if (!canDefend(s, uid)) return undefined;
  if (s.items[uid][key] !== 'unused') return undefined;
  const e = { type: 'item', by: uid, item: key };
  if (key === 'change') {
    const pos = Number(info && info.pos);
    if (!(pos >= 0 && pos < s.settings.digits)) return undefined;
    if (!info || (info.hl !== 'H' && info.hl !== 'L')) return undefined;
    e.pos = pos; e.hl = info.hl;
    delete s.reveals[uid][pos];
  } else {
    s.reveals[uid] = {};
  }
  s.items[uid][key] = 'used';
  s.defenseUsed = true;
  s.secretVer[uid] = (s.secretVer[uid] || 0) + 1;
  pushLog(s, e, now);
  // 演出時間ぶん攻撃側の行動を待たせる
  s.cooldownUntil = Math.max(s.cooldownUntil, now + 2600);
  if (s.turnDeadline) s.turnDeadline = Math.max(s.turnDeadline, s.cooldownUntil + 5000);
  return s;
}

/** 防御側（または開示側）の自動応答 */
export function resolvePending(s, uid, pid, result, now) {
  s = norm(s);
  const p = s.pending;
  if (!p || p.id !== pid || p.responder !== uid) return undefined;
  const D = s.settings.digits;
  if (s.turnDeadline && p.type !== 'call') s.turnDeadline += Math.max(0, now - (p.at || now)) + INFO_MS;

  switch (p.type) {
    case 'call': {
      const { eat, bite } = result;
      s.pending = null;
      pushLog(s, { type: 'call', by: p.by, num: p.num, eat, bite }, now);
      if (eat === D) return onHit(s, p.by, now);
      s.callsLeft = (s.callsLeft || 1) - 1;
      if (s.callsLeft > 0) {
        s.itemsLocked = true;
        s.cooldownUntil = now + REVEAL_MS;
        if (s.turnDeadline) s.turnDeadline += REVEAL_MS;
        return s;
      }
      return endTurn(s, now);
    }
    case 'highlow':
      s.pending = null;
      pushLog(s, { type: 'highlow', by: p.by, result: String(result) }, now);
      break;
    case 'slash':
      s.pending = null;
      pushLog(s, { type: 'slash', by: p.by, value: Number(result) }, now);
      break;
    case 'target':
      s.pending = null;
      pushLog(s, { type: 'target', by: p.by, digit: p.digit, pos: Number(result) }, now);
      break;
    case 'double_choose': {
      const pos = Number(result);
      if (!(pos >= 0 && pos < D)) return undefined;
      // 開示するのはDOUBLEを使った本人
      s.pending = { id: nextId(s), type: 'double_reveal', by: p.by, responder: p.by, pos, at: now };
      return s;
    }
    case 'double_reveal':
      s.pending = null;
      s.reveals[p.by][p.pos] = String(result);
      pushLog(s, { type: 'double', by: p.by, pos: p.pos, digit: String(result) }, now);
      s.callsLeft = 2;
      break;
    default:
      return undefined;
  }
  s.cooldownUntil = Math.max(s.cooldownUntil, now + INFO_MS);
  return s;
}

export function actTimeout(s, now) {
  s = norm(s);
  if (!s || s.phase !== 'play' || s.pending || !s.turnDeadline || now < s.turnDeadline) return undefined;
  pushLog(s, { type: 'timeout', by: s.turn }, now);
  return endTurn(s, now);
}

export function actResign(s, uid, now) {
  s = norm(s);
  if (!s || s.phase !== 'play' || !s.seats.includes(uid)) return undefined;
  pushLog(s, { type: 'resign', by: uid }, now);
  return finishGame(s, other(s, uid), 'resign', now);
}

export function setFinal(s, uid, num) {
  s = norm(s);
  if (!s || s.phase !== 'gameover' || s.final[uid]) return undefined;
  s.final[uid] = num;
  return s;
}

export function actNext(s, uid, now) {
  s = norm(s);
  if (!s || s.phase !== 'gameover') return undefined;
  s.nextReady[uid] = true;
  if (s.seats.every((u) => s.nextReady[u])) {
    if (s.matchOver) {
      for (const u of s.seats) s.wins[u] = 0;
      s.game = 0;
    }
    s.game = (s.game || 0) + 1;
    s.phase = 'setup';
    s.setup = {}; s.log = []; s.nextReady = {}; s.pending = null;
    s.result = null; s.order = null; s.finalChance = null; s.matchOver = false;
    s.items = {}; s.reveals = {}; s.final = {}; s.secretVer = {};
  }
  return norm(s);
}

/** ログ1件分の情報が、ある番号候補と矛盾しないか（CPU・候補計算用） */
export function allNumbers(D) {
  const out = [];
  const rec = (pre, used) => {
    if (pre.length === D) { out.push(pre); return; }
    for (let d = 0; d <= 9; d++) {
      if (used & (1 << d)) continue;
      rec(pre + d, used | (1 << d));
    }
  };
  rec('', 0);
  return out;
}
