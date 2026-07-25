-- 0002: 店舗一覧・履歴・テンプレートをD1共有化(設計書 Day 6-7)
-- storesに hearing 全体JSONと更新時刻を追加。テンプレートテーブルを新設。

ALTER TABLE stores ADD COLUMN hearing_json TEXT;
ALTER TABLE stores ADD COLUMN updated_at TEXT;

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rules TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
