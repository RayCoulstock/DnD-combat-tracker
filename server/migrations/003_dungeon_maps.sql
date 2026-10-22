CREATE TABLE map_templates (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1), revision integer NOT NULL DEFAULT 1,
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX map_templates_campaign ON map_templates(campaign_id);
CREATE TABLE encounter_maps (
 encounter_id uuid PRIMARY KEY REFERENCES encounters(id) ON DELETE CASCADE,
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1), revision integer NOT NULL DEFAULT 1,
 document jsonb, history jsonb NOT NULL DEFAULT '{"undo":[],"redo":[]}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
