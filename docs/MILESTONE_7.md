# Milestone 7 handoff

Admin review is implemented at `/admin/review`, `/admin/published` and `/admin/runs`. Pages and server actions verify Supabase admin claims; SQL checks authorization again. Approval applies corrections and calls `publish_defection` in one transaction. Edits, rejection and duplicate merging write review feedback. Reversal restores the previous affiliation and publishes a correction.

The default demo command now imports real, sourced Senate and House defections since 2023. [Historical coverage notes](HISTORICAL_DATA.md) explain the incomplete roster and remaining gaps. It hides the old fictional records, preserves repeated party changes and historical alert dates, and labels imported event provenance separately from AI detections.

## Database setup still required

The configured hosted database rejected the new importer because its migration has not been applied. That attempt wrote nothing. This workspace has a service API key, but no linked Supabase CLI project or database connection configured for migrations.

1. Apply pending migrations, including `supabase/migrations/20261025000005_historical_events.sql`, using your database migration connection or the Supabase SQL editor. For the CLI, use `npx supabase@latest db push --db-url <connection-string>`.
2. Run `npm run seed -- --demo-events --dry-run`. It validates the complete file offline and reports the chamber totals/date range.
3. Run `npm run seed -- --demo-events`. The result reports inserted/skipped counts. Repeat it: inserted must be zero and all supplied events must be skipped.
4. Open `/`: the historical preview banner must be visible, fictional names hidden, both chambers represented, and party totals labelled as recorded-member totals. Event pages link to original sources and identify historical imports.

The synthetic development flow remains `npm run seed -- --fictional-events` and requires the fictional roster. It is separate from real historical data.

## Verification

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass. Tests include the full researched dataset imported into PostgreSQL via PGlite, rerun idempotency, full rollback on error, source linking, deceased-member affiliation closure, and anonymous/admin import denial. Existing admin transaction and RLS tests pass.

`npm run eval -- --llm=claude-cli` passes using 75 cached responses and zero live calls: confirmed precision 100%, recall 94.6%, entity accuracy 100%. These are the previously accepted indicative CLI metrics. `npm run eval` with the API backend remains blocked by an absent Anthropic key/API cache; detection logic was not changed.

## Admin smoke test

Create an editor account in Supabase Auth and grant it with `npm run admin -- --grant <email>` as documented in README. Signed-out `/admin/review` must redirect to login; a signed-in non-admin must see the access explanation. An admin should be able to edit and approve a queued event, reject another with a reason, and reverse the latest published change with a public correction note. Party counts change only for approval/reversal. `/admin/runs` shows actual agent runs or an explicit empty state.

Historical records are confirmed backfill, so importing them intentionally does not fabricate uncertain queue items or agent runs. Use real agent-routed review items, or a separate fictional development database, to exercise those screens manually.

Common setup failures: a missing `seed_historical_events` RPC or `historical_coverage` column means migrations are pending; permission errors mean the script lacks the service key; a party mismatch means the existing roster and supplied history disagree and the entire import is refused. Resolve the discrepancy through source review rather than overwriting membership history.

If `/admin/published` reports a Zod error for a null `legislator` after demo mode is disabled, apply `20261025000006_admin_legislator_visibility.sql`. Published events were visible to admins while fictional legislators were still filtered out. This admin-only SELECT policy restores the documented access; the existing affiliation policy follows it. Public and ordinary-user visibility remains unchanged. The regression test in `tests/db/rls.test.ts` verifies the published-event join and reversal affiliation with demo mode off.

The published query also accepts null member joins so an unavailable record cannot crash the whole page while that migration is pending. Those events retain their recorded names, show an access warning, and have reversal disabled. `tests/lib/admin-queries.test.ts` exercises the actual `getPublished` parser with mixed visible and unavailable member records.
