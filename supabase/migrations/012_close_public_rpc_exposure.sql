-- ============================================================================
-- DiipMynd — Migration 012: Close PUBLIC RPC Exposure
--
-- GOAL: Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- Supabase's PostgREST auto-exposes every function in the `public` schema as
-- a callable REST endpoint (/rest/v1/rpc/<name>) to any authenticated (or
-- anon, where applicable) key holder — gated purely by that EXECUTE grant.
--
-- 009_credit_reservations.sql already identified and fixed this for
-- reserve_credits / settle_reservation ("Revoke default public execution
-- rights to prevent client-side RPC calls"). Several other privileged
-- functions never got the same treatment:
--
--   * adjust_credits          — SECURITY DEFINER, takes an arbitrary
--                                p_delta with no caller-identity check.
--                                Callable directly, this lets any
--                                authenticated user mint themselves
--                                unlimited credits.
--   * approve_credit_request  — SECURITY DEFINER, trusts a caller-supplied
--                                p_admin_id with NO internal check that the
--                                caller actually is that admin (or an admin
--                                at all) — that check only exists in the
--                                Next.js API route in front of it. Callable
--                                directly, any authenticated user can
--                                self-approve any pending credit_requests
--                                row.
--   * increment_rate_limit    — SECURITY DEFINER, bypasses rate_limits' RLS
--                                (which has zero policies = fully locked by
--                                design). Callable directly, lets a client
--                                grief another user's rate-limit key or
--                                reset their own.
--   * handle_new_user         — trigger function; not meaningfully
--                                exploitable outside trigger context (it
--                                references NEW), locked down anyway for
--                                defense in depth.
--   * claim_generation_jobs / reap_stale_jobs — SECURITY INVOKER (not
--                                DEFINER), so RLS on generation_jobs still
--                                applies to a direct caller and there's no
--                                UPDATE policy for authenticated/anon —
--                                low practical risk, but these are
--                                worker-only utilities with no legitimate
--                                client-facing purpose, so locked down for
--                                consistency.
--
-- This migration only changes privileges — no schema or logic changes, safe
-- to run at any time, and idempotent (REVOKE/GRANT are not cumulative).
-- ============================================================================

-- adjust_credits(UUID, INTEGER, TEXT, TEXT, UUID)
REVOKE EXECUTE ON FUNCTION adjust_credits(UUID, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_credits(UUID, INTEGER, TEXT, TEXT, UUID) TO service_role;

-- approve_credit_request(UUID, UUID, INTEGER)
REVOKE EXECUTE ON FUNCTION approve_credit_request(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approve_credit_request(UUID, UUID, INTEGER) TO service_role;

-- increment_rate_limit(TEXT, INTEGER)
REVOKE EXECUTE ON FUNCTION increment_rate_limit(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_rate_limit(TEXT, INTEGER) TO service_role;

-- handle_new_user() — defense in depth; only ever meant to run as a trigger.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- claim_generation_jobs(integer, text) / reap_stale_jobs(integer) — worker
-- utilities, no client-facing purpose.
REVOKE EXECUTE ON FUNCTION public.claim_generation_jobs(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_generation_jobs(integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reap_stale_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stale_jobs(integer) TO service_role;

-- ─── Verification ───────────────────────────────────────────────────────────
-- After running, confirm PUBLIC/anon/authenticated no longer resolve EXECUTE
-- on any of these. Each of the following should return `false`:
--
-- SELECT has_function_privilege('authenticated', 'adjust_credits(uuid,integer,text,text,uuid)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'approve_credit_request(uuid,uuid,integer)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'increment_rate_limit(text,integer)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'verify_and_award_kyc(uuid,text)', 'EXECUTE');
--
-- And this should return `true` (service_role must still work):
--
-- SELECT has_function_privilege('service_role', 'adjust_credits(uuid,integer,text,text,uuid)', 'EXECUTE');
