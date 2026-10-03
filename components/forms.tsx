'use client';
import { createContext, useActionState, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, HTMLInputTypeAttribute } from 'react';
import { Plus, X, ArrowRight, Check, CalendarDays, Pencil, MessageSquare, StickyNote, ChevronDown, Archive, ShieldOff, RotateCcw, Download, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createCompanyAction, saveCompanyAction, saveAction, completeAction, postponeAction, addActivityAction, addAiTestAction, archiveAction, oppositionAction, saveSettingsAction, previewBackupAction, restoreBackupAction } from '@/app/actions';
import { stages, type Company, type Settings, type ActionState } from '@/lib/types';
import { parisToday } from '@/lib/domain';

type Mutation = (state:ActionState, data:FormData)=>Promise<ActionState>;
const StateContext = createContext<ActionState>({});
function Feedback({state}:{state:ActionState}) {
  return <>{state.error && <div role="alert" className="form-error">{state.error}</div>}{state.ok && state.message && <div role="status" className="form-success"><Check size={16}/>{state.message}</div>}</>;
}
function ActionForm({action,children,submit='Enregistrer',className='',onSuccess}:{action:Mutation;children:ReactNode;submit?:string;className?:string;onSuccess?:()=>void}) {
  const [state,dispatch,pending]=useActionState(action,{});
  const previous = useRef(state);
  const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>{if(state.fields){const fields=formRef.current?.querySelectorAll('[aria-invalid="true"]');fields?.forEach(field=>{let node:HTMLElement|null=field.parentElement;while(node){if(node instanceof HTMLDetailsElement)node.open=true;node=node.parentElement;}});(fields?.[0] as HTMLElement|undefined)?.focus();}},[state]);
  useEffect(()=>{ if(state!==previous.current && state.ok) onSuccess?.(); previous.current=state; },[state,onSuccess]);
  return <StateContext.Provider value={state}><form ref={formRef} action={dispatch} className={className} onReset={e=>e.preventDefault()}>
    {children}
    {state.duplicates && <div className="duplicate-warning"><strong>Doublon possible</strong><ul>{state.duplicates.map(c=><li key={c.id}><Link href={`/prospects/${c.id}`}>{c.name}</Link></li>)}</ul><label className="check-label"><input type="checkbox" name="allowDuplicate" value="yes"/>Créer quand même une fiche distincte</label></div>}
    <Feedback state={state}/><button type="submit" className="button primary" disabled={pending}>{pending?'Enregistrement…':submit}<Check size={15}/></button>
  </form></StateContext.Provider>;
}
function Field({name,label,help,type='text',value,placeholder,required=false,textarea=false,children,min,max}:{name:string;label:string;help?:string;type?:HTMLInputTypeAttribute;value?:string|number;placeholder?:string;required?:boolean;textarea?:boolean;children?:ReactNode;min?:number;max?:number}) {
  const id=useId(), state=useContext(StateContext), error=state.fields?.[name];
  const [currentValue,setCurrentValue]=useState(value??'');
  useEffect(()=>setCurrentValue(value??''),[value]);
  const props = {id,name,value:currentValue,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>setCurrentValue(e.target.value),required,placeholder,'aria-invalid':!!error,'aria-describedby':help||error?`${id}-help`:undefined};
  return <div className="field"><label htmlFor={id}>{label}{required&&<span className="required" aria-label="obligatoire"> *</span>}</label>
    {children?<select {...props}>{children}</select>:textarea?<textarea {...props} rows={3} maxLength={10000}/>:<input {...props} type={type} min={min} max={max} step={type==='number'?1:undefined} maxLength={type==='number'||type==='date'?undefined:1000}/>}
    {(help||error)&&<span id={`${id}-help`} className={error?'field-error':'field-help'}>{error||help}</span>}
  </div>;
}
function Modal({title,description,children,button,buttonClass='button primary',icon=<Plus size={18}/>,testId}:{title:string;description?:string;children:ReactNode;button:string;buttonClass?:string;icon?:ReactNode;testId?:string}) {
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  return <><button type="button" className={buttonClass} onClick={()=>ref.current?.showModal()} data-testid={testId}>{icon}{button}</button>
    <dialog ref={ref} aria-labelledby={id} onClick={e=>{if(e.target===e.currentTarget)ref.current?.close();}}><div className="modal-inner"><div className="modal-heading"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Fermer" onClick={()=>ref.current?.close()}><X size={20}/></button></div>{description&&<p className="muted modal-description">{description}</p>}{children}</div></dialog></>;
}
export function AddCompany({settings}:{settings:Settings}) {
  return <Modal title="Une nouvelle entreprise" button="Ajouter une entreprise" description="Un nom suffit pour commencer. Vous pourrez compléter la fiche à votre rythme.">
    <ActionForm action={createCompanyAction} submit="Créer l’entreprise" className="stack">
      <Field name="name" label="Nom de l’entreprise" required placeholder="Ex. Atelier du Lez"/>
      <Field name="website" label="Site web" placeholder="entreprise.fr"/>
      <div className="form-grid"><Field name="city" label="Ville" placeholder={settings.targetCity||'Ville'} help="Suggestion à valider : saisissez la ville réelle."/><Field name="business" label="Activité" placeholder={settings.targetBusiness||'Activité'} help="Suggestion à valider : saisissez l’activité réelle."/></div>
    </ActionForm>
  </Modal>;
}
export function CompanyForm({company:c}:{company:Company}) {
  return <ActionForm action={saveCompanyAction.bind(null,c.id)} submit="Enregistrer la fiche" className="company-form">
    <details className="panel secondary-details"><summary><Pencil size={16}/>Informations et étape de l’entreprise<ChevronDown size={16}/></summary><div className="details-body form-grid"><Field name="name" label="Nom de l’entreprise" value={c.name} required/><Field name="website" label="Site web" value={c.website}/><Field name="city" label="Ville" value={c.city}/><Field name="business" label="Activité" value={c.business}/><Field name="stage" label="Étape commerciale" value={c.stage}>{stages.map(s=><option key={s}>{s}</option>)}</Field></div></details>
    {(c.targetFit!=='unknown'||c.problemFound!=='unknown'||c.contactAvailable!=='unknown'||c.observation||c.trigger)&&<details className="panel secondary-details"><summary>Ancienne qualification<ChevronDown size={16}/></summary><div className="details-body stack"><p className="field-help">Ces anciennes réponses sont conservées comme historique. Confirmez les cinq critères du nouveau barème séparément.</p><p className="small">Cible : {c.targetFit==='unknown'?'À vérifier':c.targetFit==='yes'?'Oui':'Non'} · Problème : {c.problemFound==='unknown'?'À vérifier':c.problemFound==='yes'?'Oui':'Non'} · Contact : {c.contactAvailable==='unknown'?'À vérifier':c.contactAvailable==='yes'?'Oui':'Non'}</p>{c.observation&&<p className="plain-text">{c.observation}</p>}{c.observedOn&&<p className="small muted">Observation du {c.observedOn}</p>}{c.proofUrl&&<a href={c.proofUrl} target="_blank" rel="noopener noreferrer" className="open-link">Consulter la preuve<ArrowRight size={13}/></a>}{c.trigger&&<p className="plain-text">Pourquoi maintenant : {c.trigger}</p>}</div></details>}
    <section className="panel section-panel" aria-labelledby="contact-heading"><div className="section-title"><span className="section-number">01</span><div><h2 id="contact-heading">Contact</h2><p className="muted">Un contact principal et ses canaux professionnels.</p></div></div><div className="form-grid"><Field name="contact.name" label="Nom du contact" value={c.contact.name}/><Field name="contact.role" label="Fonction" value={c.contact.role}/><Field name="contact.email" label="Email professionnel" type="email" value={c.contact.email}/><Field name="contact.phone" label="Téléphone professionnel" type="tel" value={c.contact.phone}/></div>
      <details className="inline-details"><summary>Formulaire ou profil professionnel<ChevronDown size={15}/></summary><div className="form-grid details-body"><Field name="contact.formUrl" label="Lien du formulaire officiel" value={c.contact.formUrl}/><Field name="contact.profileUrl" label="Lien du profil professionnel" value={c.contact.profileUrl}/></div></details>
      <p className="field-help">Une coordonnée professionnelle ne signifie pas qu’un accord de contact a été obtenu.</p>
    </section>
  </ActionForm>;
}
export function PlanAction({company:c,compact=false}:{company:Company;compact?:boolean}) {
  if(c.oppositionActive)return <span className="muted small">Relances bloquées par l’opposition.</span>;
  return <Modal title={c.nextAction?'Modifier la prochaine action':'Prévoir la suite'} button={c.nextAction?'Modifier l’action':'Prévoir la suite'} buttonClass={compact?'button secondary small-button':'button primary'} icon={<CalendarDays size={16}/>} description="Une seule prochaine action. La date est facultative et n’a pas d’heure.">
    <ActionForm action={saveAction.bind(null,c.id)} submit="Enregistrer l’action" className="stack"><input type="hidden" name="expectedId" value={c.nextAction?.id??''}/><Field name="text" label="Action" value={c.nextAction?.text} required placeholder="Ex. Appeler pour présenter le constat"/><Field name="date" label="Date de l’action" type="date" value={c.nextAction?.date} help="Sans date : À planifier. Les dates sont interprétées en Europe/Paris."/></ActionForm>
  </Modal>;
}
export function ActionButtons({company:c}:{company:Company}) {
  const [state,dispatch,pending]=useActionState(completeAction.bind(null,c.id),{});
  return <div className="action-controls"><div className="button-row"><form action={dispatch}><input type="hidden" name="expectedId" value={c.nextAction?.id??''}/><button type="submit" className="button secondary small-button" disabled={pending}><Check size={16}/>{pending?'En cours…':'Fait'}</button></form>
    <Modal title="Reporter l’action" button="Reporter" buttonClass="button text-button small-button" icon={<RotateCcw size={14}/>}><ActionForm action={postponeAction.bind(null,c.id)} submit="Confirmer le report" className="stack"><input type="hidden" name="expectedId" value={c.nextAction?.id??''}/><p className="muted">{c.nextAction?.text}</p><Field name="date" label="Nouvelle date" type="date" value={c.nextAction?.date} help="Effacez la date pour laisser l’action à planifier."/></ActionForm></Modal></div><Feedback state={state}/>{state.ok&&<PlanAction company={{...c,nextAction:null}} compact/>}</div>;
}
export function AddActivity({id}:{id:string}) {
  const [type,setType]=useState('Appel');
  return <div className="button-row"><Modal title="Ajouter une note" button="Ajouter une note" buttonClass="button secondary" icon={<StickyNote size={16}/>}><ActionForm action={addActivityAction.bind(null,id)} submit="Enregistrer la note" className="stack"><input type="hidden" name="kind" value="note"/><Field name="date" label="Date de la note" type="date" value={parisToday()}/><Field name="text" label="Note" textarea required placeholder="Votre observation, une idée ou un lien utile…"/></ActionForm></Modal>
    <Modal title="Noter un échange" button="Noter un échange" buttonClass="button secondary" icon={<MessageSquare size={16}/>}><ActionForm action={addActivityAction.bind(null,id)} submit="Enregistrer l’échange" className="stack"><input type="hidden" name="kind" value="exchange"/><Field name="date" label="Date de l’échange" type="date" value={parisToday()}/><div className="field"><label htmlFor={`type-${id}`}>Type d’échange</label><select id={`type-${id}`} name="type" value={type} onChange={e=>setType(e.target.value)}>{['Appel','Email','Rendez-vous','Message professionnel','Autre'].map(t=><option key={t}>{t}</option>)}</select></div><Field name="text" label="Compte rendu" textarea required/>{type==='Appel'&&<details className="inline-details"><summary>Quelques repères pour votre appel<ChevronDown size={15}/></summary><p className="field-help details-body">Besoin évoqué · Priorité · Budget exprimé · Personne qui décide. Notez seulement ce qui a été dit.</p></details>}</ActionForm></Modal></div>;
}
export function AddAiTest({id}:{id:string}) {
  return <Modal title="Ajouter un relevé IA" button="Ajouter un relevé" buttonClass="button secondary" description="Saisie manuelle, facultative. Les relevés restent séparés, sans score ni cumul automatique.">
    <ActionForm action={addAiTestAction.bind(null,id)} submit="Enregistrer le relevé" className="stack">
      <div className="form-grid"><Field name="panel" label="Nom du panel" placeholder="Ex. Rénovation Montpellier"/><Field name="period" label="Date ou période" placeholder="Ex. 3 octobre 2026"/><Field name="tool" label="Outil" placeholder="Ex. ChatGPT"/><Field name="interface" label="Interface exacte" placeholder="Ex. Application web sur ordinateur"/></div>
      <Field name="mode" label="Mode utilisé" value="unknown"><option value="unknown">Non renseigné</option><option value="web">Application avec recherche web</option><option value="api">API</option></Field><Field name="model" label="Modèle (si connu)"/><Field name="questions" label="Questions testées" textarea/>
      <div className="form-grid"><Field name="validResponses" label="Réponses valides" type="number" min={0}/><Field name="recommendations" label="Recommandations de l’entreprise" type="number" min={0}/><Field name="citations" label="Réponses citant directement le site" type="number" min={0}/></div>
      <p className="field-help">Une réponse compte au maximum une fois par mesure ; elle peut recommander et citer le site. Les erreurs techniques ne sont pas des réponses valides. Un champ vide reste inconnu.</p><Field name="notes" label="Notes et preuves" textarea/><Field name="proofUrl" label="Lien de preuve" placeholder="https://…"/>
    </ActionForm>
  </Modal>;
}
export function CompanyControls({company:c}:{company:Company}) {
  return <details className="panel secondary-details"><summary>Archivage et opposition<ChevronDown size={16}/></summary><div className="details-body controls-grid"><div><h3>{c.archived?'Entreprise archivée':'Archiver cette entreprise'}</h3><p className="muted small">La fiche et ses notes sont conservées. L’archivage est réversible.</p><ActionForm action={archiveAction.bind(null,c.id,!c.archived)} submit={c.archived?'Désarchiver':'Archiver'}><span className="sr-only"><Archive size={16}/></span></ActionForm></div>
    <div><h3>{c.oppositionActive?'Ne plus contacter':'Enregistrer une opposition'}</h3><p className="muted small">{c.oppositionActive?`Depuis le ${c.oppositionDate||'jour d’enregistrement'}. ${c.oppositionNote}`:'Annule les relances et bloque toute nouvelle action de contact.'}</p><ActionForm action={oppositionAction.bind(null,c.id,!c.oppositionActive)} submit={c.oppositionActive?'Réactiver explicitement le contact':'Marquer Ne plus contacter'} className="stack">
      {c.oppositionActive?<label className="check-label"><input type="checkbox" name="confirm" value="yes" required/>Je confirme la levée de l’opposition et la réactivation du contact.</label>:<Field name="note" label="Note d’opposition (facultative)" textarea/>}
    </ActionForm></div></div></details>;
}
export function SettingsForm({settings}:{settings:Settings}) {
  return <ActionForm action={saveSettingsAction} submit="Enregistrer la cible" className="stack"><div className="form-grid"><Field name="targetCity" label="Zone géographique" value={settings.targetCity}/><Field name="targetBusiness" label="Activité ciblée" value={settings.targetBusiness}/><Field name="targetCompanyType" label="Type d’entreprise" value={settings.targetCompanyType}/><Field name="targetOffer" label="Offre proposée" value={settings.targetOffer}/></div><Field name="targetExclusions" label="Exclusions" value={settings.targetExclusions} textarea/><p className="field-help">L’adéquation est confirmée manuellement pour cette cible. Un changement conserve les évaluations précédentes et demande leur revalidation.</p></ActionForm>;
}
function RestoreConfirmation({json,counts}:{json:string;counts:{companies:number;activities:number;aiTests:number;oppositions:number}}) {
  const [restore,restoreDispatch,restoring]=useActionState(restoreBackupAction,{});
  const router=useRouter();
  useEffect(()=>{if(restore.ok)router.refresh();},[restore,router]);
  if(restore.ok)return <Feedback state={restore}/>;
  return <form action={restoreDispatch} className="restore-preview stack"><h3>Aperçu du fichier</h3><p>{counts.companies} entreprise(s) · {counts.activities} activité(s) · {counts.aiTests} relevé(s) IA · {counts.oppositions} opposition(s)</p><input type="hidden" name="json" value={json}/><label className="check-label"><input type="checkbox" name="confirm" value="yes" required/>Je confirme le remplacement des données par cette sauvegarde.</label><button type="submit" className="button primary" disabled={restoring}>{restoring?'Restauration…':'Confirmer la restauration'}</button><Feedback state={restore}/></form>;
}
export function BackupForms() {
  const [preview,previewDispatch,pending]=useActionState(previewBackupAction,{});
  return <div className="stack"><a href="/api/backup" className="button primary download-button"><Download size={18}/>Télécharger une sauvegarde JSON</a><hr/>
    <h3>Restaurer une sauvegarde</h3><p className="muted">Le fichier est validé avant toute modification. Le remplacement conserve les oppositions actuelles et crée une sauvegarde préalable privée.</p>
    <form action={previewDispatch} className="stack"><label className="file-input">Fichier de sauvegarde JSON<input type="file" name="file" accept=".json,application/json" required/></label><button type="submit" className="button secondary" disabled={pending}><Upload size={16}/>{pending?'Validation…':'Vérifier le fichier'}</button><Feedback state={preview}/></form>
    {preview.preview&&preview.json&&<RestoreConfirmation key={preview.previewKey} json={preview.json} counts={preview.preview}/>}
  </div>;
}
