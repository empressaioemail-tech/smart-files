-- QA rooms: first-class folders, share tokens, byte store.
-- Own database only. Never apply to cortex-prod / atoms.

CREATE TABLE IF NOT EXISTS smart_file_folders (
  folder_id text PRIMARY KEY,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  label text NOT NULL,
  access_policy text NOT NULL DEFAULT 'tenant-private',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_file_folders_scope_type_check
    CHECK (scope_type IN ('jurisdiction', 'tenant', 'site', 'instrument')),
  CONSTRAINT smart_file_folders_access_policy_check
    CHECK (access_policy IN (
      'public-free',
      'public-paid',
      'platform-internal',
      'tenant-private',
      'tenant-shared'
    ))
);

CREATE INDEX IF NOT EXISTS smart_file_folders_scope_idx
  ON smart_file_folders (scope_type, scope_id);

CREATE TABLE IF NOT EXISTS smart_file_shares (
  token text PRIMARY KEY,
  folder_id text NOT NULL REFERENCES smart_file_folders (folder_id) ON DELETE CASCADE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS smart_file_shares_folder_idx
  ON smart_file_shares (folder_id);

CREATE TABLE IF NOT EXISTS smart_file_blobs (
  content_cid text PRIMARY KEY,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE smart_file_documents
  ADD COLUMN IF NOT EXISTS created_by text;

INSERT INTO smart_file_folders (folder_id, scope_type, scope_id, label, created_by)
SELECT DISTINCT
  p.target_id,
  d.scope_type,
  d.scope_id,
  split_part(p.target_id, ':', -1),
  'seed'
FROM smart_file_placements p
JOIN smart_file_documents d ON d.id = p.document_id
WHERE p.target_type = 'folder'
ON CONFLICT (folder_id) DO NOTHING;
