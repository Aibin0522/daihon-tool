// api/history.js — Worker /api/history へのプロキシ(生成履歴のD1共有・読み取り専用)
export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' })
  const base = process.env.WORKER_URL
  const token = process.env.WORKER_TOKEN
  if (!base || !token) return res.status(500).json({ error: 'WORKER_URL / WORKER_TOKEN が未設定です' })
  const B = base.replace(/\/$/, '')
  const limit = encodeURIComponent(req.query.limit || '30')
  try {
    const r = await fetch(`${B}/api/history?limit=${limit}`, { headers: { authorization: `Bearer ${token}` } })
    const t = await r.text()
    res.status(r.status)
    try { res.json(JSON.parse(t)) } catch { res.send(t) }
  } catch (e) { res.status(500).json({ error: e.message }) }
}
