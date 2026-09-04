-- G-search-1: real content search. Text extraction runs synchronously on
-- upload (uploadFileToFolder in store.mjs), gated on
-- content_type = 'application/pdf'. Every other content type -- including
-- the real bastrop_tx meeting records, which are application/json -- is
-- never attempted, and leaves search_text NULL. A PDF that fails extraction
-- (corrupt bytes, an image-only scan with no text layer) ALSO leaves
-- search_text NULL: the document still uploads and is retrievable, it is
-- just not searchable. NULL is the one honest value for "not indexed"; the
-- write path never defaults it to ''.
--
-- Lives on smart_file_versions, not a new table: content_cid, content_type
-- and byte_size are already per-version columns on this table, and extracted
-- text is exactly that kind of per-version, content-derived fact.
--
-- search_tsv is a STORED generated column, not a trigger, so the GIN index
-- always agrees with search_text -- there is no separate write path that can
-- drift out of sync. It generates NULL (not an empty tsvector) when
-- search_text is NULL, so an unindexed version never matches any query.

ALTER TABLE smart_file_versions
  ADD COLUMN IF NOT EXISTS search_text text;

ALTER TABLE smart_file_versions
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    CASE WHEN search_text IS NOT NULL
      THEN to_tsvector('english', search_text)
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS smart_file_versions_search_tsv_idx
  ON smart_file_versions USING GIN (search_tsv);
