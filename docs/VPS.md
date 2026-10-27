# VPS deployment

One Next.js process per server, run by systemd behind Nginx with HTTPS from Let's Encrypt. Supabase stays hosted and the agent stays in GitHub Actions. Two scripts do the work:

- [`deploy/bootstrap.sh`](../deploy/bootstrap.sh): one-time setup (account, folders, settings file, systemd unit, Nginx site, certificate).
- [`deploy/release.sh`](../deploy/release.sh): every deploy. It builds a commit in a fresh folder, switches over atomically, waits for `/api/health`, and switches back by itself if the check fails. `--rollback` returns to the previous release.

## Target server: 169.58.192.235

Checked from outside on 27 October 2026:

- Ubuntu with Nginx 1.24; SSH (22), HTTP (80) and HTTPS (443) open.
- **Shared:** it already serves `analytics.promisetracker.ng` over HTTPS, and Nginx's default page on plain HTTP. The scripts add their own site file (`/etc/nginx/sites-available/decamp`) and touch nothing else. `nginx -t` must pass before any reload.
- The app listens on **127.0.0.1:3100**, not 3000, in case another service uses 3000. `bootstrap.sh` refuses a port that's already taken; pass `--port` to choose another.

**It needs a hostname.** Let's Encrypt won't issue a normal certificate for a bare IP, and admin sign-in must use HTTPS. Create a DNS **A record** for a subdomain you control, for example `decampwatch.promisetracker.ng` → `169.58.192.235`. Add an AAAA record only if the server has working IPv6. For a short-lived test without DNS, `169-58-192-235.sslip.io` already resolves to this address.

Build headroom: `npm run build` needs roughly 2 GB of free memory, plus disk space for three releases (about 1 GB each with dependencies). Add swap if the server is small, since the other site keeps running during builds.

## 1. Prepare the server (once)

As a sudo-capable user on the server:

1. Install Node 24 system-wide at `/usr/bin/node` (for example NodeSource's packages; a root-only nvm install won't work for the service account), plus `git`, `curl`, and `certbot python3-certbot-nginx` from apt. Nginx is already installed.
2. Get the deploy scripts onto the server, and run the bootstrap:

   ```sh
   git clone https://github.com/zayyadi/decamp.git /tmp/decamp-setup
   sudo bash /tmp/decamp-setup/deploy/bootstrap.sh \
     --domain decampwatch.promisetracker.ng \
     --repo https://github.com/zayyadi/decamp.git
   ```

   For a private repository, give the `decamp` account a read-only deploy key and use the SSH URL as `--repo`.
3. Fill in `/etc/decamp/web.env` (`sudoedit /etc/decamp/web.env`). The template lists the five values: the Supabase URL and publishable key, the site's HTTPS origin, the corrections contact, and the server-only `SUPABASE_SECRET_KEY`. Use keys from the project this site should show. Never put the Anthropic key or the Claude token here; the agent runs in GitHub Actions.
4. Once the A record resolves to this server, add HTTPS:

   ```sh
   sudo bash /tmp/decamp-setup/deploy/bootstrap.sh \
     --domain decampwatch.promisetracker.ng \
     --repo https://github.com/zayyadi/decamp.git --https --email you@example.org
   ```

   This checks that DNS points here, then runs Certbot, which accepts Let's Encrypt's terms on your behalf and adds the HTTPS redirect. Re-running bootstrap later keeps Certbot's changes.

## 2. Release

```sh
sudo bash /tmp/decamp-setup/deploy/release.sh main
```

Any branch or commit SHA works. The script prints the live commit, or explains what failed. A failed build leaves the running release untouched, and a failed health check switches back automatically. To return to the previous release by hand:

```sh
sudo bash /tmp/decamp-setup/deploy/release.sh --rollback
```

`NEXT_PUBLIC_*` values are built into the app, so run a new release after changing them in `web.env`.

## 3. After the first release

1. In Supabase, **Authentication → URL Configuration**: set the site URL to the HTTPS origin and add it to the redirect URLs.
2. Apply any pending migrations from a configured checkout: `npx supabase@latest db push --db-url "<session-pooler connection string>"`.
3. From your own machine: `npm run smoke -- --url https://decampwatch.promisetracker.ng`. Every line must say PASS.
4. Sign in at `/admin/login` with an admin account and run the Milestone 7 checks: approve an item with an edit, reject one, reverse one (on fictional or test data only; a reversal publishes a public correction). Then publish a test event and watch the dashboard update within 3 seconds.
5. Follow [the launch checklist](MILESTONE_8.md) before announcing the site.

## Operating it

- Logs: `sudo journalctl -u decamp -n 100 --no-pager`; status: `sudo systemctl status decamp`.
- Health: `curl -fsS http://127.0.0.1:3100/api/health` on the server, or `/api/health` publicly. It returns 503 without details when the database is unreachable.
- Certificates renew through Certbot's timer: check with `sudo certbot renew --dry-run`.
- Back up `/etc/decamp/web.env` securely; it holds the service key. Database backups are Supabase's (SPEC §11).
- Database changes are independent of releases. Rolling the web app back doesn't undo a migration: fix forward with a new migration.
