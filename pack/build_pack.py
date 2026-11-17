"""Build the GENERATION pack for the launcher: python3 build_pack.py <instance dir> <out dir> <version> <files base url>

What it makes (in <out dir>):
- manifest.json: everything the launcher needs to install or update a player's copy
- blobs/<sha1>: every file the launcher downloads from us (named by content, so an unchanged file keeps its name
  and its URL across pack versions and is uploaded once)

What goes where:
- mods from CurseForge: not uploaded, the launcher fetches them from the CurseForge CDN (edge.forgecdn.net)
- our own mods / ports, resource packs: one blob each
- config, kubejs, tacz, datapacks...: zipped per folder; the launcher compares each file inside by sha1
- player preferences (options.txt, *client* configs): "defaults", written only when the player has no such file yet,
  so their own graphics/sound/keybind changes survive updates
"""
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path

INST = Path(sys.argv[1])
OUT = Path(sys.argv[2])
VERSION = sys.argv[3]
BASE = sys.argv[4].rstrip("/")  # e.g. https://github.com/<owner>/<repo>/releases/download/files

# folders zipped as managed archives (always kept equal to the pack)
ARCHIVES = ["config", "kubejs", "tacz", "datapacks", "defaultconfigs", "data_driven"]
# never shipped: caches, generated data, player data, our working files
EXCLUDE = [
    "config/tanshugetrees/dev", "config/inventory-particles/cache", "kubejs/exported", "kubejs/probe",
    "config/ftbquests/quests/../local",
]
EXCLUDE_NAMES = {".DS_Store", "Thumbs.db"}
# our own safety copies and switched-off scripts: x.toml.bak, x.bak_20261110, x.before-slots, x-backup.json, x.js.disabled
BACKUP_NAME = re.compile(r"\.bak($|_)|\.before-|\.orig$|\.old$|[-_.]backup\.|\.disabled$", re.I)
# player preferences: written once, then the player's
DEFAULT_FILES = ["options.txt", "servers.dat"]


def is_default(rel):
    """config files that hold the player's own preferences (graphics, sound, HUD, keys)"""
    name = rel.split("/")[-1].lower()
    return rel.startswith("config/") and ("client" in name or name in {
        "sodium-options.json", "iris.properties", "distanthorizons.toml", "keybindatlas-client.toml"})


def sha1(data):
    return hashlib.sha1(data).hexdigest()


def excluded(rel):
    name = rel.split("/")[-1]
    return (any(rel == e or rel.startswith(e + "/") for e in EXCLUDE) or name in EXCLUDE_NAMES
            or BACKUP_NAME.search(name) is not None)


blobs = OUT / "blobs"
blobs.mkdir(parents=True, exist_ok=True)


def put_blob(data):
    h = sha1(data)
    p = blobs / h
    if not p.exists():
        p.write_bytes(data)
    return {"url": f"{BASE}/{h}", "sha1": h, "size": len(data)}


inst = json.loads((INST / "minecraftinstance.json").read_text())
cf = {a["installedFile"]["fileName"]: a["installedFile"] for a in inst["installedAddons"] if a.get("installedFile")}

files = []
# ---- mods ---------------------------------------------------------------------------------------------------------------
for jar in sorted((INST / "mods").glob("*.jar")):
    data = jar.read_bytes()
    entry = {"path": f"mods/{jar.name}", "sha1": sha1(data), "size": len(data)}
    f = cf.get(jar.name)
    # CurseForge only when our jar is byte for byte the one it serves (type 1 = sha1); a jar we patched goes up as ours
    cf_sha1 = [h["value"] for h in (f or {}).get("hashes", []) if h.get("type") == 1]
    if f and f.get("downloadUrl") and entry["sha1"] in cf_sha1:
        entry["url"] = f["downloadUrl"]  # CurseForge CDN
        entry["source"] = "curseforge"
    else:
        entry.update(put_blob(data))
        entry["source"] = "pack"
    files.append(entry)

# ---- resource packs: ours, the player may add more ----------------------------------------------------------------------
for rp in sorted((INST / "resourcepacks").iterdir()):
    if rp.is_file() and rp.suffix == ".zip":
        e = put_blob(rp.read_bytes())
        files.append({"path": f"resourcepacks/{rp.name}", **e, "source": "pack"})

# ---- folders as archives ------------------------------------------------------------------------------------------------
archives = []


def add_archive(name, paths, kind):
    """paths: [(relative path, file path)] -> one zip blob with a per-file sha1 list"""
    buf = io.BytesIO()
    listing = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel, p in sorted(paths):
            data = p.read_bytes()
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))  # fixed date: same content, same zip
            info.compress_type = zipfile.ZIP_STORED if rel.endswith((".zip", ".jar", ".png", ".ogg")) \
                else zipfile.ZIP_DEFLATED
            z.writestr(info, data)
            listing.append({"path": rel, "sha1": sha1(data), "size": len(data)})
    if listing:
        archives.append({"name": name, "kind": kind, **put_blob(buf.getvalue()), "files": listing})


defaults = []
for folder in ARCHIVES:
    root = INST / folder
    if not root.exists():
        continue
    managed = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(INST).as_posix()
        if excluded(rel):
            continue
        (defaults if is_default(rel) else managed).append((rel, p))
    add_archive(folder, managed, "managed")
for rel in DEFAULT_FILES:
    if (INST / rel).exists():
        defaults.append((rel, INST / rel))
add_archive("defaults", defaults, "defaults")

loader = inst["baseModLoader"]["name"]  # e.g. neoforge-21.1.265
manifest = {
    "format": 1,
    "name": "GENERATION",
    "version": VERSION,
    "minecraft": inst["gameVersion"],
    "loader": {"type": loader.split("-")[0], "version": loader.split("-", 1)[1]},
    "java": 21,
    "memory": {"recommended": inst.get("allocatedMemory") or 8192, "minimum": 6144},
    "files": files,
    "archives": archives,
}
# the server's address ("host" or "host:port"), shown live in the launcher: put it in pack/server.txt once there is one
server_file = Path(__file__).resolve().parent / "server.txt"
if server_file.exists() and server_file.read_text().strip():
    manifest["server"] = server_file.read_text().strip()
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))

n_cf = sum(1 for f in files if f["source"] == "curseforge")
blob_size = sum(p.stat().st_size for p in blobs.iterdir())
print(f"version {VERSION}: {len(files)} files ({n_cf} from CurseForge), {len(archives)} archives, "
      f"{len(list(blobs.iterdir()))} blobs = {blob_size / 1e6:.0f} MB to upload")
