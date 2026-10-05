import {requireAuthenticated} from '@/lib/auth';
import {getCampaignRepository} from '@/lib/campaign-runtime';
import {LearningHome} from '@/components/learning-home';
export default async function LearningHomePage(){await requireAuthenticated();const repo=await getCampaignRepository(),[progress,campaigns]=await Promise.all([repo.getLearningProgress(),repo.listCampaigns()]);return <LearningHome progress={progress} campaigns={campaigns.filter(c=>c.status!=='archived')}/>;}
