-- Read projections deliberately expose allowlisted columns, not private base tables.
CREATE VIEW profiles_public AS
  SELECT id, display_name, avatar_mime, avatar_revision, version, updated_at
  FROM profiles;

CREATE VIEW games_public AS
  SELECT id, title, location, starts_at, duration_minutes, lifecycle,
         roster_locked_at, roster_version, version, updated_at
  FROM games
  WHERE deleted_at IS NULL;

CREATE VIEW games_host AS
  SELECT id, title, location, starts_at, duration_minutes, lifecycle,
         roster_locked_at, roster_version, version, updated_at,
         host_id, join_code, timers, auto_reveal
  FROM games
  WHERE deleted_at IS NULL;

CREATE VIEW displays_public AS
  SELECT id, game_id, host_id, claim_version, settings, version, updated_at
  FROM displays;
