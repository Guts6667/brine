'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Building2, Target, Database, ArrowUpRight } from 'lucide-react';
export function Navigation({cloud=false}:{cloud?:boolean}) {
  const path = usePathname();
  return <aside className="sidebar">
    <Link href="/" className="brand" aria-label="Brine — accueil"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M12 28C5 22 10 13 15 8C20 3 27 5 29 10C32 16 25 26 21 29C18 32 15 31 12 28Z" stroke="currentColor" strokeWidth="2.5"/><path d="M15 25L23 11M11 18L14 17M21 26L23 23M19 9L20 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span><span>brine<span className="brand-sub">perso</span></span></Link>
    <div className="nav-caption">MON ESPACE</div>
    <nav aria-label="Navigation principale">
      <Link href="/" className={`nav-link ${path === '/' ? 'active' : ''}`} aria-current={path === '/' ? 'page' : undefined}><CalendarDays size={19}/>Aujourd’hui</Link>
      <Link href="/campagnes" className={`nav-link ${path.startsWith('/campagnes') ? 'active' : ''}`} aria-current={path.startsWith('/campagnes') ? 'page' : undefined}><Target size={19}/>Campagnes</Link>
      <Link href="/prospects" className={`nav-link ${path.startsWith('/prospects') ? 'active' : ''}`} aria-current={path.startsWith('/prospects') ? 'page' : undefined}><Building2 size={19}/>Prospects</Link>
    </nav>
    <div className="sidebar-bottom"><div className="personal-note"><span className="small-leaf">↗</span><p>Un contact à la fois.<br/><strong>À votre rythme.</strong></p></div>
    <Link href="/sauvegarde" className="utility-link"><Database size={16}/>Données et préférences<ArrowUpRight size={14}/></Link>
    <div className="local-note"><span className="status-dot"/>{cloud?'Disponible où que vous soyez':'Stocké sur cet ordinateur'}</div></div>
  </aside>;
}
