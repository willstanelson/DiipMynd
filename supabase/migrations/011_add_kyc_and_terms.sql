-- ============================================================================
-- DiipMynd — Migration 011: KYC Verification + Terms Acceptance Gate
--
-- Adds the columns and atomic award RPC backing the new signup flow:
--   1. Terms-of-service acceptance timestamp.
--   2. KYC status (Dojah), with a race-free credit-award RPC.
--   3. A real, idempotent-safe change to the live `credits` column default —
--      NOTE: editing 006_profiles_lockdown.sql's source text alone does NOT
--      change the default on an already-provisioned column. `ADD COLUMN IF
--      NOT EXISTS ... DEFAULT 100` no-ops once the column exists; only an
--      explicit ALTER COLUMN SET DEFAULT (below) changes it going forward.
--   4. Backfill for existing users so they are never retroactively locked
--      behind the new gate, and can never claim the 15-credit bonus after
--      the fact.
--
-- This migration is idempotent — safe to run more than once.
-- ============================================================================

-- ─── 1. Fix the live `credits` default (see note above) ───────────────────
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 0;

-- Keep the signup trigger in sync with the new default. CREATE OR REPLACE
-- always takes effect immediately, regardless of which migration file it's
-- declared in, so this is what actually changes new-signup behavior (editing
-- 006's source is documentation/fresh-install parity only).
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
        0,          -- default welcome credits (was 100) — credits are now
                    -- earned via KYC verification, not granted on signup
        false       -- never admin by default
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- ─── 2. Terms + KYC columns on profiles ────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS kyc_credits_awarded BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS kyc_reference TEXT DEFAULT NULL;

-- Idempotent CHECK constraint add, mirroring the pattern used in 005 for
-- credit_requests_tx_hash_unique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_kyc_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_kyc_status_check
      CHECK (kyc_status IN ('none', 'skipped', 'pending', 'verified'));
  END IF;
END $$;

-- No column-level GRANT needed for these new columns: 006 already locked
-- `authenticated` to UPDATE (email) only at the table level, which is a
-- whitelist — new columns are NOT writable by anon/authenticated by default.
-- They ARE readable, since 006 grants table-level SELECT, so the client can
-- read kyc_status / termsAcceptedAt to render the gate. Writes only ever
-- happen server-side via supabaseAdmin (service_role bypasses RLS + grants).

-- ─── 3. Atomic KYC verification + credit award RPC ─────────────────────────
-- Folds the entire "check eligibility, verify, award" sequence into one
-- SECURITY DEFINER transaction under a row lock — the app layer must NOT
-- do this as separate read-then-write calls (that's the exact TOCTOU class
-- of bug 009_credit_reservations.sql was written to eliminate elsewhere).
CREATE OR REPLACE FUNCTION public.verify_and_award_kyc(
  p_user_id UUID,
  p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status       TEXT;
  v_awarded      BOOLEAN;
  v_balance      INTEGER;
BEGIN
  -- Lock the profile row for the life of this check+mutate cycle so two
  -- concurrent calls (double-click, client retry, replayed reference id)
  -- cannot both observe "not yet awarded" before either one commits.
  SELECT kyc_status, kyc_credits_awarded, credits
    INTO v_status, v_awarded, v_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'user_not_found');
  END IF;

  -- Already resolved (previously verified and awarded, or re-verified after
  -- skip) — idempotent no-op so retries/duplicate calls are harmless.
  IF v_status = 'verified' OR v_awarded THEN
    UPDATE public.profiles SET kyc_reference = p_reference_id WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'code', 'already_verified',
      'credits_awarded', false, 'new_balance', v_balance
    );
  END IF;

  -- Verified after explicitly skipping first: mark verified, but the bonus
  -- was forfeited at skip time — matches the UI's stated forfeiture copy.
  IF v_status = 'skipped' THEN
    UPDATE public.profiles
      SET kyc_status = 'verified', kyc_reference = p_reference_id
      WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'code', 'verified_no_award',
      'credits_awarded', false, 'new_balance', v_balance
    );
  END IF;

  -- Fresh, immediate verification (never skipped) — award the bonus.
  v_balance := v_balance + 15;

  UPDATE public.profiles
    SET kyc_status = 'verified',
        kyc_credits_awarded = true,
        kyc_reference = p_reference_id,
        credits = v_balance
    WHERE id = p_user_id;

  INSERT INTO public.credit_ledger (user_id, delta, reason, source)
    VALUES (p_user_id, 15, 'KYC Verification Bonus', 'kyc-reward');

  RETURN jsonb_build_object(
    'ok', true, 'code', 'verified_and_awarded',
    'credits_awarded', true, 'new_balance', v_balance
  );
END;
$$;

-- Lock this down the way 009 locks down reserve_credits/settle_reservation —
-- without this, PostgREST exposes it at /rest/v1/rpc/verify_and_award_kyc
-- to any authenticated caller by default, letting them self-award the bonus
-- with a fabricated reference_id, completely bypassing Dojah verification.
REVOKE EXECUTE ON FUNCTION public.verify_and_award_kyc(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_award_kyc(UUID, TEXT) TO service_role;

-- ─── 4. Backfill existing users ─────────────────────────────────────────────
-- Existing users must never see the new gate, and must never be able to walk
-- through the KYC UI post-migration to claim a bonus they were never meant
-- to get. Setting kyc_credits_awarded = true (not just kyc_status) is what
-- actually closes that second path — their `credits` balance is untouched.
UPDATE public.profiles
  SET terms_accepted_at = NOW(),
      kyc_status = 'verified',
      kyc_credits_awarded = true
  WHERE terms_accepted_at IS NULL;
