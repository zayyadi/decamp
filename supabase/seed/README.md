# Roster seed files

| File | Use |
|---|---|
| `legislators.fictional.csv` | Demo roster. **All names are fictional**; constituencies are labelled "Demo" and sources point at `example.org`. Load with `--fictional`. |
| `legislators.template.csv` | Header for the real roster. Fill it from official sources (SPEC.md §9) and have a second person verify it before loading. |
| `state-assembly.historical.json` | Sourced state-assembly defections since June 2023, drafted into review by `npm run seed:assemblies` (not published on import). |
| `defections.historical.json` | Sourced historical Senate and House defections since June 2023. Real records; partial coverage documented in `docs/HISTORICAL_DATA.md`. |

States (`ng_states`) and parties (`parties`) are reference data in `supabase/migrations/`, not seed files.

`npm run seed -- --demo-events` imports `defections.historical.json` through the service-only `seed_historical_events` function after migrations are applied. Add `--dry-run` to validate offline. This is real data, not flagged fictional; the import hides the fictional roster and records partial coverage for the dashboard banner. It replays party changes chronologically rather than flattening repeated moves into a CSV row. `npm run seed:historical -- --file <file.json>` accepts another verified backfill.

Synthetic development defections remain available with `npm run seed -- --fictional-events` (planner in `scripts/lib/demo-events.ts`). They only touch fictional legislators, cite reserved `demo.example.invalid` URLs, and are hidden whenever demo mode is off.

## Columns

| Column | Required | Notes |
|---|---|---|
| `full_name` | yes | Without honorifics ("Sen.", "Hon.", "Dr.") |
| `name_variants` | no | Alternative spellings separated by `\|`, e.g., `Mohammed Bello\|Muhammed Bello` |
| `chamber` | yes | `senate` or `house` |
| `state` | yes | Exactly as in `ng_states`, e.g., `Akwa Ibom`, `FCT` |
| `constituency` | yes | Senatorial district or federal constituency |
| `elected_party` | yes | Party code they won on, e.g., `PDP` |
| `current_party` | yes | Party code today |
| `current_party_since` | if party changed | `YYYY-MM-DD` the current party took effect |
| `current_party_source_url` | if party changed | Source for that change |
| `status` | no | `sitting` (default), `former`, `deceased`, `vacated` |
| `term_start` | no | Defaults to `2023-06-13` (10th Assembly inauguration); set it for by-election winners |
| `left_office_on` | if not sitting | `YYYY-MM-DD` |
| `photo_url` | no | |
| `source_url` | real rows | Where this row was verified |
| `verified_at` | real rows | `YYYY-MM-DD` of verification |

Only one change of party since election can be recorded per row. A member who changed party more than once keeps their elected and current parties. The intermediate party is not recorded; note it in the verification log.

## Commands

```powershell
npm run seed -- --file supabase/seed/legislators.fictional.csv --fictional --dry-run   # validate only
npm run seed -- --file supabase/seed/legislators.fictional.csv --fictional
npm run seed -- --demo-mode on     # show fictional rows publicly (local demos only)
npm run seed -- --demo-mode off
```

Re-running a seed is safe. Existing rows (same chamber, state, constituency and name) get their metadata updated. A different `current_party` is reported as a warning and not applied, because party changes after the first seed go through the defection pipeline.
