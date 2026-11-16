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

// download to a temp file, check sha1, then move into place
async function download(url, dest, sha1, onBytes) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const h = crypto.createHash('sha1');
      const out = fs.createWriteStream(tmp);
      for await (const chunk of res.body) {
        h.update(chunk);
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        onBytes?.(chunk.length);
      }
      await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
      const got = h.digest('hex');
      if (sha1 && got !== sha1) throw new Error(`checksum mismatch for ${path.basename(dest)}`);
      await fsp.rename(tmp, dest);
      return;
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function fetchManifest(url) {
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
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
  const tick = n => { done += n; progress('Загрузка', done, total); };
  const queue = [...todo];
  const workers = Array.from({ length: 6 }, async () => {
    for (let f; (f = queue.shift()); ) await download(f.url, path.join(gameDir, f.path), f.sha1, tick);
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
