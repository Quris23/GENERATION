// The animated background: floating End islands built of voxels, obsidian pillars with crystals, chorus plants,
// drifting End particles and stars, seen by a camera slowly circling them. Everything is generated here: no game
// textures are used.
import * as THREE from 'three';

const canvas = document.getElementById('bg');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x120a1e, 0.0042);
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1200);
const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;

// seeded random, so the islands are the same every launch
let seed = 20261231;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const range = (a, b) => a + (b - a) * rnd();

// ---- sky -----------------------------------------------------------------------------------------------------------------
{
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#04020a');
  grad.addColorStop(0.55, '#1a0b2e');
  grad.addColorStop(0.75, '#2a1240');
  grad.addColorStop(1, '#0a0612');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

const stars = (() => {
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(range(-1, 1), range(-0.3, 1), range(-1, 1)).normalize().multiplyScalar(700);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe9ddff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  scene.add(pts);
  return pts;
})();

// ---- light ---------------------------------------------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xc9b6ff, 0x2a1438, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
sun.position.set(80, 140, 60);
scene.add(sun);

// ---- voxels: every island's cubes go into one instanced mesh ----------------------------------------------------------------
const endStone = ['#e3e4ab', '#d8da9c', '#eceeb9', '#cfd18f', '#dcdda2'].map(c => new THREE.Color(c));
const chorusStem = new THREE.Color('#6a4479');
const chorusFlower = new THREE.Color('#d6b4e6');
const obsidian = [new THREE.Color('#1b1026'), new THREE.Color('#251634'), new THREE.Color('#140b1d')];

// an island: a rounded top, tapering underside; only the cubes that can be seen are added
function island(cx, cy, cz, radius, group) {
  const cols = new Map();
  const r = Math.ceil(radius);
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    const wobble = 1 + 0.18 * Math.sin(x * 0.9 + cx) * Math.cos(z * 0.7 + cz);
    const t = Math.hypot(x, z) / (radius * wobble);
    if (t > 1) continue;
    const top = Math.round((1 - t * t) * radius * 0.18 + rnd() * 0.6);
    const bottom = -Math.round(Math.pow(1 - t, 0.75) * radius * 0.85 + rnd() * 1.5);
    cols.set(`${x},${z}`, [top, bottom]);
  }
  const start = group.length;
  for (const [key, [top, bottom]] of cols) {
    const [x, z] = key.split(',').map(Number);
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => cols.get(`${x + dx},${z + dz}`));
    for (let y = bottom; y <= top; y++) {
      const hidden = y !== top && y !== bottom && nb.every(n => n && n[0] >= y && n[1] <= y);
      if (hidden) continue;
      const c = endStone[Math.floor(rnd() * endStone.length)].clone();
      c.multiplyScalar(0.62 + 0.38 * (y - bottom) / Math.max(1, top - bottom));   // darker underneath
      group.push([cx + x, cy + y, cz + z, c, 1]);
    }
  }
  return { cols, start };
}

function chorus(x, y, z, height, group) {
  let cx = x, cz = z;
  for (let i = 0; i < height; i++) {
    group.push([cx, y + i, cz, chorusStem, 1]);
    if (i > 1 && rnd() < 0.35) {                               // a branch
      const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
      group.push([cx + dx, y + i, cz + dz, chorusStem, 1]);
      group.push([cx + dx, y + i + 1, cz + dz, chorusFlower, 1]);
    }
  }
  group.push([cx, y + height, cz, chorusFlower, 1]);
}

const islands = [];   // { group: THREE.Group, cubes: [], bob, spin }
function makeIsland(x, y, z, radius, opts = {}) {
  const list = [];
  const { cols } = island(0, 0, 0, radius, list);
  const tops = [...cols.entries()].map(([k, [top]]) => [...k.split(',').map(Number), top]);
  const plants = opts.plants ?? Math.floor(radius / 4);
  for (let i = 0; i < plants; i++) {
    const [px, pz, top] = tops[Math.floor(rnd() * tops.length)];
    chorus(px, top + 1, pz, 2 + Math.floor(rnd() * Math.min(7, radius / 2)), list);
  }
  const group = new THREE.Group();
  group.position.set(x, y, z);
  islands.push({ group, list, bob: rnd() * Math.PI * 2, spin: (rnd() - 0.5) * 0.04, base: y, pillars: opts.pillars });
  scene.add(group);
  return { group, list, tops };
}

// the big central island with obsidian pillars and crystals
const crystals = [];
{
  const { group, list, tops } = makeIsland(0, -20, 0, 34, { plants: 4 });
  const ring = 8;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    const px = Math.round(Math.cos(a) * 22), pz = Math.round(Math.sin(a) * 22);
    const top = Math.max(...tops.filter(([x, z]) => Math.abs(x - px) <= 1 && Math.abs(z - pz) <= 1).map(t => t[2]), 2);
    const height = 18 + Math.floor(rnd() * 26);
    for (let y = 1; y <= height; y++)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        if (Math.abs(dx) + Math.abs(dz) < 2 || y === height)
          list.push([px + dx, top + y, pz + dz, obsidian[Math.floor(rnd() * 3)], 1]);
    const crystal = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: 0xff8ae6, fog: false }));
    const cage = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ color: 0xc9a4ff, wireframe: true, transparent: true, opacity: 0.6 }));
    const holder = new THREE.Group();
    holder.add(crystal, cage);
    holder.position.set(px, top + height + 3, pz);
    group.add(holder);
    crystals.push({ holder, crystal, cage, phase: rnd() * 6 });
  }
}

// smaller islands scattered around
for (let i = 0; i < 26; i++) {
  const a = rnd() * Math.PI * 2;
  const dist = range(70, 260);
  makeIsland(Math.cos(a) * dist, range(-60, 45), Math.sin(a) * dist, range(3, 13));
}

for (const isl of islands) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), isl.list.length);
  const m = new THREE.Matrix4();
  isl.list.forEach(([x, y, z, c], n) => {
    mesh.setMatrixAt(n, m.makeTranslation(x, y, z));
    mesh.setColorAt(n, c);
  });
  isl.group.add(mesh);
}

// ---- End particles ---------------------------------------------------------------------------------------------------------
const particles = (() => {
  const n = 420, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([range(-200, 200), range(-80, 120), range(-200, 200)], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xc77dff, size: 1.2, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(pts);
  return pts;
})();

// ---- animation ---------------------------------------------------------------------------------------------------------------
const mouse = { x: 0, y: 0 };
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX / window.innerWidth - 0.5;
  mouse.y = e.clientY / window.innerHeight - 0.5;
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const look = new THREE.Vector3();
function frame() {
  const t = clock.getElapsedTime() * slow;
  const a = t * 0.025 + 0.6;
  camera.position.set(Math.cos(a) * 125, 26 + Math.sin(t * 0.07) * 8 - mouse.y * 10, Math.sin(a) * 125);
  // look past the central island to the right, so it floats behind the player preview on the left
  look.set(Math.sin(a), 0, -Math.cos(a)).multiplyScalar(42 + mouse.x * 18);
  look.y = 8;
  camera.lookAt(look);

  for (const isl of islands) {
    isl.group.position.y = isl.base + Math.sin(t * 0.4 + isl.bob) * 1.6;
    isl.group.rotation.y += isl.spin * 0.016 * slow;
  }
  for (const c of crystals) {
    c.holder.position.y += Math.sin(t * 1.5 + c.phase) * 0.01;
    c.crystal.rotation.set(t * 0.9 + c.phase, t * 1.3, 0);
    c.cage.rotation.set(-t * 0.6, t * 0.8 + c.phase, t * 0.4);
  }
  const p = particles.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) + 0.05 * slow;
    if (y > 120) y = -80;
    p.setY(i, y);
  }
  p.needsUpdate = true;
  stars.rotation.y = t * 0.004;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
