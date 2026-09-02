/**
 * Read-path caller scope probe (G-106 / defect #3).
 *
 * Encodes WDLL item 5 (`_inbox/2026-08-25_govtech_wave1_WDLL.md`) as a live
 * violation check: a folder, file, document, and blob read must refuse an
 * anonymous caller and a caller scoped to the wrong tenant, and must succeed
 * for a caller scoped to the matching tenant. Never starts a server itself.
 *
 * Usage:
 *   SMART_FILES_BASE_URL=http://127.0.0.1:8791 \
 *   SMART_FILES_SERVICE_TOKEN=<write/legacy token, matches the running server> \
 *   MATCH_TOKEN=<token the running server's SMART_FILES_SERVICE_TOKENS grants tenant/template-city> \
 *   WRONG_TOKEN=<token the running server's SMART_FILES_SERVICE_TOKENS grants tenant/acme only> \
 *   node scripts/read_scope_probe.mjs
 *
 * Exits 0 when every check passes, 1 otherwise.
 */

const base = process.env.SMART_FILES_BASE_URL || "http://127.0.0.1:8791";
const writeToken = process.env.SMART_FILES_SERVICE_TOKEN || "";
const matchToken = process.env.MATCH_TOKEN || "";
const wrongToken = process.env.WRONG_TOKEN || "";
const runTag = process.env.PROBE_RUN_TAG || String(Date.now()).slice(-8);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}\n`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function setup() {
  const label = `read-scope-probe ${runTag}`;
  const created = await call("POST", "/api/smart-files/folders", {
    token: writeToken,
    body: { orgId: "template-city", userId: "g71-calendar", label },
  });
  const folderId = created.json?.folder?.folderId;
  if (created.status !== 201 || !folderId) {
    throw new Error(
      `setup: could not create template-city folder, status=${created.status} body=${JSON.stringify(created.json)}`,
    );
  }
  const title = `read-scope-probe-${runTag}`;
  const uploaded = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    token: writeToken,
    body: {
      orgId: "template-city",
      userId: "g71-calendar",
      title,
      contentType: "text/plain",
      bytesBase64: Buffer.from(`read scope probe ${runTag}\n`).toString("base64"),
    },
  });
  const entityId = uploaded.json?.file?.entityId;
  const contentCid = uploaded.json?.file?.contentCid;
  if (uploaded.status !== 201 || !entityId || !contentCid) {
    throw new Error(
      `setup: could not upload template-city file, status=${uploaded.status} body=${JSON.stringify(uploaded.json)}`,
    );
  }
  return { folderId, entityId, contentCid };
}

async function scopedRead(name, path) {
  const anon = await call("GET", path);
  record(`${name}: anonymous refused`, anon.status === 403, `status=${anon.status}`);

  const wrong = await call("GET", path, { token: wrongToken });
  record(`${name}: wrong-tenant token refused`, wrong.status === 403, `status=${wrong.status}`);

  const match = await call("GET", path, { token: matchToken });
  record(`${name}: matching-tenant token allowed`, match.status === 200, `status=${match.status}`);
  return match;
}

async function main() {
  process.stdout.write(`probe base=${base} runTag=${runTag}\n\n`);
  const { folderId, entityId, contentCid } = await setup();
  process.stdout.write(`seeded folderId=${folderId} entityId=${entityId} contentCid=${contentCid}\n\n`);

  process.stdout.write("--- folders list ---\n");
  await scopedRead(
    "folders list",
    "/api/smart-files/folders?scopeType=tenant&scopeId=template-city",
  );

  process.stdout.write("\n--- folder files list ---\n");
  await scopedRead("folder files list", `/api/smart-files/folders/${folderId}/files`);

  process.stdout.write("\n--- file read ---\n");
  const fileMatch = await scopedRead("file read", `/api/smart-files/files/${entityId}`);
  record(
    "file read: matching-tenant body is the held document",
    fileMatch.json?.status === "held" && fileMatch.json?.document?.entityId === entityId,
    `status=${fileMatch.json?.status}`,
  );

  process.stdout.write("\n--- placements read ---\n");
  await scopedRead("placements read", `/api/smart-files/files/${entityId}/placements`);

  process.stdout.write("\n--- blob read ---\n");
  const blobMatch = await scopedRead("blob read", `/api/smart-files/blobs/${contentCid}`);
  record(
    "blob read: matching-tenant token gets bytes back",
    blobMatch.status === 200,
    `status=${blobMatch.status}`,
  );

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`probe crashed: ${err?.stack || err}\n`);
  process.exit(2);
});
