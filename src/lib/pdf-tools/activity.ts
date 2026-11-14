import { FLAG_NOTES } from './resultNames';
import { PdfToolsError, type Destination, type OperationFlags, type OperationStep, type SourceRef, type WorkingFile } from './types';

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
const FLAG_KEYS: (keyof OperationFlags)[] = ['formFieldsDropped', 'bookmarksDropped', 'signatureInvalid', 'sharedResourcesKept'];
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

// "; bookmarks not carried; …" at the end of a summary (resultNames' FLAG_NOTES).
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

function safeOptions(raw: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(raw ?? {})) {
    if (isSecretOption(key)) continue;
    const value = (raw as Record<string, unknown>)[key];
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
  const details =
    `${summary} → ${detailName(file.name)} (${pages}). ` +
    `Sources: ${sourcesText(sources)}. ` +
    history +
    `Destination: ${destinationText(destination, workingPaper, zip)}.`;

  const metadata: Record<string, unknown> = {
    tool: operation?.tool ?? null,
    options: safeOptions(operation?.options),
    sources,
    resultName: metaName(file.name),
    pageCount: file.pageCount,
    size: file.size,
    sha256,
    destination,
  };
  if (history) {
    metadata.earlierSteps = steps.map((step) => ({ tool: step.tool, summary: stepSummary(step.summary), resultName: metaName(step.resultName), options: safeOptions(step.options) }));
    if (stepsNotListed > 0) metadata.earlierStepsNotListed = stepsNotListed;
    metadata.originalSources = originals ?? [];
  }
  for (const flag of FLAG_KEYS) if (operation?.flags?.[flag] === true) metadata[flag] = true;
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
