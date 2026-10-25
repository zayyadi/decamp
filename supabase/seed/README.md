# Roster seed files

| File | Use |
|---|---|
| `legislators.fictional.csv` | Demo roster. **All names are fictional**; constituencies are labelled "Demo" and sources point at `example.org`. Load with `--fictional`. |
| `legislators.template.csv` | Header for the real roster. Fill it from official sources (SPEC.md §9) and have a second person verify it before loading. |

States (`ng_states`) and parties (`parties`) are reference data in `supabase/migrations/`, not seed files.

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
