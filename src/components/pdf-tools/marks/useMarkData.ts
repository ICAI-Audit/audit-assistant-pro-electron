// What the marks dialogs load besides the preview: the characters the fonts can write (Watermark and Page
// numbers), the pre-run page scan (scans, form fields) and the prepared logo (Watermark). Each is started without
// blocking the dialog, cancelled when the dialog closes or its input changes, and shown only while
// the list the dialog was opened for is still the current one (`isCurrent`).
import { useEffect, useRef, useState } from 'react';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { browserLogoDeps, LOGO_LIMITS, LogoError, prepareLogo, PREVIEW_LOGO_LIMITS, type PreparedLogo } from './logoIntake';
import { loadCharacterCheck, type CharacterCheck } from './markText';
import { scanPages, type PageScan } from './pageScan';

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** The character check, once loaded (null until then: the library still checks at the run). */
export function useCharacterCheck(): CharacterCheck | null {
  const [check, setCheck] = useState<CharacterCheck | null>(null);
  useEffect(() => {
    let live = true;
    loadCharacterCheck().then(
      (loaded) => live && setCheck(() => loaded),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return check;
}

/**
 * The scanned pages and the pages with form fields, read once the dialog needs them (`wanted`):
 * reading a large file takes a moment, and most runs need neither note.
 */
export function usePageScan(bytes: Uint8Array, wanted: boolean, isCurrent: () => boolean): PageScan | null {
  const [scan, setScan] = useState<{ bytes: Uint8Array; scan: PageScan } | null>(null);
  const current = useLatest(isCurrent);
  const needed = wanted && scan?.bytes !== bytes;
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    scanPages(bytes, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted && current.current()) setScan({ bytes, scan: result });
      },
      () => undefined, // no note is better than a wrong one
    );
    return () => controller.abort();
  }, [bytes, needed, current]);
  return scan?.bytes === bytes ? scan.scan : null;
}

export type LogoReady =
  | { status: 'none' }
  | { status: 'preparing'; fileId: string }
  | { status: 'ready'; fileId: string; name: string; full: PreparedLogo; preview: PreparedLogo }
  | { status: 'error'; fileId: string; message: string };

/**
 * The chosen working-list image made ready for the library (logoIntake.ts): turned upright, made RGB,
 * redrawn at 1,200 px when larger than 1,600 px, plus a small copy for the preview. Held in this
 * dialog's state only, so the logo is never remembered after the dialog closes.
 */
export function usePreparedLogo(file: WorkingFile | null, isCurrent: () => boolean): LogoReady {
  const [state, setState] = useState<LogoReady>({ status: 'none' });
  const current = useLatest(isCurrent);
  const fileId = file?.id ?? null;
  const bytes = file?.bytes ?? null;
  const name = file?.name ?? '';
  useEffect(() => {
    if (!fileId || !bytes) {
      setState({ status: 'none' });
      return;
    }
    let live = true;
    setState({ status: 'preparing', fileId });
    (async () => {
      try {
        const full = await prepareLogo(bytes, browserLogoDeps, LOGO_LIMITS);
        if (!live || !current.current()) return;
        const preview = await prepareLogo(full.image, browserLogoDeps, PREVIEW_LOGO_LIMITS);
        if (!live || !current.current()) return;
        setState({ status: 'ready', fileId, name, full, preview });
      } catch (error) {
        if (!live || !current.current()) return;
        setState({ status: 'error', fileId, message: error instanceof LogoError ? error.message : 'This image could not be read. It may be damaged.' });
      }
    })();
    return () => {
      live = false;
    };
  }, [fileId, bytes, name, current]);
  return fileId && 'fileId' in state && state.fileId === fileId ? state : fileId ? { status: 'preparing', fileId } : { status: 'none' };
}
