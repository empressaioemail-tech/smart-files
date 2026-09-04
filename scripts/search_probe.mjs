/**
 * Real content search probe (search wave, 2026-09-04 decision:
 * doc_repo/_decisions/2026-09-04_smart_files_search_wave_scope.md).
 *
 * Exercises the REAL HTTP routes, not the store directly:
 *   1. A PDF upload is extracted and indexed synchronously -- the upload
 *      response says so (searchIndexed: true), and GET /search finds it by
 *      real word content, with a real snippet.
 *   2. A JSON upload (the real bastrop_tx meeting-record shape) is never
 *      even attempted for extraction (searchIndexed: false, reason
 *      content-type-not-indexable) and never appears in search results.
 *   3. GET /search is gated exactly like every other read route: anonymous
 *      and wrong-tenant tokens refuse (403), a matching-tenant token
 *      succeeds (200) -- proven BEFORE any data is touched, same pattern as
 *      read_scope_probe.mjs.
 *   4. A missing/too-short q refuses (400) rather than running an
 *      unbounded query.
 *
 * Usage:
 *   SMART_FILES_BASE_URL=http://127.0.0.1:8791 \
 *   SMART_FILES_SERVICE_TOKEN=<write token> \
 *   MATCH_TOKEN=<token granted tenant/template-city> \
 *   WRONG_TOKEN=<token granted tenant/acme only> \
 *   node scripts/search_probe.mjs
 *
 * Exits 0 when every check passes, 1 otherwise. Never starts a server itself.
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

/**
 * A minimal, valid, single-page PDF built entirely from PDF primitives, with
 * a byte-accurate xref table -- real PDF syntax, not a mock. Same
 * construction proven against pdf-parse in src/extract.test.mjs.
 */
function buildMinimalPdf(text) {
  const objs = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  );
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objs.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function main() {
  process.stdout.write(`probe base=${base} runTag=${runTag}\n\n`);

  const folder = await call("POST", "/api/smart-files/folders", {
    token: writeToken,
    body: { orgId: "template-city", userId: "staff", label: `search-probe-${runTag}` },
  });
  const folderId = folder.json?.folder?.folderId;
  record("setup: create folder", folder.status === 201 && !!folderId, `status=${folder.status}`);
  if (!folderId) process.exit(2);

  const uniqueWord = `probeword${runTag}`;
  const pdfBytes = buildMinimalPdf(`City Council agenda ${uniqueWord} budget item`);
  const pdfUpload = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    token: writeToken,
    body: {
      orgId: "template-city",
      userId: "staff",
      title: `Council minutes ${runTag}`,
      contentType: "application/pdf",
      bytesBase64: pdfBytes.toString("base64"),
    },
  });
  record(
    "PDF upload is indexed synchronously (searchIndexed: true)",
    pdfUpload.status === 201 &&
      pdfUpload.json?.file?.searchIndexed === true &&
      pdfUpload.json?.file?.searchIndexReason === null,
    `status=${pdfUpload.status} searchIndexed=${pdfUpload.json?.file?.searchIndexed} reason=${pdfUpload.json?.file?.searchIndexReason}`,
  );
  const pdfEntityId = pdfUpload.json?.file?.entityId;

  const jsonUpload = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    token: writeToken,
    body: {
      orgId: "template-city",
      userId: "staff",
      title: `Meeting record ${runTag}`,
      contentType: "application/json",
      bytesBase64: Buffer.from(
        JSON.stringify({ agenda: `special session ${uniqueWord} minutes` }),
      ).toString("base64"),
    },
  });
  record(
    "real bastrop_tx shape (application/json) is never attempted, never errors",
    jsonUpload.status === 201 &&
      jsonUpload.json?.file?.searchIndexed === false &&
      jsonUpload.json?.file?.searchIndexReason === "content-type-not-indexable",
    `status=${jsonUpload.status} searchIndexed=${jsonUpload.json?.file?.searchIndexed} reason=${jsonUpload.json?.file?.searchIndexReason}`,
  );

  process.stdout.write("\n--- search access control (mirrors read_scope_probe.mjs) ---\n");
  const searchPath = `/api/smart-files/search?scopeType=tenant&scopeId=template-city&q=${encodeURIComponent(uniqueWord)}`;
  const anon = await call("GET", searchPath);
  record("search: anonymous refused", anon.status === 403, `status=${anon.status}`);
  const wrong = await call("GET", searchPath, { token: wrongToken });
  record("search: wrong-tenant token refused", wrong.status === 403, `status=${wrong.status}`);
  const match = await call("GET", searchPath, { token: matchToken });
  record("search: matching-tenant token allowed", match.status === 200, `status=${match.status}`);

  process.stdout.write("\n--- search query behavior ---\n");
  record(
    "search finds the indexed PDF by real word content",
    match.json?.results?.some((r) => r.entityId === pdfEntityId),
    `results=${JSON.stringify(match.json?.results?.map((r) => r.entityId))}`,
  );
  const hit = match.json?.results?.find((r) => r.entityId === pdfEntityId);
  record(
    "search result carries a real snippet, not raw blob bytes",
    typeof hit?.snippet === "string" && hit.snippet.includes(uniqueWord) && !("bytes" in (hit || {})),
    `snippet=${JSON.stringify(hit?.snippet)}`,
  );
  record(
    "the unindexed JSON upload never appears in search results",
    !match.json?.results?.some((r) => r.entityId === jsonUpload.json?.file?.entityId),
    `results=${JSON.stringify(match.json?.results?.map((r) => r.entityId))}`,
  );

  const noQ = await call(
    "GET",
    "/api/smart-files/search?scopeType=tenant&scopeId=template-city",
    { token: matchToken },
  );
  record("search: missing q refuses (400)", noQ.status === 400, `status=${noQ.status}`);
  const shortQ = await call(
    "GET",
    "/api/smart-files/search?scopeType=tenant&scopeId=template-city&q=a",
    { token: matchToken },
  );
  record("search: trivial (1-char) q refuses (400)", shortQ.status === 400, `status=${shortQ.status}`);

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`probe crashed: ${err?.stack || err}\n`);
  process.exit(2);
});
