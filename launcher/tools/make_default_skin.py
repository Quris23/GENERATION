"""Draws renderer/default-skin.png: the launcher's own stand-in skin, shown before a player picks one
(and when Minecraft is not installed yet, so its Steve can't be borrowed). Run: python3 tools/make_default_skin.py"""
import random
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'renderer' / 'default-skin.png'
img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
rnd = random.Random(7)


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def box(u, v, w, h, d, paint):
    """paint(face, x, y) -> colour or None, for every pixel of a w×h×d box laid out from (u, v)"""
    faces = {'top': (u + d, v, w, d), 'bottom': (u + d + w, v, w, d), 'right': (u, v + d, d, h),
             'front': (u + d, v + d, w, h), 'left': (u + d + w, v + d, d, h), 'back': (u + 2 * d + w, v + d, w, h)}
    for face, (x0, y0, fw, fh) in faces.items():
        for y in range(fh):
            for x in range(fw):
                c = paint(face, x, y)
                if c:
                    img.putpixel((x0 + x, y0 + y), c if isinstance(c, tuple) else rgb(c))


def jitter(c, k=0.06):
    c = rgb(c)
    f = 1 + rnd.uniform(-k, k)
    return tuple(max(0, min(255, round(v * f))) for v in c[:3]) + (255,)


SKIN, HAIR, HOOD, TRIM, PANTS, SHOE = '#d9a77f', '#3a2418', '#4b2a6e', '#f4b52b', '#24203a', '#1a1414'


def head(face, x, y):
    if face == 'top':
        return jitter(HAIR)
    if face == 'bottom':
        return jitter(SKIN)
    if face == 'front':
        if y < 2:
            return jitter(HAIR)
        if y == 4 and x in (1, 2, 5, 6):
            return '#ffffff' if x in (1, 6) else '#6b3fa0'   # eyes
        if y == 6 and 2 <= x <= 5:
            return '#9a5e48'
        return jitter(SKIN)
    return jitter(HAIR) if y < 3 or face == 'back' else jitter(SKIN)


def hood(face, x, y):          # second layer of the head: a hood framing the face
    if face == 'front':
        return jitter(HOOD) if y < 1 or x == 0 or x == 7 else None
    if face == 'bottom':
        return None
    return jitter(HOOD)


def body(face, x, y):
    if face == 'front' and x in (3, 4) and y < 9:
        return jitter(TRIM, 0.03)
    return jitter(HOOD)


def jacket(face, x, y):        # second layer of the body: a gold-trimmed hem
    return jitter(TRIM, 0.03) if y >= 10 and face != 'top' else None


def arm(face, x, y):
    return jitter(SKIN) if y >= 10 or face == 'bottom' else jitter(HOOD)


def sleeve(face, x, y):
    return jitter(TRIM, 0.03) if y == 9 and face not in ('top', 'bottom') else None


def leg(face, x, y):
    return jitter(SHOE) if y >= 10 or face == 'bottom' else jitter(PANTS)


box(0, 0, 8, 8, 8, head)
box(32, 0, 8, 8, 8, hood)
box(16, 16, 8, 12, 4, body)
box(16, 32, 8, 12, 4, jacket)
box(40, 16, 4, 12, 4, arm)
box(32, 48, 4, 12, 4, arm)
box(40, 32, 4, 12, 4, sleeve)
box(48, 48, 4, 12, 4, sleeve)
box(0, 16, 4, 12, 4, leg)
box(16, 48, 4, 12, 4, leg)
img.save(OUT)
print(OUT)
