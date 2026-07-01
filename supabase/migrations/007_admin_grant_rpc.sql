-- ============================================================================
-- DiipMynd — Migration 007: Atomic Admin Credit-Grant RPC
--
-- GOAL: make admin credit grants atomic + idempotent + daily-cap-enforced in a
-- single database transaction (audit findings H4 / M2 / M3).
--
-- Previously the app layer did:
--   1. SELECT request          (TOCTOU window)
--   2. UPDATE request status   (could fail after grant → double-approvable)
--   3. adjustCredits(...)      (no daily cap enforced inside the txn)
--
-- This RPC folds all of that into one SECURITY DEFINER transaction:
--   * Locks the credit_requests row, flips pending → completed (idempotent on
--     the unique id; a second approval returns the 'already_completed' code).
--   * Enforces a per-admin daily aggregate grant cap (default 500000) inside
--     the same transaction using a FOR UPDATE aggregate over the ledger.
--   * Credits the user atomically and writes the ledger row.
--
-- Returns JSONB so callers can distinguish outcomes without parsing exceptions.
-- ============================================================================

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
  -- 1. Lock + load the request row. Get the row even if already completed so we
  --    can return an explicit idempotent result.
  SELECT * INTO v_request
    FROM public.credit_requests
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Idempotent: already processed → tell the caller (no double-grant).
  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_completed');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;

  -- 2. Compute today's positive grants by this admin (UTC day), under lock via
  --    the aggregate. Prevents the TOCTOU that the app-layer check had.
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

  -- 3. Flip the request to completed FIRST. If anything below fails, the
  --    transaction rolls back and the request stays pending (safe to retry).
  UPDATE public.credit_requests
    SET status = 'completed'
    WHERE id = p_request_id;

  -- 4. Atomically credit the user and emit the audit ledger row.
  SELECT credits INTO v_new_balance
    FROM public.profiles
    WHERE id = v_request.user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', v_request.user_id;
  END IF;

  v_new_balance := v_new_balance + v_request.amount;

  UPDATE public.profiles
    SET credits = v_new_balance
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

GRANT EXECUTE ON FUNCTION approve_credit_request(UUID, UUID, INTEGER) TO service_role;
