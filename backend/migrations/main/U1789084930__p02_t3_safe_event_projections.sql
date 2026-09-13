-- P02.T3: keep realtime payloads on allowlisted projection tables.
-- TrailBase v0.33.14 applies excluded_columns to REST/schema but builds SSE
-- events from the source table. These mirrors contain no private source fields.
-- Direct WASM SQL writes do not themselves prove Record SSE delivery; the owning
-- mutation/event check remains C3.

CREATE TABLE profiles_public_events (
  id BLOB PRIMARY KEY NOT NULL REFERENCES profiles(id) ON UPDATE RESTRICT ON DELETE CASCADE
    CHECK (is_uuid(id)),
  display_name TEXT NOT NULL,
  avatar_mime TEXT,
  avatar_revision INTEGER NOT NULL CHECK (avatar_revision >= 0),
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE games_public_events (
  id BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)),
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  starts_at INTEGER,
  duration_minutes INTEGER NOT NULL,
  lifecycle TEXT NOT NULL,
  roster_locked_at INTEGER,
  roster_version INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE games_host_events (
  id BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)),
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  starts_at INTEGER,
  duration_minutes INTEGER NOT NULL,
  lifecycle TEXT NOT NULL,
  roster_locked_at INTEGER,
  roster_version INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  host_id BLOB NOT NULL CHECK (is_uuid(host_id)),
  join_code TEXT NOT NULL,
  timers TEXT NOT NULL,
  auto_reveal INTEGER NOT NULL
) STRICT;

CREATE TABLE game_teams_public_events (
  id BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL CHECK (is_uuid_v7(game_id)),
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE game_players_public_events (
  id BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL CHECK (is_uuid_v7(game_id)),
  user_id BLOB NOT NULL CHECK (is_uuid(user_id)),
  team_id BLOB,
  left_at INTEGER,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE displays_public_events (
  id BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)),
  game_id BLOB CHECK (game_id IS NULL OR is_uuid_v7(game_id)),
  host_id BLOB CHECK (host_id IS NULL OR is_uuid(host_id)),
  claim_version INTEGER NOT NULL CHECK (claim_version >= 0),
  settings TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

INSERT INTO profiles_public_events (id, display_name, avatar_mime, avatar_revision, version, updated_at)
  SELECT id, display_name, avatar_mime, avatar_revision, version, updated_at FROM profiles;
INSERT INTO games_public_events (id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at)
  SELECT id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at FROM games WHERE deleted_at IS NULL;
INSERT INTO games_host_events (id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at, host_id, join_code, timers, auto_reveal)
  SELECT id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at, host_id, join_code, timers, auto_reveal FROM games WHERE deleted_at IS NULL;
INSERT INTO game_teams_public_events (id, game_id, name, version, updated_at)
  SELECT id, game_id, name, version, updated_at FROM game_teams WHERE deleted_at IS NULL;
INSERT INTO game_players_public_events (id, game_id, user_id, team_id, left_at, version, updated_at)
  SELECT id, game_id, user_id, team_id, left_at, version, updated_at FROM game_players;
INSERT INTO displays_public_events (id, game_id, host_id, claim_version, settings, version, updated_at)
  SELECT id, game_id, host_id, claim_version, settings, version, updated_at FROM displays;

CREATE TRIGGER profiles_public_events_insert
AFTER INSERT ON profiles
FOR EACH ROW
BEGIN
  INSERT INTO profiles_public_events (id, display_name, avatar_mime, avatar_revision, version, updated_at)
  VALUES (NEW.id, NEW.display_name, NEW.avatar_mime, NEW.avatar_revision, NEW.version, NEW.updated_at);
END;

CREATE TRIGGER profiles_public_events_update
AFTER UPDATE ON profiles
FOR EACH ROW
BEGIN
  UPDATE profiles_public_events
  SET display_name = NEW.display_name, avatar_mime = NEW.avatar_mime,
      avatar_revision = NEW.avatar_revision, version = NEW.version, updated_at = NEW.updated_at
  WHERE id = OLD.id;
END;

CREATE TRIGGER profiles_public_events_delete
AFTER DELETE ON profiles
FOR EACH ROW
BEGIN
  DELETE FROM profiles_public_events WHERE id = OLD.id;
END;

CREATE TRIGGER games_public_events_insert
AFTER INSERT ON games
FOR EACH ROW
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO games_public_events (id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at)
  VALUES (NEW.id, NEW.title, NEW.location, NEW.starts_at, NEW.duration_minutes, NEW.lifecycle, NEW.roster_locked_at, NEW.roster_version, NEW.version, NEW.updated_at);
  INSERT INTO games_host_events (id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at, host_id, join_code, timers, auto_reveal)
  VALUES (NEW.id, NEW.title, NEW.location, NEW.starts_at, NEW.duration_minutes, NEW.lifecycle, NEW.roster_locked_at, NEW.roster_version, NEW.version, NEW.updated_at, NEW.host_id, NEW.join_code, NEW.timers, NEW.auto_reveal);
END;

CREATE TRIGGER games_public_events_update
AFTER UPDATE ON games
FOR EACH ROW
BEGIN
  DELETE FROM games_public_events WHERE id = OLD.id;
  DELETE FROM games_host_events WHERE id = OLD.id;
  INSERT INTO games_public_events (id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at)
  SELECT NEW.id, NEW.title, NEW.location, NEW.starts_at, NEW.duration_minutes, NEW.lifecycle, NEW.roster_locked_at, NEW.roster_version, NEW.version, NEW.updated_at
  WHERE NEW.deleted_at IS NULL;
  INSERT INTO games_host_events (id, title, location, starts_at, duration_minutes, lifecycle, roster_locked_at, roster_version, version, updated_at, host_id, join_code, timers, auto_reveal)
  SELECT NEW.id, NEW.title, NEW.location, NEW.starts_at, NEW.duration_minutes, NEW.lifecycle, NEW.roster_locked_at, NEW.roster_version, NEW.version, NEW.updated_at, NEW.host_id, NEW.join_code, NEW.timers, NEW.auto_reveal
  WHERE NEW.deleted_at IS NULL;
END;

CREATE TRIGGER games_public_events_delete
AFTER DELETE ON games
FOR EACH ROW
BEGIN
  DELETE FROM games_public_events WHERE id = OLD.id;
  DELETE FROM games_host_events WHERE id = OLD.id;
END;

CREATE TRIGGER game_teams_public_events_insert
AFTER INSERT ON game_teams
FOR EACH ROW
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO game_teams_public_events (id, game_id, name, version, updated_at)
  VALUES (NEW.id, NEW.game_id, NEW.name, NEW.version, NEW.updated_at);
END;

CREATE TRIGGER game_teams_public_events_update
AFTER UPDATE ON game_teams
FOR EACH ROW
BEGIN
  DELETE FROM game_teams_public_events WHERE id = OLD.id;
  INSERT INTO game_teams_public_events (id, game_id, name, version, updated_at)
  SELECT NEW.id, NEW.game_id, NEW.name, NEW.version, NEW.updated_at
  WHERE NEW.deleted_at IS NULL;
END;

CREATE TRIGGER game_teams_public_events_delete
AFTER DELETE ON game_teams
FOR EACH ROW
BEGIN
  DELETE FROM game_teams_public_events WHERE id = OLD.id;
END;

CREATE TRIGGER game_players_public_events_insert
AFTER INSERT ON game_players
FOR EACH ROW
BEGIN
  INSERT INTO game_players_public_events (id, game_id, user_id, team_id, left_at, version, updated_at)
  VALUES (NEW.id, NEW.game_id, NEW.user_id, NEW.team_id, NEW.left_at, NEW.version, NEW.updated_at);
END;

CREATE TRIGGER game_players_public_events_update
AFTER UPDATE ON game_players
FOR EACH ROW
BEGIN
  UPDATE game_players_public_events
  SET game_id = NEW.game_id, user_id = NEW.user_id, team_id = NEW.team_id,
      left_at = NEW.left_at, version = NEW.version, updated_at = NEW.updated_at
  WHERE id = OLD.id;
END;

CREATE TRIGGER game_players_public_events_delete
AFTER DELETE ON game_players
FOR EACH ROW
BEGIN
  DELETE FROM game_players_public_events WHERE id = OLD.id;
END;

CREATE TRIGGER displays_public_events_insert
AFTER INSERT ON displays
FOR EACH ROW
BEGIN
  INSERT INTO displays_public_events (id, game_id, host_id, claim_version, settings, version, updated_at)
  VALUES (NEW.id, NEW.game_id, NEW.host_id, NEW.claim_version, NEW.settings, NEW.version, NEW.updated_at);
END;

CREATE TRIGGER displays_public_events_update
AFTER UPDATE ON displays
FOR EACH ROW
BEGIN
  UPDATE displays_public_events
  SET game_id = NEW.game_id, host_id = NEW.host_id, claim_version = NEW.claim_version,
      settings = NEW.settings, version = NEW.version, updated_at = NEW.updated_at
  WHERE id = OLD.id;
END;

CREATE TRIGGER displays_public_events_delete
AFTER DELETE ON displays
FOR EACH ROW
BEGIN
  DELETE FROM displays_public_events WHERE id = OLD.id;
END;

CREATE INDEX games_public_events_host ON games_public_events(id);
CREATE INDEX games_host_events_host ON games_host_events(host_id, id);
CREATE INDEX game_teams_public_events_game ON game_teams_public_events(game_id, id);
CREATE INDEX game_players_public_events_game ON game_players_public_events(game_id, id);
CREATE INDEX displays_public_events_game ON displays_public_events(game_id, id);
