-- P01 schema readiness only. The launcher gives this read-only API a fresh per-start name.
CREATE TABLE bootstrap_ready (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1)
) STRICT;
INSERT INTO bootstrap_ready (id, schema_version) VALUES (1, 1);
