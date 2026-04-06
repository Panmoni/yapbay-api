-- Migration: enforce trade deadlines on state updates
BEGIN;

-- Drop existing trigger/function if present
DROP TRIGGER IF EXISTS enforce_trade_deadlines ON trades;
DROP FUNCTION IF EXISTS enforce_trade_deadlines();

-- Create trigger function to block state changes after deadlines
CREATE OR REPLACE FUNCTION enforce_trade_deadlines()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow cancellations
  IF NEW.overall_status != 'CANCELLED' THEN
    -- Leg 1 escrow deposit
    IF NEW.leg1_escrow_deposit_deadline IS NOT NULL
       AND NEW.leg1_escrow_deposit_deadline <= NOW() THEN
      RAISE EXCEPTION 'Leg1 escrow deposit deadline (% ) passed', NEW.leg1_escrow_deposit_deadline;
    END IF;
    -- Leg 1 fiat payment
    IF NEW.leg1_fiat_payment_deadline IS NOT NULL
       AND NEW.leg1_fiat_payment_deadline <= NOW() THEN
      RAISE EXCEPTION 'Leg1 fiat payment deadline (% ) passed', NEW.leg1_fiat_payment_deadline;
    END IF;
    -- Leg 2 escrow deposit
    IF NEW.leg2_escrow_deposit_deadline IS NOT NULL
       AND NEW.leg2_escrow_deposit_deadline <= NOW() THEN
      RAISE EXCEPTION 'Leg2 escrow deposit deadline (% ) passed', NEW.leg2_escrow_deposit_deadline;
    END IF;
    -- Leg 2 fiat payment
    IF NEW.leg2_fiat_payment_deadline IS NOT NULL
       AND NEW.leg2_fiat_payment_deadline <= NOW() THEN
      RAISE EXCEPTION 'Leg2 fiat payment deadline (% ) passed', NEW.leg2_fiat_payment_deadline;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to trades table
CREATE TRIGGER enforce_trade_deadlines
  BEFORE UPDATE ON trades
  FOR EACH ROW
  EXECUTE FUNCTION enforce_trade_deadlines();

COMMIT;
