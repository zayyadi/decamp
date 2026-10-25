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

**Secrets** (required):

| Name | Value |
|---|---|
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SECRET_KEY` | The project's secret key (`sb_secret_...`); it bypasses RLS, so it lives only here and in Vercel's server environment |
| `ANTHROPIC_API_KEY` | A Claude API key from the Anthropic Console. A Claude account login can't be used here |

**Variables** (`AGENT_CONTACT_URL` is required; the rest are optional and default as in AGENT.md §9):

| Name | Purpose |
|---|---|
| `AGENT_CONTACT_URL` | Public contact page, sent in the crawler's User-Agent |
| `CLASSIFIER_MODEL` | First-pass model |
| `ESCALATION_MODEL` | Model for ambiguous cases |
| `CONFIDENCE_PUBLISH` | Auto-publish threshold |
| `CONFIDENCE_REVIEW` | Unverified-alert threshold |
| `AGENT_LOOKBACK_HOURS` | Ingestion window |
| `AGENT_MAX_LLM_CALLS_PER_RUN` | Cost guard per run |

Each run writes a summary (feeds, articles, pre-filter rate, LLM calls, token counts, events, errors) to the job page and the log, and a row to `agent_runs`. A failing feed or article is listed there but leaves the run green. The run fails only if a stage crashes or no feed can be read.

To run it by hand: **Actions → Agent → Run workflow**. Manual runs default to a dry run; untick it for a live run.

Notes:
- GitHub runs schedules from the default branch only, may start them several minutes late, and pauses them after 60 days without repository activity.
- Runs never overlap: a slow run delays the next one.
- A private repository pays for Actions minutes beyond its free allowance, and at 96 runs a day this adds up. A public repository runs free.
