"""Draws the built-in class capes into renderer/capes/<id>.png (64x32, the Minecraft cape + elytra layout).

Run from the launcher folder:  python3 tools/make_capes.py
"""
import random
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'renderer' / 'capes'
W, H = 10, 16  # the cape's outer face


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def shade(c, k):
    return tuple(max(0, min(255, round(v * k))) for v in c[:3]) + (255,)


class Face:
    def __init__(self, top, bottom, seed, noise=0.08):
        rnd = random.Random(seed)
        top, bottom = hexrgb(top), hexrgb(bottom)
        self.px = [[shade(mix(top, bottom, y / (H - 1)), 1 + rnd.uniform(-noise, noise)) for _ in range(W)]
                   for y in range(H)]
        self.rnd = rnd

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = hexrgb(c) if isinstance(c, str) else c

    def motif(self, rows, colors, x0=None, y0=0):
        w = max(len(r) for r in rows)
        x0 = (W - w) // 2 if x0 is None else x0
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch in colors:
                    self.put(x0 + dx, y0 + dy, colors[ch])

    def border(self, c, bottom=True):
        for x in range(W):
            self.put(x, 0, c)
            if bottom:
                self.put(x, H - 1, c)
        for y in range(H):
            self.put(0, y, c)
            self.put(W - 1, y, c)


def lich():
    f = Face('#0b1a3a', '#24589a', 1)
    f.border('#cfeaff')
    for x in range(1, W - 1):                       # icicles hanging from the collar
        for y in range(1, 1 + f.rnd.choice([1, 1, 2, 3])):
            f.put(x, y, '#e8f6ff' if y == 1 else '#9fd3ff')
    f.motif(['...a...', '.a.a.a.', '..aba..', 'aabcbaa', '..aba..', '.a.a.a.', '...a...'],
            {'a': '#e8f6ff', 'b': '#9fd3ff', 'c': '#ffffff'}, y0=5)
    f.motif(['.ww.', 'wkkw', 'wwww', '.w.w'], {'w': '#cfeaff', 'k': '#0b1a3a'}, y0=12)   # small skull
    return f


def fire():
    f = Face('#120404', '#2a0800', 2, noise=0.15)
    f.border('#5a1200')
    for x in range(1, W - 1):                       # flames rising from the hem
        h = f.rnd.randint(5, 11)
        for i in range(h):
            y = H - 2 - i
            t = i / h
            f.put(x, y, '#fff2a0' if t < 0.15 else '#ffc21a' if t < 0.4 else '#ff6a00' if t < 0.7 else '#b21e00')
    for _ in range(5):                              # embers
        f.put(f.rnd.randint(1, W - 2), f.rnd.randint(1, 5), '#ff9a2a')
    return f


def hextech():
    f = Face('#141c2b', '#2c3e5c', 3)
    f.border('#b8862b')
    for p in [(1, 1), (W - 2, 1), (1, H - 2), (W - 2, H - 2)]:  # brass rivets
        f.put(*p, '#ffd36a')
    f.motif(['....yy', '...yy.', '..yy..', '.yyyyy', '...yy.', '..yy..', '.yy...', '.y....'],
            {'y': '#ffe14a'}, x0=2, y0=4)
    for y in range(3, H - 3, 2):                    # circuit traces
        f.put(1, y, '#4fb6ff')
        f.put(W - 2, y + 1, '#4fb6ff')
    return f


def druid():
    f = Face('#1d4a1d', '#2f6b2a', 4)
    f.border('#5a3a1a')
    for y in range(1, H - 1):                       # a vine down the middle
        x = 4 + (1 if (y // 3) % 2 else 0)
        f.put(x, y, '#3d2a12')
        if y % 3 == 1:
            f.put(x - 1, y, '#7fd34a')
            f.put(x + 2, y + 1, '#6fbf3a')
    for _ in range(9):
        f.put(f.rnd.randint(1, W - 2), f.rnd.randint(1, H - 2), f.rnd.choice(['#8fe05a', '#5aa82e', '#a6e86f']))
    f.put(2, 10, '#ff8ad8'); f.put(7, 5, '#ffe36a'); f.put(6, 13, '#ff8ad8')   # flowers
    return f


def ender():
    f = Face('#08050f', '#1e0f2e', 5)
    f.border('#7a2fbf')
    for _ in range(10):                             # ender particles
        f.put(f.rnd.randint(1, W - 2), f.rnd.randint(1, H - 2), f.rnd.choice(['#c46cff', '#9b3fe0', '#e6b3ff']))
    f.motif(['.gggg.', 'gccccg', 'gcbbcg', 'gcbbcg', 'gccccg', '.gggg.'],
            {'g': '#0f5f4a', 'c': '#2fd39a', 'b': '#0b1a14'}, y0=5)
    return f


def vampire():
    f = Face('#2a0005', '#5e0010', 6)
    f.border('#140002')
    for x in range(1, W - 1):                       # blood dripping from the collar
        for y in range(1, 1 + f.rnd.choice([1, 1, 2, 3, 4])):
            f.put(x, y, '#a0101a')
    f.motif(['b......b', 'bb.bb.bb', 'bbbbbbbb', '.brbbrb.', '..bbbb..', '...bb...'],
            {'b': '#0d0003', 'r': '#ff2a3a'}, x0=1, y0=8)
    return f


def priest():
    f = Face('#f6efd8', '#d9c690', 7, noise=0.04)
    f.border('#d4a020')
    f.motif(['...yyy...', '..y...y..', '.y.....y.'], {'y': '#ffe8a0'}, y0=2)   # halo
    f.motif(['..g..', '..g..', 'ggggg', '..g..', '..g..', '..g..', '..g..', '..g..'],
            {'g': '#c8901a'}, y0=4)
    for x in range(1, W - 1, 2):
        f.put(x, H - 2, '#c8901a')
    return f


def atlantean():
    f = Face('#0a3d4a', '#0e6b7a', 8)
    f.border('#062a33')
    for y in range(9, H - 1, 3):                    # waves along the hem
        for x in range(1, W - 1):
            if (x + y) % 4 < 2:
                f.put(x, y, '#3fc6d0')
            if (x + y) % 4 == 1:
                f.put(x, y - 1, '#a8f0f0')
    f.motif(['c.c.c', 'c.c.c', 'ccccc', '..c..', '..c..', '..c..', '..c..'],
            {'c': '#ffd36a'}, y0=2)
    return f


CAPES = {
    'ice': lich, 'fire': fire, 'lightning': hextech, 'nature': druid,
    'ender': ender, 'blood': vampire, 'holy': priest, 'aqua': atlantean,
}


def to_texture(face):
    img = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    edge = face.px[0][0]
    for y in range(H):
        for x in range(W):
            img.putpixel((1 + x, 1 + y), face.px[y][x])           # outer face
            img.putpixel((12 + W - 1 - x, 1 + y), face.px[y][x])  # inner face, mirrored
        img.putpixel((0, 1 + y), edge)
        img.putpixel((11, 1 + y), edge)
    for x in range(W):
        img.putpixel((1 + x, 0), edge)
        img.putpixel((11 + x, 0), edge)
    # elytra (used when the player wears one): the cape face stretched over the wing area
    for y in range(22):
        for x in range(24):
            img.putpixel((22 + x, y), face.px[min(H - 1, y * H // 22)][x * W // 24])
    return img


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for cid, draw in CAPES.items():
        to_texture(draw()).save(OUT / f'{cid}.png')
    print('capes:', ', '.join(CAPES))
