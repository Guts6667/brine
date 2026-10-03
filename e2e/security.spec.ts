import { expect, test } from '@playwright/test';

test('le serveur refuse les mutations sans origine ou provenant d’un autre site', async ({ request }) => {
  const before = await request.get('/api/backup');
  expect(before.ok()).toBeTruthy();
  const companiesBefore = (await before.json()).companies.length;

  const blockedRequests: Record<string, string>[] = [
    {},
    { Origin: 'https://example.com' },
    { Origin: 'http://127.0.0.1:3100', 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of blockedRequests) {
    const response = await request.post('/', { headers, data: { name: 'Mutation interdite' } });
    expect(response.status()).toBe(403);
    expect(await response.text()).toContain('Requête locale non autorisée.');
  }

  const after = await request.get('/api/backup');
  expect((await after.json()).companies).toHaveLength(companiesBefore);
});
