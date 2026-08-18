/**
 * Scope round-trip probe. Exercises the REAL HTTP routes, not the store directly.
 *
 * Proves two things at once:
 *   1. instrument-scoped folders and documents are creatable, readable, and listable.
 *   2. Every live tenant slug still writes and reads exactly as before.
 *
 * Usage:
 *   SMART_FILES_BASE_URL=http://127.0.0.1:8791 \
 *   SMART_FILES_SERVICE_TOKEN=... \
 *   node scripts/scope_roundtrip_probe.mjs
 *
 * Exits 0 when every check passes, 1 otherwise. Never starts a server itself.
 */

const base = process.env.SMART_FILES_BASE_URL || "http://127.0.0.1:8791";
const token = process.env.SMART_FILES_SERVICE_TOKEN || "";
const runTag = process.env.PROBE_RUN_TAG || String(Date.now()).slice(-8);

// A stable Crockford base32 ULID. Fixed, not generated, so reruns are comparable.
const NODE_ID = process.env.PROBE_NODE_ID || "sec_01JCZK8QW9V4T6XH2NBGRPY5MD";

const LIVE_TENANT_SLUGS = [
  { orgId: "icc-demo", userId: "reviewer" },
  { orgId: "acme", userId: "joe" },
  { orgId: "empressa", userId: "nick" },
  { orgId: "template-city", userId: "g71-calendar" },
  { orgId: "g58-probe", userId: null }, // seeded, no QA persona: read path only
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}\n`);
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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

async function tenantRoundTrip({ orgId, userId }) {
  const label = `tenant/${orgId}`;
  if (!userId) {
    const list = await call("GET", `/api/smart-files/folders?scopeType=tenant&scopeId=${orgId}`);
    record(
      `${label} list folders (read-only slug)`,
      list.status === 200 && Array.isArray(list.json?.folders) && list.json.folders.length > 0,
      `status=${list.status} folders=${list.json?.folders?.length ?? "n/a"}`,
    );
    const read = await call(
      "GET",
      `/api/smart-files/files/smartfile:tenant:${orgId}:isolation-note`,
    );
    record(
      `${label} read seeded document`,
      read.status === 200 && read.json?.status === "held",
      `status=${read.status} verdict=${read.json?.status}`,
    );
    return;
  }

  const folderLabel = `TW4 ${orgId} ${runTag}`;
  const created = await call("POST", "/api/smart-files/folders", {
    orgId,
    userId,
    label: folderLabel,
  });
  const folder = created.json?.folder;
  record(
    `${label} create folder`,
    created.status === 201 && folder?.scopeType === "tenant" && folder?.scopeId === orgId,
    `status=${created.status} folderId=${folder?.folderId} scope=${folder?.scopeType}/${folder?.scopeId}`,
  );
  if (!folder?.folderId) return;

  const title = `tw4-${orgId}-${runTag}`;
  const up = await call("POST", `/api/smart-files/folders/${folder.folderId}/files`, {
    orgId,
    userId,
    title,
    contentType: "text/plain",
    bytesBase64: Buffer.from(`tenant ${orgId} unchanged\n`).toString("base64"),
  });
  const entityId = up.json?.file?.entityId;
  record(
    `${label} upload file`,
    up.status === 201 && entityId === `smartfile:tenant:${orgId}:${title}`,
    `status=${up.status} entityId=${entityId}`,
  );
  if (!entityId) return;

  const read = await call("GET", `/api/smart-files/files/${entityId}`);
  record(
    `${label} read file back`,
    read.status === 200 &&
      read.json?.status === "held" &&
      read.json?.document?.scopeType === "tenant" &&
      read.json?.document?.scopeId === orgId,
    `status=${read.status} verdict=${read.json?.status} scope=${read.json?.document?.scopeType}/${read.json?.document?.scopeId}`,
  );

  const listed = await call("GET", `/api/smart-files/folders/${folder.folderId}/files`);
  record(
    `${label} list folder files`,
    listed.status === 200 && listed.json?.files?.some((f) => f.entityId === entityId),
    `status=${listed.status} files=${listed.json?.files?.length ?? "n/a"}`,
  );

  const folders = await call("GET", `/api/smart-files/folders?scopeType=tenant&scopeId=${orgId}`);
  record(
    `${label} list folders sees new room`,
    folders.status === 200 && folders.json?.folders?.some((f) => f.folderId === folder.folderId),
    `status=${folders.status} folders=${folders.json?.folders?.length ?? "n/a"}`,
  );
}

async function instrumentRoundTrip() {
  const label = "instrument";
  const folderLabel = `SEC filings ${runTag}`;
  const created = await call("POST", "/api/smart-files/folders", {
    scopeType: "instrument",
    scopeId: NODE_ID,
    label: folderLabel,
  });
  const folder = created.json?.folder;
  record(
    `${label} create folder`,
    created.status === 201 &&
      folder?.scopeType === "instrument" &&
      folder?.scopeId === NODE_ID &&
      folder?.folderId === `folder:instrument:${NODE_ID}:sec-filings-${runTag}`,
    `status=${created.status} folderId=${folder?.folderId} scope=${folder?.scopeType}/${folder?.scopeId}`,
  );
  if (!folder?.folderId) return null;

  const title = `tw4-10k-${runTag}`;
  const up = await call("POST", `/api/smart-files/folders/${folder.folderId}/files`, {
    scopeType: "instrument",
    scopeId: NODE_ID,
    title,
    contentType: "text/plain",
    bytesBase64: Buffer.from(`instrument ${NODE_ID} filing body\n`).toString("base64"),
  });
  const entityId = up.json?.file?.entityId;
  record(
    `${label} upload file`,
    up.status === 201 && entityId === `smartfile:instrument:${NODE_ID}:${title}`,
    `status=${up.status} entityId=${entityId}`,
  );
  if (!entityId) return { folderId: folder.folderId, entityId: null };

  const read = await call("GET", `/api/smart-files/files/${entityId}`);
  record(
    `${label} read file back at GET /files/:entityId`,
    read.status === 200 &&
      read.json?.status === "held" &&
      read.json?.document?.scopeType === "instrument" &&
      read.json?.document?.scopeId === NODE_ID,
    `status=${read.status} verdict=${read.json?.status} scope=${read.json?.document?.scopeType}/${read.json?.document?.scopeId}`,
  );

  const listed = await call("GET", `/api/smart-files/folders/${folder.folderId}/files`);
  record(
    `${label} list folder files`,
    listed.status === 200 && listed.json?.files?.some((f) => f.entityId === entityId),
    `status=${listed.status} files=${listed.json?.files?.length ?? "n/a"}`,
  );

  const folders = await call(
    "GET",
    `/api/smart-files/folders?scopeType=instrument&scopeId=${NODE_ID}`,
  );
  record(
    `${label} listFolders sees the instrument room`,
    folders.status === 200 && folders.json?.folders?.some((f) => f.folderId === folder.folderId),
    `status=${folders.status} folders=${folders.json?.folders?.length ?? "n/a"}`,
  );

  const placements = await call("GET", `/api/smart-files/files/${entityId}/placements`);
  record(
    `${label} placement resolves to the instrument room`,
    placements.status === 200 &&
      placements.json?.placements?.some(
        (p) => p.targetType === "folder" && p.targetId === folder.folderId,
      ),
    `status=${placements.status} placements=${placements.json?.placements?.length ?? "n/a"}`,
  );

  return { folderId: folder.folderId, entityId };
}

async function negativeChecks(instrumentFolderId) {
  const bad = [
    ["lowercase ulid", "sec_01jczk8qw9v4t6xh2nbgrpy5md"],
    ["wrong prefix", "cik_01JCZK8QW9V4T6XH2NBGRPY5MD"],
    ["no prefix", "01JCZK8QW9V4T6XH2NBGRPY5MD"],
    ["short ulid", "sec_01JCZK8QW9V4T6XH2NBGRPY5M"],
    ["crockford-excluded letter I", "sec_01JCZK8QW9V4T6XH2NBGRPY5MI"],
    ["extra colon", "sec_01JCZK8QW9V4T6XH2NBGRPY5MD:extra"],
    ["FIPS shape", "48021"],
    ["tenant-style slug", "acme"],
  ];
  for (const [why, scopeId] of bad) {
    const res = await call("POST", "/api/smart-files/folders", {
      scopeType: "instrument",
      scopeId,
      label: `bad ${runTag}`,
    });
    record(`instrument validator rejects ${why}`, res.status === 400, `status=${res.status}`);
  }

  const listBad = await call("GET", "/api/smart-files/folders?scopeType=instrument&scopeId=acme");
  record(
    "instrument listFolders rejects a tenant-shaped scopeId",
    listBad.status === 400,
    `status=${listBad.status}`,
  );

  if (instrumentFolderId) {
    const crossed = await call("POST", `/api/smart-files/folders/${instrumentFolderId}/files`, {
      orgId: "acme",
      userId: "joe",
      title: `cross-${runTag}`,
      contentType: "text/plain",
      bytesBase64: Buffer.from("nope").toString("base64"),
    });
    record(
      "tenant persona cannot upload into an instrument room",
      crossed.status === 403,
      `status=${crossed.status}`,
    );
  }

  const intoTenant = await call(
    "POST",
    `/api/smart-files/folders/folder:tenant:acme:tw4-acme-${runTag}/files`,
    {
      scopeType: "instrument",
      scopeId: NODE_ID,
      title: `cross2-${runTag}`,
      contentType: "text/plain",
      bytesBase64: Buffer.from("nope").toString("base64"),
    },
  );
  record(
    "instrument scope cannot upload into a tenant room",
    intoTenant.status === 403,
    `status=${intoTenant.status}`,
  );
}

async function main() {
  process.stdout.write(`probe base=${base} nodeId=${NODE_ID} runTag=${runTag}\n\n`);
  process.stdout.write("--- tenant: five live slugs, unchanged ---\n");
  for (const slug of LIVE_TENANT_SLUGS) {
    await tenantRoundTrip(slug);
  }
  process.stdout.write("\n--- instrument: the new scope, HTTP round trip ---\n");
  const inst = await instrumentRoundTrip();
  process.stdout.write("\n--- negative: the validator is real ---\n");
  await negativeChecks(inst?.folderId);

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`probe crashed: ${err?.stack || err}\n`);
  process.exit(2);
});
