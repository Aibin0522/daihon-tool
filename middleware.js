import { next } from '@vercel/functions';
import { checkOperator, securityHeaders } from './lib/operator-auth.mjs';

// 画面・API・別名のパスを同じ担当者認証で保護する。
export const config = { matcher: '/:path*' };
export default async function middleware(request) {
  const denied = await checkOperator(request.headers, request.method);
  return denied || next({ headers: securityHeaders });
}
