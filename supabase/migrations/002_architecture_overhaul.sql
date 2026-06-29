-- 1. Create generation_jobs table
CREATE TABLE IF NOT EXISTS public.generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL,
    result_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    retries INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    next_eligible_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS for generation_jobs
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own generation jobs"
    ON public.generation_jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own generation jobs"
    ON public.generation_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Enable Realtime for generation_jobs
ALTER PUBLICATION supabase_realtime ADD TABLE public.generation_jobs;


-- 2. Create stream_sessions table
CREATE TABLE IF NOT EXISTS public.stream_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_billed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_keepalive_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'active'
);

-- Create partial unique index to enforce one active stream per user
CREATE UNIQUE INDEX IF NOT EXISTS one_active_stream_per_user 
ON public.stream_sessions (user_id) 
WHERE status = 'active';

-- Enable RLS for stream_sessions
ALTER TABLE public.stream_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own stream sessions"
    ON public.stream_sessions FOR SELECT
    USING (auth.uid() = user_id);

-- Users don't insert directly into stream_sessions; the server does. 
-- Or if the client does, we allow it:
CREATE POLICY "Users can insert their own stream sessions"
    ON public.stream_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);


-- 3. Modify library_assets table
ALTER TABLE public.library_assets
ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
