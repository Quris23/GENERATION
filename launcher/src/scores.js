// Shared Tetris records: one JSON file { "Nick": best score } in a private GitHub repo.
// No security on purpose (a game for the loading screen): the token ships inside the launcher and can only touch that repo.
// The token comes from src/tetris-token.txt, written by the release workflow from the TETRIS_TOKEN secret,
// or from the TETRIS_TOKEN environment variable while developing. Without one the records are just not shown.
const fs = require('fs');
const path = require('path');

const URL = 'https://api.github.com/repos/Quris23/GENERATION-tetris/contents/scores.json';
const TOP = 3;

function token() {
  try { return fs.readFileSync(path.join(__dirname, 'tetris-token.txt'), 'utf8').trim() || process.env.TETRIS_TOKEN; }
  catch { return process.env.TETRIS_TOKEN; }
}

async function api(method, body) {
  const t = token();
  if (!t) throw new Error('no token');
  const r = await fetch(URL, {
    method,
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'GenerationLauncher' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}`), { status: r.status });
  return r.json();
}

async function read() {
  const f = await api('GET');
  return { sha: f.sha, scores: JSON.parse(Buffer.from(f.content, 'base64').toString('utf8') || '{}') };
}

const top = scores => Object.entries(scores).map(([nick, score]) => ({ nick, score }))
  .sort((a, b) => b.score - a.score).slice(0, TOP);

// a nickname holds one record; Minecraft nicknames ignore case, so "Steve" and "steve" are the same player
const keyOf = (scores, nick) => Object.keys(scores).find(k => k.toLowerCase() === nick.toLowerCase()) ?? nick;

async function list() {
  return top((await read()).scores);
}

async function submit(nick, score) {
  for (let attempt = 0; ; attempt++) {
    const { sha, scores } = await read();
    const key = keyOf(scores, nick);
    if ((scores[key] || 0) >= score) return top(scores);
    if (key !== nick) delete scores[key];
    scores[nick] = score;
    try {
      const content = Buffer.from(JSON.stringify(scores, null, 1)).toString('base64');
      await api('PUT', { message: `${nick}: ${score}`, content, sha });
      return top(scores);
    } catch (e) {
      if (attempt < 3 && (e.status === 409 || e.status === 422)) continue;  // someone wrote in between: read again
      throw e;
    }
  }
}

module.exports = { list, submit };
