const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const pack = require('./pack');
const game = require('./game');
const skin = require('./skin');
const server = require('./server');

// where the pack's current version is described (GitHub Releases, "latest" release)
const MANIFEST_URL = process.env.GENERATION_MANIFEST
  || 'https://github.com/Quris23/GENERATION/releases/download/pack/manifest.json';

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = () => ({
  root: process.env.GENERATION_ROOT || path.join(app.getPath('documents'), 'The Last New Year'),   // env: development aid
  memoryMB: Math.min(8192, Math.max(4096, Math.floor((game.totalMemoryMB() - 4096) / 512) * 512)),
  nickname: '',
  gameFullscreen: true,   // the game opens full screen (macOS: its own space)
  introVolume: 0.8,       // the intro cinematic, written to the game's options.txt before a launch
  musicVolume: 0.25,      // the launcher's menu music
});

// the intro cinematic's volume lives in the game's options.txt as lny_cinematicVolume (0..1)
async function writeIntroVolume(gameDir, volume) {
  const file = path.join(gameDir, 'options.txt');
  let text = '';
  try { text = await fsp.readFile(file, 'utf8'); } catch {}
  const line = `lny_cinematicVolume:${Math.max(0, Math.min(1, Number(volume) || 0))}`;
  text = /^lny_cinematicVolume:.*$/m.test(text) ? text.replace(/^lny_cinematicVolume:.*$/m, line) : text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
  await fsp.writeFile(file, text);
}

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

const isMac = process.platform === 'darwin';

function createWindow() {
  const s = loadSettings();
  const b = s.windowBounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 800, x: b.x, y: b.y, minWidth: 1000, minHeight: 680,
    fullscreen: !!s.launcherFullscreen,   // opens the way it was left: a window or full screen (on macOS its own space)
    backgroundColor: '#0d0b14',
    title: 'The Last New Year',
    autoHideMenuBar: true,
    // macOS: the system's own window buttons, set into the page; elsewhere a frameless window with our own
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',   // the menu music starts by itself
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  const remember = async patch => saveSettings({ ...loadSettings(), ...patch });
  win.on('enter-full-screen', () => { remember({ launcherFullscreen: true }); send('window:state', { fullscreen: true }); });
  win.on('leave-full-screen', () => { remember({ launcherFullscreen: false }); send('window:state', { fullscreen: false }); });
  win.on('close', () => {
    if (!win.isFullScreen() && !win.isMaximized()) {
      const settings = { ...loadSettings(), windowBounds: win.getBounds() };
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    }
  });

  // development aid: GENERATION_SCREENSHOT=<png> renders the window off screen, saves it and quits
  const shot = process.env.GENERATION_SCREENSHOT;
  if (shot) {
    win.setOpacity(0);            // invisible but on screen: a hidden window stops repainting and the capture goes stale
    win.showInactive();
    win.webContents.setBackgroundThrottling(false);
    // GENERATION_EVAL=<js>: runs in the page shortly before the capture, to see a state (e.g. the busy button)
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.GENERATION_EVAL) console.log('EVAL', JSON.stringify(await win.webContents.executeJavaScript(process.env.GENERATION_EVAL).catch(e => String(e))));
      win.webContents.invalidate();     // a hidden window repaints only when asked
      await new Promise(r => setTimeout(r, 900));
      await fsp.writeFile(shot, (await win.webContents.capturePage()).toPNG());
      app.quit();
    }, 4000));
  }
}

const send = (ch, ...a) => win && !win.isDestroyed() && win.webContents.send(ch, ...a);

ipcMain.handle('settings:get', () => ({ ...loadSettings(), totalMemoryMB: game.totalMemoryMB() }));
ipcMain.handle('settings:set', async (_e, patch) => {
  const s = { ...loadSettings(), ...patch };
  await saveSettings(s);
  return s;
});

ipcMain.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Папка для The Last New Year' });
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
  // no record of a finished install, but files are already there: an install that was cut short (it resumes, skipping
  // every file that is already right)
  let partial = false;
  if (!installed) {
    for (const d of ['game/mods', 'runtime/versions']) {
      try { if ((await fsp.readdir(path.join(root, d))).length) partial = true; } catch {}
    }
  }
  return { remote: manifest.version, installed, partial, memory: manifest.memory };
});

// install / update everything; with launch (the ИГРАТЬ button) then start the game. УСТАНОВИТЬ / ОБНОВИТЬ only install:
// the player starts the game when they want to
ipcMain.handle('pack:play', async (_e, { launch = true } = {}) => {
  if (busy) return { ok: false, busy: true };
  busy = true;
  const s = loadSettings();
  const progress = (stage, done, total) => send('progress', { stage, done, total });
  try {
    if (launch && !/^[A-Za-z0-9_]{3,16}$/.test(s.nickname)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
    const manifest = await pack.fetchManifest(MANIFEST_URL);
    const { javaBin, versionId } = await game.prepare(s.root, manifest, progress);
    await pack.sync(path.join(s.root, 'game'), manifest, progress);
    if (!launch) return { ok: true, launched: false, version: manifest.version };
    progress('Запуск', 1, 1);
    await writeIntroVolume(path.join(s.root, 'game'), s.introVolume);
    const proc = await game.launchGame({
      root: s.root, javaBin, versionId, nickname: s.nickname, memoryMB: s.memoryMB, fullscreen: s.gameFullscreen,
    });
    const logPath = path.join(s.root, 'game/logs/launcher-latest.log');
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    const log = fs.createWriteStream(logPath);
    proc.stdout?.pipe(log);
    proc.stderr?.pipe(log);
    // out of the way while the game runs, but still in the Dock / taskbar: a click there brings it back. A full-screen
    // window cannot be minimized on macOS, so that one is hidden (the Dock click still shows it, see 'activate')
    if (isMac && win.isFullScreen()) win.hide(); else win.minimize();
    proc.on('exit', code => {
      showWindow();
      send('game:exit', code);
    });
    proc.unref();
    return { ok: true, launched: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    busy = false;
  }
});

const gameDir = () => path.join(loadSettings().root, 'game');
ipcMain.handle('skin:get', () => skin.current(gameDir(), path.join(loadSettings().root, 'runtime')));
ipcMain.handle('skin:file', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Скин', extensions: ['png'] }] });
  if (r.canceled) return { ok: false };
  try {
    await skin.fromFile(gameDir(), r.filePaths[0]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('skin:nick', async (_e, nick) => {
  try {
    return { ok: true, ...(await skin.fromNickname(gameDir(), nick)) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('skin:model', (_e, model) => skin.setModel(gameDir(), model));
ipcMain.handle('skin:cape', (_e, id) => skin.setCape(gameDir(), id));

// the pack's server, when the manifest names one: online or not, players, and this player's class and life
ipcMain.handle('server:status', async () => {
  let manifest;
  try { manifest = await pack.fetchManifest(MANIFEST_URL); } catch {}
  if (!manifest?.server) return { configured: false };
  const status = await server.ping(manifest.server);
  const nick = loadSettings().nickname;
  const player = status.online && nick ? await server.playerInfo(manifest.server, manifest.statusApi, nick) : null;
  return { configured: true, address: manifest.server, ...status, player };
});

ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:fullscreen', () => win.setFullScreen(!win.isFullScreen()));
ipcMain.handle('app:minimize', () => win.minimize());
ipcMain.handle('app:window', () => ({ platform: process.platform, fullscreen: win.isFullScreen() }));

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
// one launcher at a time: opening it again (or clicking its Dock icon) brings the open one forward
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
