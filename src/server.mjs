import http from "node:http";
import {
  listFolderFiles,
  listFolders,
  listPlacements,
  readDocument,
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

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://local");
  const path = decodeURIComponent(url.pathname);

  if (req.method === "GET" && (path === "/" || path === "/healthz")) {
    json(res, 200, { ok: true, service });
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

    const folderFiles = path.match(/^\/api\/smart-files\/folders\/(.+)\/files$/);
    if (req.method === "GET" && folderFiles) {
      const folderId = folderFiles[1];
      const data = await listFolderFiles(folderId);
      if (!data.folder) {
        json(res, 404, {
          error: "folder_not_found",
          folderId,
          absence: {
            status: "not-sought",
            basis: `No placed-on edges for folder ${folderId}`,
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
    json(res, 500, { error: "internal", message: String(err?.message || err) });
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
