import pg from "pg";
import { parseSmartFileEntityId } from "./identity.mjs";

const COUNTING_RULE =
  "DISTINCT smart_file_documents.id via smart_file_placements WHERE target_type='folder' AND target_id=folderId";

let pool;

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    if (/fancy-fire|lucky-truth|06136146/.test(url)) {
      throw new Error("refusing cortex-prod DSN");
    }
    pool = new pg.Pool({ connectionString: url, max: 4 });
  }
  return pool;
}

function folderLabel(folderId) {
  const parts = String(folderId).split(":");
  return parts[parts.length - 1] || folderId;
}

export async function listFolders(scopeType, scopeId) {
  const { rows } = await getPool().query(
    `SELECT p.target_id AS folder_id,
            MIN(d.access_policy) AS access_policy
       FROM smart_file_placements p
       JOIN smart_file_documents d ON d.id = p.document_id
      WHERE p.target_type = 'folder'
        AND d.scope_type = $1
        AND d.scope_id = $2
      GROUP BY p.target_id
      ORDER BY p.target_id`,
    [scopeType, scopeId],
  );
  return rows.map((r) => ({
    folderId: r.folder_id,
    label: folderLabel(r.folder_id),
    scopeType,
    scopeId,
    accessPolicy: r.access_policy,
    parentFolderId: null,
  }));
}

export async function listFolderFiles(folderId) {
  const { rows } = await getPool().query(
    `SELECT d.entity_id, d.title, d.access_policy, d.current_version,
            d.scope_type, d.scope_id, d.doc_slug,
            (SELECT count(*)::int FROM smart_file_placements p2
              WHERE p2.document_id = d.id) AS placement_count
       FROM smart_file_documents d
       JOIN smart_file_placements p ON p.document_id = d.id
      WHERE p.target_type = 'folder' AND p.target_id = $1
      ORDER BY d.title`,
    [folderId],
  );
  if (rows.length === 0) {
    return { folder: null, files: [] };
  }
  const first = rows[0];
  return {
    folder: {
      folderId,
      label: folderLabel(folderId),
      scopeType: first.scope_type,
      scopeId: first.scope_id,
      accessPolicy: first.access_policy,
      parentFolderId: null,
    },
    files: rows.map((r) => ({
      entityId: r.entity_id,
      title: r.title,
      accessPolicy: r.access_policy,
      currentVersion: r.current_version,
      scopeType: r.scope_type,
      scopeId: r.scope_id,
      docSlug: r.doc_slug,
      placementCount: r.placement_count,
    })),
    countingRule: COUNTING_RULE,
  };
}

export async function readDocument(entityId, version) {
  const parts = parseSmartFileEntityId(entityId);
  if (!parts) {
    return {
      status: "not-sought",
      entityId,
      absence: { basis: "entityId failed last-segment-is-slug parse" },
    };
  }
  const { rows: docs } = await getPool().query(
    `SELECT * FROM smart_file_documents WHERE entity_id = $1`,
    [entityId],
  );
  if (docs.length === 0) {
    return {
      status: "not-sought",
      entityId,
      absence: { basis: `No document row for ${entityId}` },
    };
  }
  const doc = docs[0];
  const want = version ?? doc.current_version;
  const { rows: vers } = await getPool().query(
    `SELECT * FROM smart_file_versions
      WHERE document_id = $1 AND version = $2`,
    [doc.id, want],
  );
  if (vers.length === 0) {
    return {
      status: "held-version-absent",
      entityId,
      absence: { basis: `Version ${want} not present` },
    };
  }
  const v = vers[0];
  return {
    status: "held",
    document: {
      entityId: doc.entity_id,
      title: doc.title,
      accessPolicy: doc.access_policy,
      scopeType: doc.scope_type,
      scopeId: doc.scope_id,
      docSlug: doc.doc_slug,
      currentVersion: doc.current_version,
    },
    version: {
      version: v.version,
      contentCid: v.content_cid,
      contentType: v.content_type,
      computedAt: v.computed_at,
    },
  };
}

export async function listPlacements(entityId) {
  const { rows } = await getPool().query(
    `SELECT p.target_type, p.target_id, p.placed_at, p.placed_by
       FROM smart_file_placements p
       JOIN smart_file_documents d ON d.id = p.document_id
      WHERE d.entity_id = $1
      ORDER BY p.placed_at`,
    [entityId],
  );
  return rows.map((r) => ({
    targetType: r.target_type,
    targetId: r.target_id,
    placedAt: r.placed_at,
    placedBy: r.placed_by,
  }));
}
