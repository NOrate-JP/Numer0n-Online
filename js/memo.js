// =============================================================
//  手書きメモ（2560×1440 の背景画像に合わせた描画面）
// =============================================================
export const MEMO_W = 2560, MEMO_H = 1440;

const COLORS = ['#111111', '#e0283c', '#1e5fe0', '#14995a', '#f08a1c', '#8b4fd8', '#ffffff'];
const SIZES = [4, 8, 16, 32];

export class Memo {
  constructor(root, bgSrc, sound) {
    this.root = root;
    this.sound = sound;
    this.strokes = [];
    this.redo = [];
    this.color = COLORS[0];
    this.size = SIZES[1];
    this.tool = 'pen';
    this.open = false;
    root.innerHTML = `
      <div class="memo-frame">
        <div class="memo-bar">
          <div class="memo-title">MEMO</div>
          <div class="memo-tools">
            <button class="mt-btn tool on" data-tool="pen" title="ペン (P)">✎</button>
            <button class="mt-btn tool" data-tool="eraser" title="消しゴム (E)">⌫</button>
            <span class="mt-sep"></span>
            ${COLORS.map((c, i) => `<button class="mt-color ${i === 0 ? 'on' : ''}" data-color="${c}" style="--c:${c}"></button>`).join('')}
            <span class="mt-sep"></span>
            ${SIZES.map((s, i) => `<button class="mt-size ${i === 1 ? 'on' : ''}" data-size="${s}"><i style="--s:${Math.max(3, s / 2.2)}px"></i></button>`).join('')}
            <span class="mt-sep"></span>
            <button class="mt-btn" data-act="undo" title="元に戻す (Ctrl+Z)">↶</button>
            <button class="mt-btn" data-act="redo" title="やり直し (Ctrl+Y)">↷</button>
            <button class="mt-btn" data-act="clear" title="全消去">🗑</button>
            <button class="mt-btn" data-act="save" title="画像で保存">⤓</button>
          </div>
          <button class="mt-btn close" data-act="close" title="閉じる (M)">✕</button>
        </div>
        <div class="memo-stage"><div class="memo-board">
          <canvas class="memo-bg" width="${MEMO_W}" height="${MEMO_H}"></canvas>
          <canvas class="memo-ink" width="${MEMO_W}" height="${MEMO_H}"></canvas>
        </div></div>
      </div>`;
    this.bg = root.querySelector('.memo-bg');
    this.ink = root.querySelector('.memo-ink');
    this.ictx = this.ink.getContext('2d');
    this._drawBg(bgSrc);
    this._bind();
  }

  _drawBg(src) {
    const x = this.bg.getContext('2d');
    const fallback = () => {
      x.fillStyle = '#f7f6f0'; x.fillRect(0, 0, MEMO_W, MEMO_H);
      x.strokeStyle = '#d9dce8'; x.lineWidth = 2;
      for (let yy = 80; yy < MEMO_H; yy += 80) { x.beginPath(); x.moveTo(0, yy); x.lineTo(MEMO_W, yy); x.stroke(); }
      x.fillStyle = '#b9bdd0'; x.font = '700 40px Orbitron, sans-serif'; x.fillText('Numer0n MEMO  (assets/memo_bg.png を置くと背景が変わります)', 40, 56);
    };
    fallback();
    if (!src) return;
    const img = new Image();
    img.onload = () => { x.clearRect(0, 0, MEMO_W, MEMO_H); x.drawImage(img, 0, 0, MEMO_W, MEMO_H); };
    img.src = src;
  }

  _bind() {
    const r = this.root;
    r.querySelectorAll('.tool').forEach((b) => b.onclick = () => this.setTool(b.dataset.tool));
    r.querySelectorAll('.mt-color').forEach((b) => b.onclick = () => {
      this.color = b.dataset.color; r.querySelectorAll('.mt-color').forEach((o) => o.classList.toggle('on', o === b)); this.setTool('pen');
    });
    r.querySelectorAll('.mt-size').forEach((b) => b.onclick = () => {
      this.size = +b.dataset.size; r.querySelectorAll('.mt-size').forEach((o) => o.classList.toggle('on', o === b));
    });
    r.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'undo') this.undo();
      if (a === 'redo') this.doRedo();
      if (a === 'clear') {
        // ダイアログを出さず、ボタンを2回押すと全消去
        if (b.classList.contains('armed')) { this.clear(); b.classList.remove('armed'); b.textContent = '🗑'; clearTimeout(this._armT); }
        else {
          b.classList.add('armed'); b.textContent = 'もう一度で全消去';
          clearTimeout(this._armT);
          this._armT = setTimeout(() => { b.classList.remove('armed'); b.textContent = '🗑'; }, 2500);
        }
      }
      if (a === 'save') this.save();
      if (a === 'close') this.toggle(false);
    });

    const ink = this.ink;
    let cur = null;
    const pt = (e) => {
      const rc = ink.getBoundingClientRect();
      return [(e.clientX - rc.left) / rc.width * MEMO_W, (e.clientY - rc.top) / rc.height * MEMO_H, e.pressure || 0.5];
    };
    ink.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      ink.setPointerCapture(e.pointerId);
      const eraser = this.tool === 'eraser' || e.button === 5 || (e.buttons & 32);
      cur = { c: this.color, s: eraser ? this.size * 3 : this.size, e: eraser, pen: e.pointerType === 'pen', p: [pt(e)] };
      this._drawSeg(cur, 0);
      e.preventDefault();
    });
    ink.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) { cur.p.push(pt(ev)); this._drawSeg(cur, cur.p.length - 1); }
    });
    const end = () => {
      if (!cur) return;
      this.strokes.push(cur); this.redo = []; cur = null;
    };
    ink.addEventListener('pointerup', end);
    ink.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.doRedo() : this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.doRedo(); }
      else if (e.key === 'p' || e.key === 'P') this.setTool('pen');
      else if (e.key === 'e' || e.key === 'E') this.setTool('eraser');
    });
  }

  setTool(t) {
    this.tool = t;
    this.root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    this.ink.style.cursor = t === 'eraser' ? 'cell' : 'crosshair';
  }

  _width(st, p) { return st.pen ? st.s * (0.35 + p[2] * 1.3) : st.s; }

  _drawSeg(st, i) {
    const x = this.ictx;
    x.save();
    x.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
    x.strokeStyle = st.c; x.fillStyle = st.c;
    x.lineCap = 'round'; x.lineJoin = 'round';
    const p = st.p[i];
    if (i === 0) {
      x.beginPath(); x.arc(p[0], p[1], this._width(st, p) / 2, 0, Math.PI * 2); x.fill();
    } else {
      const a = st.p[i - 1];
      const b0 = i >= 2 ? st.p[i - 2] : a;
      x.lineWidth = this._width(st, p);
      x.beginPath();
      // 中点を使った簡易スムージング
      const m1 = [(b0[0] + a[0]) / 2, (b0[1] + a[1]) / 2], m2 = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2];
      x.moveTo(m1[0], m1[1]); x.quadraticCurveTo(a[0], a[1], m2[0], m2[1]);
      x.stroke();
    }
    x.restore();
  }

  _redraw() {
    this.ictx.clearRect(0, 0, MEMO_W, MEMO_H);
    for (const st of this.strokes) for (let i = 0; i < st.p.length; i++) this._drawSeg(st, i);
  }
  undo() { if (!this.strokes.length) return; this.redo.push(this.strokes.pop()); this._redraw(); }
  doRedo() { if (!this.redo.length) return; this.strokes.push(this.redo.pop()); this._redraw(); }
  clear() { this.strokes = []; this.redo = []; this._redraw(); }

  save() {
    const c = document.createElement('canvas'); c.width = MEMO_W; c.height = MEMO_H;
    const x = c.getContext('2d'); x.drawImage(this.bg, 0, 0); x.drawImage(this.ink, 0, 0);
    const a = document.createElement('a'); a.download = `numer0n_memo_${Date.now()}.png`; a.href = c.toDataURL('image/png'); a.click();
  }

  toggle(force) {
    this.open = force == null ? !this.open : force;
    this.root.classList.toggle('show', this.open);
    document.body.classList.toggle('memo-open', this.open);
    if (this.sound) this.sound.play('click');
    if (this.onToggle) this.onToggle(this.open);
  }
}
