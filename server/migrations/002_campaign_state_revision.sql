-- Encounter revisions alone cannot order activation or switches between encounters.
ALTER TABLE campaigns ADD COLUMN state_revision integer NOT NULL DEFAULT 0;
