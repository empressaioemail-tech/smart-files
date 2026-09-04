import pdfParse from "pdf-parse";

/**
 * Content types the search wave extracts text from. Everything else
 * (including the real bastrop_tx meeting records, which are
 * application/json) skips extraction cleanly: no attempt, no error.
 */
export const SEARCH_INDEXABLE_CONTENT_TYPES = ["application/pdf"];

/**
 * Best-effort search-text extraction (smart-files search wave,
 * 2026-09-04 decision). Never throws: a corrupt PDF or a scanned/image-only
 * PDF with no text layer is a real, expected outcome, not a bug, and must
 * not fail the upload it is attached to -- see uploadFileToFolder in
 * store.mjs, which fails only the search indexing, never the write. Returns
 * `text: null` for every case where the version is not searchable, with
 * `reason` naming why: not attempted (wrong content type) is distinguished
 * from attempted-and-failed, so nothing here is silently pretended to work.
 *
 * pdf-parse@1.1.4 bundles a legacy pdf.js build that mis-parses a real,
 * valid PDF's xref table when handed a Node Buffer directly -- every input,
 * corrupt or not, throws "bad XRef entry". It wants a plain Uint8Array.
 * Confirmed against both a hand-built minimal PDF and a real, pdfkit-
 * generated one: identical bytes, only the typed-array wrapper differs
 * between failure and success. That conversion below is the fix for this
 * library version, not a workaround for a bad input.
 */
export async function extractSearchText(contentType, buf) {
  if (contentType !== "application/pdf") {
    return { attempted: false, text: null, reason: "content-type-not-indexable" };
  }
  try {
    const bytes = new Uint8Array(buf);
    const parsed = await pdfParse(bytes);
    const text = (parsed.text || "").trim();
    if (!text) {
      return { attempted: true, text: null, reason: "no-text-layer" };
    }
    return { attempted: true, text, reason: null };
  } catch (cause) {
    return { attempted: true, text: null, reason: `extraction-failed: ${cause.message}` };
  }
}
