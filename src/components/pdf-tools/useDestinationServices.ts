import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/contexts/EngagementContext';
import { useActivityLogs } from '@/hooks/useActivityLogs';
import { useAuditExecution, useAuditExecutionAttachments } from '@/hooks/useAuditExecution';
import { useEvidenceFiles } from '@/hooks/useEvidenceFiles';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { sha256Hex } from '@/lib/pdf-tools/hash';
import { workingListStore } from '@/lib/pdf-tools/workingList';
import type { VaultRecord } from '@/lib/pdf-tools/types';
import { programmesFor, vaultRecordState, type DestinationDeps, type VaultRecordState } from './destinations';
import type { VaultFileRow } from './vaultBytes';

const db = getSQLiteClient();

/** The user the main process has signed in (typed here; src/electron.d.ts is not changed). */
async function signedInUserId(): Promise<string | null> {
  const bridge = (globalThis as unknown as { electronAPI?: { sqliteGetCurrentUser?: () => Promise<{ user_id?: string } | null> } }).electronAPI;
  const user = await bridge?.sqliteGetCurrentUser?.();
  return user?.user_id ?? null;
}

/**
 * Whether one evidence record still exists, by id and within the engagement captured when the user
 * acted, through the same authorised query path as the vault's own list.
 */
async function lookupVaultRecord(id: string, engagementId: string): Promise<VaultRecordState> {
  try {
    const { data, error } = await db.from('evidence_files').select('id').eq('id', id).eq('engagement_id', engagementId).execute();
    if (error) return 'unknown';
    return Array.isArray(data) && data.length > 0 ? 'present' : 'missing';
  } catch {
    return 'unknown';
  }
}

/**
 * The existing hooks the destinations use, unchanged: the Evidence Vault's list and upload, the
 * engagement's audit programmes, the attachment insert and the activity log. Each render gives
 * functions tied to that render's user and engagement; the screen takes them at the click that
 * confirms a destination, together with the scope, so a batch never switches engagement midway.
 */
export function useDestinationServices() {
  const { user } = useAuth();
  const { currentEngagement } = useEngagement();
  const engagementId = currentEngagement?.id ?? null;
  const evidence = useEvidenceFiles(engagementId ?? undefined);
  const audit = useAuditExecution(engagementId);
  // No programme: nothing is fetched; only its insert is used.
  const { createAttachment } = useAuditExecutionAttachments(null);
  const { logActivity } = useActivityLogs();

  const vaultRows = evidence.files as unknown as VaultFileRow[];
  const vaultLoading = evidence.loading;
  const vaultList = useMemo(() => ({ loaded: !vaultLoading, ids: new Set(vaultRows.map((r) => r.id)) }), [vaultRows, vaultLoading]);
  /**
   * For what a dialog offers when it opens: present in the loaded list, else asked by id (so a failed
   * first load never causes a second upload).
   */
  const checkVaultRecord = (record: VaultRecord, engagementId: string) => vaultRecordState(record, vaultList, (id) => lookupVaultRecord(id, engagementId));

  const deps: DestinationDeps = {
    store: workingListStore,
    hash: sha256Hex,
    uploadFile: evidence.uploadFile,
    createAttachment,
    logActivity,
    // Right before an attachment reuses a record: always asked by id, since the list on screen may
    // be older than a deletion made elsewhere. An attachment never points at a record that is gone.
    vaultRecordState: (record: VaultRecord, engagementId: string) => lookupVaultRecord(record.id, engagementId),
    signedInUserId,
  };
  const programmes = useMemo(() => programmesFor(audit.programs, engagementId), [audit.programs, engagementId]);

  return {
    userId: user?.id ?? null,
    engagementId,
    deps,
    vaultRows,
    vaultLoading,
    checkVaultRecord,
    /** Fetches this render's engagement's vault list again (after a batch that A's late refresh may have overwritten). */
    refreshVault: evidence.refetch,
    programmes,
    programmesLoading: audit.loading,
  };
}

export type DestinationServices = ReturnType<typeof useDestinationServices>;
