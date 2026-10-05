import {notFound} from 'next/navigation';
import {requireAuthenticated} from '@/lib/auth';
import {getCampaignRepository} from '@/lib/campaign-runtime';
import {learningModuleIdSchema} from '@/lib/learning-schema';
import {LearningModule} from '@/components/learning-module';
export default async function LearningModulePage({params}:{params:Promise<{module:string}>}){await requireAuthenticated();const {module}=await params,id=learningModuleIdSchema.safeParse(module);if(!id.success)notFound();const repo=await getCampaignRepository(),[progress,campaigns]=await Promise.all([repo.getLearningProgress(),repo.listCampaigns()]);return <LearningModule key={id.data} moduleId={id.data} progress={progress} campaigns={campaigns.filter(c=>c.status!=='archived')}/>;}
