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

export function buildFolderId(orgId, slug) {
  const s = slugify(slug);
  if (!s) throw new Error("folder slug is not a slug");
  return `folder:tenant:${orgId}:${s}`;
}
