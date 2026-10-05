import type { Metadata } from 'next';
import Link from 'next/link';
import { Navigation } from '@/components/navigation';
import { cookies } from 'next/headers';
import { isCloudStorage } from '@/lib/db';
import { isAuthEnabled, SESSION_COOKIE_NAME, verifySession } from '@/lib/auth';
import { logoutAction } from '@/app/connexion/actions';
import './globals.css';
import './automation.css';
import './campaigns.css';
import './research.css';
import './visual-evidence.css';
import './learning.css';
export const metadata:Metadata={title:{default:'Brine',template:'%s · Brine'},description:'Votre espace personnel de prospection, un contact à la fois.'};
export const runtime='nodejs';
export const dynamic='force-dynamic';
export default async function Layout({children}:{children:React.ReactNode}) {
  const cloud = isCloudStorage();
  const authenticated = isAuthEnabled() && verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  return <html lang="fr"><body><a className="skip-link" href="#main">Aller au contenu</a><Navigation cloud={cloud}/><div className="workspace"><header className="topbar"><span>Brine <span className="topbar-separator">/</span> <strong>Prospection personnelle</strong></span><span className="topbar-person"><span className="status-dot"/>{cloud?'Espace privé':'Espace local'}{authenticated&&<form action={logoutAction}><button className="logout-button" type="submit">Déconnexion</button></form>}<span className="avatar">R</span></span></header><main id="main" tabIndex={-1}>{children}</main><footer className="workspace-footer">Fait pour avancer, une conversation à la fois.<span>Brine · <Link href="/sauvegarde">Données et préférences</Link></span></footer></div></body></html>;
}
