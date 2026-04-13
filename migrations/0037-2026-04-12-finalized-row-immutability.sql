-- Immutability triggers for finalized financial rows.
--
-- Once an escrow or trade reaches a terminal state it must not be edited or
-- deleted. A bug (or compromised service account) that mutates a finalized
-- row would corrupt the audit trail and make reconciliation impossible.
--
-- Terminal states (per schema.sql + state-machine docs):
--   escrows.state:         RELEASED, CANCELLED, AUTO_CANCELLED, RESOLVED
--   trades.overall_status: COMPLETED, CANCELLED
--   trades.leg{1,2}_state: RELEASED, CANCELLED, RESOLVED
-- DISPUTED is NOT terminal — can transition to RESOLVED via arbitrator.
--
-- The triggers raise a P0001 exception. Application code that legitimately
-- needs to edit a terminal row (e.g. admin correction with audit record)
-- must issue `SET LOCAL session_replication_role = 'replica'` inside an
-- explicit transaction — standard Postgres idiom for bypassing triggers,
-- and only available to superusers / the role the bypass is granted to.

-- ── Escrow immutability ───────────────────────────────────────────────

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

  -- UPDATE
  IF OLD.state IN ('RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'RESOLVED') THEN
    RAISE EXCEPTION 'escrow % is finalized (state=%), UPDATE forbidden', OLD.id, OLD.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_finalized_escrows ON escrows;
CREATE TRIGGER trg_guard_finalized_escrows
  BEFORE UPDATE OR DELETE ON escrows
  FOR EACH ROW
  EXECUTE FUNCTION guard_finalized_escrows();

-- ── Trade immutability ───────────────────────────────────────────────

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

  -- UPDATE: block once overall_status is terminal.
  IF OLD.overall_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'trade % is finalized (overall_status=%), UPDATE forbidden', OLD.id, OLD.overall_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_finalized_trades ON trades;
CREATE TRIGGER trg_guard_finalized_trades
  BEFORE UPDATE OR DELETE ON trades
  FOR EACH ROW
  EXECUTE FUNCTION guard_finalized_trades();

-- ── Transaction immutability ─────────────────────────────────────────
-- Transactions are append-only by design; once recorded they should never
-- be mutated or deleted. Apply a blanket trigger.

CREATE OR REPLACE FUNCTION guard_transactions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions table is append-only, DELETE forbidden (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Allow UPDATE only if no financial columns change. Errors, gas_used,
  -- and block_number may be backfilled by the listener after initial record.
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

DROP TRIGGER IF EXISTS trg_guard_transactions_append_only ON transactions;
CREATE TRIGGER trg_guard_transactions_append_only
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION guard_transactions_append_only();

-- DOWN
DROP TRIGGER IF EXISTS trg_guard_transactions_append_only ON transactions;
DROP FUNCTION IF EXISTS guard_transactions_append_only();
DROP TRIGGER IF EXISTS trg_guard_finalized_trades ON trades;
DROP FUNCTION IF EXISTS guard_finalized_trades();
DROP TRIGGER IF EXISTS trg_guard_finalized_escrows ON escrows;
DROP FUNCTION IF EXISTS guard_finalized_escrows();
