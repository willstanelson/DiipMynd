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

interface NetworkOption {
  id: string;
  name: string;
  address: string;
  supportedCoins: string;
}

const NETWORKS: NetworkOption[] = [
  {
    id: "EVM",
    name: "EVM Networks",
    address: "0x467249EAC0FDeC3dB9aD2814eBACbd62253eDcFA",
    supportedCoins: "USDT / USDC / ETH (BSC, Polygon, Arbitrum, Optimism, Ethereum)",
  },
  {
    id: "TON",
    name: "TON Network",
    address: "UQAImzM1nTffeq4wdiwKVZD8gHFQUOQDVKaVfGQNEkG55t-I",
    supportedCoins: "USDT / TON (The Open Network)",
  },
  {
    id: "TRON",
    name: "TRON Network",
    address: "TPoYAxCNnPPZS6EarjrLGKDgiu3B8MGVyA",
    supportedCoins: "USDT (TRC-20)",
  },
  {
    id: "BTC",
    name: "Bitcoin Network",
    address: "bc1pjz6p0xsvfuezw2rjzmdu478jjklna9chu6h65unq8x74w8pkc73qfyt9q3",
    supportedCoins: "BTC",
  },
];

const PACKAGES: PricingPackage[] = [
  {
    id: "starter",
    name: "Starter Bundle",
    credits: 1800, // 30 minutes
    durationText: "30 minutes stream time",
    price: "$5.00 equivalent",
  },
  {
    id: "standard",
    name: "Standard Bundle",
    credits: 3600, // 1 hour
    durationText: "1 hour stream time",
    price: "$9.00 equivalent",
    popular: true,
  },
  {
    id: "pro",
    name: "Pro Bundle",
    credits: 10000, // ~2.8 hours
    durationText: "2.8 hours stream time",
    price: "$20.00 equivalent",
  },
];

export default function TopUpModal({ userEmail, onClose }: TopUpModalProps) {
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkOption>(NETWORKS[0]);
  const [txHash, setTxHash] = useState("");
  
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedNetwork.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("[topup] Copy failed:", err);
    }
  };

  const handleRequestPackage = async (pkg: PricingPackage) => {
    const trimmedTx = txHash.trim();
    if (!trimmedTx) {
      setError("Please provide the Transaction Hash (TXID) of your transfer so we can verify the payment.");
      return;
    }

    setSubmittingId(pkg.id);
    setError(null);
    setSuccessId(null);

    try {
      const res = await fetch("/DiipMynd/api/credits/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: pkg.id,
          amount: pkg.credits,
          paymentMethod: selectedNetwork.id,
          txHash: trimmedTx,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit request.");
      }

      setSuccessId(pkg.id);
      setTxHash(""); // reset form
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to request package";
      setError(message);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl p-6 flex flex-col gap-6 animate-scaleUp">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              💳 Crypto Credit Funding
            </h2>
            <p className="text-xs text-white/50 mt-1">
              Top up using stablecoins (USDT/USDC) or $BTC.
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
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Payment Addresses Tabs */}
        <div className="flex flex-col gap-3">
          <label className="text-[10px] font-bold text-white/40 uppercase tracking-wide">
            1. Select Payment Network
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {NETWORKS.map((net) => (
              <button
                key={net.id}
                type="button"
                onClick={() => {
                  setSelectedNetwork(net);
                  setError(null);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer border transition-all text-center ${
                  selectedNetwork.id === net.id
                    ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/10"
                    : "bg-white/[0.02] border-white/5 text-white/60 hover:border-white/10 hover:text-white"
                }`}
              >
                {net.name}
              </button>
            ))}
          </div>
        </div>

        {/* Selected Address Copy Board */}
        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div className="flex-1 min-w-0 w-full text-center sm:text-left">
            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest block mb-1">
              Deposit address ({selectedNetwork.id})
            </span>
            <span className="text-[11px] font-mono text-violet-400 font-semibold break-all select-all block">
              {selectedNetwork.address}
            </span>
            <span className="text-[9px] text-white/40 block mt-1">
              Supports: {selectedNetwork.supportedCoins}
            </span>
          </div>

          <button
            onClick={handleCopy}
            className={`flex-shrink-0 w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${
              copied
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:text-white"
            }`}
          >
            {copied ? "✓ Copied" : "Copy Address"}
          </button>
        </div>

        {/* Transaction input */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold text-white/40 uppercase tracking-wide">
            2. Enter Transaction Hash / TXID (Required)
          </label>
          <input
            type="text"
            placeholder="Paste TxID / Transaction hash of your crypto transfer..."
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-white placeholder-white/20 focus:border-violet-500 focus:bg-white/[0.05] focus:outline-none transition-all text-xs font-mono"
          />
        </div>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PACKAGES.map((pkg) => {
            const isSubmitting = submittingId === pkg.id;
            const isSuccess = successId === pkg.id;

            return (
              <div
                key={pkg.id}
                className={`relative p-5 rounded-2xl bg-white/[0.02] border flex flex-col justify-between transition-all ${
                  pkg.popular
                    ? "border-violet-500/50 shadow-md shadow-violet-500/5"
                    : "border-white/5 hover:border-white/10"
                }`}
              >
                {pkg.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-600 text-white uppercase tracking-wider">
                    Popular
                  </span>
                )}

                <div>
                  <h3 className="text-xs font-bold text-white mb-0.5">{pkg.name}</h3>
                  <p className="text-[9px] text-white/40 mb-3">{pkg.durationText}</p>
                  <p className="text-lg font-extrabold text-white mb-4 tabular-nums">
                    {pkg.price}
                  </p>
                </div>

                <div>
                  {isSuccess ? (
                    <div className="w-full py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-bold text-center">
                      ✓ Request Sent
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRequestPackage(pkg)}
                      disabled={isSubmitting}
                      className={`w-full py-2 rounded-xl text-xs font-bold active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        pkg.popular
                          ? "bg-violet-600 hover:bg-violet-500 text-white"
                          : "bg-white/5 hover:bg-white/10 text-white/80 hover:text-white"
                      }`}
                    >
                      {isSubmitting ? (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                      ) : (
                        "Request Credits"
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer instructions */}
        <p className="text-[10px] text-white/30 text-center leading-relaxed">
          * Transfer the bundle amount to the selected address. Include your account email <span className="font-semibold text-white/50">{userEmail}</span> in transaction notes if supported. After clicking request, the developer will verify the transaction hash on-chain and credit your account.
        </p>
      </div>
    </div>
  );
}
