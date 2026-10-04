import type { AiTest, Company } from './types';

export function aiResearchQuestions(company: Pick<Company, 'business' | 'city'>): string[] {
  const business = company.business || '[activité à préciser]', city = company.city || '[ville à préciser]';
  return [
    `Quelles entreprises recommanderais-tu pour ${business} à ${city} ? Donne tes sources et les sites officiels.`,
    `Je cherche une entreprise pour ${business} à ${city}. Quelles options locales comparer et pourquoi ? Cite les sources consultées.`,
    `Comment trouver un professionnel de ${business} à ${city} ? Propose plusieurs entreprises locales avec des liens vers leurs sites.`,
  ];
}

/** Describe only a recorded, bounded panel with a saved proof. Never infer global absence. */
export function aiApproach(company: Pick<Company, 'name'>, test: AiTest): string | null {
  if (!test.validResponses || test.validResponses < 1 || test.recommendations !== 0 || !test.questions.trim() ||
    !test.proofUrl || !test.tool.trim() || !test.interface.trim() || !test.period.trim() || test.mode === 'unknown') return null;
  const count = test.validResponses;
  return `Lors d’un relevé de ${count} réponse${count > 1 ? 's' : ''} à des questions de recherche d’entreprise dans ${test.tool} (${test.interface}, ${test.period}), je n’ai relevé aucune recommandation de ${company.name}. Cela décrit ce panel précis. Je peux vous partager les questions et les réponses pour examiner ensemble les informations disponibles sur votre entreprise.`;
}
