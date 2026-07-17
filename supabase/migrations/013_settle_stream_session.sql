-- ============================================================================
-- DiipMynd — Migration 013: Atomic Settle Stream Session & Reservation Hold
--
-- GOAL: Collapses flipping stream_sessions.status = 'ended' and settling
-- credit_reservations into a single PostgreSQL transaction. This guarantees
-- that a DB connection blip or JS error never leaves an escrow reservation
-- orphaned/locked forever.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_stream_session(
  p_session_id UUID,
  p_actual_cost INTEGER,
  p_outcome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res_id UUID;
  v_res_result JSONB;
  v_session_exists BOOLEAN;
BEGIN
  -- Verify if session exists
  SELECT EXISTS(SELECT 1 FROM public.stream_sessions WHERE id = p_session_id) INTO v_session_exists;
  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_found');
  END IF;

  -- Find active reservation for this session (idempotency query)
  SELECT id INTO v_res_id
    FROM public.credit_reservations
    WHERE reference_type = 'stream' 
      AND reference_id = p_session_id::TEXT 
      AND status = 'reserved'
    FOR UPDATE;

  -- Settle reservation if found
  IF FOUND THEN
    v_res_result := public.settle_reservation(v_res_id, p_actual_cost, p_outcome);
    IF NOT (v_res_result->>'ok')::BOOLEAN THEN
      RAISE EXCEPTION 'Reservation settlement failed: %', v_res_result;
    END IF;
  END IF;

  -- Update stream session status to ended
  UPDATE public.stream_sessions
    SET status = 'ended'
    WHERE id = p_session_id;

  RETURN jsonb_build_object('ok', true, 'code', 'settled', 'refunded', COALESCE((v_res_result->>'refunded')::INTEGER, 0));
END;
$$;

-- Revoke default public execution rights to prevent PostgREST client exposure
REVOKE EXECUTE ON FUNCTION public.settle_stream_session(UUID, INTEGER, TEXT) FROM PUBLIC;

-- Grant execution permissions only to service role
GRANT EXECUTE ON FUNCTION public.settle_stream_session(UUID, INTEGER, TEXT) TO service_role;
