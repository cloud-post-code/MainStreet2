-- Allow orders to be created before Stripe session exists (pre-checkout snapshot)
-- and track conversation linkage + payment intent

ALTER TABLE orders
  ALTER COLUMN stripe_session_id DROP NOT NULL,
  ALTER COLUMN customer_email DROP NOT NULL,
  ALTER COLUMN items DROP NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_cents     INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;

-- Widen status to cover pre-payment states
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled', 'received', 'purchased', 'shipped', 'delivered'));

CREATE INDEX IF NOT EXISTS orders_conversation_id_idx ON orders (conversation_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
