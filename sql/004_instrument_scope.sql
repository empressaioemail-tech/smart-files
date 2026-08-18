-- TW-4: add the `instrument` scope. Smart Files' second consumer.
-- Own database only (Neon smart-files / snowy-bread-83475727).
-- Never apply to cortex-prod / atoms. Never touch migrations 0078-0081 there.
--
-- Widens three CHECK constraints and nothing else. In particular
-- smart_file_absence_determinations is NOT touched: `not-applicable` stays a
-- twin-layer concept, and if the first consumer meets the same wall the store
-- changes once, deliberately.
--
-- Re-runnable: every constraint is dropped if present before being re-added.

ALTER TABLE smart_file_documents
  DROP CONSTRAINT IF EXISTS smart_file_documents_scope_type_check;
ALTER TABLE smart_file_documents
  ADD CONSTRAINT smart_file_documents_scope_type_check
  CHECK (scope_type IN ('jurisdiction', 'tenant', 'site', 'instrument'));

ALTER TABLE smart_file_folders
  DROP CONSTRAINT IF EXISTS smart_file_folders_scope_type_check;
ALTER TABLE smart_file_folders
  ADD CONSTRAINT smart_file_folders_scope_type_check
  CHECK (scope_type IN ('jurisdiction', 'tenant', 'site', 'instrument'));

ALTER TABLE smart_file_placements
  DROP CONSTRAINT IF EXISTS smart_file_placements_target_type_check;
ALTER TABLE smart_file_placements
  ADD CONSTRAINT smart_file_placements_target_type_check
  CHECK (target_type IN (
    'folder',
    'parcel',
    'project',
    'asset',
    'permit',
    'meeting',
    'instrument'
  ));

-- jurisdiction_fips stays NULL on instrument rows. It is already nullable and
-- the write path never populates it outside scope_type = 'jurisdiction', so
-- this is an assertion rather than a change. It fails loudly if that ever
-- stops being true.
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM smart_file_documents
   WHERE jurisdiction_fips IS NOT NULL
     AND scope_type <> 'jurisdiction';
  IF bad > 0 THEN
    RAISE EXCEPTION 'jurisdiction_fips is populated on % non-jurisdiction rows', bad;
  END IF;
END
$$;
