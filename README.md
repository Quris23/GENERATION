# GENERATION

Launcher for the GENERATION modpack (NeoForge 1.21.1) for macOS and Windows.

- `launcher/` — the app (Electron): offline nickname, skin, game folder, memory, install / update / play
- `pack/build_pack.py` — turns the modpack instance into `manifest.json` + files for GitHub Releases

Pack files: release `files` (by content hash). Current pack: `manifest.json` in the `pack` release (replaced on every pack update).
Launcher builds: `.github/workflows/launcher.yml`, on a `launcher-v*` tag.
