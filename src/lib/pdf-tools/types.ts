export type ToolId = 'merge' | 'split' | 'delete-pages' | 'compress' | 'page-numbers' | 'images-to-pdf' | 'pdf-to-images';
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
  evidenceId?: string; // set when origin === 'vault'
  operation?: OperationRecord; // set when origin === 'result'
  groupId?: string; // results of one PDF-to-images run share it
  sentTo: Destination[];
  vaultRecord?: VaultRecord;
}

export class PdfToolsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PdfToolsError';
  }
}
