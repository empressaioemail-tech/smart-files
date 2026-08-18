-- Fixture for the CI round-trip probe only. Mirrors the shape
-- scripts/seed_isolation_probe.py writes to the real files Neon, so the probe
-- can exercise `g58-probe` as a read-only live tenant slug (it has no QA
-- persona and therefore no write path).
--
-- Never applied by a migration. Never applied to a real database.

INSERT INTO smart_file_documents
  (entity_id, scope_type, scope_id, jurisdiction_fips, doc_slug, title)
VALUES
  ('smartfile:tenant:g58-probe:isolation-note', 'tenant', 'g58-probe', NULL,
   'isolation-note', 'G-58 isolation probe'),
  ('smartfile:site:parcel:48021:R12345:g58-geotech', 'site', 'parcel:48021:R12345', NULL,
   'g58-geotech', 'G-58 site geotech probe')
ON CONFLICT (entity_id) DO NOTHING;

INSERT INTO smart_file_versions
  (document_id, document_entity_id, version, content_cid, content_type, byte_size, provenance)
SELECT id, entity_id, 1, 'bafyG58probe0001', 'text/plain', 32,
       '{"sourceLabel":"g58-isolation-probe"}'::jsonb
  FROM smart_file_documents
 WHERE entity_id IN ('smartfile:tenant:g58-probe:isolation-note',
                     'smartfile:site:parcel:48021:R12345:g58-geotech')
ON CONFLICT (document_id, version) DO NOTHING;

INSERT INTO smart_file_folders (folder_id, scope_type, scope_id, label, created_by)
VALUES ('folder:tenant:g58-probe:room', 'tenant', 'g58-probe', 'room', 'seed')
ON CONFLICT (folder_id) DO NOTHING;

INSERT INTO smart_file_placements
  (document_id, document_entity_id, target_type, target_id, placed_by)
SELECT id, entity_id, 'folder', 'folder:tenant:g58-probe:room', 'g58-seed'
  FROM smart_file_documents
 WHERE entity_id IN ('smartfile:tenant:g58-probe:isolation-note',
                     'smartfile:site:parcel:48021:R12345:g58-geotech')
ON CONFLICT (document_id, target_type, target_id) DO NOTHING;
