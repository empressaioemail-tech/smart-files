import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSmartFileEntityId,
  parseSmartFileEntityId,
  jurisdictionFipsFromEntityParts,
} from "./identity.mjs";

test("roundtrip jurisdiction", () => {
  const id = buildSmartFileEntityId({
    scopeType: "jurisdiction",
    scopeId: "48021",
    docSlug: "udc",
  });
  assert.equal(id, "smartfile:jurisdiction:48021:udc");
  assert.deepEqual(parseSmartFileEntityId(id), {
    scopeType: "jurisdiction",
    scopeId: "48021",
    docSlug: "udc",
  });
});

test("last-segment-is-slug keeps colons inside site scopeId", () => {
  const id = buildSmartFileEntityId({
    scopeType: "site",
    scopeId: "parcel:48021:R12345",
    docSlug: "geotech",
  });
  assert.equal(id, "smartfile:site:parcel:48021:R12345:geotech");
  assert.deepEqual(parseSmartFileEntityId(id), {
    scopeType: "site",
    scopeId: "parcel:48021:R12345",
    docSlug: "geotech",
  });
});

test("superseded FIPS-only three-segment shape is null", () => {
  assert.equal(parseSmartFileEntityId("smartfile:48021:udc"), null);
});

test("jurisdiction FIPS denorm is null for tenant and site", () => {
  const tenant = parseSmartFileEntityId(
    buildSmartFileEntityId({
      scopeType: "tenant",
      scopeId: "g58-probe",
      docSlug: "isolation-note",
    }),
  );
  assert.equal(jurisdictionFipsFromEntityParts(tenant), null);
  const site = parseSmartFileEntityId(
    buildSmartFileEntityId({
      scopeType: "site",
      scopeId: "parcel:48021:R12345",
      docSlug: "geotech",
    }),
  );
  assert.equal(jurisdictionFipsFromEntityParts(site), null);
});
