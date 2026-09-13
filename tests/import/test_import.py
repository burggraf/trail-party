#!/usr/bin/env python3
import json
import signal
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[2]
IMPORTER = REPOSITORY / "scripts" / "import_questions.py"
OWNER = f"trail-party-import-v1\n{REPOSITORY}\n"
class ImportQuestionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trail-party-import-")
        self.root = Path(self.temp.name)
        self.source = self.root / "source.db"
        self.depot = self.root / "depot"
        self.make_depot(self.depot)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def make_depot(depot: Path):
        (depot / "data").mkdir(parents=True)
        (depot / ".owner").write_text(OWNER)
        with sqlite3.connect(depot / "data" / "main.db") as db:
            db.executescript(
                """
                CREATE TABLE questions (
                  id INTEGER PRIMARY KEY,
                  source_id TEXT NOT NULL UNIQUE,
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
                  ingested_at INTEGER NOT NULL DEFAULT (unixepoch())
                ) STRICT;
                """
            )

    def make_source(self, rows, *, nullable=True):
        with sqlite3.connect(self.source) as db:
            db.execute(
                """
                CREATE TABLE questions (
                  id TEXT PRIMARY KEY,
                  external_id TEXT,
                  category TEXT,
                  subcategory TEXT,
                  difficulty TEXT,
                  question TEXT,
                  answer_a TEXT,
                  answer_b TEXT,
                  answer_c TEXT,
                  answer_d TEXT,
                  level NUMERIC,
                  metadata TEXT,
                  imported_at TEXT
                )
                """
            )
            db.executemany(
                "INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )

    def run_import(self, *extra, check=False):
        result = subprocess.run(
            ["pnpm", "import:questions", "--", "--source", str(self.source), "--depot", str(self.depot), *extra],
            cwd=REPOSITORY,
            text=True,
            capture_output=True,
            check=False,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def run_verify(self, source, *, check=False):
        result = subprocess.run(
            ["pnpm", "verify:corpus", "--", "--source", str(source), "--depot", str(self.depot)],
            cwd=REPOSITORY,
            text=True,
            capture_output=True,
            check=False,
        )
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def report(self, result):
        self.assertTrue(result.stdout.strip(), result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def target_rows(self):
        with sqlite3.connect(self.depot / "data" / "main.db") as db:
            return db.execute(
                "SELECT source_id, external_id, category, subcategory, difficulty, question, "
                "answer_a, answer_b, answer_c, answer_d, level, metadata, imported_at "
                "FROM questions ORDER BY source_id"
            ).fetchall()

    def valid_rows(self):
        return [
            (
                "q-α",
                "same-external",
                "History",
                "Ancient Civilizations",
                "medium",
                "Who said \"hello\"?\n多言語",
                "Ada",
                "Grace",
                "Edsger",
                "Alan",
                2,
                "",
                "2025-01-02T03:04:05.000Z",
            ),
            (
                "q-β",
                "same-external",
                "",
                "",
                "hard",
                "Empty optional values stay empty.",
                "A",
                "B",
                "C",
                "D",
                None,
                None,
                None,
            ),
            (
                "q-γ",
                "other",
                "Science",
                "Physics",
                "easy",
                "Unicode: café 🚀",
                "one",
                "two",
                "three",
                "four",
                0.5,
                "{\"raw\":true}",
                "",
            ),
        ]

    def test_missing_source_creates_no_destination_state(self):
        missing = self.root / "missing.db"
        depot = self.root / "missing-destination"
        result = subprocess.run(
            ["pnpm", "import:questions", "--", "--source", str(missing), "--depot", str(depot)],
            cwd=REPOSITORY,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(depot.exists())

    def test_dry_run_reports_snapshot_without_inserting_rows(self):
        self.make_source(self.valid_rows())
        result = self.run_import("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        report = self.report(result)
        self.assertTrue(report["dry_run"])
        self.assertEqual(report["source_count"], 3)
        self.assertEqual(report["valid_count"], 3)
        self.assertEqual(report["imported_count"], 0)
        self.assertEqual(self.target_rows(), [])
        self.assertTrue(Path(report["snapshot"]).is_file())
        self.assertEqual(report["source_open_mode"], "read-only-backup")

    def test_import_preserves_all_fields_and_allows_duplicate_external_ids(self):
        self.make_source(self.valid_rows())
        result = self.run_import(check=True)
        report = self.report(result)
        expected = sorted(self.valid_rows(), key=lambda row: row[0])
        self.assertEqual(self.target_rows(), expected)
        self.assertEqual(report["source_count"], 3)
        self.assertEqual(report["imported_count"], 3)
        self.assertEqual(report["skipped_count"], 0)
        self.assertEqual(report["rejected_count"], 0)
        self.assertEqual(report["source_digest"], report["target_digest"])
        self.assertTrue(Path(report["manifest"]).is_file())

    def test_repeat_is_idempotent_and_digest_stable(self):
        self.make_source(self.valid_rows())
        first = self.report(self.run_import(check=True))
        second = self.report(self.run_import(check=True))
        self.assertEqual(second["imported_count"], 0)
        self.assertEqual(second["skipped_count"], 3)
        self.assertEqual(second["source_digest"], first["source_digest"])
        self.assertEqual(second["target_digest"], first["target_digest"])
        self.assertEqual(len(self.target_rows()), 3)

    def test_interrupt_rolls_back_and_a_later_process_resumes(self):
        rows = []
        for index in range(3000):
            row = list(self.valid_rows()[index % 3])
            row[0] = f"q-{index:04d}"
            rows.append(tuple(row))
        self.make_source(rows)
        process = subprocess.Popen(
            [
                sys.executable,
                str(IMPORTER),
                "--source",
                str(self.source),
                "--depot",
                str(self.depot),
                "--progress",
            ],
            cwd=REPOSITORY,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            first_error_line = process.stderr.readline()
            self.assertIn('"phase": "import"', first_error_line)
            process.send_signal(signal.SIGINT)
            stdout, stderr = process.communicate(timeout=10)
            self.assertNotEqual(process.returncode, 0, stdout)
            self.assertIn("interrupted", stderr.lower())
            self.assertEqual(self.target_rows(), [])
        finally:
            if process.poll() is None:
                process.terminate()
                process.communicate(timeout=10)
        resumed = self.report(self.run_import(check=True))
        self.assertEqual(resumed["imported_count"], 3000)
        self.assertEqual(resumed["skipped_count"], 0)

    def test_manifest_records_counts_digests_and_distributions(self):
        self.make_source(self.valid_rows())
        report = self.report(self.run_import(check=True))
        manifest = json.loads(Path(report["manifest"]).read_text(encoding="utf-8"))
        self.assertEqual(manifest["source_snapshot_count"], 3)
        self.assertEqual(manifest["target_imported_count"], 3)
        self.assertEqual(manifest["error_count"], 0)
        self.assertEqual(manifest["distributions"]["difficulty"], {"easy": 1, "hard": 1, "medium": 1})
        self.assertEqual(manifest["source_digest"], manifest["target_digest"])

    def test_verify_corpus_checks_integrity_and_runs_idempotent_import(self):
        self.make_source(self.valid_rows())
        imported = self.report(self.run_import(check=True))
        verified = self.run_verify(imported["snapshot"], check=True)
        report = self.report(verified)
        self.assertEqual(report["source_count"], 3)
        self.assertEqual(report["target_count"], 3)
        self.assertEqual(report["source_digest"], report["target_digest"])
        self.assertEqual(report["rerun"]["imported_count"], 0)
        self.assertEqual(report["rerun"]["skipped_count"], 3)
        self.assertEqual(report["integrity_check"], "ok")
        self.assertEqual(report["foreign_key_errors"], 0)

    def test_invalid_required_or_numeric_values_fail_without_partial_rows(self):
        bad = list(self.valid_rows()[0])
        bad[5] = None
        malformed_level = list(self.valid_rows()[1])
        malformed_level[10] = "not-a-number"
        self.make_source([tuple(bad), tuple(malformed_level)])
        result = self.run_import()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid", result.stderr.lower())
        self.assertEqual(self.target_rows(), [])

    def test_source_change_conflict_does_not_mutate_target(self):
        self.make_source(self.valid_rows())
        self.run_import(check=True)
        with sqlite3.connect(self.source) as db:
            db.execute("UPDATE questions SET question = ? WHERE id = ?", ("changed", "q-α"))
        result = self.run_import()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("conflict", result.stderr.lower())
        self.assertEqual(self.target_rows()[0][5], "Who said \"hello\"?\n多言語")

    def test_unowned_and_locked_destinations_are_refused(self):
        self.make_source(self.valid_rows())
        unowned = self.root / "unowned"
        self.make_depot(unowned)
        (unowned / ".owner").write_text("someone-else\n")
        result = subprocess.run(
            ["pnpm", "import:questions", "--", "--source", str(self.source), "--depot", str(unowned)],
            cwd=REPOSITORY,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("owner", result.stderr.lower())
        (self.depot.parent / f"{self.depot.name}.lock").mkdir()
        result = self.run_import()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("locked", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
