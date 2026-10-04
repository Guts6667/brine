'use client';
import { useActionState } from 'react';
import { saveCampaignOfferAction } from '@/app/campaign-actions';
import type { Campaign } from '@/lib/campaign-types';

export function CampaignOfferForm({ campaign }: { campaign: Campaign }) {
  const [state, dispatch, pending] = useActionState(saveCampaignOfferAction, {});
  return <form action={dispatch} className="stack" onReset={event => event.preventDefault()} aria-busy={pending}>
    <input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="revision" value={campaign.revision} />
    <div className="field"><label htmlFor={'review-offer-' + campaign.id}>Ce que je propose dans cette campagne</label><textarea id={'review-offer-' + campaign.id} name="targetOffer" maxLength={1000} required defaultValue={campaign.targetOffer || ''} placeholder="Vos prestations et les améliorations que vous pouvez réellement réaliser." /><p className="field-help">Cette offre permet de relier les constats à une aide adaptée. Elle s’applique aux prospects de cette campagne.</p></div>
    <button className="button secondary" type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer mon offre'}</button>
    {state.error && <p role="alert" className="form-error">{state.error}</p>}{state.message && <p role="status" className="form-success">{state.message}</p>}
  </form>;
}
