-- Conversation sessions for the multi-turn chat agent
CREATE TABLE conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  messages            JSONB NOT NULL DEFAULT '[]',
  last_search_results JSONB,
  last_derived_query  TEXT,
  turn_count          SMALLINT NOT NULL DEFAULT 0,
  version             INTEGER NOT NULL DEFAULT 0,
  session_fingerprint TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON conversations (expires_at);

-- TTL cleanup: run nightly via pg_cron or external cron
-- DELETE FROM conversations WHERE expires_at < NOW() - INTERVAL '1 hour';
