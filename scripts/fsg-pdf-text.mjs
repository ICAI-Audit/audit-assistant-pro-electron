// T-034: shared PDF text extraction for the FSG integration checks.
//
// pdfjs-dist needs @napi-rs/canvas in the Electron main process. The locked
// 0.1.80 build has no win32-arm64 binary, so on Windows-on-ARM importing pdfjs
// throws "DOMMatrix is not defined". Only that specific condition is reported
// as a skipped check; any other failure still fails the run. Set
// FSG_REQUIRE_PDF_TEXT=1 to turn the skip into a failure (for example in CI).

const skipped = []
let loaded

function unavailableReason(err) {
  const message = String(err?.message || err)
  if (/DOMMatrix is not defined|@napi-rs\/canvas|Failed to load native binding/i.test(message)) {
    return `PDF text reader unavailable on ${process.platform}-${process.arch}: ${message}`
  }
  return null
}

async function loadPdfjs() {
  if (loaded === undefined) {
    try {
      loaded = { pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }
    } catch (err) {
      const reason = unavailableReason(err)
      if (!reason || process.env.FSG_REQUIRE_PDF_TEXT === '1') throw err
      loaded = { reason }
    }
  }
  return loaded
}

// Returns an array with the text of each page, or null when the reader is
// unavailable on this machine (the named check is then recorded as skipped).
export async function pdfPageTexts(bytes, checkName) {
  const { pdfjs, reason } = await loadPdfjs()
  if (!pdfjs) {
    skipped.push({ name: checkName, reason })
    console.log(`SKIP ${checkName} -- ${reason}`)
    return null
  }
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  try {
    const pages = []
    for (let p = 1; p <= document.numPages; p++) {
      pages.push((await (await document.getPage(p)).getTextContent()).items.map(x => x.str).join(' '))
    }
    return pages
  } finally {
    await document.destroy()
  }
}

export function skippedPdfChecks() {
  return skipped.slice()
}
