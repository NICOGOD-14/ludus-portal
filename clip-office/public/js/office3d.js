// Oficina 3D renderizada en tiempo real (Three.js): escritorios, agentes animados, pantallas en vivo.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const LIME = 0xc6ff00;
let renderer, labelRenderer, scene, camera, controls, composer, clock;
const agents = new Map(); // id -> { group, body, head, armL, armR, screen, ctx, tex, label, data, state }
const blinkers = [];
let tween = null;
let kpi = null;
let onSelectCb = () => {};
let focused = null;

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });
function box(w, h, d, m, x = 0, y = 0, z = 0, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent?.add(mesh);
  return mesh;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, parent, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  parent?.add(mesh);
  return mesh;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw?.(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { c, ctx, tex };
}

// ---------- ambiente ----------
function buildRoom() {
  // piso
  const floorT = canvasTex(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#2b2420'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) for (let x = (y / 64) % 2 ? -128 : 0; x < w; x += 256) {
      const l = 30 + Math.random() * 14;
      ctx.fillStyle = `hsl(24, 16%, ${l * 0.5}%)`; ctx.fillRect(x + 1, y + 1, 254, 62);
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#000';
      for (let k = 0; k < 6; k++) ctx.fillRect(x, y + Math.random() * 64, 256, 1);
      ctx.globalAlpha = 1;
    }
  });
  floorT.tex.wrapS = floorT.tex.wrapT = THREE.RepeatWrapping;
  floorT.tex.repeat.set(4, 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 24), mat(0xffffff, { map: floorT.tex, roughness: 0.42, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  // alfombra central con borde neón
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(15, 10), mat(0x161616, { roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.005, -0.5); rug.receiveShadow = true; scene.add(rug);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(15, 10)), new THREE.LineBasicMaterial({ color: LIME }));
  edge.rotation.x = -Math.PI / 2; edge.position.set(0, 0.012, -0.5); scene.add(edge);

  // paredes
  const wallM = mat(0x1b1b1f, { roughness: 0.85 });
  box(26, 5, 0.3, wallM, 0, 2.5, -11);
  box(0.3, 5, 24, wallM, -13, 2.5, 0);
  box(0.3, 5, 24, wallM, 13, 2.5, 0);
  // ventanal con atardecer de "Vice City" en la pared del fondo
  const sky = canvasTex(2048, 640, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a0b4d'); g.addColorStop(0.45, '#ff3d7f'); g.addColorStop(0.75, '#ff9f43'); g.addColorStop(1, '#ffd36b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,240,180,.95)'; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.66, 120, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3d7f'; for (let i = 0; i < 6; i++) ctx.fillRect(w * 0.62 - 140, h * 0.62 + i * 22, 280, 7);
    // skyline
    ctx.fillStyle = '#1a0830';
    let x = 0;
    while (x < w) { const bw = 40 + Math.random() * 90; const bh = 80 + Math.random() * 260; ctx.fillRect(x, h - bh, bw, bh); x += bw + 4; }
    ctx.fillStyle = 'rgba(255,220,120,.7)';
    for (let i = 0; i < 400; i++) ctx.fillRect(Math.random() * w, h - Math.random() * 250, 3, 4);
    // palmeras
    const palm = (px, s) => {
      ctx.strokeStyle = '#12051f'; ctx.lineWidth = 10 * s; ctx.beginPath(); ctx.moveTo(px, h); ctx.quadraticCurveTo(px + 30 * s, h - 200 * s, px + 10 * s, h - 330 * s); ctx.stroke();
      ctx.fillStyle = '#12051f';
      for (let a = 0; a < 7; a++) { ctx.save(); ctx.translate(px + 10 * s, h - 330 * s); ctx.rotate(-Math.PI + a * (Math.PI / 6)); ctx.beginPath(); ctx.ellipse(70 * s, 0, 80 * s, 14 * s, 0.25, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    };
    [120, 420, 1500, 1820].forEach((p, i) => palm(p, 0.9 + (i % 2) * 0.3));
  });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2), new THREE.MeshBasicMaterial({ map: sky.tex }));
  win.position.set(3.5, 2.5, -10.84); scene.add(win);
  const frameM = mat(0x0c0c0c, { metalness: 0.6, roughness: 0.3 });
  for (let i = 0; i <= 5; i++) box(0.08, 3.3, 0.1, frameM, 3.5 - 7 + i * 2.8, 2.5, -10.8);
  box(14.1, 0.1, 0.12, frameM, 3.5, 4.12, -10.8); box(14.1, 0.1, 0.12, frameM, 3.5, 0.88, -10.8);
  const warm = new THREE.PointLight(0xff7a59, 18, 14, 1.6); warm.position.set(3.5, 2.6, -9.5); scene.add(warm);

  // letrero de neón
  const neon = canvasTex(1024, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 92px "Space Grotesk", Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#C6FF00'; ctx.shadowBlur = 24; ctx.fillStyle = '#C6FF00'; ctx.fillText('LUDUS CLIP OFFICE', w / 2, h / 2);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.95), new THREE.MeshBasicMaterial({ map: neon.tex, transparent: true, color: new THREE.Color(1.6, 1.6, 1.6) }));
  sign.position.set(-12.82, 3.3, -2); sign.rotation.y = Math.PI / 2; scene.add(sign);

  // pantalla KPI gigante
  kpi = canvasTex(1024, 512);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshBasicMaterial({ map: kpi.tex, toneMapped: false }));
  scr.position.set(-7.6, 2.6, -10.82); scene.add(scr);
  box(5.4, 2.8, 0.12, frameM, -7.6, 2.6, -10.9);
  drawKpi({});

  // paneles de luz en techo
  const panelM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 0.85) });
  for (const [x, z] of [[-6, -6], [0, -6], [6, -6], [-6, 0], [0, 0], [6, 0], [-3, 5], [3, 5]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.25), panelM); p.position.set(x, 4.9, z); scene.add(p);
  }

  // rack de render con leds
  const rackM = mat(0x111114, { metalness: 0.7, roughness: 0.35 });
  for (let r = 0; r < 3; r++) {
    const rack = box(0.9, 2.4, 1, rackM, -12.2, 1.2, 5 + r * 1.1);
    for (let i = 0; i < 14; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: i % 3 ? LIME : 0x4dd6ff }));
      led.position.set(0.46, -1 + i * 0.14, -0.3 + (i % 4) * 0.18); rack.add(led); blinkers.push(led);
    }
  }
  const rackLabel = makeTextSprite('RENDER FARM', '#C6FF00'); rackLabel.position.set(-12.2, 2.75, 6.1); scene.add(rackLabel);

  // zona lounge
  const sofaM = mat(0x2d2d3a, { roughness: 0.9 });
  const sofa = new THREE.Group();
  box(3, 0.45, 1, sofaM, 0, 0.32, 0, sofa); box(3, 0.7, 0.25, sofaM, 0, 0.75, -0.4, sofa); box(0.25, 0.6, 1, sofaM, -1.4, 0.55, 0, sofa); box(0.25, 0.6, 1, sofaM, 1.4, 0.55, 0, sofa);
  sofa.position.set(9.5, 0, 8); sofa.rotation.y = -Math.PI / 2 + 0.3; scene.add(sofa);
  cyl(0.6, 0.6, 0.06, mat(0x0d0d0d, { metalness: 0.5 }), 8.2, 0.45, 7.5, scene);
  cyl(0.05, 0.05, 0.45, frameM, 8.2, 0.22, 7.5, scene);
  // máquina de café
  box(0.6, 0.9, 0.5, mat(0x222222, { metalness: 0.8, roughness: 0.25 }), 12.3, 1.35, -8.5);
  box(1.2, 0.9, 0.7, mat(0x3a2a20), 12.3, 0.45, -8.5);
  const cafeL = makeTextSprite('☕ CAFÉ', '#ffd23f'); cafeL.position.set(12.3, 2.2, -8.5); scene.add(cafeL);

  // plantas
  for (const [x, z, s] of [[-12, -10, 1.3], [12, -10, 1.2], [-12, 10, 1], [12, 3, 1.1], [-4.8, -9.8, 0.9], [11.5, 10.5, 1.2]]) plant(x, z, s);
}

function plant(x, z, s = 1) {
  const g = new THREE.Group();
  cyl(0.28, 0.22, 0.55, mat(0xd9d4c7, { roughness: 0.8 }), 0, 0.27, 0, g);
  const leafM = mat(0x2f8f4e, { roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), leafM);
    leaf.scale.set(0.6, 1.6, 0.25);
    const a = (i / 9) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.18, 0.85 + (i % 3) * 0.12, Math.sin(a) * 0.18);
    leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    leaf.castShadow = true; g.add(leaf);
  }
  g.scale.setScalar(s); g.position.set(x, 0, z); scene.add(g);
}

function makeTextSprite(text, color = '#fff') {
  const t = canvasTex(512, 96, (ctx, w, h) => { ctx.font = 'bold 54px "Space Grotesk", Arial'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  return s;
}

export function drawKpi(stats) {
  if (!kpi) return;
  const { ctx, c } = kpi;
  const w = c.width, h = c.height;
  ctx.fillStyle = '#07090a'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(198,255,0,.15)';
  for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.fillStyle = '#C6FF00'; ctx.font = 'bold 34px "Space Grotesk", Arial'; ctx.fillText('📊 CENTRO DE CONTROL', 30, 56);
  ctx.font = '22px "IBM Plex Mono", monospace'; ctx.fillStyle = '#8a8a8a'; ctx.fillText(new Date().toLocaleString('es'), 30, 92);
  const items = [
    ['Clips', stats.clips ?? 0], ['Datos curiosos', stats.stories ?? 0], ['Listos', stats.ready ?? 0], ['Publicados', stats.published ?? 0],
    ['Trabajos activos', stats.jobs ?? 0], ['Seguidores', stats.followers ?? '—'], ['Views', stats.views ?? '—'], ['Likes', stats.likes ?? '—'],
  ];
  items.forEach(([k, v], i) => {
    const x = 30 + (i % 4) * 245, y = 150 + Math.floor(i / 4) * 160;
    ctx.fillStyle = '#111'; ctx.fillRect(x, y, 228, 140);
    ctx.fillStyle = '#8a8a8a'; ctx.font = '22px "Space Grotesk", Arial'; ctx.fillText(k, x + 16, y + 38);
    ctx.fillStyle = i >= 5 ? '#4dd6ff' : '#ffffff'; ctx.font = 'bold 58px "Space Grotesk", Arial'; ctx.fillText(String(v), x + 16, y + 108);
  });
  kpi.tex.needsUpdate = true;
}

// ---------- escritorios y agentes ----------
function buildDesk(a) {
  const g = new THREE.Group();
  const boss = a.desk.boss;
  const wood = mat(boss ? 0x3b2a1d : 0x8d877d, { roughness: 0.55 });
  const metal = mat(0x222222, { metalness: 0.8, roughness: 0.3 });
  const W = boss ? 2.6 : 1.7;
  box(W, 0.06, 0.85, wood, 0, 0.76, 0, g);
  for (const sx of [-1, 1]) box(0.05, 0.74, 0.75, metal, sx * (W / 2 - 0.08), 0.37, 0, g);
  if (boss) box(W - 0.2, 0.6, 0.04, wood, 0, 0.45, -0.38, g);
  // monitores
  const nMon = boss ? 2 : 1;
  let screenInfo = null;
  for (let m = 0; m < nMon; m++) {
    const mx = nMon === 1 ? 0 : (m - 0.5) * 0.95;
    const mon = new THREE.Group();
    box(0.84, 0.5, 0.04, metal, 0, 0, 0, mon);
    const s = canvasTex(320, 190);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.46), new THREE.MeshBasicMaterial({ map: s.tex, toneMapped: false }));
    screen.position.z = 0.022; mon.add(screen);
    box(0.06, 0.3, 0.06, metal, 0, -0.38, -0.03, mon);
    box(0.3, 0.02, 0.2, metal, 0, -0.52, -0.03, mon);
    mon.position.set(mx, 1.31, -0.2);
    if (nMon === 2) mon.rotation.y = -(m - 0.5) * 0.35;
    g.add(mon);
    if (m === 0) screenInfo = s; else drawSecondary(s, a);
  }
  // teclado, mouse, taza
  box(0.5, 0.02, 0.16, mat(0x1a1a1a), 0, 0.8, 0.12, g);
  box(0.07, 0.025, 0.11, mat(0x1a1a1a), 0.38, 0.8, 0.13, g);
  cyl(0.045, 0.04, 0.1, mat(new THREE.Color(a.color)), -0.6 * (W / 1.7), 0.84, 0.05, g);
  // luz de acento de cada agente bajo el escritorio
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.015, 0.015), new THREE.MeshBasicMaterial({ color: new THREE.Color(a.color).multiplyScalar(2) }));
  strip.position.set(0, 0.72, 0.42); g.add(strip);
  // silla
  const chair = new THREE.Group();
  const chM = mat(0x151515, { roughness: 0.7 });
  box(0.55, 0.08, 0.55, chM, 0, 0.5, 0, chair);
  box(0.55, 0.7, 0.07, chM, 0, 0.9, 0.27, chair);
  cyl(0.03, 0.03, 0.42, metal, 0, 0.25, 0, chair);
  for (let k = 0; k < 5; k++) { const leg = box(0.32, 0.03, 0.04, metal, 0, 0.04, 0, chair); leg.rotation.y = (k / 5) * Math.PI * 2; leg.position.set(Math.cos((k / 5) * Math.PI * 2) * 0.14, 0.04, -Math.sin((k / 5) * Math.PI * 2) * 0.14); }
  chair.position.set(0, 0, 0.75);
  g.add(chair);
  g.position.set(a.desk.x, 0, a.desk.z);
  g.rotation.y = a.desk.rot;
  scene.add(g);
  return { g, chair, screenInfo };
}

function drawSecondary(s, a) {
  const { ctx, c } = s;
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#C6FF00'; ctx.lineWidth = 3; ctx.beginPath();
  for (let x = 0; x < c.width; x += 8) ctx.lineTo(x, 120 - Math.sin(x / 20) * 20 - x / 6);
  ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial'; ctx.fillText('VIEWS ↗', 16, 34);
  s.tex.needsUpdate = true;
}

function buildCharacter(a) {
  const g = new THREE.Group();
  const shirt = mat(new THREE.Color(a.shirt), { roughness: 0.75 });
  const skin = mat(new THREE.Color(a.skin), { roughness: 0.55 });
  const hair = mat(new THREE.Color(a.hair), { roughness: 0.8 });
  const pants = mat(0x1d2230, { roughness: 0.8 });
  // piernas sentadas
  for (const sx of [-0.1, 0.1]) {
    box(0.13, 0.13, 0.42, pants, sx, 0.6, -0.18, g);
    box(0.12, 0.45, 0.12, pants, sx, 0.33, -0.38, g);
    box(0.13, 0.07, 0.2, mat(0x111111), sx, 0.08, -0.43, g);
  }
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.32, 6, 14), shirt);
  body.position.set(0, 0.98, 0.02); body.castShadow = true; g.add(body);
  // logo del agente en la camiseta
  const head = new THREE.Group();
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), skin); face.castShadow = true; head.add(face);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.182, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  hairM.rotation.x = 0.55; hairM.position.z = 0.012; hairM.castShadow = true; head.add(hairM);
  const white = mat(0xffffff, { roughness: 0.3 });
  const pupil = mat(0x111111, { roughness: 0.15 });
  for (const sx of [-0.06, 0.06]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), white); eye.position.set(sx, 0.02, -0.148); eye.scale.z = 0.6; head.add(eye);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), pupil); pu.position.set(sx, 0.02, -0.168); head.add(pu);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16, Math.PI), mat(0x7a2e2e));
  smile.position.set(0, -0.06, -0.158); smile.rotation.z = Math.PI; head.add(smile);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin); nose.position.set(0, -0.015, -0.17); head.add(nose);
  head.position.set(0, 1.42, -0.02);
  g.add(head);
  const mkArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.25, 1.2, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.26, 4, 10), shirt);
    upper.position.y = -0.17; upper.castShadow = true; pivot.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin); hand.position.y = -0.36; pivot.add(hand);
    pivot.rotation.x = -1.05; pivot.rotation.z = sx * 0.12;
    g.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  // anillo de estado en el piso
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
  g.traverse((o) => { o.userData.agentId = a.id; });
  return { g, body, head, armL, armR, ring };
}

function drawScreen(entry) {
  const { ctx, c, tex } = entry.screenInfo;
  const { data, state } = entry;
  const w = c.width, h = c.height;
  const working = state.status === 'working';
  ctx.fillStyle = working ? '#0b1200' : state.status === 'error' ? '#1a0505' : '#0b0b0f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = data.color; ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#000'; ctx.font = 'bold 18px Arial'; ctx.fillText(`${data.emoji} ${data.role}`.slice(0, 30), 10, 23);
  ctx.fillStyle = '#e8e8e8'; ctx.font = '17px Arial';
  const words = (state.task || '').split(' ');
  let line = '', y = 62;
  for (const wd of words) {
    if (ctx.measureText(line + wd).width > w - 20) { ctx.fillText(line, 10, y); line = ''; y += 22; if (y > 140) break; }
    line += wd + ' ';
  }
  if (y <= 140) ctx.fillText(line, 10, y);
  if (working) {
    ctx.fillStyle = '#222'; ctx.fillRect(10, h - 26, w - 20, 12);
    ctx.fillStyle = '#C6FF00'; ctx.fillRect(10, h - 26, (w - 20) * Math.min(1, (state.progress || 0) / 100), 12);
  } else {
    ctx.fillStyle = '#555'; ctx.font = '14px monospace'; ctx.fillText(state.status === 'error' ? '⚠ revisar' : '● en espera', 10, h - 14);
  }
  tex.needsUpdate = true;
}

function statusColor(s) { return s === 'working' ? LIME : s === 'talking' ? 0x4dd6ff : s === 'error' ? 0xff4d4d : 0x444444; }

function makeLabel(a) {
  const el = document.createElement('div');
  el.className = 'label3d';
  el.innerHTML = `<div class="tag"><span class="dot"></span>${a.emoji} ${a.name.split(' ')[0]}</div><br><div class="bubble"></div>`;
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); onSelectCb(a.id); });
  const obj = new CSS2DObject(el);
  obj.position.set(0, 1.95, 0);
  return { obj, el };
}

export function updateAgent(id, state) {
  const e = agents.get(id);
  if (!e) return;
  e.state = { ...e.state, ...state };
  drawScreen(e);
  e.ring.material.color.setHex(statusColor(e.state.status));
  const dot = e.label.el.querySelector('.dot');
  dot.style.background = '#' + new THREE.Color(statusColor(e.state.status)).getHexString();
  e.label.el.querySelector('.bubble').textContent = e.state.status === 'working' ? e.state.task : e.state.status === 'talking' ? '💬 hablando contigo…' : '';
}

// ---------- cámara ----------
const HOME = { pos: new THREE.Vector3(0, 13, 15.5), target: new THREE.Vector3(0, 0.6, -1) };
function animateCamera(pos, target, dur = 1.1) {
  tween = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, t: 0, dur };
}

export function focusAgent(id) {
  const e = agents.get(id);
  if (!e) return;
  focused = id;
  const head = new THREE.Vector3();
  e.head.getWorldPosition(head);
  const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.data.desk.rot);
  const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.data.desk.rot);
  const pos = head.clone().add(back.multiplyScalar(0.7)).add(side.multiplyScalar(-2.5)).add(new THREE.Vector3(0, 0.45, 0));
  animateCamera(pos, head.clone().add(new THREE.Vector3(0, -0.25, 0)));
}
// en pantallas verticales (celular) la cámara se aleja para que entre toda la oficina
function homePos() { const k = Math.max(1, 1.25 / (camera?.aspect || 1.6)); return HOME.target.clone().add(HOME.pos.clone().sub(HOME.target).multiplyScalar(k)); }
export function overview() { focused = null; animateCamera(homePos(), HOME.target.clone()); }

// ---------- init ----------
export function initOffice(container, agentList, { onSelect } = {}) {
  onSelectCb = onSelect || onSelectCb;
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  container.appendChild(renderer.domElement);
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.Fog(0x0a0a0c, 22, 42);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.copy(homePos());
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 2.5; controls.maxDistance = 30;

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2018, 0.45));
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
  sun.position.set(6, 14, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 40 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.PointLight(LIME, 3, 12, 2); fill.position.set(0, 3.5, -1); scene.add(fill);

  buildRoom();
  for (const a of agentList) {
    const desk = buildDesk(a);
    const ch = buildCharacter(a);
    desk.chair.add(ch.g);
    ch.g.position.set(0, 0, -0.05);
    const label = makeLabel(a);
    ch.g.add(label.obj);
    const entry = { data: a, state: a.state || { status: 'idle', task: 'Esperando trabajo', progress: 0 }, screenInfo: desk.screenInfo, chair: desk.chair, deskGroup: desk.g, ...ch, label, phase: Math.random() * 10 };
    agents.set(a.id, entry);
    updateAgent(a.id, entry.state);
  }

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.42, 0.45, 0.96));
  composer.addPass(new OutputPass());

  // clic sobre agentes (sin arrastrar)
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...agents.values()].map((x) => x.g), true)[0];
    if (hit?.object.userData.agentId) onSelectCb(hit.object.userData.agentId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...agents.values()].map((x) => x.g), true)[0];
    renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  });

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); labelRenderer.setSize(w, h); composer.setSize(w, h);
  };
  new ResizeObserver(resize).observe(container);
  renderer.setAnimationLoop(loop);
}

function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (tween) {
    tween.t += dt / tween.dur;
    const k = ease(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.from, tween.to, k);
    controls.target.lerpVectors(tween.tFrom, tween.tTo, k);
    if (tween.t >= 1) tween = null;
  }
  for (const e of agents.values()) {
    const s = e.state.status;
    const p = t + e.phase;
    e.body.scale.y = 1 + Math.sin(p * 2) * 0.012; // respira
    if (s === 'working') {
      e.armL.rotation.x = -1.05 + Math.sin(p * 18) * 0.08;
      e.armR.rotation.x = -1.05 + Math.sin(p * 18 + 1.6) * 0.08;
      e.head.rotation.x = 0.12 + Math.sin(p * 1.3) * 0.03;
      e.head.rotation.y = Math.sin(p * 0.7) * 0.08;
      e.chair.rotation.y = Math.sin(p * 0.5) * 0.04;
    } else if (s === 'talking' || focused === e.data.id) {
      e.head.rotation.y = Math.sin(p * 2.5) * 0.25;
      e.head.rotation.x = Math.sin(p * 6) * 0.06;
      e.armR.rotation.x = -0.6 + Math.sin(p * 3) * 0.3;
      e.chair.rotation.y = THREE.MathUtils.lerp(e.chair.rotation.y, Math.PI * 0.5, Math.min(1, dt * 4));
      if (s !== 'talking') { e.head.rotation.y *= 0.3; e.armR.rotation.x = THREE.MathUtils.lerp(e.armR.rotation.x, -0.5, 0.05); }
    } else {
      e.armL.rotation.x = THREE.MathUtils.lerp(e.armL.rotation.x, -0.5, 0.05);
      e.armR.rotation.x = THREE.MathUtils.lerp(e.armR.rotation.x, -0.5, 0.05);
      e.head.rotation.y = Math.sin(p * 0.4) * 0.35;
      e.head.rotation.x = -0.05;
      e.chair.rotation.y = Math.sin(p * 0.25) * 0.25;
    }
    e.ring.scale.setScalar(s === 'working' ? 1 + Math.sin(p * 4) * 0.06 : 1);
    if (focused === e.data.id) e.ring.material.opacity = 0.6 + Math.sin(t * 5) * 0.35;
  }
  blinkers.forEach((b, i) => { b.visible = Math.sin(t * (3 + (i % 5)) + i) > -0.3; });
  controls.update();
  composer.render();
  labelRenderer.render(scene, camera);
}
