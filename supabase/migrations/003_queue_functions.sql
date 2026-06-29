-- 1. Function to atomically claim jobs from the queue
CREATE OR REPLACE FUNCTION public.claim_generation_jobs(max_jobs integer, target_type text)
RETURNS SETOF public.generation_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.generation_jobs
    WHERE status = 'pending'
      AND (target_type IS NULL OR type = target_type)
      AND (next_eligible_at IS NULL OR next_eligible_at <= NOW())
    ORDER BY created_at ASC
    LIMIT max_jobs
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.generation_jobs
  SET status = 'processing',
      last_attempt_at = NOW(),
      retries = retries + 1
  WHERE id IN (SELECT id FROM claimed)
  RETURNING *;
END;
$$;

-- 2. Function to reap stale jobs (e.g. if the worker crashed mid-processing)
CREATE OR REPLACE FUNCTION public.reap_stale_jobs(timeout_minutes integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.generation_jobs
  SET status = 'pending',
      next_eligible_at = NOW() + (POWER(2, LEAST(retries, 5)) * INTERVAL '5 seconds')
  WHERE status = 'processing'
    AND last_attempt_at < NOW() - (timeout_minutes * INTERVAL '1 minute');
    
  -- Fail jobs that have exceeded retry limit
  UPDATE public.generation_jobs
  SET status = 'failed',
      payload = jsonb_set(payload, '{error}', '"Exceeded maximum retries due to worker crashes."')
  WHERE status = 'pending'
    AND retries >= 3;
END;
$$;
