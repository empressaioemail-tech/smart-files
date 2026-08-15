import http from "node:http";
import { QA_PERSONAS, resolvePersona } from "./actors.mjs";
import {
  createFolder,
  createShare,
  getBlob,
  listFolderFiles,
  listFolders,
  listPlacements,
  readDocument,
  resolveShare,
  uploadFileToFolder,
} from "./store.mjs";

const port = Number(process.env.PORT || 8080);
const service = "smart-files";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function requireToken(req, res) {
  const expected = process.env.SMART_FILES_SERVICE_TOKEN || "";
  const auth = req.headers.authorization || "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!expected || !got || got !== expected) {
    json(res, 401, {
      error: "unauthorized",
      message: "Anonymous callers are refused. Bearer service token required.",
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

  if (!requireToken(req, res)) return;

  try {
    if (req.method === "GET" && path === "/api/smart-files/folders") {
      const scopeType = url.searchParams.get("scopeType") || "";
      const scopeId = url.searchParams.get("scopeId") || "";
      if (!["jurisdiction", "tenant", "site"].includes(scopeType) || !scopeId) {
        json(res, 400, { error: "scopeType and scopeId are required" });
        return;
      }
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
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      if (!body.label) {
        json(res, 400, { error: "label is required" });
        return;
      }
      const folder = await createFolder({
        orgId: persona.orgId,
        userId: persona.userId,
        label: String(body.label),
      });
      json(res, 201, { folder, servedAt: new Date().toISOString() });
      return;
    }

    const shareGet = path.match(/^\/api\/smart-files\/share\/([^/]+)$/);
    if (req.method === "GET" && shareGet) {
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
      const body = await readJson(req);
      const persona = requirePersona(body, res);
      if (!persona) return;
      if (!body.bytesBase64 || !body.title) {
        json(res, 400, { error: "title and bytesBase64 are required" });
        return;
      }
      const uploaded = await uploadFileToFolder({
        folderId: folderFiles[1],
        orgId: persona.orgId,
        userId: persona.userId,
        title: String(body.title),
        contentType: String(body.contentType || "application/octet-stream"),
        bytes: Buffer.from(String(body.bytesBase64), "base64"),
      });
      json(res, 201, { file: uploaded, servedAt: new Date().toISOString() });
      return;
    }

    if (req.method === "GET" && folderFiles) {
      const folderId = folderFiles[1];
      const data = await listFolderFiles(folderId);
      if (!data.folder) {
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
      json(res, 200, { ...data, servedAt: new Date().toISOString() });
      return;
    }

    const placements = path.match(/^\/api\/smart-files\/files\/(.+)\/placements$/);
    if (req.method === "GET" && placements) {
      const entityId = placements[1];
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
