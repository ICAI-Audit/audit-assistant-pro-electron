// Writes PDF to Excel's workbook off the window's thread (excelRun.ts starts it, gives it the packed
// sheets, takes the one reply and ends it): exceljs renders and zips a large workbook in one stretch of
// seconds (excelBuild.ts). It keeps nothing, logs nothing and says nothing but the reply: the file's
// bytes, or that the write failed (never a cell's text).
//
// exceljs is imported here by name, although only excelBuild.ts uses it (through `await import('exceljs')`,
// so that the window's own code loads it only if it ever has to write without a worker). The application's
// build makes a worker one file and cannot split it: without this import the worker would need a second
// chunk for exceljs and the whole build stops ("IIFE output formats are not supported for code-splitting
// builds"). With it, exceljs sits in the worker's own file and the import in excelBuild.ts resolves there.
import ExcelJS from 'exceljs';
import { writePacked, type PackedWorkbook } from '@/lib/pdf-tools/excelBuild';

void ExcelJS;

export type WriterReply = { ok: true; bytes: Uint8Array } | { ok: false } | { alive: true };

/** How often the worker says it is still writing (between the slices it can be heard in). */
export const ALIVE_EVERY_MS = 1000;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PackedWorkbook>) => void) | null;
  postMessage: (reply: WriterReply, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const alive = setInterval(() => scope.postMessage({ alive: true }), ALIVE_EVERY_MS);
  writePacked(event.data)
    .finally(() => clearInterval(alive))
    .then(
      (bytes) => scope.postMessage({ ok: true, bytes }, [bytes.buffer]),
      () => scope.postMessage({ ok: false }),
    );
};
