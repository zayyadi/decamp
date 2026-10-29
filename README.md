# DecampWatch NG

A real-time tracker of party defections ("decamping") by members of Nigeria's 10th National Assembly.

- What we're building: [docs/SPEC.md](docs/SPEC.md)
- How detection works: [AGENT.md](AGENT.md)
- Rules for contributors and Claude Code: [CLAUDE.md](CLAUDE.md)

## Deployment

Production hosting uses a VPS with systemd, Nginx and HTTPS. Follow the [VPS deployment guide](docs/VPS.md) and [launch checklist](docs/MILESTONE_8.md). Supabase remains hosted; GitHub Actions runs the agent.

## Setup

Requires Node 22 or newer (24 is pinned in `.nvmrc`).

```powershell
npm install
Copy-Item .env.example .env.local   # fill in values as later milestones need them
npm run dev                         # http://localhost:3000
```

## Checks

```powershell
npm run lint
npm run typecheck
npm test
```

## Running the agent on GitHub Actions

`.github/workflows/agent.yml` runs `npm run agent` every 15 minutes against the database in `SUPABASE_URL`. Set these in the repository under **Settings → Secrets and variables → Actions**.

**Secrets** (`SUPABASE_URL` and `SUPABASE_SECRET_KEY` are required, plus the credential for your classification backend):

| Name | Value |
|---|---|
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SECRET_KEY` | The project's secret key (`sb_secret_...`); it bypasses RLS, so it lives only here and in the VPS server environment |
| `ANTHROPIC_API_KEY` | For `AGENT_LLM_BACKEND=api` (the default): a Claude API key from the Anthropic Console |
| `CLAUDE_CODE_OAUTH_TOKEN` | For `AGENT_LLM_BACKEND=claude-cli`: a long-lived token for your Claude subscription. Create it on your own machine with `claude setup-token` (Claude Code installed and signed in) and paste it here. The workflow installs Claude Code and classifies through `claude -p` |

**Variables** (`AGENT_CONTACT_URL` is required; the rest are optional and default as in AGENT.md §9):

| Name | Purpose |
|---|---|
| `AGENT_CONTACT_URL` | Public contact page, sent in the crawler's User-Agent |
| `AGENT_LLM_BACKEND` | `api` (default) or `claude-cli` (classify with a Claude subscription instead of an API key) |
| `CLASSIFIER_MODEL` | First-pass model |
| `ESCALATION_MODEL` | Model for ambiguous cases |
| `CONFIDENCE_PUBLISH` | Auto-publish threshold |
| `CONFIDENCE_REVIEW` | Unverified-alert threshold |
| `AGENT_LOOKBACK_HOURS` | Ingestion window |
| `AGENT_MAX_LLM_CALLS_PER_RUN` | Cost guard per run |
| `AGENT_LIVE_ENABLED` | Set to `true` after launch rehearsal; schedules otherwise use `--dry-run` |

Each run writes a summary (feeds, articles, pre-filter rate, LLM calls, token counts, events, errors) to the job page and the log. Live runs also write a row to `agent_runs`; dry runs write no database records. Workflow logs are retained as artifacts for seven days. A failing feed or article is listed there but leaves the run green. The run fails only if a stage crashes or no feed can be read.

Without the credential for the chosen backend, a scheduled run still ingests and stores articles (when `AGENT_LIVE_ENABLED` is `true`), skips classification, and says so in a warning on the run page. Stored articles are classified, oldest first, on the first run after the secret is added. Manual runs do exactly what you choose and fail if the credential is missing.

On the `claude-cli` backend, classification counts against your subscription's usage limits, shared with your own Claude use. If a run hits the limit, the affected articles are left pending and retried on later runs; the run summary's Models row says which backend ran.

To run it by hand: **Actions → Agent → Run workflow**. Manual runs default to a dry run; untick it for a live run.

Notes:
- GitHub runs schedules from the default branch only, may start them several minutes late, and pauses them after 60 days without repository activity.
- Runs never overlap: a slow run delays the next one.
- A private repository pays for Actions minutes beyond its free allowance, and at 96 runs a day this adds up. A public repository runs free.

## Admin review

Deployment instructions, launch checks and recovery steps are in the [Milestone 8 runbook](docs/MILESTONE_8.md).

Editors review uncertain detections at `/admin/review`, reverse published defections at `/admin/published`, and see agent runs at `/admin/runs`.

To add an editor:
1. In the Supabase dashboard, **Authentication → Users → Add user**, with an email and password. Keep public sign-ups disabled (**Authentication → Sign In / Providers**).
2. Grant the role. `app_metadata` is writable only with the service role, so users can't promote themselves:
   ```powershell
   npm run admin -- --grant editor@example.org
   ```
3. The editor signs in at `/admin/login`. `npm run admin -- --list` shows current admins; `--revoke` removes the role (effective at their next token refresh).

Every approve, edit, reject and merge runs as one database transaction and is recorded in `review_feedback`.

## Historical demo data

The default demo uses sourced defections by senators and House members in the 10th National Assembly, starting in June 2023. Read [the coverage and source notes](docs/HISTORICAL_DATA.md): this is a partial backfill, not a complete roster or a complete count of defections through today.

Apply the migrations to your Supabase project, then run:

```sh
npm run seed -- --demo-events --dry-run
npm run seed -- --demo-events
```

The import runs in one transaction, publishes through `publish_defection`, preserves repeat moves and source links, dates alerts historically, and hides fictional data. Re-running skips existing events. The dashboard banner explains that party totals cover recorded members only. Synthetic development events remain available with `npm run seed -- --fictional-events`.

State-assembly records are drafted into the review queue instead of being published: run `npm run seed:assemblies` (add `-- --dry-run` to validate), then review them under *State-assembly backfill* at `/admin/review`. Rerun it after approvals to link follow-up events and record departures. See [the notes](docs/HISTORICAL_DATA.md#state-houses-of-assembly).
