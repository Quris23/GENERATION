// Java, Minecraft, NeoForge: install and launch.
//
// Folder layout (inside the folder the player picked):
//   game/      the game directory: mods, config, saves, resourcepacks, shaderpacks...
//   runtime/   versions, libraries, assets and Java — shared machinery the player never touches
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { download, sha1File, exists } = require('./pack');

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_RUNTIMES = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const ASSETS = 'https://resources.download.minecraft.net';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const osName = isMac ? 'osx' : isWin ? 'windows' : 'linux';
const javaPlatform = isMac ? (process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os')
  : isWin ? (process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64') : 'linux';

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

// download a list of {url, dest, sha1, size} with a few parallel workers; skip files already correct
async function fetchAll(items, onBytes, workers = 8) {
  const todo = [];
  for (const it of items) {
    if (it.sha1 ? !((await exists(it.dest)) && (await sha1File(it.dest)) === it.sha1) : !(await exists(it.dest))) todo.push(it);
    else onBytes?.(it.size || 0);
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let it; (it = queue.shift()); ) await download(it.url, it.dest, it.sha1, onBytes);
  }));
}

function rulesAllow(rules) {
  if (!rules) return true;
  let allow = false;
  for (const r of rules) {
    if (r.features) continue;
    const osOk = !r.os || ((!r.os.name || r.os.name === osName) && (!r.os.arch || r.os.arch === (process.arch === 'ia32' ? 'x86' : process.arch)));
    if (osOk) allow = r.action === 'allow';
  }
  return allow;
}

// ---- Java ----------------------------------------------------------------------------------------------------------------
async function installJava(runtimeDir, component, progress) {
  const all = await json(JAVA_RUNTIMES);
  const entry = all[javaPlatform]?.[component]?.[0];
  if (!entry) throw new Error(`Mojang не предоставляет Java «${component}» для ${javaPlatform}`);
  const home = path.join(runtimeDir, 'java', component);
  const marker = path.join(home, '.version');
  const javaBin = isMac ? path.join(home, 'jre.bundle/Contents/Home/bin/java')
    : path.join(home, 'bin', isWin ? 'javaw.exe' : 'java');
  if ((await exists(marker)) && (await fsp.readFile(marker, 'utf8')) === entry.version.name && (await exists(javaBin)))
    return javaBin;

  const { files } = await json(entry.manifest.url);
  const items = [];
  const links = [];
  for (const [rel, f] of Object.entries(files)) {
    const dest = path.join(home, rel);
    if (f.type === 'directory') await fsp.mkdir(dest, { recursive: true });
    else if (f.type === 'file') items.push({ url: f.downloads.raw.url, dest, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size, exec: f.executable });
    else if (f.type === 'link') links.push({ dest, target: f.target });
  }
  const total = items.reduce((s, i) => s + i.size, 0);
  let done = 0;
  await fetchAll(items, n => progress('Java', (done += n), total));
  for (const it of items) if (it.exec && !isWin) await fsp.chmod(it.dest, 0o755);
  for (const l of links) {
    await fsp.rm(l.dest, { force: true });
    await fsp.symlink(l.target, l.dest).catch(() => {});
  }
  await fsp.writeFile(marker, entry.version.name);
  return javaBin;
}

// ---- Minecraft -----------------------------------------------------------------------------------------------------------
async function installMinecraft(runtimeDir, mcVersion, progress) {
  const vdir = path.join(runtimeDir, 'versions', mcVersion);
  const vjsonPath = path.join(vdir, `${mcVersion}.json`);
  let v;
  if (await exists(vjsonPath)) v = JSON.parse(await fsp.readFile(vjsonPath, 'utf8'));
  else {
    const list = await json(VERSION_MANIFEST);
    const meta = list.versions.find(x => x.id === mcVersion);
    if (!meta) throw new Error(`Нет версии Minecraft ${mcVersion}`);
    v = await json(meta.url);
    await fsp.mkdir(vdir, { recursive: true });
    await fsp.writeFile(vjsonPath, JSON.stringify(v));
  }
  const items = [{ url: v.downloads.client.url, dest: path.join(vdir, `${mcVersion}.jar`), sha1: v.downloads.client.sha1, size: v.downloads.client.size }];
  for (const lib of v.libraries) {
    if (!rulesAllow(lib.rules)) continue;
    const a = lib.downloads?.artifact;
    if (a) items.push({ url: a.url, dest: path.join(runtimeDir, 'libraries', a.path), sha1: a.sha1, size: a.size });
    const nativeKey = lib.natives?.[osName]?.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
    const n = nativeKey && lib.downloads?.classifiers?.[nativeKey];
    if (n) items.push({ url: n.url, dest: path.join(runtimeDir, 'libraries', n.path), sha1: n.sha1, size: n.size });
  }
  // assets
  const idxPath = path.join(runtimeDir, 'assets/indexes', `${v.assetIndex.id}.json`);
  await fetchAll([{ url: v.assetIndex.url, dest: idxPath, sha1: v.assetIndex.sha1 }]);
  const { objects } = JSON.parse(await fsp.readFile(idxPath, 'utf8'));
  for (const o of Object.values(objects)) {
    const h = o.hash;
    items.push({ url: `${ASSETS}/${h.slice(0, 2)}/${h}`, dest: path.join(runtimeDir, 'assets/objects', h.slice(0, 2), h), sha1: h, size: o.size });
  }
  const total = items.reduce((s, i) => s + (i.size || 0), 0);
  let done = 0;
  await fetchAll(items, n => progress('Minecraft', (done += n), total), 16);
  return v;
}

// ---- NeoForge: the official installer, headless --------------------------------------------------------------------------
async function installNeoForge(runtimeDir, javaBin, neoVersion, progress) {
  const id = `neoforge-${neoVersion}`;
  const vjson = path.join(runtimeDir, 'versions', id, `${id}.json`);
  if (await exists(vjson)) return id;
  progress('NeoForge', 0, 1);
  const installer = path.join(runtimeDir, '.cache', `neoforge-${neoVersion}-installer.jar`);
  if (!(await exists(installer)))
    await download(`${NEOFORGE_MAVEN}/${neoVersion}/neoforge-${neoVersion}-installer.jar`, installer);
  const profiles = path.join(runtimeDir, 'launcher_profiles.json'); // the installer insists on this file
  if (!(await exists(profiles))) await fsp.writeFile(profiles, JSON.stringify({ profiles: {} }));
  const log = [];
  const run = flag => new Promise(resolve => {
    const p = spawn(javaBin, ['-jar', installer, flag, runtimeDir], { cwd: path.dirname(installer) });
    p.stdout.on('data', d => { log.push(String(d)); progress('NeoForge', 0, 1); });
    p.stderr.on('data', d => log.push(String(d)));
    p.on('close', code => resolve(code));
  });
  let code = await run('--install-client');
  if (code !== 0 && !(await exists(vjson))) code = await run('--installClient');
  if (!(await exists(vjson))) throw new Error('Установщик NeoForge завершился с ошибкой:\n' + log.join('').slice(-1500));
  return id;
}

// ---- launch --------------------------------------------------------------------------------------------------------------
function offlineUuid(name) {
  // the same UUID vanilla gives an offline player: v3 of "OfflinePlayer:<name>"
  const crypto = require('crypto');
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString('hex');
}

// some tools write "natives": null and the like into version JSONs, which the launch library trips over
async function cleanVersionJson(runtimeDir, id) {
  const p = path.join(runtimeDir, 'versions', id, `${id}.json`);
  const v = JSON.parse(await fsp.readFile(p, 'utf8'));
  let changed = false;
  for (const lib of v.libraries || []) {
    for (const k of Object.keys(lib)) if (lib[k] === null) { delete lib[k]; changed = true; }
  }
  if (changed) await fsp.writeFile(p, JSON.stringify(v));
  if (v.inheritsFrom) await cleanVersionJson(runtimeDir, v.inheritsFrom);
}

async function launchGame({ root, javaBin, versionId, nickname, memoryMB }) {
  const { launch } = require('@xmcl/core');
  const gameDir = path.join(root, 'game');
  const runtimeDir = path.join(root, 'runtime');
  await cleanVersionJson(runtimeDir, versionId);
  const proc = await launch({
    gamePath: gameDir,
    resourcePath: runtimeDir,
    javaPath: javaBin,
    version: versionId,
    gameProfile: { name: nickname, id: offlineUuid(nickname) },
    accessToken: '0',
    userType: 'legacy',
    launcherName: 'The Last New Year',
    launcherBrand: 'TheLastNewYear',
    minMemory: 1024,
    maxMemory: memoryMB,
    extraJVMArgs: ['-XX:+UseG1GC', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M'],
    extraExecOption: { detached: true, cwd: gameDir },
  });
  return proc;
}

async function prepare(root, manifest, progress) {
  const runtimeDir = path.join(root, 'runtime');
  await fsp.mkdir(path.join(root, 'game'), { recursive: true });
  const v = await installMinecraft(runtimeDir, manifest.minecraft, progress);
  const javaBin = await installJava(runtimeDir, v.javaVersion?.component || 'java-runtime-delta', progress);
  const versionId = await installNeoForge(runtimeDir, javaBin, manifest.loader.version, progress);
  return { javaBin, versionId };
}

function totalMemoryMB() {
  return Math.floor(os.totalmem() / 1024 / 1024);
}

module.exports = { prepare, launchGame, totalMemoryMB, offlineUuid };
