// =============================================================
//  3D スタジオ（Three.js）
//  六角テーブル・白いエッグチェア・ネオンの壁・モニター・光の柱
// =============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BLUE = new THREE.Color('#3a5cff');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function neonMat(color, k = 2.2) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
  return m;
}

export class Studio {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.logoImg = opts.logoImg || null;
    this.lowSpec = !!opts.lowSpec;
    this.neonMats = [];
    this.clock = new THREE.Clock();
    this.mouse = { x: 0, y: 0 };
    this.shot = 'title';
    this.cam = { from: null, to: null, t: 1, dur: 1 };
    this.flashT = 0; this.flashColor = new THREE.Color('#fff'); this.celebrate = false;
    this.monitorState = { mode: 'logo' };

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowSpec ? 1 : 1.75));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04050c');
    this.scene.fog = new THREE.FogExp2('#05060f', 0.045);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 80);
    this.camera.position.set(6, 3, 6);
    this.lookAt = new THREE.Vector3(0, 1, 0);

    this._build();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    this.setShot('title', 0);
    this._loop();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // 縦長画面では画角を広げる
    this.camera.fov = w / h < 1 ? 72 : 55;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------
  //  シーン構築
  // ---------------------------------------------------------
  _build() {
    const S = this.scene;

    // ライト
    S.add(new THREE.HemisphereLight('#6a78ff', '#05050a', 0.35));
    const key = new THREE.SpotLight('#dfe6ff', 60, 14, Math.PI / 6, 0.6, 1.4);
    key.position.set(0, 6.5, 0.5); key.target.position.set(0, 0.8, 0);
    S.add(key, key.target);
    const rimL = new THREE.SpotLight('#6a7bff', 16, 12, Math.PI / 5, 0.8, 1.5);
    rimL.position.set(-4, 4, -3); rimL.target.position.set(0, 1, -2); S.add(rimL, rimL.target);
    const rimR = new THREE.SpotLight('#b070ff', 9, 12, Math.PI / 5, 0.8, 1.5);
    rimR.position.set(4, 4, 3); rimR.target.position.set(0, 1, 2); S.add(rimR, rimR.target);
    this.pulseLight = new THREE.PointLight('#4a6bff', 0, 8, 1.6);
    this.pulseLight.position.set(0, 2.2, 0); S.add(this.pulseLight);

    // 床
    const floorTex = this._floorTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: '#0b0d1a', roughness: 0.32, metalness: 0.55, map: floorTex }));
    floor.rotation.x = -Math.PI / 2; S.add(floor);

    // 六角形のステージ
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.4, 0.08, 6),
      new THREE.MeshStandardMaterial({ color: '#0d1024', roughness: 0.25, metalness: 0.7 }));
    plat.position.y = 0.04; plat.rotation.y = Math.PI / 6; S.add(plat);
    const platEdge = new THREE.LineSegments(new THREE.EdgesGeometry(plat.geometry), new THREE.LineBasicMaterial({ color: BLUE.clone().multiplyScalar(2.5), toneMapped: false }));
    platEdge.position.copy(plat.position); platEdge.rotation.copy(plat.rotation); S.add(platEdge);
    this.neonMats.push(platEdge.material);

    // 壁
    const wallMat = new THREE.MeshStandardMaterial({ color: '#0a0c1c', roughness: 0.85, metalness: 0.2 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), wallMat); back.position.set(0, 3.5, -7); S.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), wallMat); left.position.set(-7.5, 3.5, 0); left.rotation.y = Math.PI / 2; S.add(left);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), wallMat); right.position.set(7.5, 3.5, 0); right.rotation.y = -Math.PI / 2; S.add(right);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), wallMat); front.position.set(0, 3.5, 7.5); front.rotation.y = Math.PI; S.add(front);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshStandardMaterial({ color: '#05060c', roughness: 1 }));
    ceil.position.y = 6.2; ceil.rotation.x = Math.PI / 2; S.add(ceil);

    // ネオン管（壁の横ライン）
    const tube = (w, x, y, z, ry = 0, color = BLUE, h = 0.035) => {
      const m = neonMat(color, 2.4); this.neonMats.push(m);
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), m);
      t.position.set(x, y, z); t.rotation.y = ry; S.add(t); return t;
    };
    for (const y of [1.05, 4.15]) {
      tube(14.5, 0, y, -6.95);
      tube(14, -7.45, y, 0, Math.PI / 2);
      tube(14, 7.45, y, 0, Math.PI / 2);
      tube(14.5, 0, y, 7.45);
    }
    tube(14.5, 0, 5.6, -6.95, 0, new THREE.Color('#7a4dff'), 0.02);
    // 縦ライン
    for (const [x, z, ry] of [[-7.4, -6.9, 0], [7.4, -6.9, 0], [-7.4, 7.4, 0], [7.4, 7.4, 0]]) {
      const m = neonMat(BLUE, 2.4); this.neonMats.push(m);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.035, 6, 0.035), m); v.position.set(x, 3, z); v.rotation.y = ry; S.add(v);
    }

    // モニター（奥の壁 左）
    this.monCanvas = document.createElement('canvas'); this.monCanvas.width = 1024; this.monCanvas.height = 576;
    this.monTex = new THREE.CanvasTexture(this.monCanvas); this.monTex.colorSpace = THREE.SRGBColorSpace;
    const monFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.1, 0.12), new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.8, roughness: 0.3 }));
    monFrame.position.set(-3.1, 2.75, -6.88); S.add(monFrame);
    const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.9125), new THREE.MeshBasicMaterial({ map: this.monTex, toneMapped: false }));
    monScreen.position.set(-3.1, 2.75, -6.81); S.add(monScreen);
    this.monScreen = monScreen;
    // 右壁にもサブモニター
    const mon2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4625), new THREE.MeshBasicMaterial({ map: this.monTex, toneMapped: false }));
    mon2.position.set(-7.4, 2.9, -2.6); mon2.rotation.y = Math.PI / 2; S.add(mon2);

    // ナンバーパネルの壁（ネオングリッド）
    this.gridCanvas = document.createElement('canvas'); this.gridCanvas.width = 1024; this.gridCanvas.height = 600;
    this.gridTex = new THREE.CanvasTexture(this.gridCanvas); this.gridTex.colorSpace = THREE.SRGBColorSpace;
    this.gridCells = [];
    const gridMat = new THREE.MeshBasicMaterial({ map: this.gridTex, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.3), gridMat);
    grid.position.set(2.7, 2.6, -6.9); S.add(grid);
    const grid2 = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.3), gridMat);
    grid2.position.set(7.4, 2.6, 2.2); grid2.rotation.y = -Math.PI / 2; S.add(grid2);
    this.gridMat = gridMat;
    this._drawGrid(0);

    // テーブル
    const tbl = new THREE.Group(); S.add(tbl); this.table = tbl;
    const darkMat = new THREE.MeshStandardMaterial({ color: '#141628', roughness: 0.35, metalness: 0.75 });
    const topGeo = new THREE.CylinderGeometry(1.25, 1.2, 0.12, 6);
    const top = new THREE.Mesh(topGeo, darkMat); top.position.y = 0.82; top.rotation.y = Math.PI / 6; tbl.add(top);
    const topEdge = new THREE.LineSegments(new THREE.EdgesGeometry(topGeo), new THREE.LineBasicMaterial({ color: BLUE.clone().multiplyScalar(3), toneMapped: false }));
    topEdge.position.copy(top.position); topEdge.rotation.copy(top.rotation); tbl.add(topEdge); this.neonMats.push(topEdge.material);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.62, 0.76, 6), darkMat); ped.position.y = 0.38; ped.rotation.y = Math.PI / 6; tbl.add(ped);
    const pedEdge = new THREE.LineSegments(new THREE.EdgesGeometry(ped.geometry), new THREE.LineBasicMaterial({ color: BLUE.clone().multiplyScalar(2), toneMapped: false }));
    pedEdge.position.copy(ped.position); pedEdge.rotation.copy(ped.rotation); tbl.add(pedEdge); this.neonMats.push(pedEdge.material);
    // 中央コンソール
    const cons = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.62), new THREE.MeshStandardMaterial({ color: '#07080f', roughness: 0.2, metalness: 0.9 }));
    cons.position.y = 0.96; tbl.add(cons);
    this.consCanvas = document.createElement('canvas'); this.consCanvas.width = 512; this.consCanvas.height = 160;
    this.consTex = new THREE.CanvasTexture(this.consCanvas); this.consTex.colorSpace = THREE.SRGBColorSpace;
    for (const sgn of [1, -1]) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshBasicMaterial({ map: this.consTex, toneMapped: false }));
      scr.position.set(0, 1.07, 0.2 * sgn); scr.rotation.x = -Math.PI / 2 + 0.55 * sgn; if (sgn < 0) scr.rotation.z = Math.PI;
      tbl.add(scr);
      // 赤いボタン
      const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.04, 24), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.9, roughness: 0.3 }));
      btnBase.position.set(0.58, 0.9, 0.48 * sgn); tbl.add(btnBase);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.05, 24), neonMat('#ff2030', 1.6));
      btn.position.set(0.58, 0.93, 0.48 * sgn); tbl.add(btn);
      if (sgn > 0) this.myButton = btn; else this.oppButton = btn;
    }
    this._drawConsole('Numer0n');

    // 椅子
    this.chairMe = this._chair(); this.chairMe.position.set(0, 0, 2.05); this.chairMe.rotation.y = Math.PI; S.add(this.chairMe);
    this.chairOpp = this._chair(); this.chairOpp.position.set(0, 0, -2.05); S.add(this.chairOpp);

    // 対戦相手のシルエット
    this.opp = this._avatar(); this.opp.position.set(0, 0, -2.0); this.opp.visible = false; S.add(this.opp);
    this.plateCanvas = document.createElement('canvas'); this.plateCanvas.width = 512; this.plateCanvas.height = 96;
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas); this.plateTex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshBasicMaterial({ map: this.plateTex, toneMapped: false, transparent: true }));
    plate.position.set(0, 0.9, -1.06); plate.rotation.x = -0.25; tbl.add(plate); this.plate = plate; plate.visible = false;

    // 光の柱
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 5.2, 12), neonMat('#e8f0ff', 1.6));
    beam.position.set(1.9, 3.4, -1.6); S.add(beam); this.beam = beam;
    const beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.2, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#8fb0ff', transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
    beamGlow.position.copy(beam.position); S.add(beamGlow);

    // 天井のライト（フレア）
    const flareTex = this._radialTexture();
    this.flares = [];
    for (const [x, z] of [[-2.5, -1.5], [2.5, 1.5], [-3, 3], [3, -3.5], [0, -4.5], [-5, 0], [5, -0.5]]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      sp.position.set(x, 4.9 + Math.random() * 0.6, z); sp.scale.setScalar(0.9);
      S.add(sp); this.flares.push(sp);
    }

    // 漂うチリ
    const N = 260, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 12; pos[i * 3 + 1] = Math.random() * 5.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 12; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.025, color: '#9fb4ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    S.add(this.dust);

    this._drawMonitor();
  }

  _chair() {
    const g = new THREE.Group();
    const white = new THREE.MeshPhysicalMaterial({ color: '#f4f6ff', emissive: '#3a3e52', roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
    const chrome = new THREE.MeshStandardMaterial({ color: '#c8ccd8', roughness: 0.15, metalness: 1 });
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16; const a = t * Math.PI * 0.92;
      pts.push(new THREE.Vector2(Math.sin(a) * 0.52 * (1 - 0.18 * t), -Math.cos(a) * 0.6 + 0.6));
    }
    const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 40, Math.PI * 0.42, Math.PI * 1.16), white);
    shell.position.y = 0.48; shell.rotation.x = -0.18; shell.scale.set(1, 1.15, 1);
    g.add(shell);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.38, 0.08, 32), new THREE.MeshStandardMaterial({ color: '#dfe3f0', roughness: 0.5 }));
    seat.position.y = 0.56; g.add(seat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48, 16), chrome); stem.position.y = 0.26; g.add(stem);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.025, 40), chrome); base.position.y = 0.0125; g.add(base);
    // 足元のライト
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.46, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5a7bff').multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; g.add(ring);
    return g;
  }

  _avatar() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: '#0d0f1c', roughness: 0.6, metalness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#4b66ff').multiplyScalar(1.6), side: THREE.BackSide, transparent: true, opacity: 0.45, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.42, 6, 18), body); torso.position.y = 0.98; torso.scale.set(1.15, 1, 0.75);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 18), body); head.position.y = 1.47;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 12), body); neck.position.y = 1.33;
    g.add(torso, head, neck);
    for (const m of [torso, head]) {
      const o = new THREE.Mesh(m.geometry, glow); o.position.copy(m.position); o.scale.copy(m.scale).multiplyScalar(1.07); g.add(o);
    }
    // 腕（テーブルに置いた手）
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 10), body);
      arm.position.set(0.22 * sx, 0.98, 0.25); arm.rotation.x = 1.15; arm.rotation.z = -0.2 * sx; g.add(arm);
    }
    this.oppHead = head; this.oppTorso = torso;
    return g;
  }

  _floorTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = 'rgba(120,130,170,0.35)'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 512); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(512, i * 64); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  _radialTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(220,230,255,0.85)'); g.addColorStop(0.45, 'rgba(120,140,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  _drawGrid(t, tint) {
    const c = this.gridCanvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    const cols = 14, rows = 6, pad = 14;
    const cw = (c.width - pad * 2) / cols, ch = (c.height - pad * 2) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const k = i / (cols - 1);
        let col;
        if (tint) col = tint;
        else {
          const hue = 320 - k * 95 + Math.sin(t * 0.6 + j * 0.5) * 8; // ピンク→紫→青
          col = `hsl(${hue},95%,${58 + Math.sin(t * 2 + i * 0.7 + j) * 6}%)`;
        }
        const lit = this.gridCells[i * rows + j] || 0;
        const xx = pad + i * cw + cw * 0.18, yy = pad + j * ch + ch * 0.12, w = cw * 0.64, h = ch * 0.76;
        x.shadowColor = col; x.shadowBlur = 14;
        x.strokeStyle = col; x.lineWidth = 5;
        x.beginPath(); x.roundRect(xx, yy, w, h, 6); x.stroke();
        if (lit > 0.02) { x.globalAlpha = lit * 0.75; x.fillStyle = col; x.fill(); x.globalAlpha = 1; }
      }
    }
    x.shadowBlur = 0;
    this.gridTex.needsUpdate = true;
  }

  _drawConsole(text) {
    const c = this.consCanvas, x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#0a1440'); g.addColorStop(1, '#030616');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#4a6bff'; x.lineWidth = 6; x.strokeRect(3, 3, c.width - 6, c.height - 6);
    x.fillStyle = '#cfe0ff'; x.font = '700 64px Orbitron, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#6f8cff'; x.shadowBlur = 18;
    x.fillText(text, c.width / 2, c.height / 2 + 4);
    this.consTex.needsUpdate = true;
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
    x.fillStyle = g; x.fillText('Numer0n', cx, cy);
    x.shadowColor = 'transparent'; x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,0.35)'; x.strokeText('Numer0n', cx, cy);
    x.restore();
  }

  _drawMonitor(t = 0) {
    const c = this.monCanvas, x = c.getContext('2d'), W = c.width, H = c.height;
    const st = this.monitorState;
    const bgCol = st.color || '#6a1cb0';
    const g = x.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.08, bgCol); g.addColorStop(1, '#0a0420');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // 放射線
    x.save(); x.translate(W / 2, H / 2); x.rotate(t * 0.15);
    for (let i = 0; i < 36; i++) {
      x.rotate(Math.PI * 2 / 36);
      x.fillStyle = i % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
      x.beginPath(); x.moveTo(0, 0); x.lineTo(W, -40); x.lineTo(W, 40); x.closePath(); x.fill();
    }
    x.restore();
    // 走査線
    x.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 2);

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
    this.monTex.needsUpdate = true;
  }

  // ---------------------------------------------------------
  //  公開API
  // ---------------------------------------------------------
  setMonitor(st) { this.monitorState = Object.assign({ mode: 'logo' }, st || {}); this._drawMonitor(this.clock.elapsedTime); }
  setConsole(text) { this._drawConsole(text); }

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

  /** ネオン全体を一瞬その色に */
  flash(color, dur = 1.6) {
    this.flashColor.set(color);
    this.flashT = dur; this.flashDur = dur;
  }
  pulse(color = '#6f8cff', power = 40) {
    this.pulseLight.color.set(color); this.pulseLight.intensity = power;
  }
  pressButton(mine = true) {
    const b = mine ? this.myButton : this.oppButton;
    if (!b) return;
    b.position.y = 0.915; setTimeout(() => (b.position.y = 0.93), 180);
  }
  setCelebrate(on) { this.celebrate = on; }

  shots() {
    return {
      seat: { pos: [0, 1.38, 2.2], look: [0, 1.02, -1.4] },
      wide: { pos: [4.6, 2.7, 4.4], look: [0, 1.0, 0] },
      side: { pos: [3.4, 1.6, 0.2], look: [-0.5, 1.1, 0] },
      opp: { pos: [0.4, 1.45, 0.4], look: [0, 1.3, -2] },
      monitor: { pos: [-1.6, 2.4, -2.2], look: [-3.1, 2.75, -6.8] },
      high: { pos: [0, 4.6, 3.0], look: [0, 0.8, 0] },
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
    const tick = () => {
      requestAnimationFrame(tick);
      if (document.hidden) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      this._update(dt, t);
      this.composer.render();
    };
    tick();
  }

  _update(dt, t) {
    const cam = this.camera;
    if (this.shot === 'title' || this.shot === 'orbit') {
      this.orbitA += dt * (this.shot === 'orbit' ? 0.25 : 0.07);
      const R = this.shot === 'orbit' ? 3.6 : 6.2, Y = this.shot === 'orbit' ? 2.0 : 2.7;
      const target = new THREE.Vector3(Math.sin(this.orbitA) * R, Y + Math.sin(t * 0.3) * 0.2, Math.cos(this.orbitA) * R);
      cam.position.lerp(target, Math.min(1, dt * 1.5));
      this.lookAt.lerp(new THREE.Vector3(0, 1.1, 0), Math.min(1, dt * 2));
    } else if (this.cam.t < 1) {
      this.cam.t = Math.min(1, this.cam.t + dt / this.cam.dur);
      const k = ease(this.cam.t);
      cam.position.lerpVectors(this.cam.from.pos, this.cam.to.pos, k);
      this.lookAt.lerpVectors(this.cam.from.look, this.cam.to.look, k);
    } else if (this.cam.to) {
      // 待機中のゆらぎ＋マウスでちょっと見回す
      const base = this.cam.to;
      const sway = this.shot === 'seat' ? 1 : 0.5;
      cam.position.set(base.pos.x + Math.sin(t * 0.35) * 0.02 * sway, base.pos.y + Math.sin(t * 0.5) * 0.012 * sway, base.pos.z);
      this.lookAt.set(base.look.x + this.mouse.x * 0.35 * sway, base.look.y - this.mouse.y * 0.18 * sway, base.look.z);
    }
    cam.lookAt(this.lookAt);
    // 自分の席から見るときは自分の椅子を隠す
    this.chairMe.visible = !(this.shot === 'seat' && this.cam.t >= 0.6);

    // 相手の呼吸
    if (this.opp.visible) {
      this.oppHead.position.y = 1.47 + Math.sin(t * 1.4) * 0.006;
      this.opp.rotation.y = Math.sin(t * 0.4) * 0.05;
    }

    // ネオングリッド
    if (Math.floor(t * 8) !== this._gridTick) {
      this._gridTick = Math.floor(t * 8);
      for (let i = 0; i < 84; i++) this.gridCells[i] = (this.gridCells[i] || 0) * 0.82;
      const n = this.celebrate ? 10 : 2;
      for (let i = 0; i < n; i++) this.gridCells[Math.floor(Math.random() * 84)] = 1;
      let tint = null;
      if (this.flashT > 0) tint = '#' + this.flashColor.getHexString();
      if (this.celebrate) tint = `hsl(${(t * 120) % 360},95%,60%)`;
      this._drawGrid(t, tint);
    }
    if (Math.floor(t * 12) !== this._monTick) { this._monTick = Math.floor(t * 12); this._drawMonitor(t); }

    // ネオンの色
    let col = BLUE.clone();
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / this.flashDur);
      col.lerp(this.flashColor, Math.min(1, k * 1.5));
    }
    if (this.celebrate) col.setHSL((t * 0.33) % 1, 0.9, 0.55);
    const flick = 0.92 + Math.sin(t * 13) * 0.02 + (Math.random() < 0.004 ? -0.4 : 0);
    for (const m of this.neonMats) m.color.copy(col).multiplyScalar(2.4 * flick);

    this.pulseLight.intensity *= Math.pow(0.04, dt);
    this.beam.material.color.setScalar(1.5 + Math.sin(t * 3) * 0.2);
    for (let i = 0; i < this.flares.length; i++) this.flares[i].material.opacity = 0.75 + Math.sin(t * 1.3 + i) * 0.2;
    this.dust.rotation.y += dt * 0.01;
  }
}
