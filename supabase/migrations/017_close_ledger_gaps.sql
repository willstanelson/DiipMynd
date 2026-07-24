-- ============================================================================
-- DiipMynd — Migration 017: Close Remaining Ledger Gaps
--
-- Migration 016 added balance_after and reservation_id to credit_ledger and
-- wired them into adjust_credits and settle_reservation. Three other RPCs
-- that also insert ledger rows were left untouched:
--
--   1. reserve_credits     (009) — the hold/debit side of every escrow
--   2. verify_and_award_kyc (011) — KYC bonus grant
--   3. approve_credit_request (015) — admin manual approval
--
-- All three already compute the post-change balance (v_new / v_balance /
-- v_new_balance) locally, so adding balance_after is a one-column addition
-- per INSERT, not new logic. reserve_credits also gets reservation_id since
-- the reservation UUID is available in the same scope.
--
-- Without this, the drift-detection layer from 4.2 sees NULLs on every hold
-- and award row, making those entries invisible to the "balance_after
-- discontinuity = corruption" check — exactly the rows where the +11 anomaly
-- (spec Part 4, open item) could hide.
--
-- Idempotent — CREATE OR REPLACE, safe to run more than once.
-- ============================================================================

-- ─── 1. reserve_credits — add balance_after + reservation_id ────────────────
-- Redefined from 009. Preserves all existing behavior; only change is the
-- credit_ledger INSERT gaining balance_after and reservation_id columns.
CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_reference_type TEXT,
  p_reference_id TEXT,
  p_ttl_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INTEGER;
  v_new INTEGER;
  v_reservation_id UUID;
  v_existing_id UUID;
  v_existing_status TEXT;
BEGIN
  -- Acquire row-level lock on user profile
  SELECT credits INTO v_current FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'user_not_found');
  END IF;

  -- Check for existing reservation (idempotency safety check)
  SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.credit_reservations
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id
    LIMIT 1;

  IF FOUND THEN
    IF v_existing_status = 'reserved' THEN
      RETURN jsonb_build_object('ok', true, 'code', 'already_reserved', 'reservation_id', v_existing_id);
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'already_settled', 'reservation_id', v_existing_id, 'status', v_existing_status);
    END IF;
  END IF;

  -- Verify balance
  IF v_current < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'code', 'insufficient_credits', 'available', v_current);
  END IF;

  -- Debit profile balance
  v_new := v_current - p_amount;
  UPDATE public.profiles SET credits = v_new WHERE id = p_user_id;

  -- Insert the reservation hold record (before the ledger insert so we have
  -- v_reservation_id available for the ledger's reservation_id column).
  INSERT INTO public.credit_reservations (user_id, reference_type, reference_id, amount_reserved, expires_at)
    VALUES (
      p_user_id,
      p_reference_type,
      p_reference_id,
      p_amount,
      NOW() + (p_ttl_seconds * INTERVAL '1 second')
    )
    RETURNING id INTO v_reservation_id;

  -- Write audit log to ledger — now with balance_after (4.2) and
  -- reservation_id (4.4) so drift detection covers hold rows too.
  INSERT INTO public.credit_ledger (user_id, delta, reason, source, balance_after, reservation_id)
    VALUES (
      p_user_id,
      -p_amount,
      'Hold: ' || p_reference_type || ' (' || p_reference_id || ')',
      'escrow-reserve',
      v_new,
      v_reservation_id
    );

  RETURN jsonb_build_object('ok', true, 'code', 'reserved', 'reservation_id', v_reservation_id, 'new_balance', v_new);
END;
$$;

REVOKE EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, TEXT, TEXT, INTEGER) TO service_role;

-- ─── 2. verify_and_award_kyc — add balance_after ────────────────────────────
-- Redefined from 011. Preserves all existing behavior; only change is the
-- credit_ledger INSERT gaining the balance_after column.
CREATE OR REPLACE FUNCTION verify_and_award_kyc(
  p_user_id UUID,
  p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_awarded BOOLEAN;
  v_balance INTEGER;
BEGIN
  SELECT kyc_status, kyc_credits_awarded, credits
    INTO v_status, v_awarded, v_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'user_not_found');
  END IF;

  -- Already resolved (previously verified and awarded, or re-verified after
  -- skip) — idempotent no-op so retries/duplicate calls are harmless.
  IF v_status = 'verified' OR v_awarded THEN
    UPDATE public.profiles SET kyc_reference = p_reference_id WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'code', 'already_verified',
      'credits_awarded', false, 'new_balance', v_balance
    );
  END IF;

  -- Verified after explicitly skipping first: mark verified, but the bonus
  -- was forfeited at skip time — matches the UI's stated forfeiture copy.
  IF v_status = 'skipped' THEN
    UPDATE public.profiles
      SET kyc_status = 'verified', kyc_reference = p_reference_id
      WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'code', 'verified_no_award',
      'credits_awarded', false, 'new_balance', v_balance
    );
  END IF;

  -- Fresh, immediate verification (never skipped) — award the bonus.
  v_balance := v_balance + 15;

  UPDATE public.profiles
    SET kyc_status = 'verified',
        kyc_credits_awarded = true,
        kyc_reference = p_reference_id,
        credits = v_balance
    WHERE id = p_user_id;

  -- Now with balance_after (4.2) so the KYC award is visible to drift detection.
  INSERT INTO public.credit_ledger (user_id, delta, reason, source, balance_after)
    VALUES (p_user_id, 15, 'KYC Verification Bonus', 'kyc-reward', v_balance);

  RETURN jsonb_build_object(
    'ok', true, 'code', 'verified_and_awarded',
    'credits_awarded', true, 'new_balance', v_balance
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_and_award_kyc(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_and_award_kyc(UUID, TEXT) TO service_role;

-- ─── 3. approve_credit_request — add balance_after ──────────────────────────
-- Redefined from 015. Preserves all existing behavior (including the
-- has_funded_credits = true flip); only change is the credit_ledger INSERT
-- gaining the balance_after column.
CREATE OR REPLACE FUNCTION approve_credit_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_daily_limit INTEGER DEFAULT 500000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request RECORD;
  v_today_granted INTEGER;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_request FROM public.credit_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'request_not_found');
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

  -- Now with balance_after (4.2) so admin grants are visible to drift detection.
  INSERT INTO public.credit_ledger (user_id, delta, reason, source, admin_id, balance_after)
    VALUES (v_request.user_id, v_request.amount, 'Approved Manual Request',
            'admin-approval', p_admin_id, v_new_balance);

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'granted',
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_credit_request(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approve_credit_request(UUID, UUID, INTEGER) TO service_role;
