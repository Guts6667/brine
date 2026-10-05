import { clientBriefSchema, type ClientBrief } from './client-brief-schema';
import { picklesProviderProfile } from './provider-profile';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const LEARNING_EXAMPLE_ASSET_ID = 'f746e76544c39212194a2fa245ff636a69151979078d7f249f65107b47ecc918';
export async function loadLearningExampleAsset(id: string): Promise<Uint8Array | null> {
  if (id !== LEARNING_EXAMPLE_ASSET_ID) return null;
  const bytes = await readFile(join(process.cwd(), 'public/learning/atelier-sillage-detail.png'));
  if (createHash('sha256').update(bytes).digest('hex') !== id) throw new Error('L’illustration pédagogique doit être actualisée.');
  return bytes;
}

/** A fixed fictional exercise, independent of prospects, providers and storage. */
export function learningExampleBrief(): ClientBrief {
  return clientBriefSchema.parse({
    version: 1, template: 'pickles-client-v1', id: 'learning-only-example',
    campaignId: 'learning-only', companyId: 'learning-only-sillage',
    createdAt: '2026-10-05T12:00:00Z', profile: picklesProviderProfile(),
    companyName: 'Atelier Sillage · EXEMPLE FICTIF', website: '', targetRevision: 1,
    situation: 'Exemple pédagogique, à ne pas envoyer. Atelier Sillage est une entreprise fictive de rénovation à Montpellier. Ce document montre comment relier un constat précis à une aide proportionnée, sans annoncer de pertes de clients ni présumer un besoin de refonte.',
    positives: 'Dans le scénario, deux réalisations sont présentées : une cuisine et une salle de bain. Une adresse de contact générique est indiquée. Le décideur et le budget restent inconnus.',
    points: [{
      fact: { id: 'learning-only-defect', section: 'site', kind: 'observed', sentiment: 'issue',
        text: 'Dans la capture pédagogique à 390 px, le bouton Contact recouvre une photo avant/après.',
        sourceIds: ['learning-only-source'], observedOn: '2026-10-05',
        scope: 'Scénario fictif : aucun site réel n’a été consulté ni audité.',
        visual: { category: 'overlap', device: 'mobile', element: 'Bouton Contact · illustration pédagogique',
          pageUrl: 'https://atelier-sillage.example/scenario-pedagogique',
          viewport: { width: 390, height: 844 }, assetId: LEARNING_EXAMPLE_ASSET_ID },
      },
      text: 'Dans le scénario mobile, le bouton Contact masque le bas d’une photo de réalisation.',
      effect: 'Cette superposition peut gêner la lecture de la photo dans ce contexte. Ses conséquences sur les demandes ne sont pas mesurées.',
      help: 'Examiner la position du bouton et rendre la galerie lisible en conservant le site actuel.',
    }],
    actions: [
      'EXEMPLE PÉDAGOGIQUE FICTIF · Ne pas envoyer à une entreprise. Les constats et coordonnées de cet exercice sont inventés pour apprendre.',
      'Dans une situation réelle : vérifier le défaut dans son contexte, demander comment la galerie est utilisée, puis proposer une correction ciblée si elle répond au besoin exprimé.',
    ],
    invitation: 'Question de démonstration : « Est-ce vous qui vous occupez du site ? Puis-je vous partager deux pistes pour rendre cette galerie plus lisible ? » Aucun échange ni contact réel n’est enregistré.',
    sources: [{ id: 'learning-only-source', provider: 'manual',
      url: 'https://atelier-sillage.example/scenario-pedagogique',
      title: 'Source pédagogique fictive · aucune vérification réelle',
      excerpt: 'Exercice uniquement. Domaine .example sans entreprise réelle.', collectedAt: '2026-10-05',
    }],
    comparison: null, fingerprint: '0'.repeat(64), reviewed: true,
  });
}
