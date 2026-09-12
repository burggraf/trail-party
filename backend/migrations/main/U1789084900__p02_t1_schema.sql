-- P02.T1 application schema. Synthetic rows are provisioned only by isolated tests.
-- Keep the native _user table untouched: profiles/displays inherit its BLOB UUIDs.

CREATE TABLE profiles (
  id BLOB PRIMARY KEY NOT NULL
    REFERENCES _user(id) ON UPDATE RESTRICT ON DELETE CASCADE
    CHECK (is_uuid(id)),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  avatar_file TEXT,
  avatar_mime TEXT,
  avatar_bytes INTEGER,
  avatar_revision INTEGER NOT NULL DEFAULT 0 CHECK (avatar_revision >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (
    (avatar_file IS NULL AND avatar_mime IS NULL AND avatar_bytes IS NULL)
    OR (avatar_file IS NOT NULL AND avatar_mime IS NOT NULL AND avatar_bytes IS NOT NULL)
  ),
  CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  CHECK (avatar_bytes IS NULL OR avatar_bytes BETWEEN 1 AND 5242880)
) STRICT;

CREATE TABLE questions (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  source_id TEXT NOT NULL UNIQUE CHECK (length(source_id) > 0),
  external_id TEXT,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  question TEXT NOT NULL,
  answer_a TEXT NOT NULL,
  answer_b TEXT NOT NULL,
  answer_c TEXT NOT NULL,
  answer_d TEXT NOT NULL,
  level REAL,
  metadata TEXT,
  imported_at TEXT,
  ingested_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (ingested_at >= 0)
) STRICT;

CREATE TABLE games (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  host_id BLOB NOT NULL
    REFERENCES _user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK (is_uuid(host_id)),
  join_code TEXT NOT NULL
    CHECK (length(join_code) = 6 AND join_code GLOB '[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 240),
  starts_at INTEGER,
  duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK (duration_minutes BETWEEN 1 AND 1440),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  lifecycle TEXT NOT NULL DEFAULT 'setup' CHECK (lifecycle IN ('setup', 'ready', 'in-progress', 'completed')),
  roster_locked_at INTEGER,
  roster_version INTEGER NOT NULL DEFAULT 0 CHECK (roster_version >= 0),
  deleted_at INTEGER,
  completed_at INTEGER,
  timers TEXT NOT NULL DEFAULT '{"game_start":null,"round_start":null,"question":null,"answer":null,"round_end":null,"game_end":null,"thanks":null}'
    CHECK (jsonschema_matches('{"type":"object","required":["game_start","round_start","question","answer","round_end","game_end","thanks"],"additionalProperties":false,"properties":{"game_start":{"type":["integer","null"],"minimum":0,"maximum":86400},"round_start":{"type":["integer","null"],"minimum":0,"maximum":86400},"question":{"type":["integer","null"],"minimum":0,"maximum":86400},"answer":{"type":["integer","null"],"minimum":0,"maximum":86400},"round_end":{"type":["integer","null"],"minimum":0,"maximum":86400},"game_end":{"type":["integer","null"],"minimum":0,"maximum":86400},"thanks":{"type":["integer","null"],"minimum":0,"maximum":86400}}}', timers)),
  auto_reveal INTEGER NOT NULL DEFAULT 0 CHECK (auto_reveal IN (0, 1)),
  CHECK ((lifecycle IN ('in-progress', 'completed')) = (roster_locked_at IS NOT NULL)),
  CHECK ((lifecycle = 'completed') = (completed_at IS NOT NULL)),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (starts_at IS NULL OR starts_at >= 0),
  CHECK (roster_locked_at IS NULL OR roster_locked_at >= 0),
  CHECK (deleted_at IS NULL OR deleted_at >= 0),
  CHECK (completed_at IS NULL OR completed_at >= 0),
  UNIQUE (id, host_id)
) STRICT;

CREATE TABLE rounds (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  question_count INTEGER NOT NULL DEFAULT 5 CHECK (question_count BETWEEN 1 AND 100),
  categories TEXT NOT NULL DEFAULT '[]'
    CHECK (jsonschema_matches('{"type":"array","uniqueItems":true,"maxItems":100,"items":{"type":"string"}}', categories)),
  difficulty TEXT CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
  level_min REAL,
  level_max REAL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (level_min IS NULL OR level_max IS NULL OR level_min <= level_max),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (deleted_at IS NULL OR deleted_at >= 0),
  UNIQUE (id, game_id)
) STRICT;

CREATE TABLE game_teams (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (deleted_at IS NULL OR deleted_at >= 0),
  UNIQUE (id, game_id)
) STRICT;

CREATE TABLE game_players (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  user_id BLOB NOT NULL REFERENCES profiles(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK (is_uuid(user_id)),
  team_id BLOB,
  left_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (left_at IS NULL OR left_at >= 0),
  FOREIGN KEY (team_id, game_id) REFERENCES game_teams(id, game_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (game_id, user_id),
  UNIQUE (id, game_id),
  UNIQUE (id, game_id, team_id)
) STRICT;

CREATE TABLE assignment_private (
  assignment_id BLOB PRIMARY KEY NOT NULL
    REFERENCES game_questions(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK (is_uuid_v7(assignment_id)),
  question_id INTEGER NOT NULL REFERENCES questions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  permutation TEXT NOT NULL
    CHECK (jsonschema_matches('{"type":"array","minItems":4,"maxItems":4,"uniqueItems":true,"items":{"type":"integer","minimum":0,"maximum":3}}', permutation)),
  correct_label TEXT NOT NULL CHECK (correct_label IN ('A', 'B', 'C', 'D')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (created_at >= 0),
  CHECK (json_extract(permutation, '$[0]') IS NOT NULL),
  CHECK (
    (correct_label = 'A' AND json_extract(permutation, '$[0]') = 0)
    OR (correct_label = 'B' AND json_extract(permutation, '$[1]') = 0)
    OR (correct_label = 'C' AND json_extract(permutation, '$[2]') = 0)
    OR (correct_label = 'D' AND json_extract(permutation, '$[3]') = 0)
  )
) STRICT;

CREATE TABLE used_question_history (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  host_id BLOB NOT NULL REFERENCES _user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK (is_uuid(host_id)),
  question_id INTEGER NOT NULL REFERENCES questions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  game_id BLOB NOT NULL,
  assignment_id BLOB NOT NULL
    CHECK (is_uuid_v7(assignment_id)),
  operation_id TEXT NOT NULL
    CHECK (length(operation_id) = 36 AND lower(operation_id) = operation_id
      AND substr(operation_id, 1, 8) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 10, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 15, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 20, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 25, 12) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 9, 1) = '-'
      AND substr(operation_id, 14, 1) = '-'
      AND substr(operation_id, 19, 1) = '-'
      AND substr(operation_id, 24, 1) = '-'
      AND substr(operation_id, 15, 1) = '7'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (created_at >= 0),
  FOREIGN KEY (game_id, host_id) REFERENCES games(id, host_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, game_id) REFERENCES game_questions(id, game_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (assignment_id),
  UNIQUE (assignment_id, game_id)
) STRICT;

CREATE TABLE game_questions (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  round_id BLOB NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  question_text TEXT NOT NULL,
  choices TEXT NOT NULL
    CHECK (jsonschema_matches('{"type":"object","required":["A","B","C","D"],"additionalProperties":false,"properties":{"A":{"type":"string"},"B":{"type":"string"},"C":{"type":"string"},"D":{"type":"string"}}}', choices)),
  retired_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (created_at >= 0),
  FOREIGN KEY (round_id, game_id) REFERENCES rounds(id, game_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (retired_at IS NULL OR retired_at >= 0),
  FOREIGN KEY (id) REFERENCES assignment_private(assignment_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id, game_id) REFERENCES used_question_history(assignment_id, game_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (id, game_id),
  UNIQUE (id, game_id, round_id)
) STRICT;

CREATE TABLE game_state_public (
  id BLOB PRIMARY KEY NOT NULL
    REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK (is_uuid_v7(id)),
  phase TEXT NOT NULL DEFAULT 'game-start'
    CHECK (phase IN ('game-start', 'round-start', 'round-play', 'round-end', 'game-end', 'thanks', 'lobby')),
  round_id BLOB,
  assignment_id BLOB,
  round_title TEXT,
  round_ordinal INTEGER,
  question_ordinal INTEGER,
  question_text TEXT,
  choices TEXT
    CHECK (choices IS NULL OR jsonschema_matches('{"type":"object","required":["A","B","C","D"],"additionalProperties":false,"properties":{"A":{"type":"string"},"B":{"type":"string"},"C":{"type":"string"},"D":{"type":"string"}}}', choices)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  revealed INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
  deadline_at INTEGER CHECK (deadline_at IS NULL OR deadline_at >= 0),
  paused_remaining_seconds INTEGER CHECK (paused_remaining_seconds IS NULL OR paused_remaining_seconds >= 0),
  all_answered_at INTEGER CHECK (all_answered_at IS NULL OR all_answered_at >= 0),
  FOREIGN KEY (round_id, id) REFERENCES rounds(id, game_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, id, round_id) REFERENCES game_questions(id, game_id, round_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (NOT (deadline_at IS NOT NULL AND paused_remaining_seconds IS NOT NULL)),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (phase = 'round-play' OR revealed = 0),
  CHECK (phase = 'round-play' OR (assignment_id IS NULL AND question_ordinal IS NULL AND question_text IS NULL AND choices IS NULL)),
  CHECK (phase = 'round-play' OR assignment_id IS NULL),
  CHECK (phase IN ('round-start', 'round-play', 'round-end') OR (round_id IS NULL AND round_title IS NULL AND round_ordinal IS NULL)),
  CHECK (phase IN ('round-start', 'round-play', 'round-end') OR round_id IS NULL),
  CHECK (phase NOT IN ('round-start', 'round-end') OR (round_id IS NOT NULL AND round_title IS NOT NULL AND round_ordinal IS NOT NULL)),
  CHECK (phase = 'round-play' OR (question_text IS NULL AND choices IS NULL)),
  CHECK (phase <> 'round-play' OR (round_id IS NOT NULL AND assignment_id IS NOT NULL AND round_title IS NOT NULL AND round_ordinal IS NOT NULL AND question_ordinal IS NOT NULL AND question_text IS NOT NULL AND choices IS NOT NULL)),
  CHECK (round_ordinal IS NULL OR round_ordinal >= 1),
  CHECK (question_ordinal IS NULL OR question_ordinal >= 1)
) STRICT;

CREATE TABLE game_answers (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  assignment_id BLOB NOT NULL,
  team_id BLOB NOT NULL,
  accepted_player_id BLOB NOT NULL,
  displayed_label TEXT NOT NULL CHECK (displayed_label IN ('A', 'B', 'C', 'D')),
  accepted_state_version INTEGER NOT NULL CHECK (accepted_state_version >= 0),
  operation_id TEXT NOT NULL
    CHECK (length(operation_id) = 36 AND lower(operation_id) = operation_id
      AND substr(operation_id, 1, 8) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 10, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 15, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 20, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 25, 12) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 9, 1) = '-'
      AND substr(operation_id, 14, 1) = '-'
      AND substr(operation_id, 19, 1) = '-'
      AND substr(operation_id, 24, 1) = '-'
      AND substr(operation_id, 15, 1) = '7'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (created_at >= 0),
  FOREIGN KEY (assignment_id, game_id) REFERENCES game_questions(id, game_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (team_id, game_id) REFERENCES game_teams(id, game_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (accepted_player_id, game_id, team_id) REFERENCES game_players(id, game_id, team_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (assignment_id, team_id),
  UNIQUE (accepted_player_id, operation_id)
) STRICT;

CREATE TABLE answer_grades_private (
  answer_id BLOB PRIMARY KEY NOT NULL
    REFERENCES game_answers(id) ON UPDATE RESTRICT ON DELETE RESTRICT
    CHECK (is_uuid_v7(answer_id)),
  source_label TEXT NOT NULL CHECK (source_label IN ('a', 'b', 'c', 'd')),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  points INTEGER NOT NULL CHECK (points IN (0, 1) AND points = is_correct),
  graded_state_version INTEGER NOT NULL CHECK (graded_state_version >= 0),
  operation_id TEXT NOT NULL
    CHECK (length(operation_id) = 36 AND lower(operation_id) = operation_id
      AND substr(operation_id, 1, 8) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 10, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 15, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 20, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 25, 12) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 9, 1) = '-'
      AND substr(operation_id, 14, 1) = '-'
      AND substr(operation_id, 19, 1) = '-'
      AND substr(operation_id, 24, 1) = '-'
      AND substr(operation_id, 15, 1) = '7'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (created_at >= 0)
) STRICT;

CREATE TABLE displays (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7())
    CHECK (is_uuid_v7(id)),
  device_user_id BLOB NOT NULL UNIQUE
    REFERENCES _user(id) ON UPDATE RESTRICT ON DELETE CASCADE
    CHECK (is_uuid(device_user_id)),
  code_hash BLOB,
  code_epoch INTEGER NOT NULL DEFAULT 0 CHECK (code_epoch >= 0),
  code_created_at INTEGER,
  expires_at INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  attempt_window_at INTEGER,
  blocked_until INTEGER,
  claim_version INTEGER NOT NULL DEFAULT 0 CHECK (claim_version >= 0),
  host_id BLOB,
  game_id BLOB,
  claimed_at INTEGER,
  released_at INTEGER,
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER,
  settings TEXT NOT NULL DEFAULT '{"theme":"dark","text_scale":1}'
    CHECK (jsonschema_matches('{"type":"object","required":["theme","text_scale"],"additionalProperties":false,"properties":{"theme":{"enum":["dark","light"]},"text_scale":{"type":"number","minimum":0.5,"maximum":2}}}', settings)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (code_hash IS NULL OR length(code_hash) = 32),
  CHECK ((code_hash IS NULL AND code_created_at IS NULL AND expires_at IS NULL) OR (code_hash IS NOT NULL AND code_created_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > code_created_at)),
  CHECK (created_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (code_created_at IS NULL OR code_created_at >= 0),
  CHECK (expires_at IS NULL OR expires_at >= 0),
  CHECK (attempt_window_at IS NULL OR attempt_window_at >= 0),
  CHECK (blocked_until IS NULL OR blocked_until >= 0),
  CHECK (claimed_at IS NULL OR claimed_at >= 0),
  CHECK (released_at IS NULL OR released_at >= 0),
  CHECK (last_seen_at >= 0),
  CHECK (revoked_at IS NULL OR revoked_at >= 0),
  CHECK ((host_id IS NULL AND game_id IS NULL AND claimed_at IS NULL) OR (host_id IS NOT NULL AND game_id IS NOT NULL AND claimed_at IS NOT NULL)),
  FOREIGN KEY (game_id, host_id) REFERENCES games(id, host_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE pairing_limits (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id = 'global' OR id GLOB 'actor:[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*'),
  window_at INTEGER NOT NULL DEFAULT (unixepoch()),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (window_at >= 0),
  CHECK (updated_at >= 0),
  CHECK (blocked_until IS NULL OR blocked_until >= 0),
  CHECK (
    id = 'global' OR (
      length(id) = 42 AND substr(id, 1, 6) = 'actor:'
      AND substr(id, 7, 8) NOT GLOB '*[^0-9a-f]*'
      AND substr(id, 16, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(id, 21, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(id, 26, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(id, 31, 12) NOT GLOB '*[^0-9a-f]*'
      AND substr(id, 15, 1) = '-'
      AND substr(id, 20, 1) = '-'
      AND substr(id, 25, 1) = '-'
      AND substr(id, 30, 1) = '-'
    )
  )
) STRICT;

CREATE TABLE online (
  id BLOB PRIMARY KEY NOT NULL CHECK (is_uuid_v7(id)),
  game_id BLOB NOT NULL REFERENCES games(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK (last_seen_at >= 0),
  FOREIGN KEY (id, game_id) REFERENCES game_players(id, game_id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  actor_user_id BLOB,
  actor_device_id BLOB,
  operation_id TEXT NOT NULL
    CHECK (length(operation_id) = 36 AND lower(operation_id) = operation_id
      AND substr(operation_id, 1, 8) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 10, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 15, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 20, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 25, 12) NOT GLOB '*[^0-9a-f]*'
      AND substr(operation_id, 9, 1) = '-'
      AND substr(operation_id, 14, 1) = '-'
      AND substr(operation_id, 19, 1) = '-'
      AND substr(operation_id, 24, 1) = '-'
      AND substr(operation_id, 15, 1) = '7'),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('profile', 'game', 'round', 'team', 'member', 'assignment', 'answer', 'display', 'pairing-limit')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  request_hash BLOB,
  before_version INTEGER CHECK (before_version IS NULL OR before_version >= 0),
  after_version INTEGER CHECK (after_version IS NULL OR after_version >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'conflict')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((actor_user_id IS NULL) <> (actor_device_id IS NULL)),
  CHECK (actor_user_id IS NULL OR is_uuid(actor_user_id)),
  CHECK (actor_device_id IS NULL OR is_uuid(actor_device_id)),
  CHECK (action IN ('create', 'update', 'delete', 'replace', 'remove', 'enroll', 'rotate-code', 'claim', 'release', 'reassign', 'join', 'leave', 'change-team', 'heartbeat', 'allocate', 'submit', 'reveal', 'complete', 'purge')),
  CHECK (request_hash IS NULL OR length(request_hash) = 32),
  CHECK (outcome <> 'success' OR (request_hash IS NOT NULL AND after_version IS NOT NULL)),
  CHECK (created_at >= 0),
  CHECK (outcome <> 'success' OR before_version IS NULL OR after_version = before_version + 1),
  CHECK (outcome <> 'success' OR before_version IS NOT NULL OR after_version = 0)
) STRICT;

CREATE INDEX questions_category_difficulty_level_id ON questions(category, difficulty, level, id);
CREATE INDEX questions_subcategory_id ON questions(subcategory, id);
CREATE UNIQUE INDEX games_join_code_unique ON games(join_code);
CREATE INDEX games_host_lifecycle ON games(host_id, deleted_at, lifecycle, starts_at);
CREATE INDEX games_lifecycle_deleted ON games(lifecycle, deleted_at);
CREATE UNIQUE INDEX rounds_game_ordinal_active ON rounds(game_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX rounds_game_deleted ON rounds(game_id, deleted_at);
CREATE UNIQUE INDEX game_teams_name_active ON game_teams(game_id, name) WHERE deleted_at IS NULL;
CREATE INDEX game_teams_game_deleted ON game_teams(game_id, deleted_at);
CREATE INDEX game_players_game_team_user ON game_players(game_id, team_id, user_id);
CREATE INDEX game_players_team_game ON game_players(team_id, game_id);
CREATE INDEX game_players_user_left_game ON game_players(user_id, left_at, game_id);
CREATE UNIQUE INDEX game_questions_round_ordinal_active ON game_questions(round_id, ordinal) WHERE retired_at IS NULL;
CREATE INDEX game_questions_round_game ON game_questions(round_id, game_id);
CREATE INDEX game_questions_game_round_retired ON game_questions(game_id, round_id, retired_at);
CREATE INDEX assignment_private_question ON assignment_private(question_id);
CREATE INDEX game_state_round ON game_state_public(round_id, id);
CREATE INDEX game_state_assignment ON game_state_public(assignment_id, id, round_id);
CREATE UNIQUE INDEX used_question_history_host_operation_question ON used_question_history(host_id, operation_id, question_id);
CREATE INDEX used_question_history_host_question ON used_question_history(host_id, question_id);
CREATE INDEX used_question_history_question ON used_question_history(question_id);
CREATE INDEX used_question_history_game_host ON used_question_history(game_id, host_id);
CREATE INDEX used_question_history_game_created ON used_question_history(game_id, created_at);
CREATE INDEX game_answers_game_team_assignment ON game_answers(game_id, team_id, assignment_id);
CREATE INDEX game_answers_assignment_game ON game_answers(assignment_id, game_id);
CREATE INDEX game_answers_team_game ON game_answers(team_id, game_id);
CREATE INDEX game_answers_player_game_team ON game_answers(accepted_player_id, game_id, team_id);
CREATE INDEX displays_host_game ON displays(host_id, game_id);
CREATE INDEX displays_game_host ON displays(game_id, host_id);
CREATE UNIQUE INDEX displays_code_hash_unique ON displays(code_hash) WHERE code_hash IS NOT NULL;
CREATE INDEX displays_expires ON displays(expires_at);
CREATE INDEX displays_last_seen ON displays(last_seen_at);
CREATE INDEX pairing_limits_updated ON pairing_limits(updated_at);
CREATE INDEX online_game_last_seen ON online(game_id, last_seen_at);
CREATE INDEX online_player_game ON online(id, game_id);
CREATE UNIQUE INDEX audit_user_operation ON audit_events(actor_user_id, operation_id) WHERE actor_user_id IS NOT NULL;
CREATE UNIQUE INDEX audit_device_operation ON audit_events(actor_device_id, operation_id) WHERE actor_device_id IS NOT NULL;
CREATE INDEX audit_entity_created ON audit_events(entity_type, entity_id, created_at);
CREATE INDEX audit_created ON audit_events(created_at);
