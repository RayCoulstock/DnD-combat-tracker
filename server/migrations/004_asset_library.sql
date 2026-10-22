CREATE TABLE assets_3d (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL
 CHECK(category IN ('miniature','monster','furniture','architecture','terrain','decoration')),
 tags jsonb NOT NULL DEFAULT '[]', source text NOT NULL DEFAULT '', presentation jsonb NOT NULL,
 file_name text NOT NULL, file_size integer NOT NULL CHECK(file_size>0),
 content_type text NOT NULL DEFAULT 'model/gltf-binary', format text NOT NULL DEFAULT 'glb',
 storage_key text NOT NULL, content_hash text NOT NULL,
 upload_status text NOT NULL CHECK(upload_status IN ('processing','ready','deleting','deleted')),
 validation_status text NOT NULL DEFAULT 'valid' CHECK(validation_status='valid'), metrics jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX assets_3d_owner_content ON assets_3d(owner_id,content_hash) WHERE upload_status <> 'deleted';
CREATE INDEX assets_3d_owner_created ON assets_3d(owner_id,created_at DESC);
