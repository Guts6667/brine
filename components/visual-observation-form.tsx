'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown } from 'lucide-react';
import { saveVisualObservationAction } from '@/app/v2-actions';
import type { ActionState } from '@/lib/types';

const categories = [
  ['overlap', 'Un élément en masque un autre'], ['overflow', 'Un élément déborde de l’écran'],
  ['unreadable', 'Un texte est difficile à lire'], ['broken_image', 'Une image ne s’affiche pas'],
  ['interaction', 'Une commande ne fonctionne pas comme prévu'], ['other', 'Autre constat visible'],
] as const;
const localDate = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
type Draft = { pageUrl: string; element: string; observation: string; category: string; device: string; observedOn: string };

/** Preserve the captured content; only size and JPEG encoding change to keep private backups small. */
async function encodeCapture(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choisissez une capture PNG, JPEG ou WebP de moins de 8 Mo.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('Cette capture est trop grande. Choisissez la zone concernée.');
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw new Error('Cette capture ne peut pas être préparée dans ce navigateur.');
    for (const edge of [1400, 1200, 1000, 800]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.74, 0.64]) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (Math.ceil((data.length - 'data:image/jpeg;base64,'.length) * 3 / 4) <= 100 * 1024) return data;
      }
    }
    throw new Error('La capture reste trop lourde. Choisissez une zone plus courte pour conserver une preuve lisible.');
  } finally { bitmap.close(); }
}

export function VisualObservationForm({ candidateId, revision, pageUrl }: { candidateId: string; revision: number; pageUrl: string }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(saveVisualObservationAction, {});
  const key = 'brine:visual:' + candidateId, prefix = 'visual-' + candidateId;
  const [draft, setDraft] = useState<Draft>({ pageUrl, element: '', observation: '', category: 'overlap', device: 'desktop', observedOn: localDate() });
  const [ready, setReady] = useState(false), [capture, setCapture] = useState(''), [captureError, setCaptureError] = useState(''), [encoding, setEncoding] = useState(false);
  const input = useRef<HTMLInputElement>(null), captureVersion = useRef(0), acknowledged = useRef<ActionState | null>(null);
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved && Object.keys(draft).every(name => typeof saved[name] === 'string')) setDraft(saved); } catch { /* A private browser can refuse draft storage. */ }
    setReady(true);
    // The parent keys this form by candidate identity; a revision refresh must not replace an unfinished note.
  }, [key]);
  useEffect(() => { if (ready) try { if (draft.element || draft.observation) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); } catch { /* The form remains usable. */ } }, [draft, key, ready]);
  useEffect(() => {
    if (!state.ok || acknowledged.current === state) return;
    acknowledged.current = state; captureVersion.current++;
    setDraft(value => ({ ...value, element: '', observation: '' })); setCapture(''); setCaptureError('');
    if (input.current) input.current.value = '';
    try { localStorage.removeItem(key); } catch { /* Saving the server observation still succeeded. */ }
  }, [state, key]);
  const field = (name: keyof Draft, value: string) => setDraft(old => ({ ...old, [name]: value }));

  return <details className="visual-observation print-hidden" data-testid="visual-observation-form">
    <summary><Camera size={17} aria-hidden="true" /><span>Ajouter un constat visuel</span><ChevronDown size={17} aria-hidden="true" /></summary>
    <form action={dispatch} className="stack visual-observation-body" aria-busy={pending || encoding} onReset={event => event.preventDefault()}>
      <p className="field-help">Un élément masque une photo ou gêne une lecture ? Décrivez ce que vous voyez, sur quelle page et sur quel écran. La capture reste dans votre dossier privé.</p>
      <input type="hidden" name="candidateId" value={candidateId} /><input type="hidden" name="revision" value={revision} />
      {capture && <input type="hidden" name="screenshot" value={capture} />}
      <div className="field"><label htmlFor={prefix + '-page'}>Page observée</label><input id={prefix + '-page'} name="pageUrl" type="url" maxLength={2048} required value={draft.pageUrl} onChange={event => field('pageUrl', event.target.value)} placeholder="https://…" /></div>
      <div className="field"><label htmlFor={prefix + '-element'}>Élément concerné</label><input id={prefix + '-element'} name="element" maxLength={300} required value={draft.element} onChange={event => field('element', event.target.value)} placeholder="Ex. Cartes Avant / après, bouton Comparer" /></div>
      <div className="field"><label htmlFor={prefix + '-observation'}>Ce que vous observez</label><textarea id={prefix + '-observation'} name="observation" maxLength={3000} required value={draft.observation} onChange={event => field('observation', event.target.value)} placeholder="Ex. Le bouton forme un grand ovale sombre qui masque une partie de chaque photo." /></div>
      <div className="form-grid"><div className="field"><label htmlFor={prefix + '-category'}>Type de constat</label><select id={prefix + '-category'} name="category" value={draft.category} onChange={event => field('category', event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor={prefix + '-device'}>Écran observé</label><select id={prefix + '-device'} name="device" value={draft.device} onChange={event => field('device', event.target.value)}><option value="desktop">Ordinateur</option><option value="mobile">Téléphone</option></select></div></div>
      <div className="field"><label htmlFor={prefix + '-date'}>Date de l’observation</label><input id={prefix + '-date'} name="observedOn" type="date" required max={localDate()} value={draft.observedOn} onChange={event => field('observedOn', event.target.value)} /></div>
      <details><summary>Préciser la taille de l’écran (facultatif)</summary><div className="form-grid"><div className="field"><label htmlFor={prefix + '-width'}>Largeur de l’écran en pixels</label><input id={prefix + '-width'} name="viewportWidth" type="number" min={240} max={10000} /></div><div className="field"><label htmlFor={prefix + '-height'}>Hauteur de l’écran en pixels</label><input id={prefix + '-height'} name="viewportHeight" type="number" min={240} max={10000} /></div></div></details>
      <div className="field"><label htmlFor={prefix + '-capture'}>Capture de preuve (facultatif)</label><input ref={input} id={prefix + '-capture'} type="file" accept="image/png,image/jpeg,image/webp" disabled={pending} onChange={async event => {
        const file = event.target.files?.[0], version = ++captureVersion.current; setCapture(''); setCaptureError('');
        if (!file) { setEncoding(false); return; }
        setEncoding(true);
        try { const data = await encodeCapture(file); if (version === captureVersion.current) setCapture(data); }
        catch (error) { if (version === captureVersion.current) setCaptureError(error instanceof Error ? error.message : 'Capture illisible.'); }
        finally { if (version === captureVersion.current) setEncoding(false); }
      }} /><span className="field-help">Une version allégée est conservée. Vérifiez la lisibilité de la preuve avant de l’enregistrer.</span></div>
      {capture && <figure className="visual-capture-preview"><img src={capture} alt="Capture de preuve à vérifier avant enregistrement" /><figcaption>Cette capture sera conservée avec le constat et dans l’export complet.</figcaption><button className="button text-button small-button" type="button" onClick={() => { captureVersion.current++; setCapture(''); if (input.current) input.current.value = ''; }}>Retirer la capture</button></figure>}
      {encoding && <p role="status" className="field-help">Préparation de la capture…</p>}{captureError && <p role="alert" className="form-error">{captureError}</p>}
      <button className="button secondary" type="submit" disabled={pending || encoding || !!captureError}>{pending ? 'Enregistrement…' : 'Enregistrer ce constat'}</button>
      {state.error && <p role="alert" className="form-error">{state.error}</p>}{state.message && <p role="status" className="form-success">{state.message}</p>}
    </form>
  </details>;
}
