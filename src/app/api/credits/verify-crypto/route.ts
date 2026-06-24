// ============================================================================
// DiipMynd — Backend: On-Chain Crypto Payment Verification Handler
// POST /api/credits/verify-crypto
//
// This endpoint verifies an on-chain transaction hash for TRON (TRC-20 USDT)
// or BSC (BEP-20 USDT/USDC) using public blockchain explorers/RPCs.
// If valid and matches package pricing, it credits the user's account.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";

// Crypto Packages & Pricing Matrix
const CRYPTO_PACKAGES: Record<string, { priceUSD: number; credits: number }> = {
  trial: { priceUSD: 33.00, credits: 600 },       // 10 minutes
  starter: { priceUSD: 90.00, credits: 1800 },     // 30 minutes
  standard: { priceUSD: 162.00, credits: 3600 },   // 1 hour
  pro: { priceUSD: 720.00, credits: 18000 },      // 5 hours
};

// Configuration Constants
const TARGET_TRON_WALLET = "TPoYAxCNnPPZS6EarjrLGKDgiu3B8MGVyA";
const TARGET_BSC_WALLET = "0x467249EAC0FDeC3dB9aD2814eBACbd62253eDcFA";

const TRC20_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const BEP20_USDT_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const BEP20_USDC_CONTRACT = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";

export async function POST(request: Request) {
  try {
    // ── Guard: Authenticate user ─────────────────────────────────────────
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // ── Guard: Validate input parameters ──────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const { txHash, network, packageId } = body;

    if (!txHash || !network || !packageId) {
      return NextResponse.json(
        { error: "txHash, network, and packageId are required." },
        { status: 400 }
      );
    }

    const normalizedNetwork = network.toLowerCase();
    if (normalizedNetwork !== "tron" && normalizedNetwork !== "bsc") {
      return NextResponse.json({ error: "Unsupported blockchain network." }, { status: 400 });
    }

    const packageConfig = CRYPTO_PACKAGES[packageId];
    if (!packageConfig) {
      return NextResponse.json({ error: "Invalid package identifier." }, { status: 400 });
    }

    const expectedUSD = packageConfig.priceUSD;
    console.log(`[verify-crypto] Verifying ${normalizedNetwork} transaction: ${txHash} for package ${packageId} ($${expectedUSD})`);

    // ── Guard: Check for duplicate transaction (Idempotency) ──────────────
    const { data: existingRequest, error: dbError } = await supabaseAdmin
      .from("credit_requests")
      .select("id, status")
      .eq("tx_hash", txHash)
      .maybeSingle();

    if (dbError) {
      console.error("[verify-crypto] DB checking error:", dbError.message);
    }

    if (existingRequest) {
      return NextResponse.json(
        { error: "This transaction hash has already been submitted or processed." },
        { status: 400 }
      );
    }

    let isVerified = false;

    // ── Network verification: TRON (TRC-20) ───────────────────────────────
    if (normalizedNetwork === "tron") {
      // Fetch Tronscan transaction info
      const tronscanUrl = `https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(txHash)}`;
      const res = await fetch(tronscanUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to query Tronscan API. Status: ${res.status}`);
      }

      const txData = await res.json();

      // Check transaction confirmation & result
      const isConfirmed = txData.confirmed === true;
      const isSuccess = txData.contractRet === "SUCCESS" || txData.result === "SUCCESS";

      if (!isConfirmed || !isSuccess) {
        return NextResponse.json(
          { error: "Transaction is not fully confirmed or failed on the TRON network." },
          { status: 400 }
        );
      }

      // Check token transfer details
      const transferInfoList = Array.isArray(txData.trc20TransferInfo)
        ? txData.trc20TransferInfo
        : txData.trc20TransferInfo
        ? [txData.trc20TransferInfo]
        : [];

      for (const transfer of transferInfoList) {
        const toAddress = transfer.to_address || transfer.to;
        const contractId = transfer.tokenId || transfer.tokenInfo?.tokenId;
        const amountStr = transfer.amount_str;
        const decimals = transfer.decimals || transfer.tokenInfo?.tokenDecimal || 6;

        if (
          toAddress === TARGET_TRON_WALLET &&
          contractId === TRC20_USDT_CONTRACT &&
          amountStr
        ) {
          const actualAmountUSD = Number(amountStr) / Math.pow(10, decimals);
          // Allow minor 0.05 USD variance
          if (actualAmountUSD >= expectedUSD - 0.05) {
            isVerified = true;
            break;
          }
        }
      }

      if (!isVerified) {
        return NextResponse.json(
          { error: `No matching transfer to ${TARGET_TRON_WALLET} of at least $${expectedUSD} USDT found.` },
          { status: 400 }
        );
      }
    }

    // ── Network verification: BSC (BEP-20) ────────────────────────────────
    if (normalizedNetwork === "bsc") {
      const rpcUrl = "https://bsc-dataseed.binance.org/";
      const rpcRes = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [txHash],
          id: 1,
        }),
      });

      if (!rpcRes.ok) {
        throw new Error(`Failed to query BSC RPC node. Status: ${rpcRes.status}`);
      }

      const rpcData = await rpcRes.json();
      const receipt = rpcData.result;

      if (!receipt) {
        return NextResponse.json({ error: "Transaction receipt not found on-chain." }, { status: 404 });
      }

      // Status '0x1' indicates success
      if (receipt.status !== "0x1") {
        return NextResponse.json({ error: "Transaction has failed status on-chain." }, { status: 400 });
      }

      // Parse transfer log
      const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const targetPaddedWallet = `0x000000000000000000000000${TARGET_BSC_WALLET.substring(2).toLowerCase()}`;

      const logs = receipt.logs || [];
      for (const log of logs) {
        const contractAddress = log.address.toLowerCase();
        const topics = log.topics || [];

        // Check if log matches Transfer(address,address,uint256) signature
        if (topics[0] === TRANSFER_TOPIC && topics.length >= 3) {
          const matchesContract =
            contractAddress === BEP20_USDT_CONTRACT.toLowerCase() ||
            contractAddress === BEP20_USDC_CONTRACT.toLowerCase();

          const matchesRecipient = topics[2].toLowerCase() === targetPaddedWallet;

          if (matchesContract && matchesRecipient) {
            // Parse amount from 32-byte hex data
            const amountBigInt = BigInt(log.data);
            const actualAmountUSD = Number(amountBigInt) / 1e18; // 18 decimals for both BSC USDT and USDC

            // Allow minor 0.05 USD variance
            if (actualAmountUSD >= expectedUSD - 0.05) {
              isVerified = true;
              break;
            }
          }
        }
      }

      if (!isVerified) {
        return NextResponse.json(
          { error: `No matching BSC transfer to ${TARGET_BSC_WALLET} of at least $${expectedUSD} USDT/USDC found.` },
          { status: 400 }
        );
      }
    }

    // ── Perform database updates if verified successfully ─────────────────
    if (isVerified) {
      // 1. Fetch current credits
      const { data: profile, error: selectError } = await supabaseAdmin
        .from("profiles")
        .select("credits")
        .eq("id", currentUser.id)
        .single();

      if (selectError || !profile) {
        console.error("[verify-crypto] Failed to load profile credits:", selectError?.message);
        return NextResponse.json({ error: "User profile not found." }, { status: 404 });
      }

      const creditsToAdd = packageConfig.credits;
      const newCredits = profile.credits + creditsToAdd;

      // 2. Update credits in DB
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({ credits: newCredits })
        .eq("id", currentUser.id);

      if (updateError) {
        console.error("[verify-crypto] Failed to credit profile:", updateError.message);
        return NextResponse.json({ error: "Failed to credit profile." }, { status: 500 });
      }

      // 3. Insert transaction log into credit_requests
      const { error: logInsertError } = await supabaseAdmin
        .from("credit_requests")
        .insert({
          user_id: currentUser.id,
          email: currentUser.email,
          package_id: packageId,
          amount: creditsToAdd,
          status: "approved",
          payment_method: `Crypto (${normalizedNetwork.toUpperCase()})`,
          tx_hash: txHash,
        });

      if (logInsertError) {
        console.error("[verify-crypto] Failed to log request:", logInsertError.message);
      }

      console.log(`[verify-crypto] Successfully credited user ${currentUser.email} with ${creditsToAdd} credits.`);
      return NextResponse.json({ success: true, credits: newCredits });
    }

    return NextResponse.json({ error: "Verification failed." }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal verification error.";
    console.error("[verify-crypto] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
