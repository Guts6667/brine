import type { LearningModuleId } from './learning-types';

export interface LearningModule {
  id: LearningModuleId;
  title: string;
  goal: string;
  duration: string;
  principle: string;
  explanation: string;
  example: { title: string; text: string; takeaway: string };
  essentials: string[];
  apply: { title: string; action: string; done: string; screen: 'search' | 'qualification' | 'contact' };
}

export const LEARNING_MODULES: readonly LearningModule[] = [
  {
    id: 'cible', title: 'Choisir une cible précise', duration: '3 min',
    goal: 'Savoir quelles entreprises chercher et quelle aide proposer.',
    principle: 'Commence par une activité, une zone et une occasion d’aider.',
    explanation: 'Ton offre Pickles est déjà connue : sites, refontes, améliorations UX/UI et applications. Ta campagne précise à qui cette aide pourrait être utile. Tu n’as pas besoin de réécrire ton offre.',
    example: { title: 'Une recherche que tu peux vraiment lancer', text: 'Des entreprises de rénovation à Montpellier dont les réalisations sont difficiles à consulter sur mobile.', takeaway: 'L’activité et la zone orientent la recherche. Le problème reste une hypothèse à vérifier entreprise par entreprise.' },
    essentials: ['Une cible précise facilite le choix des entreprises à examiner.', 'Tu peux commencer petit et affiner après les premiers échanges.', 'Un secteur ou une petite entreprise ne prouve ni un problème, ni un budget.'],
    apply: { title: 'Définir la cible de ta campagne', action: 'Choisis une activité et une zone. La spécialisation de l’offre Pickles est facultative.', done: 'Tu peux expliquer qui tu cherches et ce que tu vas vérifier.', screen: 'search' },
  },
  {
    id: 'occasion', title: 'Repérer une occasion d’aider', duration: '4 min',
    goal: 'Distinguer un fait vérifié, une impression et une inconnue.',
    principle: 'Un bon motif de contact commence par une preuve.',
    explanation: 'Brine propose des constats. Tu regardes leur source et leur contexte avant de les confirmer. Un aspect ancien est une appréciation visuelle ; une image masquée à 390 px est une observation précise.',
    example: { title: 'Décrire plutôt que juger', text: 'Sur la page Réalisations, à 390 px, le bouton masque la photo avant/après. La capture pédagogique permet de le vérifier.', takeaway: 'Tu peux proposer d’améliorer la lecture de cette galerie. Tu ne peux pas affirmer combien de clients l’entreprise perd.' },
    essentials: ['Un constat indique ce qui a été vu, où, quand et sur quel appareil.', '« Aucun site trouvé » ne signifie pas « aucun site existe ».', 'Un contrôle impossible reste incomplet. Il n’apporte pas de conclusion négative.'],
    apply: { title: 'Vérifier un premier constat', action: 'Ouvre une entreprise, consulte une source puis confirme ou rejette un constat.', done: 'Tu peux décrire la preuve et les limites de ce que tu sais.', screen: 'qualification' },
  },
  {
    id: 'qualification', title: 'Qualifier et prioriser', duration: '5 min',
    goal: 'Comprendre les points et garder la main sur la décision.',
    principle: 'Vérifier un constat et attribuer des points sont deux décisions.',
    explanation: 'La grille existante comporte cinq critères. Confirmer une preuve n’ajoute aucun point. Accepter une réponse suffisamment justifiée valide les points de ce critère. Une inconnue reste à vérifier, pas à zéro.',
    example: { title: 'Une qualification peut rester en cours', text: 'Cible validée : 20 points. Un problème concret vérifié : 15 points. Les trois autres critères restent inconnus.', takeaway: '35/100 points confirmés · 2/5 critères validés. Le score final et sa priorité attendent les cinq critères.' },
    essentials: ['Le total est sur 100 : cible 20, problème 30, déclencheur 20, réalisations 15, interlocuteur 15.', 'La priorité est haute dès 70 et intermédiaire dès 50, lorsque la grille est complète.', 'Valider le prospect reste ton choix. Le score ne prouve pas une intention d’achat.'],
    apply: { title: 'Renseigner la grille existante', action: 'Relis les propositions de critères, accepte ou modifie leurs réponses, puis choisis de valider, reporter ou écarter le prospect.', done: 'Tu sais quels points sont confirmés et quelles informations manquent.', screen: 'qualification' },
  },
  {
    id: 'email', title: 'Écrire un premier email utile', duration: '5 min',
    goal: 'Préparer un message court, personnel et facile à traiter.',
    principle: 'Une preuve, une aide proportionnée, une question simple.',
    explanation: 'Présente-toi brièvement. Décris un constat confirmé avec respect. Propose une aide limitée à ce constat, puis pose une question à laquelle il est facile de répondre. Ton premier email ouvre une conversation.',
    example: { title: 'Une ouverture fondée sur le rapport', text: 'Bonjour, je suis Rayan de Pickles Studio. Sur votre page Réalisations, j’ai remarqué que le bouton masque une photo avant/après sur mobile. Je peux vous partager deux pistes pour rendre cette galerie plus lisible. Est-ce vous qui vous occupez du site ?', takeaway: 'Le message reste précis et laisse une réponse facile. Une refonte complète n’est pas présumée nécessaire.' },
    essentials: ['120 mots maximum : une contrainte de lisibilité, pas une garantie de réponse.', 'Le bilan PDF est facultatif : deux pages utiles, préparées à ta demande.', 'L’appel est une alternative : te présenter, décrire le constat, demander si le sujet est pertinent.'],
    apply: { title: 'Préparer ton email', action: 'Choisis un prospect validé et un constat confirmé. Relis le brouillon avant de le copier pour un envoi manuel.', done: 'Tu peux expliquer la preuve, l’aide proposée et la question finale.', screen: 'contact' },
  },
  {
    id: 'suivi', title: 'Enregistrer le contact et choisir la suite', duration: '4 min',
    goal: 'Faire une relance utile et savoir quand s’arrêter.',
    principle: 'Le suivi commence après un contact réellement effectué.',
    explanation: 'Copier un email ou télécharger un PDF ne signifie pas l’avoir envoyé. Après l’envoi manuel, enregistre le contact dans Brine. Les propositions J+5 et J+12 se calculent alors à partir de sa date.',
    example: { title: 'L’absence de réponse ne vaut pas accord', text: 'Un premier email envoyé le 5 octobre propose une relance le 10 puis le 17 octobre. Ces dates sont des suggestions à vérifier avant chaque contact.', takeaway: 'Une réponse, un refus ou une opposition interrompt la séquence. Une opposition signifie ne plus contacter.' },
    essentials: ['J0 est la date du premier contact enregistré, pas celle de la copie du texte.', 'Avant une relance, vérifie les réponses et apporte une suite utile.', 'Après une réponse, choisis une prochaine étape avec l’interlocuteur ; ne poursuis pas la séquence automatique.'],
    apply: { title: 'Enregistrer le résultat réel', action: 'Après un contact manuel, renseigne sa date et son résultat. Choisis la suite correspondant à ce résultat.', done: 'Le journal décrit ce qui a eu lieu et la prochaine action respecte la réponse.', screen: 'contact' },
  },
  {
    id: 'echange', title: 'Transformer une réponse en échange utile', duration: '5 min',
    goal: 'Écouter le besoin et convenir d’une prochaine étape.',
    principle: 'Fais préciser le besoin avant de proposer la solution.',
    explanation: 'Pose des questions ouvertes, écoute puis reformule. Un intérêt pour tes pistes ne confirme pas un projet de refonte. Note les propos réellement exprimés, les inconnues et la prochaine étape acceptée.',
    example: { title: 'Vérifier ce que l’autre souhaite', text: '« Les clients nous disent que la galerie est difficile à lire sur téléphone. Je gère le site. Envoyez-moi vos deux pistes, je les lirai vendredi. »', takeaway: 'Le besoin porte sur la galerie. Une amélioration ciblée et l’envoi de deux pistes sont pertinents. Le budget reste inconnu.' },
    essentials: ['« Comment vos clients utilisent-ils cette page ? » invite à comprendre.', 'Besoin confirmé, intervention pertinente, décision et prochaine étape se documentent séparément.', 'Le passage en Opportunité qualifiée reste une action explicite, après vérification des informations.'],
    apply: { title: 'Compléter les informations après échange', action: 'Note le besoin exprimé, l’intervention pertinente, le chemin de décision et la prochaine étape acceptée.', done: 'Tu peux distinguer les propos confirmés des informations encore inconnues.', screen: 'contact' },
  },
];

export const LEARNING_STEPS = [
  { id: 'understand', label: 'Comprendre' }, { id: 'example', label: 'Voir un exemple' },
  { id: 'practice', label: 'Essayer' }, { id: 'feedback', label: 'Faire le point' }, { id: 'apply', label: 'Appliquer' },
] as const;

export function learningModule(id: string) { return LEARNING_MODULES.find(module => module.id === id); }

export function learningCampaignHref(moduleId: LearningModuleId, campaignId: string) {
  const module = learningModule(moduleId)!;
  const base = `/campagnes/${encodeURIComponent(campaignId)}`;
  return module.apply.screen === 'qualification' ? `${base}/qualification?guide=${moduleId}`
    : `${base}?etape=${module.apply.screen === 'search' ? 'rechercher' : moduleId === 'suivi' || moduleId === 'echange' ? 'suivre' : 'preparer'}&guide=${moduleId}`;
}
