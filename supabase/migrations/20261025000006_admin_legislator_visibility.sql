-- Admins can already read fictional events with demo mode off, but their
-- legislator joins were filtered out, causing getPublished's schema to fail.
-- Restore the documented admin read access without exposing demo rows publicly.
create policy "admins read all legislators" on public.legislators
  for select to authenticated using (public.is_admin());

-- party_affiliations' existing policy follows legislator visibility, so
-- restoring the member also restores the affiliation needed for reversal.
