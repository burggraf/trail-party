#!/usr/bin/env python3
"""Verify an imported question snapshot against an owned TrailBase depot."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import sys
from collections import Counter
from contextlib import closing
from pathlib import Path

from import_questions import (
    TARGET_COLUMNS,
    check_depot,
    check_source_schema,
    import_questions,
    open_read_only,
    source_batches,
    target_schema,
)


class VerificationFailure(Exception):
    pass


def as_bytes(value):
    try:
        return bytes(value)
    except Exception:
        return b""


def is_uuid(value):
    return int(len(as_bytes(value)) == 16)


def is_uuid_v7(value):
    raw = as_bytes(value)
    return int(len(raw) == 16 and (raw[6] >> 4) == 7 and (raw[8] & 0xC0) == 0x80)


def is_email(value):
    return int(value is None or bool(re.fullmatch(r"[^@\s]+@[^@\s]+", str(value))))


def type_matches(value, expected):
    if isinstance(expected, list):
        return any(type_matches(value, item) for item in expected)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "null":
        return value is None
    if expected == "boolean":
        return isinstance(value, bool)
    return True


def schema_matches(schema, value):
    if "type" in schema and not type_matches(value, schema["type"]):
        return False
    if "enum" in schema and value not in schema["enum"]:
        return False
    if isinstance(value, dict):
        if any(key not in value for key in schema.get("required", [])):
            return False
        if schema.get("additionalProperties") is False and any(key not in schema.get("properties", {}) for key in value):
            return False
        return all(schema_matches(schema.get("properties", {}).get(key, {}), item) for key, item in value.items())
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", len(value)):
            return False
        if schema.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
            return False
        return all(schema_matches(schema.get("items", {}), item) for item in value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value >= schema.get("minimum", value) and value <= schema.get("maximum", value)
    return True


def jsonschema_matches(schema_text, value_text):
    try:
        return int(schema_matches(json.loads(schema_text), json.loads(value_text)))
    except Exception:
        return 0


def jsonschema(_name, value_text, *_options):
    try:
        json.loads(value_text)
        return 1
    except Exception:
        return 0


def register_sqlite_functions(connection):
    connection.create_function("is_uuid", 1, is_uuid)
    connection.create_function("is_uuid_v7", 1, is_uuid_v7)
    connection.create_function("is_email", 1, is_email)
    connection.create_function("jsonschema", -1, jsonschema)
    connection.create_function("jsonschema_matches", 2, jsonschema_matches)


def update_digest(digest, row) -> None:
    payload = dict(zip(TARGET_COLUMNS, row))
    digest.update(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    digest.update(b"\n")


def source_summary(connection: sqlite3.Connection) -> dict:
    source_count = connection.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    digest = hashlib.sha256()
    distributions = {"category": Counter(), "difficulty": Counter()}
    count = 0
    for batch in source_batches(connection):
        for row in batch:
            count += 1
            distributions["category"][row[2]] += 1
            distributions["difficulty"][row[4]] += 1
            update_digest(digest, row)
    if count != source_count:
        raise VerificationFailure(f"source row count changed during read: {source_count} != {count}")
    return {
        "count": count,
        "digest": digest.hexdigest(),
        "distributions": {name: dict(sorted(values.items())) for name, values in distributions.items()},
    }


def target_summary(connection: sqlite3.Connection) -> dict:
    target_schema(connection)
    count = 0
    distinct_source_ids = connection.execute("SELECT COUNT(DISTINCT source_id) FROM questions").fetchone()[0]
    digest = hashlib.sha256()
    distributions = {"category": Counter(), "difficulty": Counter()}
    cursor = connection.execute("SELECT " + ", ".join(TARGET_COLUMNS) + " FROM questions ORDER BY source_id")
    for raw in cursor:
        row = list(raw)
        if row[10] is not None:
            row[10] = float(row[10])
            if not math.isfinite(row[10]):
                raise VerificationFailure("target contains a non-finite level")
        row = tuple(row)
        count += 1
        distributions["category"][row[2]] += 1
        distributions["difficulty"][row[4]] += 1
        update_digest(digest, row)
    return {
        "count": count,
        "distinct_source_ids": distinct_source_ids,
        "digest": digest.hexdigest(),
        "distributions": {name: dict(sorted(values.items())) for name, values in distributions.items()},
    }


def verify(source: Path, depot: Path) -> dict:
    with closing(open_read_only(source)) as source_db:
        check_source_schema(source_db)
        source_info = source_summary(source_db)

    database = check_depot(depot)
    with closing(sqlite3.connect(database)) as target_db:
        register_sqlite_functions(target_db)
        target_db.execute("PRAGMA foreign_keys = ON")
        integrity = target_db.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = target_db.execute("PRAGMA foreign_key_check").fetchall()
        target_info = target_summary(target_db)

    if integrity != "ok":
        raise VerificationFailure(f"SQLite integrity_check returned {integrity!r}")
    if foreign_keys:
        raise VerificationFailure(f"SQLite foreign_key_check returned {len(foreign_keys)} rows")
    if source_info["count"] != target_info["count"]:
        raise VerificationFailure(f"source/target count mismatch: {source_info['count']} != {target_info['count']}")
    if target_info["distinct_source_ids"] != target_info["count"]:
        raise VerificationFailure("target contains duplicate source IDs")
    if source_info["digest"] != target_info["digest"]:
        raise VerificationFailure("source/target canonical digest mismatch")
    if source_info["distributions"] != target_info["distributions"]:
        raise VerificationFailure("source/target distributions mismatch")

    rerun = import_questions(source, depot, False)
    if rerun["imported_count"] != 0 or rerun["skipped_count"] != source_info["count"]:
        raise VerificationFailure(
            f"idempotent rerun changed rows: imported={rerun['imported_count']} skipped={rerun['skipped_count']}"
        )

    with closing(sqlite3.connect(database)) as target_db:
        register_sqlite_functions(target_db)
        target_db.execute("PRAGMA foreign_keys = ON")
        after_rerun = target_summary(target_db)
    if after_rerun != target_info:
        raise VerificationFailure("idempotent rerun changed the target digest or distribution")

    return {
        "source": str(source),
        "depot": str(depot),
        "source_count": source_info["count"],
        "target_count": target_info["count"],
        "source_digest": source_info["digest"],
        "target_digest": target_info["digest"],
        "distributions": source_info["distributions"],
        "integrity_check": integrity,
        "foreign_key_errors": len(foreign_keys),
        "rerun": {
            "imported_count": rerun["imported_count"],
            "skipped_count": rerun["skipped_count"],
            "source_digest": rerun["source_digest"],
            "target_digest": rerun["target_digest"],
        },
    }


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Read-only source snapshot")
    parser.add_argument("--depot", required=True, type=Path, help="Owned stopped TrailBase depot")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    return parser.parse_args(argv)


def main() -> int:
    try:
        args = arguments()
        print(json.dumps(verify(args.source, args.depot), ensure_ascii=False, sort_keys=True))
        return 0
    except (VerificationFailure, sqlite3.DatabaseError, OSError, ValueError) as error:
        print(f"Corpus verification failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
