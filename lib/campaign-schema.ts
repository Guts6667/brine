export const campaignSql = `
CREATE TABLE campaigns (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE campaign_participations (
  campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payload TEXT NOT NULL, PRIMARY KEY(campaignId, companyId)
);
CREATE TABLE campaign_activity_context (
  activityId TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE company_registry_identity (
  siren TEXT PRIMARY KEY, companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  siret TEXT NOT NULL DEFAULT ''
);
CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY, campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);
CREATE TABLE discovery_candidates (
  id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  siren TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(runId, siren)
);
CREATE TABLE campaign_meta (id TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO campaign_meta(id, value) VALUES('epoch', lower(hex(randomblob(16))));
`;

export const researchSql = `
CREATE TABLE discovery_candidates_v2 (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  dedupeKey TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(runId, dedupeKey)
);
INSERT INTO discovery_candidates_v2(id,runId,dedupeKey,payload)
SELECT id,runId,
  CASE WHEN length(siren)=9 AND siren NOT GLOB '*[^0-9]*' THEN 'siren:' || siren
       WHEN json_extract(payload,'$.companyId') IS NOT NULL THEN 'company:' || json_extract(payload,'$.companyId')
       ELSE 'legacy:' || id END,
  CASE WHEN length(siren)=9 AND siren NOT GLOB '*[^0-9]*' THEN payload
       ELSE json_set(payload,'$.company.siren','','$.company.siret','') END
FROM discovery_candidates;
DROP TABLE discovery_candidates;
ALTER TABLE discovery_candidates_v2 RENAME TO discovery_candidates;
CREATE TABLE company_source_identity (
  provider TEXT NOT NULL,
  externalId TEXT NOT NULL,
  companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY(provider,externalId)
);
CREATE TABLE research_provider_profile (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE research_operations (
  operationKey TEXT PRIMARY KEY, provider TEXT NOT NULL, month TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, status TEXT NOT NULL,
  reservedUsdMicros INTEGER NOT NULL DEFAULT 0, actualUsdMicros INTEGER,
  quotaUnits INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX research_operations_usage ON research_operations(provider,month,createdAt);
CREATE TABLE research_cache (cacheKey TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE research_provider_state (provider TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE research_credit_purchases (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, amountEuroCents INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL
);
CREATE TABLE research_fact_corrections (
  id TEXT PRIMARY KEY, companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);
CREATE TABLE research_submissions (
  submittedKey TEXT PRIMARY KEY, companyId TEXT NOT NULL, campaignId TEXT NOT NULL,
  kind TEXT NOT NULL, fingerprint TEXT NOT NULL, createdAt TEXT NOT NULL
);
`;
