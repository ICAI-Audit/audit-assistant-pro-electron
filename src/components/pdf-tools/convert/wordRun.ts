// The PDF to Word run step (design 5.11; contract decisions 13–17), on the step contract of toolStep.ts:
// one PDF in, one Word document out, `<name>.docx`, as an office row (no viewer, never a tool input).
//
// - Pages are read one at a time through the words reader (pageWordsReader.ts) and laid out (layout.ts);
//   the plan (paragraphs, headings, tables, page breaks) and the .docx are made by wordBuild.ts. Every loop
//   gives the window a turn when one is due (pace.ts) and runs the Stop check there, so a Stop lands within a
//   page and adds nothing; the reader is let go however the run ends.
// - No word is dropped. A file in which every page has fewer than 20 characters (layout.ts countsAsScanned)
//   is refused ("it looks scanned"); the dialog says so before the run too. A mixed file runs: its pages with
//   little or no text keep what words they hold, and the message says how many there are.
// - The row is built with run.result (a Word file is not opened again as a PDF). It carries no signature
//   flag: a Word document holds no signature, and the dialog says the signed original is unchanged. A source
//   opened with its password gets "protection removed" in the record, from run.result.
// - The record is "Converted to Word: 12 pages" with the counts of RECORD_KEYS: never a word of the document.
import { countsAsScanned, pageLayout, type PageLayout } from '@/lib/pdf-tools/layout';
import { pacer } from '@/lib/pdf-tools/pace';
import type { PictureFile } from '@/lib/pdf-tools/pdfPictures';
import type { TextMeasure } from '@/lib/pdf-tools/wordLook';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { buildDocx, DOCX_MIME, planDocumentPaced } from '@/lib/pdf-tools/wordBuild';
import { PdfToolsError, PROTECTED_OUTPUT_REASON } from '@/lib/pdf-tools/types';
import { onePdf, wrongInput, type ToolStep } from '../toolStep';
import { openWordsReader, type WordsReader } from './pageWordsReader';
import { createTextMeasure } from './textMeasure';
import {
  ARRANGING_LABEL,
  NO_TEXT_MESSAGE,
  READING_LABEL,
  recordOptions,
  resultDescription,
  summary,
  TOO_MANY_PAGES_MESSAGE,
  WORD_MAX_PAGES,
  wordFileName,
  WRITING_LABEL,
} from './wordForm';

export const BUILT = true;

/** The result name's stem, as the dialog's name field gives it; the step adds `.docx`. */
export interface WordRunOptions {
  name?: string;
}

/** Opens a file for reading its words and ruling lines, page by page (pageWordsReader.ts openWordsReader). */
export type OpenWords = (file: Uint8Array, opts?: { signal?: AbortSignal }) => Promise<WordsReader>;

const NOTHING_ADDED = 'Nothing was added.';
/** Past this much picture data, further pictures are left out of the document. */
const MAX_PICTURE_BYTES = 60_000_000;

/** The step, reading with `open` (the test seam: the tests read invented pages without a PDF reader). */
export function createStep(open: OpenWords, measure: () => TextMeasure | undefined = createTextMeasure): ToolStep<WordRunOptions> {
  return async (run, inputs, options) => {
    const source = onePdf(inputs);
    if (source.protectedOutput) throw wrongInput(PROTECTED_OUTPUT_REASON);
    if (source.pageCount > WORD_MAX_PAGES) throw new PdfToolsError('word-too-many-pages', `${TOO_MANY_PAGES_MESSAGE} ${NOTHING_ADDED}`);
    const typed = typeof options?.name === 'string' ? options.name.trim() : '';
    const name = typed !== '' ? wordFileName(typed) : defaultResultName('pdf-to-word', source.name);
    run.ensureRoom(0, 'The Word document');

    const pace = pacer(() => run.check());
    const layouts: PageLayout[] = [];
    // Each page's pictures as files (null: a kind that is not carried over, or past the room given to pictures).
    const pictures: (PictureFile | null)[][] = [];
    const counted = new Set<PictureFile>();
    let pictureBytes = 0;
    let reader: WordsReader | undefined;
    // Some page has 20 characters or more (the dialog's rule): otherwise the file is refused as scanned.
    let anyText = false;
    try {
      run.progress(0, source.pageCount, READING_LABEL(1, source.pageCount));
      reader = await open(source.bytes, { signal: run.ctx.signal });
      run.check();
      const total = reader.pageCount;
      for (let i = 0; i < total; i++) {
        run.progress(i, total, READING_LABEL(i + 1, total));
        const { words, segments, extras, picture } = await reader.page(i);
        run.check();
        // Every word is kept; a page under 20 characters is counted by the plan (it may be scanned).
        if (!countsAsScanned(words)) anyText = true;
        const layout = pageLayout(words, segments, extras);
        layouts.push(layout);
        pictures.push(
          (layout.pictures ?? []).map((p) => {
            if (pictureBytes > MAX_PICTURE_BYTES) return null;
            const file = picture?.(p.index) ?? null;
            if (file && !counted.has(file)) {
              counted.add(file);
              pictureBytes += file.bytes.byteLength;
            }
            return file;
          }),
        );
        const turn = pace();
        if (turn) await turn;
      }
    } catch (error) {
      // A Stop or a change of engagement while a page was read ends the run as such, never as a failure.
      if (!run.live() || run.ctx.signal.aborted) run.check();
      throw error;
    } finally {
      reader?.close();
    }
    if (!anyText) throw new PdfToolsError('word-no-text', `${NO_TEXT_MESSAGE} ${NOTHING_ADDED}`);

    run.progress(0, 0, ARRANGING_LABEL);
    // The lines of the page are kept, each run fitted to its width on the page in the font Word will use.
    // (Where no canvas can be had the measure gives 0: the paragraphs then flow as Word breaks them.)
    const widths = measure();
    const { parts, report, looks } = await planDocumentPaced(layouts, pace, widths && widths('a', {}) > 0 ? widths : undefined);
    layouts.length = 0;
    run.check();
    await run.slowStep(WRITING_LABEL);
    const bytes = await buildDocx(parts, pace, looks, pictures);
    run.check();
    run.ensureRoom(bytes.byteLength, 'The Word document');

    const file = run.result({ name, bytes, kind: 'office', mimeType: DOCX_MIME, pageCount: null }, [source], { summary: summary(report), options: recordOptions(report) });
    return { files: [file], describe: ([made]) => resultDescription(made.name, report) };
  };
}

export const step: ToolStep<WordRunOptions> = createStep(openWordsReader);
