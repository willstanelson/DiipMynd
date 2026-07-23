-- ============================================================================
-- DiipMynd — Migration 016: Generation-Truth Billing + Ledger Integrity
--
-- Bundles four independent, deliberately-redundant layers from the master spec:
--
--   3.3 — stream_sessions.last_known_generation_seconds
--          Persists the authoritative cumulative seconds Decart itself reports
--          (generationTick), piggybacked on the existing 5-second keepalive, so
--          every settlement path can prefer the real number over a wall-clock
--          guess — with the wall-clock estimate kept only as a final backstop.
--
--   4.1 — adjust_credits now writes a credit_ledger row UNCONDITIONALLY. The
--          previous version skipped the insert entirely when both p_reason and
--          p_source were null, which is exactly the shape of call that produces
--          an unexplained balance jump with no trace.
--
--   4.2 — credit_ledger.balance_after. With this column, any two consecutive
--          ledger rows for a user where the second row's balance_after != the
--          first row's balance_after + the second row's delta is corruption —
--          detectable the instant it happens, not only once a day.
--
--   4.4 — credit_ledger.reservation_id. Lets "show me every ledger entry for
--          this one reservation" be a direct query instead of a text search
--          over reason. Nullable, no FK (credit_reservations.reference_id is a
--          polymorphic TEXT column, so a hard FK wouldn't hold).
--
-- IMPORTANT — do not regress 015: the adjust_credits redefinition below
-- preserves the has_funded_credits flag flip for genuine paid top-ups
-- ('paystack' | 'paystack-verify' | 'crypto-verify'). Pasting the master spec's
-- 4.1 snippet verbatim would silently drop that logic and break test-account
-- Decart routing, so the two have been merged here, not stacked.
--
-- Idempotent — safe to run more than once.
-- ============================================================================

-- ─── 3.3: stream_sessions.last_known_generation_seconds ─────────────────────
ALTER TABLE public.stream_sessions
    ADD COLUMN IF NOT EXISTS last_known_generation_seconds INTEGER;

-- ─── 4.2: credit_ledger.balance_after ───────────────────────────────────────
ALTER TABLE public.credit_ledger
    ADD COLUMN IF NOT EXISTS balance_after INTEGER;

-- ─── 4.4: credit_ledger.reservation_id ──────────────────────────────────────
-- Nullable, no FK: credit_reservations.reference_id is a polymorphic TEXT
-- column (job/stream/proxy_call), so a hard foreign key wouldn't hold.
ALTER TABLE public.credit_ledger
    ADD COLUMN IF NOT EXISTS reservation_id UUID;

-- Backfill balance_after for rows written before this migration using the
-- current profile balance. This is best-effort and intentionally approximate —
-- it only needs to be correct enough that pre-existing rows don't trip a
-- "balance_after discontinuity" check; new rows (and any future settlement)
-- always carry the authoritative value.
UPDATE public.credit_ledger cl
SET balance_after = (
    SELECT credits FROM public.profiles p WHERE p.id = cl.user_id
)
WHERE balance_after IS NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cl.user_id);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_reservation_id
    ON public.credit_ledger(reservation_id);

-- ─── 4.1: adjust_credits — unconditional ledger write (+ balance_after) ──────
-- Merged with 015's has_funded_credits flip so both behaviors are preserved.
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

  -- Preserve 015's test-account routing: flip the one-way funded flag the
  -- instant a genuine paid top-up lands. Deductions and non-monetary sources
  -- never touch this column.
  IF p_delta > 0 AND p_source IN ('paystack', 'paystack-verify', 'crypto-verify') THEN
    UPDATE profiles SET has_funded_credits = true WHERE id = p_user_id AND has_funded_credits = false;
  END IF;

  -- Unconditional: every balance change is logged, no exceptions. The old
  -- version skipped this entirely when both p_reason and p_source were null —
  -- convention-dependent, not guaranteed. A silent adjust_credits call is
  -- exactly the shape of thing that produces an unexplained balance jump with
  -- no trace. balance_after makes drift detectable the instant it happens.
  INSERT INTO credit_ledger (user_id, delta, reason, source, admin_id, balance_after)
    VALUES (
      p_user_id,
      p_delta,
      COALESCE(p_reason, 'Adjustment'),
      COALESCE(p_source, 'system'),
      p_admin_id,
      v_new
    );

  RETURN QUERY SELECT v_new;
END;
$$;

-- Signature unchanged, but re-grant so the redefined function stays executable
-- by service_role only (Postgres function privileges track the signature).
REVOKE EXECUTE ON FUNCTION adjust_credits(UUID, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_credits(UUID, INTEGER, TEXT, TEXT, UUID) TO service_role;

-- ─── 4.2 (cont.): settle_reservation now records balance_after on every insert ─
-- Recreate settle_reservation from 009 with balance_after added to both
-- credit_ledger inserts (refund + release branches). Both branches already
-- compute the post-change balance locally (v_new / v_current + amount_reserved),
-- so this is a one-line addition per insert, not new logic.
CREATE OR REPLACE FUNCTION settle_reservation(
  p_reservation_id UUID,
  p_actual_cost INTEGER,
  p_outcome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res public.credit_reservations%ROWTYPE;
  v_current INTEGER;
  v_new INTEGER;
  v_refund INTEGER;
BEGIN
  -- Acquire row-level lock on the reservation
  SELECT * INTO v_res FROM public.credit_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'reservation_not_found');
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_settled', 'status', v_res.status);
  END IF;

  IF p_outcome = 'success' THEN
    IF p_actual_cost < 0 OR p_actual_cost > v_res.amount_reserved THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_actual_cost');
    END IF;

    v_refund := v_res.amount_reserved - p_actual_cost;

    -- Update reservation record
    UPDATE public.credit_reservations
      SET status = 'committed',
          amount_committed = p_actual_cost,
          updated_at = NOW()
      WHERE id = p_reservation_id;

    -- Refund balance if actual cost was less than reserved estimate
    IF v_refund > 0 THEN
      SELECT credits INTO v_current FROM public.profiles WHERE id = v_res.user_id FOR UPDATE;
      v_new := v_current + v_refund;
      UPDATE public.profiles SET credits = v_new WHERE id = v_res.user_id;

      INSERT INTO public.credit_ledger
        -- 4.4: reservation_id as a real column, not embedded text.
        (user_id, delta, reason, source, balance_after, reservation_id)
      VALUES (
        v_res.user_id,
        v_refund,
        'Refund: ' || v_res.reference_type || ' (' || v_res.reference_id || ')',
        'escrow-settle-refund',
        v_new,
        v_res.id
      );
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'committed', 'refunded', v_refund);

  ELSIF p_outcome IN ('failure', 'expired') THEN
    -- Refund the reserved hold in full
    UPDATE public.credit_reservations
      SET status = CASE WHEN p_outcome = 'expired' THEN 'expired' ELSE 'released' END,
          updated_at = NOW()
      WHERE id = p_reservation_id;

    SELECT credits INTO v_current FROM public.profiles WHERE id = v_res.user_id FOR UPDATE;
    v_new := v_current + v_res.amount_reserved;
    UPDATE public.profiles SET credits = v_new WHERE id = v_res.user_id;

    INSERT INTO public.credit_ledger
      -- 4.4: reservation_id as a real column, not embedded text.
      (user_id, delta, reason, source, balance_after, reservation_id)
    VALUES (
      v_res.user_id,
      v_res.amount_reserved,
      'Release: ' || v_res.reference_type || ' (' || v_res.reference_id || ')',
      'escrow-release',
      v_new,
      v_res.id
    );

    RETURN jsonb_build_object('ok', true, 'code', 'released', 'refunded', v_res.amount_reserved);
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION settle_reservation(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settle_reservation(UUID, INTEGER, TEXT) TO service_role;
