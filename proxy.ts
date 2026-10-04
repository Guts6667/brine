import { NextRequest, NextResponse } from 'next/server';
import { assertAuthConfiguration, isAuthEnabled, SESSION_COOKIE_NAME, verifySession } from './lib/auth';
import { isAllowedRequest } from './lib/security';
export function proxy(request: NextRequest) {
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const navigation = ['GET', 'HEAD'].includes(request.method) && request.headers.get('sec-fetch-mode') === 'navigate' && !request.nextUrl.pathname.startsWith('/api/');
  const site = request.headers.get('sec-fetch-site');
  // A clicked external link may open the login page; cross-site fetches remain blocked.
  if (!isAllowedRequest(request.headers.get('host'), request.headers.get('origin'), navigation && site === 'cross-site' ? 'none' : site, mutation)) {
    return new NextResponse(process.env.VERCEL === '1' ? 'Requête non autorisée.' : 'Requête locale non autorisée.', { status: 403 });
  }
  try { assertAuthConfiguration(); }
  catch { return new NextResponse('Accès privé indisponible : configuration de sécurité incomplète.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }

  const { pathname, search } = request.nextUrl;
  const publicAsset = !mutation && (pathname.startsWith('/_next/static/') || pathname === '/favicon.ico' || pathname.startsWith('/_next/webpack-hmr'));
  if (publicAsset) return NextResponse.next();

  const authenticated = !isAuthEnabled() || verifySession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (pathname !== '/connexion' && !authenticated) {
    if (mutation || pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) {
      return new NextResponse('Connexion requise.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const login = new URL('/connexion', request.url);
    login.searchParams.set('returnTo', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}
export const config = { matcher: '/((?!\\.well-known/workflow/|api/campaign-runs/reconcile$).*)' };
