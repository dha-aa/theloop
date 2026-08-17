#!/usr/bin/env bash
set -euo pipefail

readonly NAME="TheLoop"
readonly INSTALL_ROOT="${THELOOP_INSTALL_ROOT:-${HOME:?}/.theloop}"
readonly PATH_DIR="${THELOOP_PATH_DIR:-${HOME:?}/.local/bin}"
readonly RUNTIME_DIR="$INSTALL_ROOT/runtime"
readonly BIN_DIR="$INSTALL_ROOT/bin"
readonly CONFIG_DIR="$INSTALL_ROOT/config"
readonly CACHE_DIR="$INSTALL_ROOT/cache"
readonly CREDENTIALS_DIR="$INSTALL_ROOT/credentials"
readonly PATH_MARKER_BEGIN="# TheLoop PATH BEGIN"
readonly PATH_MARKER_END="# TheLoop PATH END"

say() { printf '%s\n' "$*"; }
fail() { say "✕ $*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail "Node.js is required. Install Node.js and run the installer again."
command -v npm >/dev/null 2>&1 || fail "npm is required. Install npm and run the installer again."
command -v curl >/dev/null 2>&1 || fail "curl is required. Install curl and run the installer again."
command -v tar >/dev/null 2>&1 || fail "tar is required. Install tar and run the installer again."

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in Darwin|Linux) ;; *) fail "Unsupported platform: $OS. TheLoop currently supports macOS and Linux.";; esac
case "$ARCH" in x86_64|amd64|arm64|aarch64) ;; *) fail "Unsupported architecture: $ARCH. TheLoop supports x64 and arm64.";; esac

DRY_RUN=0
for arg in "$@"; do [ "$arg" = "--dry-run" ] && DRY_RUN=1; done
say "TheLoop Installer"
say "✓ OS detected: $OS ($ARCH)"
if [ "$DRY_RUN" -eq 1 ]; then say "✓ Dry run: no files will be changed"; exit 0; fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR"
TEMP_DIR=""
cleanup() { [ -n "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"; }
trap cleanup EXIT
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  TEMP_DIR="$(mktemp -d)"
  ARCHIVE="$TEMP_DIR/theloop.tar.gz"
  curl -fsSL "${THELOOP_SOURCE_URL:-https://github.com/dha-aa/theloop/archive/refs/heads/main.tar.gz}" -o "$ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$TEMP_DIR"
  SOURCE_DIR="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -f "$SOURCE_DIR/package.json" ] || fail "Downloaded archive did not contain a TheLoop package."
fi

say "✓ Installing TheLoop"
if [ ! -d "$SOURCE_DIR/node_modules" ]; then
  (cd "$SOURCE_DIR" && npm install --ignore-scripts --no-audit --no-fund >/dev/null)
fi
(cd "$SOURCE_DIR" && npm run build >/dev/null)

mkdir -p "$INSTALL_ROOT" "$CONFIG_DIR" "$CACHE_DIR" "$CREDENTIALS_DIR" "$PATH_DIR"
STAGE="$(mktemp -d "$INSTALL_ROOT/.runtime-stage.XXXXXX")"
trap 'rm -rf "$STAGE"; cleanup' EXIT
mkdir -p "$STAGE/dist" "$STAGE/node_modules"
cp -R "$SOURCE_DIR/dist/." "$STAGE/dist/"
cp -R "$SOURCE_DIR/node_modules/." "$STAGE/node_modules/"
cp "$SOURCE_DIR/package.json" "$STAGE/package.json"
cp "$SOURCE_DIR/install.sh" "$STAGE/install.sh"
cp "$SOURCE_DIR/uninstall.sh" "$STAGE/uninstall.sh"
if [ -f "$INSTALL_ROOT/.install-manifest" ]; then
  grep -q '^TheLoop installation marker$' "$INSTALL_ROOT/.install-manifest" || fail "Existing installation is not managed by TheLoop; refusing to overwrite it."
fi
if [ -d "$RUNTIME_DIR" ]; then mv "$RUNTIME_DIR" "$INSTALL_ROOT/.runtime-previous"; fi
mv "$STAGE" "$RUNTIME_DIR"
[ -d "$INSTALL_ROOT/.runtime-previous" ] && rm -rf "$INSTALL_ROOT/.runtime-previous"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/theloop" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${THELOOP_GLOBAL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
exec node "$ROOT/runtime/dist/index.js" "$@"
WRAPPER
chmod 0755 "$BIN_DIR/theloop"
ln -sfn "$BIN_DIR/theloop" "$PATH_DIR/theloop"
printf '%s\n' 'TheLoop installation marker' "Version: 1.0.0" "Root: $INSTALL_ROOT" > "$INSTALL_ROOT/.install-manifest"

SHELL_NAME="$(basename "${SHELL:-}")"
case "$SHELL_NAME" in bash) RC="$HOME/.bashrc";; zsh) RC="$HOME/.zshrc";; fish) RC="$HOME/.config/fish/config.fish";; *) RC="";; esac
if [ -n "$RC" ]; then
  mkdir -p "$(dirname "$RC")"
  touch "$RC"
  if ! grep -Fq "$PATH_MARKER_BEGIN" "$RC"; then
    {
      printf '\n%s\n' "$PATH_MARKER_BEGIN"
      if [ "$SHELL_NAME" = fish ]; then printf 'fish_add_path "%s"\n' "$PATH_DIR"; else printf 'export PATH="%s:$PATH"\n' "$PATH_DIR"; fi
      printf '%s\n' "$PATH_MARKER_END"
    } >> "$RC"
  fi
fi

"$BIN_DIR/theloop" --version >/dev/null || fail "Installation verification failed."
say "✓ CLI installed"
say "✓ Runtime ready"
say "✓ Installation verified"
say ""
say "TheLoop is ready. Run:"
say "  cd your-project && theloop"
