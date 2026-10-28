-- Additive image assets; all existing GLB IDs and map documents remain valid.
ALTER TABLE map_templates DROP CONSTRAINT map_templates_schema_version_check;
ALTER TABLE map_templates ADD CONSTRAINT map_templates_schema_version_check CHECK(schema_version IN (1,2,3,4));
ALTER TABLE encounter_maps DROP CONSTRAINT encounter_maps_schema_version_check;
ALTER TABLE encounter_maps ADD CONSTRAINT encounter_maps_schema_version_check CHECK(schema_version IN (1,2,3,4));
CREATE TABLE floor_images (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 storage_key text NOT NULL, content_hash text NOT NULL,
 width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
 file_size bigint NOT NULL CHECK(file_size>0), revision integer NOT NULL DEFAULT 1,
 upload_status text NOT NULL CHECK(upload_status IN ('processing','ready','deleting','deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX floor_image_owner_hash ON floor_images(owner_id,content_hash) WHERE upload_status <> 'deleted';
CREATE TABLE encounter_floor_image_references (
 encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
 image_id uuid NOT NULL REFERENCES floor_images(id), current boolean NOT NULL,
 PRIMARY KEY(encounter_id,image_id)
);
CREATE INDEX encounter_floor_image_asset ON encounter_floor_image_references(image_id);
CREATE TABLE template_floor_image_references (
 template_id uuid NOT NULL REFERENCES map_templates(id) ON DELETE CASCADE,
 image_id uuid NOT NULL REFERENCES floor_images(id), PRIMARY KEY(template_id,image_id)
);
CREATE INDEX template_floor_image_asset ON template_floor_image_references(image_id);
