-- Preserve all legacy answers and tables; new criteria start unevaluated.
ALTER TABLE companies ADD COLUMN qualification TEXT NOT NULL DEFAULT '{}';
-- The existing stage CHECK remains intact. This explicit override adds the seventh stage.
ALTER TABLE companies ADD COLUMN commercialStage TEXT NOT NULL DEFAULT '' CHECK (commercialStage IN ('', 'Opportunité qualifiée'));
ALTER TABLE settings ADD COLUMN targetCompanyType TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN targetOffer TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN targetExclusions TEXT NOT NULL DEFAULT '';
