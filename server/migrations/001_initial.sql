CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaigns (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 active_encounter_id uuid, session_active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 display_name text NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memberships_campaign ON memberships(campaign_id);
CREATE TABLE invitations (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, redeemed_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
 sid_hash text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE encounters (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 name text NOT NULL, revision integer NOT NULL DEFAULT 0, state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE artwork (
 id text PRIMARY KEY, mime text NOT NULL, bytes bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE combatants (
 encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE, id text NOT NULL,
 ordinal integer NOT NULL, data jsonb NOT NULL, owner_id uuid REFERENCES memberships(id),
 visible boolean NOT NULL DEFAULT true, position jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(encounter_id, id)
);
CREATE TABLE command_receipts (
 encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, command_id uuid NOT NULL, revision integer NOT NULL, payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(encounter_id, actor_id, command_id)
);
CREATE TABLE checkpoints (
 id uuid PRIMARY KEY, encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
 state jsonb NOT NULL, revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
