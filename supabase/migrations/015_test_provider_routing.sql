-- ============================================================================
-- DiipMynd — Migration 015: Test-Account Decart Routing
--
-- Goal: let KYC-bonus-only users get routed to a second, separate Decart
-- account/key (which naturally carries Decart's own realtime watermark,
-- since watermark removal is an opt-in application per platform.decart.ai/
-- watermark, not the default) instead of the paid production key — with
-- zero Vercel redeploys required to rotate the test key.
--
-- Three pieces:
--   1. profiles.has_funded_credits — a one-way flag. False until the user's
--      FIRST real (non-KYC) top-up lands. Once true, stays true forever —
--      once paid and free credits commingle in the single fungible `credits`
--      balance, there is no way to tell which unit is being spent, so we
--      don't try. A user is either "still on the free trial" or "a funded
--      user" — a single boolean, not a per-transaction bucket.
--   2. app_settings — a generic service-role-only key/value table so the
--      test Decart API key (and anything else operational like this) can be
--      rotated from the admin panel, not from Vercel's dashboard. This is
--      what actually removes the "change API code / redeploy" friction —
--      an env var still requires a redeploy on Vercel to pick up a changed
--      value; a DB-backed setting does not.
--   3. stream_sessions.is_test_session — so the admin live-sessions monitor
--      (added in a83c1c4) can visibly distinguish trial traffic from real
--      traffic at a glance.
--
-- Idempotent — safe to run more than once.
-- ============================================================================

-- ─── 1. has_funded_credits flag ────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS has_funded_credits BOOLEAN NOT NULL DEFAULT false;

-- Backfill: anyone with an existing paid-source ledger entry is already a
-- funded user and must never be dropped back onto the test key.
UPDATE public.profiles p
SET has_funded_credits = true
WHERE has_funded_credits = false
  AND EXISTS (
    SELECT 1 FROM public.credit_ledger cl
    WHERE cl.user_id = p.id
      AND cl.delta > 0
      AND cl.source IN ('paystack', 'paystack-verify', 'crypto-verify', 'admin-approval')
  );

-- Re-define adjust_credits (same signature as 005) to flip the flag the
-- moment a genuine paid top-up lands. Deductions and non-monetary sources
-- (e.g. 'kyc-reward', which does not even flow through this function, or
-- 'system') never touch this column.
CREATE OR REPLACE FUNCTION adjust_credits(
  p_user_id UUID,
  p_delta INTEGER,
  p_reason TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL
)
RETURNS TABLE(new_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INTEGER;
  v_new INTEGER;
BEGIN
  SELECT credits INTO v_current FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', p_user_id;
  END IF;

  IF p_delta < 0 AND v_current < ABS(p_delta) THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_current, ABS(p_delta);
  END IF;

  v_new := GREATEST(0, v_current + p_delta);

  UPDATE profiles SET credits = v_new WHERE id = p_user_id;

  IF p_delta > 0 AND p_source IN ('paystack', 'paystack-verify', 'crypto-verify') THEN
    UPDATE profiles SET has_funded_credits = true WHERE id = p_user_id AND has_funded_credits = false;
  END IF;

  IF p_reason IS NOT NULL OR p_source IS NOT NULL THEN
    INSERT INTO credit_ledger (user_id, delta, reason, source, admin_id)
    VALUES (p_user_id, p_delta, COALESCE(p_reason, 'Adjustment'), COALESCE(p_source, 'system'), p_admin_id);
  END IF;

  RETURN QUERY SELECT v_new;
END;
$$;

-- Re-define approve_credit_request (same signature as 007) — this path does
-- its own raw UPDATE rather than calling adjust_credits, so it needs the
-- same flag flip added directly.
CREATE OR REPLACE FUNCTION approve_credit_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_daily_limit INTEGER DEFAULT 500000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request        public.credit_requests%ROWTYPE;
  v_today_granted  INTEGER := 0;
  v_new_balance    INTEGER;
BEGIN
  SELECT * INTO v_request
    FROM public.credit_requests
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_completed');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;

  SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0), 0)
    INTO v_today_granted
    FROM public.credit_ledger
    WHERE admin_id = p_admin_id
      AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC');

  IF v_today_granted + v_request.amount > p_daily_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'daily_limit_exceeded',
      'today_granted', v_today_granted,
      'limit', p_daily_limit
    );
  END IF;

  UPDATE public.credit_requests
    SET status = 'completed'
    WHERE id = p_request_id;

  SELECT credits INTO v_new_balance
    FROM public.profiles
    WHERE id = v_request.user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', v_request.user_id;
  END IF;

  v_new_balance := v_new_balance + v_request.amount;

  UPDATE public.profiles
    SET credits = v_new_balance,
        has_funded_credits = true
    WHERE id = v_request.user_id;

  INSERT INTO public.credit_ledger (user_id, delta, reason, source, admin_id)
    VALUES (v_request.user_id, v_request.amount, 'Approved Manual Request',
            'admin-approval', p_admin_id);

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'granted',
    'new_balance', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_credits(UUID, INTEGER, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION approve_credit_request(UUID, UUID, INTEGER) TO service_role;

-- ─── 2. app_settings — DB-backed config, no redeploy to rotate ─────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- No policies granted to anon/authenticated on purpose — this table only
-- ever touches the server via supabaseAdmin (service_role bypasses RLS).
-- Mirrors the pattern used for profiles' column-level writes elsewhere.

-- ─── 3. stream_sessions.is_test_session ────────────────────────────────────
ALTER TABLE public.stream_sessions
    ADD COLUMN IF NOT EXISTS is_test_session BOOLEAN NOT NULL DEFAULT false;
