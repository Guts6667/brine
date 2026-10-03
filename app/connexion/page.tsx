import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { assertAuthConfiguration, isAuthEnabled, safeReturnTo, SESSION_COOKIE_NAME, verifySession } from '@/lib/auth';
import { LoginForm } from './form';

export const metadata: Metadata = { title: 'Connexion', robots: { index: false, follow: false } };

export default async function ConnexionPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  assertAuthConfiguration();
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (!isAuthEnabled() || verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value)) redirect(returnTo);
  return <div className="auth-shell">
    <section className="auth-card panel" aria-labelledby="login-title">
      <div className="auth-intro">
        <span className="eyebrow"><LockKeyhole size={13} aria-hidden="true"/> ESPACE PRIVÉ</span>
        <h1 id="login-title">À votre <em>rythme.</em><br/>Où que vous soyez.</h1>
        <p>Retrouvez vos prospects, vos notes et vos prochaines conversations.</p>
      </div>
      <LoginForm returnTo={returnTo}/>
    </section>
    <p className="auth-access-note">Brine · Votre espace personnel de prospection.</p>
  </div>;
}
