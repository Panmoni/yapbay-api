-- Tighten the finalized-row immutability triggers introduced in 0037.
--
-- Three gaps identified in the heavy-duty review of Phase 3:
--   1. transactions.status could be UPDATEd without restriction — fine for
--      the legitimate listener backfill (PENDING → SUCCESS/FAILED) but
--      unguarded against reverting a terminal status back to PENDING.
--   2. escrows terminal → terminal transitions (e.g. RELEASED → RESOLVED)
--      were only implicitly blocked; make the rejection explicit on NEW.
--   3. ERRCODE 'check_violation' (23514) maps to HTTP 400 in the error
--      handler, which is wrong for "resource is in a terminal state" — that
--      should be 409. Use a custom SQLSTATE so `src/utils/pgError.ts` can
--      route it to 409 specifically.
--
-- The custom SQLSTATE follows PostgreSQL's class 'YB' convention for
-- application-defined errors (documented in SQLSTATE docs): YB001 =
-- "yapbay: finalized row".

CREATE OR REPLACE FUNCTION guard_finalized_escrows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'RESOLVED') THEN
      RAISE EXCEPTION 'escrow % is finalized (state=%), DELETE forbidden', OLD.id, OLD.state
        USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: reject any change to a row whose OLD.state is terminal. This
  -- also blocks terminal → terminal flips (e.g. RELEASED → RESOLVED) since
  -- the check fires before NEW is evaluated.
  IF OLD.state IN ('RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'RESOLVED') THEN
    RAISE EXCEPTION 'escrow % is finalized (state=%), UPDATE forbidden', OLD.id, OLD.state
      USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_finalized_trades()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.overall_status IN ('COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'trade % is finalized (overall_status=%), DELETE forbidden', OLD.id, OLD.overall_status
        USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.overall_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'trade % is finalized (overall_status=%), UPDATE forbidden', OLD.id, OLD.overall_status
      USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
  END IF;
  RETURN NEW;
END;
$$;

-- Transactions: status state-machine. Legitimate path is
-- PENDING → SUCCESS/FAILED only. Once terminal, no change permitted.
-- Other financial columns remain locked (hash, signature, addresses, etc.).
CREATE OR REPLACE FUNCTION guard_transactions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions table is append-only, DELETE forbidden (id=%)', OLD.id
      USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
  END IF;

  -- Immutable financial columns. Listener may backfill error_message,
  -- gas_used, block_number, and status (within the allowed transition set
  -- enforced below).
  IF OLD.transaction_hash IS DISTINCT FROM NEW.transaction_hash
     OR OLD.signature IS DISTINCT FROM NEW.signature
     OR OLD.sender_address IS DISTINCT FROM NEW.sender_address
     OR OLD.receiver_or_contract_address IS DISTINCT FROM NEW.receiver_or_contract_address
     OR OLD.network_id IS DISTINCT FROM NEW.network_id
     OR OLD.related_trade_id IS DISTINCT FROM NEW.related_trade_id
     OR OLD.related_escrow_db_id IS DISTINCT FROM NEW.related_escrow_db_id THEN
    RAISE EXCEPTION 'transactions row % is append-only on financial columns', OLD.id
      USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
  END IF;

  -- Status state machine: PENDING may transition to any state (first
  -- listener observation). Once SUCCESS or FAILED, the row is terminal —
  -- no further status changes permitted.
  IF OLD.status IN ('SUCCESS', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'transaction % status is terminal (%) — cannot transition to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'YB001', DETAIL = 'finalized_row';
  END IF;

  RETURN NEW;
END;
$$;

-- DOWN: restore the 0037 function bodies (without the state-machine check
-- and with the old ERRCODE). Triggers reference the same function names, so
-- CREATE OR REPLACE is the inverse — no trigger drop/recreate needed.
-- DOWN
CREATE OR REPLACE FUNCTION guard_finalized_escrows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'RESOLVED') THEN
      RAISE EXCEPTION 'escrow % is finalized (state=%), DELETE forbidden', OLD.id, OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'RESOLVED') THEN
    RAISE EXCEPTION 'escrow % is finalized (state=%), UPDATE forbidden', OLD.id, OLD.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_finalized_trades()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.overall_status IN ('COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'trade % is finalized (overall_status=%), DELETE forbidden', OLD.id, OLD.overall_status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.overall_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'trade % is finalized (overall_status=%), UPDATE forbidden', OLD.id, OLD.overall_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_transactions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions table is append-only, DELETE forbidden (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.transaction_hash IS DISTINCT FROM NEW.transaction_hash
     OR OLD.signature IS DISTINCT FROM NEW.signature
     OR OLD.sender_address IS DISTINCT FROM NEW.sender_address
     OR OLD.receiver_or_contract_address IS DISTINCT FROM NEW.receiver_or_contract_address
     OR OLD.network_id IS DISTINCT FROM NEW.network_id
     OR OLD.related_trade_id IS DISTINCT FROM NEW.related_trade_id
     OR OLD.related_escrow_db_id IS DISTINCT FROM NEW.related_escrow_db_id THEN
    RAISE EXCEPTION 'transactions row % is append-only on financial columns', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
