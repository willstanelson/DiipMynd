"use client";

import React, { useState, useEffect } from "react";

interface TermsAndKycModalProps {
  userEmail: string;
  onClose: () => void;
  onBalanceUpdated?: () => void;
  initialStep?: "terms" | "kyc";
  forfeitedCreditsWarningOnly?: boolean; // Set to true if launching from "Verify Now" button in header (no free credits)
}

export default function TermsAndKycModal({
  userEmail,
  onClose,
  onBalanceUpdated,
  initialStep = "terms",
  forfeitedCreditsWarningOnly = false,
}: TermsAndKycModalProps) {
  const [step, setStep] = useState<"terms" | "kyc" | "verifying" | "success">(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  // Load Dojah script dynamically
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://widget.dojah.io/widget.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      try {
        document.body.removeChild(script);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const handleAcceptTerms = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kyc/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to accept terms.");
      }
      setStep("kyc");
    } catch (err: any) {
      setError(err.message || "Failed to process terms acceptance.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipKyc = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kyc/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to skip KYC.");
      }
      if (onBalanceUpdated) {
        onBalanceUpdated();
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to skip KYC verification.");
    } finally {
      setLoading(false);
    }
  };

  const startDojahKyc = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kyc/initialize");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch KYC session configuration.");
      }

      const DojahConstructor = (window as any).Dojah;
      if (!DojahConstructor) {
        throw new Error("KYC Widget library is loading. Please wait a moment and try again.");
      }

      const options = {
        app_id: data.appId,
        p_key: data.publicKey,
        type: "custom",
        config: {
          widget_id: data.widgetId,
          debug: process.env.NODE_ENV !== "production",
        },
        userData: {
          email: userEmail,
        },
        onSuccess: async (response: any) => {
          console.log("[Dojah-widget] Verification success:", response);
          const refId = response.referenceId || response.reference;
          if (!refId) {
            setError("No verification reference ID returned from identity widget.");
            return;
          }
          await handleVerifyBackend(refId);
        },
        onError: (err: any) => {
          console.error("[Dojah-widget] Verification error:", err);
          setError("Identity verification widget encountered an error.");
        },
        onClose: () => {
          console.log("[Dojah-widget] Widget closed by user.");
        },
      };

      const connect = new DojahConstructor(options);
      connect.open();
    } catch (err: any) {
      setError(err.message || "Failed to launch KYC widget.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyBackend = async (refId: string) => {
    setStep("verifying");
    setError(null);
    try {
      const res = await fetch("/api/kyc/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceId: refId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Backend failed to verify reference.");
      }
      setStep("success");
      if (onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: any) {
      setError(err.message || "Identity verification succeeded on widget, but server verification failed.");
      setStep("kyc");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl p-6 flex flex-col gap-5 text-white animate-scaleUp transition-colors duration-200">
        
        {/* Step 1: Terms & Conditions Gate */}
        {step === "terms" && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <span className="text-3xl">📜</span>
              <h2 className="text-lg font-extrabold text-neutral-100 mt-2">
                Terms of Service & Content Policy
              </h2>
              <p className="text-xs text-neutral-400 mt-1">
                Please read and accept our content agreement to enter the workspace.
              </p>
            </div>

            <div className="max-h-60 overflow-y-auto p-4 bg-neutral-950/50 border border-neutral-800 rounded-2xl text-[11px] leading-relaxed text-neutral-300 flex flex-col gap-3 font-sans scrollbar-thin">
              <p className="font-bold text-neutral-150">Welcome to DiipMynd!</p>
              <p>
                By accessing this platform, you agree to comply with our AI safety rules. We utilize automated detection mechanisms and verification procedures to ensure a compliant ecosystem.
              </p>
              <div className="flex flex-col gap-2.5 mt-1 border-t border-neutral-800/60 pt-2">
                <div className="flex gap-2">
                  <span className="text-emerald-500 shrink-0 font-bold">1.</span>
                  <span><strong>Zero Exploitation Policy:</strong> Bot networks, account sharing, multi-account farming, and malicious scripts will trigger immediate, permanent account bans.</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-emerald-500 shrink-0 font-bold">2.</span>
                  <span><strong>Content Guidelines:</strong> Generation of explicit child abuse material, deepfakes without user consent, extreme violence, or weapons instruction is strictly prohibited.</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-emerald-500 shrink-0 font-bold">3.</span>
                  <span><strong>Infrastructure Abuse:</strong> Flooding backend streaming nodes or manipulating rate limits will result in resource denial and balance forfeiture.</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs text-rose-300">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleAcceptTerms}
              disabled={loading}
              className="w-full py-3 bg-white hover:bg-neutral-250 hover:bg-neutral-200 text-black font-extrabold text-xs rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5"
            >
              {loading ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
              ) : (
                "Agree & Continue"
              )}
            </button>
          </div>
        )}

        {/* Step 2: KYC Gate */}
        {step === "kyc" && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <span className="text-3xl">🛡️</span>
              <h2 className="text-lg font-extrabold text-neutral-100 mt-2">
                Account Identity Verification
              </h2>
              <p className="text-xs text-neutral-400 mt-1">
                Help us keep DiipMynd secure from automated bots and sybil attacks.
              </p>
            </div>

            {showSkipConfirm ? (
              <div className="p-5 rounded-2xl bg-amber-950/20 border border-amber-900/40 text-center flex flex-col gap-4">
                <span className="text-2xl text-amber-500 font-bold">⚠️ Warning</span>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  {forfeitedCreditsWarningOnly ? (
                    "Skipping KYC means your account status will remain unverified, which might restrict access to highly rate-limited premium rendering queues."
                  ) : (
                    "By skipping, you forfeit the 15 free streaming/generation credits permanently. Your account will start with a 0 credit balance."
                  )}
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowSkipConfirm(false)}
                    className="flex-1 py-2 text-xs font-bold border border-neutral-800 hover:bg-neutral-800 rounded-xl transition-all cursor-pointer"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSkipKyc}
                    disabled={loading}
                    className="flex-1 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {loading ? (
                      <div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    ) : (
                      "Skip & Forfeit"
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 rounded-2xl bg-neutral-950/40 border border-neutral-850 border-neutral-800 text-xs text-neutral-300 leading-relaxed flex flex-col gap-3">
                  <p>
                    We partner with <strong>Dojah KYC Verification</strong> to confirm unique user identities securely.
                  </p>
                  {!forfeitedCreditsWarningOnly && (
                    <div className="p-3 bg-emerald-950/25 border border-emerald-900/40 text-emerald-300 rounded-xl font-bold flex items-center gap-2">
                      <span>🎉</span>
                      <span>Verified signups immediately receive 15 free credits (~15 minutes of streaming time).</span>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs text-rose-300">
                    ⚠️ {error}
                  </div>
                )}

                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={startDojahKyc}
                    disabled={loading}
                    className="w-full py-3 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs rounded-xl transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                    ) : (
                      <>
                        <span>🛡️</span>
                        <span>Verify Identity</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setShowSkipConfirm(true)}
                    disabled={loading}
                    className="w-full py-2.5 bg-neutral-950/40 hover:bg-neutral-800/50 text-neutral-400 hover:text-neutral-350 text-xs font-bold rounded-xl transition-all border border-neutral-850 border-neutral-800 cursor-pointer"
                  >
                    Skip Verification
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* State: Verifying Backend Reference */}
        {step === "verifying" && (
          <div className="py-8 text-center flex flex-col items-center justify-center gap-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border border-neutral-850 border-neutral-800" />
              <div className="absolute inset-0 rounded-full border-2 border-neutral-800 border-t-white animate-spin" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-100">Verifying Identity</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-[250px] mx-auto leading-relaxed">
                Confirming Dojah transaction audit logs. Please do not close or refresh this page.
              </p>
            </div>
          </div>
        )}

        {/* State: Verification Success */}
        {step === "success" && (
          <div className="py-6 text-center flex flex-col items-center justify-center gap-5">
            <div className="w-14 h-14 rounded-full bg-emerald-950/35 border border-emerald-900/60 flex items-center justify-center text-3xl">
              ✓
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-100">Verification Complete!</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-[280px] mx-auto leading-relaxed">
                {forfeitedCreditsWarningOnly ? (
                  "Thank you! Your account identity is verified. You can now use all platform capabilities."
                ) : (
                  "Thank you! Your identity is verified and 15 welcome credits (~15 minutes of streaming) have been added to your balance."
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs rounded-xl transition-all active:scale-[0.98] cursor-pointer"
            >
              Enter Workstation
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
