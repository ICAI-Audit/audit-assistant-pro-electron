import { useCallback, useEffect, useRef, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useEngagement } from '@/contexts/EngagementContext';
import { useAuth } from '@/contexts/AuthContext';

/**
 * CAAT Tools — data analytics tests and SA 530 sampling.
 *
 * The tested standalone tool (public/caat/caat-tools.html) is embedded
 * unchanged in an iframe. public/caat/caat-bridge.js, loaded inside it, sends
 * the workspace (settings, inputs and source files) here; this page stores it
 * per engagement in caat_workspaces / caat_source_files, because database
 * requests are only accepted from the main application frame.
 */

const db = getSQLiteClient();
const TOOL_URL = `${import.meta.env.BASE_URL}caat/caat-tools.html`;

type SavedFile = { key: string; name: string; kind: string; buf: ArrayBuffer };
type FileRow = { file_key: string; file_name: string; file_kind: string; content_base64: string | null };
type SaveMessage = {
  state?: unknown;
  keep?: string[];
  files?: Array<{ key: string; name: string; kind: string; sha256: string; buf: ArrayBuffer }>;
};
const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

type SaveStatus = { kind: 'loading' | 'idle' | 'saving' | 'saved' | 'error'; text?: string };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parseState(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length ? parsed : null;
    } catch {
      return null;
    }
  }
  return value;
}

export default function CaatTools() {
  const { currentEngagement } = useEngagement();
  const { user, profile } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'loading' });

  const engagementId = currentEngagement?.id ?? null;
  const userId = user?.id ?? null;

  const post = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  useEffect(() => {
    if (!engagementId) return undefined;
    let cancelled = false;
    let frameReady = false;
    let loaded: { state: unknown; files: SavedFile[] } | null = null;
    setStatus({ kind: 'loading' });

    const defaults = {
      eEnt: currentEngagement?.client_name || currentEngagement?.name || '',
      ePer: currentEngagement?.financial_year ? `FY ${currentEngagement.financial_year}` : '',
      ePrep: (profile as { full_name?: string } | null)?.full_name || '',
    };

    const sendInit = () => {
      if (!frameReady || !loaded || cancelled) return;
      post({ type: 'caat:init', state: loaded.state, files: loaded.files, defaults });
      setStatus({ kind: 'idle' });
    };

    const load = async () => {
      try {
        const [{ data: ws, error: wsError }, { data: fileRows, error: fileError }] = await Promise.all([
          db.from('caat_workspaces').select('*').eq('engagement_id', engagementId).maybeSingle().execute(),
          db.from('caat_source_files')
            .select('file_key, file_name, file_kind, content_base64')
            .eq('engagement_id', engagementId)
            .execute(),
        ]);
        if (wsError) throw wsError;
        if (fileError) throw fileError;
        if (cancelled) return;
        loaded = {
          state: parseState(ws?.state),
          files: ((fileRows || []) as FileRow[]).map((row) => ({
            key: row.file_key,
            name: row.file_name,
            kind: row.file_kind,
            buf: fromBase64(row.content_base64 || ''),
          })),
        };
        sendInit();
      } catch (e) {
        if (cancelled) return;
        loaded = { state: null, files: [] };
        setStatus({ kind: 'error', text: `Could not load the saved workspace: ${errText(e)}` });
        sendInit();
      }
    };

    const save = async (msg: SaveMessage) => {
      const keep: string[] = Array.isArray(msg.keep) ? msg.keep : [];
      setStatus({ kind: 'saving' });
      try {
        const files = Array.isArray(msg.files) ? msg.files : [];
        for (const file of files) {
          const { error } = await db.from('caat_source_files').upsert({
            engagement_id: engagementId,
            file_key: file.key,
            file_name: file.name,
            file_kind: file.kind === 'csv' ? 'csv' : 'xlsx',
            sha256: file.sha256,
            size_bytes: file.buf?.byteLength ?? 0,
            content_base64: toBase64(file.buf),
            created_by: userId,
          }, { onConflict: 'engagement_id,file_key' });
          if (error) throw error;
        }

        const { error: wsError } = await db.from('caat_workspaces').upsert({
          engagement_id: engagementId,
          state: JSON.stringify(msg.state ?? {}),
          state_version: 1,
          updated_by: userId,
          created_by: userId,
        }, { onConflict: 'engagement_id' });
        if (wsError) throw wsError;

        // Remove source files the auditor has taken out of the workspace.
        const { data: stored, error: listError } = await db.from('caat_source_files')
          .select('file_key')
          .eq('engagement_id', engagementId)
          .execute();
        if (listError) throw listError;
        const keepSet = new Set(keep);
        for (const row of (stored || []) as Array<{ file_key: string }>) {
          if (!keepSet.has(row.file_key)) {
            const { error } = await db.from('caat_source_files')
              .delete()
              .eq('engagement_id', engagementId)
              .eq('file_key', row.file_key)
              .execute();
            if (error) throw error;
          }
        }

        if (cancelled) return;
        post({ type: 'caat:saved', ok: true, keys: files.map((f) => f.key), keep });
        setStatus({ kind: 'saved', text: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
      } catch (e) {
        if (cancelled) return;
        post({ type: 'caat:saved', ok: false });
        setStatus({ kind: 'error', text: `Not saved: ${errText(e)}` });
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const msg = event.data || {};
      if (msg.type === 'caat:ready') {
        frameReady = true;
        sendInit();
      } else if (msg.type === 'caat:save') {
        void save(msg as SaveMessage);
      } else if (msg.type === 'caat:error') {
        setStatus({ kind: 'error', text: String(msg.message || 'CAAT Tools reported an error.') });
      }
    };

    window.addEventListener('message', onMessage);
    void load();
    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
    // Reload only when the engagement changes; the iframe is re-created with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  const statusText = {
    loading: 'Loading saved workspace…',
    idle: 'Changes are saved automatically to this engagement',
    saving: 'Saving…',
    saved: `Saved to this engagement at ${status.text}`,
    error: status.text,
  }[status.kind];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-4 border-b bg-background px-4 py-2 text-sm">
        <div className="font-medium">
          CAAT Tools
          {currentEngagement && (
            <span className="ml-2 font-normal text-muted-foreground">
              {currentEngagement.client_name || currentEngagement.name}
              {currentEngagement.financial_year ? ` · FY ${currentEngagement.financial_year}` : ''}
            </span>
          )}
        </div>
        <div className={status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'} role="status">
          {statusText}
        </div>
      </div>
      {engagementId ? (
        <iframe
          key={engagementId}
          ref={frameRef}
          src={TOOL_URL}
          title="CAAT Tools"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div className="p-6 text-muted-foreground">Select an engagement to use CAAT Tools.</div>
      )}
    </div>
  );
}
