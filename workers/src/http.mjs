import { InputError, normalizeContext, saveRecords, loadRecords, summarize, buildLearning } from './growth.mjs';
import { OUTPUT_GUIDE } from './rules.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export async function readSmallJson(request, limit = 131072) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new InputError('JSON形式で送信してください');
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new InputError('データが大きすぎます（128KB以内）');
  if (!request.body) throw new InputError('入力が空です');
  const reader = request.body.getReader(); const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new InputError('データが大きすぎます（128KB以内）'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InputError('JSON形式を確認してください'); }
}
// 固定長のダイジェストを比較し、設定漏れ時は必ず拒否する。
export async function authorized(request, secret) {
  if (typeof secret !== 'string' || !secret) return false;
  const actual = request.headers.get('authorization') ?? '';
  if (actual.length > 4096) return false;
  const [left, right] = await Promise.all([actual, `Bearer ${secret}`].map(value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  const a = new Uint8Array(left), b = new Uint8Array(right); let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function handleGrowth(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/growth') return null;
  try {
    const action = url.searchParams.get('action') ?? 'records';
    if (request.method === 'GET' && action === 'scripts') {
      const rows = await env.DB.prepare(`SELECT s.id, s.account_type, s.syntax_pattern, s.body_json, s.status, j.store_name
        FROM scripts s JOIN script_jobs j ON j.id = s.job_id ORDER BY s.created_at DESC LIMIT 100`).all();
      return reply({ scripts: (rows.results ?? []).map(row => ({ id: row.id, account_type: row.account_type, syntax_pattern: row.syntax_pattern, store_name: row.store_name, status: row.status, text: (JSON.parse(row.body_json).cuts ?? []).map(c => c.telop).join('\n') })) });
    }
    if (request.method === 'GET' && action === 'records') {
      const context = normalizeContext(Object.fromEntries(url.searchParams));
      const loaded = await loadRecords(env.DB, context.account_id);
      return reply({ ...loaded, summary: summarize(loaded.records, context) });
    }
    if (request.method === 'POST' && action === 'records') {
      const body = await readSmallJson(request);
      return reply(await saveRecords(env.DB, body?.records), 201);
    }
    if (request.method === 'POST' && action === 'context') {
      const body = await readSmallJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('入力形式が正しくありません');
      return reply({ ...await buildLearning(env, body), output_guide: OUTPUT_GUIDE });
    }
    return reply({ error: 'この操作には対応していません' }, 405);
  } catch (error) {
    if (error instanceof InputError) return reply({ error: error.message }, 400);
    console.error(JSON.stringify({ event: 'growth_error', kind: error.name }));
    return reply({ error: '実績の読み書きに失敗しました。接続先と実績テーブルの準備を確認してください' }, 500);
  }
}
