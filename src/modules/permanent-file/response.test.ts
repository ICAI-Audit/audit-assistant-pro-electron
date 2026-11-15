import { describe, expect, it } from 'vitest';
import { requireCurrentListResponse } from './response';
import type { PermanentDocument, PermanentFileData } from './types';

describe('Permanent File IPC list compatibility', () => {
  const document: PermanentDocument = {
    id: 'doc', name: 'Deed', category: 'PF-02', documentNumber: 1, versionId: 'v1',
    version: 1, fileName: 'deed.pdf', uploadedBy: 'user', uploadedAt: '2026-01-01',
    verificationStatus: 'unverified', reviewedDate: null, expiryDate: null,
    documentYear: null, keywords: null, reference: 'client-PF-02-DOC-001-V01', engagementIds: ['eng-a'],
  };
  const current: Extract<PermanentFileData, { documents: unknown }> = {
    client: { id: 'client', name: 'Client' }, documents: [document],
    categories: { 'PF-02': 'Constitution' }, engagements: [{ id: 'eng-a', name: 'Audit', financialYear: '2024-25' }], storageWarning: false,
  };

  it('accepts a current response including document links', () => {
    expect(requireCurrentListResponse(current)).toBe(current);
  });

  it('reports the old main-process response instead of rendering a blank page', () => {
    const old = { ...current };
    Reflect.deleteProperty(old, 'engagements');
    expect(() => requireCurrentListResponse(old)).toThrow(/close all ICAI VERA windows/i);
  });

  it('rejects stale document metadata even when the engagement list is present', () => {
    const oldDocument = { ...document };
    Reflect.deleteProperty(oldDocument, 'engagementIds');
    expect(() => requireCurrentListResponse({ ...current, documents: [oldDocument] })).toThrow(/older version/i);
  });
});
