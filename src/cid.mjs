import { createHash, randomBytes } from "node:crypto";

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function slugify(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return SLUG_RE.test(s) ? s : "";
}

export function contentCidFromBytes(buf) {
  const hex = createHash("sha256").update(buf).digest("hex");
  return `sha256:${hex}`;
}

export function shareToken() {
  return randomBytes(18).toString("base64url");
}

/**
 * Folder ids mirror document identity: `folder:<scopeType>:<scopeId>:<slug>`.
 * scopeType defaults to `tenant` so every existing caller and id is unchanged.
 */
export function buildFolderId(scopeId, slug, scopeType = "tenant") {
  const s = slugify(slug);
  if (!s) throw new Error("folder slug is not a slug");
  return `folder:${scopeType}:${scopeId}:${s}`;
}
