// 共有の担当者用認証。パスワードはサーバーの環境変数だけに保存する。
const securityHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};

export const sessionCookieName = '__Host-aibin_session';
const sessionSeconds = 8 * 60 * 60;
const encoder = new TextEncoder();

function reject(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: securityHeaders,
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

export function validOperatorConfig(env) {
  const user = env.APP_USER || 'aibin';
  const password = env.APP_PASSWORD;
  return /^[A-Za-z0-9._-]{1,64}$/.test(user) && typeof password === 'string' && /^[\x21-\x7E]{16,256}$/.test(password) && configuredOrigins(env).size > 0;
}

async function equalSecret(supplied, expected) {
  const hashes = await Promise.all([supplied, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(hashes[0]), right = new Uint8Array(hashes[1]);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export async function validCredentials(user, password, env = process.env) {
  if (!validOperatorConfig(env) || typeof user !== 'string' || typeof password !== 'string' || user.length > 64 || password.length > 256) return false;
  return equalSecret(`${user}:${password}`, `${env.APP_USER || 'aibin'}:${env.APP_PASSWORD}`);
}

export function sameOriginWrite(headers, env = process.env) {
  return configuredOrigins(env).has(headers.get('origin')) && headers.get('sec-fetch-site') !== 'cross-site';
}

function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decode(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
function signingKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(`aibin-session-v1:${env.APP_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionCookie(env = process.env, now = Math.floor(Date.now() / 1000)) {
  if (!validOperatorConfig(env)) throw new Error('ログイン設定がありません');
  const payload = encode(encoder.encode(JSON.stringify({ sub: env.APP_USER || 'aibin', iat: now, exp: now + sessionSeconds, aud: [...configuredOrigins(env)][0] })));
  const value = `v1.${payload}`;
  const signature = encode(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(value))));
  return `${sessionCookieName}=${value}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionSeconds}`;
}

export function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function validSession(headers, env) {
  const values = (headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${sessionCookieName}=`));
  if (values.length !== 1) return false;
  const token = values[0].slice(sessionCookieName.length + 1);
  if (token.length > 1024 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    const [version, body, signature] = token.split('.');
    if (!await crypto.subtle.verify('HMAC', await signingKey(env), decode(signature), encoder.encode(`${version}.${body}`))) return false;
    const payload = JSON.parse(new TextDecoder().decode(decode(body)));
    const now = Math.floor(Date.now() / 1000);
    return payload.sub === (env.APP_USER || 'aibin') && payload.aud === [...configuredOrigins(env)][0] && Number.isInteger(payload.exp) && Number.isInteger(payload.iat) && payload.iat <= now && payload.exp > now && payload.exp - payload.iat === sessionSeconds;
  } catch { return false; }
}

export async function checkOperator(headers, method, env = process.env) {
  if (!validOperatorConfig(env)) return reject('担当者用ログインの設定が必要です。管理者へご連絡ください。', 503);
  let authenticated = await validSession(headers, env);
  // 検証用の既存Basic認証も受け付けるが、ブラウザーへ認証ダイアログは要求しない。
  const supplied = headers.get('authorization') || '';
  if (!authenticated && supplied.length <= 1024) authenticated = await equalSecret(supplied, `Basic ${btoa(`${env.APP_USER || 'aibin'}:${env.APP_PASSWORD}`)}`);
  if (!authenticated) return reject('ログイン画面でユーザー名とパスワードを入力してください。', 401);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    // ログイン済みでも、外部サイトからの書き込みは許可しない。
    if (!sameOriginWrite(headers, env)) {
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
