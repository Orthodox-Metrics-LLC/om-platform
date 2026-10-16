#!/bin/bash
# Publish an OM Viewer desktop release to the public update feed.
# The Electron build must already have written the metadata. This script
# does not create latest.yml or latest-linux.yml.
#
# Usage:
#   publish-om-viewer-update.sh windows /path/to/dist
#   publish-om-viewer-update.sh linux   /path/to/dist
#
# Windows dist must contain:
#   latest.yml
#   OM Viewer Setup <version>.exe
#   OM Viewer Setup <version>.exe.blockmap
# Linux dist must contain:
#   latest-linux.yml
#   OM-Viewer-<version>.AppImage
#
# Installers are copied first. Metadata is copied last. Older versioned
# files already in the feed are left in place.
set -euo pipefail

RELEASE_ACCOUNT="next"
WIN_ROOT="/var/www/orthodoxmetrics-updates/om-viewer/windows/x64"
LIN_ROOT="/var/www/orthodoxmetrics-updates/om-viewer/linux/x64"

die() { echo "publish-om-viewer-update: $*" >&2; exit 1; }

if [[ "$(id -un)" != "$RELEASE_ACCOUNT" ]]; then
  die "only the ${RELEASE_ACCOUNT} release account may publish"
fi

platform="${1:-}"
src="${2:-}"
[[ "$platform" == "windows" || "$platform" == "linux" ]] || die "usage: $0 windows|linux /path/to/dist"
[[ -d "$src" ]] || die "build directory not found: $src"

require_generated_yml() {
  local yml="$1"
  [[ -s "$yml" ]] || die "missing generated metadata: $yml"
  grep -q '^version:' "$yml" || die "$yml has no version field; do not write it by hand"
  grep -q 'sha512:' "$yml" || die "$yml has no sha512 checksum; do not write it by hand"
  grep -q 'releaseDate:' "$yml" || die "$yml has no releaseDate; do not write it by hand"
}

install_file() {
  local file="$1" dest="$2"
  [[ -s "$file" ]] || die "empty or missing payload: $file"
  install -m 644 -o "$RELEASE_ACCOUNT" -g "$RELEASE_ACCOUNT" "$file" "$dest/"
}

shopt -s nullglob

if [[ "$platform" == "windows" ]]; then
  dest="$WIN_ROOT"
  [[ -d "$dest" ]] || die "release directory missing: $dest"
  exes=("$src"/OM\ Viewer\ Setup\ *.exe)
  maps=("$src"/OM\ Viewer\ Setup\ *.exe.blockmap)
  yml="$src/latest.yml"
  [[ ${#exes[@]} -ge 1 ]] || die "no 'OM Viewer Setup *.exe' in $src"
  [[ ${#maps[@]} -ge 1 ]] || die "no 'OM Viewer Setup *.exe.blockmap' in $src"
  require_generated_yml "$yml"
  for file in "${exes[@]}" "${maps[@]}"; do
    install_file "$file" "$dest"
  done
  install_file "$yml" "$dest"
  echo "Published Windows feed to $dest (metadata last)."
else
  dest="$LIN_ROOT"
  [[ -d "$dest" ]] || die "release directory missing: $dest"
  images=("$src"/OM-Viewer-*.AppImage)
  yml="$src/latest-linux.yml"
  [[ ${#images[@]} -ge 1 ]] || die "no 'OM-Viewer-*.AppImage' in $src"
  require_generated_yml "$yml"
  for file in "${images[@]}"; do
    install_file "$file" "$dest"
  done
  install_file "$yml" "$dest"
  echo "Published Linux feed to $dest (metadata last)."
fi
