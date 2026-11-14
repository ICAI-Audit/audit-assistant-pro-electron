// Reading the Evidence Vault as a source for PDF Tools.
//
// A vault file is read through the existing `file-download` channel (bucket 'evidence'), which the
// main process limits to registered evidence files the signed-in user may see. The bridge is typed
// here rather than in src/electron.d.ts. Nothing in this file writes anything.
import { PdfToolsError } from '@/lib/pdf-tools/types';
import type { FileLike } from './intakeRunner';

interface DownloadBridge {
  downloadFile?: (bucket: string, path: string) => Promise<{ buffer: unknown; mimeType: string | null }>;
}

const bridge = (): DownloadBridge | undefined => (globalThis as unknown as { electronAPI?: DownloadBridge }).electronAPI;

/** Messages from the main process that refuse access; they are shown as they are. */
const REFUSALS = [/outside the authenticated user/i, /Only registered evidence files/i, /Authentication required/i];

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    // A view into a larger buffer is copied, so the list holds exactly the file's bytes.
    return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength ? view : view.slice();
  }
  return null;
}

function readError(error: unknown): PdfToolsError {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/^File not found$/i.test(message.trim())) {
    return new PdfToolsError(
      'vault-missing',
      "This file is missing from the Evidence Vault's folder on this computer. It may have been moved or deleted outside VERA.",
    );
  }
  if (REFUSALS.some((pattern) => pattern.test(message))) {
    return new PdfToolsError('vault-refused', `The Evidence Vault did not open this file: ${message}`);
  }
  // A system error can name a local path; it is not shown.
  return new PdfToolsError('vault-unreadable', 'This file could not be read from the Evidence Vault. Check that it can still be opened there.');
}

/** The bytes of one Evidence Vault file, by its recorded path. Throws PdfToolsError with a plain message. */
export async function readVaultFile(filePath: string): Promise<Uint8Array> {
  const download = bridge()?.downloadFile;
  if (typeof download !== 'function') {
    throw new PdfToolsError('vault-unavailable', 'The Evidence Vault can only be read in the VERA desktop application.');
  }
  let answer: { buffer: unknown } | null | undefined;
  try {
    answer = await download('evidence', filePath);
  } catch (error) {
    throw readError(error);
  }
  const bytes = toBytes(answer?.buffer);
  if (!bytes) throw readError(null);
  return bytes;
}

const PDF_TYPES = new Set(['application/pdf', 'application/x-pdf']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/bmp', 'image/x-ms-bmp', 'image/gif']);

/** Whether PDF Tools can open a vault file: by its recorded type, else by its extension. */
export function isVaultFileUsable(f: { name: string; mime_type: string | null }): 'pdf' | 'image' | null {
  const type = (f.mime_type ?? '').trim().toLowerCase();
  if (PDF_TYPES.has(type)) return 'pdf';
  if (IMAGE_TYPES.has(type)) return 'image';
  const name = f.name.trim();
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(jpe?g|png|webp|bmp|gif)$/i.test(name)) return 'image';
  return null;
}

/** SQLite keeps flags as 0/1; older rows and optimistic updates may hold booleans or text. */
export function isLockedFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** The fields of an `evidence_files` row that the picker uses. */
export interface VaultFileRow {
  id: string;
  name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  mime_type: string | null;
  engagement_id: string | null;
  created_at: string;
  locked: unknown;
  approval_stage?: string | null;
}

export interface VaultChoice {
  id: string;
  name: string;
  filePath: string;
  size: number;
  kind: 'pdf' | 'image';
  fileType: string;
  createdAt: string;
  locked: boolean;
  stage: string;
}

/**
 * The files the picker offers: PDFs and images of this engagement only. The vault list of the
 * screen may still hold the previous engagement's rows for a moment after a switch; they are left out.
 * Locked and approved files are offered, since they are only read.
 */
export function vaultChoices(rows: readonly VaultFileRow[], engagementId: string | null): VaultChoice[] {
  if (!engagementId) return [];
  const choices: VaultChoice[] = [];
  for (const row of rows) {
    if (row.engagement_id !== engagementId) continue;
    const kind = isVaultFileUsable(row);
    if (!kind) continue;
    choices.push({
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      size: Number(row.file_size) || 0,
      kind,
      fileType: row.file_type,
      createdAt: row.created_at,
      locked: isLockedFlag(row.locked),
      stage: row.approval_stage || 'draft',
    });
  }
  return choices;
}

/** Name search: every word must appear, in any order, ignoring case. */
export function filterChoices(choices: readonly VaultChoice[], query: string): VaultChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return choices.slice();
  return choices.filter((c) => {
    const name = c.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

/** A vault file for the intake queue. It is read only when its turn comes. */
export function vaultFileLike(
  choice: Pick<VaultChoice, 'id' | 'name' | 'filePath' | 'size'>,
  read: (filePath: string) => Promise<Uint8Array> = readVaultFile,
): FileLike {
  return {
    name: choice.name,
    size: choice.size,
    origin: 'vault',
    evidenceId: choice.id,
    arrayBuffer: async () => {
      const bytes = await read(choice.filePath);
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
    },
  };
}
