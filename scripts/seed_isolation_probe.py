"""Seed one tenant-private probe doc on the files DB only. Never prints the DSN."""

from __future__ import annotations

import pathlib
import sys

import psycopg

DSN_PATH = pathlib.Path.home() / ".empressa" / "smart-files.database_url"
ENTITY_ID = "smartfile:tenant:g58-probe:isolation-note"
SITE_ID = "smartfile:site:parcel:48021:R12345:g58-geotech"


def dsn() -> str:
    raw = DSN_PATH.read_text(encoding="utf-8").strip().strip("\ufeff").strip('"').strip("'")
    if "fancy-fire" in raw or "lucky-truth" in raw:
        raise SystemExit("refusing to seed: DSN host looks like cortex-prod")
    return raw


def main() -> None:
    with psycopg.connect(dsn()) as conn:
        # Omit access_policy so the column default must fire.
        doc = conn.execute(
            """
            INSERT INTO smart_file_documents
              (entity_id, scope_type, scope_id, jurisdiction_fips, doc_slug, title)
            VALUES
              (%s, 'tenant', 'g58-probe', NULL, 'isolation-note', 'G-58 isolation probe')
            ON CONFLICT (entity_id) DO UPDATE
              SET title = EXCLUDED.title
            RETURNING id, access_policy
            """,
            (ENTITY_ID,),
        ).fetchone()
        site = conn.execute(
            """
            INSERT INTO smart_file_documents
              (entity_id, scope_type, scope_id, jurisdiction_fips, doc_slug, title)
            VALUES
              (%s, 'site', 'parcel:48021:R12345', NULL, 'g58-geotech', 'G-58 site geotech probe')
            ON CONFLICT (entity_id) DO UPDATE
              SET title = EXCLUDED.title
            RETURNING id, access_policy
            """,
            (SITE_ID,),
        ).fetchone()
        for row, entity, cid in (
            (doc, ENTITY_ID, "bafyG58isolationnote0001"),
            (site, SITE_ID, "bafyG58sitegeotech0001"),
        ):
            conn.execute(
                """
                INSERT INTO smart_file_versions
                  (document_id, document_entity_id, version, content_cid, content_type,
                   byte_size, provenance)
                VALUES
                  (%s, %s, 1, %s, 'text/plain', 32,
                   '{"sourceLabel":"g58-isolation-probe","sourceUri":"local"}'::jsonb)
                ON CONFLICT (document_id, version) DO NOTHING
                """,
                (row[0], entity, cid),
            )
            conn.execute(
                """
                INSERT INTO smart_file_placements
                  (document_id, document_entity_id, target_type, target_id, placed_by)
                VALUES
                  (%s, %s, 'folder', 'folder:tenant:g58-probe:room', 'g58-seed')
                ON CONFLICT (document_id, target_type, target_id) DO NOTHING
                """,
                (row[0], entity),
            )
        conn.commit()
        print(f"seeded entity={ENTITY_ID} access_policy={doc[1]}")
        print(f"seeded entity={SITE_ID} access_policy={site[1]}")


if __name__ == "__main__":
    sys.exit(main())
