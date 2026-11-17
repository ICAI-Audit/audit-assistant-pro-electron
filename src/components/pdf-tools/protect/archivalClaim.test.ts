// The dialog's early look for a PDF/A claim (design 5.18 with the lead's PDF/A ruling): a byte scan of
// the source for the XMP property that names a PDF/A part. PDF/A keeps its XMP uncompressed, so a file
// that really claims PDF/A is found before the run; the run's own report (protect.ts noLongerArchival)
// stays the rule, and covers a claim inside a compressed stream.
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { claimsPdfA, scanForPdfA } from './archivalClaim';

const XMP = (pdfa: string) =>
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Ledger</rdf:li></rdf:Alt></dc:title></rdf:Description>${pdfa}` +
  '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
const ELEMENT = (part: number) => `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>`;
const ATTRIBUTE = '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="U"/>';

async function pdfWithXmp(xmp: string | null, compressed = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText('Archive p1', { x: 20, y: 200, size: 14, font });
  if (xmp !== null) {
    const bytes = new TextEncoder().encode(xmp);
    const dict = { Type: 'Metadata', Subtype: 'XML' };
    const stream = compressed ? doc.context.flateStream(bytes, dict) : doc.context.stream(bytes, dict);
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  }
  return doc.save();
}

describe('claimsPdfA', () => {
  it('finds a PDF/A claim in the XMP, written as an element or as an attribute, of any part', async () => {
    expect(claimsPdfA(await pdfWithXmp(XMP(ELEMENT(1))))).toBe(true);
    expect(claimsPdfA(await pdfWithXmp(XMP(ELEMENT(3))))).toBe(true);
    expect(claimsPdfA(await pdfWithXmp(XMP(ATTRIBUTE)))).toBe(true);
  });

  it('finds nothing in a file without XMP or with XMP that claims nothing', async () => {
    expect(claimsPdfA(await pdfWithXmp(null))).toBe(false);
    expect(claimsPdfA(await pdfWithXmp(XMP('')))).toBe(false);
  });

  it('cannot see a claim inside a compressed stream (PDF/A forbids that; the run reports it after)', async () => {
    expect(claimsPdfA(await pdfWithXmp(XMP(ELEMENT(1)), true))).toBe(false);
  });

  it('finds the claim at the very end of the bytes, and not a partial one', () => {
    const tail = new TextEncoder().encode('pdfaid:part');
    const bytes = new Uint8Array(1000 + tail.length);
    bytes.set(tail, 1000);
    expect(claimsPdfA(bytes)).toBe(true);
    expect(claimsPdfA(bytes.subarray(0, bytes.length - 1))).toBe(false);
    expect(claimsPdfA(new Uint8Array(0))).toBe(false);
  });

  it('scans a large file quickly enough to run when the dialog opens', () => {
    // 150 MB (the Protect cap) of bytes spread like compressed data, with "pdfaid" and "part" fragments
    // that never meet, and the claim planted at the very end.
    const size = 150 * 1024 * 1024;
    const big = new Uint8Array(size);
    for (let at = 0; at < size; at += 65536) globalThis.crypto.getRandomValues(big.subarray(at, at + 65536));
    big.fill(0x20, 0, 4096); // no claim by chance in the random bytes is possible to rule out, but 11 exact bytes are 1 in 2^88
    big.set(new TextEncoder().encode('pdfaid:pa'), 1000);
    big.set(new TextEncoder().encode('x:part'), 2000);
    // This thread's processor time, not the clock (which on a busy machine also counts other work).
    const cpuMs = (since: NodeJS.CpuUsage) => {
      const used = process.threadCpuUsage(since);
      return (used.user + used.system) / 1000;
    };
    let started = process.threadCpuUsage();
    expect(claimsPdfA(big)).toBe(false);
    const spread = cpuMs(started);
    big.set(new TextEncoder().encode('pdfaid:part'), size - 11);
    expect(claimsPdfA(big)).toBe(true);
    const flat = new Uint8Array(size).fill(0x70); // a file of one repeated byte
    started = process.threadCpuUsage();
    expect(claimsPdfA(flat)).toBe(false);
    const repeated = cpuMs(started);
    console.info(`claimsPdfA on 150 MB: ${Math.round(spread)} ms spread like compressed data, ${Math.round(repeated)} ms one repeated byte (processor time)`);
    expect(spread).toBeLessThan(10_000); // loose; the dialog scans in slices (scanForPdfA)
  }, 120_000);
});

describe('scanForPdfA (the dialog scans in slices, giving the window a turn between them)', () => {
  const at = (text: string, offset: number, size: number) => {
    const bytes = new Uint8Array(size).fill(0x20);
    bytes.set(new TextEncoder().encode(text), offset);
    return bytes;
  };

  it('finds a claim that straddles any slice boundary', async () => {
    for (let offset = 0; offset < 40; offset++) expect(await scanForPdfA(at('pdfaid:part', offset, 64), undefined, 16)).toBe(true);
    expect(await scanForPdfA(at('pdfaid:par', 20, 64), undefined, 16)).toBe(false);
    expect(await scanForPdfA(new Uint8Array(0))).toBe(false);
  });

  it('yields between slices and stops with null once the dialog has closed', async () => {
    const controller = new AbortController();
    let turns = 0;
    const timer = setInterval(() => {
      turns++;
      controller.abort();
    }, 0);
    const result = await scanForPdfA(new Uint8Array(64 * 1024).fill(0x20), controller.signal, 1024);
    clearInterval(timer);
    expect(turns).toBeGreaterThan(0);
    expect(result).toBeNull();
  });
});
