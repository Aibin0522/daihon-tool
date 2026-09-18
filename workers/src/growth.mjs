import { GENERATION_RULES, RULE_VERSION } from './rules.mjs';

export const GOALS = { reach: 'リーチ', saves: '保存率', shares: 'シェア率', follows: 'フォロー率' };
export const METRICS = ['views', 'reach', 'saves', 'shares', 'follows', 'avg_watch_seconds'];
const DAY = 86400000;
export class InputError extends Error {}
function required(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`${label}を入力してください（${max}文字以内）`);
  return value.trim();
}
function choice(value, list, label) {
  if (!list.includes(value)) throw new InputError(`${label}の選択が正しくありません`);
  return value;
}
function timestamp(value, label) {
  const text = required(value, label, 40);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) throw new InputError(`${label}は時差付き日時で指定してください`);
  return new Date(text).toISOString();
}
export function normalizeContext(raw = {}) {
  const account = required(raw.account_id, 'アカウント名', 100).replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(account)) throw new InputError('アカウント名は英数字・ピリオド・下線で入力してください');
  return {
    account_id: account,
    account_type: choice(raw.account_type, ['A', 'B'], '視点'),
    genre: required(raw.genre, '比較ジャンル', 60),
    goal: choice(raw.goal, Object.keys(GOALS), '目的'),
    distribution: choice(raw.distribution, ['organic', 'paid', 'collab'], '配信条件'),
    horizon_days: choice(Number(raw.horizon_days), [1, 7, 30], '観測期間'),
    duration_seconds: number(raw.duration_seconds, '動画尺', false, false, 180),
  };
}
function number(value, label, nullable = true, integer = true, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === '' || value === null || value === undefined) {
    if (nullable) return null;
    throw new InputError(`${label}を入力してください`);
  }
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim()))) throw new InputError(`${label}は0以上の数値にしてください`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > maximum || (integer && !Number.isSafeInteger(result)) || (!nullable && result === 0)) throw new InputError(`${label}の数値が正しくありません`);
  return result;
}
export function normalizeRecord(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('実績の形式が正しくありません');
  const context = normalizeContext(raw);
  let url;
  try { url = new URL(raw.post_url); } catch { throw new InputError('Instagram投稿URLを入力してください'); }
  const match = url.pathname.match(/^\/(p|reel|reels)\/([A-Za-z0-9_-]+)\/?$/);
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password || !match) throw new InputError('Instagramの投稿またはリールのURLを指定してください');
  const published_at = timestamp(raw.published_at, '投稿日');
  const measured_at = timestamp(raw.measured_at, '数値の取得日');
  if (Date.parse(measured_at) < Date.parse(published_at) || Date.parse(measured_at) > now + 300000) throw new InputError('取得日は投稿日以降、現在時刻以前にしてください');
  const metrics = Object.fromEntries(METRICS.map(key => [key, number(raw[key], key, true, key !== 'avg_watch_seconds')]));
  if (METRICS.every(key => metrics[key] === null)) throw new InputError('少なくとも1つの実績値を入力してください');
  return {
    ...context, post_key: match[2], post_url: `https://www.instagram.com/${match[1] === 'p' ? 'p' : 'reel'}/${match[2]}/`,
    script_id: raw.script_id ? required(raw.script_id, '台本ID', 100) : null,
    store_name: required(raw.store_name, '店舗名', 200),
    syntax_pattern: required(raw.syntax_pattern, '構文・訴求の型', 120),
    final_text: required(raw.final_text, '実際に投稿した最終台本', 10000),
    published_at, measured_at, ...metrics,
    note: raw.note ? required(raw.note, 'メモ', 2000) : '',
  };
}
export function rates(record) {
  const divide = value => record.reach > 0 && value !== null ? value / record.reach : null;
  return { saves: divide(record.saves), shares: divide(record.shares), follows: divide(record.follows) };
}
export function observationEligible(record) {
  const days = (Date.parse(record.measured_at) - Date.parse(record.published_at)) / DAY;
  return days >= record.horizon_days && days < record.horizon_days + 1;
}
function durationBand(value) { return value <= 20 ? 'short' : value <= 30 ? 'medium' : 'long'; }
export function metricValue(record, goal) { return goal === 'reach' ? record.reach : rates(record)[goal]; }
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function summarize(records, context) {
  const latest = new Map();
  for (const record of records) {
    if (!['account_id', 'account_type', 'genre', 'distribution', 'horizon_days', 'goal'].every(key => record[key] === context[key])) continue;
    if (durationBand(record.duration_seconds) !== durationBand(context.duration_seconds) || !observationEligible(record)) continue;
    if (metricValue(record, context.goal) === null) continue;
    // 同じ投稿の再取得を別の成功事例として数えない。目標時点に最も近い観測を採用。
    const previous = latest.get(record.post_key);
    if (!previous || record.measured_at < previous.measured_at) latest.set(record.post_key, record);
  }
  const cohort = [...latest.values()].sort((a, b) => metricValue(b, context.goal) - metricValue(a, context.goal));
  const groups = Map.groupBy(cohort, item => item.syntax_pattern);
  return {
    count: cohort.length, metric: GOALS[context.goal],
    status: cohort.length < 5 ? 'insufficient' : 'exploratory',
    message: cohort.length < 5 ? '比較条件が一致する投稿が5件未満です。勝ちパターンは判定せず、事例を蓄積します。' : '同じ条件での参考比較です。店舗・時期・映像の違いもあるため、構文の効果とは断定できません。',
    // 少数時も内容を参照できるが、成績順の推奨は作らない。
    examples: cohort.length < 5 ? cohort.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 3) : [...cohort.slice(0, 3), ...cohort.slice(-2)],
    groups: [...groups].map(([pattern, rows]) => ({ pattern, count: rows.length, median: median(rows.map(row => metricValue(row, context.goal))) })).sort((a, b) => b.median - a.median),
  };
}
export async function loadRecords(db, accountId) {
  const rows = await db.prepare('SELECT id, payload_json FROM growth_measurements WHERE account_id = ? ORDER BY measured_at DESC LIMIT 501').bind(accountId).all();
  const results = rows.results ?? [];
  return { records: results.slice(0, 500).map(row => ({ ...JSON.parse(row.payload_json), id: row.id })), limited: results.length > 500 };
}
export async function saveRecords(db, values, now = Date.now()) {
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new InputError('1回に1〜100件を登録してください');
  const normalized = values.map((value, index) => {
    try { return normalizeRecord(value, now); } catch (error) { throw new InputError(`${index + 1}行目: ${error.message}`); }
  });
  const pending = new Map(); let duplicates = 0;
  for (const record of normalized) {
    if (record.script_id) {
      const script = await db.prepare('SELECT id, account_type FROM scripts WHERE id = ?').bind(record.script_id).first();
      if (!script || script.account_type !== record.account_type) throw new InputError('台本IDが見つからないか、台本の視点と実績の視点が一致しません');
    }
    const key = JSON.stringify([record.account_id, record.post_key, record.measured_at]);
    const previous = pending.get(key) ?? await db.prepare('SELECT payload_json FROM growth_measurements WHERE account_id = ? AND post_key = ? AND measured_at = ?').bind(record.account_id, record.post_key, record.measured_at).first();
    const payload = JSON.stringify(record);
    if (previous) {
      if (previous.payload_json !== payload) throw new InputError('同じ投稿・取得日時の記録に異なる内容があります。既存記録を確認してください');
      duplicates++; continue;
    }
    pending.set(key, { record, payload_json: payload });
  }
  if (pending.size) await db.batch([...pending.values()].map(({ record, payload_json }) => db.prepare('INSERT INTO growth_measurements (id, script_id, account_id, post_key, measured_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), record.script_id, record.account_id, record.post_key, record.measured_at, payload_json)));
  return { saved: pending.size, duplicates };
}
export async function buildLearning(env, input) {
  const accountType = input.accountType ?? input.packType ?? 'A';
  const rows = await env.DB.prepare(`SELECT r.decision, r.reason_tags, r.reason_note, r.after_text, s.id, s.syntax_pattern, s.body_json
    FROM script_reviews r JOIN scripts s ON s.id = r.script_id
    WHERE s.account_type = ? AND r.id = (SELECT rr.id FROM script_reviews rr WHERE rr.script_id=s.id ORDER BY rr.created_at DESC, rr.rowid DESC LIMIT 1)
    ORDER BY r.created_at DESC LIMIT 12`).bind(accountType).all();
  const style = [];
  for (const row of rows.results ?? []) {
    const body = JSON.parse(row.body_json);
    const original = (body.cuts ?? []).map(c => c.telop).join('\n');
    // 判定を優先し、good_patternタグだけでボツや修正前の原文を手本にしない。
    if (row.decision === 'rejected') style.push({ id: row.id, decision: '避ける例', text: original.slice(0, 800), reason: row.reason_note || row.reason_tags });
    else if (row.decision === 'revised' && row.after_text?.trim()) style.push({ id: row.id, decision: '修正後の参考', text: row.after_text.slice(0, 1200), reason: row.reason_note || row.reason_tags });
    else if (row.decision === 'adopted') style.push({ id: row.id, decision: '採用された文体の参考', text: original.slice(0, 800), reason: row.reason_note || '' });
  }
  let summary = null, limited = false;
  if (input.growth) {
    const context = normalizeContext({ ...input.growth, account_type: accountType, duration_seconds: Number.parseFloat(input.duration) });
    const loaded = await loadRecords(env.DB, context.account_id);
    limited = loaded.limited;
    summary = summarize(loaded.records, context);
  }
  const evidence = summary?.examples.map(record => ({ post_url: record.post_url, final_text: record.final_text.slice(0, 1200), pattern: record.syntax_pattern, value: metricValue(record, input.growth.goal), measured_at: record.measured_at })) ?? [];
  return {
    rule_version: RULE_VERSION, summary, limited,
    block: `\n【編集判断の参考データ：投稿成果とは別】\n${JSON.stringify(style)}\n【投稿実績の参考データ】\n${JSON.stringify({ message: summary?.message ?? '実績の比較条件が未指定です。成果による推奨はしません。', count: summary?.count ?? 0, metric: summary?.metric, limited, examples: evidence })}\n【今回の確認済み事実のメモ：ユーザー申告、独立検証は未実施】\n${JSON.stringify(String(input.growth?.verified_facts ?? input.verifiedFacts ?? '').slice(0, 8000))}`,
    rules: GENERATION_RULES,
  };
}
