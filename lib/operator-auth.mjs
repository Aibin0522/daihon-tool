// 共有の担当者用認証。パスワードはサーバーの環境変数だけに保存する。
const securityHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};

function reject(message, status, challenge = false) {
  return Response.json({ error: message }, {
    status,
    headers: { ...securityHeaders, ...(challenge ? { 'www-authenticate': 'Basic realm="Aibin Script", charset="UTF-8"' } : {}) },
  });
}

export function configuredOrigins(env) {
  const origins = new Set();
  for (const value of [env.APP_ORIGIN, env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origins.add(url.origin);
    } catch { /* 設定不備は有効なオリジンとして扱わない */ }
  }
  return origins;
}

export async function checkOperator(headers, method, env = process.env) {
  const user = env.APP_USER || 'aibin';
  const password = env.APP_PASSWORD;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user) || typeof password !== 'string' || !/^[\x21-\x7E]{16,256}$/.test(password) || !configuredOrigins(env).size) {
    return reject('担当者用ログインの設定が必要です。管理者へご連絡ください。', 503);
  }
  const supplied = headers.get('authorization') || '';
  if (supplied.length > 1024) return reject('ログイン情報を確認してください。', 401, true);
  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  const hashes = await Promise.all([supplied, expected].map(value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  const left = new Uint8Array(hashes[0]), right = new Uint8Array(hashes[1]);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  if (mismatch) return reject('担当者用のユーザー名とパスワードを入力してください。', 401, true);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    // Basic認証をブラウザーが再送しても、外部サイトからの書き込みを許可しない。
    if (!configuredOrigins(env).has(headers.get('origin')) || headers.get('sec-fetch-site') === 'cross-site') {
      return reject('台本ツールの画面から操作してください。', 403);
    }
  }
  return null;
}

export async function requireOperator(req, res) {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const denied = await checkOperator(headers, req.method);
  if (!denied) return true;
  for (const [name, value] of denied.headers) res.setHeader(name, value);
  res.status(denied.status).send(await denied.text());
  return false;
}

export { securityHeaders };
