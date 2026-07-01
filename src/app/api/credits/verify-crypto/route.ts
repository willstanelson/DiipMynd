// ============================================================================
// DiipMynd — Backend: On-Chain Crypto Payment Verification Handler
// POST /api/credits/verify-crypto
//
// This endpoint verifies an on-chain transaction hash for TRON (TRC-20 USDT)
// or BSC (BEP-20 USDT/USDC) using public blockchain explorers/RPCs.
// If valid and matches package pricing, it atomically credits the user.
// ============================================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { adjustCredits, UserNotFoundError } from "@/lib/credits";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CRYPTO_WALLETS, PACKAGE_CREDITS, PACKAGE_PRICES_USD } from "@/lib/packages";

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

    const expectedUSD = PACKAGE_PRICES_USD[packageId];
    if (expectedUSD === undefined) {
      return NextResponse.json({ error: "Invalid package identifier." }, { status: 400 });
    }

    const creditsToAdd = PACKAGE_CREDITS[packageId];
    if (!creditsToAdd) {
      return NextResponse.json({ error: "Invalid package identifier." }, { status: 400 });
    }

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
    let senderAddress: string | undefined;

    // ── Network verification: TRON (TRC-20) ───────────────────────────────
    if (normalizedNetwork === "tron") {
      const walletConfig = CRYPTO_WALLETS.tron;
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
          toAddress === walletConfig.address &&
          contractId === walletConfig.contract &&
          amountStr
        ) {
          const actualAmountUSD = Number(amountStr) / Math.pow(10, decimals);
          // Allow minor 0.05 USD variance
          if (actualAmountUSD >= expectedUSD - 0.05) {
            isVerified = true;
            senderAddress = txData.ownerAddress || transfer.from_address || transfer.from;
            break;
          }
        }
      }

      if (!isVerified) {
        return NextResponse.json(
          { error: `No matching transfer to ${walletConfig.address} of at least $${expectedUSD} USDT found.` },
          { status: 400 }
        );
      }
    }

    // ── Network verification: BSC (BEP-20) ────────────────────────────────
    if (normalizedNetwork === "bsc") {
      const walletConfig = CRYPTO_WALLETS.bsc;
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
      const targetPaddedWallet = `0x000000000000000000000000${walletConfig.address.substring(2).toLowerCase()}`;

      const logs = receipt.logs || [];
      for (const log of logs) {
        const contractAddress = log.address.toLowerCase();
        const topics = log.topics || [];

        // Check if log matches Transfer(address,address,uint256) signature
        if (topics[0] === TRANSFER_TOPIC && topics.length >= 3) {
          const matchesContract =
            contractAddress === walletConfig.usdtContract.toLowerCase() ||
            contractAddress === walletConfig.usdcContract.toLowerCase();

          const matchesRecipient = topics[2].toLowerCase() === targetPaddedWallet;

          if (matchesContract && matchesRecipient) {
            // Parse amount from 32-byte hex data
            const amountBigInt = BigInt(log.data);
            const actualAmountUSD = Number(amountBigInt) / 1e18; // 18 decimals for both BSC USDT and USDC

            // Allow minor 0.05 USD variance
            if (actualAmountUSD >= expectedUSD - 0.05) {
              isVerified = true;
              // topics[1] is the sender (from), 32-byte padded. Strip padding.
              const senderTopic = topics[1] || "";
              const senderHex = `0x${senderTopic.slice(-40)}`.toLowerCase();
              if (senderHex !== "0x") senderAddress = senderHex;
              break;
            }
          }
        }
      }

      if (!isVerified) {
        return NextResponse.json(
          { error: `No matching BSC transfer to ${walletConfig.address} of at least $${expectedUSD} USDT/USDC found.` },
          { status: 400 }
        );
      }
    }

    // ── Atomically log and credit ─────────────────────────────────────────
    if (isVerified) {
      // Insert transaction log into credit_requests FIRST to lock the hash
      // If it fails or returns no data, someone else already inserted it (race condition prevented)
      const { data: insertedData, error: logInsertError } = await supabaseAdmin
        .from("credit_requests")
        .upsert({
          user_id: currentUser.id,
          email: currentUser.email,
          package_id: packageId,
          amount: creditsToAdd,
          status: "approved",
          payment_method: `Crypto (${normalizedNetwork.toUpperCase()})`,
          tx_hash: txHash,
          sender_address: senderAddress || null,
        }, { onConflict: "tx_hash", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();

      if (logInsertError || !insertedData) {
        console.warn(`[verify-crypto] Race condition prevented for tx: ${txHash}`);
        return NextResponse.json({ error: "Transaction already processed." }, { status: 400 });
      }

      // Safe to credit the user now
      const newCredits = await adjustCredits(currentUser.id, creditsToAdd, `Crypto Payment Verification (${txHash})`, "crypto-verify");

      console.log(`[verify-crypto] Successfully credited user ${currentUser.email} with ${creditsToAdd} credits.`);
      return NextResponse.json({ success: true, credits: newCredits });
    }

    return NextResponse.json({ error: "Verification failed." }, { status: 400 });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }
    console.error("[verify-crypto] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal verification error." }, { status: 500 });
  }
}
