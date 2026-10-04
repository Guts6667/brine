import Link from 'next/link';
import { WorkflowSteps } from '@/components/workflow-steps';
import { ProspectReview } from '@/components/prospect-review';
import { VisualObservationForm } from '@/components/visual-observation-form';
import { CampaignMutation, RunRefresh } from '@/components/campaign-forms';
import { CampaignOfferForm } from '@/components/campaign-offer-form';
import { buildProspectReport, listCandidateContacts } from '@/lib/research-report';
import { buildProspectInsights } from '@/lib/prospect-insights';
import { getEligibleApproachEvidence } from '@/lib/contact-preparation';
import { requireAuthenticated } from '@/lib/auth';
import { getCampaignRepository } from '@/lib/campaign-runtime';
import { linkCandidateCompanyAction } from '@/app/v2-actions';
import { confirmWebsiteAction, controlRunAction, removeCandidateParticipationAction, restoreCandidateParticipationAction } from '@/app/campaign-actions';

const labels: Record<string, string> = { queued: 'En attente d’analyse', processing: 'Analyse en cours', needs_site: 'Site à confirmer', review: 'À examiner', accepted: 'Retenue', rejected: 'Écartée', verify: 'Plus tard' };
const runLabels: Record<string, string> = { queued: 'En attente', running: 'Analyse en cours', paused: 'En pause', completed: 'Analyse terminée', failed: 'Recherche interrompue', cancelled: 'Recherche annulée' };
const reviewStatuses = ['review', 'needs_site', 'queued', 'processing'];
const confirmationMessages: Record<string, string> = { accept: 'Entreprise gardée dans la campagne. Retrouvez-la dans Retenues pour préparer le contact.', verify: 'Entreprise mise de côté. Vous la retrouverez dans À compléter.', reject: 'Résultat écarté. Vous pouvez retrouver son dossier dans Écartées.' };

export default async function RunPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filtre?: string; candidat?: string; decision?: string }>;
}) {
  await requireAuthenticated();
  const { id } = await params;
  const { filtre = 'review', candidat, decision } = await searchParams;
  const repo = await getCampaignRepository();
  const [run, all] = await Promise.all([repo.getRun(id), repo.listCandidates(id)]);
  const [campaign, profile, knownCompanies] = await Promise.all([repo.getCampaign(run.campaignId), repo.getProviderProfile(), repo.listCompanies(run.campaignId)]);
  const dossiers = new Map(await Promise.all(all.map(async candidate => {
    const collected = buildProspectReport(candidate, campaign);
    const report = candidate.companyId ? await repo.getCandidateReport(candidate.id) : collected;
    const collectedIds = new Set(collected.facts.map(fact => fact.id));
    const eligibleIds = getEligibleApproachEvidence(report, campaign, profile).filter(fact => collectedIds.has(fact.id)).map(fact => fact.id);
    const insights = buildProspectInsights(report, campaign, profile, { name: candidate.company.name, business: candidate.company.business, city: candidate.company.city, website: candidate.website });
    return [candidate.id, { report, insights, eligibleIds }] as const;
  })));
  const priority = (candidateId: string) => {
    const first = dossiers.get(candidateId)?.insights.highlights[0];
    return first?.priority === 'high' ? 0 : first?.priority === 'medium' ? 1 : 2;
  };
  const rows = all.filter(candidate => filtre === 'all' || (filtre === 'review' ? reviewStatuses.includes(candidate.status) : filtre === 'complete' ? ['needs_site', 'verify'].includes(candidate.status) : candidate.status === filtre))
    .sort((a, b) => priority(a.id) - priority(b.id));
  const selected = rows.find(candidate => candidate.id === candidat) || rows[0];
  const active = ['queued', 'running'].includes(run.status);
  const processedCount = all.filter(candidate => !['queued', 'processing'].includes(candidate.status)).length;
  const selectedCompany = selected?.companyId ? knownCompanies.find(company => company.id === selected.companyId) : undefined;
  const dossier = selected ? dossiers.get(selected.id) : undefined;
  const contacts = selected ? listCandidateContacts(selected) : [];
  const selectedIds = selected && selectedCompany ? selectedCompany.findingIds.filter(factId => factId.startsWith(selected.id + ':')).map(factId => factId.slice(selected.id.length + 1)) : [];
  const selectedContactIndexes = contacts.flatMap((contact, index) => selectedCompany ? selectedCompany.contact[contact.kind] === contact.value ? [index] : [] : ['email', 'phone'].includes(contact.kind) && contacts.findIndex(item => item.kind === contact.kind) === index ? [index] : []);
  const warnings = selected ? [...new Set([selected.htmlError && 'Analyse du site : ' + selected.htmlError, selected.mobileError && 'Test mobile : ' + selected.mobileError, ...(selected.html?.warnings || []), ...(selected.mobile?.warnings || [])].filter(Boolean))] : [];
  const filters = [['review', 'À examiner'], ['complete', 'À compléter'], ['accepted', 'Retenues'], ['rejected', 'Écartées'], ['all', 'Toutes']];

  return <>
    <Link href={`/campagnes/${run.campaignId}?etape=rechercher`} className="back-link">← {campaign.name}</Link>
    <div className="page-heading"><div><p className="eyebrow">{run.target.targetBusiness} · {run.target.targetCity}</p><h1>Examiner les entreprises</h1><p className="page-subtitle">{runLabels[run.status]} · {processedCount}/{active && !all.length ? run.limit : all.length} entreprises traitées</p></div><RunRefresh active={active} /></div>
    <WorkflowSteps campaignId={run.campaignId} active="examiner" runId={id} />
    <section className="review-run-status">
      <p role="status" aria-live="polite">{active ? 'L’analyse continue. Vous pouvez déjà examiner les dossiers disponibles.' : run.status === 'failed' ? 'Les résultats déjà collectés sont disponibles. Reprends la recherche pour continuer.' : 'Examinez un constat utile, puis décidez de garder cette entreprise, d’y revenir plus tard ou de l’écarter.'}</p>
      {run.status === 'failed' && <CampaignMutation action={controlRunAction} submit="Reprendre la recherche" secondary><input type="hidden" name="runId" value={id} /><input type="hidden" name="operation" value="resume" /></CampaignMutation>}
      {(run.error || !['completed', 'cancelled'].includes(run.status)) && <details><summary>Progression et gestion de la recherche</summary><div className="details-body">{active && <p className="field-help">Le traitement continue même si vous fermez cette page.</p>}{run.error && <p className="field-help">{run.error}</p>}<div className="campaign-controls">{active && <CampaignMutation action={controlRunAction} submit="Suspendre le lot" secondary><input type="hidden" name="runId" value={id} /><input type="hidden" name="operation" value="pause" /></CampaignMutation>}{['paused', 'queued'].includes(run.status) && <CampaignMutation action={controlRunAction} submit={run.status === 'queued' ? 'Relancer la prise en charge' : 'Reprendre le lot'} secondary><input type="hidden" name="runId" value={id} /><input type="hidden" name="operation" value="resume" /></CampaignMutation>}{!['completed', 'cancelled'].includes(run.status) && <CampaignMutation action={controlRunAction} submit="Annuler le lot" secondary><input type="hidden" name="runId" value={id} /><input type="hidden" name="operation" value="cancel" /></CampaignMutation>}</div></div></details>}
    </section>
    {decision && confirmationMessages[decision] && <div className="review-decision-confirmation" role="status"><p>{confirmationMessages[decision]}</p>{decision === 'accept' && <Link href={`/campagnes/lots/${id}?filtre=accepted`}>Voir les entreprises retenues →</Link>}</div>}
    {!active && !all.length && <p className="inline-empty">Aucune nouvelle entreprise trouvée dans les limites de cette recherche. Les entreprises déjà présentes dans la campagne ou ayant une opposition sont exclues.</p>}
    <nav className="filter-tabs" aria-label="Filtrer les résultats">{filters.map(([key, label]) => <Link key={key} href={`/campagnes/lots/${id}?filtre=${key}`} className={filtre === key ? 'selected' : ''} aria-current={filtre === key ? 'page' : undefined}>{label}</Link>)}</nav>
    <div className={`review-layout prospect-review-layout ${candidat ? 'review-has-selection' : ''}`}>
      <aside className="review-list" aria-label="Entreprises du lot">{rows.length ? rows.map(candidate => {
        const first = dossiers.get(candidate.id)?.insights.highlights[0];
        const archived = knownCompanies.some(company => company.id === candidate.companyId && company.archived);
        return <Link scroll={false} key={candidate.id} href={`/campagnes/lots/${id}?filtre=${filtre}&candidat=${candidate.id}`} className={`panel review-list-item ${candidate.id === selected?.id ? 'selected' : ''}`} aria-current={candidate.id === selected?.id ? 'page' : undefined}><strong>{candidate.company.name}</strong><span className="small muted">{candidate.company.city} · {candidate.company.business}</span>{!['queued', 'processing'].includes(candidate.status) && first && first.priority !== 'context' && <span className="review-list-insight">{first.title}</span>}<span className="badge">{archived ? 'Retirée de cette campagne' : labels[candidate.status]}</span></Link>;
      }) : <p className="inline-empty">{active ? 'Les premiers résultats apparaîtront ici.' : 'Aucun résultat dans ce filtre.'}</p>}</aside>
      {selected && dossier && <section className="panel section-panel review-detail" key={selected.id}>
        <Link href={`/campagnes/lots/${id}?filtre=${filtre}`} className="back-link review-mobile-back">← Revenir à la liste</Link>
        <div className="review-company-heading"><div><h2>{dossier.insights.identity.name}</h2><p>{dossier.insights.identity.activity} · {dossier.insights.identity.location}</p></div><span className="badge">{selectedCompany?.archived ? 'Retirée de cette campagne' : labels[selected.status]}</span></div>
        {['queued', 'processing'].includes(selected.status) && <p className="review-status-note" role="status">Ce dossier est en cours d’analyse. Les constats et la décision seront disponibles à la fin.</p>}
        {selected.status === 'needs_site' && <details className="review-site-control" open><summary>Le site reste à confirmer</summary><div className="details-body"><CampaignMutation action={confirmWebsiteAction} submit="Confirmer le site et analyser" secondary><input type="hidden" name="candidateId" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><div className="field"><label htmlFor="candidate-website">Site officiel</label><input name="website" id="candidate-website" type="url" required defaultValue={selected.website || selected.websites[0]?.url || ''} placeholder="https://…" /></div><p className="field-help">Vérifiez que le site correspond bien à cette entreprise. Un site non trouvé ne prouve pas qu’elle n’en a pas.</p></CampaignMutation></div></details>}
        <ProspectReview candidateId={selected.id} revision={selected.revision} report={dossier.report} insights={dossier.insights} contacts={contacts} selectedIds={selectedIds} selectedContactIndexes={selectedContactIndexes} eligibleIds={dossier.eligibleIds} initialApproach={selectedCompany?.approach || ''} campaignId={run.campaignId} prepareHref={selected.companyId ? `/campagnes/${run.campaignId}?etape=preparer&prospect=${selected.companyId}` : undefined} companyHref={selectedCompany ? `/prospects/${selectedCompany.id}?campagne=${run.campaignId}` : undefined} savedContactValues={selectedCompany?.contact} retained={selected.status === 'accepted'} archived={Boolean(selectedCompany?.archived)} canReview={!['queued', 'processing'].includes(selected.status)} offerEditor={<CampaignOfferForm campaign={campaign} />} visualObservation={<VisualObservationForm candidateId={selected.id} revision={selected.revision} pageUrl={selected.website} />} />
        <details className="review-secondary-detail"><summary>Origine de l’entreprise et site identifié</summary><div className="details-body"><p><a href={selected.company.sourceUrl} target="_blank" rel="noopener noreferrer">Voir la source de l’entreprise ↗</a></p>{selected.website && <p><a href={selected.website} target="_blank" rel="noopener noreferrer">{selected.website}</a></p>}{selected.websites.filter(proposal => proposal.url !== selected.website).map(proposal => <p key={proposal.url}><a href={proposal.url} target="_blank" rel="noopener noreferrer">{proposal.url}</a> · {proposal.confidence === 'exact' ? 'SIRET correspondant' : 'À confirmer'} · <a href={proposal.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a></p>)}{!['accepted', 'rejected', 'processing', 'queued', 'needs_site'].includes(selected.status) && <CampaignMutation action={confirmWebsiteAction} submit="Confirmer le site et analyser" secondary><input type="hidden" name="candidateId" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><div className="field"><label htmlFor="correct-candidate-website">Corriger ou renseigner le site officiel</label><input name="website" id="correct-candidate-website" type="url" required defaultValue={selected.website || selected.websites[0]?.url || ''} placeholder="https://…" /></div><p className="field-help">La nouvelle analyse conserve les informations du dossier.</p></CampaignMutation>}</div></details>
        {warnings.length > 0 && <details className="review-secondary-detail"><summary>Analyses incomplètes et limites ({warnings.length})</summary><div className="details-body">{warnings.map((warning, index) => <p className="field-help" key={index}>{warning}</p>)}</div></details>}
        {!selected.companyId && knownCompanies.length > 0 && <details className="review-secondary-detail"><summary>Cette entreprise est déjà dans mes fiches</summary><div className="details-body"><CampaignMutation action={linkCandidateCompanyAction} submit="Confirmer l’identité commune" secondary><input type="hidden" name="candidateId" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><div className="field"><label htmlFor="identity-company">Entreprise correspondante</label><select name="companyId" id="identity-company" required defaultValue=""><option value="" disabled>Choisir la fiche vérifiée</option>{knownCompanies.map(company => <option key={company.id} value={company.id}>{company.name} · {company.city}</option>)}</select></div><p className="field-help">Confirmez uniquement après vérification. Un nom, une ville ou un domaine semblable ne suffisent pas.</p></CampaignMutation></div></details>}
        {selectedCompany && (selected.status === 'accepted' || selectedCompany.archived) && <details className="review-secondary-detail"><summary>{selectedCompany.archived ? 'Réintégrer ce prospect' : 'Retirer le prospect de cette campagne'}</summary><div className="details-body"><CampaignMutation action={selectedCompany.archived ? restoreCandidateParticipationAction : removeCandidateParticipationAction} submit={selectedCompany.archived ? 'Réintégrer dans cette campagne' : 'Retirer de cette campagne'} secondary><input type="hidden" name="candidateId" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><input type="hidden" name="participationRevision" value={selectedCompany.participationRevision} />{selectedCompany.archived ? <p className="field-help">Ce prospect a été retiré du suivi. Sa fiche, les preuves et l’historique restent disponibles.</p> : <label className="check-label"><input type="checkbox" name="confirmed" value="yes" required />Je retire ce prospect de cette campagne, en conservant son historique.</label>}</CampaignMutation></div></details>}
      </section>}
    </div>
    {!active && all.length > 0 && rows.length === 0 && (knownCompanies.some(company => !company.archived && !company.oppositionActive) ? <Link className="button primary" href={`/campagnes/${run.campaignId}?etape=preparer`}>Passer à la préparation des contacts →</Link> : <Link className="button secondary" href={`/campagnes/lots/${id}?filtre=all`}>Revoir tous les résultats →</Link>)}
  </>;
}
