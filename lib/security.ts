function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  const cloud = process.env.VERCEL === '1';
  for (const [value, deploymentHost] of [
    [process.env.BRINE_APP_ORIGIN, false],
    [process.env.VERCEL_PROJECT_PRODUCTION_URL, true],
    [process.env.VERCEL_URL, true],
  ] as const) {
    if (!value) continue;
    try {
      const url = new URL(deploymentHost ? `https://${value}` : value);
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.hostname || (cloud && url.protocol !== 'https:')) continue;
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      origins.add(url.origin);
    } catch { /* Invalid configuration never grants access. */ }
  }
  return origins;
}

/** Only configuration can grant a host/origin; request headers never extend the allowlist. */
export function isAllowedRequest(host: string | null, origin: string | null, site: string | null, mutation = true): boolean {
  if (!host || host.includes(',') || /[\s\/@\\]/.test(host)) return false;
  const configured = configuredOrigins();
  const cloud = process.env.VERCEL === '1' || configured.size > 0;
  let expectedOrigin: string | undefined;
  if (cloud) expectedOrigin = [...configured].find(value => new URL(value).host === host);
  else if (/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) expectedOrigin = `http://${host}`;
  if (!expectedOrigin || site === 'cross-site' || (mutation && site === 'same-site')) return false;
  if (origin && origin !== expectedOrigin) return false;
  return !mutation || !!origin;
}
