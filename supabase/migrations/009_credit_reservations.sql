-- ============================================================================
-- DiipMynd — Migration 009: Credit Reservations Escrow System
--
-- Introduces the credit_reservations table to enforce a secure "hold" mechanism,
-- along with reserve_credits and settle_reservation RPC functions.
-- ============================================================================

-- 1. Create credit_reservations table
CREATE TABLE IF NOT EXISTS public.credit_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reference_type TEXT NOT NULL CHECK (reference_type IN ('job', 'stream', 'proxy_call')),
    reference_id TEXT NOT NULL,          -- job_id, session_id, or request UUID
    amount_reserved INTEGER NOT NULL CHECK (amount_reserved > 0),
    amount_committed INTEGER CHECK (amount_committed >= 0),
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Index for idempotency: ensures only one active hold can exist per resource reference
CREATE UNIQUE INDEX IF NOT EXISTS credit_reservations_ref_unique
    ON public.credit_reservations (reference_type, reference_id)
    WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_id ON public.credit_reservations (user_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_status_expires ON public.credit_reservations (status, expires_at);

-- Enable RLS (locked down: service-role/admin access only)
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

-- Lock down table-level privileges: only service_role (and superusers) can access
REVOKE ALL ON public.credit_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.credit_reservations TO service_role;

-- 2. RPC to reserve credits atomically
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

  -- Write audit log to ledger
  INSERT INTO public.credit_ledger (user_id, delta, reason, source)
    VALUES (
      p_user_id, 
      -p_amount, 
      'Hold: ' || p_reference_type || ' (' || p_reference_id || ')', 
      'escrow-reserve'
    );

  -- Insert the reservation hold record
  INSERT INTO public.credit_reservations (user_id, reference_type, reference_id, amount_reserved, expires_at)
    VALUES (
      p_user_id, 
      p_reference_type, 
      p_reference_id, 
      p_amount, 
      NOW() + (p_ttl_seconds * INTERVAL '1 second')
    )
    RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object('ok', true, 'code', 'reserved', 'reservation_id', v_reservation_id, 'new_balance', v_new);
END;
$$;

-- 3. RPC to settle / commit / release reservations atomically
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

      INSERT INTO public.credit_ledger (user_id, delta, reason, source)
        VALUES (
          v_res.user_id, 
          v_refund, 
          'Refund: ' || v_res.reference_type || ' (' || v_res.reference_id || ')', 
          'escrow-settle-refund'
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

    INSERT INTO public.credit_ledger (user_id, delta, reason, source)
      VALUES (
        v_res.user_id, 
        v_res.amount_reserved, 
        'Release: ' || v_res.reference_type || ' (' || v_res.reference_id || ')', 
        'escrow-release'
      );

    RETURN jsonb_build_object('ok', true, 'code', 'released', 'refunded', v_res.amount_reserved);
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  END IF;
END;
$$;

-- Revoke default public execution rights to prevent client-side RPC calls
REVOKE EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION settle_reservation(UUID, INTEGER, TEXT) FROM PUBLIC;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION settle_reservation(UUID, INTEGER, TEXT) TO service_role;

-- 4. Lock down stream_sessions inserts to server-side only
DROP POLICY IF EXISTS "users insert own sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Users can insert their own stream sessions" ON public.stream_sessions;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.stream_sessions;

