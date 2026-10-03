import { requireAuthenticated } from '@/lib/auth';
import { Database, MapPin, HardDrive } from 'lucide-react';
import { getStore } from '@/lib/db';
import { AsyncCloudStore } from '@/lib/cloud-db';
import Link from 'next/link';
import { SettingsForm, BackupForms } from '@/components/forms';
export const metadata={title:'Données et préférences'};
export default async function DataPage() {
  await requireAuthenticated();
  const store = getStore();
  const settings = await store.getSettings();
  const recoveryBackups = store instanceof AsyncCloudStore ? await store.listRecoveryBackups() : [];
  return <><div className="page-heading"><div><p className="eyebrow">VOTRE ESPACE, VOS DONNÉES</p><h1>Données et préférences</h1><p className="page-subtitle">Quelques réglages simples, et une copie de votre travail.</p></div></div><div className="settings-layout"><section className="panel section-panel" id="cible"><div className="section-title"><MapPin size={22}/><div><h2>Votre cible du moment</h2><p className="muted">Un point de départ, toujours modifiable.</p></div></div><SettingsForm settings={settings}/></section><section className="panel section-panel"><div className="section-title"><Database size={22}/><div><h2>Sauvegarde et restauration</h2><p className="muted">Toutes les fiches, contacts, notes, actions et relevés IA.</p></div></div><div className="data-notice"><HardDrive size={18}/><p>La sauvegarde JSON contient des coordonnées professionnelles. Elle n’est pas chiffrée : conservez-la dans un endroit sûr.</p></div><BackupForms/>{recoveryBackups.length>0&&<div className="recovery-backups"><h3>Avant vos restaurations</h3><p className="muted">Retrouver une copie privée de votre travail précédent.</p><ul>{recoveryBackups.slice(0,10).map(b=><li key={b.id}><Link href={`/api/backup/${b.id}`}>Télécharger la copie du {new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(b.createdAt))}</Link></li>)}</ul></div>}</section></div></>;
}
