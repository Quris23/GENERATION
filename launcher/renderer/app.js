const $ = id => document.getElementById(id);
let settings;
let statusInfo = null;

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

// ---- skin preview: front view of a 64x64 (or old 64x32) skin, 10x scale -----------------------------------------------
function drawSkin(dataUrl, model) {
  const c = $('skin-canvas');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  if (!dataUrl) {
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(40, 0, 80, 80); g.fillRect(40, 80, 80, 120); g.fillRect(0, 80, 40, 120); g.fillRect(120, 80, 40, 120);
    g.fillRect(40, 200, 40, 120); g.fillRect(80, 200, 40, 120);
    return;
  }
  const img = new Image();
  img.onload = () => {
    const S = 10;
    const old = img.height === 32;
    const aw = model === 'slim' ? 3 : 4;
    const part = (sx, sy, w, h, dx, dy, mirror = false) => {
      g.save();
      if (mirror) { g.translate(dx * S + w * S, dy * S); g.scale(-1, 1); g.drawImage(img, sx, sy, w, h, 0, 0, w * S, h * S); }
      else g.drawImage(img, sx, sy, w, h, dx * S, dy * S, w * S, h * S);
      g.restore();
    };
    const ax = 4 - aw; // slim arms sit closer to the body
    part(8, 8, 8, 8, 4, 0);                       // head
    part(20, 20, 8, 12, 4, 8);                    // body
    part(44, 20, aw, 12, ax, 8);                  // right arm (viewer's left)
    if (old) part(44, 20, aw, 12, 12, 8, true); else part(36, 52, aw, 12, 12, 8);   // left arm
    part(4, 20, 4, 12, 4, 20);                    // right leg
    if (old) part(4, 20, 4, 12, 8, 20, true); else part(20, 52, 4, 12, 8, 20);      // left leg
    part(40, 8, 8, 8, 4, 0);                      // hat layer
    if (!old) {
      part(20, 36, 8, 12, 4, 8);                  // jacket
      part(44, 36, aw, 12, ax, 8); part(52, 52, aw, 12, 12, 8);   // sleeves
      part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);       // trousers
    }
  };
  img.src = dataUrl;
}

async function refreshSkin() {
  const s = await gen.skin();
  drawSkin(s?.dataUrl, s?.model);
  if (s?.model) $('skin-model').value = s.model;
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
  refreshSkin();
  checkStatus();
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

$('nickname').addEventListener('change', async e => {
  settings = await gen.setSettings({ nickname: e.target.value.trim() });
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
  refreshSkin();
  checkStatus();
});
$('open-folder').addEventListener('click', () => gen.openGameFolder());
$('quit').addEventListener('click', () => gen.quit());
$('fullscreen').addEventListener('click', () => gen.toggleFullscreen());

$('skin-file').addEventListener('click', async () => {
  const r = await gen.skinFromFile($('skin-model').value);
  if (r.ok) { toast('Скин сохранён', true); refreshSkin(); }
  else if (r.error) toast(r.error);
});
$('skin-model').addEventListener('change', refreshSkin);
$('skin-from-nick').addEventListener('click', async () => {
  const nick = $('skin-nick').value.trim();
  if (!nick) return toast('Впишите ник игрока с лицензией');
  $('skin-from-nick').disabled = true;
  const r = await gen.skinFromNick(nick);
  $('skin-from-nick').disabled = false;
  if (r.ok) { toast(`Скин игрока ${nick} сохранён`, true); refreshSkin(); }
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
});

$('play').addEventListener('click', async () => {
  settings = await gen.setSettings({ nickname: $('nickname').value.trim() });
  $('play').disabled = true;
  const r = await gen.play();
  if (!r?.ok) {
    toast(r?.error || 'Не удалось запустить');
    $('play').disabled = false;
    setStatus('Ошибка', 0);
  } else setStatus('Игра запущена', 1);
});

init();
