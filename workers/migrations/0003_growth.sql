-- 既存の台本・店舗・レビューは変更せず、投稿時の文章と観測値を保存する。
CREATE TABLE IF NOT EXISTS growth_measurements (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id),
  account_id TEXT NOT NULL,
  post_key TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, post_key, measured_at)
);
CREATE INDEX IF NOT EXISTS idx_growth_account_time
  ON growth_measurements(account_id, measured_at DESC);
