#!/usr/bin/env python3
"""Safely copy the reference questions table into an owned TrailBase depot."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import signal
import sqlite3
import stat
import sys
import tempfile
from contextlib import closing
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[1]
BATCH_SIZE = 1000
SOURCE_COLUMNS = (
    "id",
    "external_id",
    "category",
    "subcategory",
    "difficulty",
    "question",
    "answer_a",
    "answer_b",
    "answer_c",
    "answer_d",
    "level",
    "metadata",
    "imported_at",
)
TARGET_COLUMNS = (
    "source_id",
    "external_id",
    "category",
    "subcategory",
    "difficulty",
    "question",
    "answer_a",
    "answer_b",
    "answer_c",
    "answer_d",
    "level",
    "metadata",
    "imported_at",
)
REQUIRED_TEXT_COLUMNS = {
    "id",
    "category",
    "subcategory",
    "difficulty",
    "question",
    "answer_a",
    "answer_b",
    "answer_c",
    "answer_d",
}
OPTIONAL_TEXT_COLUMNS = {"external_id", "metadata", "imported_at"}
OWNER_KINDS = {"trail-party-dev-v1", "trail-party-import-v1"}


class ImportFailure(Exception):
    pass


def regular_file(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError as error:
        raise ImportFailure(f"{label} does not exist: {path}") from error
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ImportFailure(f"{label} must be a regular, non-linked file: {path}")


def safe_directory(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError as error:
        raise ImportFailure(f"{label} does not exist: {path}") from error
    if path.is_symlink() or not stat.S_ISDIR(info.st_mode):
        raise ImportFailure(f"{label} must be a real directory: {path}")


def open_read_only(path: Path) -> sqlite3.Connection:
    regular_file(path, "Source database")
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.execute("PRAGMA query_only = ON")
    if connection.execute("PRAGMA query_only").fetchone()[0] != 1:
        connection.close()
        raise ImportFailure("Source database did not open query-only")
    return connection


def check_source_schema(connection: sqlite3.Connection) -> None:
    try:
        names = {row[1] for row in connection.execute("PRAGMA table_info(questions)")}
    except sqlite3.DatabaseError as error:
        raise ImportFailure("Source database is not a readable SQLite database") from error
    missing = [column for column in SOURCE_COLUMNS if column not in names]
    if missing:
        raise ImportFailure(f"Source questions table is missing columns: {', '.join(missing)}")


def check_depot(depot: Path) -> Path:
    safe_directory(depot, "Destination depot")
    marker = depot / ".owner"
    regular_file(marker, "Destination owner marker")
    lines = marker.read_text(encoding="utf-8").splitlines()
    if len(lines) != 2 or lines[0] not in OWNER_KINDS or lines[1] != str(REPOSITORY):
        raise ImportFailure("Destination owner marker does not belong to this repository")
    cooperative_lock = Path(f"{depot}.lock")
    if cooperative_lock.exists() or cooperative_lock.is_symlink():
        raise ImportFailure("Destination depot is locked; stop TrailBase before importing")
    data = depot / "data"
    safe_directory(data, "Destination data directory")
    database = data / "main.db"
    regular_file(database, "Destination database")
    if database.resolve() == depot.resolve():
        raise ImportFailure("Destination database path is invalid")
    return database


def acquire_import_lock(depot: Path) -> Path:
    lock = Path(f"{depot}.import.lock")
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as error:
        raise ImportFailure("Destination import is already locked") from error
    except OSError as error:
        raise ImportFailure("Could not create destination import lock") from error
    return lock


def snapshot_source(source: Path, snapshot: Path) -> None:
    parent = snapshot.parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    safe_directory(parent, "Snapshot directory")
    if snapshot.exists() or snapshot.is_symlink():
        regular_file(snapshot, "Existing snapshot")
    fd, temporary_name = tempfile.mkstemp(prefix=".questions-", suffix=".sqlite", dir=parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with closing(open_read_only(source)) as source_db, closing(sqlite3.connect(temporary)) as snapshot_db:
            source_db.backup(snapshot_db)
            snapshot_db.execute("PRAGMA journal_mode = DELETE")
            snapshot_db.commit()
        os.chmod(temporary, 0o600)
        os.replace(temporary, snapshot)
    finally:
        temporary.unlink(missing_ok=True)


def text_value(value, column: str, row_number: int, *, required: bool):
    if value is None:
        if required:
            raise ImportFailure(f"Invalid row {row_number}: {column} is NULL")
        return None
    if not isinstance(value, str):
        raise ImportFailure(f"Invalid row {row_number}: {column} is not text")
    if required and column == "id" and not value:
        raise ImportFailure(f"Invalid row {row_number}: id is empty")
    return value


def map_row(row: sqlite3.Row, row_number: int) -> tuple:
    values = {}
    for column in REQUIRED_TEXT_COLUMNS:
        values[column] = text_value(row[column], column, row_number, required=True)
    for column in OPTIONAL_TEXT_COLUMNS:
        values[column] = text_value(row[column], column, row_number, required=False)
    level = row["level"]
    if level is not None:
        if isinstance(level, bool) or not isinstance(level, (int, float)):
            raise ImportFailure(f"Invalid row {row_number}: level is not numeric")
        level = float(level)
        if not math.isfinite(level):
            raise ImportFailure(f"Invalid row {row_number}: level is not finite")
    return (
        values["id"],
        values["external_id"],
        values["category"],
        values["subcategory"],
        values["difficulty"],
        values["question"],
        values["answer_a"],
        values["answer_b"],
        values["answer_c"],
        values["answer_d"],
        level,
        values["metadata"],
        values["imported_at"],
    )


def source_batches(connection: sqlite3.Connection):
    connection.row_factory = sqlite3.Row
    query = "SELECT " + ", ".join(SOURCE_COLUMNS) + " FROM questions ORDER BY id"
    cursor = connection.execute(query)
    row_number = 0
    while True:
        rows = cursor.fetchmany(BATCH_SIZE)
        if not rows:
            return
        batch = []
        for row in rows:
            row_number += 1
            batch.append(map_row(row, row_number))
        yield batch


def digest_rows(rows) -> str:
    digest = hashlib.sha256()
    for row in rows:
        payload = dict(zip(TARGET_COLUMNS, row))
        digest.update(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def target_schema(connection: sqlite3.Connection) -> None:
    names = {row[1] for row in connection.execute("PRAGMA table_info(questions)")}
    missing = [column for column in TARGET_COLUMNS if column not in names]
    if missing:
        raise ImportFailure(f"Destination questions table is missing columns: {', '.join(missing)}")


def target_rows(connection: sqlite3.Connection, source_ids: list[str]) -> dict[str, tuple]:
    if not source_ids:
        return {}
    placeholders = ",".join("?" for _ in source_ids)
    query = (
        "SELECT " + ", ".join(TARGET_COLUMNS) + f" FROM questions WHERE source_id IN ({placeholders})"
    )
    result = {}
    for row in connection.execute(query, source_ids):
        values = list(row)
        if values[10] is not None:
            values[10] = float(values[10])
        result[values[0]] = tuple(values)
    return result


def canonical_target_digest(connection: sqlite3.Connection, source_ids: list[str]) -> tuple[int, str]:
    rows = target_rows(connection, source_ids)
    ordered = [rows[source_id] for source_id in sorted(source_ids) if source_id in rows]
    return len(ordered), digest_rows(ordered)


def write_manifest(path: Path, report: dict) -> None:
    if path.exists() or path.is_symlink():
        regular_file(path, "Existing manifest")
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def import_questions(source: Path, depot: Path, dry_run: bool) -> dict:
    source = source.expanduser()
    depot = depot.expanduser()
    if not source.is_absolute():
        source = (Path.cwd() / source).resolve()
    if not depot.is_absolute():
        depot = (Path.cwd() / depot).resolve()
    regular_file(source, "Source database")
    database = check_depot(depot)
    if source.resolve() == database.resolve() or os.path.samefile(source, database):
        raise ImportFailure("Source and destination database must be different")
    lock = acquire_import_lock(depot)
    snapshot = depot / "import" / "questions.snapshot.sqlite"
    manifest = depot / "import" / "questions.manifest.json"
    try:
        snapshot_source(source, snapshot)
        with closing(open_read_only(snapshot)) as source_db:
            check_source_schema(source_db)
            source_count = source_db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
            source_digest = hashlib.sha256()
            source_ids = []
            valid_count = 0
            for batch in source_batches(source_db):
                valid_count += len(batch)
                for row in batch:
                    source_ids.append(row[0])
                    payload = dict(zip(TARGET_COLUMNS, row))
                    source_digest.update(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
                    source_digest.update(b"\n")
            if source_count != valid_count:
                raise ImportFailure(f"Invalid source rows: {source_count - valid_count} rejected")
            source_digest_hex = source_digest.hexdigest()

        with closing(sqlite3.connect(database)) as target_db:
            target_db.execute("PRAGMA foreign_keys = ON")
            target_schema(target_db)
            imported_count = 0
            skipped_count = 0
            if not dry_run:
                target_db.execute("BEGIN IMMEDIATE")
                try:
                    with closing(open_read_only(snapshot)) as source_db:
                        for batch in source_batches(source_db):
                            existing = target_rows(target_db, [row[0] for row in batch])
                            inserts = []
                            for row in batch:
                                old = existing.get(row[0])
                                if old is None:
                                    inserts.append(row)
                                elif old != row:
                                    raise ImportFailure(f"Source conflict for source_id {row[0]}")
                                else:
                                    skipped_count += 1
                            if inserts:
                                target_db.executemany(
                                    "INSERT INTO questions (" + ", ".join(TARGET_COLUMNS) + ") VALUES (" + ", ".join("?" for _ in TARGET_COLUMNS) + ")",
                                    inserts,
                                )
                                imported_count += len(inserts)
                    target_db.commit()
                except BaseException:
                    target_db.rollback()
                    raise
            imported_rows, target_digest = canonical_target_digest(target_db, source_ids)
            target_total_count = target_db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]

        report = {
            "source": str(source),
            "snapshot": str(snapshot),
            "depot": str(depot),
            "manifest": str(manifest),
            "source_open_mode": "read-only-backup",
            "dry_run": dry_run,
            "source_count": source_count,
            "valid_count": valid_count,
            "rejected_count": 0,
            "imported_count": imported_count,
            "skipped_count": skipped_count,
            "target_imported_count": imported_rows,
            "target_total_count": target_total_count,
            "source_digest": source_digest_hex,
            "target_digest": target_digest,
        }
        if not dry_run:
            write_manifest(manifest, report)
        return report
    finally:
        try:
            lock.rmdir()
        except OSError:
            pass


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="PocketBase questions SQLite database")
    parser.add_argument("--depot", required=True, type=Path, help="Owned stopped TrailBase depot")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without inserting rows")
    argv = sys.argv[1:]
    if argv[:1] == ["--"]:
        argv = argv[1:]
    return parser.parse_args(argv)


def main() -> int:
    args = arguments()
    try:
        def stop(_signum, _frame):
            raise ImportFailure("Import interrupted; no rows were committed")

        old_handler = signal.signal(signal.SIGINT, stop)
        try:
            report = import_questions(args.source, args.depot, args.dry_run)
        finally:
            signal.signal(signal.SIGINT, old_handler)
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 0
    except (ImportFailure, sqlite3.DatabaseError, OSError, ValueError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
