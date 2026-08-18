import pg from "pg";
import { actorKey } from "./actors.mjs";
import {
  buildFolderId,
  contentCidFromBytes,
  shareToken,
  slugify,
} from "./cid.mjs";
import {
  assertScopeId,
  buildSmartFileEntityId,
  DEFAULT_ACCESS_POLICY,
  parseSmartFileEntityId,
  WRITABLE_SCOPE_TYPES,
} from "./identity.mjs";

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

/**
 * Resolve the (scopeType, scopeId) pair a write lands in.
 *
 * Tenant writes are unchanged: the persona's orgId is the scopeId, and any
 * non-empty slug is accepted, because live tenants are free-form strings.
 * Instrument writes name their scope explicitly and are validated by the
 * instrument rule in identity.mjs. Nothing else is writable through this
 * service.
 */
export function resolveWriteScope({ scopeType, scopeId, orgId }) {
  const type = scopeType || "tenant";
  if (!WRITABLE_SCOPE_TYPES.includes(type)) {
    const err = new Error(
      `scopeType must be one of ${WRITABLE_SCOPE_TYPES.join(", ")} on the write path`,
    );
    err.status = 400;
    throw err;
  }
  const id = type === "tenant" ? orgId : scopeId;
  try {
    assertScopeId(type, id);
  } catch (cause) {
    const err = new Error(cause.message);
    err.status = 400;
    throw err;
  }
  return { scopeType: type, scopeId: id };
}

function assertFolderInScope(folder, scope) {
  if (folder.scopeType === scope.scopeType && folder.scopeId === scope.scopeId) return;
  const err = new Error(
    scope.scopeType === "tenant" ? "folder is not in this org" : "folder is not in this scope",
  );
  err.status = 403;
  throw err;
}

function folderLabel(folderId) {
  const parts = String(folderId).split(":");
  return parts[parts.length - 1] || folderId;
}

export async function listFolders(scopeType, scopeId) {
  const { rows } = await getPool().query(
    `SELECT folder_id, label, scope_type, scope_id, access_policy, created_by, created_at
       FROM smart_file_folders
      WHERE scope_type = $1 AND scope_id = $2
      ORDER BY created_at DESC, folder_id`,
    [scopeType, scopeId],
  );
  return rows.map((r) => ({
    folderId: r.folder_id,
    label: r.label || folderLabel(r.folder_id),
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    accessPolicy: r.access_policy,
    createdBy: r.created_by,
    createdAt: r.created_at,
    parentFolderId: null,
  }));
}

export async function createFolder({ orgId, userId, label, scopeType, scopeId, createdBy }) {
  const scope = resolveWriteScope({ scopeType, scopeId, orgId });
  const slug = slugify(label);
  if (!slug) throw new Error("folder label must yield a slug");
  const folderId = buildFolderId(scope.scopeId, slug, scope.scopeType);
  const actor = createdBy || actorKey(orgId, userId);
  const { rows } = await getPool().query(
    `INSERT INTO smart_file_folders (folder_id, scope_type, scope_id, label, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (folder_id) DO UPDATE
       SET label = EXCLUDED.label
     RETURNING folder_id, label, scope_type, scope_id, access_policy, created_by, created_at`,
    [folderId, scope.scopeType, scope.scopeId, label.trim(), actor],
  );
  const r = rows[0];
  return {
    folderId: r.folder_id,
    label: r.label,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    accessPolicy: r.access_policy,
    createdBy: r.created_by,
    createdAt: r.created_at,
    parentFolderId: null,
  };
}

export async function uploadFileToFolder({
  folderId,
  orgId,
  userId,
  scopeType,
  scopeId,
  createdBy,
  title,
  contentType,
  bytes,
}) {
  const scope = resolveWriteScope({ scopeType, scopeId, orgId });
  const folder = await getFolder(folderId);
  if (!folder) {
    const err = new Error("folder_not_found");
    err.status = 404;
    throw err;
  }
  assertFolderInScope(folder, scope);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length === 0) throw new Error("empty upload");
  if (buf.length > 8 * 1024 * 1024) throw new Error("upload exceeds 8MB QA cap");
  const cid = contentCidFromBytes(buf);
  const baseSlug = slugify(title) || `file-${Date.now()}`;
  let docSlug = baseSlug;
  let entityId = buildSmartFileEntityId({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    docSlug,
  });
  const actor = createdBy || actorKey(orgId, userId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO smart_file_blobs (content_cid, content_type, byte_size, bytes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_cid) DO NOTHING`,
      [cid, contentType || "application/octet-stream", buf.length, buf],
    );
    for (let i = 2; i < 20; i += 1) {
      const exists = await client.query(
        `SELECT 1 FROM smart_file_documents WHERE entity_id = $1`,
        [entityId],
      );
      if (exists.rowCount === 0) break;
      docSlug = `${baseSlug}-${i}`;
      entityId = buildSmartFileEntityId({
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        docSlug,
      });
    }
    const doc = await client.query(
      `INSERT INTO smart_file_documents
         (entity_id, scope_type, scope_id, doc_slug, title, access_policy, current_version, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
       RETURNING *`,
      [
        entityId,
        scope.scopeType,
        scope.scopeId,
        docSlug,
        title.trim() || docSlug,
        DEFAULT_ACCESS_POLICY,
        actor,
      ],
    );
    const documentId = doc.rows[0].id;
    await client.query(
      `INSERT INTO smart_file_versions
         (document_id, document_entity_id, version, content_cid, content_type, byte_size, provenance)
       VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb)`,
      [
        documentId,
        entityId,
        cid,
        contentType || "application/octet-stream",
        buf.length,
        JSON.stringify({
          sourceLabel: scope.scopeType === "instrument" ? "instrument-write" : "qa-upload",
          uploadedBy: actor,
        }),
      ],
    );
    await client.query(
      `INSERT INTO smart_file_placements
         (document_id, document_entity_id, target_type, target_id, placed_by)
       VALUES ($1, $2, 'folder', $3, $4)`,
      [documentId, entityId, folderId, actor],
    );
    await client.query("COMMIT");
    return {
      entityId,
      title: doc.rows[0].title,
      accessPolicy: doc.rows[0].access_policy,
      currentVersion: 1,
      contentCid: cid,
      contentType: contentType || "application/octet-stream",
      byteSize: buf.length,
      folderId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getFolder(folderId) {
  const { rows } = await getPool().query(
    `SELECT folder_id, label, scope_type, scope_id, access_policy, created_by, created_at
       FROM smart_file_folders WHERE folder_id = $1`,
    [folderId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    folderId: r.folder_id,
    label: r.label,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    accessPolicy: r.access_policy,
    createdBy: r.created_by,
    createdAt: r.created_at,
    parentFolderId: null,
  };
}

export async function createShare({ folderId, orgId, userId, scopeType, scopeId }) {
  const scope = resolveWriteScope({ scopeType, scopeId, orgId });
  const folder = await getFolder(folderId);
  if (!folder) {
    const err = new Error("folder_not_found");
    err.status = 404;
    throw err;
  }
  assertFolderInScope(folder, scope);
  const token = shareToken();
  await getPool().query(
    `INSERT INTO smart_file_shares (token, folder_id, created_by)
     VALUES ($1, $2, $3)`,
    [token, folderId, actorKey(orgId, userId)],
  );
  return { token, folderId };
}

export async function resolveShare(token) {
  const { rows } = await getPool().query(
    `SELECT s.token, s.folder_id, s.created_by, s.created_at, s.revoked_at
       FROM smart_file_shares s
      WHERE s.token = $1`,
    [token],
  );
  if (rows.length === 0 || rows[0].revoked_at) return null;
  const folder = await getFolder(rows[0].folder_id);
  if (!folder) return null;
  const files = await listFolderFiles(folder.folderId);
  return {
    share: {
      token: rows[0].token,
      createdBy: rows[0].created_by,
      createdAt: rows[0].created_at,
    },
    folder,
    files: files.files,
  };
}

export async function getBlob(contentCid) {
  const { rows } = await getPool().query(
    `SELECT content_cid, content_type, byte_size, bytes
       FROM smart_file_blobs WHERE content_cid = $1`,
    [contentCid],
  );
  return rows[0] ?? null;
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
    const folder = await getFolder(folderId);
    return { folder, files: [], countingRule: COUNTING_RULE };
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
