import { requireOperator } from '../lib/operator-auth.mjs';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (!await requireOperator(req, res)) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'この操作には対応していません' });
  const base = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!base || !token) return res.status(503).json({ error: '保存先の接続設定が必要です' });
  try {
    const target = new URL('/api/growth', base);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('invalid worker URL');
    for (const [key, value] of Object.entries(req.query || {})) {
      if (typeof value !== 'string') return res.status(400).json({ error: '指定条件が正しくありません' });
      target.searchParams.set(key, value);
    }
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) : undefined;
    if (body && Buffer.byteLength(body) > 131072) return res.status(413).json({ error: '1回のデータは128KB以内にしてください' });
    const response = await fetch(target, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(25000),
      redirect: 'error',
    });
    return res.status(response.status).json(await response.json());
  } catch {
    return res.status(502).json({ error: '保存先に接続できませんでした。時間をおいて再度お試しください。' });
  }
}
