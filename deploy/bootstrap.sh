#!/usr/bin/env bash
# One-time server setup for DecampWatch NG on an Ubuntu VPS (docs/VPS.md).
# Run as root from a checkout of this repository:
#
#   sudo bash deploy/bootstrap.sh --domain decampwatch.example.ng \
#     --repo https://github.com/zayyadi/decamp.git [--port 3100] \
#     [--https [--email you@example.org]]
#
# --https runs Certbot, which accepts Let's Encrypt's terms on your behalf.
#
# The server may host other sites, so this only adds: a `decamp` system
# account, /srv/decamp, /etc/decamp, a systemd unit and one Nginx site file.
# It never edits the default site or other sites, refuses a port already in
# use, and reloads Nginx only after `nginx -t` passes. Safe to re-run.
set -euo pipefail

domain="" port="3100" repo="" https="no" email=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) domain="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --https) https="yes"; shift ;;
    --email) email="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "bootstrap: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "run as root (sudo)"
[ -n "$domain" ] || fail "--domain is required (a hostname pointed at this server; a bare IP can't get a certificate)"
[ -n "$repo" ] || fail "--repo is required (the git URL to deploy from)"
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "--domain must be a hostname, got '$domain'"
[[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || fail "--port must be 1024-65535"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prerequisites. Node must be system-wide: the service account can't use a
# root-only nvm install.
missing=()
for cmd in git nginx curl; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
[ "$https" = yes ] && { command -v certbot >/dev/null || missing+=("certbot (apt install certbot python3-certbot-nginx)"); }
[ ${#missing[@]} -eq 0 ] || fail "missing: ${missing[*]}"
[ -x /usr/bin/node ] || fail "Node 22+ must be installed at /usr/bin/node (e.g. NodeSource's Node 24 packages)"
node_major="$(/usr/bin/node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || fail "/usr/bin/node is v$node_major; Node 22 or newer is required (.nvmrc pins 24)"

# Our own port only: if something else listens there, pick another --port.
if ss -ltnH "sport = :$port" | grep -q . && ! systemctl is-active --quiet decamp; then
  fail "port $port is already in use by another service; choose another with --port"
fi

id decamp >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/decamp --shell /bin/bash decamp
install -d -o decamp -g decamp -m 750 /srv/decamp /srv/decamp/releases
install -d -o root -g decamp -m 750 /etc/decamp
if [ ! -e /etc/decamp/web.env ]; then
  install -o root -g decamp -m 640 "$here/web.env.example" /etc/decamp/web.env
  echo "created /etc/decamp/web.env from the template: fill it in before the first release"
fi
cat > /etc/decamp/deploy.conf <<EOF
# Written by deploy/bootstrap.sh; read by deploy/release.sh.
DOMAIN=$domain
PORT=$port
REPO=$repo
EOF
chmod 644 /etc/decamp/deploy.conf

sed "s/--port [0-9]*/--port $port/" "$here/decamp.service" > /etc/systemd/system/decamp.service
systemctl daemon-reload
systemctl enable decamp >/dev/null

site=/etc/nginx/sites-available/decamp
if [ -e "$site" ] && ! grep -q "DecampWatch NG site" "$site"; then
  fail "$site exists and wasn't written by this script; not overwriting it"
fi
# Keep any HTTPS block Certbot already added on a re-run.
if [ ! -e "$site" ] || ! grep -q "managed by Certbot" "$site"; then
  sed -e "s/__DOMAIN__/$domain/" -e "s/__PORT__/$port/" "$here/nginx.conf" > "$site"
fi
ln -sfn "$site" /etc/nginx/sites-enabled/decamp
nginx -t
systemctl reload nginx

if [ "$https" = yes ]; then
  server_ips="$(hostname -I)"
  resolved="$(getent ahostsv4 "$domain" | awk 'NR==1 {print $1}')"
  [ -n "$resolved" ] && [[ " $server_ips " == *" $resolved "* ]] ||
    fail "$domain resolves to '${resolved:-nothing}', not this server ($server_ips); fix DNS, then re-run with --https"
  if [ -n "$email" ]; then account=(--email "$email"); else account=(--register-unsafely-without-email); fi
  certbot --nginx -d "$domain" --redirect --non-interactive --agree-tos "${account[@]}" --keep-until-expiring
  systemctl list-timers --all | grep -q certbot || echo "warning: no certbot renewal timer found; check certificate renewal"
fi

echo "bootstrap done: site $domain -> 127.0.0.1:$port. Next: fill /etc/decamp/web.env, then sudo bash deploy/release.sh <commit>."
