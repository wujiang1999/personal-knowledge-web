-- Shared, durable admission control for web requests and maintenance scripts.
CREATE TABLE model_call_reservations (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('llm', 'embedding')),
  budget_day date NOT NULL,
  reserved_tokens integer NOT NULL CHECK (reserved_tokens >= 0),
  actual_tokens integer CHECK (actual_tokens >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE INDEX idx_model_budget_day ON model_call_reservations(budget_day, actor);
CREATE INDEX idx_model_active ON model_call_reservations(expires_at) WHERE finished_at IS NULL;
ALTER TABLE llm_calls ADD COLUMN provider_model text;
