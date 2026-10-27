# DecampWatch NG

A real-time tracker of party defections ("decamping") by members of Nigeria's 10th National Assembly.

- What we're building: [docs/SPEC.md](docs/SPEC.md)
- How detection works: [AGENT.md](AGENT.md)
- Rules for contributors and Claude Code: [CLAUDE.md](CLAUDE.md)

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
| `SUPABASE_SECRET_KEY` | The project's secret key (`sb_secret_...`); it bypasses RLS, so it lives only here and in Vercel's server environment |
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

Each run writes a summary (feeds, articles, pre-filter rate, LLM calls, token counts, events, errors) to the job page and the log, and a row to `agent_runs`. A failing feed or article is listed there but leaves the run green. The run fails only if a stage crashes or no feed can be read.

Without the credential for the chosen backend, a scheduled run still ingests and stores articles, skips classification, and says so in a warning on the run page. Stored articles are classified, oldest first, on the first run after the secret is added. Manual runs do exactly what you choose and fail if the credential is missing.

On the `claude-cli` backend, classification counts against your subscription's usage limits, shared with your own Claude use. If a run hits the limit, the affected articles are left pending and retried on later runs; the run summary's Models row says which backend ran.

To run it by hand: **Actions → Agent → Run workflow**. Manual runs default to a dry run; untick it for a live run.

Notes:
- GitHub runs schedules from the default branch only, may start them several minutes late, and pauses them after 60 days without repository activity.
- Runs never overlap: a slow run delays the next one.
- A private repository pays for Actions minutes beyond its free allowance, and at 96 runs a day this adds up. A public repository runs free.
