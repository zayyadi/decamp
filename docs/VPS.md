# VPS deployment

Run one Next.js process on a Debian/Ubuntu VPS with systemd and Nginx. Supabase stays hosted and the agent stays in GitHub Actions. Deployment requires server access, a domain and DNS.

## Prepare the server

Install Node 24 system-wide at `/usr/bin/node`, Git, Nginx, Certbot and its Nginx plugin using their supported installation instructions. A root-only nvm installation will not work for the service account.

As a sudo-capable administrator:

```sh
sudo useradd --system --create-home --home-dir /srv/decamp --shell /bin/bash decamp
sudo install -d -o decamp -g decamp -m 750 /srv/decamp/releases
sudo install -d -o root -g decamp -m 750 /etc/decamp
sudo install -o root -g decamp -m 640 /dev/null /etc/decamp/web.env
sudoedit /etc/decamp/web.env
```

Populate the file in dotenv syntax with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CORRECTIONS_URL` and `SUPABASE_SECRET_KEY`. Use keys from the same production project and an HTTPS site origin. Keep the Anthropic key in GitHub Actions. Next.js reads this file through a `.env.local` symlink during build and runtime.

Point the domain's A record to the server; add AAAA only if IPv6 works. Allow SSH, HTTP and HTTPS through provider and host firewalls while preserving SSH access. Port 3000 binds only to loopback.

## Build a release

Run as `decamp` (`sudo -u decamp -H bash` from the administrator account), replacing repository and commit placeholders:

```sh
git clone <repository-url> /srv/decamp/releases/20261025-1
cd /srv/decamp/releases/20261025-1
git checkout <reviewed-commit>
ln -s /etc/decamp/web.env .env.local
npm ci
npm run build
```

For a private repository, provision a read-only deploy key for this account. Build with development dependencies: the CSS toolchain needs them. Use a unique release directory each time; never rebuild the live directory. Public environment changes require a new build. Allow memory and disk for building and retaining the old release.

## Start and enable HTTPS

As the administrator:

```sh
sudo -u decamp ln -s /srv/decamp/releases/20261025-1 /srv/decamp/current
sudo install -m 644 /srv/decamp/current/deploy/decamp.service /etc/systemd/system/decamp.service
sudo systemctl daemon-reload
sudo systemctl enable --now decamp
curl --fail http://127.0.0.1:3000/api/health
sudo install -m 644 /srv/decamp/current/deploy/nginx.conf /etc/nginx/sites-available/decamp
sudoedit /etc/nginx/sites-available/decamp
sudo ln -s /etc/nginx/sites-available/decamp /etc/nginx/sites-enabled/decamp
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.example --redirect
sudo certbot renew --dry-run
```

Replace `server_name` with the actual domain before testing Nginx. The HTTP configuration bootstraps the certificate: verify HTTPS and its redirect before signing in. Verify the certificate renewal timer is enabled. Response buffering is disabled to preserve Next.js streaming, per the installed self-hosting guide and [Nginx documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering).

Set the HTTPS origin in Supabase Auth. Apply migrations and follow the [launch checklist](MILESTONE_8.md). From a configured checkout run `npm run smoke -- --url https://your-domain.example`. Run `npm run launch:check` with the separate agent/service environment from `.env.example`; the web file intentionally contains fewer values. Test admin actions and realtime updates manually.

## Update and recover

Build another unique release. Save the previous target using `readlink -f /srv/decamp/current`, then switch atomically on the same filesystem:

```sh
sudo -u decamp ln -s /srv/decamp/releases/NEW-RELEASE /srv/decamp/current.next
sudo -u decamp mv -Tf /srv/decamp/current.next /srv/decamp/current
sudo systemctl restart decamp
curl --fail http://127.0.0.1:3000/api/health
```

Run the public smoke test. On failure repeat the switch to the saved previous target and restart. A restart briefly interrupts service; old browser tabs may need reloading. Retain the previous build and dependencies until verification. Shared environment changes affect old releases too: restore compatible values when rolling back and rebuild if public values changed. Database migrations need reviewed forward fixes.

Inspect `sudo journalctl -u decamp -n 100 --no-pager` and `sudo systemctl status decamp`. Monitor disk, certificate renewal and `/api/health`; securely back up environment configuration and maintain Supabase backups. Keep scheduled agent writes disabled until the launch rehearsal passes.
