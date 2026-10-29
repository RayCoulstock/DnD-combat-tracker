-- Accept additive transition metadata; existing map JSON and asset IDs remain unchanged.
ALTER TABLE map_templates DROP CONSTRAINT map_templates_schema_version_check;
ALTER TABLE map_templates ADD CONSTRAINT map_templates_schema_version_check CHECK(schema_version IN (1,2,3,4,5,6));
ALTER TABLE encounter_maps DROP CONSTRAINT encounter_maps_schema_version_check;
ALTER TABLE encounter_maps ADD CONSTRAINT encounter_maps_schema_version_check CHECK(schema_version IN (1,2,3,4,5,6));
