import Link from 'next/link';
export default function NotFound(){return <div className="empty-state"><h1>Cette fiche est introuvable.</h1><p>Elle a peut-être été remplacée lors d’une restauration.</p><Link href="/prospects" className="button primary">Revenir aux prospects</Link></div>;}
