const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const pack = require('./pack');
const game = require('./game');
const skin = require('./skin');

// where the pack's current version is described (GitHub Releases, "latest" release)
const MANIFEST_URL = process.env.GENERATION_MANIFEST
  || 'https://github.com/Quris23/GENERATION/releases/download/pack/manifest.json';

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = () => ({
  root: path.join(app.getPath('documents'), 'GENERATION'),
  memoryMB: Math.min(8192, Math.max(4096, Math.floor((game.totalMemoryMB() - 4096) / 512) * 512)),
  nickname: '',
});

function loadSettings() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; }
  catch { return defaults(); }
}
async function saveSettings(s) {
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fsp.writeFile(settingsPath(), JSON.stringify(s, null, 2));
}

let win;
let busy = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    fullscreen: true,                  // opens full screen, on macOS as a native full-screen space
    backgroundColor: '#0d0b14',
    title: 'GENERATION',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);

ipcMain.handle('settings:get', () => ({ ...loadSettings(), totalMemoryMB: game.totalMemoryMB() }));
ipcMain.handle('settings:set', async (_e, patch) => {
  const s = { ...loadSettings(), ...patch };
  await saveSettings(s);
  return s;
});

ipcMain.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Папка для GENERATION' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('folder:open', async () => {
  const dir = path.join(loadSettings().root, 'game');
  await fsp.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('pack:status', async () => {
  const { root } = loadSettings();
  const manifest = await pack.fetchManifest(MANIFEST_URL);
  let installed = null;
  try { installed = JSON.parse(await fsp.readFile(path.join(root, 'game/.generation/installed.json'), 'utf8')).version; }
  catch {}
  return { remote: manifest.version, installed, memory: manifest.memory };
});

// install / update everything, then start the game
ipcMain.handle('pack:play', async () => {
  if (busy) return;
  busy = true;
  const s = loadSettings();
  const progress = (stage, done, total) => send('progress', { stage, done, total });
  try {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(s.nickname)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
    const manifest = await pack.fetchManifest(MANIFEST_URL);
    const { javaBin, versionId } = await game.prepare(s.root, manifest, progress);
    await pack.sync(path.join(s.root, 'game'), manifest, progress);
    progress('Запуск', 1, 1);
    const proc = await game.launchGame({ root: s.root, javaBin, versionId, nickname: s.nickname, memoryMB: s.memoryMB });
    const logPath = path.join(s.root, 'game/logs/launcher-latest.log');
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    const log = fs.createWriteStream(logPath);
    proc.stdout?.pipe(log);
    proc.stderr?.pipe(log);
    win.hide();
    proc.on('exit', code => {
      win.show();
      send('game:exit', code);
    });
    proc.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    busy = false;
  }
});

ipcMain.handle('skin:get', () => skin.current(path.join(loadSettings().root, 'game')));
ipcMain.handle('skin:file', async (_e, model) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Скин', extensions: ['png'] }] });
  if (r.canceled) return { ok: false };
  try {
    await skin.fromFile(path.join(loadSettings().root, 'game'), r.filePaths[0], model);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('skin:nick', async (_e, nick) => {
  try {
    const model = await skin.fromNickname(path.join(loadSettings().root, 'game'), nick);
    return { ok: true, model };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:fullscreen', () => win.setFullScreen(!win.isFullScreen()));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
