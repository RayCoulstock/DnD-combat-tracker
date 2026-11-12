-- Additive: existing identities, owners, invitations and sessions are retained.
ALTER TABLE users ADD COLUMN display_name text NOT NULL DEFAULT 'Campaign host';
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
ALTER TABLE memberships ADD COLUMN account_id uuid REFERENCES users(id);
CREATE UNIQUE INDEX memberships_account_campaign ON memberships(campaign_id,account_id) WHERE account_id IS NOT NULL;
ALTER TABLE invitations ADD COLUMN membership_id uuid REFERENCES memberships(id);
