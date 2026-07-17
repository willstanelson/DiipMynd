-- ============================================================================
-- DiipMynd — Migration 014: Add connected_at & atomic connect RPC
--
-- GOAL: Adds a nullable connected_at column to stream_sessions, and creates
-- an atomic connect_stream_session RPC function to set it and extend the
-- credit reservation expires_at from the exact moment of connection.
-- ============================================================================

-- 1. Add connected_at column to stream_sessions
ALTER TABLE public.stream_sessions
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMP WITH TIME ZONE;

-- 2. Create the connect_stream_session RPC
CREATE OR REPLACE FUNCTION public.connect_stream_session(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_status TEXT;
  v_connected_at TIMESTAMP WITH TIME ZONE;
  v_res_id UUID;
  v_amount_reserved INTEGER;
  v_new_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Select and lock the session
  SELECT status, connected_at INTO v_session_status, v_connected_at
    FROM public.stream_sessions
    WHERE id = p_session_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_found');
  END IF;

  IF v_session_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_active', 'status', v_session_status);
  END IF;

  -- Select and lock the reservation
  SELECT id, amount_reserved INTO v_res_id, v_amount_reserved
    FROM public.credit_reservations
    WHERE reference_type = 'stream'
      AND reference_id = p_session_id::TEXT
      AND status = 'reserved'
    FOR UPDATE;

  -- If already connected, just return the current expires_at
  IF v_connected_at IS NOT NULL THEN
    IF FOUND THEN
      SELECT expires_at INTO v_new_expires_at FROM public.credit_reservations WHERE id = v_res_id;
    ELSE
      v_new_expires_at := NOW();
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'already_connected', 'expires_at', v_new_expires_at);
  END IF;

  -- Mark the session as connected
  UPDATE public.stream_sessions
    SET connected_at = NOW(),
        last_billed_at = NOW(),
        last_keepalive_at = NOW()
    WHERE id = p_session_id;

  -- Rebase the reservation expiry deadline from NOW()
  IF FOUND THEN
    v_new_expires_at := NOW() + (v_amount_reserved * INTERVAL '1 second');
    UPDATE public.credit_reservations
      SET expires_at = v_new_expires_at,
          updated_at = NOW()
      WHERE id = v_res_id;
  ELSE
    v_new_expires_at := NOW();
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'connected', 'expires_at', v_new_expires_at);
END;
$$;

-- Revoke default public execution rights to prevent PostgREST client exposure
REVOKE EXECUTE ON FUNCTION public.connect_stream_session(UUID) FROM PUBLIC;

-- Grant execution permissions only to service role
GRANT EXECUTE ON FUNCTION public.connect_stream_session(UUID) TO service_role;
