// The player's look for offline play: skin, arm model and cape.
//   skin  — from a PNG file or copied from a licensed Minecraft account by nickname
//   cape  — one of the built-in class capes (renderer/capes/<id>.png), the licensed account's own cape, or none
// Saved in <game dir>/.generation: skin.png, cape.png and skin.json ({ model, cape }). The GENERATION skins mod reads
// skin.png / cape.png and shares them with everyone in the world.
const fsp = require('fs/promises');
const path = require('path');

const CAPES_DIR = path.join(__dirname, '../renderer/capes');
const BUILTIN_CAPES = ['ice', 'fire', 'lightning', 'nature', 'ender', 'blood', 'holy', 'aqua'];
const LICENSED = 'licensed';
const MAX_PNG = 32 * 1024;

const dirOf = gameDir => path.join(gameDir, '.generation');

function pngSize(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function checkSkin(buf) {
  const s = pngSize(buf);
  if (!s) throw new Error('Это не PNG-файл');
  if (!(s.width === 64 && (s.height === 64 || s.height === 32)))
    throw new Error(`Скин должен быть 64×64 (или старый 64×32), а этот ${s.width}×${s.height}`);
  if (buf.length > MAX_PNG) throw new Error('Файл скина слишком большой (больше 32 КБ)');
}

function isCape(buf) {
  const s = pngSize(buf);
  return !!s && s.width === 64 && s.height === 32 && buf.length <= MAX_PNG;
}

async function readMeta(gameDir) {
  try { return JSON.parse(await fsp.readFile(path.join(dirOf(gameDir), 'skin.json'), 'utf8')); }
  catch { return {}; }
}
async function writeMeta(gameDir, patch) {
  const meta = { model: 'classic', cape: 'none', ...(await readMeta(gameDir)), ...patch };
  await fsp.mkdir(dirOf(gameDir), { recursive: true });
  await fsp.writeFile(path.join(dirOf(gameDir), 'skin.json'), JSON.stringify(meta));
  return meta;
}

async function saveSkin(gameDir, buf, model) {
  checkSkin(buf);
  await fsp.mkdir(dirOf(gameDir), { recursive: true });
  await fsp.writeFile(path.join(dirOf(gameDir), 'skin.png'), buf);
  await writeMeta(gameDir, { model });
}

async function fromFile(gameDir, file) {
  const { model = 'classic' } = await readMeta(gameDir);
  await saveSkin(gameDir, await fsp.readFile(file), model);
}

// Mojang's public profile API: nickname -> uuid -> textures. Takes the account's cape too, when it has one.
async function fromNickname(gameDir, nick) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) throw new Error('Впишите ник: 3–16 символов, латиница, цифры и _');
  const r1 = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`);
  if (r1.status === 404 || r1.status === 204) throw new Error(`Игрока «${nick}» нет среди лицензионных аккаунтов`);
  if (!r1.ok) throw new Error(`Сервер Mojang не ответил (HTTP ${r1.status})`);
  const { id } = await r1.json();
  const r2 = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
  if (!r2.ok) throw new Error(`Не удалось получить профиль (HTTP ${r2.status})`);
  const prop = (await r2.json()).properties.find(p => p.name === 'textures');
  const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures;
  if (!tex.SKIN) throw new Error('У этого игрока стандартный скин');
  const png = Buffer.from(await (await fetch(tex.SKIN.url)).arrayBuffer());
  const model = tex.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic';
  await saveSkin(gameDir, png, model);

  let cape = false;
  if (tex.CAPE) {
    const capePng = Buffer.from(await (await fetch(tex.CAPE.url)).arrayBuffer());
    if (isCape(capePng)) {
      await fsp.writeFile(path.join(dirOf(gameDir), 'cape-licensed.png'), capePng);
      await setCape(gameDir, LICENSED);
      cape = true;
    }
  }
  return { model, cape };
}

async function setModel(gameDir, model) {
  await writeMeta(gameDir, { model: model === 'slim' ? 'slim' : 'classic' });
}

// id: a built-in cape, LICENSED, or 'none'
async function setCape(gameDir, id) {
  const dest = path.join(dirOf(gameDir), 'cape.png');
  let src = null;
  if (BUILTIN_CAPES.includes(id)) src = path.join(CAPES_DIR, `${id}.png`);
  else if (id === LICENSED) src = path.join(dirOf(gameDir), 'cape-licensed.png');
  else id = 'none';
  await fsp.mkdir(dirOf(gameDir), { recursive: true });
  if (src) await fsp.writeFile(dest, await fsp.readFile(src));
  else await fsp.rm(dest, { force: true });
  await writeMeta(gameDir, { cape: id });
}

// Steve from the installed Minecraft jar, for the preview when no skin is chosen (nothing of Mojang's is shipped)
async function defaultSkin(runtimeDir) {
  try {
    const AdmZip = require('adm-zip');
    for (const v of await fsp.readdir(path.join(runtimeDir, 'versions'))) {
      const jar = path.join(runtimeDir, 'versions', v, `${v}.jar`);
      if (!/^\d+\.\d+/.test(v) || !(await fsp.stat(jar).catch(() => null))) continue;
      const entry = new AdmZip(jar).getEntry('assets/minecraft/textures/entity/player/wide/steve.png');
      if (entry) return entry.getData();
    }
  } catch {}
  return null;
}

const dataUrl = buf => buf && 'data:image/png;base64,' + buf.toString('base64');
const readOrNull = p => fsp.readFile(p).catch(() => null);

async function current(gameDir, runtimeDir) {
  const meta = await readMeta(gameDir);
  const own = await readOrNull(path.join(dirOf(gameDir), 'skin.png'));
  return {
    skin: dataUrl(own || await defaultSkin(runtimeDir)),
    isDefault: !own,
    model: meta.model === 'slim' ? 'slim' : 'classic',
    cape: meta.cape || 'none',
    capeUrl: dataUrl(await readOrNull(path.join(dirOf(gameDir), 'cape.png'))),
    licensedCape: dataUrl(await readOrNull(path.join(dirOf(gameDir), 'cape-licensed.png'))),
  };
}

module.exports = { fromFile, fromNickname, setModel, setCape, current, BUILTIN_CAPES };
