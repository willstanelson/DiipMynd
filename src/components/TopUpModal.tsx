"use client";

import React, { useState } from "react";

interface TopUpModalProps {
  userEmail: string;
  onClose: () => void;
  onBalanceUpdated?: () => void;
}

interface PricingPackage {
  id: string;
  name: string;
  credits: number;
  durationText: string;
  priceNGN: string;
  priceUSD: string;
  popular?: boolean;
}

const PACKAGES: PricingPackage[] = [
  {
    id: "trial",
    name: "Trial Bundle",
    credits: 600, // 10 minutes
    durationText: "10 minutes stream time",
    priceNGN: "₦49,500",
    priceUSD: "$33.00",
  },
  {
    id: "starter",
    name: "Starter Bundle",
    credits: 1800, // 30 minutes
    durationText: "30 minutes stream time",
    priceNGN: "₦135,000",
    priceUSD: "$90.00",
    popular: true,
  },
  {
    id: "standard",
    name: "Standard Bundle",
    credits: 3600, // 1 hour
    durationText: "1 hour stream time",
    priceNGN: "₦243,000",
    priceUSD: "$162.00",
  },
  {
    id: "pro",
    name: "Pro Bundle",
    credits: 18000, // 5 hours
    durationText: "5 hours stream time",
    priceNGN: "₦1,080,000",
    priceUSD: "$720.00",
  },
];

// Target wallet addresses
const TARGET_WALLETS = {
  tron: {
    networkName: "TRON (TRC-20)",
    tokenName: "USDT (TRC-20)",
    address: "TPoYAxCNnPPZS6EarjrLGKDgiu3B8MGVyA",
  },
  bsc: {
    networkName: "Binance Smart Chain (BSC - BEP-20)",
    tokenName: "USDT or USDC (BEP-20)",
    address: "0x467249EAC0FDeC3dB9aD2814eBACbd62253eDcFA",
  },
};

export default function TopUpModal({ userEmail, onClose, onBalanceUpdated }: TopUpModalProps) {
  const [activeTab, setActiveTab] = useState<"card" | "crypto">("card");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Crypto state
  const [cryptoNetwork, setCryptoNetwork] = useState<"tron" | "bsc">("tron");
  const [cryptoPackageId, setCryptoPackageId] = useState<string>("trial");
  const [txHash, setTxHash] = useState<string>("");
  const [verifyingCrypto, setVerifyingCrypto] = useState<boolean>(false);
  const [cryptoSuccess, setCryptoSuccess] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Handle Card Checkout Redirect via Paystack
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

  // Handle Crypto On-Chain Verification
  const handleVerifyCrypto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txHash.trim()) {
      setError("Please enter a valid Transaction Hash (TxID).");
      return;
    }

    setVerifyingCrypto(true);
    setError(null);

    try {
      const res = await fetch("/DiipMynd/api/credits/verify-crypto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: txHash.trim(),
          network: cryptoNetwork,
          packageId: cryptoPackageId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Transaction verification failed.");
      }

      setCryptoSuccess(true);
      if (onBalanceUpdated) {
        onBalanceUpdated();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Crypto verification failed";
      setError(message);
    } finally {
      setVerifyingCrypto(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4 animate-fadeIn">
      <div className="w-full max-w-4xl bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl p-6 flex flex-col gap-5 animate-scaleUp">
        
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              💳 Instant Credit Funding
            </h2>
            <p className="text-xs text-white/50 mt-1">
              Select your payment method below to purchase stream time credits.
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

        {/* Tab Toggle */}
        <div className="flex border-b border-white/5 gap-4">
          <button
            onClick={() => {
              setActiveTab("card");
              setError(null);
            }}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "card"
                ? "border-violet-500 text-white"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            💳 Card / Bank Transfer (Paystack)
          </button>
          <button
            onClick={() => {
              setActiveTab("crypto");
              setError(null);
            }}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "crypto"
                ? "border-violet-500 text-white"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            🪙 Pay with Crypto (USDT / USDC)
          </button>
        </div>

        {/* Dynamic error display */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            ⚠️ {error}
          </div>
        )}

        {/* TAB 1: Card / Bank Transfer */}
        {activeTab === "card" && (
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
                      {pkg.priceNGN}
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
        )}

        {/* TAB 2: Cryptocurrency */}
        {activeTab === "crypto" && (
          <div className="flex flex-col md:flex-row gap-6 my-1">
            {cryptoSuccess ? (
              <div className="w-full py-8 text-center flex flex-col items-center justify-center gap-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl font-bold">
                  ✓
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Payment Verified Successfully!</h3>
                  <p className="text-xs text-white/60 mt-1">
                    Your credits have been updated and are now available for streaming.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl active:scale-95 transition-all cursor-pointer"
                >
                  Go back to Dashboard
                </button>
              </div>
            ) : (
              <>
                {/* Crypto Instructions / Wallet */}
                <div className="flex-1 bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                      Step 1: Choose Network
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCryptoNetwork("tron")}
                        className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                          cryptoNetwork === "tron"
                            ? "bg-violet-600/10 border-violet-500/40 text-violet-300"
                            : "border-white/5 bg-white/[0.02] text-white/50 hover:text-white"
                        }`}
                      >
                        TRON (TRC-20)
                      </button>
                      <button
                        onClick={() => setCryptoNetwork("bsc")}
                        className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                          cryptoNetwork === "bsc"
                            ? "bg-violet-600/10 border-violet-500/40 text-violet-300"
                            : "border-white/5 bg-white/[0.02] text-white/50 hover:text-white"
                        }`}
                      >
                        BSC (BEP-20)
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                      Step 2: Send Stablecoins
                    </h3>
                    <p className="text-[10px] text-white/40 mb-3">
                      Transfer exact USD package price in <span className="font-semibold text-white/60">{TARGET_WALLETS[cryptoNetwork].tokenName}</span> to:
                    </p>
                    
                    <div className="flex items-center gap-2 bg-black/40 rounded-xl p-3 border border-white/5">
                      <code className="text-[10px] font-mono text-emerald-400 break-all select-all flex-1">
                        {TARGET_WALLETS[cryptoNetwork].address}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(TARGET_WALLETS[cryptoNetwork].address)}
                        className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-[10px] font-bold transition-all cursor-pointer shrink-0"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    
                    <div className="mt-3 p-3 bg-violet-500/5 border border-violet-500/10 rounded-xl text-[10px] text-violet-300 leading-relaxed">
                      💡 <strong>Note:</strong> TRON transfers only support **USDT**. BSC transfers support **USDT** or **USDC**. Network transaction fees are not covered.
                    </div>
                  </div>
                </div>

                {/* Verification Form */}
                <form onSubmit={handleVerifyCrypto} className="flex-1 bg-white/[0.01] border border-white/5 rounded-2xl p-5 flex flex-col justify-between gap-4">
                  <div className="flex flex-col gap-4">
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                        Step 3: Select Package
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {PACKAGES.map((pkg) => (
                          <label
                            key={pkg.id}
                            className={`flex flex-col p-2.5 rounded-xl border cursor-pointer transition-all ${
                              cryptoPackageId === pkg.id
                                ? "bg-violet-600/15 border-violet-500/50 text-white"
                                : "border-white/5 bg-white/[0.01] text-white/60 hover:border-white/10"
                            }`}
                          >
                            <input
                              type="radio"
                              name="cryptoPackage"
                              value={pkg.id}
                              checked={cryptoPackageId === pkg.id}
                              onChange={() => setCryptoPackageId(pkg.id)}
                              className="sr-only"
                            />
                            <span className="text-[10px] font-bold">{pkg.name}</span>
                            <span className="text-[9px] text-white/40 mt-0.5">{pkg.credits} credits</span>
                            <span className="text-xs font-black text-violet-400 mt-1.5">{pkg.priceUSD}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                        Step 4: Input TxID
                      </h3>
                      <input
                        type="text"
                        required
                        value={txHash}
                        onChange={(e) => setTxHash(e.target.value)}
                        placeholder="Paste transaction hash / TxID / Transaction reference"
                        className="w-full px-3 py-2.5 rounded-xl bg-black/35 border border-white/10 text-xs text-white placeholder-white/20 focus:outline-none focus:border-violet-500/60 font-mono transition-all"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={verifyingCrypto}
                    className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {verifyingCrypto ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                        Verifying on Blockchain...
                      </>
                    ) : (
                      "Verify Payment & Credit"
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        {/* Footer instructions */}
        <p className="text-[10px] text-white/30 text-center leading-relaxed max-w-2xl mx-auto">
          * Payments are processed securely under the parent entity <span className="font-semibold text-white/50">Trustlink Software Firm</span>. After successful checkout, your account balance will update instantly. For inquiries contact support@trustlink.com.ng.
        </p>
      </div>
    </div>
  );
}
