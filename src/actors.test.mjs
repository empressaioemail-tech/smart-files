import assert from "node:assert/strict";
import { test } from "node:test";
import { QA_PERSONAS, resolvePersona } from "./actors.mjs";

test("G-71 calendar actor is a QA persona so files writes can scope to template-city", () => {
  assert.equal(resolvePersona("template-city", "g71-calendar")?.orgId, "template-city");
  assert.equal(resolvePersona("icc-demo", "reviewer")?.userId, "reviewer");
  assert.equal(resolvePersona("template-city", "unknown"), null);
  assert.equal(
    QA_PERSONAS.some((p) => p.orgId === "template-city" && p.userId === "g71-calendar"),
    true,
  );
});
