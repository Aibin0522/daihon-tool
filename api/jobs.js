// api/jobs.js — Cloudflare Workerへのプロキシ
// トークンをブラウザに出さないため、フロントは同一オリジンのこのAPIだけを叩く。
// Vercel環境変数: WORKER_URL(例 https://daihon-tool-api.xxx.workers.dev), WORKER_TOKEN

export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  const base = process.env.WORKER_URL
  const token = process.env.WORKER_TOKEN
  if (!base || !token) return res.status(500).json({ error: 'WORKER_URL / WORKER_TOKEN が未設定です' })
  const headers = { 'content-type': 'application/json', 'authorization': `Bearer ${token}` }
  try {
    // ジョブ発行
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
      const r = await fetch(`${base}/api/jobs`, { method: 'POST', headers, body })
      return res.status(r.status).json(await r.json())
    }
    // 状態取得: GET /api/jobs?id=job_xxx
    if (req.method === 'GET') {
      const id = req.query?.id
      if (!id) return res.status(400).json({ error: 'id required' })
      const r = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`, { headers })
      return res.status(r.status).json(await r.json())
    }
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
