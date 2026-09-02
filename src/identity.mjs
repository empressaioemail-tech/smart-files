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

export function isValidDocSlug(docSlug) {
  return DOC_SLUG_RE.test(String(docSlug ?? ""));
}

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

/**
 * G-106 / defect #3: the read-path caller scope model.
 *
 * A read-side caller identity is a token bound to an explicit list of grants,
 * each a (scopeType, scopeId) pair the token may read. "*" is accepted in
 * either field but must be written out by whoever configures the token --
 * there is no default that grants it, because the whole point of this model
 * is that an unconfigured or wrong-scope token reads nothing.
 */
export const ALL_SCOPES = "*";

export function parseServiceIdentities(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`SMART_FILES_SERVICE_TOKENS is not valid JSON: ${cause.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("SMART_FILES_SERVICE_TOKENS must be a JSON array");
  }
  return parsed.map((entry, i) => {
    if (!entry?.token || !Array.isArray(entry?.grants) || entry.grants.length === 0) {
      throw new Error(
        `SMART_FILES_SERVICE_TOKENS[${i}] needs a token and a non-empty grants array`,
      );
    }
    return {
      token: String(entry.token),
      grants: entry.grants.map((g, j) => {
        if (!g?.scopeType || !g?.scopeId) {
          throw new Error(
            `SMART_FILES_SERVICE_TOKENS[${i}].grants[${j}] needs scopeType and scopeId`,
          );
        }
        return { scopeType: String(g.scopeType), scopeId: String(g.scopeId) };
      }),
    };
  });
}

export function resolveCallerIdentity(token, identities) {
  if (!token) return null;
  return identities.find((i) => i.token === token) ?? null;
}

export function identityHasBlanketGrant(identity) {
  return (
    identity?.grants.some((g) => g.scopeType === ALL_SCOPES && g.scopeId === ALL_SCOPES) ?? false
  );
}

export function identityAllowsScope(identity, scopeType, scopeId) {
  if (!identity) return false;
  return identity.grants.some(
    (g) =>
      (g.scopeType === ALL_SCOPES || g.scopeType === scopeType) &&
      (g.scopeId === ALL_SCOPES || g.scopeId === scopeId),
  );
}

/**
 * G-107 / transaction-contract provenance (_inbox/2026-08-24_govtech_transaction_contract.md,
 * "Provenance stops being free jsonb"). Five keys, all required: a missing
 * one refuses the write rather than defaulting. Callers that do not pass a
 * `provenance` object at all keep the pre-existing {sourceLabel, uploadedBy}
 * shape in store.mjs -- this validator only applies once a caller opts in.
 */
export const PROVENANCE_SOURCE_KINDS = [
  "staff-upload",
  "applicant-upload",
  "feed",
  "instrument-write",
];

const PROVENANCE_REQUIRED_STRING_KEYS = [
  "capturedBy",
  "capturedAt",
  "sourceKind",
  "originalFilename",
  "declaredRole",
];

export function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") {
    throw new Error("provenance must be an object");
  }
  for (const key of PROVENANCE_REQUIRED_STRING_KEYS) {
    const v = provenance[key];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`provenance.${key} is required`);
    }
  }
  if (!PROVENANCE_SOURCE_KINDS.includes(provenance.sourceKind)) {
    throw new Error(
      `provenance.sourceKind must be one of ${PROVENANCE_SOURCE_KINDS.join(", ")}`,
    );
  }
  if (Number.isNaN(Date.parse(provenance.capturedAt))) {
    throw new Error("provenance.capturedAt must be an ISO-8601 timestamp");
  }
  return {
    capturedBy: provenance.capturedBy,
    capturedAt: provenance.capturedAt,
    sourceKind: provenance.sourceKind,
    originalFilename: provenance.originalFilename,
    declaredRole: provenance.declaredRole,
  };
}

/**
 * True if `identity` may read any of `scopePairs` (or holds a blanket grant).
 * Reads whose underlying resource can name more than one scope candidate --
 * today just a content-addressed blob, which can be referenced from more
 * than one document -- use this instead of a single identityAllowsScope call.
 * An empty `scopePairs` (nothing found to check against) allows only a
 * blanket grant: an unknown scope is refused, never defaulted to open.
 */
export function identityAllowsAnyScope(identity, scopePairs) {
  if (!identity) return false;
  if (identityHasBlanketGrant(identity)) return true;
  return scopePairs.some((s) => identityAllowsScope(identity, s.scopeType, s.scopeId));
}
