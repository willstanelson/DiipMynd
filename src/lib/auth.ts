import { createClientWithCookies, supabaseAdmin } from "./supabase/server";

export interface SafeUser {
  id: string;
  email: string;
  credits: number;
  isAdmin: boolean;
  createdAt: string;
  isSuspended?: boolean;
  termsAcceptedAt?: string | null;
  kycStatus?: "none" | "skipped" | "pending" | "verified";
  kycCreditsAwarded?: boolean;
  hasFundedCredits?: boolean;
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const supabase = await createClientWithCookies();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;

    if (user.app_metadata?.is_suspended === true) {
      console.warn(`[auth] Access denied for suspended user: ${user.id}`);
      return null;
    }

    // Try reading user profile
    const { data: initialProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits, is_admin, created_at, terms_accepted_at, kyc_status, kyc_credits_awarded, has_funded_credits")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[auth] Failed to read profile:", profileError);
      return null;
    }

    let profile = initialProfile;

    // Failsafe fallback: create profile if missing (upsert with ignoreDuplicates to handle race conditions safely)
    if (!profile) {
      const { error: upsertError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          { id: user.id, email: user.email || "", credits: 0, is_admin: false },
          { onConflict: "id", ignoreDuplicates: true }
        );

      if (upsertError) {
        console.error("[auth] Failed to upsert profile fallback:", upsertError);
        return null;
      }

      // Fetch the profile to return (guarantees we get the row whether trigger or fallback inserted it)
      const { data: newProfile, error: fetchError } = await supabaseAdmin
        .from("profiles")
        .select("credits, is_admin, created_at, terms_accepted_at, kyc_status, kyc_credits_awarded, has_funded_credits")
        .eq("id", user.id)
        .single();

      if (fetchError) {
        console.error("[auth] Failed to fetch profile after fallback:", fetchError);
        return null;
      }
      profile = newProfile;
    }

    return {
      id: user.id,
      email: user.email || "",
      credits: profile.credits,
      isAdmin: profile.is_admin,
      createdAt: profile.created_at,
      termsAcceptedAt: profile.terms_accepted_at,
      kycStatus: profile.kyc_status as any,
      kycCreditsAwarded: profile.kyc_credits_awarded,
      hasFundedCredits: profile.has_funded_credits,
    };
  } catch (err) {
    console.error("[auth] Failed to retrieve current user:", err);
    return null;
  }
}
