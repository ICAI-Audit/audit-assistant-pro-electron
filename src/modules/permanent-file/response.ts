import type { PermanentFileData } from './types';

type ListData = Extract<PermanentFileData, { documents: unknown }>;

export function requireCurrentListResponse(response: PermanentFileData): ListData {
  if (!('documents' in response) || !Array.isArray(response.documents)
    || !Array.isArray(response.engagements)
    || response.engagements.some((engagement) => typeof engagement.name !== 'string' || typeof engagement.financialYear !== 'string')
    || response.documents.some((document) => !Array.isArray(document.engagementIds))) {
    throw new Error('Permanent File could not load because the app may be running an older version. Save your work, close all ICAI VERA windows, and reopen the app.');
  }
  return response;
}
