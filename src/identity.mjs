export const SMART_FILE_ENTITY_ID_PREFIX = "smartfile";

export const SMART_FILE_SCOPE_TYPES = ["jurisdiction", "tenant", "site"];

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

export function buildSmartFileEntityId(parts) {
  const { scopeType, scopeId, docSlug } = parts;
  if (!SMART_FILE_SCOPE_TYPES.includes(scopeType)) {
    throw new Error(
      `smart-file entityId: scopeType must be one of ${SMART_FILE_SCOPE_TYPES.join(", ")}`,
    );
  }
  if (!scopeId) {
    throw new Error("smart-file entityId: scopeId must be non-empty");
  }
  if (scopeType === "jurisdiction" && !JURISDICTION_FIPS_RE.test(scopeId)) {
    throw new Error("smart-file entityId: jurisdiction scopeId must be numeric FIPS");
  }
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
  if (!scopeId) return null;
  if (scopeType === "jurisdiction" && !JURISDICTION_FIPS_RE.test(scopeId)) {
    return null;
  }
  return { scopeType, scopeId, docSlug };
}

export function jurisdictionFipsFromEntityParts(parts) {
  return parts.scopeType === "jurisdiction" ? parts.scopeId : null;
}
