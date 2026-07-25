// api/stores.js — Worker /api/stores へのプロキシ(店舗のD1共有)
// GET: 一覧 / POST: 作成・更新 / DELETE ?id=xxx: 論理削除
export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  const base = process.env.WORKER_URL
  const token = process.env.WORKER_TOKEN
  if (!base || !token) return res.status(500).json({ error: 'WORKER_URL / WORKER_TOKEN が未設定です' })
  const B = base.replace(/\/$/, '')
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  try {
    let url = B + '/api/stores'
    const init = { method: req.method, headers: H }
    if (req.method === 'GET') { delete init.headers['content-type'] }
    else if (req.method === 'POST') { init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}) }
    else if (req.method === 'DELETE') {
      const id = req.query.id
      if (!id) return res.status(400).json({ error: 'id required' })
      url = B + '/api/stores/' + encodeURIComponent(id)
    } else return res.status(405).json({ error: 'Method Not Allowed' })
    const r = await fetch(url, init)
    const t = await r.text()
    res.status(r.status)
    try { res.json(JSON.parse(t)) } catch { res.send(t) }
  } catch (e) { res.status(500).json({ error: e.message }) }
}
