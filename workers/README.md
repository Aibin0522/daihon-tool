# daihon-tool 非同期バックエンド (Cloudflare Workers + Queues + D1)

現行の生成処理(hearing / script / pack)をVercelの60秒制限から切り出したもの。
プロンプトは api/daihon-generate.js (v3) から一字も変えずに移植(統合プレイブックv1.5)。

## 仕組み

```
index.html → Vercel /api/jobs (プロキシ) → Worker /api/jobs → Queue → LLM生成 → D1
     └─ 3秒間隔ポーリング ──────────────────→ GET /api/jobs/:id ──── done時に結果返却
```

- ジョブ発行は即202で返るため、フロントのタイムアウトは発生しない
- 生成結果は全件D1へ保存(model / prompt_version / knowledge_rule_version 付き)
- hearingの結果は source_documents にも保存(created_by='ai')
- Cron(5分毎): 15分停滞ジョブを3回まで再投入、超過はfailed確定
- レビューは POST /api/scripts/:id/review でD1の script_reviews へ(理由タグ8種)

## デプロイ手順

```bash
cd workers
npm install --legacy-peer-deps
npx wrangler login

npx wrangler d1 create daihon_tool        # → database_id を wrangler.toml に貼る
npx wrangler queues create script-jobs
npx wrangler queues create script-jobs-dlq
npx wrangler d1 migrations apply daihon_tool --remote

npx wrangler secret put ANTHROPIC_API_KEY  # Vercelと同じキーでよい
npx wrangler secret put API_AUTH_TOKEN     # ランダム文字列(下記WORKER_TOKENと同一値)

npx wrangler deploy                        # → 出力URLを控える
```

## Vercel側の環境変数(ダッシュボード → Settings → Environment Variables)

| 変数 | 値 |
|---|---|
| WORKER_URL | デプロイ後のWorker URL(末尾スラッシュなし) |
| WORKER_TOKEN | API_AUTH_TOKEN と同じ値 |

設定後、Vercelを再デプロイすると index.html が非同期版に切り替わる。
旧 /api/daihon-generate は残してあるため、問題時は index.html の api() を元に戻すだけでロールバック可能。

## 動作確認

```bash
W=https://daihon-tool-api.<account>.workers.dev
T=<API_AUTH_TOKEN>

curl -X POST $W/api/jobs -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"task":"hearing","input":{"query":"広島 お好み焼き 例店"}}'
# → {"job_id":"job_xxx","status":"queued"}

curl $W/api/jobs/job_xxx -H "Authorization: Bearer $T"
# → status: queued → running → done(result.hearing に結果)
```

## D1に保存されるもの(設計書§3準拠・初回7テーブル)

stores / source_documents / store_facts / knowledge_rules / script_jobs / scripts / script_reviews

## 次フェーズ(未実装)

- プロンプト内ルール(CORE_RULES等)の knowledge_rules テーブルへの分離(Day 6-7)
- Supabaseフィードバックの script_reviews への一本化(Day 8-10)
- テロップ分解・音声・素材選定(migration 0002以降)
