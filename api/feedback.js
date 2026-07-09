// api/feedback.js  — フィードバックのSupabase保存・取得・エクスポート
// 環境変数: SUPABASE_URL, SUPABASE_ANON_KEY

export const config = { maxDuration: 30 }

function sb(path, method, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabaseの環境変数が未設定です')
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': key,
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
      'prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export default async function handler(req, res) {
  try {
    const method = req.method
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const action = body.action || req.query?.action

    // 台本パックの記録(生成時)
    if (method === 'POST' && action === 'save_run') {
      const r = await sb('script_runs', 'POST', {
        store_name: body.store_name, account_type: body.account_type,
        pattern: body.pattern, duration: body.duration, payload: body.payload,
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.message || 'save_run failed')
      return res.status(200).json({ run: data[0] })
    }

    // フィードバック保存(採用/ボツ/コメント)
    if (method === 'POST' && action === 'save_feedback') {
      const r = await sb('feedbacks', 'POST', {
        run_id: body.run_id || null, store_name: body.store_name,
        case_label: body.case_label, pattern: body.pattern,
        verdict: body.verdict, comment: body.comment || null,
        staff_name: body.staff_name || null,
        posted_url: body.posted_url || null,
        views: body.views ?? null, saves: body.saves ?? null,
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.message || 'save_feedback failed')
      return res.status(200).json({ feedback: data[0] })
    }

    // フィードバック一覧取得(新しい順)
    if (method === 'GET' || action === 'list') {
      const store = body.store_name || req.query?.store_name
      const filter = store ? `&store_name=eq.${encodeURIComponent(store)}` : ''
      const r = await sb(`feedbacks?order=created_at.desc&limit=200${filter}`, 'GET')
      const data = await r.json()
      if (!r.ok) throw new Error(data.message || 'list failed')
      return res.status(200).json({ feedbacks: data })
    }

    return res.status(400).json({ error: 'unknown action' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
