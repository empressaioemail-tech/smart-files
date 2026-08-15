"""Apply sql/001_foundation.sql to the files Neon. Reads DSN from disk. Never prints it."""

from __future__ import annotations

import pathlib
import sys

import psycopg

ROOT = pathlib.Path(__file__).resolve().parents[1]
SQL = (ROOT / "sql" / "001_foundation.sql").read_text(encoding="utf-8")
DSN_PATH = pathlib.Path.home() / ".empressa" / "smart-files.database_url"


def dsn() -> str:
    raw = DSN_PATH.read_text(encoding="utf-8").strip().strip("\ufeff").strip('"').strip("'")
    if "fancy-fire" in raw or "lucky-truth" in raw:
        raise SystemExit("refusing to apply: DSN host looks like cortex-prod")
    if "winter-shape" not in raw and "c-12.us-east-1" not in raw:
        raise SystemExit("refusing to apply: DSN host is not the files project")
    return raw


def main() -> None:
    with psycopg.connect(dsn()) as conn:
        conn.execute(SQL)
        conn.commit()
        rows = conn.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name LIKE 'smart_file_%'
            ORDER BY table_name
            """
        ).fetchall()
    print("applied tables=" + ",".join(r[0] for r in rows))


if __name__ == "__main__":
    sys.exit(main())
