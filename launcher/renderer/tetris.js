// Tetris for the wait while the pack downloads. Shown in the middle column during an install (body.installing) unless
// the settings are open; it pauses itself whenever it is hidden. Pieces are Minecraft ore blocks drawn as 8×8 pixel art.
const $ = id => document.getElementById(id);
const root = $('tetris');
const COLS = 10, ROWS = 20;

// ---- look ---------------------------------------------------------------------------------------------------------------
// [shadow, base, light, shine] per piece, after the blocks of diamond, gold, amethyst, emerald, redstone, lapis, copper
const BLOCKS = {
  I: { name: 'Алмаз', pal: ['#1f8f8a', '#45c9c1', '#7fe9e2', '#d9fffb'] },
  O: { name: 'Золото', pal: ['#b07a12', '#e8b923', '#fbdc5a', '#fff6c2'] },
  T: { name: 'Аметист', pal: ['#4f2a78', '#7b48b0', '#a678d8', '#e3c8ff'] },
  S: { name: 'Изумруд', pal: ['#11753a', '#22a752', '#55d47d', '#c9ffd9'] },
  Z: { name: 'Редстоун', pal: ['#6e0c08', '#a5170f', '#d33a2a', '#ff9a8a'] },
  J: { name: 'Лазурит', pal: ['#1a2f7a', '#2a4bb0', '#4f74d9', '#b9cbff'] },
  L: { name: 'Медь', pal: ['#7a3d1c', '#b4612f', '#d98b52', '#ffd0a6'] },
};
const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const BOX = { I: 4, O: 4 };          // the square a piece turns in (3 for the rest)

// one 8×8 texture per block: lit top-left edge, shaded bottom-right, a speckled face, a few shiny pixels
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
const textures = {};
for (const [k, { pal }] of Object.entries(BLOCKS)) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); const r = rng(k.charCodeAt(0) * 7919);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let i = r() < 0.55 ? 1 : r() < 0.6 ? 2 : 0;
    if (x === 0 || y === 0) i = 2;
    if (x === 7 || y === 7) i = 0;
    if (x > 0 && y > 0 && x < 7 && y < 7 && r() < 0.07) i = 3;
    g.fillStyle = pal[i]; g.fillRect(x, y, 1, 1);
  }
  textures[k] = c;
}

// ---- the panel ----------------------------------------------------------------------------------------------------------
root.innerHTML = `
  <div class="tetris-head"><h2>Тетрис</h2><span class="muted">пока качается сборка</span></div>
  <div class="tetris-body">
    <div class="tetris-board"><canvas id="t-board"></canvas><div id="t-over" class="tetris-over"></div></div>
    <div class="tetris-side">
      <div class="t-box"><span class="muted">Следующая</span><canvas id="t-next"></canvas></div>
      <div class="t-box t-stats">
        <div><span class="muted">Счёт</span><b id="t-score">0</b></div>
        <div><span class="muted">Линии</span><b id="t-lines">0</b></div>
        <div><span class="muted">Уровень</span><b id="t-level">1</b></div>
        <div><span class="muted">Рекорд</span><b id="t-best">0</b></div>
      </div>
      <div class="t-keys muted">
        <div><kbd>←</kbd><kbd>→</kbd> двигать</div>
        <div><kbd>↑</kbd> повернуть</div>
        <div><kbd>↓</kbd> быстрее</div>
        <div><kbd>Пробел</kbd> уронить</div>
        <div><kbd>P</kbd> пауза</div>
      </div>
    </div>
  </div>`;
const board = $('t-board'), bctx = board.getContext('2d');
const next = $('t-next'), nctx = next.getContext('2d');
const over = $('t-over');
let cell = 24;

function layout() {
  // measure the room with the card stretched to the column, then let it hug the board
  const body = root.querySelector('.tetris-body');
  root.style.height = '100%';
  const h = body.clientHeight, w = body.clientWidth - 150;
  const css = Math.max(12, Math.min(Math.floor(h / ROWS), Math.floor(w / COLS)));
  const dpr = window.devicePixelRatio || 1;       // drawn in real screen pixels, so the blocks stay crisp on Retina
  cell = Math.round(css * dpr);
  board.width = COLS * cell; board.height = ROWS * cell;
  board.style.width = `${COLS * css}px`; board.style.height = `${ROWS * css}px`;
  next.width = next.height = Math.round(css * 4.2 * dpr);
  root.style.height = 'auto';
  draw();
}

// ---- sounds (quiet, synthesized, like the buttons') ---------------------------------------------------------------------
let actx = null;
function beep(type, from, to, len, gain) {
  try {
    actx ??= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + len + 0.05);
  } catch {}
}
const sfx = {
  move: () => beep('square', 300, 280, 0.04, 0.008),
  turn: () => beep('triangle', 520, 700, 0.06, 0.02),
  lock: () => beep('triangle', 160, 90, 0.1, 0.035),
  clear: n => [0, 1, 2, 3].slice(0, n).forEach(i => setTimeout(() => beep('sine', 660 * 1.26 ** i, 990 * 1.26 ** i, 0.18, 0.04), i * 70)),
  over: () => beep('sawtooth', 300, 60, 0.9, 0.03),
};

// ---- game ---------------------------------------------------------------------------------------------------------------
let grid, piece, queue, score = 0, lines = 0, level = 1, state = 'idle', dropTimer = 0, lockTimer = 0, lockMoves = 0, flash = null;
let best = 0;
try { best = Number(localStorage.getItem('tetris-best')) || 0; } catch {}

function bag() { const b = Object.keys(SHAPES); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function cellsOf(p, rot = p.rot, x = p.x, y = p.y) {
  const n = BOX[p.k] || 3;
  return SHAPES[p.k].map(([cx, cy]) => {
    for (let r = 0; r < rot; r++) [cx, cy] = [n - 1 - cy, cx];
    return [x + cx, y + cy];
  });
}
const fits = cs => cs.every(([x, y]) => x >= 0 && x < COLS && y < ROWS && (y < 0 || !grid[y][x]));
function spawn() {
  if (queue.length < 7) queue.push(...bag());
  piece = { k: queue.shift(), rot: 0, x: 3, y: -1 };
  lockTimer = 0; lockMoves = 0;
  if (!fits(cellsOf(piece))) { state = 'over'; sfx.over(); saveBest(); showOver(); }
}
function start() {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  queue = bag(); score = 0; lines = 0; level = 1; state = 'play'; dropTimer = 0; flash = null;
  spawn(); showOver(); stats();
}
const speed = () => Math.max(70, 800 * 0.85 ** (level - 1));
function saveBest() { if (score > best) { best = score; try { localStorage.setItem('tetris-best', String(best)); } catch {} } stats(); }
function stats() {
  $('t-score').textContent = score; $('t-lines').textContent = lines; $('t-level').textContent = level; $('t-best').textContent = Math.max(best, score);
}

function tryMove(dx, dy, drot = 0) {
  const rot = (piece.rot + drot + 4) % 4;
  const kicks = drot ? [0, -1, 1, -2, 2] : [0];
  for (const k of kicks) {
    const cs = cellsOf(piece, rot, piece.x + dx + k, piece.y + dy);
    if (fits(cs)) {
      piece.rot = rot; piece.x += dx + k; piece.y += dy;
      if (lockTimer && lockMoves < 15) { lockTimer = 0; lockMoves++; }   // moving on the floor buys a little time
      return true;
    }
  }
  return false;
}
function lock() {
  for (const [x, y] of cellsOf(piece)) if (y >= 0) grid[y][x] = piece.k;
  if (cellsOf(piece).some(([, y]) => y < 0)) { state = 'over'; sfx.over(); saveBest(); showOver(); return; }
  const full = grid.map((row, y) => (row.every(Boolean) ? y : -1)).filter(y => y >= 0);
  if (full.length) {
    flash = { rows: full, t: 0 };
    sfx.clear(full.length);
    score += [0, 100, 300, 500, 800][full.length] * level;
    lines += full.length;
    level = 1 + Math.floor(lines / 10);
  } else sfx.lock();
  stats();
  piece = null;
  if (!full.length) spawn();
}
function clearFlash() {
  for (const y of flash.rows) { grid.splice(y, 1); grid.unshift(Array(COLS).fill(null)); }
  flash = null; spawn();
}
function hardDrop() {
  let n = 0; while (tryMove(0, 1)) n++;
  score += n * 2; lock();
}

let last = 0;
function frame(t) {
  const dt = Math.min(100, t - (last || t)); last = t;
  if (state === 'play' && visible()) {
    if (flash) { flash.t += dt; if (flash.t > 180) clearFlash(); }
    else if (piece) {
      held();
      dropTimer += dt;
      const onFloor = !fits(cellsOf(piece, piece.rot, piece.x, piece.y + 1));
      if (onFloor) { lockTimer += dt; if (lockTimer > 450) lock(); }
      else if (dropTimer >= (keys.ArrowDown ? Math.min(45, speed()) : speed())) {
        dropTimer = 0; tryMove(0, 1); if (keys.ArrowDown) score += 1;
      }
    }
    draw();
  }
  requestAnimationFrame(frame);
}

// ---- drawing ------------------------------------------------------------------------------------------------------------
function block(g, k, x, y, size, alpha = 1) {
  g.globalAlpha = alpha; g.imageSmoothingEnabled = false;
  g.drawImage(textures[k], x, y, size, size); g.globalAlpha = 1;
}
function draw() {
  const g = bctx;
  g.fillStyle = '#120c1c'; g.fillRect(0, 0, board.width, board.height);
  g.strokeStyle = 'rgba(196,108,255,0.07)'; g.lineWidth = 1;
  for (let x = 1; x < COLS; x++) { g.beginPath(); g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, board.height); g.stroke(); }
  for (let y = 1; y < ROWS; y++) { g.beginPath(); g.moveTo(0, y * cell + 0.5); g.lineTo(board.width, y * cell + 0.5); g.stroke(); }
  if (grid) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x]) block(g, grid[y][x], x * cell, y * cell, cell);
    if (flash) {
      g.fillStyle = `rgba(255,245,255,${0.85 - flash.t / 250})`;
      for (const y of flash.rows) g.fillRect(0, y * cell, board.width, cell);
    }
    if (piece && state !== 'over') {
      let gy = piece.y; while (fits(cellsOf(piece, piece.rot, piece.x, gy + 1))) gy++;
      g.strokeStyle = 'rgba(230,179,255,0.45)'; g.lineWidth = Math.max(2, cell / 12);
      for (const [x, y] of cellsOf(piece, piece.rot, piece.x, gy)) if (y >= 0) g.strokeRect(x * cell + cell * 0.1, y * cell + cell * 0.1, cell * 0.8, cell * 0.8);
      for (const [x, y] of cellsOf(piece)) if (y >= 0) block(g, piece.k, x * cell, y * cell, cell);
    }
  }
  // next piece, centred in its box
  nctx.clearRect(0, 0, next.width, next.height);
  const k = queue?.[0];
  if (k) {
    const s = Math.floor(next.width / 5), cs = SHAPES[k];
    const w = Math.max(...cs.map(c => c[0])) + 1, h = Math.max(...cs.map(c => c[1])) + 1;
    const ox = (next.width - w * s) / 2, oy = (next.height - h * s) / 2;
    for (const [x, y] of cs) block(nctx, k, ox + x * s, oy + y * s, s);
  }
}
function showOver() {
  const text = {
    idle: '<b>Тетрис</b><span>Нажмите <kbd>Пробел</kbd> или сюда, чтобы начать</span>',
    pause: '<b>Пауза</b><span><kbd>P</kbd> или клик — продолжить</span>',
    over: `<b>Конец игры</b><span>Счёт ${score}${score >= best && score > 0 ? ' — новый рекорд!' : ''}</span><span><kbd>Пробел</kbd> — ещё раз</span>`,
  }[state];
  over.innerHTML = text || '';
  over.classList.toggle('hidden', !text);
}

// ---- input --------------------------------------------------------------------------------------------------------------
const keys = {};
let repeatAt = 0;
const KEYMAP = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'U', KeyW: 'U', KeyX: 'U', KeyZ: 'CCW', ArrowDown: 'D', KeyS: 'D', Space: 'DROP', KeyP: 'PAUSE' };
function held() {        // left / right repeat while held: first after 160 ms, then every 50 ms
  const dir = keys.ArrowLeft ? -1 : keys.ArrowRight ? 1 : 0;
  if (!dir) return;
  const now = performance.now();
  if (now >= repeatAt) { if (tryMove(dir, 0)) sfx.move(); repeatAt = now + 50; }
}
document.addEventListener('keydown', e => {
  if (!visible() || e.target.matches?.('input, textarea')) return;
  const act = KEYMAP[e.code];
  if (!act) return;
  e.preventDefault();
  if (act === 'PAUSE') { togglePause(); return; }
  if (state === 'idle' || state === 'over') { if (act === 'DROP') start(); return; }
  if (state === 'pause') { if (act === 'DROP') togglePause(); return; }
  if (!piece || flash) return;
  if (act === 'L' || act === 'R') {
    const code = act === 'L' ? 'ArrowLeft' : 'ArrowRight';
    if (!e.repeat) { keys[code] = true; if (tryMove(act === 'L' ? -1 : 1, 0)) sfx.move(); repeatAt = performance.now() + 160; }
  } else if (act === 'U' && !e.repeat) { if (tryMove(0, 0, 1)) sfx.turn(); }
  else if (act === 'CCW' && !e.repeat) { if (tryMove(0, 0, -1)) sfx.turn(); }
  else if (act === 'D') keys.ArrowDown = true;
  else if (act === 'DROP' && !e.repeat) hardDrop();
});
document.addEventListener('keyup', e => {
  const act = KEYMAP[e.code];
  if (act === 'L') keys.ArrowLeft = false;
  if (act === 'R') keys.ArrowRight = false;
  if (act === 'D') keys.ArrowDown = false;
});
over.addEventListener('click', () => { if (state === 'pause') togglePause(); else if (state !== 'play') start(); });
function togglePause() {
  if (state === 'play') state = 'pause'; else if (state === 'pause') state = 'play'; else return;
  for (const k in keys) keys[k] = false;
  showOver();
}

// ---- when to show it ----------------------------------------------------------------------------------------------------
const visible = () => !root.classList.contains('hidden') && !document.body.classList.contains('settings-open');
function sync() {
  const show = document.body.classList.contains('installing');
  const was = !root.classList.contains('hidden');
  root.classList.toggle('hidden', !show);
  if (show && !was) {
    layout();
    root.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  if (!visible() && state === 'play') { state = 'pause'; showOver(); }
}
new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', () => { if (!root.classList.contains('hidden')) layout(); });
window.addEventListener('settings-toggle', () => { if (visible()) requestAnimationFrame(layout); });
showOver(); stats(); sync();
requestAnimationFrame(frame);
