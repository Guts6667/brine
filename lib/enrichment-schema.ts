export const enrichmentSql=`
CREATE TABLE research_assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, byteLength INTEGER NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE research_comparisons (id TEXT PRIMARY KEY, campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE research_client_briefs (id TEXT PRIMARY KEY, campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, payload TEXT NOT NULL);
`;
