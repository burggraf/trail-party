-- Synthetic capability fixture, never used as gameplay schema.
CREATE TABLE probe_ready (id INTEGER PRIMARY KEY) STRICT;
INSERT INTO probe_ready(id) VALUES (1);
CREATE TABLE probe_items (
  id BLOB PRIMARY KEY NOT NULL DEFAULT (uuid_v7()) CHECK (is_uuid_v7(id)),
  owner BLOB NOT NULL REFERENCES _user(id),
  bucket TEXT NOT NULL,
  text TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (jsonschema_matches('{"type":"object"}', payload)),
  created INTEGER NOT NULL DEFAULT (unixepoch()),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
) STRICT;

CREATE TABLE probe_audit (
  id INTEGER PRIMARY KEY,
  item BLOB NOT NULL REFERENCES probe_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  label TEXT NOT NULL CHECK (label != 'rollback-probe'),
  UNIQUE(item, version)
) STRICT;
