export type PermanentDocument = {
  id: string;
  name: string;
  category: string;
  documentNumber: number;
  versionId: string;
  version: number;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  verificationStatus: string;
  reviewedDate: string | null;
  expiryDate: string | null;
  documentYear: string | null;
  keywords: string | null;
  reference: string;
  engagementIds: string[];
};

export type PermanentFileRequest =
  | { action: 'list'; clientId: string }
  | { action: 'upload'; clientId: string; documentId?: string; category?: string; name?: string; fileName: string; bytes: ArrayBuffer; engagementIds: string[] }
  | { action: 'download'; clientId: string; versionId: string }
  | { action: 'updateMetadata'; clientId: string; versionId: string; verificationStatus: string;
      reviewedDate: string | null; expiryDate: string | null; documentYear: string | null; keywords: string | null; engagementIds: string[] }
  | { action: 'history'; clientId: string }
  | { action: 'entity'; clientId: string }
  | { action: 'saveClientMaster'; clientId: string; master: ClientMaster }
  | { action: 'saveEntity'; clientId: string; details: EntityDetails }
  | { action: 'addHistory'; clientId: string; entry: HistoryEntry }
  | { action: 'endHistory'; clientId: string; historyId: string; effectiveUntil: string }
  | { action: 'compareHistory'; clientId: string; previousDate: string; currentDate: string };

export type HistoryAttributes = { name: string; details: string; documentVersionId?: string };
export type EntityDetails = {
  tradeName: string; incorporationDate: string; incorporationPlace: string; tan: string;
  branches: string[]; groupDetails: string; auditPartner: string; keyPersonnel: string;
};
export type ClientMaster = {
  name: string; industry: string; constitution: string; cin: string; pan: string;
  address: string; state: string; pin: string;
};
export type EntityData = {
  client: { id: string; name: string; industry: string | null; constitution: string | null; cin: string | null;
    pan: string | null; address: string | null; state: string | null; pin: string | null };
  details: EntityDetails | null; gstins: string[]; unmatchedGstins: string[]; canEditMaster: boolean;
};
export type HistoryEntry = {
  kind: string; subjectId: string; effectiveFrom: string; effectiveUntil: string | null;
  attributes: HistoryAttributes; predecessorId?: string;
};
export type HistoryRecord = HistoryEntry & { id: string; recordedBy: string; recordedAt: string };
export type HistoryChange = {
  kind: string; subjectId: string; change: 'added' | 'removed' | 'changed';
  before: HistoryAttributes | null; after: HistoryAttributes | null;
};

export type PermanentFileData =
  | { client: { id: string; name: string }; documents: PermanentDocument[]; categories: Record<string, string>; engagements: { id: string; name: string; financialYear: string }[]; storageWarning: boolean }
  | { documentId: string; versionId: string; reference: string }
  | { fileName: string; bytes: Uint8Array }
  | { history: HistoryRecord[] }
  | { historyId: string }
  | { ended: boolean }
  | { updated: boolean }
  | { entity: EntityData }
  | { changes: HistoryChange[]; records: HistoryRecord[] };

export type ListData = Extract<PermanentFileData, { documents: unknown }>;
