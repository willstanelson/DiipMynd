-- ============================================================================
-- DiipMynd — Supabase Migration: Security Overhaul
--
-- Adds UNIQUE constraint to credit_requests, creates credit_ledger and
-- rate_limits tables, updates adjust_credits RPC, and enables RLS on V3 tables.
-- ============================================================================

-- 1. Ensure tx_hash is strictly unique to prevent TOCTOU
ALTER TABLE public.credit_requests ADD CONSTRAINT credit_requests_tx_hash_unique UNIQUE (tx_hash);

-- 2. Create credit_ledger table for audit trails
CREATE TABLE IF NOT EXISTS public.credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_credit_ledger_user_id ON public.credit_ledger(user_id, created_at);
CREATE INDEX idx_credit_ledger_admin_id ON public.credit_ledger(admin_id, created_at);

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own ledger" ON public.credit_ledger
  FOR SELECT USING (auth.uid() = user_id);

-- Add telegram_file_id to library_assets
ALTER TABLE public.library_assets ADD COLUMN telegram_file_id TEXT;

-- 3. Update adjust_credits function with optional audit parameters
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
  SELECT credits INTO v_current
    FROM profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', p_user_id;
  END IF;

  IF p_delta < 0 AND v_current < ABS(p_delta) THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_current, ABS(p_delta);
  END IF;

  v_new := GREATEST(0, v_current + p_delta);

  UPDATE profiles SET credits = v_new WHERE id = p_user_id;

  IF p_reason IS NOT NULL OR p_source IS NOT NULL THEN
    INSERT INTO credit_ledger (user_id, delta, reason, source, admin_id)
    VALUES (p_user_id, p_delta, COALESCE(p_reason, 'Adjustment'), COALESCE(p_source, 'system'), p_admin_id);
  END IF;

  RETURN QUERY SELECT v_new;
END;
$$;

-- 4. Enable RLS on V3 tables
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own jobs" ON public.generation_jobs
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.stream_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own sessions" ON public.stream_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- 5. Rate Limits Table
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Enable strict RLS: Admin/service-role only
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies mean anon/authenticated users have zero access. Only service_role can bypass.

-- Atomic increment RPC for rate limits
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_key TEXT,
  p_window_ms INTEGER
)
RETURNS TABLE(new_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  INSERT INTO rate_limits (key, count, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE 
              WHEN EXTRACT(EPOCH FROM (NOW() - rate_limits.window_start)) * 1000 > p_window_ms THEN 1
              ELSE rate_limits.count + 1
            END,
    window_start = CASE 
                     WHEN EXTRACT(EPOCH FROM (NOW() - rate_limits.window_start)) * 1000 > p_window_ms THEN NOW()
                     ELSE rate_limits.window_start
                   END
  RETURNING count INTO v_new_count;

  -- 1% chance to passively clean up old rate limit entries
  IF random() < 0.01 THEN
    BEGIN
      DELETE FROM rate_limits 
      WHERE key IN (
        SELECT key FROM rate_limits 
        WHERE window_start < NOW() - INTERVAL '1 hour' 
        LIMIT 1000
      );
    EXCEPTION WHEN OTHERS THEN
      -- Silently swallow cleanup errors so we don't fail the user's rate limit check
      NULL;
    END;
  END IF;

  RETURN QUERY SELECT v_new_count;
END;
$$;
