'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { aiResearchQuestions } from '@/lib/approach';
import type { Company } from '@/lib/types';

export function AiResearchPrompts({ company }: { company: Pick<Company, 'city' | 'business'> }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  const questions = aiResearchQuestions(company);
  async function copy() {
    try { await navigator.clipboard.writeText(questions.map((question, index) => `${index + 1}. ${question}`).join('\n\n')); setCopied(true); setError(''); }
    catch { setError('Copiez les questions directement dans le texte ci-dessous.'); }
  }
  return <div className="stack ai-research-prompts"><h3>Préparer un relevé de visibilité IA</h3>
    <p className="field-help">Utilisez ces questions dans ChatGPT, Claude ou un autre outil avec sa recherche web activée, dans des conversations séparées. Gardez les réponses, la date et l’interface utilisée, puis ajoutez le relevé ci-dessous. La recommandation et la citation du site sont deux mesures distinctes.</p>
    <ol className="small">{questions.map(question => <li key={question}>{question}</li>)}</ol>
    <button type="button" className="button secondary" onClick={copy}>{copied ? <Check size={15}/> : <Copy size={15}/>}{copied ? 'Questions copiées' : 'Copier les questions'}</button>
    {error && <p className="field-help" role="status">{error}</p>}
    <p className="field-help">Un angle d’approche sera proposé pour un panel sans recommandation lorsque le relevé contient les questions, les compteurs, la période, l’outil, l’interface et un lien de preuve.</p>
  </div>;
}
