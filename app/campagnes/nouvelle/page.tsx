import Link from 'next/link';
import { requireAuthenticated } from '@/lib/auth';
import { getStore } from '@/lib/db';
import { CampaignForm } from '@/components/campaign-forms';
export const metadata={title:'Créer une campagne'};
export default async function NewCampaign(){await requireAuthenticated();return <><Link href="/campagnes" className="back-link">← Campagnes</Link><div className="page-heading"><div><p className="eyebrow">UNE NOUVELLE CIBLE</p><h1>Créer une campagne</h1><p className="page-subtitle">Définissez à qui vous voulez parler et ce que vous pouvez améliorer.</p></div></div><section className="panel section-panel campaign-editor"><CampaignForm defaults={await getStore().getSettings()}/></section></>;}
