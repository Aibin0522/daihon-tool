import { checkOperator, clearSessionCookie, createSessionCookie, sameOriginWrite, securityHeaders, validCredentials, validOperatorConfig } from './operator-auth.mjs';

export function loginPage(message = '', status = 200) {
  // 表示するメッセージはこのファイル内の固定文言だけ。入力された認証情報は再表示しない。
  return new Response(`<!doctype html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>ログイン | Aibin 台本メーカー</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fffdfb;color:#26201b;font-family:system-ui,-apple-system,sans-serif;min-height:100svh;display:grid;place-items:center;padding:24px}.card{width:100%;max-width:420px;background:white;border:1px solid #e8e1da;border-radius:20px;padding:32px;box-shadow:0 8px 36px #26201b08}.brand{color:#b8432f;font-weight:700;font-size:12px;letter-spacing:3px}h1{font-size:25px;margin:14px 0 10px}p{font-size:14px;line-height:1.8;color:#74695f}label{display:block;font-size:14px;font-weight:700;margin:20px 0 8px}input{width:100%;font:inherit;padding:12px;border:1.5px solid #e8e1da;border-radius:10px}input:focus{outline:2px solid #b8432f;outline-offset:2px}button{width:100%;padding:14px;margin-top:24px;border:0;border-radius:10px;background:#b8432f;color:white;font:inherit;font-weight:700;cursor:pointer}.note{font-size:12px;margin:20px 0 0}.error{color:#9a3524;background:#fbf1ee;border-radius:8px;padding:12px;margin-top:16px}</style></head>
<body><main class="card"><div class="brand">AIBIN TOOLS</div><h1>台本メーカーにログイン</h1><p>担当者用のユーザー名とパスワードを入力してください。</p>${message ? `<p class="error" role="alert">${message}</p>` : ''}
<form method="post" action="/login"><label for="username">ユーザー名</label><input id="username" name="username" autocomplete="username" maxlength="64" autocapitalize="none" spellcheck="false" required autofocus><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required><button type="submit">ログイン</button></form><p class="note">ログイン情報は、このMacに保存した「担当者ログイン.txt」で確認できます。</p></main></body></html>`, {
    status,
    headers: { ...securityHeaders, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" },
  });
}

export function loginRedirect(path = '/login', cookie) {
  return new Response(null, { status: 303, headers: { ...securityHeaders, location: path, ...(cookie ? { 'set-cookie': cookie } : {}) } });
}

async function boundedForm(request) {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return null;
  if (Number(request.headers.get('content-length')) > 4096 || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export async function handleLogin(request, env = process.env) {
  const path = new URL(request.url).pathname;
  if (!['/login', '/logout'].includes(path)) return null;
  if (!validOperatorConfig(env)) return loginPage('担当者用ログインの設定が必要です。管理者へご連絡ください。', 503);
  if (path === '/login' && ['GET', 'HEAD'].includes(request.method)) return loginPage();
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...securityHeaders, allow: 'POST' } });
  if (!sameOriginWrite(request.headers, env)) return loginPage('このログイン画面からもう一度操作してください。', 403);
  if (path === '/logout') {
    const denied = await checkOperator(request.headers, request.method, env);
    return denied || loginRedirect('/login', clearSessionCookie());
  }
  const form = await boundedForm(request);
  if (!form || form.getAll('username').length !== 1 || form.getAll('password').length !== 1) return loginPage('入力内容を確認してください。', 400);
  if (!await validCredentials(form.get('username'), form.get('password'), env)) return loginPage('ユーザー名またはパスワードが違います。もう一度入力してください。', 401);
  return loginRedirect('/', await createSessionCookie(env));
}
