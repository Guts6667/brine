'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { assertAuthConfiguration, createSession, isAuthEnabled, safeReturnTo, SESSION_COOKIE_NAME, sessionCookieOptions, verifyPassword } from '@/lib/auth';
import { consumeLoginAttempt } from '@/lib/login-rate-limit';
import { isAllowedRequest } from '@/lib/security';

export type LoginState = { error?: string };

export async function loginAction(_: LoginState, data: FormData): Promise<LoginState> {
  const returnTo = safeReturnTo(data.get('returnTo'));
  try {
    assertAuthConfiguration();
    const requestHeaders = await headers();
    if (!isAllowedRequest(requestHeaders.get('host'), requestHeaders.get('origin'), requestHeaders.get('sec-fetch-site'))) return { error: 'Requête non autorisée. Actualisez la page avant de réessayer.' };
    if (isAuthEnabled()) {
      const limit = await consumeLoginAttempt(requestHeaders);
      if (!limit.allowed) return { error: `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil(limit.retryAfter / 60))} minutes.` };
      const password = data.get('password');
      if (typeof password !== 'string' || !verifyPassword(password, process.env.BRINE_PASSWORD_HASH!)) return { error: 'Mot de passe incorrect.' };
      (await cookies()).set(SESSION_COOKIE_NAME, createSession(), sessionCookieOptions());
    }
  } catch { return { error: 'La connexion est temporairement indisponible. Réessayez plus tard.' }; }
  redirect(returnTo);
}

export async function logoutAction(): Promise<void> {
  const requestHeaders = await headers();
  if (!isAllowedRequest(requestHeaders.get('host'), requestHeaders.get('origin'), requestHeaders.get('sec-fetch-site'))) throw new Error('Requête non autorisée.');
  (await cookies()).set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0, expires: new Date(0) });
  redirect('/connexion');
}
