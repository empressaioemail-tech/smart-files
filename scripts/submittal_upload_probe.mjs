/**
 * Submittal upload probe (G-107 / transaction contract "Document" section).
 *
 * Exercises the REAL HTTP routes for an explicit, stable docSlug:
 *   1. A first upload creates a fresh document under smartfile:tenant:template-city:%.
 *   2. A second upload with the SAME docSlug is a new VERSION of the SAME
 *      document (currentVersion increments, entityId is unchanged), never a
 *      counter-suffixed sibling -- the "stable across revisions" requirement.
 *   3. Full five-key provenance (capturedBy, capturedAt, sourceKind,
 *      originalFilename, declaredRole) round-trips through both versions.
 *   4. A missing provenance key and an invalid docSlug both refuse (400),
 *      never silently default.
 *
 * Usage:
 *   SMART_FILES_BASE_URL=http://127.0.0.1:8791 \
 *   SMART_FILES_SERVICE_TOKEN=... \
 *   node scripts/submittal_upload_probe.mjs
 *
 * Exits 0 when every check passes, 1 otherwise. Never starts a server itself.
 */

const base = process.env.SMART_FILES_BASE_URL || "http://127.0.0.1:8791";
const token = process.env.SMART_FILES_SERVICE_TOKEN || "";
const runTag = process.env.PROBE_RUN_TAG || String(Date.now()).slice(-8);
const docSlug = `eng-${runTag}--site-plan`;

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

function provenance(overrides = {}) {
  return {
    capturedBy: "template-city/staff",
    capturedAt: new Date().toISOString(),
    sourceKind: "staff-upload",
    originalFilename: `site-plan-${runTag}.pdf`,
    declaredRole: "Applicant engineer of record",
    ...overrides,
  };
}

async function main() {
  process.stdout.write(`probe base=${base} runTag=${runTag} docSlug=${docSlug}\n\n`);

  const created = await call("POST", "/api/smart-files/folders", {
    orgId: "template-city",
    userId: "staff",
    label: `G-107 probe ${runTag}`,
  });
  const folderId = created.json?.folder?.folderId;
  record(
    "create template-city staff folder",
    created.status === 201 && folderId?.startsWith("folder:tenant:template-city:"),
    `status=${created.status} folderId=${folderId}`,
  );
  if (!folderId) {
    process.exit(2);
  }

  const up1 = await call("POST", `/api/smart-files/folders/${encodeURIComponent(folderId)}/files`, {
    orgId: "template-city",
    userId: "staff",
    title: "Site plan",
    contentType: "application/pdf",
    bytesBase64: Buffer.from(`site plan v1 ${runTag}`).toString("base64"),
    docSlug,
    provenance: provenance({ originalFilename: `site-plan-v1-${runTag}.pdf` }),
  });
  const entityId = up1.json?.file?.entityId;
  record(
    "v1 upload lands under smartfile:tenant:template-city:%, version 1, not a revision",
    up1.status === 201 &&
      entityId === `smartfile:tenant:template-city:${docSlug}` &&
      up1.json?.file?.currentVersion === 1 &&
      up1.json?.file?.revision === false,
    `status=${up1.status} entityId=${entityId} version=${up1.json?.file?.currentVersion} revision=${up1.json?.file?.revision}`,
  );

  const up2 = await call("POST", `/api/smart-files/folders/${encodeURIComponent(folderId)}/files`, {
    orgId: "template-city",
    userId: "staff",
    title: "Site plan",
    contentType: "application/pdf",
    bytesBase64: Buffer.from(`site plan v2 revised ${runTag}`).toString("base64"),
    docSlug,
    provenance: provenance({ originalFilename: `site-plan-v2-${runTag}.pdf` }),
  });
  record(
    "v2 upload, SAME docSlug, is a new version of the SAME document",
    up2.status === 201 &&
      up2.json?.file?.entityId === entityId &&
      up2.json?.file?.currentVersion === 2 &&
      up2.json?.file?.revision === true,
    `status=${up2.status} entityId=${up2.json?.file?.entityId} version=${up2.json?.file?.currentVersion} revision=${up2.json?.file?.revision}`,
  );

  const missingKey = await call(
    "POST",
    `/api/smart-files/folders/${encodeURIComponent(folderId)}/files`,
    {
      orgId: "template-city",
      userId: "staff",
      title: "x",
      bytesBase64: Buffer.from("x").toString("base64"),
      docSlug: `${docSlug}-missing-role`,
      provenance: (() => {
        const p = provenance();
        delete p.declaredRole;
        return p;
      })(),
    },
  );
  record(
    "missing declaredRole refuses (400), never defaults",
    missingKey.status === 400,
    `status=${missingKey.status}`,
  );

  const badSlug = await call(
    "POST",
    `/api/smart-files/folders/${encodeURIComponent(folderId)}/files`,
    {
      orgId: "template-city",
      userId: "staff",
      title: "x",
      bytesBase64: Buffer.from("x").toString("base64"),
      docSlug: `${docSlug}:extra`,
      provenance: provenance(),
    },
  );
  record("docSlug containing a colon refuses (400)", badSlug.status === 400, `status=${badSlug.status}`);

  const badKind = await call(
    "POST",
    `/api/smart-files/folders/${encodeURIComponent(folderId)}/files`,
    {
      orgId: "template-city",
      userId: "staff",
      title: "x",
      bytesBase64: Buffer.from("x").toString("base64"),
      docSlug: `${docSlug}-bad-kind`,
      provenance: provenance({ sourceKind: "not-a-real-kind" }),
    },
  );
  record(
    "sourceKind outside the closed set refuses (400)",
    badKind.status === 400,
    `status=${badKind.status}`,
  );

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`probe crashed: ${err?.stack || err}\n`);
  process.exit(2);
});
