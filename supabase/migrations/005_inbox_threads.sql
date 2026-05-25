-- Inbox threads: agent-initiated conversations
CREATE TABLE IF NOT EXISTS inbox_threads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      TEXT NOT NULL,
  subject          TEXT NOT NULL,
  thread_type      TEXT NOT NULL CHECK (thread_type IN ('recommendation', 'order_update', 'new_arrival', 'availability')),
  messages         JSONB NOT NULL DEFAULT '[]',
  opening_product  JSONB,
  read_at          TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_threads_customer_id_idx ON inbox_threads (customer_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS inbox_threads_unread_idx ON inbox_threads (customer_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS inbox_threads_created_at_idx ON inbox_threads (created_at);

-- Preference signals: feeds inbox generation
CREATE TABLE IF NOT EXISTS customer_preference_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  TEXT NOT NULL,
  signal_type  TEXT NOT NULL CHECK (signal_type IN ('viewed', 'added_to_cart', 'purchased', 'dismissed')),
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS preference_signals_customer_idx ON customer_preference_signals (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS preference_signals_product_idx ON customer_preference_signals (customer_id, product_id);
