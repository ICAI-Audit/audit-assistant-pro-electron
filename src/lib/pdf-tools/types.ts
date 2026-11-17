/** The tools built in phase 1. */
export type PhaseOneToolId = 'merge' | 'split' | 'delete-pages' | 'compress' | 'page-numbers' | 'images-to-pdf' | 'pdf-to-images';
/**
 * The tools of phase 2: 'bookmarks' (A3), 'redact' (A9, A10), 'organise-pages' (B1), 'watermark' (B3),
 * 'protect' (B5), 'resize-crop' (Resize or crop pages, owner decision of 15 November 2026). Declared here so
 * result names and summaries (resultNames.ts) cover them from the start.
 */
export type PhaseTwoToolId = 'bookmarks' | 'redact' | 'organise-pages' | 'watermark' | 'protect' | 'resize-crop';
/** Every tool id, built or not yet built. */
export type AnyToolId = PhaseOneToolId | PhaseTwoToolId;
/**
 * Every tool with an entry in the `Record<ToolId, …>` tables (icons, rules, dialogs, run steps). A phase 2
 * tool's run module says whether it is built yet (`BUILT` in its run module, see toolStep.ts); one that is
 * not is shown on the toolbar as "Soon" and never runs.
 */
export type ToolId = PhaseOneToolId | PhaseTwoToolId;
export type FileOrigin = 'computer' | 'vault' | 'result';
/** 'download': handed to a download (no save dialog was available); its completion cannot be seen. */
export type Destination = 'computer' | 'download' | 'vault' | 'working-paper';

export interface SourceRef {
  name: string;
  origin: FileOrigin;
  evidenceId?: string;
  /** The working file's id, so two files with one name stay two sources. Never logged. */
  fileId?: string;
}

/** One step that made a source of a result: what it did and the result it made. */
export interface OperationStep {
  tool: ToolId;
  summary: string;
  resultName: string;
  options: Record<string, string | number | boolean>;
  /** The id of the result it made, so a step reached through two sources is kept once. Never logged. */
  resultId: string;
}

/** What a step did not carry over from its sources, or made invalid (its summary says it in words). */
export interface OperationFlags {
  formFieldsDropped?: boolean;
  bookmarksDropped?: boolean;
  signatureInvalid?: boolean;
  /** Split or Delete pages kept a page's resources whole (its content could not be read with certainty). */
  sharedResourcesKept?: boolean;
  /** Redact (A9): a value the user ticked in some places and not in others stays visible in the result. */
  redactedValuesLeftVisible?: boolean;
  /** Redact (A9): text of a rebuilt page could not be kept in the searchable layer (characters Helvetica cannot encode). */
  textLayerIncomplete?: boolean;
  /**
   * Watermark and Page numbers: on some page a mark in front may be misplaced, because the page's own
   * drawing instructions are damaged or could not be read (marks.ts MarkReport `damaged` or `unverified`).
   */
  markMayBeMisplaced?: boolean;
  /**
   * A source had a password (or restrictions) that was taken off when it was opened, so the result has none.
   * Provenance for the record only: the result itself is not "password-protected" (its wasProtected is false).
   */
  protectionRemoved?: boolean;
  /**
   * Bookmarks: old bookmarks the save could not remove with certainty stay in the file, unlinked (an old title
   * may still be in its bytes; bookmarks.ts BookmarkSaveReport, REV-A B5).
   */
  oldBookmarksKept?: boolean;
}

export interface OperationRecord {
  tool: ToolId;
  summary: string;
  sources: SourceRef[];
  options: Record<string, string | number | boolean>;
  flags?: OperationFlags;
  /** Set when a source is itself a result: the steps that made the sources, oldest first. */
  earlier?: OperationStep[];
  /** Older steps than those kept in `earlier`. */
  earlierNotListed?: number;
  /** Set when a source is itself a result: the files the steps started from (none of them a result). */
  originalSources?: SourceRef[];
}

/** A document property a copy may still carry (its value is never read out or kept). */
export type CarriedProperty = 'title' | 'author' | 'subject' | 'keywords';

/**
 * What a PDF still holds besides its pages, counted (inspect.ts): comments that hold text, attached
 * files, and which document properties are filled in. Counts and property names only: never a comment,
 * a file name or a property's value. Text that only looks hidden cannot be found reliably and is not counted.
 */
export interface CarriedContent {
  comments: number;
  attachments: number;
  properties: CarriedProperty[];
}

export interface VaultRecord {
  id: string;
  name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

export interface WorkingFile {
  id: string;
  name: string;
  kind: 'pdf' | 'image';
  mimeType: string;
  origin: FileOrigin;
  bytes: Uint8Array;
  size: number;
  pageCount: number | null;
  wasProtected: boolean;
  hasRestrictions: boolean;
  hasSignature: boolean;
  /** A result made from a signed file whose signature it can no longer carry validly. */
  signatureInvalid?: boolean;
  /** A Split or Delete pages result that may still hold images or fonts of the pages left out. */
  sharedResourcesKept?: boolean;
  /** From inspectPdf: what Split, Delete pages and Merge may not carry over. */
  hasFormFields?: boolean;
  hasBookmarks?: boolean;
  hasPageLinks?: boolean;
  /** From inspectPdf: attachments in the document's list. Split, Delete pages and Merge do not carry them; Organise pages does. */
  hasAttachments?: boolean;
  /** A result's comments, attachments and document properties, counted from its bytes (set only when there is any). */
  carried?: CarriedContent;
  /** Protect (B5): a result encrypted by PDF Tools. Refused as input to every tool; shown with a badge. */
  protectedOutput?: boolean;
  /** Protect (B5): the unlocked bytes of a protected result, for the viewer and thumbnails. Counted in the list size, dropped with the row and on an engagement change. */
  previewBytes?: Uint8Array;
  /**
   * A TIFF converted when it was added (intake.ts): one upright page with square pixels is a PNG (or its
   * own JPEG) image, any other TIFF a PDF with a page for each picture. The name stays the TIFF's own.
   */
  convertedFrom?: 'tiff';
  evidenceId?: string; // set when origin === 'vault'
  operation?: OperationRecord; // set when origin === 'result'
  groupId?: string; // results of one PDF-to-images run share it
  sentTo: Destination[];
  vaultRecord?: VaultRecord;
}

/**
 * Error codes added in phase 2, with the task that throws each: bookmarks A3, redact A5 and A9,
 * organise-pages B1, watermark B3, protect B5, and the run steps' own (toolStep.ts). Messages never
 * contain a value, term or password. Phase 1 codes reused by phase 2 ('encrypted', 'not-a-pdf',
 * 'invalid-page-list', the renderer's codes) are not repeated here.
 */
export type PhaseTwoErrorCode =
  | 'bookmark-title-invalid'
  | 'bookmarks-not-editable'
  | 'invalid-bookmarks'
  | 'redact-too-many'
  | 'redact-check-failed'
  | 'redact-nothing-chosen'
  | 'redact-find-failed'
  | 'organise-all-removed'
  | 'page-would-change'
  | 'organise-unverified'
  | 'duplicate-page'
  | 'invalid-rotation'
  | 'invalid-watermark-options'
  | 'invalid-page-box-options'
  | 'protect-failed'
  | 'protect-unverified'
  | 'protect-too-large'
  | 'password-mismatch'
  | 'password-too-short'
  | 'password-too-long'
  | 'password-invalid'
  | 'cancelled'
  | 'tool-not-built'
  | 'tool-load-failed';

/**
 * The fixed messages of phase 2 codes. Absent: messages the throwing task composes, because they name a
 * page, a place, a count, a limit or a field ('bookmark-title-invalid' when it names the bookmark,
 * 'redact-too-many' (the ticked count: redactFind.ts tooManyPlaces), 'redact-check-failed',
 * 'duplicate-page', 'page-would-change' (names the page), 'invalid-watermark-options',
 * 'invalid-page-box-options' (names the page or the field: pageBox.ts), the four password
 * codes, 'cancelled' (thrown by protectPdf too), 'tool-not-built').
 */
export const PHASE_TWO_ERROR_MESSAGES: Readonly<Partial<Record<PhaseTwoErrorCode, string>>> = {
  'bookmark-title-invalid': 'A bookmark needs a title.',
  'bookmarks-not-editable':
    'This file has more bookmarks, or deeper levels, than PDF Tools can edit (10,000 bookmarks, 32 levels). Nothing was changed.',
  'invalid-bookmarks': 'A bookmark points at a page this file does not have, or is nested too deeply. Nothing was changed.',
  'redact-nothing-chosen': 'Tick or draw at least one area to redact.',
  'redact-find-failed': 'The file could not be searched. It may be damaged.',
  'organise-all-removed': 'You cannot remove every page. Keep at least one.',
  'organise-unverified': 'The organised file could not be checked against the source. Nothing was created.',
  'invalid-rotation': 'Pages turn in steps of 90 degrees.',
  'protect-failed': 'The file could not be protected.',
  'protect-unverified': 'The protected file could not be verified. Nothing was added.',
  'protect-too-large': 'This file is larger than 150 MB, too large to protect in PDF Tools.',
  'tool-load-failed': 'This tool could not be loaded. Try again; if it happens again, restart the application.',
};

/** Toolbar reason for a result of Protect (design 5.18): it is never an input to another tool. */
export const PROTECTED_OUTPUT_REASON = 'This file is protected by PDF Tools. Use the file it was made from.';

export class PdfToolsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PdfToolsError';
  }
}
