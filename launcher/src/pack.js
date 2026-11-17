// Brings a game folder to the pack version described by the manifest.
//
// Rules (what the player may change and what we keep in line with the server):
// - files listed in the manifest ("managed") are downloaded when missing or different (sha1);
// - a managed file that a later pack version dropped is deleted, but only if we put it there
//   (we remember what we installed in .generation/installed.json); the player's own mods,
//   resource packs and shaders are never touched;
// - "defaults" (options.txt, client configs: graphics, sound, keys) are written only when the
//   player has no such file yet, so their own settings survive updates.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const STATE = '.generation/installed.json';

async function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function fileMatches(p, sha1) {
  return (await exists(p)) && (await sha1File(p)) === sha1;
}

// A connection that stops delivering for this long is dropped and the download goes on from where it stopped.
const STALL_MS = 20000;
const ATTEMPTS = 10;

// download to a temp file, check sha1, then move into place. Survives stalled and dropped connections: the part
// already on disk is kept and asked for again with a Range request (a server that ignores it means starting over).
async function download(url, dest, sha1, onBytes) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await fsp.rm(tmp, { force: true });
  let have = 0;                       // bytes of tmp already written (and already reported through onBytes)
  let hash = crypto.createHash('sha1');
  const startOver = () => { if (have) onBytes?.(-have); have = 0; hash = crypto.createHash('sha1'); };

  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STALL_MS); };
    let out;
    try {
      arm();
      const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
      if (res.status === 416) { startOver(); throw new Error('range not satisfiable'); }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      if (have && res.status !== 206) startOver();   // the server sent the whole file again
      out = fs.createWriteStream(tmp, { flags: have ? 'a' : 'w' });
      for await (const chunk of res.body) {
        arm();
        hash.update(chunk);
        have += chunk.length;
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        onBytes?.(chunk.length);
      }
      clearTimeout(timer);
      await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
      out = null;
      if (sha1 && hash.digest('hex') !== sha1) {
        startOver();
        throw new Error(`checksum mismatch for ${path.basename(dest)}`);
      }
      await fsp.rename(tmp, dest);
      return;
    } catch (e) {
      clearTimeout(timer);
      if (out) await new Promise(r => out.end(r));
      if (attempt >= ATTEMPTS) {
        await fsp.rm(tmp, { force: true });
        throw new Error(`Не удалось скачать ${path.basename(dest)} (проверьте интернет): ${ctl.signal.aborted ? 'соединение зависло' : e.message}`);
      }
      await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}

async function fetchManifest(url) {
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Не удалось получить описание сборки (HTTP ${res.status})`);
  return res.json();
}

// progress(stage, done, total) — bytes
async function sync(gameDir, manifest, progress = () => {}) {
  const statePath = path.join(gameDir, STATE);
  const state = (await exists(statePath)) ? JSON.parse(await fsp.readFile(statePath, 'utf8')) : { files: [] };
  const wanted = new Set();

  // 1. what has to be fetched
  progress('Проверка файлов', 0, 1);
  const todo = [];
  for (const f of manifest.files) {
    wanted.add(f.path);
    if (!(await fileMatches(path.join(gameDir, f.path), f.sha1))) todo.push(f);
  }
  const archives = [];
  for (const a of manifest.archives) {
    const need = [];
    for (const f of a.files) {
      const p = path.join(gameDir, f.path);
      if (a.kind === 'defaults') {
        if (!(await exists(p))) need.push(f);
      } else {
        wanted.add(f.path);
        if (!(await fileMatches(p, f.sha1))) need.push(f);
      }
    }
    if (need.length) archives.push({ archive: a, need });
  }

  // 2. download
  const total = todo.reduce((s, f) => s + f.size, 0) + archives.reduce((s, x) => s + x.archive.size, 0);
  let done = 0;
  let failed = false;     // once one file is given up on, the others stop and stay quiet, so the error is not painted over
  const tick = n => { if (!failed) { done += n; progress('Загрузка', done, total); } };
  const queue = [...todo];
  const workers = Array.from({ length: 6 }, async () => {
    try {
      for (let f; !failed && (f = queue.shift()); ) await download(f.url, path.join(gameDir, f.path), f.sha1, tick);
    } catch (e) { failed = true; queue.length = 0; throw e; }
  });
  await Promise.all(workers);

  const cache = path.join(gameDir, '.generation/cache');
  for (const { archive, need } of archives) {
    const zipPath = path.join(cache, archive.sha1);
    if (!(await fileMatches(zipPath, archive.sha1))) await download(archive.url, zipPath, archive.sha1, tick);
    else tick(archive.size);
    const zip = new AdmZip(zipPath);
    for (const f of need) {
      const dest = path.join(gameDir, f.path);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, zip.getEntry(f.path).getData());
    }
    await fsp.rm(zipPath, { force: true });
  }

  // 3. remove what an earlier version installed and this one no longer has
  progress('Уборка', 0, 1);
  for (const p of state.files) {
    if (!wanted.has(p)) await fsp.rm(path.join(gameDir, p), { force: true });
  }
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, JSON.stringify({ version: manifest.version, files: [...wanted] }));
  return { downloaded: todo.length, archives: archives.length };
}

module.exports = { fetchManifest, sync, download, sha1File, exists };
