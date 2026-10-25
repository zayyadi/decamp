# Milestone 8: deployment and launch

Launch tooling is implemented. Production deployment and the evidence below remain required before acceptance. The historical preview does not satisfy the complete-roster requirement.

## Workspace verification (25 October 2026)

Lint, typecheck, all 439 tests and the production build pass. Smoke checks against the local production server pass for `/`, `/legislators`, `/about`, `/admin/login`, `/api/health` and signed-out redirects for all three admin pages. This verifies the local build, not a deployed VPS origin.

The cached Claude CLI eval passes with 100% Confirmed precision, 94.6% recall and 100% entity accuracy. The API eval cannot run without an Anthropic key or populated API cache.

The configured database passes anonymous draft, fictional-member and article-body checks. The readiness RPC could not be audited; pending migrations or service access need resolution. The production site URL, corrections contact, agent environment and all manual launch evidence remain incomplete. No production deployment or live agent run was performed.

## Production database

Use a dedicated Supabase production project. Apply every migration in timestamp order with `npx supabase@latest db push --db-url <connection-string>`. Protect the connection string from logs and shell history. Never edit an applied migration.

Seed the sourced roster following SPEC §9 and obtain independent two-person verification. Run `npm run seed -- --demo-mode off`. Disable public sign-ups, create editors manually, and verify `npm run admin -- --list`. Configure backups and test a restore into an isolated database. Record evidence without secrets or private user information.

## Web deployment

Deploy to a VPS using the [systemd and Nginx setup](VPS.md). It includes HTTPS bootstrap, release builds, health checks and rollback. Use Node 24, `npm ci` and `npm run build`. Supabase stays hosted and the agent stays in GitHub Actions.

Configure these production environment values before building:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public API key for that project |
| `NEXT_PUBLIC_SITE_URL` | Canonical production HTTPS origin |
| `NEXT_PUBLIC_CORRECTIONS_URL` | Working public HTTPS contact page or mailto address |
| `SUPABASE_SECRET_KEY` | Server-only service key for authorized admin actions |

Use a separate development database for previews. Public variables are embedded at build time: rebuild when they change. Keep the environment file outside the checkout, readable only by the administrator and application account. Keep the agent's Anthropic key in GitHub Actions.

Configure the production origin in Supabase Auth's site and redirect settings. Follow the Milestone 7 handoff to test admin sign-in, approval, rejection and reversal. Verify the `/about` corrections link.

## Rehearsal and acceptance

Configure the Actions secrets and variables in README. Leave `AGENT_LIVE_ENABLED` unset or `false` during rehearsal. Scheduled runs use `--dry-run`; manual dispatch follows its explicit dry-run input. Dry runs write no `agent_runs` rows, so retain the workflow log artifacts as evidence before their seven-day expiry.

Collect at least 72 hours of dry-run decisions and inspect every proposed Confirmed event for false positives. Complete publisher terms reviews, run the API eval and estimate monthly cost from observed model usage plus hosting, database and Actions charges.

Record dated evidence in `docs/launch-evidence.json` only after completing each check. Run:

```sh
npm run lint
npm run typecheck
npm test
npm run eval
npm run build
npm run launch:check -- --output /tmp/decamp-launch-report.json
npm run smoke -- --url https://your-production-origin
```

The launch audit must exit zero with every check passing. Smoke checks must pass for public routes, database health and signed-out admin redirects. Manually test mobile and keyboard navigation, chart table alternatives, source links and a realtime publication update within three seconds.

After evidencing SPEC §11, set the Actions variable `AGENT_LIVE_ENABLED=true` to enable scheduled writes. Inspect the first live run and resulting records. Update the milestone tracker after acceptance.

## Failure recovery

- Missing `launch_readiness` RPC or admin visibility policy: apply pending migrations, then rerun the audit.
- Health HTTP 503: check server logs, environment and schema. The endpoint intentionally omits internal errors and secrets.
- API eval cache miss without an Anthropic key: configure the API key. Cached Claude CLI metrics remain indicative.
- Launch audit reports BLOCKED: resolve each listed configuration or evidence gap before launch.
- Incorrect publication: set `AGENT_LIVE_ENABLED=false`, inspect logs and reverse eligible latest events using the audited admin flow. Keep corrections visible.
- Broken web deployment: restore a previously verified deployment. Database changes are independent; preserve backups and use reviewed forward migrations rather than deleting history.
