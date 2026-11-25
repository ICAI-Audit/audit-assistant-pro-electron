import { FLAG_NOTES } from './resultNames';
import { PdfToolsError, type CarriedContent, type Destination, type OperationFlags, type OperationStep, type SourceRef, type ToolId, type WorkingFile } from './types';

export interface ActivityEntry {
  action: string;
  entity: 'PDF Tools';
  entityId?: string;
  details: string;
  metadata: Record<string, unknown>;
}

interface WorkingPaperRef {
  programName: string;
  sectionName?: string;
  boxHeader?: string;
}

const ACTIONS: Record<Destination, string> = {
  computer: 'Saved to computer',
  download: 'Sent to download',
  vault: 'Added to Evidence Vault',
  'working-paper': 'Attached to working paper',
};

const MAX_SOURCES_IN_DETAILS = 10;
/** Earlier steps of a result made from results that an entry lists; older ones are counted. */
const MAX_EARLIER_STEPS = 10;

const PROPERTY_ORDER = ['title', 'author', 'subject', 'keywords'] as const;

/**
 * What the saved file still carries, for the record (QA-FIX A): counts and property names only, never a
 * comment, a file name or a property's value. Null when it carries nothing.
 */
export function carriedRecord(carried: CarriedContent | undefined): CarriedContent | null {
  if (!carried) return null;
  const comments = Number.isInteger(carried.comments) && carried.comments > 0 ? carried.comments : 0;
  const attachments = Number.isInteger(carried.attachments) && carried.attachments > 0 ? carried.attachments : 0;
  const properties = PROPERTY_ORDER.filter((p) => Array.isArray(carried.properties) && carried.properties.includes(p));
  return comments > 0 || attachments > 0 || properties.length > 0 ? { comments, attachments, properties: [...properties] } : null;
}

/** "2 comments, 1 attachment, title and author" for the record's text. */
export function carriedRecordText(carried: CarriedContent | undefined): string | null {
  const kept = carriedRecord(carried);
  if (!kept) return null;
  const parts: string[] = [];
  if (kept.comments > 0) parts.push(`${kept.comments} ${kept.comments === 1 ? 'comment' : 'comments'}`);
  if (kept.attachments > 0) parts.push(`${kept.attachments} ${kept.attachments === 1 ? 'attachment' : 'attachments'}`);
  const named = kept.properties;
  if (named.length > 0) parts.push(named.length < 2 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`);
  return parts.join(', ');
}
// Every flag with a note in its summary is also a metadata key (phase 2 adds redactedValuesLeftVisible,
// textLayerIncomplete and markMayBeMisplaced): a flag is only ever `true`, never a value.
const FLAG_KEYS: readonly (keyof OperationFlags)[] = FLAG_NOTES.map(([flag]) => flag);
const MAX_NAME_IN_DETAILS = 80;
const MAX_NAME_IN_METADATA = 255;
const MAX_SUMMARY = 120;
const MAX_OPTION_TEXT = 200;
// An option key means a secret when one of its word parts (split at case changes, digits and
// punctuation) is a secret word, or ends in password/passphrase/secret/token (`ownerpassword`).
// `key` counts only as a whole part (`apiKey`), so `monkey`, `keywords` and `keepBookmarks` pass.
const SECRET_WORD = /^(pass|passcode|passwd|pwd|keys?)$|(password|passphrase|secret|token)s?$/;
function isSecretOption(key: string): boolean {
  return key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .some((part) => SECRET_WORD.test(part.toLowerCase()));
}
// control characters, line/paragraph separators and bidi controls
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B\\u2028\\u2029\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', 'g');

/** Replace unsafe characters with a space, collapse whitespace, trim. */
function clean(text: string): string {
  return text.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Cut by code point (never splits a surrogate pair); an ellipsis marks the cut. */
function cut(text: string, max: number, ellipsis: boolean): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return ellipsis ? `${chars.slice(0, max - 1).join('')}…` : chars.slice(0, max).join('');
}

/** Last path segment only (trailing separators ignored); an absolute local path must never reach the log. */
function baseName(name: string): string {
  const parts = name.replace(/[\\/]+$/, '').split(/[\\/]/);
  return clean(parts[parts.length - 1] ?? '') || 'file';
}

const metaName = (name: string): string => cut(baseName(name), MAX_NAME_IN_METADATA, false);
const detailName = (name: string): string => cut(baseName(name), MAX_NAME_IN_DETAILS, true);
const detailText = (text: string): string => cut(clean(text), MAX_NAME_IN_DETAILS, true);

function destinationText(destination: Destination, wp?: WorkingPaperRef, zip = false): string {
  const inZip = zip ? ', in one zip file' : '';
  if (destination === 'computer') return `Computer${inZip}`;
  // Electron may show its own Save As for a download, which the user can cancel or point elsewhere.
  if (destination === 'download') return `Computer${inZip}, by download (completion not confirmed)`;
  if (destination === 'vault') return 'Evidence Vault';
  if (!wp) return 'Working paper';
  let text = `Working paper ${detailText(wp.programName)}`;
  if (wp.sectionName) text += `, section ${detailText(wp.sectionName)}`;
  if (wp.boxHeader) text += `, box ${detailText(wp.boxHeader)}`;
  return text;
}

function sourcesText(sources: SourceRef[]): string {
  if (sources.length === 0) return 'none';
  const shown = sources.slice(0, MAX_SOURCES_IN_DETAILS).map((s) => `${detailName(s.name)} [${s.origin}]`);
  const rest = sources.length - shown.length;
  return rest > 0 ? `${shown.join('; ')}; and ${rest} more` : shown.join('; ');
}

const metaSource = (s: SourceRef): SourceRef => {
  const ref: SourceRef = { name: metaName(s.name), origin: s.origin };
  if (s.evidenceId) ref.evidenceId = s.evidenceId;
  return ref;
};

// "; some bookmarks not carried; …" at the end of a summary (resultNames' FLAG_NOTES).
const NOTES_AT_END = new RegExp(`(?:; (?:${FLAG_NOTES.map(([, words]) => words).join('|')}))+$`);

/** A summary cleaned and cut to MAX_SUMMARY; what was not carried over is kept when the rest is cut. */
function summaryText(raw: string, fallback: string): string {
  const text = clean(raw) || fallback;
  const notes = NOTES_AT_END.exec(text)?.[0] ?? '';
  if (notes === '' || Array.from(text).length <= MAX_SUMMARY) return cut(text, MAX_SUMMARY, false);
  return `${cut(text.slice(0, text.length - notes.length), MAX_SUMMARY - Array.from(notes).length, true)}${notes}`;
}

const stepSummary = (summary: string) => summaryText(summary, 'PDF Tools step');

/** "Compressed, … → a.pdf; Added page numbers → b.pdf (and 3 earlier steps)": the last steps, oldest first. */
function stepsText(steps: OperationStep[], notListed: number): string {
  const text = steps.map((step) => `${stepSummary(step.summary)} → ${detailName(step.resultName)}`).join('; ');
  return notListed > 0 ? `${text} (and ${notListed} earlier ${notListed === 1 ? 'step' : 'steps'})` : text;
}

// ---- text the user typed (Watermark 5.16, Page numbers 5.17): the record holds counts and choices only ----

/** The tokens a watermark or stamp text may use, and those of a header, a footer or the page number text. */
export const MARK_TEXT_TOKENS = ['date', 'client'] as const;
export const HEADER_TEXT_TOKENS = ['page', 'pages', 'file', 'name', 'date', 'client', 'fy'] as const;
/** The ready-made texts of the Watermark dialog (marks/watermarkForm.ts): a choice, so a record may name one. */
export const WATERMARK_CHOICES = ['DRAFT', 'CONFIDENTIAL', 'COPY', 'FOR AUDIT USE ONLY', 'NOT FOR CIRCULATION'] as const;
export const STAMP_CHOICES = ['VERIFIED', 'RECEIVED', 'CHECKED', 'PAID', 'ORIGINAL SEEN'] as const;
/** What a record says of a text that is neither a ready-made text nor a template of tokens. */
export const CUSTOM_TEXT = 'custom';

// Spaces and punctuation only: nothing that can spell a name, a reference or an amount. Written as escapes
// (en and em dash, middle dot, bullet).
const TEMPLATE_GLUE = new RegExp('^[\\s\\-\\u2013\\u2014/\\\\|,.:;()\\[\\]#_\\u00B7\\u2022]*$');
// With no tokens, a pattern that never matches: a brace is then plain text.
const tokenPattern = (tokens: readonly string[]) => new RegExp(tokens.length > 0 ? `\\{(${tokens.join('|')})\\}` : '(?!)', 'gi');

/**
 * A text made only of the tool's own tokens (any letter case), spaces and punctuation: "{client}",
 * "{date} - {client}", "- " around a page number. Such a template is a choice, and a record may hold it
 * as it is. A text of spaces only is not one.
 */
export function isTokenTemplate(text: string, tokens: readonly string[]): boolean {
  if (text.trim() === '') return false;
  return TEMPLATE_GLUE.test(text.replace(tokenPattern(tokens), ''));
}

/** The tokens a text uses, each once, in order and in lower case: "{client} {fy}". Empty when none. */
export function tokensUsed(text: string, tokens: readonly string[]): string {
  const seen: string[] = [];
  for (const m of text.matchAll(tokenPattern(tokens))) {
    const token = `{${m[1].toLowerCase()}}`;
    if (!seen.includes(token)) seen.push(token);
  }
  return seen.join(' ');
}

export interface TypedTextRecord {
  /** The ready-made text or the token template as it is, else CUSTOM_TEXT. */
  value: string;
  /** For custom text: its length in characters, and the tokens it uses ('' when none). */
  length?: number;
  uses?: string;
}

/**
 * What a record may say about a text the user typed (lead's ruling on REV-B B1): the text itself only when
 * it is one of `choices` (a ready-made text) or a template of the tool's tokens and punctuation; otherwise
 * that custom text was used, its length and the tokens it uses, never the text. A token stays a token, so
 * what it is filled with (the client's name, the file name, the date) is never recorded either. (A record
 * key never says "token": activity entries drop such keys as secrets, so the tokens go under "uses".)
 */
export function typedTextRecord(text: string, choices: readonly string[], tokens: readonly string[]): TypedTextRecord {
  if (choices.includes(text) || isTokenTemplate(text, tokens)) return { value: text };
  return { value: CUSTOM_TEXT, length: Array.from(text).length, uses: tokensUsed(text, tokens) };
}

const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const oneOf = (...allowed: string[]) => (value: unknown) => typeof value === 'string' && allowed.includes(value);
const isMillimetres = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isFiniteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown) => typeof value === 'boolean';
const isHexColour = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const isPercent = (value: unknown) => isCount(value) && (value as number) <= 100;
/** A typed text's record value: a ready-made text, a template of tokens, or CUSTOM_TEXT. */
const typedText = (choices: readonly string[], tokens: readonly string[]) => (value: unknown) =>
  typeof value === 'string' && (value === CUSTOM_TEXT || choices.includes(value) || isTokenTemplate(value, tokens));
/** The tokens a custom text used: "{client} {date}", or '' for none. */
const tokenList = (tokens: readonly string[]) => (value: unknown) =>
  typeof value === 'string' && (value === '' || value.split(' ').every((part) => tokens.some((t) => part === `{${t}}`)));
const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const isMarkPosition = (value: unknown) =>
  typeof value === 'string' && (ANCHORS.includes(value) || /^point -?\d+(\.\d+)? ?% across, -?\d+(\.\d+)? ?% down$/.test(value));
const isPageChoice = (value: unknown) => typeof value === 'string' && /^(all|first|\d+(-\d+)?)$/.test(value);

/** A header or footer place's three keys: the text's record value, and for custom text its length and the tokens it uses. */
const SLOT_KEYS = ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'].flatMap((slot) => [
  [`text_${slot}`, typedText([], HEADER_TEXT_TOKENS)],
  [`text_${slot}_length`, isCount],
  [`text_${slot}_uses`, tokenList(HEADER_TEXT_TOKENS)],
] as const);

/**
 * The only options a Redact, Protect, Resize or crop pages, Watermark, Page numbers, PDF to Excel, PDF to Word,
 * Document check or Compare record may hold (design 5.9, 5.18, 5.19, 5.16, 5.17, 5.11, 5.13): counts and choices, never a redacted value, typed term, custom token, masked
 * text, anything about a password, or a text the user typed (a watermark, stamp, header, footer or the text
 * around a page number: only which ready-made text or token template was chosen, or that it was custom text
 * and how long), nor the logo's file name. Anything else, or a value of another shape, is left out of the
 * entry. Redact's `counts` is the summary's list by kind, as "PAN 6, Aadhaar 2, typed 3, drawn 3" (kind
 * names and numbers only).
 */
const RESTRICTED_OPTIONS: Partial<Record<ToolId, Record<string, (value: unknown) => boolean>>> = {
  redact: {
    areas: isCount,
    pagesRebuilt: isCount,
    pagesRebuiltHidden: isCount,
    counts: (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z ()-]{0,40} \d+(, [A-Za-z][A-Za-z ()-]{0,40} \d+)*$/.test(value),
    mode: oneOf('remove', 'replace'),
    replacement: oneOf('token-default', 'token-custom', 'label', 'masked'),
    output: oneOf('searchable', 'picture'),
    dpi: (value) => value === 150 || value === 200 || value === 300,
    valuesLeftVisible: isCount,
    textLayerCharsOmitted: isCount,
    autoBoxesDropped: isCount,
    bookmarksRemoved: isCount,
  },
  // noLongerArchival: the source claimed PDF/A, which a protected copy cannot be (P-report fix round 1).
  protect: { protection: oneOf('AES-256'), noLongerArchival: (value) => value === true },
  // Resize or crop pages: counts and choices only (pagebox/pageBoxForm.ts pageBoxRecord).
  'resize-crop': {
    mode: oneOf('resize', 'trim', 'margin'),
    size: (value) => typeof value === 'string' && /^(A4|A3|A5|Letter|Legal|\d+(\.\d)? × \d+(\.\d)? mm)$/.test(value),
    direction: oneOf('keep', 'portrait', 'landscape'),
    enlarge: (value) => typeof value === 'boolean',
    mirror: (value) => typeof value === 'boolean',
    marginMm: isMillimetres,
    leftMm: isMillimetres,
    topMm: isMillimetres,
    rightMm: isMillimetres,
    bottomMm: isMillimetres,
    pages: (value) => typeof value === 'string' && /^(all|\d+(-\d+)?)$/.test(value),
    changed: isCount,
    unchanged: isCount,
    pagesToCheck: isCount,
  },
  // Watermark (marks/watermarkForm.ts watermarkRecord): a ready-made text, a token template or "custom";
  // for the logo that one was used and its size in pixels, never its file name.
  watermark: {
    pages: isPageChoice,
    watermark: typedText(WATERMARK_CHOICES, MARK_TEXT_TOKENS),
    watermarkLength: isCount,
    watermarkUses: tokenList(MARK_TEXT_TOKENS),
    watermarkFont: (value) => typeof value === 'string' && /^(helvetica|times|courier)( bold)?( italic)?$/.test(value),
    watermarkSize: (value) => value === 'auto' || isFiniteNumber(value),
    watermarkAngle: (value) => value === 'diagonal' || isFiniteNumber(value),
    watermarkColour: isHexColour,
    watermarkOpacity: isPercent,
    watermarkLayer: oneOf('front', 'behind'),
    watermarkPosition: isMarkPosition,
    stamp: typedText(STAMP_CHOICES, MARK_TEXT_TOKENS),
    stampLength: isCount,
    stampUses: tokenList(MARK_TEXT_TOKENS),
    stampSize: isFiniteNumber,
    stampAngle: isFiniteNumber,
    stampColour: isHexColour,
    stampOpacity: isPercent,
    stampPosition: isMarkPosition,
    logo: (value) => value === true,
    logoPixelWidth: isCount,
    logoPixelHeight: isCount,
    logoWidth: isPercent,
    logoOpacity: isPercent,
    logoPosition: isMarkPosition,
  },
  // Page numbers (runTool.ts pageNumberRecord): the choices, and the typed texts as their record value only.
  'page-numbers': {
    position: oneOf('bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'),
    format: oneOf('n', 'n-dot', 'pg-n', 'page-n', 'n-of-total', 'page-n-of-total', 'custom'),
    // The text around a custom number fills no tokens: a brace there is plain text.
    prefix: typedText([], []),
    prefixLength: isCount,
    suffix: typedText([], []),
    suffixLength: isCount,
    startNumber: isFiniteNumber,
    fromPage: isCount,
    toPage: isCount,
    fontSize: isFiniteNumber,
    marginPt: isFiniteNumber,
    color: isHexColour,
    style: oneOf('arabic', 'roman-lower', 'roman-upper', 'alpha', 'circled'),
    font: oneOf('helvetica', 'times', 'courier'),
    bold: isBoolean,
    italic: isBoolean,
    dateFormat: oneOf('dd-mm-yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd', 'long'),
    numbersOn: isBoolean,
    ...Object.fromEntries(SLOT_KEYS),
  },
  // Phase 3 (T-064): counts and one choice each, the same keys as each tool's RECORD_KEYS. Never a cell, a
  // heading, a signer's name, a document property or a word that differs.
  // PDF to Excel (convert/excelForm.ts).
  'pdf-to-excel': {
    sheetMode: oneOf('one-sheet', 'per-page'),
    pages: isCount,
    sheets: isCount,
    rows: isCount,
    numberCells: isCount,
    tablesRuled: isCount,
    tablesAligned: isCount,
    pagesAsText: isCount,
    pagesNoText: isCount,
    pagesFromScan: isCount,
  },
  // PDF to Word (convert/wordForm.ts).
  'pdf-to-word': { pages: isCount, paragraphs: isCount, headings: isCount, tables: isCount, pagesNoText: isCount, pagesFromScan: isCount },
  // Document check (review/documentCheckForm.ts).
  'document-check': { pages: isCount, signatures: isCount, pagesWithText: isCount, pagesScanned: isCount, protection: oneOf('none', 'password', 'restrictions') },
  // Make searchable: counts only (ocr/ocrForm.ts RECORD_KEYS); never a recognised word.
  ocr: {
    pages: isCount, pagesRecognised: isCount, pagesSkipped: isCount, pagesTimedOut: isCount, words: isCount, lowConfidenceWords: isCount,
    numbersToCheck: isCount, pagesFaint: isCount, charactersDropped: isCount, wordsLeftOut: isCount, pagesPartlyRead: isCount,
  },
  // Compare (review/compareForm.ts).
  compare: {
    pagesEarlier: isCount,
    pagesLater: isCount,
    pagesDiffer: isCount,
    pagesOnlyEarlier: isCount,
    pagesOnlyLater: isCount,
    wordsAdded: isCount,
    wordsRemoved: isCount,
    wordsChanged: isCount,
    pagesWithoutText: isCount,
    pagesComparedCoarsely: isCount,
  },
};

function safeOptions(raw: Record<string, unknown> | undefined, tool?: ToolId | null): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const restricted = tool ? RESTRICTED_OPTIONS[tool] : undefined;
  for (const key of Object.keys(raw ?? {})) {
    if (isSecretOption(key)) continue;
    const value = (raw as Record<string, unknown>)[key];
    if (restricted && !(Object.prototype.hasOwnProperty.call(restricted, key) && restricted[key](value))) continue;
    if (typeof value === 'string') out[key] = cut(clean(value), MAX_OPTION_TEXT, false);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export function buildActivityEntry(args: {
  file: WorkingFile;
  destination: Destination;
  sha256: string;
  vaultRecordId?: string;
  workingPaper?: WorkingPaperRef;
  /** A save to the computer (or a download) of several files as one zip. */
  zip?: boolean;
  /** For a file no tool made (an input saved as it is): what it is, and where it came from. */
  summary?: string;
  sources?: SourceRef[];
}): ActivityEntry {
  const { file, destination, vaultRecordId, workingPaper } = args;
  const sha256 = String(args.sha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new PdfToolsError('bad-hash', 'The file fingerprint (SHA-256) is not valid.');
  }
  const operation = file.operation;
  const zip = args.zip === true && (destination === 'computer' || destination === 'download');
  const summary = summaryText(args.summary ?? operation?.summary ?? '', 'PDF Tools result');
  const sources: SourceRef[] = (args.sources ?? operation?.sources ?? []).map(metaSource);

  // A result made from results: the steps that made its sources, and the files they started from.
  const allSteps = operation?.earlier ?? [];
  const steps = allSteps.slice(-MAX_EARLIER_STEPS);
  const stepsNotListed = (operation?.earlierNotListed ?? 0) + allSteps.length - steps.length;
  const originals = operation?.originalSources?.map(metaSource);
  const history =
    steps.length > 0 || originals
      ? `Earlier steps: ${steps.length > 0 ? stepsText(steps, stepsNotListed) : 'none'}. Original sources: ${sourcesText(originals ?? [])}. `
      : '';

  const hash = `SHA-256 ${sha256.slice(0, 12)}…`;
  const pages =
    file.pageCount === null ? hash : `${file.pageCount} ${file.pageCount === 1 ? 'page' : 'pages'}, ${hash}`;
  const carried = file.origin === 'result' ? carriedRecord(file.carried) : null;
  const details =
    `${summary} → ${detailName(file.name)} (${pages}). ` +
    `Sources: ${sourcesText(sources)}. ` +
    history +
    (carried ? `Still in the file: ${carriedRecordText(carried)}. ` : '') +
    `Destination: ${destinationText(destination, workingPaper, zip)}.`;

  const metadata: Record<string, unknown> = {
    tool: operation?.tool ?? null,
    options: safeOptions(operation?.options, operation?.tool),
    sources,
    resultName: metaName(file.name),
    pageCount: file.pageCount,
    size: file.size,
    sha256,
    destination,
  };
  if (history) {
    metadata.earlierSteps = steps.map((step) => ({ tool: step.tool, summary: stepSummary(step.summary), resultName: metaName(step.resultName), options: safeOptions(step.options, step.tool) }));
    if (stepsNotListed > 0) metadata.earlierStepsNotListed = stepsNotListed;
    metadata.originalSources = originals ?? [];
  }
  for (const flag of FLAG_KEYS) if (operation?.flags?.[flag] === true) metadata[flag] = true;
  if (carried) metadata.carried = carried;
  if (zip) metadata.zip = true;
  if (vaultRecordId) metadata.vaultRecordId = vaultRecordId;
  if (workingPaper) {
    const wp: WorkingPaperRef = { programName: detailText(workingPaper.programName) };
    if (workingPaper.sectionName) wp.sectionName = detailText(workingPaper.sectionName);
    if (workingPaper.boxHeader) wp.boxHeader = detailText(workingPaper.boxHeader);
    metadata.workingPaper = wp;
  }

  const entry: ActivityEntry = { action: ACTIONS[destination], entity: 'PDF Tools', details, metadata };
  if (vaultRecordId) entry.entityId = vaultRecordId;
  return entry;
}
