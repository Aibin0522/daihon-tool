// api/w/[...path].js — Worker への汎用プロキシ
// フロントは /api/w/<worker上のパス> を叩く(トークンはサーバー側で付与)。
// 例: GET /api/w/stores -> Worker GET /api/stores
export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  const base = process.env.WORKER_URL
  const token = process.env.WORKER_TOKEN
  if (!base || !token) return res.status(500).json({ error: 'WORKER_URL / WORKER_TOKEN が未設定です' })

  const parts = req.query.path || []
  const sub = Array.isArray(parts) ? parts.join('/') : String(parts)
  const target = new URL(base.replace(/\/$/, '') + '/api/' + sub)
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue
    target.searchParams.set(k, Array.isArray(v) ? v[0] : v)
  }

  const init = { method: req.method, headers: { authorization: `Bearer ${token}` } }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.headers['content-type'] = 'application/json'
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  }

  try {
    const r = await fetch(target, init)
    const text = await r.text()
    res.status(r.status)
    try { res.json(JSON.parse(text)) } catch { res.send(text) }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
