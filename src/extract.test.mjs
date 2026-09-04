import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSearchText, SEARCH_INDEXABLE_CONTENT_TYPES } from "./extract.mjs";

/**
 * A minimal, valid, single-page PDF built entirely from PDF primitives
 * (catalog -> pages -> page -> content stream drawing text with Tj), with a
 * byte-accurate xref table. No binary fixture checked in, no external tool:
 * this is real PDF syntax a real reader parses, not a mock.
 */
function buildMinimalPdf(text) {
  const objs = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  );
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objs.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

test("SEARCH_INDEXABLE_CONTENT_TYPES is exactly application/pdf", () => {
  assert.deepEqual(SEARCH_INDEXABLE_CONTENT_TYPES, ["application/pdf"]);
});

test("non-PDF content types are skipped cleanly: not attempted, not an error", async () => {
  const result = await extractSearchText(
    "application/json",
    Buffer.from('{"agenda":"item 4"}'),
  );
  assert.deepEqual(result, {
    attempted: false,
    text: null,
    reason: "content-type-not-indexable",
  });
});

test("a real PDF's text layer is extracted", async () => {
  const pdf = buildMinimalPdf("Bastrop City Council Meeting");
  const result = await extractSearchText("application/pdf", pdf);
  assert.equal(result.attempted, true);
  assert.equal(result.reason, null);
  assert.match(result.text, /Bastrop City Council Meeting/);
});

test("a corrupt PDF fails extraction honestly: attempted, text null, reason named, never throws", async () => {
  const garbage = Buffer.from("this is not a pdf at all, just plain bytes");
  const result = await extractSearchText("application/pdf", garbage);
  assert.equal(result.attempted, true);
  assert.equal(result.text, null);
  assert.match(result.reason, /^extraction-failed:/);
});

test("extraction never throws even on empty bytes", async () => {
  await assert.doesNotReject(() => extractSearchText("application/pdf", Buffer.alloc(0)));
});
