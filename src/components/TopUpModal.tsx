"use client";

import React, { useState } from "react";

interface TopUpModalProps {
  userEmail: string;
  onClose: () => void;
}

interface PricingPackage {
  id: string;
  name: string;
  credits: number;
  durationText: string;
  price: string;
  popular?: boolean;
}

const PACKAGES: PricingPackage[] = [
  {
    id: "trial",
    name: "Trial Bundle",
    credits: 600, // 10 minutes
    durationText: "10 minutes stream time",
    price: "₦49,500",
  },
  {
    id: "starter",
    name: "Starter Bundle",
    credits: 1800, // 30 minutes
    durationText: "30 minutes stream time",
    price: "₦135,000",
    popular: true,
  },
  {
    id: "standard",
    name: "Standard Bundle",
    credits: 3600, // 1 hour
    durationText: "1 hour stream time",
    price: "₦243,000",
  },
  {
    id: "pro",
    name: "Pro Bundle",
    credits: 18000, // 5 hours
    durationText: "5 hours stream time",
    price: "₦1,080,000",
  },
];

export default function TopUpModal({ userEmail, onClose }: TopUpModalProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRequestPackage = async (pkg: PricingPackage) => {
    setSubmittingId(pkg.id);
    setError(null);

    try {
      const res = await fetch("/DiipMynd/api/credits/initialize-paystack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize checkout.");
      }

      if (data.authorizationUrl) {
        // Redirect to Paystack secure payment page
        window.location.href = data.authorizationUrl;
      } else {
        throw new Error("No payment URL received from billing server.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to initialize checkout";
      setError(message);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fadeIn">
      <div className="w-full max-w-4xl bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl p-6 flex flex-col gap-6 animate-scaleUp">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              💳 Instant Credit Funding
            </h2>
            <p className="text-xs text-white/50 mt-1">
              Select a bundle and purchase credits securely using Card or Bank Transfer via Paystack.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Dynamic error display */}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-2">
          {PACKAGES.map((pkg) => {
            const isSubmitting = submittingId === pkg.id;

            return (
              <div
                key={pkg.id}
                className={`relative p-5 rounded-2xl bg-white/[0.02] border flex flex-col justify-between transition-all ${
                  pkg.popular
                    ? "border-violet-500/50 shadow-md shadow-violet-500/5 bg-gradient-to-b from-white/[0.03] to-transparent"
                    : "border-white/5 hover:border-white/10"
                }`}
              >
                {pkg.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-600 text-white uppercase tracking-wider">
                    Best Value
                  </span>
                )}

                <div>
                  <h3 className="text-xs font-bold text-white mb-0.5">{pkg.name}</h3>
                  <p className="text-[9px] text-white/40 mb-3">{pkg.durationText}</p>
                  <p className="text-xl font-extrabold text-white mb-5 tracking-tight tabular-nums">
                    {pkg.price}
                  </p>
                </div>

                <div>
                  <button
                    onClick={() => handleRequestPackage(pkg)}
                    disabled={isSubmitting}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      pkg.popular
                        ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/15"
                        : "bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/5"
                    }`}
                  >
                    {isSubmitting ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    ) : (
                      "Buy Credits"
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer instructions */}
        <p className="text-[10px] text-white/30 text-center leading-relaxed max-w-2xl mx-auto">
          * Payments are processed securely under the parent entity <span className="font-semibold text-white/50">Trustlink Software Firm</span>. After successful checkout, your account balance will update instantly. For inquiries contact support@trustlink.com.ng.
        </p>
      </div>
    </div>
  );
}
