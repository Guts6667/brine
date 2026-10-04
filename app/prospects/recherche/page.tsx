import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireAuthenticated } from '@/lib/auth';
import { getStore } from '@/lib/db';
import { CompanyDiscovery } from '@/components/company-discovery';

export const metadata = { title: 'Trouver des entreprises' };
export default async function SearchPage() {
  await requireAuthenticated();
  const settings = await getStore().getSettings();
  return <><Link href="/prospects" className="back-link"><ArrowLeft size={16}/>Tous les prospects</Link>
    <div className="page-heading"><div><p className="eyebrow">DE NOUVELLES PISTES</p><h1>Trouver des entreprises</h1><p className="page-subtitle">Choisissez une activité et une commune, puis les entreprises à étudier.</p></div></div>
    <CompanyDiscovery settings={settings}/>
  </>;
}
