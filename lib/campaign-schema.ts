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
