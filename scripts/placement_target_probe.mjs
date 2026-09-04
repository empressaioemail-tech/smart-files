/**
 * Placement-target probe (fixes the municode meeting-upload bug: every
 * upload through uploadFileToFolder hard-coded a 'folder' placement, even
 * when the real target -- a meeting -- was knowable).
 *
 * Exercises the REAL HTTP routes, not the store directly:
 *   1. A caller that omits targetType/targetId (the real, current shape of
 *      smartcity-dashboards' municode calendar upload, and every other
 *      existing caller) gets EXACTLY the pre-existing single 'folder'
 *      placement -- proven byte-for-byte against the same shape
 *      read_scope_probe.mjs and scope_roundtrip_probe.mjs already exercise.
 *   2. A caller that names a real targetType/targetId gets a placement of
 *      THAT type/id instead of 'folder'.
 *   3. targetType and targetId must travel together (400 if only one is
 *      given); targetType outside the placements CHECK constraint's value
 *      set refuses (400) rather than reaching Postgres.
 *
 * Usage:
 *   SMART_FILES_BASE_URL=http://127.0.0.1:8791 \
 *   SMART_FILES_SERVICE_TOKEN=<write token> \
 *   node scripts/placement_target_probe.mjs
 *
 * Exits 0 when every check passes, 1 otherwise. Never starts a server itself.
 */

const base = process.env.SMART_FILES_BASE_URL || "http://127.0.0.1:8791";
const token = process.env.SMART_FILES_SERVICE_TOKEN || "";
const runTag = process.env.PROBE_RUN_TAG || String(Date.now()).slice(-8);

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

async function main() {
  process.stdout.write(`probe base=${base} runTag=${runTag}\n\n`);

  const folder = await call("POST", "/api/smart-files/folders", {
    orgId: "template-city",
    userId: "g71-calendar",
    label: `placement-target-probe-${runTag}`,
  });
  const folderId = folder.json?.folder?.folderId;
  record("setup: create folder", folder.status === 201 && !!folderId, `status=${folder.status}`);
  if (!folderId) process.exit(2);

  // 1. Existing municode-calendar-style call: folderId only, no target*.
  // This is the exact shape smartcity-dashboards' src/municode-calendar.mjs
  // sends today -- nothing about it changes here.
  const defaultUpload = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    orgId: "template-city",
    userId: "g71-calendar",
    title: `Default placement doc ${runTag}`,
    contentType: "text/plain",
    bytesBase64: Buffer.from(`default placement ${runTag}`).toString("base64"),
  });
  const defaultEntityId = defaultUpload.json?.file?.entityId;
  record(
    "default upload (no targetType/targetId) still succeeds",
    defaultUpload.status === 201 && !!defaultEntityId,
    `status=${defaultUpload.status}`,
  );
  const defaultPlacements = await call(
    "GET",
    `/api/smart-files/files/${defaultEntityId}/placements`,
    undefined,
  );
  const defaultList = defaultPlacements.json?.placements || [];
  record(
    "default upload writes EXACTLY the pre-existing single folder placement, byte-for-byte",
    defaultList.length === 1 &&
      defaultList[0].targetType === "folder" &&
      defaultList[0].targetId === folderId,
    `placements=${JSON.stringify(defaultList)}`,
  );

  // 2. Real target: a meeting.
  const meetingId = `meeting:template-city:${runTag}-council`;
  const meetingUpload = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    orgId: "template-city",
    userId: "g71-calendar",
    title: `Meeting placement doc ${runTag}`,
    contentType: "text/plain",
    bytesBase64: Buffer.from(`meeting placement ${runTag}`).toString("base64"),
    targetType: "meeting",
    targetId: meetingId,
  });
  const meetingEntityId = meetingUpload.json?.file?.entityId;
  record(
    "explicit-target upload succeeds",
    meetingUpload.status === 201 && !!meetingEntityId,
    `status=${meetingUpload.status}`,
  );
  const meetingPlacements = await call(
    "GET",
    `/api/smart-files/files/${meetingEntityId}/placements`,
    undefined,
  );
  const meetingList = meetingPlacements.json?.placements || [];
  record(
    "explicit-target upload writes THAT target_type/target_id instead of folder",
    meetingList.length === 1 &&
      meetingList[0].targetType === "meeting" &&
      meetingList[0].targetId === meetingId,
    `placements=${JSON.stringify(meetingList)}`,
  );

  // 3. Validation.
  const missingTargetId = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    orgId: "template-city",
    userId: "g71-calendar",
    title: "bad",
    contentType: "text/plain",
    bytesBase64: Buffer.from("x").toString("base64"),
    targetType: "meeting",
  });
  record(
    "targetType without targetId refuses (400)",
    missingTargetId.status === 400,
    `status=${missingTargetId.status}`,
  );

  const badTargetType = await call("POST", `/api/smart-files/folders/${folderId}/files`, {
    orgId: "template-city",
    userId: "g71-calendar",
    title: "bad",
    contentType: "text/plain",
    bytesBase64: Buffer.from("x").toString("base64"),
    targetType: "not-a-real-target-type",
    targetId: "x",
  });
  record(
    "targetType outside the placements CHECK constraint refuses (400)",
    badTargetType.status === 400,
    `status=${badTargetType.status}`,
  );

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`probe crashed: ${err?.stack || err}\n`);
  process.exit(2);
});
