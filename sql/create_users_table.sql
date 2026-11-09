CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(8) PRIMARY KEY,
  display_name TEXT NOT NULL,
  auth_user_id TEXT,
  last_access TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_last_access ON users (last_access);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON users (auth_user_id);
