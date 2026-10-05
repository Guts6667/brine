import { campaignSql, researchSql } from './campaign-schema';
import { enrichmentSql } from './enrichment-schema';
import {learningSql} from './learning-schema';
// SQL is embedded so serverless functions do not depend on a writable or bundled migrations directory.
// Keep migration 1 identical to migrations/001_initial.sql; the adapter test verifies that parity.
export const cloudMigrations = [
  { version: 1, filename: '001_initial.sql', sql: `CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  business TEXT NOT NULL DEFAULT '',
  targetFit TEXT NOT NULL DEFAULT 'unknown' CHECK (targetFit IN ('yes','no','unknown')),
  problemFound TEXT NOT NULL DEFAULT 'unknown' CHECK (problemFound IN ('yes','no','unknown')),
  contactAvailable TEXT NOT NULL DEFAULT 'unknown' CHECK (contactAvailable IN ('yes','no','unknown')),
  observation TEXT NOT NULL DEFAULT '',
  proofUrl TEXT NOT NULL DEFAULT '',
  observedOn TEXT NOT NULL DEFAULT '',
  "trigger" TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'À étudier' CHECK (stage IN ('À étudier','À contacter','En échange','Proposition envoyée','Gagné','Perdu')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  oppositionActive INTEGER NOT NULL DEFAULT 0 CHECK (oppositionActive IN (0,1)),
  oppositionDate TEXT NOT NULL DEFAULT '',
  oppositionNote TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE contacts (
  companyId TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  formUrl TEXT NOT NULL DEFAULT '',
  profileUrl TEXT NOT NULL DEFAULT ''
);
CREATE TABLE next_actions (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note','exchange','action_done','action_rescheduled','system')),
  type TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX activities_company ON activities(companyId, createdAt);
CREATE TABLE ai_tests (
  id TEXT PRIMARY KEY,
  companyId TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  panel TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL DEFAULT '',
  interface TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'unknown' CHECK (mode IN ('web','api','unknown')),
  model TEXT NOT NULL DEFAULT '',
  questions TEXT NOT NULL DEFAULT '',
  validResponses INTEGER CHECK (validResponses IS NULL OR (typeof(validResponses) = 'integer' AND validResponses >= 0)),
  recommendations INTEGER CHECK (recommendations IS NULL OR (typeof(recommendations) = 'integer' AND recommendations >= 0)),
  citations INTEGER CHECK (citations IS NULL OR (typeof(citations) = 'integer' AND citations >= 0)),
  notes TEXT NOT NULL DEFAULT '',
  proofUrl TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  CHECK (validResponses IS NULL OR recommendations IS NULL OR recommendations <= validResponses),
  CHECK (validResponses IS NULL OR citations IS NULL OR citations <= validResponses)
);
CREATE INDEX ai_tests_company ON ai_tests(companyId, createdAt);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  targetCity TEXT NOT NULL,
  targetBusiness TEXT NOT NULL
);
INSERT INTO settings(id, targetCity, targetBusiness) VALUES(1, 'Montpellier', 'Rénovation intérieure');
` },
  { version: 2, filename: '002_cloud_restore_backups.sql', sql: `
CREATE TABLE brine_restore_backups (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  payload TEXT NOT NULL
);
` },
  // Version 2 was already deployed for private recovery snapshots. Qualification is additive version 3.
  { version: 3, filename: '003_qualification.sql', sql: `-- Preserve all legacy answers and tables; new criteria start unevaluated.
ALTER TABLE companies ADD COLUMN qualification TEXT NOT NULL DEFAULT '{}';
-- The existing stage CHECK remains intact. This explicit override adds the seventh stage.
ALTER TABLE companies ADD COLUMN commercialStage TEXT NOT NULL DEFAULT '' CHECK (commercialStage IN ('', 'Opportunité qualifiée'));
ALTER TABLE settings ADD COLUMN targetCompanyType TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN targetOffer TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN targetExclusions TEXT NOT NULL DEFAULT '';
` },
  { version: 4, filename: '004_campaigns.sql', sql: campaignSql },
  { version: 5, filename: '005_research.sql', sql: researchSql },
  { version: 6, filename: '006_enrichment.sql', sql: enrichmentSql },
  { version: 7, filename: '007_learning.sql', sql: learningSql },
] as const;
