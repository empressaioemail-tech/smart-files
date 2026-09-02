import http from "node:http";
import { INSTRUMENT_SERVICE_ACTOR, QA_PERSONAS, resolvePersona } from "./actors.mjs";
import {
  identityAllowsAnyScope,
  parseSmartFileEntityId,
  parseServiceIdentities,
  resolveCallerIdentity,
  SMART_FILE_SCOPE_TYPES,
  scopeIdIsValid,
  WRITABLE_SCOPE_TYPES,
} from "./identity.mjs";
import {
  createFolder,
  createShare,
  getBlob,
  getBlobScopes,
  getFolder,
  listFolderFiles,
  listFolders,
  listPlacements,
  readDocument,
  resolveShare,
  uploadFileToFolder,
} from "./store.mjs";

const port = Number(process.env.PORT || 8080);
const service = "smart-files";

// Read-path caller identities (G-106 / defect #3). See identity.mjs for the
// shape. Configured separately from the legacy write/personas/share token:
// that token is deliberately NOT auto-granted read access to every scope,
// because that would just keep the defect this row exists to close.
const readIdentities = parseServiceIdentities(process.env.SMART_FILES_SERVICE_TOKENS);

// The legacy single secret used by write, personas, and share routes. Those
// routes are unchanged by this pass -- their tenant enforcement is the QA
// persona / body-scope path in store.mjs, not this token.
const legacyToken = process.env.SMART_FILES_SERVICE_TOKEN || "";
const legacyTokenKnown = new Set(
  [legacyToken, ...readIdentities.map((i) => i.token)].filter(Boolean),
);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function requireToken(req, res) {
  const got = bearerToken(req);
  if (!got || !legacyTokenKnown.has(got)) {
    json(res, 401, {
      error: "unauthorized",
      message: "Anonymous callers are refused. Bearer service token required.",
    });
    return false;
  }
  return true;
}

/**
 * Read-path scope gate. Refuses (403) unless the bearer token resolves to a
 * configured SMART_FILES_SERVICE_TOKENS identity holding a grant for at least
 * one of `scopePairs` (or a blanket "*"/"*" grant). No token, an unknown
 * token, and a token whose grants don't cover this scope all refuse the same
 * way -- the WDLL's own check (`_inbox/2026-08-25_govtech_wave1_WDLL.md`
 * item 5) does not distinguish "anonymous" from "wrong tenant".
 */
function requireReadScope(req, res, scopePairs) {
  const identity = resolveCallerIdentity(bearerToken(req), readIdentities);
  if (!identityAllowsAnyScope(identity, scopePairs)) {
    json(res, 403, {
      error: "forbidden",
      message: "Caller token is not verified for this scope.",
    });
    return false;
  }
  return true;
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8"));
}

function requirePersona(body, res) {
  const persona = resolvePersona(body.orgId, body.userId);
  if (!persona) {
    json(res, 400, {
      error: "unknown_persona",
      message: "orgId and userId must be a QA persona",
      personas: QA_PERSONAS,
    });
    return null;
  }
  return persona;
}

/**
 * Resolve who and what a write is for.
 *
 * Absent or `tenant` scopeType keeps the persona rule exactly as it was: the
 * QA persona supplies both the actor and the scopeId. A non-tenant writable
 * scope names its scopeId in the body and writes as a service actor, because
 * an instrument room belongs to a security-master node rather than to a
 * person. Returns null after answering the request itself.
 */
function requireWriteScope(body, res) {
  const scopeType = body.scopeType ? String(body.scopeType) : "tenant";
  if (!WRITABLE_SCOPE_TYPES.includes(scopeType)) {
    json(res, 400, {
      error: "scope_not_writable",
      message: `scopeType must be one of ${WRITABLE_SCOPE_TYPES.join(", ")}`,
    });
    return null;
  }
  if (scopeType === "tenant") {
    const persona = requirePersona(body, res);
    if (!persona) return null;
    return { scopeType, scopeId: persona.orgId, orgId: persona.orgId, userId: persona.userId };
  }
  const scopeId = body.scopeId ? String(body.scopeId) : "";
  if (!scopeIdIsValid(scopeType, scopeId)) {
    json(res, 400, {
      error: "invalid_scope_id",
      message: `scopeId is not a valid ${scopeType} identifier`,
      scopeType,
    });
    return null;
  }
  return { scopeType, scopeId, createdBy: INSTRUMENT_SERVICE_ACTOR };
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://local");
  const path = decodeURIComponent(url.pathname);

  if (req.method === "GET" && (path === "/" || path === "/healthz")) {
    json(res, 200, { ok: true, service });
    return;
  }

  if (req.method === "GET" && path === "/api/smart-files/personas") {
    if (!requireToken(req, res)) return;
    json(res, 200, { personas: QA_PERSONAS });
    return;
  }

  if (!path.startsWith("/api/smart-files/")) {
    json(res, 404, { ok: false, service });
    return;
  }

  try {
    if (req.method === "GET" && path === "/api/smart-files/folders") {
      const scopeType = url.searchParams.get("scopeType") || "";
      const scopeId = url.searchParams.get("scopeId") || "";
      if (!SMART_FILE_SCOPE_TYPES.includes(scopeType) || !scopeId) {
        json(res, 400, {
          error: "scopeType and scopeId are required",
          scopeTypes: SMART_FILE_SCOPE_TYPES,
        });
        return;
      }
      // Jurisdiction, tenant and site keep the behaviour they shipped with:
      // a non-empty scopeId is the whole rule on this route, and an unknown id
      // lists nothing rather than erroring. Identity already refuses a
      // malformed id where one is built, so validating every scope here would
      // widen the blast radius of this change for no gain. Only `instrument`,
      // the scope this row adds, is validated. Ruled by the owning lane on
      // review of PR #5, 2026-08-17.
      if (scopeType === "instrument" && !scopeIdIsValid(scopeType, scopeId)) {
        json(res, 400, {
          error: "invalid_scope_id",
          message: `scopeId is not a valid ${scopeType} identifier`,
          scopeType,
        });
        return;
      }
      if (!requireReadScope(req, res, [{ scopeType, scopeId }])) return;
      const folders = await listFolders(scopeType, scopeId);
      json(res, 200, {
        scopeType,
        scopeId,
        folders,
        servedAt: new Date().toISOString(),
      });
      return;
    }

    if (req.method === "POST" && path === "/api/smart-files/folders") {
      if (!requireToken(req, res)) return;
      const body = await readJson(req);
      const scope = requireWriteScope(body, res);
      if (!scope) return;
      if (!body.label) {
        json(res, 400, { error: "label is required" });
        return;
      }
      const folder = await createFolder({
        ...scope,
        label: String(body.label),
      });
      json(res, 201, { folder, servedAt: new Date().toISOString() });
      return;
    }

    const shareGet = path.match(/^\/api\/smart-files\/share\/([^/]+)$/);
    if (req.method === "GET" && shareGet) {
      if (!requireToken(req, res)) return;
      const data = await resolveShare(shareGet[1]);
      if (!data) {
        json(res, 404, { error: "share_not_found" });
        return;
      }
      json(res, 200, { ...data, servedAt: new Date().toISOString() });
      return;
    }

    const blobGet = path.match(/^\/api\/smart-files\/blobs\/(.+)$/);
    if (req.method === "GET" && blobGet) {
      const blob = await getBlob(blobGet[1]);
      if (!blob) {
        json(res, 404, { error: "blob_not_found" });
        return;
      }
      const scopes = await getBlobScopes(blobGet[1]);
      if (!requireReadScope(req, res, scopes)) return;
      res.writeHead(200, {
        "content-type": blob.content_type,
        "content-length": String(blob.byte_size),
        "content-disposition": "inline",
      });
      res.end(blob.bytes);
      return;
    }

    const folderShare = path.match(/^\/api\/smart-files\/folders\/(.+)\/share$/);
    if (req.method === "POST" && folderShare) {
      if (!requireToken(req, res)) return;
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      const share = await createShare({
        folderId: folderShare[1],
        orgId: persona.orgId,
        userId: persona.userId,
      });
      json(res, 201, { ...share, servedAt: new Date().toISOString() });
      return;
    }

    const folderFiles = path.match(/^\/api\/smart-files\/folders\/(.+)\/files$/);
    if (req.method === "POST" && folderFiles) {
      if (!requireToken(req, res)) return;
      const body = await readJson(req);
      const scope = requireWriteScope(body, res);
      if (!scope) return;
      if (!body.bytesBase64 || !body.title) {
        json(res, 400, { error: "title and bytesBase64 are required" });
        return;
      }
      const uploaded = await uploadFileToFolder({
        ...scope,
        folderId: folderFiles[1],
        title: String(body.title),
        contentType: String(body.contentType || "application/octet-stream"),
        bytes: Buffer.from(String(body.bytesBase64), "base64"),
      });
      json(res, 201, { file: uploaded, servedAt: new Date().toISOString() });
      return;
    }

    if (req.method === "GET" && folderFiles) {
      const folderId = folderFiles[1];
      const folder = await getFolder(folderId);
      if (!folder) {
        json(res, 404, {
          error: "folder_not_found",
          folderId,
          absence: {
            status: "not-sought",
            basis: `No folder row for ${folderId}`,
          },
        });
        return;
      }
      if (!requireReadScope(req, res, [{ scopeType: folder.scopeType, scopeId: folder.scopeId }]))
        return;
      const data = await listFolderFiles(folderId);
      json(res, 200, { ...data, servedAt: new Date().toISOString() });
      return;
    }

    const placements = path.match(/^\/api\/smart-files\/files\/(.+)\/placements$/);
    if (req.method === "GET" && placements) {
      const entityId = placements[1];
      const parts = parseSmartFileEntityId(entityId);
      const scopePairs = parts ? [{ scopeType: parts.scopeType, scopeId: parts.scopeId }] : [];
      if (!requireReadScope(req, res, scopePairs)) return;
      const read = await readDocument(entityId);
      if (read.status !== "held") {
        json(res, read.status === "held-version-absent" ? 404 : 200, read);
        return;
      }
      const list = await listPlacements(entityId);
      json(res, 200, {
        entityId,
        placements: list,
        servedAt: new Date().toISOString(),
      });
      return;
    }

    const fileRead = path.match(/^\/api\/smart-files\/files\/(.+)$/);
    if (req.method === "GET" && fileRead) {
      const entityId = fileRead[1];
      const parts = parseSmartFileEntityId(entityId);
      const scopePairs = parts ? [{ scopeType: parts.scopeType, scopeId: parts.scopeId }] : [];
      if (!requireReadScope(req, res, scopePairs)) return;
      const versionRaw = url.searchParams.get("version");
      const version = versionRaw ? Number.parseInt(versionRaw, 10) : undefined;
      const result = await readDocument(
        entityId,
        Number.isFinite(version) ? version : undefined,
      );
      json(res, result.status === "held-version-absent" ? 404 : 200, {
        ...result,
        servedAt: new Date().toISOString(),
      });
      return;
    }

    json(res, 404, { ok: false, service });
  } catch (err) {
    const status = err.status || (err.message === "body too large" ? 413 : 500);
    json(res, status, { error: "internal", message: String(err?.message || err) });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    json(res, 500, { error: "internal", message: String(err?.message || err) });
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`${service} listening on ${port}\n`);
});
