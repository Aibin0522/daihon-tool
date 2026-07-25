-- 0001_init.sql: 初回7テーブル(設計書§3を現行daihon-toolに適合)
-- 現行UIは店舗をlocalStorage管理のため store_id は当面NULL可(store_name で追跡)。
-- 原則: AI出力は上書きせず追記。created_by で AI/人 を区別する。

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'food',
  official_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  store_id TEXT,
  store_name TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('official','review','hearing','manual')),
  url TEXT,
  fetched_at TEXT NOT NULL,
  body TEXT NOT NULL,          -- hearing結果JSON等
  usable INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL CHECK (created_by IN ('ai','human')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE store_facts (
  id TEXT PRIMARY KEY,
  store_id TEXT,
  store_name TEXT,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('fact','user_voice','interpretation')),
  body TEXT NOT NULL,
  source_document_id TEXT REFERENCES source_documents(id),
  confidence REAL,
  valid_from TEXT,
  valid_until TEXT,
  created_by TEXT NOT NULL CHECK (created_by IN ('ai','human')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE knowledge_rules (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,       -- playbook_v1_5 から開始
  rule_type TEXT NOT NULL CHECK (rule_type IN ('win_pattern','prohibited','syntax','eval_axis')),
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE script_jobs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL CHECK (task IN ('hearing','script','pack')),
  store_name TEXT,
  request_json TEXT NOT NULL,
  result_json TEXT,            -- hearing結果 / packのstrategy_summary等
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES script_jobs(id),
  variant INTEGER NOT NULL,            -- pack: 1..3 / script: 1
  case_label TEXT,                     -- A-1, B-2 等(packのみ)
  account_type TEXT,                   -- A / B
  body_json TEXT NOT NULL,             -- 台本JSON(cuts, hooks, caption等)
  syntax_pattern TEXT,                 -- 使用構文パターン名
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  knowledge_rule_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review','adopted','revised','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE script_reviews (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES scripts(id),
  decision TEXT NOT NULL CHECK (decision IN ('adopted','revised','rejected')),
  before_text TEXT,
  after_text TEXT,
  reason_tags TEXT NOT NULL,           -- JSON配列
  reason_note TEXT,
  reviewer TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_source_documents_store_name ON source_documents(store_name);
CREATE INDEX idx_script_jobs_status ON script_jobs(status);
CREATE INDEX idx_script_jobs_store_name ON script_jobs(store_name);
CREATE INDEX idx_scripts_job ON scripts(job_id);
CREATE INDEX idx_script_reviews_script ON script_reviews(script_id);
