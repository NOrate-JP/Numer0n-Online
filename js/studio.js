// =============================================================
//  3D スタジオ（Three.js）
//  正方形・左右対称の部屋。奥の壁中央に大型モニター（反対側にも同じもの）
//  画質設定：high / mid / low（low はブルームなし・30fps）
// =============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLUE = new THREE.Color('#3a5cff');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const HALF = 7;            // 部屋の半分の幅（正方形 14m × 14m）
const MON_W = 6.4, MON_H = 3.6, MON_Y = 2.75;

function neonMat(color, k = 2.2) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
}

export class Studio {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.logoImg = opts.logoImg || null;
    this.monitorImg = opts.monitorImg || null;   // 待機中にモニターへ映す画像（16:9）
    this.quality = opts.quality || 'mid';
    this.neonMats = [];
    this.clock = new THREE.Clock();
    this.mouse = { x: 0, y: 0 };
    this.shot = 'title';
    this.cam = { from: null, to: null, t: 1, dur: 1 };
    this.flashT = 0; this.flashColor = new THREE.Color('#fff'); this.celebrate = false;
    this.frozen = false;
    this.monitorState = { mode: 'logo' };
    this.video = null;

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04050c');
    this.scene.fog = new THREE.FogExp2('#05060f', 0.04);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
    this.camera.position.set(6, 3, 6);
    this.lookAt = new THREE.Vector3(0, 1, 0);

    this._build();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setQuality(this.quality);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    this.setShot('title', 0);
    this._loop();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = q === 'high' ? Math.min(dpr, 1.5) : q === 'mid' ? Math.min(dpr, 1) : 0.75;
    this.useBloom = q !== 'low';
    this.frameInterval = q === 'low' ? 1 / 30 : q === 'mid' ? 1 / 45 : 0;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);
    this.dust.visible = q !== 'low';
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    // ブルームは低解像度で十分
    const k = this.quality === 'high' ? 0.5 : 0.33;
    this.bloom.resolution.set(Math.round(w * k), Math.round(h * k));
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 72 : 55;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------
  //  シーン構築
  // ---------------------------------------------------------
  _build() {
    const S = this.scene;

    S.add(new THREE.HemisphereLight('#6a78ff', '#05050a', 0.45));
    const key = new THREE.SpotLight('#dfe6ff', 60, 14, Math.PI / 6, 0.6, 1.4);
    key.position.set(0, 6.5, 0); key.target.position.set(0, 0.8, 0);
    S.add(key, key.target);
    for (const sx of [-1, 1]) {
      const rim = new THREE.SpotLight('#7a86ff', 12, 13, Math.PI / 5, 0.8, 1.5);
      rim.position.set(4 * sx, 4.5, 0); rim.target.position.set(0, 1, 0); S.add(rim, rim.target);
    }
    this.pulseLight = new THREE.PointLight('#4a6bff', 0, 9, 1.6);
    this.pulseLight.position.set(0, 2.4, 0); S.add(this.pulseLight);

    // 床
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshStandardMaterial({ color: '#0b0d1a', roughness: 0.35, metalness: 0.5, map: this._floorTexture() }));
    floor.rotation.x = -Math.PI / 2; S.add(floor);

    // 六角形のステージ
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.4, 0.08, 6),
      new THREE.MeshStandardMaterial({ color: '#0d1024', roughness: 0.3, metalness: 0.65 }));
    plat.position.y = 0.04; plat.rotation.y = Math.PI / 6; S.add(plat);
    const platEdge = new THREE.LineSegments(new THREE.EdgesGeometry(plat.geometry), new THREE.LineBasicMaterial({ color: BLUE.clone().multiplyScalar(2.5), toneMapped: false }));
    platEdge.position.copy(plat.position); platEdge.rotation.copy(plat.rotation); S.add(platEdge);
    this.neonMats.push(platEdge.material);

    // 壁（4面とも同じ）
    const wallMat = new THREE.MeshStandardMaterial({ color: '#0a0c1c', roughness: 0.9, metalness: 0.15 });
    const walls = [[0, -HALF, 0], [0, HALF, Math.PI], [-HALF, 0, Math.PI / 2], [HALF, 0, -Math.PI / 2]];
    for (const [x, z, ry] of walls) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 6.4), wallMat);
      w.position.set(x, 3.2, z); w.rotation.y = ry; S.add(w);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({ color: '#05060c', roughness: 1 }));
    ceil.position.y = 6.4; ceil.rotation.x = Math.PI / 2; S.add(ceil);

    // ネオン管（各壁に上下2本、四隅に縦）
    const tube = (len, x, y, z, ry, color = BLUE, h = 0.035) => {
      const m = neonMat(color, 2.4); this.neonMats.push(m);
      const t = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.03), m);
      t.position.set(x, y, z); t.rotation.y = ry; S.add(t);
    };
    for (const [x, z, ry] of walls) {
      const ox = Math.sign(x) * -0.05, oz = Math.sign(z) * -0.05;
      tube(HALF * 2 - 0.3, x + ox, 0.9, z + oz, ry);
      tube(HALF * 2 - 0.3, x + ox, 5.2, z + oz, ry);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = neonMat(BLUE, 2.4); this.neonMats.push(m);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.035, 6.4, 0.035), m); v.position.set((HALF - 0.05) * sx, 3.2, (HALF - 0.05) * sz); S.add(v);
    }

    // 大型モニター（奥の壁中央・手前の壁にも同じもの）
    this.monCanvas = document.createElement('canvas'); this.monCanvas.width = 1024; this.monCanvas.height = 576;
    this.monTex = new THREE.CanvasTexture(this.monCanvas); this.monTex.colorSpace = THREE.SRGBColorSpace;
    this.monMat = new THREE.MeshBasicMaterial({ map: this.monTex, toneMapped: false });
    this._raysCanvas = this._makeRays();
    const frameMat = new THREE.MeshStandardMaterial({ color: '#111320', metalness: 0.8, roughness: 0.35 });
    for (const [z, ry] of [[-HALF, 0], [HALF, Math.PI]]) {
      const g = new THREE.Group(); g.position.set(0, MON_Y, z); g.rotation.y = ry; S.add(g);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(MON_W + 0.3, MON_H + 0.3, 0.16), frameMat); frame.position.z = 0.08; g.add(frame);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(MON_W, MON_H), this.monMat); scr.position.z = 0.17; g.add(scr);
      const em = neonMat('#6f8cff', 2); this.neonMats.push(em);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(MON_W + 0.34, MON_H + 0.34)), new THREE.LineBasicMaterial({ color: em.color, toneMapped: false }));
      edge.position.z = 0.17; g.add(edge); this.neonMats.push(edge.material);
    }

    // ナンバーパネルの壁（左右対称）
    this.gridCanvas = document.createElement('canvas'); this.gridCanvas.width = 768; this.gridCanvas.height = 450;
    this.gridTex = new THREE.CanvasTexture(this.gridCanvas); this.gridTex.colorSpace = THREE.SRGBColorSpace;
    this.gridCells = new Float32Array(84);
    this._gridBase = {};
    const gridMat = new THREE.MeshBasicMaterial({ map: this.gridTex, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-1, 1]) {
      const grid = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 4.2), gridMat);
      grid.position.set((HALF - 0.08) * sx, 3.0, 0); grid.rotation.y = -Math.PI / 2 * sx; S.add(grid);
    }
    this._drawGrid(0);

    // テーブル
    const tbl = new THREE.Group(); S.add(tbl);
    const darkMat = new THREE.MeshStandardMaterial({ color: '#141628', roughness: 0.4, metalness: 0.7 });
    const topGeo = new THREE.CylinderGeometry(1.25, 1.2, 0.12, 6);
    const top = new THREE.Mesh(topGeo, darkMat); top.position.y = 0.82; top.rotation.y = Math.PI / 6; tbl.add(top);
    const topEdge = new THREE.LineSegments(new THREE.EdgesGeometry(topGeo), new THREE.LineBasicMaterial({ color: BLUE.clone().multiplyScalar(3), toneMapped: false }));
    topEdge.position.copy(top.position); topEdge.rotation.copy(top.rotation); tbl.add(topEdge); this.neonMats.push(topEdge.material);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.62, 0.76, 6), darkMat); ped.position.y = 0.38; ped.rotation.y = Math.PI / 6; tbl.add(ped);
    const pedEdge = new THREE.LineSegments(new THREE.EdgesGeometry(ped.geometry), new THREE.LineBasicMaterial({ color: BLUE.clone().multiplyScalar(2), toneMapped: false }));
    pedEdge.position.copy(ped.position); pedEdge.rotation.copy(ped.rotation); tbl.add(pedEdge); this.neonMats.push(pedEdge.material);
    const cons = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.62), new THREE.MeshStandardMaterial({ color: '#07080f', roughness: 0.25, metalness: 0.85 }));
    cons.position.y = 0.96; tbl.add(cons);
    this.consCanvas = document.createElement('canvas'); this.consCanvas.width = 512; this.consCanvas.height = 160;
    this.consTex = new THREE.CanvasTexture(this.consCanvas); this.consTex.colorSpace = THREE.SRGBColorSpace;
    for (const sgn of [1, -1]) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshBasicMaterial({ map: this.consTex, toneMapped: false }));
      scr.position.set(0, 1.07, 0.2 * sgn); scr.rotation.x = -Math.PI / 2 + 0.55 * sgn; if (sgn < 0) scr.rotation.z = Math.PI;
      tbl.add(scr);
      const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.04, 20), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.9, roughness: 0.3 }));
      btnBase.position.set(0.58 * sgn, 0.9, 0.48 * sgn); tbl.add(btnBase);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.05, 20), neonMat('#ff2030', 1.6));
      btn.position.set(0.58 * sgn, 0.93, 0.48 * sgn); tbl.add(btn);
      if (sgn > 0) this.myButton = btn; else this.oppButton = btn;
    }
    this._drawConsole('Numer0n');

    // 椅子
    this.chairMe = this._chair(); this.chairMe.position.set(0, 0, 2.05); this.chairMe.rotation.y = Math.PI; S.add(this.chairMe);
    this.chairOpp = this._chair(); this.chairOpp.position.set(0, 0, -2.05); S.add(this.chairOpp);

    this.opp = this._avatar(); this.opp.position.set(0, 0, -2.0); this.opp.visible = false; S.add(this.opp);
    this.plateCanvas = document.createElement('canvas'); this.plateCanvas.width = 512; this.plateCanvas.height = 96;
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas); this.plateTex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshBasicMaterial({ map: this.plateTex, toneMapped: false, transparent: true }));
    plate.position.set(0, 0.9, -1.06); plate.rotation.x = -0.25; tbl.add(plate); this.plate = plate; plate.visible = false;

    // 光の柱（左右対称）
    this.beams = [];
    for (const sx of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 6.4, 8), neonMat('#e8f0ff', 1.6));
      beam.position.set(5.6 * sx, 3.2, -5.6); S.add(beam); this.beams.push(beam);
      const beam2 = beam.clone(); beam2.position.z = 5.6; S.add(beam2); this.beams.push(beam2);
    }

    // 天井のライト
    const flareTex = this._radialTexture();
    this.flares = [];
    for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6], [0, -4.8], [0, 4.8], [-4.8, 0], [4.8, 0]]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      sp.position.set(x, 5.7, z); sp.scale.setScalar(0.9);
      S.add(sp); this.flares.push(sp);
    }

    const N = 160, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 12; pos[i * 3 + 1] = Math.random() * 5.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 12; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.025, color: '#9fb4ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    S.add(this.dust);

    this._renderMonitorContent();
    this._drawMonitor(0);
  }

  _chair() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: '#f4f6ff', emissive: '#30344a', roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide });
    const chrome = new THREE.MeshStandardMaterial({ color: '#c8ccd8', roughness: 0.2, metalness: 1 });
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14; const a = t * Math.PI * 0.92;
      pts.push(new THREE.Vector2(Math.sin(a) * 0.52 * (1 - 0.18 * t), -Math.cos(a) * 0.6 + 0.6));
    }
    const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 32, Math.PI * 0.42, Math.PI * 1.16), white);
    shell.position.y = 0.48; shell.rotation.x = -0.18; shell.scale.set(1, 1.15, 1);
    g.add(shell);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.38, 0.08, 24), new THREE.MeshStandardMaterial({ color: '#dfe3f0', roughness: 0.5 }));
    seat.position.y = 0.56; g.add(seat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48, 12), chrome); stem.position.y = 0.26; g.add(stem);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.025, 32), chrome); base.position.y = 0.0125; g.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.46, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5a7bff').multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    return g;
  }

  _avatar() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: '#0d0f1c', roughness: 0.6, metalness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#4b66ff').multiplyScalar(1.6), side: THREE.BackSide, transparent: true, opacity: 0.45, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.42, 4, 14), body); torso.position.y = 0.98; torso.scale.set(1.15, 1, 0.75);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14), body); head.position.y = 1.47;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), body); neck.position.y = 1.33;
    g.add(torso, head, neck);
    for (const m of [torso, head]) {
      const o = new THREE.Mesh(m.geometry, glow); o.position.copy(m.position); o.scale.copy(m.scale).multiplyScalar(1.07); g.add(o);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), body);
      arm.position.set(0.22 * sx, 0.98, 0.25); arm.rotation.x = 1.15; arm.rotation.z = -0.2 * sx; g.add(arm);
    }
    this.oppHead = head;
    return g;
  }

  _floorTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(120,130,170,0.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _radialTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(220,230,255,0.85)'); g.addColorStop(0.45, 'rgba(120,140,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ---- ネオングリッド：枠線（グロー付き）は色ごとに1度だけ描いてキャッシュ ----
  _gridLayout() {
    const c = this.gridCanvas, cols = 14, rows = 6, pad = 10;
    const cw = (c.width - pad * 2) / cols, ch = (c.height - pad * 2) / rows;
    return { cols, rows, cells: (fn) => { for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) fn(i, j, pad + i * cw + cw * 0.18, pad + j * ch + ch * 0.12, cw * 0.64, ch * 0.76); } };
  }
  _gridColor(i, cols, tint) {
    if (tint) return tint;
    return `hsl(${320 - (i / (cols - 1)) * 95},95%,60%)`;
  }
  _gridBaseFor(tint) {
    const key = tint || 'default';
    if (this._gridBase[key]) return this._gridBase[key];
    const keys = Object.keys(this._gridBase); if (keys.length > 12) delete this._gridBase[keys[0]];
    const c = document.createElement('canvas'); c.width = this.gridCanvas.width; c.height = this.gridCanvas.height;
    const x = c.getContext('2d'); const L = this._gridLayout();
    L.cells((i, j, xx, yy, w, h) => {
      const col = this._gridColor(i, L.cols, tint);
      x.shadowColor = col; x.shadowBlur = 10; x.strokeStyle = col; x.lineWidth = 4;
      x.beginPath(); x.roundRect(xx, yy, w, h, 5); x.stroke();
    });
    this._gridBase[key] = c;
    return c;
  }
  _drawGrid(t, tint) {
    const c = this.gridCanvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(this._gridBaseFor(tint), 0, 0);
    const L = this._gridLayout();
    L.cells((i, j, xx, yy, w, h) => {
      const lit = this.gridCells[i * L.rows + j];
      if (lit < 0.03) return;
      x.globalAlpha = lit * 0.75; x.fillStyle = this._gridColor(i, L.cols, tint);
      x.fillRect(xx + 2, yy + 2, w - 4, h - 4);
    });
    x.globalAlpha = 1;
    this.gridTex.needsUpdate = true;
  }

  _drawConsole(text) {
    const c = this.consCanvas, x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#0a1440'); g.addColorStop(1, '#030616');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#4a6bff'; x.lineWidth = 6; x.strokeRect(3, 3, c.width - 6, c.height - 6);
    x.fillStyle = '#cfe0ff'; x.font = '700 64px Orbitron, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, c.width / 2, c.height / 2 + 4);
    this.consTex.needsUpdate = true;
  }

  _makeRays() {
    const S = 1400, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'); x.translate(S / 2, S / 2);
    for (let i = 0; i < 36; i++) {
      x.rotate(Math.PI * 2 / 36);
      x.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.14)';
      x.beginPath(); x.moveTo(0, 0); x.lineTo(S, -55); x.lineTo(S, 55); x.closePath(); x.fill();
    }
    return c;
  }

  _logoText(x, cx, cy, size) {
    if (this.logoImg && this.logoImg.complete && this.logoImg.naturalWidth) {
      const iw = this.logoImg.naturalWidth, ih = this.logoImg.naturalHeight;
      const w = size * 6, h = w * ih / iw;
      x.drawImage(this.logoImg, cx - w / 2, cy - h / 2, w, h);
      return;
    }
    x.save();
    x.font = `700 ${size}px Cinzel, "Times New Roman", serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const g = x.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
    g.addColorStop(0, '#fff8de'); g.addColorStop(0.45, '#d8c38a'); g.addColorStop(0.55, '#8d7a4a'); g.addColorStop(1, '#f2e3b0');
    x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = 12; x.shadowOffsetY = 4;
    x.fillStyle = g; x.fillText('NUMER0N', cx, cy);
    x.restore();
  }

  /** モニターの文字部分（状態が変わった時だけ描く） */
  _renderMonitorContent() {
    if (!this._monContent) { this._monContent = document.createElement('canvas'); this._monContent.width = 1024; this._monContent.height = 576; }
    const c = this._monContent, x = c.getContext('2d'), W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    const st = this.monitorState;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (st.mode === 'logo') {
      this._logoText(x, W / 2, H / 2, 150);
    } else if (st.mode === 'call') {
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(0, 70, W, H - 140);
      x.fillStyle = '#9fb6ff'; x.font = '700 40px Orbitron, "M PLUS 1p", sans-serif'; x.fillText((st.who || '') + '  CALL', W / 2, 120);
      x.fillStyle = '#fff'; x.font = '900 170px Orbitron, sans-serif'; x.shadowColor = '#7f9cff'; x.shadowBlur = 25;
      x.fillText(st.num || '', W / 2, 270); x.shadowBlur = 0;
      if (st.eat != null) {
        x.font = '900 70px Orbitron, sans-serif';
        x.fillStyle = '#ff5a6e'; x.fillText(`${st.eat} EAT`, W / 2 - 190, 430);
        x.fillStyle = '#5ad1ff'; x.fillText(`${st.bite} BITE`, W / 2 + 190, 430);
      }
    } else if (st.mode === 'text') {
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(0, 120, W, H - 240);
      x.fillStyle = '#fff'; x.font = `900 ${st.size || 110}px Orbitron, "M PLUS 1p", sans-serif`; x.shadowColor = st.color || '#7f9cff'; x.shadowBlur = 30;
      x.fillText(st.big || '', W / 2, H / 2 - (st.small ? 30 : 0)); x.shadowBlur = 0;
      if (st.small) { x.font = '700 44px "M PLUS 1p", Orbitron, sans-serif'; x.fillStyle = '#dfe6ff'; x.fillText(st.small, W / 2, H / 2 + 85); }
    }
  }

  _drawMonitor(t) {
    const c = this.monCanvas, x = c.getContext('2d'), W = c.width, H = c.height;
    // 待機中（ロゴ表示）は用意された画像をそのまま映す
    if (this.monitorState.mode === 'logo' && this.monitorImg && this.monitorImg.naturalWidth) {
      if (this._monImgDrawn) return;
      x.drawImage(this.monitorImg, 0, 0, W, H);
      this._monImgDrawn = true;
      this.monTex.needsUpdate = true;
      return;
    }
    this._monImgDrawn = false;
    const bgCol = this.monitorState.color || '#6a1cb0';
    const g = x.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.08, bgCol); g.addColorStop(1, '#0a0420');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate(t * 0.15);
    x.drawImage(this._raysCanvas, -700, -700); x.restore();
    x.drawImage(this._monContent, 0, 0);
    this.monTex.needsUpdate = true;
  }

  // ---------------------------------------------------------
  //  公開API
  // ---------------------------------------------------------
  setMonitor(st) { this.monitorState = Object.assign({ mode: 'logo' }, st || {}); this._renderMonitorContent(); if (!this.video) this._drawMonitor(this.clock.elapsedTime); }
  setConsole(text) { this._drawConsole(text); }
  setFrozen(f) { this.frozen = !!f; }

  /** モニターで動画を再生。終了（または maxMs）で resolve */
  playVideo(videoEl, maxMs = 15000) {
    this.stopVideo();
    return new Promise((resolve) => {
      const tex = new THREE.VideoTexture(videoEl); tex.colorSpace = THREE.SRGBColorSpace;
      this.video = { el: videoEl, tex };
      this.monMat.map = tex; this.monMat.needsUpdate = true;
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(tm); videoEl.removeEventListener('ended', finish); this.stopVideo(); resolve(); };
      const tm = setTimeout(finish, maxMs);
      videoEl.addEventListener('ended', finish);
      try { videoEl.currentTime = 0; } catch (e) {}
      const p = videoEl.play();
      if (p && p.catch) p.catch(() => { videoEl.muted = true; videoEl.play().catch(finish); });
    });
  }
  stopVideo() {
    if (!this.video) return;
    const { el, tex } = this.video;
    try { el.pause(); } catch (e) {}
    tex.dispose();
    this.video = null;
    this.monMat.map = this.monTex; this.monMat.needsUpdate = true;
    this._drawMonitor(this.clock.elapsedTime);
  }

  setOpponent(name) {
    this.opp.visible = !!name;
    this.plate.visible = !!name;
    if (!name) return;
    const c = this.plateCanvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(6,10,30,0.85)'; x.beginPath(); x.roundRect(4, 4, c.width - 8, c.height - 8, 14); x.fill();
    x.strokeStyle = '#5a7bff'; x.lineWidth = 4; x.stroke();
    x.fillStyle = '#fff'; x.font = '700 50px "M PLUS 1p", Orbitron, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, c.width / 2, c.height / 2 + 3, c.width - 40);
    this.plateTex.needsUpdate = true;
  }

  flash(color, dur = 1.6) { this.flashColor.set(color); this.flashT = dur; this.flashDur = dur; }
  pulse(color = '#6f8cff', power = 40) { this.pulseLight.color.set(color); this.pulseLight.intensity = power; }
  pressButton(mine = true) {
    const b = mine ? this.myButton : this.oppButton;
    if (!b) return;
    b.position.y = 0.915; setTimeout(() => (b.position.y = 0.93), 180);
  }
  setCelebrate(on) { this.celebrate = on; }

  shots() {
    return {
      seat: { pos: [0, 1.38, 2.2], look: [0, 1.25, -1.4] },
      wide: { pos: [4.6, 2.7, 4.4], look: [0, 1.0, 0] },
      opp: { pos: [0.4, 1.45, 0.4], look: [0, 1.3, -2] },
      monitor: { pos: [0, 2.55, 0.6], look: [0, MON_Y + 0.05, -HALF] },
      high: { pos: [0, 4.4, 4.2], look: [0, 0.9, 0] },
    };
  }

  setShot(name, dur = 1.8) {
    this.shot = name;
    if (name === 'title' || name === 'orbit') { this.cam.t = 1; this.orbitA = this.orbitA || 0.6; return; }
    const sh = this.shots()[name]; if (!sh) return;
    this.cam.from = { pos: this.camera.position.clone(), look: this.lookAt.clone() };
    this.cam.to = { pos: new THREE.Vector3(...sh.pos), look: new THREE.Vector3(...sh.look) };
    this.cam.t = dur <= 0 ? 1 : 0; this.cam.dur = Math.max(0.01, dur);
    if (dur <= 0) { this.camera.position.copy(this.cam.to.pos); this.lookAt.copy(this.cam.to.look); }
  }

  _loop() {
    let acc = 0;
    const tick = () => {
      requestAnimationFrame(tick);
      if (document.hidden) return;
      const dt = Math.min(this.clock.getDelta(), 0.1);
      acc += dt;
      if (this.frameInterval && acc < this.frameInterval) return;
      const step = Math.min(acc, 0.1); acc = 0;
      this._update(step, this.clock.elapsedTime);
      if (this.useBloom) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  _update(dt, t) {
    const cam = this.camera;
    if (!this.frozen) {
      if (this.shot === 'title' || this.shot === 'orbit') {
        this.orbitA += dt * (this.shot === 'orbit' ? 0.25 : 0.07);
        const R = this.shot === 'orbit' ? 3.6 : 5.6, Y = this.shot === 'orbit' ? 2.0 : 2.6;
        const target = new THREE.Vector3(Math.sin(this.orbitA) * R, Y + Math.sin(t * 0.3) * 0.2, Math.cos(this.orbitA) * R);
        cam.position.lerp(target, Math.min(1, dt * 1.5));
        this.lookAt.lerp(new THREE.Vector3(0, 1.3, 0), Math.min(1, dt * 2));
      } else if (this.cam.t < 1) {
        this.cam.t = Math.min(1, this.cam.t + dt / this.cam.dur);
        const k = ease(this.cam.t);
        cam.position.lerpVectors(this.cam.from.pos, this.cam.to.pos, k);
        this.lookAt.lerpVectors(this.cam.from.look, this.cam.to.look, k);
      } else if (this.cam.to) {
        const base = this.cam.to;
        const sway = this.shot === 'seat' ? 1 : this.shot === 'monitor' ? 0.2 : 0.5;
        cam.position.set(base.pos.x + Math.sin(t * 0.35) * 0.02 * sway, base.pos.y + Math.sin(t * 0.5) * 0.012 * sway, base.pos.z);
        this.lookAt.set(base.look.x + this.mouse.x * 0.35 * sway, base.look.y - this.mouse.y * 0.18 * sway, base.look.z);
      }
      cam.lookAt(this.lookAt);
    }
    this.chairMe.visible = !((this.shot === 'seat' || this.shot === 'monitor') && this.cam.t >= 0.6);

    if (this.opp.visible) {
      this.oppHead.position.y = 1.47 + Math.sin(t * 1.4) * 0.006;
      this.opp.rotation.y = Math.sin(t * 0.4) * 0.05;
    }

    // ネオングリッド（6fps）
    const gt = Math.floor(t * 6);
    if (gt !== this._gridTick) {
      this._gridTick = gt;
      for (let i = 0; i < 84; i++) this.gridCells[i] *= 0.78;
      const n = this.celebrate ? 8 : 2;
      for (let i = 0; i < n; i++) this.gridCells[Math.floor(Math.random() * 84)] = 1;
      let tint = null;
      if (this.flashT > 0) tint = '#' + this.flashColor.getHexString();
      if (this.celebrate) tint = `hsl(${(Math.floor(t * 4) * 30) % 360},95%,60%)`;
      this._drawGrid(t, tint);
    }
    // モニター（動画再生中は描かない）
    const mt = Math.floor(t * 10);
    if (!this.video && mt !== this._monTick) { this._monTick = mt; this._drawMonitor(t); }

    let col = BLUE.clone();
    if (this.flashT > 0) {
      this.flashT -= dt;
      col.lerp(this.flashColor, Math.min(1, Math.max(0, this.flashT / this.flashDur) * 1.5));
    }
    if (this.celebrate) col.setHSL((t * 0.33) % 1, 0.9, 0.55);
    const flick = 0.93 + Math.sin(t * 13) * 0.02;
    col.multiplyScalar(2.4 * flick);
    for (const m of this.neonMats) m.color.copy(col);

    this.pulseLight.intensity *= Math.pow(0.04, dt);
    for (const b of this.beams) b.material.color.setScalar(1.5 + Math.sin(t * 3) * 0.2);
    if (this.dust.visible) this.dust.rotation.y += dt * 0.01;
  }
}
