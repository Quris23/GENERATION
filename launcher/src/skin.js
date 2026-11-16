// The player's skin for offline play: from a PNG file or copied from a licensed Minecraft account by nickname.
// Saved as <game dir>/.generation/skin.png + skin.json ({ model: "classic" | "slim" }); the GENERATION skins mod
// reads them and shares the skin with everyone in the world.
const fsp = require('fs/promises');
const path = require('path');

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
}

async function save(gameDir, buf, model) {
  checkSkin(buf);
  const dir = path.join(gameDir, '.generation');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'skin.png'), buf);
  await fsp.writeFile(path.join(dir, 'skin.json'), JSON.stringify({ model }));
}

async function fromFile(gameDir, file, model) {
  await save(gameDir, await fsp.readFile(file), model);
}

// Mojang's public profile API: nickname -> uuid -> textures
async function fromNickname(gameDir, nick) {
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
  await save(gameDir, png, model);
  return model;
}

async function current(gameDir) {
  try {
    const png = await fsp.readFile(path.join(gameDir, '.generation/skin.png'));
    const { model } = JSON.parse(await fsp.readFile(path.join(gameDir, '.generation/skin.json'), 'utf8'));
    return { dataUrl: 'data:image/png;base64,' + png.toString('base64'), model };
  } catch {
    return null;
  }
}

module.exports = { fromFile, fromNickname, current };
