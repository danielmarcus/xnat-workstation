#!/usr/bin/env bash
#
# download-llama-server.sh — Download pre-built llama-server binaries
# from llama.cpp GitHub releases for bundling into the Electron app.
#
# Usage:
#   bash scripts/download-llama-server.sh                        # all platforms
#   bash scripts/download-llama-server.sh --platform darwin-arm64  # single platform
#
# Environment:
#   LLAMA_CPP_VERSION — release tag to download (default: b5040)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/extraResources/llama-server"

# Pin a known-good release
VERSION="${LLAMA_CPP_VERSION:-b7989}"

BASE_URL="https://github.com/ggml-org/llama.cpp/releases/download/${VERSION}"

# ─── Platform helpers (bash 3.2 compatible — no associative arrays) ──

get_asset_name() {
  case "$1" in
    darwin-arm64) echo "llama-${VERSION}-bin-macos-arm64.tar.gz" ;;
    darwin-x64)   echo "llama-${VERSION}-bin-macos-x64.tar.gz" ;;
    win32-x64)    echo "llama-${VERSION}-bin-win-cpu-x64.zip" ;;
    linux-x64)    echo "llama-${VERSION}-bin-ubuntu-x64.tar.gz" ;;
    *) echo "" ;;
  esac
}

get_binary_name() {
  case "$1" in
    win32-x64) echo "llama-server.exe" ;;
    *)         echo "llama-server" ;;
  esac
}

ALL_PLATFORMS="darwin-arm64 darwin-x64 win32-x64 linux-x64"

# ─── Parse CLI args ───────────────────────────────────────────
PLATFORMS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORMS="${PLATFORMS} $2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PLATFORMS" ]]; then
  PLATFORMS="$ALL_PLATFORMS"
fi

# ─── Download + extract ──────────────────────────────────────

download_platform() {
  local platform="$1"
  local asset
  asset="$(get_asset_name "$platform")"
  local binary
  binary="$(get_binary_name "$platform")"
  local dest_dir="$OUTPUT_DIR/$platform"
  local dest_path="$dest_dir/$binary"

  if [[ -z "$asset" ]]; then
    echo "Unknown platform: $platform" >&2
    echo "Valid platforms: $ALL_PLATFORMS" >&2
    return 1
  fi

  # Skip if already exists
  if [[ -f "$dest_path" ]]; then
    echo "[$platform] Already exists at $dest_path — skipping"
    return 0
  fi

  local url="$BASE_URL/$asset"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  echo "[$platform] Downloading $url ..."
  if ! curl -fSL --progress-bar -o "$tmp_dir/$asset" "$url"; then
    echo "[$platform] ERROR: Download failed" >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  echo "[$platform] Extracting ..."
  if echo "$asset" | grep -q '\.tar\.gz$'; then
    tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
  elif echo "$asset" | grep -q '\.zip$'; then
    unzip -q "$tmp_dir/$asset" -d "$tmp_dir"
  fi

  # Find the llama-server binary inside the extracted archive
  # It may be in build/bin/, bin/, or flat depending on the release
  local found
  found="$(find "$tmp_dir" -name "$binary" -type f | head -1)"

  if [[ -z "$found" ]]; then
    echo "[$platform] ERROR: Could not find $binary in archive" >&2
    ls -R "$tmp_dir" >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  # Copy binary + companion shared libraries to destination
  mkdir -p "$dest_dir"
  cp "$found" "$dest_path"

  # Copy shared libraries (.dylib, .so, .dll) from the same directory as the binary.
  # llama-server b7989+ dynamically links against libmtmd, libllama, libggml, etc.
  local binary_dir
  binary_dir="$(dirname "$found")"

  local lib_count=0
  for lib in "$binary_dir"/*.dylib "$binary_dir"/*.so "$binary_dir"/*.so.* "$binary_dir"/*.dll; do
    if [[ -f "$lib" ]]; then
      cp "$lib" "$dest_dir/"
      lib_count=$((lib_count + 1))
      echo "[$platform]   Copied library: $(basename "$lib")"
    fi
  done
  # Also check parent lib/ directory (some releases put libs there)
  if [[ -d "$binary_dir/../lib" ]]; then
    for lib in "$binary_dir/../lib"/*.dylib "$binary_dir/../lib"/*.so "$binary_dir/../lib"/*.so.* "$binary_dir/../lib"/*.dll; do
      if [[ -f "$lib" ]]; then
        cp "$lib" "$dest_dir/"
        lib_count=$((lib_count + 1))
        echo "[$platform]   Copied library: $(basename "$lib")"
      fi
    done
  fi

  # Make executable on macOS/Linux
  case "$platform" in
    win32-*) ;;
    *) chmod +x "$dest_path"
       # Also make shared libs executable (needed for some linkers)
       for lib in "$dest_dir"/*.dylib "$dest_dir"/*.so "$dest_dir"/*.so.*; do
         if [[ -f "$lib" ]]; then
           chmod +x "$lib"
         fi
       done
       ;;
  esac

  rm -rf "$tmp_dir"

  local size
  size="$(du -sh "$dest_dir" | cut -f1)"
  echo "[$platform] Installed $dest_path + $lib_count libraries ($size total)"
}

echo "=== llama-server download (version: $VERSION) ==="
echo "Output: $OUTPUT_DIR"
echo ""

FAILED=0
for platform in $PLATFORMS; do
  if ! download_platform "$platform"; then
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [[ $FAILED -gt 0 ]]; then
  echo "=== Done ($FAILED platform(s) failed) ==="
  exit 1
else
  echo "=== Done (all platforms OK) ==="
fi
