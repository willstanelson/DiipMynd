-- ============================================================================
-- DiipMynd — Migration 010: Fix Table Grants for Service Role
--
-- GOAL: Grant necessary table-level privileges on existing tables to the
-- service_role so server-side APIs can query them without throwing
-- permission denied errors. Explicitly avoids granting client-side access
-- (anon/authenticated roles) to maintain the security trust boundaries.
-- ============================================================================

GRANT ALL ON public.library_assets TO service_role;
GRANT ALL ON public.generation_jobs TO service_role;
GRANT ALL ON public.stream_sessions TO service_role;
GRANT ALL ON public.credit_ledger TO service_role;
GRANT ALL ON public.rate_limits TO service_role;
