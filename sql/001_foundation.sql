-- Smart Files store. Own database only. Never apply to cortex-prod / atoms.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Identity: smartfile:<scopeType>:<scopeId>:<docSlug> (last-segment-is-slug).
-- Placements reference the DOCUMENT, never a version.

CREATE TABLE smart_file_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  jurisdiction_fips text,
  doc_slug text NOT NULL,
  title text NOT NULL,
  access_policy text NOT NULL DEFAULT 'tenant-private',
  current_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_file_documents_scope_type_check
    CHECK (scope_type IN ('jurisdiction', 'tenant', 'site', 'instrument')),
  CONSTRAINT smart_file_documents_access_policy_check
    CHECK (access_policy IN (
      'public-free',
      'public-paid',
      'platform-internal',
      'tenant-private',
      'tenant-shared'
    )),
  CONSTRAINT smart_file_documents_current_version_check
    CHECK (current_version >= 1)
);

CREATE UNIQUE INDEX smart_file_documents_entity_id_uniq
  ON smart_file_documents (entity_id);
CREATE UNIQUE INDEX smart_file_documents_scope_identity_uniq
  ON smart_file_documents (scope_type, scope_id, doc_slug);
CREATE INDEX smart_file_documents_access_policy_idx
  ON smart_file_documents (access_policy);

CREATE TABLE smart_file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES smart_file_documents (id) ON DELETE CASCADE,
  document_entity_id text NOT NULL,
  version integer NOT NULL,
  content_cid text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  provenance jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_file_versions_version_check CHECK (version >= 1)
);

CREATE UNIQUE INDEX smart_file_versions_doc_version_uniq
  ON smart_file_versions (document_id, version);
CREATE INDEX smart_file_versions_content_cid_idx
  ON smart_file_versions (content_cid);

CREATE TABLE smart_file_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES smart_file_documents (id) ON DELETE CASCADE,
  document_entity_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  placed_by text,
  CONSTRAINT smart_file_placements_target_type_check
    CHECK (target_type IN ('folder', 'parcel', 'project', 'asset', 'permit', 'meeting', 'instrument'))
);

CREATE UNIQUE INDEX smart_file_placements_uniq
  ON smart_file_placements (document_id, target_type, target_id);
CREATE INDEX smart_file_placements_document_idx
  ON smart_file_placements (document_id);
CREATE INDEX smart_file_placements_target_idx
  ON smart_file_placements (target_type, target_id);

CREATE TABLE smart_file_absence_determinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id text NOT NULL,
  verdict text NOT NULL,
  basis text NOT NULL,
  determined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_file_absence_verdict_check
    CHECK (verdict IN ('absent-verified', 'lookup-failed'))
);

CREATE UNIQUE INDEX smart_file_absence_entity_id_uniq
  ON smart_file_absence_determinations (entity_id);
