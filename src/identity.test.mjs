import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSmartFileEntityId,
  isInstrumentNodeId,
  parseSmartFileEntityId,
  jurisdictionFipsFromEntityParts,
  SMART_FILE_SCOPE_TYPES,
  scopeIdIsValid,
  WRITABLE_SCOPE_TYPES,
  identityAllowsAnyScope,
  identityAllowsScope,
  identityHasBlanketGrant,
  parseServiceIdentities,
  resolveCallerIdentity,
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

// --- TW-4: the instrument scope --------------------------------------------

const NODE_ID = "sec_01JCZK8QW9V4T6XH2NBGRPY5MD";

test("instrument is a scope type and is writable", () => {
  assert.ok(SMART_FILE_SCOPE_TYPES.includes("instrument"));
  assert.ok(WRITABLE_SCOPE_TYPES.includes("instrument"));
  assert.ok(WRITABLE_SCOPE_TYPES.includes("tenant"));
  // jurisdiction and site documents are produced elsewhere; this service reads
  // them but has never written them, and that stays true.
  assert.equal(WRITABLE_SCOPE_TYPES.includes("jurisdiction"), false);
  assert.equal(WRITABLE_SCOPE_TYPES.includes("site"), false);
});

test("roundtrip instrument, keyed to a security-master node", () => {
  const id = buildSmartFileEntityId({
    scopeType: "instrument",
    scopeId: NODE_ID,
    docSlug: "10-k-2025",
  });
  assert.equal(id, `smartfile:instrument:${NODE_ID}:10-k-2025`);
  assert.deepEqual(parseSmartFileEntityId(id), {
    scopeType: "instrument",
    scopeId: NODE_ID,
    docSlug: "10-k-2025",
  });
});

test("iss_ nodes are accepted alongside sec_", () => {
  const id = buildSmartFileEntityId({
    scopeType: "instrument",
    scopeId: "iss_01JCZK8QW9V4T6XH2NBGRPY5MD",
    docSlug: "def-14a-2025",
  });
  assert.equal(parseSmartFileEntityId(id).scopeId, "iss_01JCZK8QW9V4T6XH2NBGRPY5MD");
});

test("instrument jurisdiction denorm is null", () => {
  const parts = parseSmartFileEntityId(
    buildSmartFileEntityId({
      scopeType: "instrument",
      scopeId: NODE_ID,
      docSlug: "10-k-2025",
    }),
  );
  assert.equal(jurisdictionFipsFromEntityParts(parts), null);
});

test("instrument validator is its own rule, not the FIPS rule and not the tenant rule", () => {
  const rejected = [
    ["a FIPS code", "48021"],
    ["a tenant slug", "acme"],
    ["another tenant slug", "icc-demo"],
    ["a lowercase ULID", "sec_01jczk8qw9v4t6xh2nbgrpy5md"],
    ["a bare ULID with no prefix", "01JCZK8QW9V4T6XH2NBGRPY5MD"],
    ["an unknown prefix", "cik_01JCZK8QW9V4T6XH2NBGRPY5MD"],
    ["25 characters", "sec_01JCZK8QW9V4T6XH2NBGRPY5M"],
    ["27 characters", "sec_01JCZK8QW9V4T6XH2NBGRPY5MDX"],
    ["Crockford-excluded I", "sec_01JCZK8QW9V4T6XH2NBGRPY5MI"],
    ["Crockford-excluded L", "sec_01JCZK8QW9V4T6XH2NBGRPY5ML"],
    ["Crockford-excluded O", "sec_01JCZK8QW9V4T6XH2NBGRPY5MO"],
    ["Crockford-excluded U", "sec_01JCZK8QW9V4T6XH2NBGRPY5MU"],
    ["a hyphen instead of an underscore", "sec-01JCZK8QW9V4T6XH2NBGRPY5MD"],
    ["an empty string", ""],
  ];
  for (const [why, scopeId] of rejected) {
    assert.equal(isInstrumentNodeId(scopeId), false, `should reject ${why}`);
    assert.equal(scopeIdIsValid("instrument", scopeId), false, `should reject ${why}`);
    assert.throws(
      () =>
        buildSmartFileEntityId({ scopeType: "instrument", scopeId, docSlug: "doc" }),
      /instrument scopeId|scopeId must be non-empty/,
      `should reject ${why}`,
    );
  }
});

test("an instrument scopeId cannot swallow extra colons", () => {
  // The parser is last-segment-is-slug, so a colon inside the scopeId would
  // silently absorb a segment for `site`. For `instrument` it must not.
  assert.equal(parseSmartFileEntityId(`smartfile:instrument:${NODE_ID}:extra:doc`), null);
  assert.throws(() =>
    buildSmartFileEntityId({
      scopeType: "instrument",
      scopeId: `${NODE_ID}:extra`,
      docSlug: "doc",
    }),
  );
});

// --- TW-4: the tenant rule must NOT be tightened -----------------------------

test("every live tenant slug still builds and parses", () => {
  // These are in production against the first consumer. A tenant scopeId is
  // ANY non-empty string; adding a tenant regex breaks this test on purpose.
  for (const slug of ["icc-demo", "acme", "empressa", "template-city", "g58-probe"]) {
    const id = buildSmartFileEntityId({
      scopeType: "tenant",
      scopeId: slug,
      docSlug: "site-plan-sheet.txt",
    });
    assert.equal(id, `smartfile:tenant:${slug}:site-plan-sheet.txt`);
    assert.deepEqual(parseSmartFileEntityId(id), {
      scopeType: "tenant",
      scopeId: slug,
      docSlug: "site-plan-sheet.txt",
    });
    assert.equal(scopeIdIsValid("tenant", slug), true);
  }
});

test("tenant accepts shapes no other scope would, and site keeps its colons", () => {
  for (const odd of ["A", "Mixed_Case", "9", "has spaces", "sec_01JCZK8QW9V4T6XH2NBGRPY5MD"]) {
    assert.equal(scopeIdIsValid("tenant", odd), true, `tenant must still accept ${odd}`);
  }
  assert.equal(scopeIdIsValid("tenant", ""), false);
  assert.equal(scopeIdIsValid("site", "parcel:48021:R12345"), true);
  assert.equal(scopeIdIsValid("site", ""), false);
});

test("jurisdiction keeps the FIPS rule it already had", () => {
  assert.equal(scopeIdIsValid("jurisdiction", "48021"), true);
  assert.equal(scopeIdIsValid("jurisdiction", "bastrop"), false);
  assert.equal(scopeIdIsValid("instrument", "48021"), false);
});

// --- G-106: the read-path caller scope model ---------------------------------

test("parseServiceIdentities: empty/absent env yields no identities", () => {
  assert.deepEqual(parseServiceIdentities(undefined), []);
  assert.deepEqual(parseServiceIdentities(""), []);
});

test("parseServiceIdentities: rejects malformed JSON, non-array, and missing fields", () => {
  assert.throws(() => parseServiceIdentities("not json"), /not valid JSON/);
  assert.throws(() => parseServiceIdentities("{}"), /must be a JSON array/);
  assert.throws(
    () => parseServiceIdentities(JSON.stringify([{ token: "t" }])),
    /needs a token and a non-empty grants array/,
  );
  assert.throws(
    () => parseServiceIdentities(JSON.stringify([{ token: "t", grants: [{ scopeType: "tenant" }] }])),
    /needs scopeType and scopeId/,
  );
});

test("parseServiceIdentities: parses a well-formed grant list", () => {
  const identities = parseServiceIdentities(
    JSON.stringify([
      { token: "tok-a", grants: [{ scopeType: "tenant", scopeId: "template-city" }] },
      { token: "tok-b", grants: [{ scopeType: "*", scopeId: "*" }] },
    ]),
  );
  assert.equal(identities.length, 2);
  assert.equal(identities[0].token, "tok-a");
  assert.deepEqual(identities[0].grants, [{ scopeType: "tenant", scopeId: "template-city" }]);
});

test("resolveCallerIdentity: no token, unknown token, and empty identity list all resolve null", () => {
  const identities = parseServiceIdentities(
    JSON.stringify([{ token: "tok-a", grants: [{ scopeType: "tenant", scopeId: "acme" }] }]),
  );
  assert.equal(resolveCallerIdentity("", identities), null);
  assert.equal(resolveCallerIdentity("tok-nope", identities), null);
  assert.equal(resolveCallerIdentity("tok-a", []), null);
  assert.ok(resolveCallerIdentity("tok-a", identities));
});

test("identityAllowsScope: exact match, wrong tenant, and per-field wildcards", () => {
  const [scoped] = parseServiceIdentities(
    JSON.stringify([
      { token: "t", grants: [{ scopeType: "tenant", scopeId: "template-city" }] },
    ]),
  );
  assert.equal(identityAllowsScope(scoped, "tenant", "template-city"), true);
  assert.equal(identityAllowsScope(scoped, "tenant", "acme"), false);
  assert.equal(identityAllowsScope(scoped, "instrument", "template-city"), false);
  assert.equal(identityAllowsScope(null, "tenant", "template-city"), false);

  const [wildcardId] = parseServiceIdentities(
    JSON.stringify([{ token: "t", grants: [{ scopeType: "tenant", scopeId: "*" }] }]),
  );
  assert.equal(identityAllowsScope(wildcardId, "tenant", "acme"), true);
  assert.equal(identityAllowsScope(wildcardId, "tenant", "template-city"), true);
  assert.equal(identityAllowsScope(wildcardId, "instrument", "acme"), false);
});

test("identityHasBlanketGrant: only an explicit */* grant qualifies", () => {
  const [blanket] = parseServiceIdentities(
    JSON.stringify([{ token: "t", grants: [{ scopeType: "*", scopeId: "*" }] }]),
  );
  const [narrow] = parseServiceIdentities(
    JSON.stringify([{ token: "t", grants: [{ scopeType: "tenant", scopeId: "*" }] }]),
  );
  assert.equal(identityHasBlanketGrant(blanket), true);
  assert.equal(identityHasBlanketGrant(narrow), false);
  assert.equal(identityHasBlanketGrant(null), false);
});

test("identityAllowsAnyScope: an unknown scope (empty candidate list) refuses without a blanket grant", () => {
  const [scoped] = parseServiceIdentities(
    JSON.stringify([{ token: "t", grants: [{ scopeType: "tenant", scopeId: "template-city" }] }]),
  );
  const [blanket] = parseServiceIdentities(
    JSON.stringify([{ token: "t", grants: [{ scopeType: "*", scopeId: "*" }] }]),
  );
  // The defect this closes: no caller, scoped or not, reads an orphaned or
  // unparseable resource by default.
  assert.equal(identityAllowsAnyScope(scoped, []), false);
  assert.equal(identityAllowsAnyScope(null, []), false);
  assert.equal(identityAllowsAnyScope(blanket, []), true);
  assert.equal(
    identityAllowsAnyScope(scoped, [{ scopeType: "tenant", scopeId: "acme" }]),
    false,
  );
  assert.equal(
    identityAllowsAnyScope(scoped, [
      { scopeType: "tenant", scopeId: "acme" },
      { scopeType: "tenant", scopeId: "template-city" },
    ]),
    true,
  );
});
