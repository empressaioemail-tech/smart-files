import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFolderId, contentCidFromBytes, slugify } from "./cid.mjs";

test("slugify and folder id", () => {
  assert.equal(slugify("Closing Room"), "closing-room");
  assert.equal(buildFolderId("acme", "Closing Room"), "folder:tenant:acme:closing-room");
});

test("folder id defaults to tenant so every live folder id is unchanged", () => {
  for (const slug of ["icc-demo", "acme", "empressa", "template-city", "g58-probe"]) {
    assert.equal(buildFolderId(slug, "Room"), `folder:tenant:${slug}:room`);
  }
});

test("instrument folders carry the scope type in the id", () => {
  assert.equal(
    buildFolderId("sec_01JCZK8QW9V4T6XH2NBGRPY5MD", "SEC filings", "instrument"),
    "folder:instrument:sec_01JCZK8QW9V4T6XH2NBGRPY5MD:sec-filings",
  );
});

test("cid is sha256 of bytes", () => {
  const cid = contentCidFromBytes(Buffer.from("hello"));
  assert.match(cid, /^sha256:[0-9a-f]{64}$/);
  assert.equal(contentCidFromBytes(Buffer.from("hello")), cid);
  assert.notEqual(contentCidFromBytes(Buffer.from("hello!")), cid);
});
