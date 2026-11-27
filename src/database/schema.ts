export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL CHECK (currency IN ('NGN','USD'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('user_wallet','provider_clearing','refund_receivable')),
  user_id TEXT REFERENCES users(id),
  currency TEXT NOT NULL CHECK (currency IN ('NGN','USD'))
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  idempotency_ref TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id INTEGER NOT NULL REFERENCES ledger_transactions(id),
  debit_account_id TEXT NOT NULL REFERENCES accounts(id),
  credit_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency IN ('NGN','USD')),
  CHECK (debit_account_id <> credit_account_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_debit ON ledger_entries(debit_account_id);
CREATE INDEX IF NOT EXISTS idx_entries_credit ON ledger_entries(credit_account_id);

CREATE TRIGGER IF NOT EXISTS trg_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'LEDGER_IS_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'LEDGER_IS_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS trg_no_negative_wallet BEFORE INSERT ON ledger_entries
WHEN (SELECT kind FROM accounts WHERE id = NEW.debit_account_id) = 'user_wallet'
 AND (SELECT COALESCE(SUM(CASE WHEN credit_account_id = NEW.debit_account_id THEN amount_minor ELSE -amount_minor END), 0)
      FROM ledger_entries
      WHERE credit_account_id = NEW.debit_account_id OR debit_account_id = NEW.debit_account_id) < NEW.amount_minor
BEGIN SELECT RAISE(ABORT, 'NEGATIVE_BALANCE'); END;

CREATE VIEW IF NOT EXISTS account_balances AS
SELECT a.id AS account_id, a.kind, a.currency,
       COALESCE((SELECT SUM(amount_minor) FROM ledger_entries WHERE credit_account_id = a.id), 0)
     - COALESCE((SELECT SUM(amount_minor) FROM ledger_entries WHERE debit_account_id = a.id), 0) AS balance_minor
FROM accounts a;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, route)
);

CREATE TABLE IF NOT EXISTS topups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider_ref TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  created_at TEXT NOT NULL,
  credited_at TEXT
);

CREATE TABLE IF NOT EXISTS refunds (
  refund_id TEXT PRIMARY KEY,
  topup_id TEXT NOT NULL REFERENCES topups(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('awaiting_success','applied','rejected')),
  clawed_back_minor INTEGER NOT NULL DEFAULT 0,
  shortfall_minor INTEGER NOT NULL DEFAULT 0,
  received_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  provider_ref TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  outcome TEXT,
  received_at TEXT NOT NULL
);
`;
