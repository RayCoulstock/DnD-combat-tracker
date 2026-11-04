CREATE TABLE combatant_group_presets (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
 name text NOT NULL, description text NOT NULL DEFAULT '',
 archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
 creation_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX combatant_group_presets_owner ON combatant_group_presets(owner_id,updated_at DESC);
CREATE TABLE combatant_group_members (
 id uuid PRIMARY KEY, preset_id uuid NOT NULL REFERENCES combatant_group_presets(id) ON DELETE CASCADE,
 library_id uuid REFERENCES combatant_library(id) ON DELETE SET NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 19),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 side text CHECK(side IN ('hero','enemy','neutral')),
 display_name text, UNIQUE(preset_id,ordinal)
);
CREATE INDEX combatant_group_member_library ON combatant_group_members(library_id);
ALTER TABLE command_receipts ADD COLUMN result jsonb;
