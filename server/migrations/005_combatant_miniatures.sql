CREATE TABLE combatant_asset_references (
 encounter_id uuid NOT NULL, combatant_id text NOT NULL,
 asset_id uuid NOT NULL REFERENCES assets_3d(id),
 PRIMARY KEY(encounter_id,combatant_id),
 FOREIGN KEY(encounter_id,combatant_id) REFERENCES combatants(encounter_id,id) ON DELETE CASCADE
);
CREATE INDEX combatant_asset_references_asset ON combatant_asset_references(asset_id);
