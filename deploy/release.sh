#!/usr/bin/env bash
# Builds and switches to a release of DecampWatch NG (docs/VPS.md). Run as root
# after deploy/bootstrap.sh:
#
#   sudo bash deploy/release.sh <commit-or-branch>     # e.g. main, or a SHA
#   sudo bash deploy/release.sh --rollback             # back to the previous release
#
# Builds as the `decamp` account in a fresh directory, never in the live one,
# then switches /srv/decamp/current atomically and restarts. If /api/health
# isn't OK within 60 s, it switches back to the previous release by itself.
# Keeps the last three releases.
set -euo pipefail

fail() { echo "release: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "run as root (sudo)"
[ -r /etc/decamp/deploy.conf ] || fail "run deploy/bootstrap.sh first"
# shellcheck source=/dev/null
. /etc/decamp/deploy.conf
[ -s /etc/decamp/web.env ] && grep -q '^NEXT_PUBLIC_SUPABASE_URL=.' /etc/decamp/web.env ||
  fail "fill in /etc/decamp/web.env first (see deploy/web.env.example)"

releases=/srv/decamp/releases
current=/srv/decamp/current
as_decamp() { sudo -u decamp -H env PATH="/usr/bin:/bin" "$@"; }

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

switch_to() {
  as_decamp ln -sfn "$1" "$current.next"
  as_decamp mv -Tf "$current.next" "$current"
  systemctl restart decamp
}

previous="$(readlink -f "$current" 2>/dev/null || true)"

if [ "${1:-}" = "--rollback" ]; then
  target="$(ls -1dt "$releases"/*/ 2>/dev/null | sed 's:/$::' | grep -vxF "$previous" | head -1)"
  [ -n "$target" ] || fail "no earlier release to roll back to"
  switch_to "$target"
  healthy || fail "rolled back to $target, but /api/health still fails: see journalctl -u decamp"
  echo "rolled back to $target"
  exit 0
fi

ref="${1:-}"
[ -n "$ref" ] || fail "usage: release.sh <commit-or-branch> | --rollback"

# A cached clone keeps each release fetch small.
cache=/srv/decamp/repo.git
[ -d "$cache" ] || as_decamp git clone --quiet --mirror "$REPO" "$cache"
as_decamp git -C "$cache" remote update --prune >/dev/null
sha="$(as_decamp git -C "$cache" rev-parse --verify "$ref^{commit}")" || fail "unknown commit or branch: $ref"
dir="$releases/$(date -u +%Y%m%d-%H%M%S)-${sha:0:7}"

echo "building ${sha:0:7} in $dir"
as_decamp git clone --quiet "$cache" "$dir"
as_decamp git -C "$dir" checkout --quiet --detach "$sha"
as_decamp ln -s /etc/decamp/web.env "$dir/.env.local"
# Dev dependencies are needed: the CSS toolchain runs at build time.
if ! (cd "$dir" && as_decamp npm ci --no-audit --no-fund && as_decamp npm run build); then
  fail "build failed; the live release is unchanged ($previous)"
fi

switch_to "$dir"
if ! healthy; then
  echo "release: /api/health failed after switching to ${sha:0:7}" >&2
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    switch_to "$previous"
    healthy && fail "switched back to $previous; inspect: journalctl -u decamp -n 100"
  fi
  fail "no healthy release is running; inspect: journalctl -u decamp -n 100"
fi

# Keep the three newest releases (the live one is always among them).
ls -1dt "$releases"/*/ | sed 's:/$::' | tail -n +4 | while read -r old; do
  [ "$old" = "$(readlink -f "$current")" ] || rm -rf -- "$old"
done

echo "live: ${sha:0:7} at https://$DOMAIN (previous: ${previous:-none})"
