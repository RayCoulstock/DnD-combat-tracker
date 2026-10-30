-- Definitions are account-owned; campaigns already exist independently of live sessions.
CREATE TABLE combatant_library (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
 name text NOT NULL, kind text NOT NULL CHECK(kind IN ('player-character','named-npc','monster-template')),
 definition jsonb NOT NULL, notes text NOT NULL DEFAULT '',
 archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
 creation_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX combatant_library_owner ON combatant_library(owner_id,updated_at DESC);
CREATE TABLE campaign_character_state (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 library_id uuid NOT NULL REFERENCES combatant_library(id),
 state jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(campaign_id,library_id)
);
