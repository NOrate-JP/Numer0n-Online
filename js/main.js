// =============================================================
//  Numer0n ONLINE - メイン（画面遷移・HUD・演出）
// =============================================================
import * as R from './rules.js';
import { Player } from './client.js';
import { CpuAgent } from './cpu.js';
import { LocalStore, FirebaseNet, firebaseConfigured } from './net.js';
import { Sound } from './sound.js';
import { Memo } from './memo.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setHTML = (el, html) => { if (el && el._h !== html) { el.innerHTML = html; el._h = html; return true; } return false; };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// -------------------------------------------------------------
//  アセット
// -------------------------------------------------------------
const ASSET = {
  card: (d) => `assets/cards/${d}.png`,
  back: 'assets/cards/back.png',
  item: (k) => `assets/items/${k}.png`,
  memo: 'assets/memo_bg.png',
  logo: 'assets/logo.png',
};
const OK = {}; // url -> true/false
function probe(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { OK[url] = true; res(img); };
    img.onerror = () => { OK[url] = false; res(null); };
    img.src = url;
  });
}
async function preloadAssets() {
  const list = [ASSET.back, ASSET.memo, ASSET.logo];
  for (let d = 0; d <= 9; d++) list.push(ASSET.card(d));
  for (const k of R.ITEM_ORDER) list.push(ASSET.item(k));
  const imgs = await Promise.all(list.map(probe));
  return imgs[2];
}

const ITEM_GLYPH = { double: '×2', highlow: 'H/L', target: '◎', slash: '⟋', time: '⏱', shuffle: 'S', change: '⇄' };

function cardHTML(d, cls = '') {
  if (d == null || d === '?') {
    return OK[ASSET.back]
      ? `<div class="card back img ${cls}" style="background-image:url(${ASSET.back})"></div>`
      : `<div class="card back ${cls}"><span>N</span></div>`;
  }
  const u = ASSET.card(d);
  return OK[u]
    ? `<div class="card img ${cls}" data-d="${d}" style="background-image:url(${u})"></div>`
    : `<div class="card ${cls}" data-d="${d}"><b>${d}</b><small>Numer0n</small></div>`;
}
function itemHTML(k, cls = '', extra = '') {
  const def = R.ITEM_DEFS[k];
  const u = ASSET.item(k);
  const inner = OK[u] ? `<img src="${u}" alt="">` : `<span class="glyph">${ITEM_GLYPH[k]}</span>`;
  return `<div class="item ${def.kind} ${cls} ${OK[u] ? 'has-img' : ''}" data-item="${k}" style="--ic:${def.color}" ${extra}>${inner}</div>`;
}
const itemName = (k) => R.ITEM_DEFS[k].name;

// -------------------------------------------------------------
//  アプリ状態
// -------------------------------------------------------------
const sound = new Sound();
let studio = null;
let memo = null;

const app = {
  mode: null,          // 'local' | 'online'
  name: localStorage.getItem('numer0n_name') || 'PLAYER',
  cpuLevel: localStorage.getItem('numer0n_cpu') || 'normal',
  settings: R.sanitizeSettings(JSON.parse(localStorage.getItem('numer0n_settings') || 'null')),
  net: null, code: null, meta: null,
  store: null, player: null, cpu: null,
  me: null, opp: null, names: {},
  state: null,
  input: '',
  screen: null,
};

function saveSettings() { localStorage.setItem('numer0n_settings', JSON.stringify(app.settings)); }

// -------------------------------------------------------------
//  画面切り替え・共通UI
// -------------------------------------------------------------
function show(id) {
  app.screen = id;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.dataset.screen = id;
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  const el = document.createElement('div');
  el.className = 'toast-item'; el.textContent = msg;
  t.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 500);
}

let modalCtx = null;
function openModal({ title, body, buttons = [], cls = '', tag = null, onClose = null, dismissable = true }) {
  closeModal();
  const m = $('#modal');
  m.className = 'show ' + cls;
  m.innerHTML = `<div class="modal-box">
    ${title ? `<div class="modal-title">${title}</div>` : ''}
    <div class="modal-body"></div>
    <div class="modal-btns"></div></div>`;
  const b = $('.modal-body', m);
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  const bb = $('.modal-btns', m);
  for (const btn of buttons) {
    const e = document.createElement('button');
    e.className = 'btn ' + (btn.cls || '');
    e.innerHTML = btn.label;
    if (btn.id) e.id = btn.id;
    e.onclick = async () => {
      sound.play('click');
      const r = btn.onClick ? await btn.onClick() : null;
      if (r !== false && btn.close !== false) closeModal();
    };
    bb.appendChild(e);
  }
  if (dismissable) m.onclick = (ev) => { if (ev.target === m) closeModal(); };
  else m.onclick = null;
  modalCtx = { tag, onClose };
  return m;
}
function closeModal() {
  const m = $('#modal');
  m.className = ''; m.innerHTML = '';
  const c = modalCtx; modalCtx = null;
  if (c && c.onClose) c.onClose();
}

function bindSfx(root = document) {
  $$('button, .tile', root).forEach((b) => {
    if (b._sfx) return; b._sfx = true;
    b.addEventListener('pointerenter', () => sound.play('hover'));
    b.addEventListener('click', () => sound.play('click'));
  });
}

// -------------------------------------------------------------
//  タイトル / メニュー
// -------------------------------------------------------------
function goTitle() {
  leaveSession();
  show('scr-title');
  if (studio) { studio.setShot('title'); studio.setOpponent(null); studio.setMonitor({ mode: 'logo' }); studio.setCelebrate(false); }
  sound.bgm('bgm_title');
}

function goMenu() {
  leaveSession();
  show('scr-menu');
  $('#name-input').value = app.name;
  if (studio) { studio.setShot('wide'); studio.setOpponent(null); studio.setMonitor({ mode: 'logo' }); studio.setCelebrate(false); }
  sound.bgm('bgm_title');
  const last = JSON.parse(localStorage.getItem('numer0n_last') || 'null');
  $('#btn-rejoin').classList.toggle('hidden', !(last && last.code && firebaseConfigured()));
  if (last) $('#btn-rejoin').querySelector('small').textContent = `ROOM ${last.code}`;
}

function setName() {
  const v = ($('#name-input').value || '').trim().slice(0, 12) || 'PLAYER';
  app.name = v;
  localStorage.setItem('numer0n_name', v);
  return v;
}

// -------------------------------------------------------------
//  ロビー（ローカル / オンライン共通）
// -------------------------------------------------------------
function goLocalLobby() {
  setName();
  leaveSession();
  app.mode = 'local';
  app.me = 'me'; app.opp = 'cpu';
  app.names = { me: app.name, cpu: 'CPU' };
  show('scr-lobby');
  renderLobby();
  if (studio) studio.setShot('high');
}

async function ensureNet() {
  if (!firebaseConfigured()) {
    openModal({
      title: 'オンライン設定が必要です',
      body: `<p>js/firebase-config.js に Firebase の設定を書き込んでください。<br>（README.md に手順があります）</p><p>CPU対戦はこのままで遊べます。</p>`,
      buttons: [{ label: 'OK', cls: 'primary' }],
    });
    return null;
  }
  if (!app.net) {
    const n = new FirebaseNet();
    try {
      toast('サーバーに接続中…', 1500);
      await n.init();
      app.net = n;
    } catch (e) {
      console.error(e);
      openModal({ title: '接続エラー', body: `<p>Firebaseに接続できませんでした。</p><pre class="err">${esc(e.message || e)}</pre>`, buttons: [{ label: 'OK' }] });
      return null;
    }
  }
  return app.net;
}

async function createRoom() {
  setName();
  const net = await ensureNet(); if (!net) return;
  try {
    const code = await net.createRoom(app.name, app.settings);
    enterOnlineRoom(code);
  } catch (e) { console.error(e); toast('ルームを作れませんでした: ' + e.message); }
}

async function joinRoom(code) {
  setName();
  if (!code) { toast('ルームコードを入力してください'); return; }
  const net = await ensureNet(); if (!net) return;
  try {
    code = await net.joinRoom(code, app.name);
    enterOnlineRoom(code);
  } catch (e) {
    const msg = { notfound: 'ルームが見つかりません', full: 'ルームが満員です', playing: 'ゲーム中のため参加できません' }[e.message] || ('参加できませんでした: ' + e.message);
    toast(msg, 3000);
  }
}

function enterOnlineRoom(code) {
  leaveSession();
  app.mode = 'online';
  app.code = code;
  app.me = app.net.uid;
  localStorage.setItem('numer0n_last', JSON.stringify({ code }));
  app.store = app.net.enterRoom(code, onMeta);
  app.store.subscribe((s) => onStoreState(s));
  show('scr-lobby');
  if (studio) studio.setShot('high');
  renderLobby();
}

function onMeta(meta) {
  if (!meta) {
    if (app.mode === 'online') { toast('ルームが閉じられました'); localStorage.removeItem('numer0n_last'); goMenu(); }
    return;
  }
  if (!meta.players || !meta.players[app.me]) {
    if (app.mode === 'online') { toast('ルームから退出しました'); goMenu(); }
    return;
  }
  app.meta = meta;
  app.names = {};
  for (const [u, p] of Object.entries(meta.players || {})) app.names[u] = p.name;
  const others = Object.keys(meta.players).filter((u) => u !== app.me);
  app.opp = others[0] || null;
  if (meta.settings) app.settings = R.sanitizeSettings(meta.settings);
  if (app.screen === 'scr-lobby') renderLobby();
  if (app.state) { renderGame(); }
  // 相手の接続状態
  const op = app.opp && meta.players[app.opp];
  document.body.classList.toggle('opp-offline', !!(op && op.online === false));
}

/** オンラインでstateが変わった（Player生成前の最初のstate） */
function onStoreState(s) {
  if (app.mode !== 'online') return;
  if (s && !app.player) startSession();
  if (!s && app.player) {
    // ロビーに戻った
    app.player.destroy(); app.player = null; app.state = null;
    director.reset();
    closeModal(); hideResult();
    show('scr-lobby'); renderLobby();
    if (studio) { studio.setShot('high'); studio.setOpponent(null); studio.setCelebrate(false); studio.setMonitor({ mode: 'logo' }); }
    sound.bgm('bgm_title');
  }
}

function isHost() { return app.mode === 'local' || (app.meta && app.meta.host === app.me); }

const SET_OPTS = {
  digits: [[3, '3桁'], [4, '4桁'], [5, '5桁']],
  equip: [[0, 'なし'], [1, '1個'], [2, '2個'], [3, '3個'], [4, '4個'], [5, '5個'], [6, '6個'], [7, '7個']],
  turnSec: [[0, '無制限'], [60, '60秒'], [90, '90秒'], [120, '120秒'], [180, '180秒']],
  cooldownSec: [[0, 'なし'], [3, '3秒'], [5, '5秒'], [10, '10秒']],
  timeItemSec: [[30, '+30秒'], [60, '+60秒'], [120, '+120秒'], [180, '+180秒']],
  winsNeeded: [[1, '1本勝負'], [2, '2本先取'], [3, '3本先取']],
};

function renderLobby() {
  const host = isHost();
  const st = app.settings;
  const players = app.mode === 'local'
    ? [{ u: 'me', name: app.name, online: true, host: true }, { u: 'cpu', name: 'CPU', online: true, cpu: true }]
    : Object.entries((app.meta && app.meta.players) || {}).sort((a, b) => a[1].seat - b[1].seat).map(([u, p]) => ({ u, name: p.name, online: p.online !== false, host: app.meta.host === u }));
  const sel = (key) => `<select data-set="${key}" ${host ? '' : 'disabled'}>${SET_OPTS[key].map(([v, l]) => `<option value="${v}" ${+st[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const canStart = host && players.length === 2;
  $('#lobby').innerHTML = `
    <div class="panel lobby-left">
      <div class="panel-head">${app.mode === 'local' ? 'SINGLE PLAY' : 'ONLINE ROOM'}</div>
      ${app.mode === 'online' ? `<div class="room-code"><small>ROOM CODE</small><b>${esc(app.code)}</b><button class="btn small" id="btn-copy">コピー</button></div>` : ''}
      <div class="players">
        ${[0, 1].map((i) => {
          const p = players[i];
          if (!p) return `<div class="pslot empty"><span class="blink">対戦相手を待っています…</span></div>`;
          return `<div class="pslot ${p.u === app.me ? 'me' : ''}"><div class="pavatar">${p.cpu ? 'CPU' : 'P' + (i + 1)}</div>
            <div class="pname">${esc(p.name)}${p.host ? ' <em>HOST</em>' : ''}${p.u === app.me ? ' <em class="you">YOU</em>' : ''}</div>
            <div class="pstat ${p.online ? 'on' : 'off'}">${p.online ? 'ONLINE' : 'OFFLINE'}</div></div>`;
        }).join('<div class="vs-mini">VS</div>')}
      </div>
      ${app.mode === 'local' ? `<label class="row">CPUの強さ <select id="cpu-level">
        <option value="easy" ${app.cpuLevel === 'easy' ? 'selected' : ''}>やさしい</option>
        <option value="normal" ${app.cpuLevel === 'normal' ? 'selected' : ''}>ふつう</option>
        <option value="hard" ${app.cpuLevel === 'hard' ? 'selected' : ''}>つよい</option></select></label>` : ''}
      <div class="lobby-btns">
        <button class="btn ghost" id="btn-lobby-back">もどる</button>
        <button class="btn primary big" id="btn-start" ${canStart ? '' : 'disabled'}>${host ? 'GAME START' : 'ホストの開始待ち'}</button>
      </div>
    </div>
    <div class="panel lobby-right">
      <div class="panel-head">RULE SETTING ${host ? '' : '<small>（ホストのみ変更可）</small>'}</div>
      <div class="set-grid">
        <label>桁数 ${sel('digits')}</label>
        <label>勝敗 ${sel('winsNeeded')}</label>
        <label>考慮時間 ${sel('turnSec')}</label>
        <label>防御タイム ${sel('cooldownSec')}</label>
        <label>装備アイテム数 ${sel('equip')}</label>
        <label>TIMEの延長 ${sel('timeItemSec')}</label>
      </div>
      <div class="set-sub">使用できるアイテム</div>
      <div class="pool">
        ${R.ITEM_ORDER.map((k) => `<label class="pool-item ${st.pool[k] ? 'on' : ''}">${itemHTML(k, 'sm')}<input type="checkbox" data-pool="${k}" ${st.pool[k] ? 'checked' : ''} ${host ? '' : 'disabled'}><span>${itemName(k)}<small>${R.ITEM_DEFS[k].kind === 'attack' ? '攻撃' : '防御'}</small></span></label>`).join('')}
      </div>
      <label class="chk"><input type="checkbox" data-flag="noHLSlash" ${st.noHLSlash ? 'checked' : ''} ${host ? '' : 'disabled'}> HIGH&amp;LOW と SLASH の同時装備を禁止</label>
      <label class="chk"><input type="checkbox" data-flag="finalChance" ${st.finalChance ? 'checked' : ''} ${host ? '' : 'disabled'}> 先攻が当てたら後攻にラストチャンス（当て返せば引き分け）</label>
      <p class="note">※「防御タイム」：相手のジャッジ後、攻撃側がコールやアイテム使用をできない時間（番組は10秒）。その間に防御アイテムを使えます。</p>
    </div>`;
  bindSfx($('#lobby'));
  $$('#lobby select[data-set]').forEach((e) => e.onchange = () => { app.settings[e.dataset.set] = +e.value; commitSettings(); });
  $$('#lobby input[data-pool]').forEach((e) => e.onchange = () => { app.settings.pool[e.dataset.pool] = e.checked; commitSettings(); });
  $$('#lobby input[data-flag]').forEach((e) => e.onchange = () => { app.settings[e.dataset.flag] = e.checked; commitSettings(); });
  const lv = $('#cpu-level'); if (lv) lv.onchange = () => { app.cpuLevel = lv.value; localStorage.setItem('numer0n_cpu', lv.value); };
  const cp = $('#btn-copy'); if (cp) cp.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(app.code); toast('コピーしました'); };
  $('#btn-lobby-back').onclick = async () => {
    if (app.mode === 'online') { localStorage.removeItem('numer0n_last'); await app.net.leaveRoom(); }
    goMenu();
  };
  $('#btn-start').onclick = startMatch;
}

function commitSettings() {
  app.settings = R.sanitizeSettings(app.settings);
  saveSettings();
  if (app.mode === 'online' && isHost()) app.net.updateMeta((m) => { m.settings = JSON.parse(JSON.stringify(app.settings)); return m; });
  renderLobby();
}

async function startMatch() {
  if (!isHost()) return;
  app.settings = R.sanitizeSettings(app.settings);
  if (app.mode === 'local') {
    app.store = new LocalStore();
    startSession();
    app.cpu = new CpuAgent(app.store, 'cpu', app.cpuLevel);
    await app.store.update(() => R.newMatch(['me', 'cpu'], app.settings, Date.now()));
  } else {
    if (!app.opp) return;
    const seats = Object.entries(app.meta.players).sort((a, b) => a[1].seat - b[1].seat).map(([u]) => u);
    await app.store.reset(R.newMatch(seats, app.settings, app.net.now()));
    await app.net.updateMeta((m) => { m.status = 'playing'; return m; });
  }
}

// -------------------------------------------------------------
//  セッション（Player）
// -------------------------------------------------------------
function startSession() {
  if (app.player) return;
  director.reset();
  app.player = new Player(app.store, app.me, { onState: onGameState });
  if (app.mode === 'online') app.player.restoreSecret();
}

function leaveSession() {
  if (app.cpu) { app.cpu.destroy(); app.cpu = null; }
  if (app.player) { app.player.destroy(); app.player = null; }
  if (app.mode === 'online' && app.net && app.code) {
    // ロビー画面を離れずに状態だけリセットしたいときは別関数
  }
  app.state = null;
  app.input = '';
  director.reset();
  closeModal(); hideResult();
  $('#cutin').innerHTML = '';
}

let lastPhaseKey = null;
function onGameState(s) {
  app.state = s;
  if (!s) return;
  if (!app.opp) app.opp = R.other(s, app.me);
  const key = s.phase + ':' + s.game + ':' + s.createdAt;
  if (key !== lastPhaseKey) {
    lastPhaseKey = key;
    if (s.phase === 'setup') enterSetup();
    else if (s.phase === 'play' || s.phase === 'gameover') enterGame();
  }
  if (s.phase === 'setup') renderSetup();
  else { director.feed(s); renderGame(); checkPendingPrompts(); }
}

// -------------------------------------------------------------
//  準備画面（アイテム選択・番号設定）
// -------------------------------------------------------------
const setupSel = { items: [], num: '' };

function enterSetup() {
  hideResult(); closeModal();
  $('#cutin').innerHTML = '';
  show('scr-setup');
  setupSel.items = [];
  setupSel.num = '';
  app.input = '';
  if (studio) {
    studio.setShot('seat', 1.6);
    studio.setOpponent(app.names[app.opp] || 'OPPONENT');
    studio.setCelebrate(false);
    studio.setMonitor({ mode: 'text', big: `GAME ${app.state.game}`, small: 'セッティング中…' });
    studio.setConsole('SETTING');
  }
  sound.bgm('bgm_title');
  // デフォルトのアイテム選択（前回と同じ）
  const prev = JSON.parse(localStorage.getItem('numer0n_items') || 'null') || ['highlow', 'target', 'shuffle', 'change', 'double', 'slash', 'time'];
  const st = app.state.settings;
  for (const k of prev) if (setupSel.items.length < st.equip && st.pool[k] && R.ITEM_DEFS[k]) setupSel.items.push(k);
  if (!R.validateItems(setupSel.items, st) && st.noHLSlash && setupSel.items.includes('highlow') && setupSel.items.includes('slash')) setupSel.items = setupSel.items.filter((k) => k !== 'slash');
  for (const k of R.ITEM_ORDER) { if (setupSel.items.length >= st.equip) break; if (!st.pool[k] || setupSel.items.includes(k)) continue; if (st.noHLSlash && ((k === 'slash' && setupSel.items.includes('highlow')) || (k === 'highlow' && setupSel.items.includes('slash')))) continue; setupSel.items.push(k); }
  renderSetup(true);
}

function renderSetup(force) {
  const s = app.state; if (!s || s.phase !== 'setup') return;
  const st = s.settings;
  const D = st.digits;
  const ready = !!(s.setup[app.me] && s.setup[app.me].ready);
  const oppReady = !!(s.setup[app.opp] && s.setup[app.opp].ready);
  const root = $('#setup');
  const sig = JSON.stringify([ready, oppReady, setupSel, s.game]);
  if (!force && root._sig === sig) return;
  root._sig = sig;
  const itemsOk = R.validateItems(setupSel.items, st);
  const numOk = R.isValidNumber(setupSel.num, D);
  const conflict = st.noHLSlash && setupSel.items.includes('highlow') && setupSel.items.includes('slash');
  root.innerHTML = `
    <div class="setup-head">
      <div class="game-no">GAME ${s.game}</div>
      <div class="rule-sum">${D}桁 ／ ${st.winsNeeded === 1 ? '1本勝負' : st.winsNeeded + '本先取'} ／ 考慮${st.turnSec ? st.turnSec + '秒' : '無制限'} ／ アイテム${st.equip}個</div>
      <div class="score-sum">${esc(app.names[app.me])} <b>${s.wins[app.me] || 0}</b> - <b>${s.wins[app.opp] || 0}</b> ${esc(app.names[app.opp])}</div>
    </div>
    <div class="setup-body ${ready ? 'locked' : ''}">
      <div class="panel setup-items">
        <div class="panel-head">ITEM SELECT <span class="cnt ${setupSel.items.length === st.equip ? 'ok' : ''}">${setupSel.items.length} / ${st.equip}</span></div>
        ${st.equip === 0 ? '<p class="note">このルールではアイテムを使いません</p>' : ''}
        <div class="item-grid">
          ${R.ITEM_ORDER.filter((k) => st.pool[k]).map((k) => {
            const on = setupSel.items.includes(k);
            const d = R.ITEM_DEFS[k];
            return `<button class="item-card ${on ? 'on' : ''} ${d.kind}" data-pick="${k}" style="--ic:${d.color}">
              ${itemHTML(k)}<div class="ic-name">${d.name}<small>${d.kind === 'attack' ? '攻撃アイテム' : '防御アイテム'}</small></div>
              <div class="ic-desc">${d.desc}</div>${on ? `<i class="ic-no">${setupSel.items.indexOf(k) + 1}</i>` : ''}</button>`;
          }).join('')}
        </div>
        ${conflict ? '<p class="warn">HIGH&amp;LOW と SLASH は同時に装備できません</p>' : ''}
      </div>
      <div class="panel setup-num">
        <div class="panel-head">NUMBER SET <small>同じ数字は使えません</small></div>
        <div class="num-slots">${Array.from({ length: D }, (_, i) => setupSel.num[i] != null ? cardHTML(setupSel.num[i], 'slot filled') : '<div class="card slot empty"></div>').join('')}</div>
        <div class="num-pick">${Array.from({ length: 10 }, (_, d) => `<button class="pick" data-d="${d}" ${setupSel.num.includes(String(d)) || setupSel.num.length >= D ? 'disabled' : ''}>${cardHTML(d)}</button>`).join('')}</div>
        <div class="num-btns">
          <button class="btn small ghost" id="num-clear">クリア</button>
          <button class="btn small ghost" id="num-back">1つ戻す</button>
          <button class="btn small ghost" id="num-rand">ランダム</button>
        </div>
      </div>
    </div>
    <div class="setup-foot">
      <div class="opp-ready ${oppReady ? 'ok' : ''}">${esc(app.names[app.opp] || '相手')}：${oppReady ? 'READY' : '準備中…'}</div>
      ${ready
        ? `<button class="btn big" id="btn-unready">準備を取り消す</button><div class="waiting blink">相手の準備を待っています…</div>`
        : `<button class="btn primary big" id="btn-ready" ${itemsOk && numOk ? '' : 'disabled'}>READY</button>`}
    </div>`;
  bindSfx(root);
  if (ready) { const u = $('#btn-unready'); if (u) u.onclick = () => app.player.unready(); return; }
  $$('[data-pick]', root).forEach((b) => b.onclick = () => {
    const k = b.dataset.pick;
    const i = setupSel.items.indexOf(k);
    if (i >= 0) setupSel.items.splice(i, 1);
    else {
      if (setupSel.items.length >= st.equip) setupSel.items.shift();
      setupSel.items.push(k);
    }
    renderSetup();
  });
  $$('.num-pick .pick', root).forEach((b) => b.onclick = () => {
    if (setupSel.num.length >= D) return;
    setupSel.num += b.dataset.d; sound.play('key', { n: setupSel.num.length }); renderSetup();
  });
  $('#num-clear').onclick = () => { setupSel.num = ''; renderSetup(); };
  $('#num-back').onclick = () => { setupSel.num = setupSel.num.slice(0, -1); renderSetup(); };
  $('#num-rand').onclick = () => { const all = R.allNumbers(D); setupSel.num = all[Math.floor(Math.random() * all.length)]; sound.play('shuffle'); renderSetup(); };
  $('#btn-ready').onclick = async () => {
    if (!R.validateItems(setupSel.items, st) || !R.isValidNumber(setupSel.num, D)) return;
    localStorage.setItem('numer0n_items', JSON.stringify(setupSel.items));
    sound.play('ready');
    await app.player.setup(setupSel.num, setupSel.items.slice());
  };
}

// -------------------------------------------------------------
//  ゲーム画面
// -------------------------------------------------------------
function enterGame() {
  show('scr-game');
  closeModal();
  app.input = '';
  if (studio) {
    studio.setOpponent(app.names[app.opp] || 'OPPONENT');
    studio.setCelebrate(false);
  }
  sound.bgm('bgm_game');
  buildHud();
}

function buildHud() {
  $('#hud').innerHTML = `
    <div class="hud-top">
      <div class="plate me"><div class="pl-name"></div><div class="pl-wins"></div></div>
      <div class="turnbox"><div class="turn-label"></div><div class="timer"><div class="timer-bar"></div><span class="timer-num"></span></div><div class="turn-sub"></div></div>
      <div class="plate opp"><div class="pl-name"></div><div class="pl-wins"></div></div>
    </div>
    <div class="opp-area">
      <div class="opp-cards"></div>
      <div class="opp-info"></div>
      <div class="opp-items"></div>
    </div>
    <div class="panel log log-me"><div class="panel-head">YOUR CALL</div><div class="log-list"></div></div>
    <div class="panel log log-opp"><div class="panel-head">OPPONENT CALL</div><div class="log-list"></div></div>
    <div class="my-area">
      <div class="my-label">YOUR NUMBER</div>
      <div class="my-cards"></div>
      <div class="my-items"></div>
    </div>
    <div class="input-area">
      <div class="call-slots"></div>
      <div class="keypad"></div>
      <div class="key-btns">
        <button class="btn ghost" id="k-del">DEL</button>
        <button class="btn call-btn" id="k-call">CALL</button>
      </div>
    </div>
    <div class="hud-btns">
      <button class="btn small ghost" id="h-memo">✎ MEMO</button>
      <button class="btn small ghost" id="h-rule">RULE</button>
      <button class="btn small ghost danger" id="h-resign">降参</button>
    </div>`;
  $('.keypad').innerHTML = Array.from({ length: 10 }, (_, d) => `<button class="kp" data-d="${d}">${cardHTML(d, 'mini')}</button>`).join('');
  $$('.kp').forEach((b) => b.onclick = () => pressDigit(b.dataset.d));
  $('#k-del').onclick = () => { app.input = app.input.slice(0, -1); renderInput(); };
  $('#k-call').onclick = doCall;
  $('#h-memo').onclick = () => memo.toggle();
  $('#h-rule').onclick = showRules;
  $('#h-resign').onclick = () => openModal({
    title: '降参しますか？', body: '<p>このゲームを負けとして終了します。</p>',
    buttons: [{ label: 'キャンセル', cls: 'ghost' }, { label: '降参する', cls: 'danger', onClick: () => app.player.resign() }],
  });
  bindSfx($('#hud'));
  renderGame();
}

function pressDigit(d) {
  const s = app.state; if (!s) return;
  const D = s.settings.digits;
  if (app.input.length >= D || app.input.includes(d)) return;
  app.input += d;
  sound.play('key', { n: app.input.length });
  renderInput();
}

async function doCall() {
  const s = app.state;
  if (!inputEnabled()) return;
  if (!R.isValidNumber(app.input, s.settings.digits)) return;
  const n = app.input;
  const ok = await app.player.call(n);
  if (ok) { app.input = ''; if (studio) studio.pressButton(true); renderInput(); }
  else toast('今はコールできません');
}

function inputEnabled() {
  const s = app.state;
  return !!s && s.phase === 'play' && !director.busy && R.canAct(s, app.me, app.player.now());
}

function renderInput() {
  const s = app.state; if (!s || !$('.call-slots')) return;
  const D = s.settings.digits;
  const en = inputEnabled();
  setHTML($('.call-slots'), Array.from({ length: D }, (_, i) => app.input[i] != null ? cardHTML(app.input[i], 'slot filled') : '<div class="card slot empty"></div>').join(''));
  $$('.kp').forEach((b) => b.disabled = !en || app.input.includes(b.dataset.d) || app.input.length >= D);
  $('#k-del').disabled = !en || !app.input.length;
  $('#k-call').disabled = !en || app.input.length !== D;
  $('.input-area').classList.toggle('active', en);
  $('.input-area').classList.toggle('double2', !!(s.itemsLocked && s.turn === app.me));
}

/** 表示済みログから「相手の番号について分かっていること」 */
function knownAboutOpp(s, log) {
  const D = s.settings.digits;
  const info = Array.from({ length: D }, () => ({ hl: null, d: null }));
  const notIn = new Set(); let slash = null;
  for (const e of log) {
    if (e.type === 'highlow' && e.by === app.me) e.result.split('').forEach((h, i) => (info[i].hl = h));
    if (e.type === 'target' && e.by === app.me) { if (e.pos >= 0) { info[e.pos].d = String(e.digit); info[e.pos].hl = R.hlOf(e.digit); } else notIn.add(e.digit); }
    if (e.type === 'slash' && e.by === app.me) slash = e.value;
    if (e.type === 'double' && e.by === app.opp) { info[e.pos].d = e.digit; info[e.pos].hl = R.hlOf(e.digit); }
    if (e.type === 'item' && e.by === app.opp) {
      if (e.item === 'shuffle') { info.forEach((x) => { x.hl = null; x.d = null; }); }
      if (e.item === 'change') { info[e.pos] = { hl: e.hl, d: null }; }
    }
  }
  return { info, notIn: [...notIn], slash };
}

function logRows(log, who) {
  const rows = [];
  let callNo = 0;
  for (const e of log) {
    if (e.by !== who) continue;
    if (e.type === 'call') {
      callNo++;
      const res = e.eat === 0 && e.bite === 0 ? '<span class="zero">0E 0B</span>' : `<span class="e">${e.eat}<i>EAT</i></span><span class="b">${e.bite}<i>BITE</i></span>`;
      rows.push(`<div class="lrow call ${e.eat === app.state.settings.digits ? 'hit' : ''}"><span class="no">${callNo}</span><span class="num">${e.num.split('').map((d) => `<i>${d}</i>`).join('')}</span><span class="res">${res}</span></div>`);
    } else if (e.type === 'item') {
      let txt = '';
      if (e.item === 'change') txt = `${R.posLabel(e.pos, app.state.settings.digits)} を交換（${e.hl === 'H' ? 'HIGH' : 'LOW'}）`;
      else if (e.item === 'shuffle') txt = '番号を並べ替えた';
      else if (e.item === 'time') txt = `考慮時間 +${e.sec}秒`;
      else if (e.item === 'double') txt = '2回コール';
      else continue;
      rows.push(`<div class="lrow litem" style="--ic:${R.ITEM_DEFS[e.item].color}">${itemHTML(e.item, 'xs')}<b>${itemName(e.item)}</b><span>${txt}</span></div>`);
    } else if (e.type === 'highlow') {
      rows.push(`<div class="lrow litem" style="--ic:${R.ITEM_DEFS.highlow.color}">${itemHTML('highlow', 'xs')}<b>HIGH&amp;LOW</b><span class="hl">${e.result.split('').map((h) => `<i class="${h}">${h === 'H' ? 'HIGH' : 'LOW'}</i>`).join('')}</span></div>`);
    } else if (e.type === 'slash') {
      rows.push(`<div class="lrow litem" style="--ic:${R.ITEM_DEFS.slash.color}">${itemHTML('slash', 'xs')}<b>SLASH</b><span>スラッシュナンバー <em>${e.value}</em></span></div>`);
    } else if (e.type === 'target') {
      rows.push(`<div class="lrow litem" style="--ic:${R.ITEM_DEFS.target.color}">${itemHTML('target', 'xs')}<b>TARGET</b><span><em>${e.digit}</em> → ${e.pos >= 0 ? R.posLabel(e.pos, app.state.settings.digits) : 'なし'}</span></div>`);
    } else if (e.type === 'double') {
      rows.push(`<div class="lrow litem" style="--ic:${R.ITEM_DEFS.double.color}">${itemHTML('double', 'xs')}<b>DOUBLE</b><span>自分の${R.posLabel(e.pos, app.state.settings.digits)}を開示 <em>${e.digit}</em></span></div>`);
    } else if (e.type === 'timeout') {
      rows.push(`<div class="lrow sys">TIME UP（コールなし）</div>`);
    }
  }
  return rows.join('') || '<div class="lrow empty">—</div>';
}

let lastTickSec = null;
function renderGame() {
  const s = app.state;
  if (!s || (s.phase !== 'play' && s.phase !== 'gameover') || !$('.hud-top')) return;
  const D = s.settings.digits;
  const shown = s.log.filter((e) => e.id <= director.shownId);
  const me = app.me, opp = app.opp;

  // 名前・勝ち数
  const pips = (u) => Array.from({ length: s.settings.winsNeeded }, (_, i) => `<i class="${i < (s.wins[u] || 0) ? 'on' : ''}"></i>`).join('');
  $('.plate.me .pl-name').textContent = app.names[me] || 'YOU';
  $('.plate.opp .pl-name').textContent = app.names[opp] || 'OPPONENT';
  setHTML($('.plate.me .pl-wins'), s.settings.winsNeeded > 1 ? pips(me) : '');
  setHTML($('.plate.opp .pl-wins'), s.settings.winsNeeded > 1 ? pips(opp) : '');
  const myTurn = s.turn === me && s.phase === 'play';
  $('.plate.me').classList.toggle('active', myTurn);
  $('.plate.opp').classList.toggle('active', s.turn === opp && s.phase === 'play');

  // 相手の番号（分かっている情報）
  const k = knownAboutOpp(s, shown);
  const finalOpp = s.phase === 'gameover' && director.idle() ? s.final[opp] : null;
  setHTML($('.opp-cards'), k.info.map((x, i) => `<div class="ocard">${finalOpp ? cardHTML(finalOpp[i]) : (x.d != null ? cardHTML(x.d, 'known') : cardHTML(null))}
    ${x.hl && !finalOpp ? `<span class="hlchip ${x.hl}">${x.hl === 'H' ? 'HIGH' : 'LOW'}</span>` : ''}</div>`).join(''));
  const infoChips = [];
  if (k.slash != null) infoChips.push(`<span class="chip" style="--ic:${R.ITEM_DEFS.slash.color}">SLASH ${k.slash}</span>`);
  if (k.notIn.length) infoChips.push(`<span class="chip" style="--ic:${R.ITEM_DEFS.target.color}">なし: ${k.notIn.join(' ')}</span>`);
  setHTML($('.opp-info'), infoChips.join(''));
  setHTML($('.opp-items'), Object.entries(s.items[opp] || {}).map(([key, st]) => itemHTML(key, 'sm ' + (st === 'used' && isShownUsed(shown, opp, key) ? 'used' : ''), `title="${itemName(key)}"`)).join(''));

  // 自分の番号
  const sec = app.player && app.player.secret;
  const rev = s.reveals[me] || {};
  setHTML($('.my-cards'), sec ? sec.split('').map((d, i) => `<div class="mcard">${cardHTML(d)}${rev[i] != null ? '<span class="open">OPEN</span>' : ''}</div>`).join('') : '');

  // 自分のアイテム
  const canD = R.canDefend(s, me) && !director.busy;
  const canA = R.canAct(s, me, app.player.now()) && !s.attackUsed && !s.itemsLocked && !director.busy;
  const itemsChanged = setHTML($('.my-items'), Object.entries(s.items[me] || {}).map(([key, st]) => {
    const def = R.ITEM_DEFS[key];
    const usable = st === 'unused' && (def.kind === 'attack' ? canA : canD);
    return `<button class="my-item ${def.kind} ${st === 'used' ? 'used' : ''} ${usable ? 'usable' : ''}" data-use="${key}" ${usable ? '' : 'disabled'} style="--ic:${def.color}">
      ${itemHTML(key, st === 'used' ? 'used' : '')}<span>${def.name}</span></button>`;
  }).join(''));
  if (itemsChanged) $$('.my-item').forEach((b) => b.onclick = () => useItem(b.dataset.use));

  // ログ
  const lm = $('.log-me .log-list'), lo = $('.log-opp .log-list');
  if (setHTML(lm, logRows(shown, me))) lm.scrollTop = lm.scrollHeight;
  if (setHTML(lo, logRows(shown, opp))) lo.scrollTop = lo.scrollHeight;

  renderTurnBox();
  renderInput();
}

function isShownUsed(shown, uid, key) {
  return shown.some((e) => e.by === uid && ((e.type === 'item' && e.item === key) || (e.type === key)));
}

function renderTurnBox() {
  const s = app.state; if (!s || !$('.turnbox')) return;
  const now = app.player ? app.player.now() : Date.now();
  const lbl = $('.turn-label'), sub = $('.turn-sub'), bar = $('.timer-bar'), num = $('.timer-num');
  const box = $('.turnbox');
  if (s.phase !== 'play') {
    lbl.textContent = s.phase === 'gameover' ? 'GAME SET' : '';
    sub.textContent = ''; bar.style.width = '0%'; num.textContent = '';
    box.className = 'turnbox';
    return;
  }
  const myTurn = s.turn === app.me;
  if (now < s.startAt) {
    lbl.textContent = 'READY'; sub.textContent = ''; bar.style.width = '100%'; num.textContent = '';
    box.className = 'turnbox'; return;
  }
  lbl.textContent = myTurn ? 'YOUR TURN' : 'OPPONENT TURN';
  box.className = 'turnbox ' + (myTurn ? 'mine' : 'theirs');
  let subText = '';
  if (s.pending) {
    const p = s.pending;
    if (p.type === 'call') subText = 'JUDGING…';
    else if (p.type === 'double_choose') subText = p.responder === app.me ? '開示させる桁を選んでください' : '相手が開示する桁を選んでいます…';
    else subText = 'アイテム処理中…';
  } else if (now < s.cooldownUntil) {
    const r = Math.ceil((s.cooldownUntil - now) / 1000);
    subText = myTurn ? `相手の防御タイム ${r}` : (R.canDefend(s, app.me) && hasUnusedDefense(s) ? `防御アイテム使用可能 ${r}` : `相手のコール待ち ${r}`);
  } else if (myTurn) {
    subText = s.itemsLocked ? 'DOUBLE：2回目のコール' : 'コールしてください';
  } else {
    subText = R.canDefend(s, app.me) && hasUnusedDefense(s) ? '防御アイテム使用可能' : '相手が考えています…';
  }
  sub.textContent = subText;
  if (s.turnDeadline) {
    const total = s.settings.turnSec * 1000;
    const start = s.cooldownUntil;
    let remain = s.turnDeadline - Math.max(now, start);
    if (s.pending && s.pending.at) remain = s.turnDeadline - Math.max(s.pending.at, start);
    remain = Math.max(0, remain);
    bar.style.width = Math.min(100, (remain / total) * 100) + '%';
    const sec = Math.ceil(remain / 1000);
    num.textContent = sec;
    box.classList.toggle('danger', sec <= 10 && now >= start);
    if (myTurn && now >= start && sec <= 10 && sec > 0 && sec !== lastTickSec && !s.pending) { lastTickSec = sec; sound.play('tick', { last: sec <= 3 }); }
  } else {
    bar.style.width = '100%'; num.textContent = '∞';
  }
}

function hasUnusedDefense(s) {
  return Object.entries(s.items[app.me] || {}).some(([k, v]) => v === 'unused' && R.ITEM_DEFS[k].kind === 'defense');
}

setInterval(() => { if (app.screen === 'scr-game') { renderTurnBox(); const s = app.state; if (s && s.phase === 'play') { const en = inputEnabled(); if (en !== renderTurnBox._en) { renderTurnBox._en = en; renderGame(); } } } }, 150);

// ---------------- アイテム使用 ----------------
function useItem(key) {
  const s = app.state; if (!s) return;
  const def = R.ITEM_DEFS[key];
  if (def.kind === 'attack') {
    if (key === 'target') return targetModal();
    openModal({
      title: `<span class="mt-item" style="--ic:${def.color}">${itemHTML(key, 'sm')} ${def.name}</span>`,
      body: `<p>${def.desc}</p><p class="q">${def.name} を使いますか？</p>`,
      buttons: [{ label: 'やめる', cls: 'ghost' }, { label: '使う', cls: 'primary', onClick: () => app.player.attack(key) }],
    });
  } else if (key === 'shuffle') shuffleModal();
  else if (key === 'change') changeModal();
}

function targetModal() {
  const def = R.ITEM_DEFS.target;
  let pick = null;
  const body = document.createElement('div');
  body.innerHTML = `<p>${def.desc}</p><div class="pick-row">${Array.from({ length: 10 }, (_, d) => `<button class="pick" data-d="${d}">${cardHTML(d)}</button>`).join('')}</div>`;
  const m = openModal({
    title: `<span class="mt-item">${itemHTML('target', 'sm')} TARGET</span>`, body,
    buttons: [{ label: 'やめる', cls: 'ghost' }, { label: '決定', cls: 'primary', id: 'tg-ok', onClick: () => (pick == null ? false : app.player.attack('target', { digit: pick })) }],
  });
  $('#tg-ok').disabled = true;
  $$('.pick', body).forEach((b) => b.onclick = () => {
    pick = +b.dataset.d; $$('.pick', body).forEach((o) => o.classList.toggle('on', o === b)); $('#tg-ok').disabled = false; sound.play('key');
  });
}

function shuffleModal() {
  const sec = app.player.secret; if (!sec) return;
  let arr = sec.split(''); let selIdx = null;
  const body = document.createElement('div');
  const draw = () => {
    body.innerHTML = `<p>カードを2枚クリックすると入れ替わります。そのまま決定するとフェイント（番号は変わらない）。</p>
      <div class="pick-row big">${arr.map((d, i) => `<button class="pick ${selIdx === i ? 'on' : ''}" data-i="${i}">${cardHTML(d)}</button>`).join('')}</div>
      <p class="sub">元の番号：${sec} → 新しい番号：<b>${arr.join('')}</b></p>
      <button class="btn small ghost" id="sh-rand">ランダムに混ぜる</button>`;
    $$('.pick', body).forEach((b) => b.onclick = () => {
      const i = +b.dataset.i;
      if (selIdx == null) selIdx = i;
      else { [arr[selIdx], arr[i]] = [arr[i], arr[selIdx]]; selIdx = null; sound.play('draw'); }
      draw();
    });
    $('#sh-rand', body).onclick = () => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } sound.play('shuffle'); draw(); };
  };
  draw();
  openModal({
    title: `<span class="mt-item">${itemHTML('shuffle', 'sm')} SHUFFLE</span>`, body,
    buttons: [{ label: 'やめる', cls: 'ghost' }, {
      label: '決定', cls: 'primary', onClick: async () => {
        const ok = await app.player.defend('shuffle', arr.join(''), {});
        if (!ok) toast('今は使えません（相手が行動済み）');
      },
    }],
  });
}

function changeModal() {
  const sec = app.player.secret; if (!sec) return;
  const D = sec.length;
  let pos = null, nd = null;
  const body = document.createElement('div');
  const draw = () => {
    const cands = pos != null ? R.changeCandidates(sec, pos) : [];
    body.innerHTML = `<p>① 交換する桁を選ぶ　② 手持ちの同じ分類（${pos != null ? (R.hlOf(sec[pos]) === 'H' ? 'HIGH：5〜9' : 'LOW：0〜4') : 'HIGH/LOW'}）の数字を選ぶ</p>
      <div class="pick-row big">${sec.split('').map((d, i) => `<button class="pick ${pos === i ? 'on' : ''}" data-p="${i}">${cardHTML(pos === i && nd != null ? nd : d)}<small>${R.posLabel(i, D)}</small></button>`).join('')}</div>
      ${pos != null ? `<div class="pick-row">${cands.length ? cands.map((d) => `<button class="pick ${nd === d ? 'on' : ''}" data-n="${d}">${cardHTML(d)}</button>`).join('') : '<p class="warn">交換できる数字がありません</p>'}</div>` : ''}
      ${pos != null && nd != null ? `<p class="sub">相手には「${R.posLabel(pos, D)}・${R.hlOf(sec[pos]) === 'H' ? 'HIGH' : 'LOW'}」と伝わります。新しい番号：<b>${sec.slice(0, pos) + nd + sec.slice(pos + 1)}</b></p>` : ''}`;
    $$('[data-p]', body).forEach((b) => b.onclick = () => { pos = +b.dataset.p; nd = null; sound.play('key'); draw(); });
    $$('[data-n]', body).forEach((b) => b.onclick = () => { nd = b.dataset.n; sound.play('key'); draw(); });
    const ok = $('#ch-ok'); if (ok) ok.disabled = pos == null || nd == null;
  };
  openModal({
    title: `<span class="mt-item">${itemHTML('change', 'sm')} CHANGE</span>`, body,
    buttons: [{ label: 'やめる', cls: 'ghost' }, {
      label: '決定', cls: 'primary', id: 'ch-ok', onClick: async () => {
        if (pos == null || nd == null) return false;
        const ns = sec.slice(0, pos) + nd + sec.slice(pos + 1);
        const ok = await app.player.defend('change', ns, { pos, hl: R.hlOf(sec[pos]) });
        if (!ok) toast('今は使えません（相手が行動済み）');
      },
    }],
  });
  draw();
}

function checkPendingPrompts() {
  const s = app.state; if (!s || director.busy) return;
  const p = s.pending;
  if (p && p.type === 'double_choose' && p.responder === app.me) {
    if (modalCtx && modalCtx.tag === 'dbl' + p.id) return;
    const D = s.settings.digits;
    const k = knownAboutOpp(s, s.log);
    const revealed = s.reveals[p.by] || {};
    openModal({
      tag: 'dbl' + p.id, dismissable: false,
      title: `<span class="mt-item">${itemHTML('double', 'sm')} DOUBLE</span>`,
      body: `<p>${esc(app.names[p.by])} が DOUBLE を使いました。<br>相手の番号の<b>どの桁を開示させるか</b>選んでください。</p>
        <div class="pick-row big">${Array.from({ length: D }, (_, i) => `<button class="pick dbl" data-i="${i}" ${revealed[i] != null ? 'disabled' : ''}>${k.info[i].d != null ? cardHTML(k.info[i].d) : cardHTML(null)}<small>${R.posLabel(i, D)}</small></button>`).join('')}</div>`,
      buttons: [],
    });
    $$('.pick.dbl').forEach((b) => b.onclick = async () => { sound.play('click'); closeModal(); await app.player.chooseDouble(+b.dataset.i); });
  } else if (modalCtx && modalCtx.tag && modalCtx.tag.startsWith('dbl') && (!p || 'dbl' + p.id !== modalCtx.tag)) {
    closeModal();
  }
}

// -------------------------------------------------------------
//  演出ディレクター
// -------------------------------------------------------------
const director = {
  q: [], busy: false, lastId: 0, shownId: 0, matchKey: null, turnShown: null, firstFeed: true,
  reset() { this.q = []; this.busy = false; this.lastId = 0; this.shownId = 0; this.matchKey = null; this.turnShown = null; this.firstFeed = true; this._gen = (this._gen || 0) + 1; },
  idle() { return !this.busy && !this.q.length; },
  feed(s) {
    const mk = s.createdAt;
    if (this.matchKey !== mk) { this.matchKey = mk; this.lastId = 0; this.shownId = 0; }
    if (this.firstFeed) {
      this.firstFeed = false;
      const now = app.player.now();
      for (const e of s.log) if (e.t < now - 9000) { this.lastId = Math.max(this.lastId, e.id); this.shownId = this.lastId; }
    }
    for (const e of s.log) if (e.id > this.lastId) { this.q.push(e); this.lastId = e.id; }
    this.run();
  },
  async run() {
    if (this.busy) return;
    this.busy = true;
    const gen = this._gen;
    renderGame();
    while (this.q.length) {
      const e = this.q.shift();
      try { await animate(e); } catch (err) { console.error(err); }
      if (gen !== this._gen) return;
      this.shownId = Math.max(this.shownId, e.id);
      renderGame();
    }
    this.busy = false;
    renderGame();
    afterIdle();
  },
};

function afterIdle() {
  const s = app.state; if (!s) return;
  checkPendingPrompts();
  if (s.phase === 'gameover') { showResult(); return; }
  if (s.phase === 'play' && director.turnShown !== s.game + ':' + s.turnNo && app.player.now() >= s.startAt - 500) {
    director.turnShown = s.game + ':' + s.turnNo;
    const mine = s.turn === app.me;
    banner(mine ? 'YOUR TURN' : 'OPPONENT TURN', '', mine ? '#4a6bff' : '#c04aff', 1100, 'small');
    sound.play('turn');
    if (studio) studio.setConsole(mine ? 'YOUR TURN' : 'WAIT…');
    if (studio && studio.shot !== 'seat') studio.setShot('seat', 1.2);
  }
}

function cutLayer(cls) {
  const el = document.createElement('div');
  el.className = 'cut ' + cls;
  $('#cutin').appendChild(el);
  return el;
}

async function banner(text, sub, color = '#4a6bff', ms = 1600, size = '') {
  const el = cutLayer('banner ' + size);
  el.style.setProperty('--bc', color);
  el.innerHTML = `<div class="band"><div class="b-text">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}</div>`;
  await sleep(ms);
  el.classList.add('out');
  await sleep(350);
  el.remove();
}

async function animate(e) {
  const s = app.state;
  const D = s.settings.digits;
  const name = esc(app.names[e.by] || '');
  const mine = e.by === app.me;
  switch (e.type) {
    case 'start': return animStart(e);
    case 'call': return animCall(e);
    case 'item': return animItem(e);
    case 'highlow': {
      sound.play('info');
      const html = e.result.split('').map((h) => `<i class="${h}">${h === 'H' ? 'HIGH' : 'LOW'}</i>`).join('');
      if (studio) studio.setMonitor({ mode: 'text', big: e.result.split('').join(' '), small: 'HIGH & LOW', color: R.ITEM_DEFS.highlow.color });
      return infoCut('highlow', `${mine ? '相手' : 'あなた'}の番号は…`, `<div class="hl big">${html}</div>`);
    }
    case 'slash':
      sound.play('info');
      if (studio) studio.setMonitor({ mode: 'text', big: String(e.value), small: 'SLASH NUMBER', color: R.ITEM_DEFS.slash.color });
      return infoCut('slash', `${mine ? '相手' : 'あなた'}のスラッシュナンバーは`, `<div class="bignum">${e.value}</div>`);
    case 'target':
      sound.play(e.pos >= 0 ? 'eat' : 'zero', { n: 0 });
      if (studio) studio.setMonitor({ mode: 'text', big: `${e.digit} → ${e.pos >= 0 ? R.posLabel(e.pos, D) : 'NONE'}`, small: 'TARGET', color: R.ITEM_DEFS.target.color, size: 90 });
      return infoCut('target', `「${e.digit}」は${mine ? '相手' : 'あなた'}の番号に…`, e.pos >= 0 ? `<div class="bignum">${R.posLabel(e.pos, D)}</div>` : `<div class="bignum none">ありません</div>`);
    case 'double':
      sound.play('info');
      if (studio) studio.setMonitor({ mode: 'text', big: `${R.posLabel(e.pos, D)} = ${e.digit}`, small: `${app.names[e.by]} の番号を開示`, color: R.ITEM_DEFS.double.color, size: 90 });
      return infoCut('double', `${mine ? 'あなた' : name}の${R.posLabel(e.pos, D)}を開示`, `<div class="reveal-card">${cardHTML(e.digit)}</div><p>このターン、2回コールできます</p>`);
    case 'timeout':
      sound.play('timeup');
      return banner('TIME UP', `${name} のターン終了`, '#ff4060', 1500);
    case 'finalchance':
      sound.play('start');
      return banner('LAST CHANCE', `${esc(app.names[R.other(s, e.hitter)])} 最後のコール！`, '#f0c040', 2000);
    case 'resign':
      return banner('RESIGN', `${name} が降参しました`, '#888', 1500);
    case 'end':
      await sleep(400);
      return;
  }
}

async function animStart(e) {
  const s = app.state;
  if (studio) { studio.setShot('wide', 1.2); studio.setMonitor({ mode: 'logo' }); }
  sound.bgm('bgm_game');
  const el = cutLayer('order');
  const me = app.me, opp = app.opp;
  el.innerHTML = `<div class="order-box">
    <div class="order-title">先攻・後攻 決定</div>
    <div class="order-cards">
      <div class="oc"><div class="oc-name">${esc(app.names[me])}</div><div class="flip"><div class="f-back">${cardHTML(null)}</div><div class="f-front">${cardHTML(e.draws[me])}</div></div><div class="oc-tag"></div></div>
      <div class="oc"><div class="oc-name">${esc(app.names[opp])}</div><div class="flip"><div class="f-back">${cardHTML(null)}</div><div class="f-front">${cardHTML(e.draws[opp])}</div></div><div class="oc-tag"></div></div>
    </div>
    <div class="order-note">小さい数字を引いた方が先攻</div></div>`;
  await sleep(900);
  const flips = $$('.flip', el), tags = $$('.oc-tag', el);
  sound.play('draw'); flips[0].classList.add('on'); await sleep(450);
  sound.play('draw'); flips[1].classList.add('on'); await sleep(900);
  const firstIdx = e.first === me ? 0 : 1;
  tags[firstIdx].textContent = '先攻'; tags[firstIdx].className = 'oc-tag first';
  tags[1 - firstIdx].textContent = '後攻'; tags[1 - firstIdx].className = 'oc-tag second';
  $$('.oc', el)[firstIdx].classList.add('win');
  sound.play('ready');
  await sleep(1500);
  el.classList.add('out'); await sleep(300); el.remove();
  if (studio) { studio.setShot('seat', 1.6); studio.flash('#ffffff', 1.2); studio.pulse('#ffffff', 60); }
  sound.play('start');
  await banner('GAME START', `GAME ${s.game}　${D_label(s)}`, '#4a6bff', 1700, 'huge');
}
const D_label = (s) => `${s.settings.digits}桁`;

async function animCall(e) {
  const s = app.state;
  const D = s.settings.digits;
  const mine = e.by === app.me;
  const name = esc(app.names[e.by] || '');
  if (studio) { studio.pressButton(mine); studio.setMonitor({ mode: 'call', who: app.names[e.by], num: e.num }); studio.flash(mine ? '#4a6bff' : '#c04aff', 1); }
  sound.play('call');
  const el = cutLayer('callcut ' + (mine ? 'mine' : 'theirs'));
  el.innerHTML = `<div class="cc-band">
    <div class="cc-who">${name} <span>CALL</span></div>
    <div class="cc-cards">${e.num.split('').map((d, i) => `<div class="cc-card" style="--i:${i}">${cardHTML(d)}</div>`).join('')}</div>
    <div class="cc-res"><div class="eat"><b>?</b><span>EAT</span></div><div class="bite"><b>?</b><span>BITE</span></div></div>
  </div>`;
  await sleep(300 + D * 120);
  sound.play('drum', { dur: 1.0 });
  await sleep(1050);
  const eb = $('.eat b', el), bb = $('.bite b', el);
  eb.textContent = e.eat; $('.eat', el).classList.add('show');
  if (e.eat > 0) { sound.play('eat', { n: e.eat }); if (studio) studio.pulse('#ff4060', 50); } else sound.play('zero');
  await sleep(550);
  bb.textContent = e.bite; $('.bite', el).classList.add('show');
  if (e.bite > 0) { sound.play('bite', { n: e.bite }); if (studio) studio.pulse('#40c0ff', 40); }
  if (studio) studio.setMonitor({ mode: 'call', who: app.names[e.by], num: e.num, eat: e.eat, bite: e.bite });
  if (e.eat === D) {
    await sleep(500);
    el.classList.add('hit');
    $('.cc-band', el).insertAdjacentHTML('beforeend', `<div class="numer0n">${D}EAT!!</div>`);
    sound.play('numer0n');
    if (studio) { studio.flash('#ffd040', 3); studio.pulse('#ffd040', 90); studio.setMonitor({ mode: 'text', big: `${D} EAT`, small: `${app.names[e.by]} が番号を的中！`, color: '#d0a020' }); }
    await sleep(2600);
  } else {
    await sleep(1500);
  }
  el.classList.add('out'); await sleep(350); el.remove();
}

async function animItem(e) {
  const def = R.ITEM_DEFS[e.item];
  const mine = e.by === app.me;
  const name = esc(app.names[e.by] || '');
  if (studio) { studio.flash(def.color, 2.2); studio.pulse(def.color, 70); studio.setMonitor({ mode: 'text', big: def.name, small: `${app.names[e.by]} が使用`, color: def.color }); }
  sound.play(def.kind === 'attack' ? 'item_attack' : 'item_defense', { pitch: 0.8 + R.ITEM_ORDER.indexOf(e.item) * 0.08 });
  const el = cutLayer('itemcut ' + def.kind);
  el.style.setProperty('--ic', def.color);
  let sub = '';
  if (e.item === 'change') sub = `${R.posLabel(e.pos, app.state.settings.digits)} を交換　（${e.hl === 'H' ? 'HIGH' : 'LOW'}）`;
  if (e.item === 'shuffle') sub = mine ? '番号を並べ替えました' : '番号が並べ替えられた！？';
  if (e.item === 'time') sub = `考慮時間 +${e.sec}秒`;
  if (e.item === 'target') sub = `指定した数字：${e.digit}`;
  if (e.item === 'double') sub = mine ? '相手が開示する桁を選びます…' : '開示させる桁を選んでください';
  el.innerHTML = `<div class="ic-band"><div class="ic-icon">${itemHTML(e.item, 'huge')}</div>
    <div class="ic-text"><div class="ic-kind">${def.kind === 'attack' ? 'ATTACK ITEM' : 'DEFENSE ITEM'}</div><div class="ic-big">${def.name}</div><div class="ic-who">${name}</div>${sub ? `<div class="ic-sub">${sub}</div>` : ''}</div></div>`;
  if (e.item === 'shuffle') setTimeout(() => sound.play('shuffle'), 700);
  await sleep(2000);
  el.classList.add('out'); await sleep(350); el.remove();
}

async function infoCut(key, title, html) {
  const def = R.ITEM_DEFS[key];
  const el = cutLayer('infocut');
  el.style.setProperty('--ic', def.color);
  el.innerHTML = `<div class="if-box"><div class="if-head">${itemHTML(key, 'sm')}<b>${def.name}</b></div><div class="if-title">${title}</div>${html}</div>`;
  await sleep(2300);
  el.classList.add('out'); await sleep(300); el.remove();
}

// -------------------------------------------------------------
//  リザルト
// -------------------------------------------------------------
let resultShownFor = null;
function showResult() {
  const s = app.state; if (!s || s.phase !== 'gameover') return;
  const endE = s.log.filter((x) => x.type === 'end').pop();
  const key = s.createdAt + ':' + s.game + ':' + (endE ? endE.id : 0);
  const r = s.result || {};
  const win = r.winner === app.me, draw = !r.winner;
  const first = resultShownFor !== key;
  resultShownFor = key;
  const box = $('#result');
  box.className = 'show ' + (draw ? 'draw' : win ? 'win' : 'lose');
  const myReady = !!s.nextReady[app.me], oppReady = !!s.nextReady[app.opp];
  const reason = r.reason === 'resign' ? '（降参）' : '';
  box.innerHTML = `<div class="res-box">
    <div class="res-title">${draw ? 'DRAW' : win ? 'YOU WIN' : 'YOU LOSE'}</div>
    <div class="res-sub">${draw ? '引き分け' : esc(app.names[r.winner]) + ' の勝利' + reason}</div>
    <div class="res-nums">
      ${[app.me, app.opp].map((u) => `<div class="rn ${r.winner === u ? 'w' : ''}"><div class="rn-name">${esc(app.names[u])}</div>
        <div class="rn-cards">${(s.final[u] || '?'.repeat(s.settings.digits)).split('').map((d) => cardHTML(d === '?' ? null : d)).join('')}</div>
        <div class="rn-wins">${s.wins[u] || 0} WIN</div></div>`).join('<div class="rn-vs">VS</div>')}
    </div>
    ${s.matchOver && s.settings.winsNeeded > 1 ? `<div class="res-match">MATCH WINNER：${esc(app.names[r.winner])}</div>` : ''}
    <div class="res-btns">
      ${myReady ? `<div class="waiting blink">相手を待っています…</div>` : `<button class="btn primary big" id="r-next">${s.matchOver ? 'もう一度対戦' : 'NEXT GAME'}</button>`}
      ${oppReady && !myReady ? `<div class="opp-ready ok">${esc(app.names[app.opp])}：OK</div>` : ''}
      <button class="btn ghost" id="r-board">盤面を見る</button>
      ${isHost() ? `<button class="btn ghost" id="r-lobby">ロビーへ</button>` : ''}
      <button class="btn ghost" id="r-title">タイトルへ</button>
    </div></div>`;
  bindSfx(box);
  const nx = $('#r-next'); if (nx) nx.onclick = () => app.player.next();
  $('#r-board').onclick = () => { box.classList.remove('show'); showBoardBtn(); };
  const lb = $('#r-lobby'); if (lb) lb.onclick = backToLobby;
  $('#r-title').onclick = async () => {
    if (app.mode === 'online') { localStorage.removeItem('numer0n_last'); await app.net.leaveRoom(); }
    goTitle();
  };
  if (first) {
    sound.bgm(null);
    sound.play(draw ? 'draw_game' : win ? 'win' : 'lose');
    setTimeout(() => sound.bgm('bgm_result'), 3500);
    if (studio) {
      studio.setShot('orbit');
      studio.setCelebrate(win);
      studio.setMonitor({ mode: 'text', big: draw ? 'DRAW' : 'WINNER', small: draw ? '' : app.names[r.winner], color: win ? '#d0a020' : '#6a1cb0' });
      studio.setConsole(draw ? 'DRAW' : win ? 'WIN' : 'LOSE');
    }
  }
}
function hideResult() { const b = $('#result'); if (b) { b.className = ''; b.innerHTML = ''; } const sb = $('#show-result'); if (sb) sb.remove(); }
function showBoardBtn() {
  if ($('#show-result')) return;
  const b = document.createElement('button');
  b.id = 'show-result'; b.className = 'btn primary'; b.textContent = 'リザルトに戻る';
  b.onclick = () => { b.remove(); $('#result').classList.add('show'); };
  $('#ui').appendChild(b);
  if (studio) studio.setShot('seat', 1.2);
}

async function backToLobby() {
  if (app.mode === 'local') {
    if (app.cpu) { app.cpu.destroy(); app.cpu = null; }
    if (app.player) { app.player.destroy(); app.player = null; }
    app.state = null; director.reset(); hideResult();
    show('scr-lobby'); renderLobby();
    if (studio) { studio.setShot('high'); studio.setOpponent(null); studio.setCelebrate(false); studio.setMonitor({ mode: 'logo' }); }
    sound.bgm('bgm_title');
  } else {
    await app.net.updateMeta((m) => { m.status = 'lobby'; return m; });
    await app.store.reset(null);
  }
}

// -------------------------------------------------------------
//  ルール説明
// -------------------------------------------------------------
function showRules() {
  const st = app.state ? app.state.settings : app.settings;
  openModal({
    title: 'Numer0n ルール', cls: 'wide',
    body: `<div class="rules">
      <h3>基本ルール</h3>
      <p>0〜9のカードで、各自 <b>${st.digits}桁</b> の番号（同じ数字は使えない・0が先頭でもOK）を設定します。交互に相手の番号を予想して「コール」し、相手は結果を答えます。</p>
      <ul><li><b class="e">EAT</b>：数字も位置も合っている</li><li><b class="b">BITE</b>：数字は合っているが位置が違う</li></ul>
      <p>例）相手の番号 <b>765</b> に <b>746</b> とコール → 7がEAT、6がBITE → <b>1EAT 1BITE</b></p>
      <p>先に相手の番号を完全に当てた（${st.digits}EAT）プレイヤーの勝利。先攻・後攻はカードを1枚ずつ引き、小さい数字を引いた方が先攻です。</p>
      <h3>アイテム</h3>
      <p>ゲーム前に<b>${st.equip}個</b>を装備。各アイテムは1ゲーム1回まで。1ターンに攻撃系・防御系をそれぞれ1つまで使えます。</p>
      <ul>${R.ITEM_ORDER.filter((k) => st.pool[k]).map((k) => `<li class="ri">${itemHTML(k, 'xs')}<b>${itemName(k)}</b>（${R.ITEM_DEFS[k].kind === 'attack' ? '攻撃' : '防御'}）${R.ITEM_DEFS[k].desc}</li>`).join('')}</ul>
      <p>・攻撃系は自分のターン、コールの前に使用。<br>・防御系は<b>相手のターン</b>、相手がコールや攻撃アイテムを使う前に使用。<br>・相手のジャッジ後${st.cooldownSec ? `<b>${st.cooldownSec}秒間</b>` : ''}は防御タイム（攻撃側は行動できない）。</p>
      <h3>操作</h3>
      <p>数字キー：入力　Enter：コール　Backspace：1文字消す　M：メモ</p>
    </div>`,
    buttons: [{ label: 'とじる', cls: 'primary' }],
  });
}

// -------------------------------------------------------------
//  キーボード
// -------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'm' || e.key === 'M') { if (memo && (app.screen === 'scr-game' || app.screen === 'scr-setup' || memo.open)) memo.toggle(); return; }
  if (memo && memo.open) return;
  if ($('#modal').classList.contains('show')) { if (e.key === 'Escape' && modalCtx && !(modalCtx.tag || '').startsWith('dbl')) closeModal(); return; }
  if (app.screen === 'scr-game') {
    if (/^[0-9]$/.test(e.key)) { if (inputEnabled()) pressDigit(e.key); }
    else if (e.key === 'Backspace') { app.input = app.input.slice(0, -1); renderInput(); }
    else if (e.key === 'Enter') doCall();
  } else if (app.screen === 'scr-title' && (e.key === 'Enter' || e.key === ' ')) {
    titleTap();
  }
});

// -------------------------------------------------------------
//  起動
// -------------------------------------------------------------
async function titleTap() {
  sound.unlock();
  sound.play('title');
  goMenu();
}

function initSysbar() {
  const vol = $('#vol-pop');
  $('#sys-sound').onclick = () => vol.classList.toggle('show');
  $('#sys-mute').checked = sound.muted;
  $('#sys-mute').onchange = (e) => { sound.unlock(); sound.setMuted(e.target.checked); $('#sys-sound').classList.toggle('muted', e.target.checked); };
  $('#sys-sound').classList.toggle('muted', sound.muted);
  for (const k of ['master', 'se', 'bgm']) {
    const r = $(`#vol-${k}`); r.value = sound.vol[k];
    r.oninput = () => { sound.unlock(); sound.setVolume(k, +r.value); };
  }
  $('#sys-memo').onclick = () => memo.toggle();
  $('#sys-full').onclick = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); };
}

async function boot() {
  const logoImg = await preloadAssets();
  if (logoImg) { $('#title-logo').innerHTML = `<img src="${ASSET.logo}" alt="Numer0n">`; }
  try {
    const { Studio } = await import('./studio.js');
    studio = new Studio($('#stage'), { logoImg, lowSpec: /Mobi|Android/i.test(navigator.userAgent) });
  } catch (e) {
    console.warn('3D studio unavailable', e);
    document.body.classList.add('no3d');
  }
  memo = new Memo($('#memo'), OK[ASSET.memo] ? ASSET.memo : null, sound);
  initSysbar();

  $('#scr-title').onclick = titleTap;
  $('#btn-single').onclick = goLocalLobby;
  $('#btn-online').onclick = () => { setName(); show('scr-online'); };
  $('#btn-rule').onclick = showRules;
  $('#btn-memo').onclick = () => memo.toggle();
  $('#btn-create').onclick = createRoom;
  $('#btn-join').onclick = () => joinRoom($('#code-input').value);
  $('#code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('#code-input').value); });
  $('#btn-online-back').onclick = goMenu;
  $('#btn-rejoin').onclick = () => { const l = JSON.parse(localStorage.getItem('numer0n_last') || 'null'); if (l) joinRoom(l.code); };
  $('#name-input').addEventListener('change', setName);
  bindSfx();
  document.body.classList.add('booted');
  goTitle();
  // テスト用フック
  window.__numer0n = { app, R, director };
}

boot();
