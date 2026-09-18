import { next } from '@vercel/functions';
import { checkOperator, securityHeaders } from './lib/operator-auth.mjs';
import { handleLogin, loginRedirect } from './lib/operator-login.mjs';

// 画面・API・別名のパスを同じ担当者認証で保護する。
export const config = { matcher: '/:path*' };
export default async function middleware(request) {
  const login = await handleLogin(request);
  if (login) return login;
  const denied = await checkOperator(request.headers, request.method);
  if (denied?.status === 401 && ['GET', 'HEAD'].includes(request.method) && request.headers.get('accept')?.includes('text/html')) return loginRedirect();
  return denied || next({ headers: securityHeaders });
}
