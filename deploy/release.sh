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
# Overridable only so tests/ci/release.test.ts can run this in a temp folder.
home="${DECAMP_HOME:-/srv/decamp}"
etc="${DECAMP_ETC:-/etc/decamp}"
health_tries="${DECAMP_HEALTH_TRIES:-30}"

[ "$(id -u)" = 0 ] || fail "run as root (sudo)"
[ -r "$etc/deploy.conf" ] || fail "run deploy/bootstrap.sh first"
# shellcheck source=/dev/null
. "$etc/deploy.conf"
[ -s "$etc/web.env" ] && grep -q '^NEXT_PUBLIC_SUPABASE_URL=.' "$etc/web.env" ||
  fail "fill in $etc/web.env first (see deploy/web.env.example)"

releases="$home/releases"
current="$home/current"
as_decamp() { sudo -u decamp -H env PATH="/usr/bin:/bin" "$@"; }

healthy() {
  for _ in $(seq 1 "$health_tries"); do
    curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

# Release folder names, newest first. Names start with a UTC timestamp, so
# name order is build order (modification times change as files are added).
release_names() {
  local all=()
  shopt -s nullglob; all=("$releases"/*/); shopt -u nullglob
  local d
  for d in "${all[@]}"; do d="${d%/}"; echo "${d##*/}"; done | sort -r
}

switch_to() {
  as_decamp ln -sfn "$1" "$current.next"
  as_decamp mv -Tf "$current.next" "$current"
  systemctl restart decamp
}

# Empty on the first release: -e fails when the link doesn't exist yet.
previous="$(readlink -e "$current" 2>/dev/null || true)"

if [ "${1:-}" = "--rollback" ]; then
  # The newest release older than the live one (or the newest, if none is live).
  live_name="${previous##*/}"
  target=""
  while read -r name; do
    if [ -z "$previous" ] || [[ "$name" < "$live_name" ]]; then target="$releases/$name"; break; fi
  done < <(release_names)
  [ -n "$target" ] || fail "no earlier release to roll back to"
  switch_to "$target"
  healthy || fail "rolled back to $target, but /api/health still fails: see journalctl -u decamp"
  echo "rolled back to $target"
  exit 0
fi

ref="${1:-}"
[ -n "$ref" ] || fail "usage: release.sh <commit-or-branch> | --rollback"

# A cached clone keeps each release fetch small.
cache="$home/repo.git"
[ -d "$cache" ] || as_decamp git clone --quiet --mirror "$REPO" "$cache"
as_decamp git -C "$cache" remote update --prune >/dev/null
sha="$(as_decamp git -C "$cache" rev-parse --verify "$ref^{commit}")" || fail "unknown commit or branch: $ref"
# Nanoseconds keep two releases in the same second apart.
dir="$releases/$(date -u +%Y%m%d-%H%M%S-%N)-${sha:0:7}"

echo "building ${sha:0:7} in $dir"
as_decamp git clone --quiet "$cache" "$dir"
as_decamp git -C "$dir" checkout --quiet --detach "$sha"
as_decamp ln -s "$etc/web.env" "$dir/.env.local"
# Dev dependencies are needed: the CSS toolchain runs at build time.
if ! (cd "$dir" && as_decamp npm ci --no-audit --no-fund && as_decamp npm run build); then
  # Remove it, or --rollback (newest non-live folder) would pick a broken build.
  rm -rf -- "$dir"
  if [ -n "$previous" ]; then fail "build failed; the live release is unchanged ($previous)"; fi
  fail "build failed; no release is live yet"
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

# Keep the three newest releases, and never delete the live one.
live_now="$(readlink -e "$current")"
release_names | tail -n +4 | while read -r name; do
  [ "$releases/$name" = "$live_now" ] || rm -rf -- "${releases:?}/$name"
done

echo "live: ${sha:0:7} at https://$DOMAIN (previous: ${previous:-none})"
