import { requireAuthenticated } from '@/lib/auth';
import { Database, MapPin, HardDrive } from 'lucide-react';
import { getStore } from '@/lib/db';
import { AsyncCloudStore } from '@/lib/cloud-db';
import Link from 'next/link';
import { SettingsForm, BackupForms } from '@/components/forms';
import { ProviderProfileForm } from '@/components/contact-workspace';
import { CreditPurchaseForm } from '@/components/credit-purchase';
import { ResearchStatus } from '@/components/research-status';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { parisToday } from '@/lib/domain';
export const metadata={title:'Données et préférences'};
export default async function DataPage() {
  await requireAuthenticated();
  const store = getStore();
  const settings = await store.getSettings();
  const profile=await(await getCampaignRepository()).getProviderProfile();
  const recoveryBackups = store instanceof AsyncCloudStore ? await store.listRecoveryBackups() : [];
  return <><div className="page-heading"><div><p className="eyebrow">VOTRE ESPACE, VOS DONNÉES</p><h1>Données et préférences</h1><p className="page-subtitle">Quelques réglages simples, et une copie de votre travail.</p></div></div><section className="panel section-panel" id="profil"><h2>Mon activité et mon offre</h2><p>Les présentations et les aides proposées partent de ces informations réelles.</p><ProviderProfileForm profile={profile}/></section><section className="panel section-panel" id="budget"><h2>Sources et budget</h2><ResearchStatus/><p className="field-help">Sur Vercel, ajouter OPENROUTER_API_KEY et SERPAPI_API_KEY en Production. PAGESPEED_API_KEY est facultative. Clé OpenRouter dédiée, limite mensuelle de 5 $, recharge automatique désactivée. Le budget des achats est de 10 € par mois frais compris. Les secrets restent côté serveur.</p><details><summary>Enregistrer un achat de crédits payé manuellement</summary><div className="details-body"><CreditPurchaseForm today={parisToday()}/></div></details></section><div className="settings-layout"><section className="panel section-panel" id="cible"><div className="section-title"><MapPin size={22}/><div><h2>Votre cible du moment</h2><p className="muted">Un point de départ, toujours modifiable.</p></div></div><SettingsForm settings={settings}/></section><section className="panel section-panel"><div className="section-title"><Database size={22}/><div><h2>Sauvegarde et restauration</h2><p className="muted">Toutes les fiches, contacts, notes, actions et relevés IA.</p></div></div><div className="data-notice"><HardDrive size={18}/><p>La sauvegarde JSON contient des coordonnées professionnelles. Elle n’est pas chiffrée : conservez-la dans un endroit sûr.</p></div><BackupForms/>{recoveryBackups.length>0&&<div className="recovery-backups"><h3>Avant vos restaurations</h3><p className="muted">Retrouver une copie privée de votre travail précédent.</p><ul>{recoveryBackups.slice(0,10).map(b=><li key={b.id}><Link href={`/api/backup/${b.id}`}>Télécharger la copie du {new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(b.createdAt))}</Link></li>)}</ul></div>}</section></div></>;
}
