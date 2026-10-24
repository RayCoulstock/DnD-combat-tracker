ALTER TABLE map_templates DROP CONSTRAINT map_templates_schema_version_check;
ALTER TABLE map_templates ADD CONSTRAINT map_templates_schema_version_check CHECK(schema_version IN (1,2));
ALTER TABLE encounter_maps DROP CONSTRAINT encounter_maps_schema_version_check;
ALTER TABLE encounter_maps ADD CONSTRAINT encounter_maps_schema_version_check CHECK(schema_version IN (1,2));
CREATE TABLE encounter_scenery_asset_references (
 encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES assets_3d(id), visible_current boolean NOT NULL,
 PRIMARY KEY(encounter_id,asset_id)
);
CREATE INDEX encounter_scenery_asset_asset ON encounter_scenery_asset_references(asset_id);
CREATE TABLE template_scenery_asset_references (
 template_id uuid NOT NULL REFERENCES map_templates(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES assets_3d(id), PRIMARY KEY(template_id,asset_id)
);
CREATE INDEX template_scenery_asset_asset ON template_scenery_asset_references(asset_id);
