'use client';

import { useActionState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { loginAction, type LoginState } from './actions';

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return <form action={action} className="auth-form stack">
    <input type="hidden" name="returnTo" value={returnTo}/>
    <div className="field">
      <label htmlFor="password">Mot de passe</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} autoFocus aria-describedby={state.error ? 'login-error' : undefined} aria-invalid={state.error ? true : undefined}/>
    </div>
    {state.error && <p id="login-error" className="form-error" role="alert">{state.error}</p>}
    <button className="button primary" type="submit" disabled={pending}>{pending ? 'Connexion…' : 'Entrer dans Brine'}<ArrowUpRight size={16} aria-hidden="true"/></button>
    <p className="field-help">Votre session reste ouverte pendant 8 heures.</p>
  </form>;
}
