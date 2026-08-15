import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFolderId, contentCidFromBytes, slugify } from "./cid.mjs";

test("slugify and folder id", () => {
  assert.equal(slugify("Closing Room"), "closing-room");
  assert.equal(buildFolderId("acme", "Closing Room"), "folder:tenant:acme:closing-room");
});

test("cid is sha256 of bytes", () => {
  const cid = contentCidFromBytes(Buffer.from("hello"));
  assert.match(cid, /^sha256:[0-9a-f]{64}$/);
  assert.equal(contentCidFromBytes(Buffer.from("hello")), cid);
  assert.notEqual(contentCidFromBytes(Buffer.from("hello!")), cid);
});
