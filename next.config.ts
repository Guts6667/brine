import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  devIndicators: false,
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingIncludes: { '/api/client-briefs/**/*': ['./public/pickles-logo.png','./node_modules/@fontsource/inter/files/inter-latin-{400,600}-normal.woff'], '/api/learning/**/*': ['./public/pickles-logo.png','./public/learning/atelier-sillage-detail.png','./node_modules/@fontsource/inter/files/inter-latin-{400,600}-normal.woff'], '/campagnes/**/*': ['./public/pickles-logo.png','./node_modules/@fontsource/inter/files/inter-latin-{400,600}-normal.woff'] },
  experimental: { serverActions: { bodySizeLimit: '4.4mb' } },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default withWorkflow(config);
