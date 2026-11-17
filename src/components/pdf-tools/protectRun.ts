// The Protect with password run step (design 5.18; plan Task B5), on the step contract of toolStep.ts:
// one PDF in, one AES-256 copy out, `<name>_protected.pdf`.
//
// - The library (protect.ts) checks the password, encrypts, and opens the result again with the password
//   through the app's own unlock code, comparing it with the source object by object; nothing it has not
//   checked comes back. So the row is built with run.result, never run.pdfResult: the encrypted file
//   must not be opened again here, which would need the password a second time.
// - Its three phases are shown as steps with a moving bar; the library gives the window a turn about
//   every megabyte and takes Stop there; a Stop or a change of engagement at a phase boundary ends the
//   run at once (run.check()).
// - The row keeps the checked unprotected copy as `previewBytes` (thumbnails and the viewer, design 5.18)
//   and `protectedOutput: true` (no tool takes it as input). It is not "a copy without its password":
//   `wasProtected` is false whatever the source was.
// - The record is "Protected with a password (AES-256)" with `{ protection: 'AES-256' }` (and
//   `noLongerArchival` for a PDF/A source): never the password, a hint or its length.
// - The password is read once from the options into this call and handed to the library; it is not
//   stored, logged, put into a label, message or error, and goes when this call ends.
import { carriesAnything } from '@/lib/pdf-tools/inspect';
import { PROTECT_MAX_BYTES, protectPdf, type ProtectPhase, type ProtectReport } from '@/lib/pdf-tools/protect';
import { defaultResultName, summaryWithNotes } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError, PROTECTED_OUTPUT_REASON, type OperationFlags, type WorkingFile } from '@/lib/pdf-tools/types';
import { PHASE_LABELS, PROTECT_SUMMARY, protectRecordOptions, resultDescription, tooLargeError, withNextStep } from './protect/protectForm';
import { resolveResultName } from './toolOptions';
import { onePdf, wrongInput, type ToolStep } from './toolStep';

export const BUILT = true;

/** Plan B5: the password (held only while the run lasts, never recorded) and the result name. */
export interface ProtectRunOptions {
  password: string;
  name?: string;
}

const unverified = () => new PdfToolsError('protect-unverified', 'The protected file could not be verified. Nothing was added. Try again; if it fails again, restart the application.');

export const step: ToolStep<ProtectRunOptions> = async (run, inputs, options) => {
  const source = onePdf(inputs);
  if (source.protectedOutput) throw wrongInput(PROTECTED_OUTPUT_REASON);
  if (Math.max(source.size, source.bytes.byteLength) > PROTECT_MAX_BYTES) throw tooLargeError();
  const password = typeof options?.password === 'string' ? options.password : '';
  const name = resolveResultName(options?.name ?? '', defaultResultName('protect', source.name), 'pdf');
  // The protected copy and its unprotected preview are each about the size of the source.
  run.ensureRoom(source.size * 2, 'The protected copy');

  const report: ProtectReport = {};
  const onPhase = async (phase: ProtectPhase) => {
    run.progress(0, 0, PHASE_LABELS[phase]);
    await run.deps.paint();
    run.check(); // a Stop or a change of engagement ends the run here, as it is
  };
  // How far the two slow phases have got, as a moving bar under the same step label (QA-FIX I: a 320-page
  // ledger showed a step for a minute or more with nothing moving). Called inside the library's work, so a
  // Stop or a change of engagement is left to the library's signal and the next phase boundary.
  const onProgress = (phase: ProtectPhase, done: number, total: number) => {
    if (!run.live() || run.ctx.signal.aborted) return;
    run.ctx.onProgress(done, total, PHASE_LABELS[phase]);
  };
  let bytes: Uint8Array;
  try {
    // Refuses an unusable password before the file is read, and a protected source.
    bytes = await protectPdf(source.bytes, password, { report, onPhase, onProgress, signal: run.ctx.signal });
  } catch (error) {
    if (!run.live() || run.ctx.signal.aborted) throw error;
    throw withNextStep(error);
  }
  run.check();
  const preview = report.unlocked;
  if (!preview || report.pageCount !== source.pageCount) throw unverified();

  // What the copy still carries (comments, attachments, properties), counted from the checked unprotected
  // copy, which holds the same document (QA-FIX A). A count that cannot be made leaves it unsaid.
  let carried: WorkingFile['carried'];
  try {
    const info = await run.deps.inspectPdf(preview);
    if (carriesAnything(info.carried)) carried = info.carried;
  } catch {
    carried = undefined;
  }
  run.check();

  const signatureInvalid = run.madeFromSigned([source]) || report.signatureInvalid === true;
  const noLongerArchival = report.noLongerArchival === true;
  const flags: OperationFlags = signatureInvalid ? { signatureInvalid: true } : {};
  const row = run.result(
    {
      name,
      bytes,
      kind: 'pdf',
      mimeType: 'application/pdf',
      pageCount: report.pageCount,
      protectedOutput: true,
      previewBytes: preview,
      // The same document inside: what the source has, the copy has.
      ...(source.hasFormFields !== undefined ? { hasFormFields: source.hasFormFields } : {}),
      ...(source.hasBookmarks !== undefined ? { hasBookmarks: source.hasBookmarks } : {}),
      ...(source.hasPageLinks !== undefined ? { hasPageLinks: source.hasPageLinks } : {}),
      ...(carried ? { carried } : {}),
      ...(signatureInvalid ? { signatureInvalid: true } : {}),
    },
    [source],
    { summary: summaryWithNotes(PROTECT_SUMMARY, flags), options: protectRecordOptions(noLongerArchival), flags },
  );
  const file = { ...row, wasProtected: false };
  return { files: [file], describe: ([made]) => resultDescription(made.name, { signatureInvalid, noLongerArchival }) };
};
