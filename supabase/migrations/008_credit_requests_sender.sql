-- ============================================================================
-- DiipMynd — Migration 008: credit_requests.sender_address
--
-- Adds a column to record the on-chain sender of a crypto payment. This gives
-- an audit trail and supports future wallet-binding verification.
--
-- NOTE on audit finding H7: TRC-20 USDT and BEP-20 USDT/USDC have no standard
-- memo field, so we cannot embed a per-user reference in the transaction.
-- Protection is first-come-first-served on tx_hash (unique constraint) plus
-- this sender record. Full sender-binding (rejecting payments not from a
-- pre-registered wallet) requires a wallet-registration feature — out of scope
-- here but this column is the foundation for it.
-- ============================================================================

ALTER TABLE public.credit_requests
    ADD COLUMN IF NOT EXISTS sender_address TEXT;
