-- Realtime (SPEC §6.4, Milestone 6): stream new alerts and event changes to
-- the dashboard. Realtime checks each change against the subscriber's RLS and
-- column grants, so anon receives only what it could select: published
-- events, and fictional rows only in demo mode. Nothing here widens access.
alter publication supabase_realtime add table public.alerts, public.defection_events;
