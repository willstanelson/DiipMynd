-- ============================================================================
-- DiipMynd — Supabase Migration: Atomic Credit Adjustment Function
--
-- Run this SQL in your Supabase SQL Editor (Dashboard → SQL Editor → New Query).
--
-- This function atomically adjusts a user's credit balance using row-level
-- locking (SELECT ... FOR UPDATE), preventing race conditions when multiple
-- requests attempt to modify the same user's credits concurrently.
-- ============================================================================

CREATE OR REPLACE FUNCTION adjust_credits(
  p_user_id UUID,
  p_delta INTEGER
)
RETURNS TABLE(new_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INTEGER;
  v_new INTEGER;
BEGIN
  -- Acquire a row-level lock to prevent concurrent modifications
  SELECT credits INTO v_current
    FROM profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', p_user_id;
  END IF;

  -- For deductions (negative delta), enforce minimum balance of 0
  IF p_delta < 0 AND v_current < ABS(p_delta) THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_current, ABS(p_delta);
  END IF;

  v_new := GREATEST(0, v_current + p_delta);

  UPDATE profiles SET credits = v_new WHERE id = p_user_id;

  RETURN QUERY SELECT v_new;
END;
$$;

-- Grant execute to the service role (already has full access, but explicit is safer)
GRANT EXECUTE ON FUNCTION adjust_credits(UUID, INTEGER) TO service_role;
