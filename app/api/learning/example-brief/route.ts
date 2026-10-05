import { requireAuthenticated } from '@/lib/auth';
import { learningExampleBrief, loadLearningExampleAsset } from '@/lib/learning-example-brief';
import { renderClientBriefPdf } from '@/lib/client-brief-pdf';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  await requireAuthenticated();
  const bytes = await renderClientBriefPdf(learningExampleBrief(), loadLearningExampleAsset, { pedagogical: true });
  return new Response(bytes as BodyInit, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="brine-exemple-pedagogique-fictif.pdf"',
    'Cache-Control': 'private, no-store',
    'X-Brine-Learning-Example': 'fictional',
  } });
}
