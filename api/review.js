// api/review.js — D1レビュー保存(script_reviews)へのプロキシ
// POST { script_db_id, decision, before_text?, after_text?, reason_tags, reason_note?, reviewer }
// 既存のSupabaseフィードバック(api/feedback.js)と併用可。将来はこちらへ一本化。

export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  const base = process.env.WORKER_URL
  const token = process.env.WORKER_TOKEN
  if (!base || !token) return res.status(500).json({ error: 'WORKER_URL / WORKER_TOKEN が未設定です' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const { script_db_id, ...review } = body
    if (!script_db_id) return res.status(400).json({ error: 'script_db_id required' })
    const r = await fetch(`${base}/api/scripts/${encodeURIComponent(script_db_id)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
      body: JSON.stringify(review),
    })
    return res.status(r.status).json(await r.json())
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
