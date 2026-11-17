import { createPreview } from './skin3d.js';

const $ = id => document.getElementById(id);
let settings;
let statusInfo = null;
let look = null;          // skin, model, cape from the launcher's files
let playerClass = null;   // the player's class on the server (cape id), when known

// the classes of SpellClasses and their capes (renderer/capes/<id>.png)
const CLASSES = {
  ice: 'Лич', fire: 'Горящая Душа', lightning: 'Исследователь Хекстека', nature: 'Друид',
  ender: 'Эндер', blood: 'Вампир', holy: 'Священник', aqua: 'Атлант',
};

function toast(text, ok = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast' + (ok ? ' ok' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ok ? 3000 : 9000);
}

function setStatus(text, fraction) {
  $('status-text').textContent = text;
  if (fraction !== undefined) $('bar-fill').style.width = `${Math.round(fraction * 100)}%`;
}

// ---- skin, model, cape --------------------------------------------------------------------------------------------------
const preview = createPreview($('skin-3d'));
function sizePreview() {
  const stage = $('skin-3d').parentElement;
  preview.resize(stage.clientWidth, Math.max(320, stage.clientHeight - 90));
}
window.addEventListener('resize', sizePreview);

async function refreshLook() {
  look = await gen.skin();
  $('skin-model').textContent = look.model === 'slim' ? 'Руки: тонкие' : 'Руки: обычные';
  await preview.show({ skin: look.skin || 'default-skin.png', model: look.model, cape: look.capeUrl });
  renderCapes();
}

// the face of a cape, drawn from its texture, as a small tile
function capeThumb(src) {
  const c = document.createElement('canvas');
  c.width = 10; c.height = 16;
  if (src) {
    const img = new Image();
    img.onload = () => c.getContext('2d').drawImage(img, 1, 1, 10, 16, 0, 0, 10, 16);
    img.src = src;
  }
  return c;
}

let capesKey = '';
function renderCapes() {
  const box = $('capes');
  const key = [look.cape, playerClass, !!look.licensedCape].join('|');
  if (key === capesKey && box.childElementCount) return;   // unchanged: leave the cycling cell's animation alone
  capesKey = key;
  box.replaceChildren();
  const tile = (id, name, src, lockedReason) => {
    const b = document.createElement('button');
    b.className = 'cape' + (look.cape === id ? ' selected' : '') + (lockedReason ? ' locked' : '');
    b.title = lockedReason || name;
    b.append(capeThumb(src));
    const label = document.createElement('span');
    label.textContent = name;
    b.append(label);
    b.addEventListener('click', async () => {
      if (lockedReason) return toast(lockedReason);
      await gen.setCape(id);
      refreshLook();
    });
    box.append(b);
  };
  tile('none', 'Без плаща', null);

  // one cell for the class cape: the player's own once their class is known; until then it shows the eight in turn,
  // each fading into the next every two seconds
  const ownClass = playerClass || (CLASSES[look.cape] ? look.cape : null);
  if (ownClass) {
    tile(ownClass, `Плащ: ${CLASSES[ownClass]}`, `capes/${ownClass}.png`, null);
  } else {
    const b = document.createElement('button');
    b.className = 'cape locked cycling';
    b.title = 'Откроется, когда выберете класс на сервере';
    const stack = document.createElement('div');
    stack.className = 'cape-stack';
    const names = document.createElement('div');
    names.className = 'cape-names';
    Object.entries(CLASSES).forEach(([id, name], i) => {
      const c = capeThumb(`capes/${id}.png`);
      const n = document.createElement('span');
      for (const el of [c, n]) el.style.setProperty('--i', i);
      n.textContent = name;
      stack.append(c);
      names.append(n);
    });
    b.append(stack, names);
    b.addEventListener('click', () => toast('Классовый плащ откроется, когда вы выберете класс на сервере'));
    box.append(b);
  }
  if (look.licensedCape) tile('licensed', 'С лицензии', look.licensedCape);
  $('capes-hint').textContent = ownClass
    ? `Доступен плащ вашего класса${look.licensedCape ? ' и плащ с лицензии' : ''}.`
    : 'Классовый плащ откроется после выбора класса на сервере.' + (look.licensedCape ? '' : ' Плащ с лицензии подтянется вместе со скином по нику.');
}

// ---- server -------------------------------------------------------------------------------------------------------------
const LIFE = {
  alive: ['Жив', 'ok'],
  dead: ['Ждёт воскрешения у Алтаря', 'bad'],
  revived: ['Воскрешён — оживёт при входе', 'warn'],
  new: ['Ещё не заходил на сервер', ''],
};

async function refreshServer() {
  let s;
  try { s = await gen.serverStatus(); } catch { s = { configured: false }; }
  const dot = $('server-dot');
  if (!s.configured) {
    dot.className = 'dot';
    $('server-state').textContent = 'Сервер скоро появится';
    $('server-players').textContent = '';
    $('server-hint').textContent = 'Здесь будет его статус, онлайн и состояние вашего персонажа.';
  } else if (!s.online) {
    dot.className = 'dot bad';
    $('server-state').textContent = 'Оффлайн';
    $('server-players').textContent = '';
    $('server-hint').textContent = s.address;
  } else {
    dot.className = 'dot ok';
    $('server-state').textContent = 'Онлайн';
    $('server-players').textContent = `${s.players} / ${s.max} игроков`;
    $('server-hint').textContent = s.address;
  }
  const life = s.player && LIFE[s.player.state];
  $('life-state').textContent = life ? life[0] : '—';
  $('life-state').className = life ? life[1] : '';

  const cls = s.player?.class && CLASSES[s.player.class] ? s.player.class : null;
  if (s.player) {      // the server answered for this player: what it says is the truth
    playerClass = cls;
    if (look && CLASSES[look.cape] && look.cape !== cls) {   // a class cape that is no longer theirs
      await gen.setCape('none');
      return refreshLook();
    }
  }
  $('player-class').textContent = playerClass ? CLASSES[playerClass] : (s.player ? 'не выбран' : '—');
  if (look) renderCapes();
}

// ---- settings -----------------------------------------------------------------------------------------------------------
function showMemory() {
  const mb = Number($('memory').value);
  $('memory-value').textContent = `${(mb / 1024).toFixed(1)} ГБ`;
  const rec = statusInfo?.memory?.recommended;
  const total = settings.totalMemoryMB;
  $('memory-hint').textContent =
    `В компьютере ${(total / 1024).toFixed(0)} ГБ.` + (rec ? ` Сборке нужно около ${(rec / 1024).toFixed(0)} ГБ.` : '') +
    (mb > total - 3072 ? ' Оставьте системе хотя бы 3 ГБ.' : '');
}

async function init() {
  settings = await gen.settings();
  $('nickname').value = settings.nickname;
  $('root').value = settings.root;
  const max = Math.max(4096, Math.floor((settings.totalMemoryMB - 2048) / 512) * 512);
  $('memory').min = 2048;
  $('memory').max = max;
  $('memory').value = Math.min(settings.memoryMB, max);
  showMemory();
  $('intro-volume').value = Math.round(settings.introVolume * 100);
  $('music-volume').value = Math.round(settings.musicVolume * 100);
  $('game-fullscreen').checked = settings.gameFullscreen;
  showVolumes();
  startMusic();
  sizePreview();
  await refreshLook();
  checkStatus();
  refreshServer();
  setInterval(refreshServer, 30000);
}

async function checkStatus() {
  $('play').disabled = true;
  setStatus('Проверка обновлений…', 0);
  try {
    statusInfo = await gen.status();
    showMemory();
    const { remote, installed, partial } = statusInfo;
    if (!installed && partial) { setStatus(`Сборка ${remote}: установка не завершена — скачанное сохранено, докачается остальное`, 0); $('play').textContent = 'ПРОДОЛЖИТЬ УСТАНОВКУ'; }
    else if (!installed) { setStatus(`Сборка ${remote}: ещё не установлена`, 0); $('play').textContent = 'УСТАНОВИТЬ'; }
    else if (installed !== remote) { setStatus(`Доступно обновление: ${installed} → ${remote}`, 0); $('play').textContent = 'ОБНОВИТЬ'; }
    else { setStatus(`Сборка ${remote} установлена`, 1); $('play').textContent = 'ИГРАТЬ'; }
    $('play').classList.toggle('long', $('play').textContent.length > 12);
  } catch (e) {
    setStatus('Нет связи с сервером обновлений. Можно играть в установленную версию.', 0);
    $('play').textContent = 'ИГРАТЬ';
  }
  $('play').disabled = false;
}

const nickname = () => $('nickname').value.trim();
$('nickname').addEventListener('change', async () => {
  settings = await gen.setSettings({ nickname: nickname() });
  refreshServer();
});
$('memory').addEventListener('input', showMemory);
$('memory').addEventListener('change', async e => {
  settings = await gen.setSettings({ memoryMB: Number(e.target.value) });
});
$('choose-root').addEventListener('click', async () => {
  const dir = await gen.chooseFolder();
  if (!dir) return;
  settings = await gen.setSettings({ root: dir });
  $('root').value = dir;
  refreshLook();
  checkStatus();
});
$('open-folder').addEventListener('click', () => gen.openGameFolder());

// ---- window: macOS draws its own buttons (we only leave room for them); elsewhere ours, in the same manner -------------
async function setupWindow() {
  const w = await gen.windowInfo();
  document.body.classList.add(w.platform === 'darwin' ? 'mac' : 'custom-frame');
  if (w.platform !== 'darwin') $('traffic').classList.remove('hidden');
  document.body.classList.toggle('fullscreen', w.fullscreen);
  gen.onWindowState(s => document.body.classList.toggle('fullscreen', s.fullscreen));
}
$('win-close').addEventListener('click', () => gen.quit());
$('win-min').addEventListener('click', () => gen.minimize());
$('win-full').addEventListener('click', () => gen.toggleFullscreen());
setupWindow();

// ---- settings dialog, volumes, music -------------------------------------------------------------------------------------
const music = $('music');
const percent = v => `${Math.round(v * 100)}%`;
function showVolumes() {
  $('intro-value').textContent = percent(settings.introVolume);
  $('music-value').textContent = percent(settings.musicVolume);
  music.volume = settings.musicVolume;
}
function startMusic() {
  if (settings.musicVolume > 0) music.play().catch(() => {});
}
$('open-settings').addEventListener('click', () => $('settings').classList.remove('hidden'));
$('close-settings').addEventListener('click', () => $('settings').classList.add('hidden'));
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('settings').classList.add('hidden'); });
for (const [input, key] of [['intro-volume', 'introVolume'], ['music-volume', 'musicVolume']]) {
  $(input).addEventListener('input', e => {
    settings[key] = Number(e.target.value) / 100;
    showVolumes();
    if (key === 'musicVolume') settings.musicVolume > 0 ? startMusic() : music.pause();
  });
  $(input).addEventListener('change', async e => {
    settings = await gen.setSettings({ [key]: Number(e.target.value) / 100 });
  });
}
$('game-fullscreen').addEventListener('change', async e => {
  settings = await gen.setSettings({ gameFullscreen: e.target.checked });
});

$('skin-model').addEventListener('click', async () => {
  await gen.setSkinModel(look.model === 'slim' ? 'classic' : 'slim');
  refreshLook();
});
$('skin-file').addEventListener('click', async () => {
  const r = await gen.skinFromFile();
  if (r.ok) { toast('Скин сохранён', true); refreshLook(); }
  else if (r.error) toast(r.error);
});
$('skin-from-nick').addEventListener('click', async () => {
  const nick = nickname();
  if (!nick) return toast('Впишите ник игрока с лицензией в поле «Никнейм»');
  $('skin-from-nick').disabled = true;
  const r = await gen.skinFromNick(nick);
  $('skin-from-nick').disabled = false;
  if (r.ok) { toast(`Скин игрока ${nick} сохранён${r.cape ? ' вместе с плащом' : ''}`, true); refreshLook(); }
  else toast(r.error);
});

const mb = n => (n / 1048576).toFixed(0);
// the big button while it works: its name changes (УСТАНОВКА / ОБНОВЛЕНИЕ / ЗАПУСК), it fills with the progress and
// its stripes keep moving, so it never looks stuck or clickable
const BUSY_LABEL = { 'УСТАНОВИТЬ': 'УСТАНОВКА', 'ПРОДОЛЖИТЬ УСТАНОВКУ': 'УСТАНОВКА', 'ОБНОВИТЬ': 'ОБНОВЛЕНИЕ', 'ИГРАТЬ': 'ЗАПУСК' };
let busyLabel = null;
function setBusy(on, idleText) {
  const b = $('play');
  if (on && busyLabel) return;          // already working: keep the label and the fill
  b.classList.toggle('busy', on);
  b.style.setProperty('--p', '0%');
  if (on) { busyLabel = BUSY_LABEL[b.textContent] || 'ЗАПУСК'; b.textContent = busyLabel; b.disabled = true; b.classList.remove('long'); }
  else { busyLabel = null; if (idleText) b.textContent = idleText; }
}

gen.onProgress(({ stage, done, total }) => {
  const f = total ? done / total : 0;
  const big = total > 1048576;
  const size = big ? ` — ${mb(done)} из ${mb(total)} МБ` : '';
  setStatus(`${stage}${size}`, f);
  if (!busyLabel) return;               // not installing (e.g. a straggler after an error): never paint over the status
  if (busyLabel) {
    const pct = Math.max(0, Math.min(100, Math.round(f * 100)));
    $('play').style.setProperty('--p', `${big ? pct : 0}%`);
    $('play').textContent = big ? `${busyLabel} ${pct}%` : busyLabel;
  }
});
gen.onGameExit(code => {
  setStatus(code === 0 ? 'Игра закрыта' : `Игра завершилась с ошибкой (код ${code}). Лог: game/logs/latest.log`, 1);
  setBusy(false, 'ИГРАТЬ');
  $('play').disabled = false;
  startMusic();
  refreshServer();
});

$('play').addEventListener('click', async () => {
  settings = await gen.setSettings({ nickname: nickname() });
  if ($('play').disabled || busyLabel) return;
  const idle = $('play').textContent;
  setBusy(true);
  const r = await gen.play();
  if (r?.busy) return;                  // an install is already running: leave the button as it is
  if (!r?.ok) {
    toast(r?.error || 'Не удалось запустить');
    setBusy(false, idle);
    $('play').disabled = false;
    setStatus(`Ошибка: ${r?.error || 'не удалось запустить'}`, 0);
  } else {
    setBusy(false, 'ЗАПУЩЕНО');
    setStatus('Игра запущена', 1);
    music.pause();   // the game has its own music
  }
});

init();
