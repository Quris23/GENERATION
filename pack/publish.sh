#!/bin/bash
# Publish a new pack version: ./publish.sh <instance dir> <version>
# Uploads only blobs the "files" release does not have yet, then replaces manifest.json in the "pack" release.
set -euo pipefail
REPO=Quris23/GENERATION
INST="$1"; VERSION="$2"
OUT="$(dirname "$0")/out"
rm -rf "$OUT"
python3 "$(dirname "$0")/build_pack.py" "$INST" "$OUT" "$VERSION" "https://github.com/$REPO/releases/download/files"
gh release view files -R $REPO >/dev/null 2>&1 || gh release create files -R $REPO --prerelease --title "Pack files" --notes "Files of the GENERATION pack, named by content hash. Used by the launcher."
gh release view pack -R $REPO >/dev/null 2>&1 || gh release create pack -R $REPO --prerelease --title "Pack manifest" --notes "Current version of the GENERATION pack for the launcher."
have=$(gh release view files -R $REPO --json assets --jq '.assets[].name')
for f in "$OUT"/blobs/*; do
  n=$(basename "$f")
  grep -qx "$n" <<<"$have" || { echo "upload $n ($(du -h "$f" | cut -f1))"; gh release upload files -R $REPO "$f"; }
done
gh release upload pack -R $REPO "$OUT/manifest.json" --clobber
echo "pack $VERSION published"
