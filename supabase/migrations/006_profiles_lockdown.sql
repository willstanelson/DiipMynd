-- ============================================================================
-- DiipMynd — Migration 006: `profiles` Table Hard-Lockdown
--
-- GOAL: close the trust-boundary gap (audit finding C1). The entire admin and
-- billing system reads `profiles.is_admin` and `profiles.credits`. Without RLS
-- + column grants, any client with the anon key could self-promote to admin or
-- mint credits. This migration makes that impossible at the database layer.
--
-- This migration is FULLY IDEMPOTENT — safe to run repeatedly and safe to run
-- whether or not the table, columns, policies, or triggers already exist.
--
-- Post-conditions:
--   * `profiles` exists with the columns the app expects.
--   * RLS is enabled.
--   * Authenticated users can SELECT their own row and UPDATE only `email`.
--   * `credits` and `is_admin` are NOT writable by clients (anon/authenticated)
--     — only the service_role (server) can modify them. Column-level GRANT
--     enforcement backs up the RLS row policy.
--   * A trigger provisions a default profile (100 credits, non-admin) on signup.
-- ============================================================================

-- ─── 1. Ensure the table exists (defensive; no-op if already present) ─────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    credits INTEGER NOT NULL DEFAULT 100,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ensure required columns exist regardless of how the table was originally created
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ─── 2. Enable Row Level Security ────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ─── 3. Replace ANY existing policies with a strict, minimal set ─────────────
-- Drop every existing policy first so re-running this migration can never leave
-- a stale permissive policy behind.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND schemaname = 'public' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', r.policyname);
    END LOOP;
END $$;

-- Users may read their own profile row. (credits & is_admin are visible so the
-- client can render balances / admin UI; writes are blocked below.)
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Users may update ONLY their own row, and only for non-sensitive display data.
-- The column-level GRANT below is what actually strips credits/is_admin from the
-- writable set; this row policy just enforces "only your own row".
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- No INSERT/DELETE policy for authenticated/anon. Profile rows are created by
-- the trigger (security definer) or by the service role. Clients cannot insert
-- or delete profiles directly.

-- ─── 4. Column-level privilege lockdown (defense in depth) ───────────────────
-- Revoke everything, then grant only what the client legitimately needs:
--   * SELECT on the whole row (RLS limits it to the owner's row anyway)
--   * UPDATE on `email` only — the single client-mutable column
-- `credits` and `is_admin` receive NO grant to anon/authenticated, so even a
-- client that somehow satisfies RLS cannot write them. The service_role bypasses
-- RLS and column grants, so all server-side credit/admin code keeps working.
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (email) ON public.profiles TO authenticated;

-- ─── 5. Auto-provision a profile on signup ───────────────────────────────────
-- Replaces the app-level fallback in auth.ts. Runs as SECURITY DEFINER so it can
-- insert into profiles even though clients have no INSERT policy.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, credits, is_admin)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        100,        -- default welcome credits
        false       -- never admin by default
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
