// An early look for a PDF/A claim, so the Protect dialog can say before the run that the protected copy
// cannot be PDF/A (design 5.18, the lead's PDF/A ruling). PDF/A keeps its XMP metadata stream
// uncompressed (ISO 19005: the metadata stream has no /Filter), so the property naming the PDF/A part,
// `pdfaid:part`, is in the file's bytes as written. This is a hint only: protect.ts reads the XMP
// itself and its report (noLongerArchival) decides what the result says and records, including a claim
// inside a compressed stream, which this scan cannot see.

const BEFORE = Array.from('pdfaid', (c) => c.charCodeAt(0));
const AFTER = Array.from('part', (c) => c.charCodeAt(0));
const COLON = 0x3a;
const NEEDLE_LENGTH = BEFORE.length + 1 + AFTER.length;

/**
 * Whether the bytes hold an uncompressed XMP claim of PDF/A (`pdfaid:part`, element or attribute form,
 * any part). The colon is found by the engine's own search (about one byte in 256 of compressed data is
 * one), and only there are the letters around it compared: one pass, no copy.
 */
export function claimsPdfA(bytes: Uint8Array): boolean {
  const from = BEFORE.length;
  const to = bytes.length - AFTER.length;
  for (let at = bytes.indexOf(COLON, from); at !== -1 && at < to; at = bytes.indexOf(COLON, at + 1)) {
    if (BEFORE.every((c, k) => bytes[at - BEFORE.length + k] === c) && AFTER.every((c, k) => bytes[at + 1 + k] === c)) return true;
  }
  return false;
}

/** About this much is scanned between two turns of the event loop (a 150 MB file took 1.8 s in one go on a loaded machine). */
export const SCAN_SLICE_BYTES = 4 * 1024 * 1024;

/**
 * claimsPdfA in slices, giving the window a turn between them, so a large file never holds the dialog
 * while it opens. Slices overlap by the needle's length, so a claim across a boundary is found. Resolves
 * null when `signal` is aborted (the dialog closed).
 */
export async function scanForPdfA(bytes: Uint8Array, signal?: AbortSignal, slice = SCAN_SLICE_BYTES): Promise<boolean | null> {
  for (let start = 0; start < bytes.length; start += slice) {
    if (signal?.aborted) return null;
    if (claimsPdfA(bytes.subarray(Math.max(0, start - NEEDLE_LENGTH + 1), Math.min(bytes.length, start + slice)))) return true;
    if (start + slice < bytes.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return signal?.aborted ? null : false;
}
