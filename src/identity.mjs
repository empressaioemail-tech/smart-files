export const SMART_FILE_ENTITY_ID_PREFIX = "smartfile";

export const SMART_FILE_SCOPE_TYPES = ["jurisdiction", "tenant", "site", "instrument"];

/**
 * Scope types this service will WRITE. Jurisdiction and site documents are
 * produced elsewhere and are read-only here, which is why the write path has
 * always been narrower than the scope list.
 */
export const WRITABLE_SCOPE_TYPES = ["tenant", "instrument"];

export const SMART_FILE_ACCESS_POLICIES = [
  "public-free",
  "public-paid",
  "platform-internal",
  "tenant-private",
  "tenant-shared",
];

export const DEFAULT_ACCESS_POLICY = "tenant-private";

const JURISDICTION_FIPS_RE = /^[0-9]{5,10}$/;
const DOC_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * A security-master node identifier: `sec_` or `iss_` followed by a ULID in
 * canonical Crockford base32, which is 26 uppercase characters drawn from an
 * alphabet that omits I, L, O and U. Colons are excluded by construction, so
 * an instrument scopeId can never swallow a segment of the entity id.
 */
const INSTRUMENT_NODE_ID_RE = /^(?:sec|iss)_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export function isInstrumentNodeId(scopeId) {
  return INSTRUMENT_NODE_ID_RE.test(String(scopeId ?? ""));
}

/**
 * Per-scope scopeId rules. This table, not the scope list, is the extension
 * point: a new scope type brings its own rule here and touches nothing else.
 *
 * `tenant` and `site` deliberately carry no rule beyond non-empty. Live tenant
 * slugs are free-form (icc-demo, acme, empressa, template-city, g58-probe) and
 * the first consumer depends on that; `site` scopeIds contain colons by design.
 */
export const SCOPE_ID_VALIDATORS = {
  jurisdiction: (scopeId) => JURISDICTION_FIPS_RE.test(scopeId),
  tenant: () => true,
  site: () => true,
  instrument: isInstrumentNodeId,
};

const SCOPE_ID_ERRORS = {
  jurisdiction: "jurisdiction scopeId must be numeric FIPS",
  instrument:
    "instrument scopeId must be sec_ or iss_ followed by a 26-character Crockford base32 ULID",
};

export function scopeIdIsValid(scopeType, scopeId) {
  if (!SMART_FILE_SCOPE_TYPES.includes(scopeType)) return false;
  if (!scopeId) return false;
  const rule = SCOPE_ID_VALIDATORS[scopeType];
  return typeof rule === "function" ? rule(scopeId) : false;
}

export function assertScopeId(scopeType, scopeId) {
  if (!SMART_FILE_SCOPE_TYPES.includes(scopeType)) {
    throw new Error(
      `smart-file entityId: scopeType must be one of ${SMART_FILE_SCOPE_TYPES.join(", ")}`,
    );
  }
  if (!scopeId) {
    throw new Error("smart-file entityId: scopeId must be non-empty");
  }
  if (!scopeIdIsValid(scopeType, scopeId)) {
    throw new Error(
      `smart-file entityId: ${SCOPE_ID_ERRORS[scopeType] || `${scopeType} scopeId is not valid`}`,
    );
  }
}

export function buildSmartFileEntityId(parts) {
  const { scopeType, scopeId, docSlug } = parts;
  assertScopeId(scopeType, scopeId);
  if (!DOC_SLUG_RE.test(docSlug)) {
    throw new Error("smart-file entityId: docSlug is not a slug");
  }
  return `${SMART_FILE_ENTITY_ID_PREFIX}:${scopeType}:${scopeId}:${docSlug}`;
}

export function parseSmartFileEntityId(entityId) {
  const segments = String(entityId).split(":");
  if (segments.length < 4) return null;
  const prefix = segments[0];
  const scopeType = segments[1];
  const docSlug = segments[segments.length - 1];
  if (prefix !== SMART_FILE_ENTITY_ID_PREFIX) return null;
  if (!SMART_FILE_SCOPE_TYPES.includes(scopeType)) return null;
  if (!DOC_SLUG_RE.test(docSlug)) return null;
  const scopeId = segments.slice(2, -1).join(":");
  if (!scopeIdIsValid(scopeType, scopeId)) return null;
  return { scopeType, scopeId, docSlug };
}

export function jurisdictionFipsFromEntityParts(parts) {
  return parts.scopeType === "jurisdiction" ? parts.scopeId : null;
}
