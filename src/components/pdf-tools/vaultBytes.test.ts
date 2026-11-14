import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { filterChoices, isLockedFlag, isVaultFileUsable, readVaultFile, vaultChoices, vaultFileLike, type VaultFileRow } from './vaultBytes';

type Host = { electronAPI?: unknown };
const host = globalThis as unknown as Host;

function bridge(downloadFile: (bucket: string, path: string) => Promise<unknown>) {
  host.electronAPI = { downloadFile: vi.fn(downloadFile) };
  return (host.electronAPI as { downloadFile: ReturnType<typeof vi.fn> }).downloadFile;
}

afterEach(() => {
  delete host.electronAPI;
});

async function failure(promise: Promise<unknown>): Promise<PdfToolsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PdfToolsError);
    return error as PdfToolsError;
  }
  throw new Error('expected a failure');
}

describe('readVaultFile', () => {
  it('reads the file through the existing download channel of the evidence bucket', async () => {
    const download = bridge(async () => ({ buffer: new Uint8Array([37, 80, 68, 70]), mimeType: null }));
    const bytes = await readVaultFile('E1/u1/1700000000000-Bank.pdf');
    expect(download).toHaveBeenCalledWith('evidence', 'E1/u1/1700000000000-Bank.pdf');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it('accepts an ArrayBuffer and copies a view that does not start at the beginning of its buffer', async () => {
    bridge(async () => ({ buffer: new Uint8Array([9, 9, 1, 2, 3]).buffer, mimeType: null }));
    expect(Array.from(await readVaultFile('E1/u1/a.pdf'))).toEqual([9, 9, 1, 2, 3]);

    const backing = new Uint8Array([7, 7, 1, 2, 3, 7]);
    bridge(async () => ({ buffer: backing.subarray(2, 5), mimeType: null }));
    const bytes = await readVaultFile('E1/u1/b.pdf');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(3);
  });

  it('says plainly when it is not running in the desktop application', async () => {
    const error = await failure(readVaultFile('E1/u1/a.pdf'));
    expect(error.code).toBe('vault-unavailable');
  });

  it('says that a file missing on disk is missing', async () => {
    bridge(async () => {
      throw new Error('File not found');
    });
    const error = await failure(readVaultFile('E1/u1/a.pdf'));
    expect(error.code).toBe('vault-missing');
    expect(error.message).toMatch(/missing from the Evidence Vault/);
  });

  it("shows the main process's own refusal", async () => {
    bridge(async () => {
      throw new Error('Evidence file is outside the authenticated user’s engagement access.');
    });
    const error = await failure(readVaultFile('E2/u1/a.pdf'));
    expect(error.code).toBe('vault-refused');
    expect(error.message).toContain('Evidence file is outside the authenticated user’s engagement access.');
  });

  it('never shows a raw system error that may hold a local path', async () => {
    bridge(async () => {
      throw new Error("EACCES: permission denied, open 'C:\\Users\\Someone\\AppData\\Roaming\\vera\\files\\evidence\\E1\\a.pdf'");
    });
    const error = await failure(readVaultFile('E1/u1/a.pdf'));
    expect(error.code).toBe('vault-unreadable');
    expect(error.message).not.toMatch(/Users|AppData|EACCES/);
  });

  it('refuses an answer without bytes', async () => {
    bridge(async () => ({ buffer: null, mimeType: null }));
    expect((await failure(readVaultFile('E1/u1/a.pdf'))).code).toBe('vault-unreadable');
  });
});

describe('isVaultFileUsable', () => {
  it('goes by the recorded type first', () => {
    expect(isVaultFileUsable({ name: 'Bank statement', mime_type: 'application/pdf' })).toBe('pdf');
    expect(isVaultFileUsable({ name: 'photo', mime_type: 'image/jpeg' })).toBe('image');
    for (const mime of ['image/png', 'image/webp', 'image/bmp', 'image/gif']) expect(isVaultFileUsable({ name: 'x', mime_type: mime })).toBe('image');
  });

  it('falls back to the extension, ignoring case', () => {
    expect(isVaultFileUsable({ name: 'Ledger.PDF', mime_type: null })).toBe('pdf');
    expect(isVaultFileUsable({ name: 'scan.JPEG', mime_type: 'application/octet-stream' })).toBe('image');
    expect(isVaultFileUsable({ name: 'scan.png', mime_type: '' })).toBe('image');
  });

  it('leaves out what PDF Tools cannot open', () => {
    expect(isVaultFileUsable({ name: 'Trial balance.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBeNull();
    expect(isVaultFileUsable({ name: 'Letter.docx', mime_type: null })).toBeNull();
    expect(isVaultFileUsable({ name: 'scan.tif', mime_type: 'image/tiff' })).toBeNull();
    expect(isVaultFileUsable({ name: 'photo.heic', mime_type: 'image/heic' })).toBeNull();
    expect(isVaultFileUsable({ name: 'pdf', mime_type: null })).toBeNull();
  });
});

const row = (over: Partial<VaultFileRow>): VaultFileRow => ({
  id: 'ev',
  name: 'Bank.pdf',
  file_path: 'E1/u1/1-Bank.pdf',
  file_size: 1000,
  file_type: 'document',
  mime_type: 'application/pdf',
  engagement_id: 'E1',
  created_at: '2026-11-13 10:00:00',
  locked: 0,
  approval_stage: 'draft',
  ...over,
});

describe('vaultChoices', () => {
  it("lists only this engagement's PDFs and images, keeping locked and approved files", () => {
    const rows = [
      row({ id: '1', name: 'Bank.pdf' }),
      row({ id: '2', name: 'Other engagement.pdf', engagement_id: 'E2' }),
      row({ id: '3', name: 'TB.xlsx', mime_type: 'application/vnd.ms-excel' }),
      row({ id: '4', name: 'Confirmation.png', mime_type: 'image/png', locked: 1, approval_stage: 'approved' }),
      row({ id: '5', name: 'No engagement.pdf', engagement_id: null }),
    ];
    const choices = vaultChoices(rows, 'E1');
    expect(choices.map((c) => c.id)).toEqual(['1', '4']);
    expect(choices[1]).toMatchObject({ kind: 'image', locked: true, stage: 'approved', filePath: 'E1/u1/1-Bank.pdf', size: 1000 });
    expect(choices[0]).toMatchObject({ kind: 'pdf', locked: false });
  });

  it('lists nothing without an engagement', () => {
    expect(vaultChoices([row({})], null)).toEqual([]);
  });
});

describe('filterChoices', () => {
  const choices = vaultChoices(
    [row({ id: '1', name: 'HDFC Bank statement March.pdf' }), row({ id: '2', name: 'Debtor confirmation.pdf' }), row({ id: '3', name: 'bank reconciliation.png', mime_type: 'image/png' })],
    'E1',
  );
  it('matches every word, ignoring case and order', () => {
    expect(filterChoices(choices, '').map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(filterChoices(choices, '  BANK ').map((c) => c.id)).toEqual(['1', '3']);
    expect(filterChoices(choices, 'march bank').map((c) => c.id)).toEqual(['1']);
    expect(filterChoices(choices, 'zzz')).toEqual([]);
  });
});

describe('isLockedFlag', () => {
  it('reads the database flag in its stored forms', () => {
    for (const yes of [true, 1, '1', 'true']) expect(isLockedFlag(yes)).toBe(true);
    for (const no of [false, 0, '0', 'false', null, undefined, '']) expect(isLockedFlag(no)).toBe(false);
  });
});

describe('vaultFileLike', () => {
  it('carries the recorded size, the vault origin and the evidence id, and reads only when asked', async () => {
    const read = vi.fn(async () => new Uint8Array([5, 6, 7]));
    const like = vaultFileLike({ id: 'ev-9', name: 'Bank.pdf', filePath: 'E1/u1/9-Bank.pdf', size: 3 }, read);
    expect(like).toMatchObject({ name: 'Bank.pdf', size: 3, origin: 'vault', evidenceId: 'ev-9' });
    expect(read).not.toHaveBeenCalled();
    const buffer = await like.arrayBuffer();
    expect(read).toHaveBeenCalledWith('E1/u1/9-Bank.pdf');
    expect(Array.from(new Uint8Array(buffer))).toEqual([5, 6, 7]);
  });
});
