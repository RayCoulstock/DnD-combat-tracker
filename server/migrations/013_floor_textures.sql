-- Reuse the existing durable image store and its reference/deletion protection.
ALTER TABLE floor_images ADD COLUMN name text NOT NULL DEFAULT 'Battle map image';
ALTER TABLE floor_images ADD COLUMN kind text NOT NULL DEFAULT 'battle-map' CHECK(kind IN ('battle-map','texture'));
