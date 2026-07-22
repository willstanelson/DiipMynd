## What I'm building

Lay down the full test-account Decart routing feature (the 5 base files from the verified zip) **with the two corrections baked in from the start** rather than applied as afterthoughts. No push at the end — leave it committed locally for you to review.

## File-by-file

### NEW — `supabase/migrations/015_test_provider_routing.sql`
Faithful copy of the verified version. Three pieces:
1. `profiles.has_funded_credits BOOLEAN NOT NULL DEFAULT false` + backfill (anyone with a paid-source ledger entry → `true`; sources `paystack`, `paystack-verify`, `crypto-verify`, `admin-approval`).
2. Redefine `adjust_credits` (same signature as 005) to flip the flag on `p_delta > 0 AND p_source IN ('paystack','paystack-verify','crypto-verify')` — additive, keeps the existing `IF p_reason/p_source` ledger guard.
3. Redefine `approve_credit_request` (same signature as 007) to set `has_funded_credits = true` on grant — faithful copy of 007's body.
4. `app_settings` table (service-role-only via RLS, no policies).
5. `stream_sessions.is_test_session BOOLEAN NOT NULL DEFAULT false`.

### NEW — `src/lib/appSettings.ts`
`getAppSetting(key)` (30s per-Lambda cache, env fallback via `process.env[key.toUpperCase()]`, no-cache on read error) + `setAppSetting(key, value, adminId)` (upsert, cache-bust on the writing instance). Verbatim from verified version.

### NEW — `src/app/api/admin/settings/route.ts`
Admin-gated. GET returns `decart_api_key_test` masked. POST whitelisted to `["decart_api_key_test"]` only, validates length ≥ 8. Verbatim from verified version.

### EDIT — `src/lib/auth.ts`
- Add `hasFundedCredits?: boolean` to `SafeUser`.
- Add `has_funded_credits` to both `.select(...)` strings (primary + post-fallback fetch).
- Add `hasFundedCredits: profile.has_funded_credits` to the returned object.

### EDIT — `src/app/api/stream/start/route.ts`
- Import `getAppSetting`.
- Compute `const isTestSession = !currentUser.isAdmin && !currentUser.hasFundedCredits;`
- Add `is_test_session: isTestSession` to **both** insert calls (initial + 23505 retry).
- Replace the Decart key resolution: `isTestSession ? await getAppSetting("decart_api_key_test") : process.env.DECART_API_KEY`, with **fail-closed** 500 if missing (never falls back to prod key for trial users).
- Return `isTestSession` in the response.

### CORRECTION 1 — EDIT `src/app/api/admin/users/route.ts`
The fix for the whitelist gap. Decouple promotion from the amount lever:
- **GET**: add `has_funded_credits` to the profile `.select(...)`, and surface `hasFundedCredits` on each `safeUser`.
- **POST**: accept `markAsFunded?: boolean` in the body. After resolving the profile, if `markAsFunded === true` → `supabaseAdmin.from("profiles").update({ has_funded_credits: true }).eq("id", userId)`. **One-way only**: a `false` (or absent) is a no-op, never a demotion — matches the irreversibility of the flag. Independent of the `amount` and `isSuspended` branches, so a pure promotion call (no amount) works. Surface `hasFundedCredits` on the returned `safeUser`.

### CORRECTION 2 — EDIT `src/app/api/admin/sessions/route.ts`
The fix for the visibility gap you already described:
- Add `is_test_session` to the `stream_sessions` `.select(...)`.
- Return `isTestSession` on each row in the response.

## How the corrections interact with the base
- `markAsFunded` writing `has_funded_credits` requires the column → migration 015 creates it. ✅
- `admin/sessions` returning `isTestSession` requires the column → migration 015 creates it. ✅
- `auth.ts` reading `has_funded_credits` requires the column → migration 015 creates it. ✅
- `stream/start` reading `currentUser.hasFundedCredits` requires the auth.ts edit. ✅

## What I will NOT touch
- `connect_stream_session` RPC, escrow math, settlement clamps — already hardened in `a83c1c4`, unrelated.
- The dead `/api/decart-auth` route — flagged for your call, not deleting without explicit ask.
- No Vercel cron / external scheduler (Bug #4, still out of scope).

## Verification at the end
- `npx tsc --noEmit` — must be clean.
- `npx eslint` on every changed/new file — must add zero new errors (pre-existing `require()` warning in `stream/end` and `RECORDING_SEGMENT_MS` dep warning in `LiveAvatarStream` are unrelated and stay).
- A `git diff --stat` review so you can see the blast radius before you decide to push.

## Not committing, not pushing
You said you've already pushed `a83c1c4` to prod. This is a new, separate feature set — I'll leave it as an uncommitted working-tree diff (or commit it locally on a branch if you prefer; I'll ask) so you can review before it goes anywhere outward.