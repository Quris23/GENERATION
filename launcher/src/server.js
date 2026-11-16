// Minecraft server status: the "Server List Ping" every client does for the multiplayer screen.
// https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping
const net = require('net');

function varInt(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function readVarInt(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (pos + i >= buf.length) return null;
    const b = buf[pos + i];
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return { value, size: i + 1 };
  }
  throw new Error('bad varint');
}

const packet = (...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varInt(body.length), body]);
};

// "host" or "host:port" -> { online, players, max, version } ; offline (or unreachable) -> { online: false }
function ping(address, timeoutMs = 4000) {
  const [host, portStr] = address.split(':');
  const port = Number(portStr) || 25565;
  return new Promise(resolve => {
    const sock = net.connect({ host, port });
    let data = Buffer.alloc(0);
    const done = r => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeoutMs, () => done({ online: false }));
    sock.on('error', () => done({ online: false }));
    sock.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      // handshake (protocol version -1: "just asking"), next state 1 = status; then the status request
      sock.write(packet(varInt(0), varInt(0xffffffff), varInt(hostBuf.length), hostBuf, portBuf, varInt(1)));
      sock.write(packet(varInt(0)));
    });
    sock.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      try {
        const len = readVarInt(data, 0);
        if (!len || data.length < len.size + len.value) return;
        let pos = len.size;
        pos += readVarInt(data, pos).size;                 // packet id
        const strLen = readVarInt(data, pos);
        pos += strLen.size;
        const status = JSON.parse(data.subarray(pos, pos + strLen.value).toString('utf8'));
        done({ online: true, players: status.players?.online ?? 0, max: status.players?.max ?? 0, version: status.version?.name });
      } catch {
        done({ online: false });
      }
    });
  });
}

// The GENERATION skins mod on the server answers http://<host>:25580/player?name=<nick> with
// { "class": "ice" | null, "state": "alive" | "dead" | "revived" | "new" } — or the manifest's own "statusApi" URL.
const STATUS_PORT = 25580;
async function playerInfo(address, statusApi, nick) {
  const base = statusApi || `http://${address.split(':')[0]}:${STATUS_PORT}`;
  try {
    const r = await fetch(`${base}/player?name=${encodeURIComponent(nick)}`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

module.exports = { ping, playerInfo };
