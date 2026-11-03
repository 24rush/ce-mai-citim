CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(8) PRIMARY KEY,
  display_name TEXT NOT NULL,
  last_access TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_last_access ON users (last_access);

