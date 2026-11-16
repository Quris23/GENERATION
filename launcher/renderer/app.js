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

function renderCapes() {
  const box = $('capes');
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
  for (const [id, name] of Object.entries(CLASSES)) {
    const reason = playerClass === id ? null
      : playerClass ? `Только для класса «${name}»` : `Откроется, когда выберете класс «${name}» на сервере`;
    tile(id, name, `capes/${id}.png`, reason);
  }
  if (look.licensedCape) tile('licensed', 'С лицензии', look.licensedCape);
  $('capes-hint').textContent = playerClass
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
    const { remote, installed } = statusInfo;
    if (!installed) { setStatus(`Сборка ${remote}: ещё не установлена`, 0); $('play').textContent = 'УСТАНОВИТЬ'; }
    else if (installed !== remote) { setStatus(`Доступно обновление: ${installed} → ${remote}`, 0); $('play').textContent = 'ОБНОВИТЬ'; }
    else { setStatus(`Сборка ${remote} установлена`, 1); $('play').textContent = 'ИГРАТЬ'; }
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
$('quit').addEventListener('click', () => gen.quit());
$('fullscreen').addEventListener('click', () => gen.toggleFullscreen());

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
gen.onProgress(({ stage, done, total }) => {
  const f = total ? done / total : 0;
  const size = total > 1048576 ? ` — ${mb(done)} из ${mb(total)} МБ` : '';
  setStatus(`${stage}${size}`, f);
});
gen.onGameExit(code => {
  setStatus(code === 0 ? 'Игра закрыта' : `Игра завершилась с ошибкой (код ${code}). Лог: game/logs/latest.log`, 1);
  $('play').disabled = false;
  $('play').textContent = 'ИГРАТЬ';
  refreshServer();
});

$('play').addEventListener('click', async () => {
  settings = await gen.setSettings({ nickname: nickname() });
  $('play').disabled = true;
  const r = await gen.play();
  if (!r?.ok) {
    toast(r?.error || 'Не удалось запустить');
    $('play').disabled = false;
    setStatus('Ошибка', 0);
  } else setStatus('Игра запущена', 1);
});

init();
