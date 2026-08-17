#!/usr/bin/env bash
set -euo pipefail
readonly INSTALL_ROOT="${THELOOP_INSTALL_ROOT:-${HOME:?}/.theloop}"
readonly PATH_DIR="${THELOOP_PATH_DIR:-${HOME:?}/.local/bin}"
readonly PATH_MARKER_BEGIN="# TheLoop PATH BEGIN"
readonly PATH_MARKER_END="# TheLoop PATH END"
PURGE=0; YES=0; DRY_RUN=0
for arg in "$@"; do case "$arg" in --purge) PURGE=1;; --yes|-y) YES=1;; --dry-run) DRY_RUN=1;; esac; done
say() { printf '%s\n' "$*"; }
fail() { say "✕ $*" >&2; exit 1; }
[ ! -e "$INSTALL_ROOT/.install-manifest" ] && { say "TheLoop is not installed at $INSTALL_ROOT."; exit 0; }
grep -q '^TheLoop installation marker$' "$INSTALL_ROOT/.install-manifest" || fail "Installation marker is not owned by TheLoop; refusing removal."
say "TheLoop Uninstaller"; say ""; say "Global installation: $INSTALL_ROOT"; say "Project .theloop/ memory will NOT be deleted."
if [ "$PURGE" -eq 1 ]; then say "Purge will also remove global config, cache, and credentials."; fi
if [ "$YES" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then printf 'Remove global TheLoop installation? [y/N] '; read -r answer; case "$answer" in y|Y|yes|YES) ;; *) say "Cancelled."; exit 0;; esac; fi
[ "$DRY_RUN" -eq 1 ] && { say "Dry run: no files changed."; exit 0; }
rm -rf "$INSTALL_ROOT/bin" "$INSTALL_ROOT/runtime"
rm -f "$PATH_DIR/theloop"
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.config/fish/config.fish"; do
  [ -f "$rc" ] || continue
  tmp="$(mktemp)"
  awk -v begin="$PATH_MARKER_BEGIN" -v end="$PATH_MARKER_END" 'BEGIN { skip=0 } $0 == begin { skip=1; next } $0 == end { skip=0; next } !skip { print }' "$rc" > "$tmp"
  chmod 0644 "$tmp"
  mv "$tmp" "$rc"
done
if [ "$PURGE" -eq 1 ]; then rm -rf "$INSTALL_ROOT/config" "$INSTALL_ROOT/cache" "$INSTALL_ROOT/credentials"; fi
rm -f "$INSTALL_ROOT/.install-manifest" "$INSTALL_ROOT/.runtime-previous"
if [ -d "$INSTALL_ROOT" ] && [ -z "$(find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]; then rmdir "$INSTALL_ROOT"; fi
say "✓ CLI removed"; say "✓ Runtime removed"; [ "$PURGE" -eq 0 ] && say "✓ Global config, cache, and credentials preserved"; say "Project memory was preserved."
