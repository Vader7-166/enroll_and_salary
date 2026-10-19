ALTER TABLE user_account
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE password_history (
  id UUID PRIMARY KEY,
  user_account_id UUID NOT NULL REFERENCES user_account(id),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX password_history_user_account_id_created_at_idx ON password_history(user_account_id, created_at);
