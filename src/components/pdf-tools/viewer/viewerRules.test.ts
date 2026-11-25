import { describe, expect, it, vi } from 'vitest';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { RenderTimeoutError } from '../renderQueue';
import { chooseWords, drawingNotes, focusTargetAfterClose, isLowMemory, looksBlank, viewAvailability, viewBytes, viewerCloseReason, viewerErrorMessage, type Focusable } from './viewerRules';

const el = (over: Partial<Focusable> = {}): Focusable => ({ isConnected: true, focus: vi.fn(), ...over });

describe('where focus goes when the viewer closes', () => {
  it('back to the control that opened it', () => {
    const opener = el();
    expect(focusTargetAfterClose('user', [opener, el()])).toBe(opener);
  });

  it('to the next candidate when the opener has gone or is disabled', () => {
    const gone = el({ isConnected: false });
    const disabled = el({ disabled: true });
    const fallback = el();
    expect(focusTargetAfterClose('user', [gone, null, disabled, undefined, fallback])).toBe(fallback);
    expect(focusTargetAfterClose('user', [gone, disabled])).toBeNull();
    expect(focusTargetAfterClose('user', [])).toBeNull();
  });

  it('nowhere after a change of engagement or user, or when its file left the list', () => {
    // The header's engagement menu may still be closing: its focus must not be fought (listFocus.ts).
    expect(focusTargetAfterClose('context', [el()])).toBeNull();
    expect(focusTargetAfterClose('file-gone', [el()])).toBeNull();
  });
});

describe('when the viewer must close by itself', () => {
  const opened = { contextKey: 'u1:e1', session: 4, fileId: 'f1' };

  it('stays open while the list, session and file are the same', () => {
    expect(viewerCloseReason(opened, { contextKey: 'u1:e1', session: 4, fileIds: ['f0', 'f1'] })).toBeNull();
  });

  it('closes on a change of engagement, user or session', () => {
    expect(viewerCloseReason(opened, { contextKey: 'u1:e2', session: 4, fileIds: ['f1'] })).toBe('context');
    expect(viewerCloseReason(opened, { contextKey: 'u2:e1', session: 4, fileIds: ['f1'] })).toBe('context');
    expect(viewerCloseReason(opened, { contextKey: 'u1:e1', session: 5, fileIds: ['f1'] })).toBe('context');
    expect(viewerCloseReason(opened, { contextKey: null, session: 4, fileIds: [] })).toBe('context');
    // The guarded state of a list that is not this engagement's has session -1.
    expect(viewerCloseReason(opened, { contextKey: 'u1:e1', session: -1, fileIds: [] })).toBe('context');
  });

  it('closes when its file has left the list', () => {
    expect(viewerCloseReason(opened, { contextKey: 'u1:e1', session: 4, fileIds: ['f0'] })).toBe('file-gone');
  });

  it('never opens on a list that is not current', () => {
    expect(viewerCloseReason({ contextKey: null, session: 0, fileId: 'f1' }, { contextKey: null, session: 0, fileIds: ['f1'] })).toBe('context');
    expect(viewerCloseReason({ contextKey: 'u1:e1', session: -1, fileId: 'f1' }, { contextKey: 'u1:e1', session: -1, fileIds: ['f1'] })).toBe('context');
  });
});

describe('what the viewer draws', () => {
  const bytes = new Uint8Array([1]);
  const preview = new Uint8Array([2]);

  it('the file itself, or the unprotected copy of a protected result', () => {
    expect(viewBytes({ bytes })).toBe(bytes);
    expect(viewBytes({ bytes, protectedOutput: true, previewBytes: preview })).toBe(preview);
    // Never the encrypted bytes.
    expect(viewBytes({ bytes, protectedOutput: true })).toBeNull();
  });
});

describe('what the viewer says when a page cannot be shown', () => {
  it('a plain sentence for each cause, never the file name or the library text', () => {
    expect(viewerErrorMessage(new PdfToolsError('render-unavailable', 'Page previews could not be started. Restart the application and try again.'))).toBe(
      'Page previews could not be started. Restart the application and try again.',
    );
    expect(viewerErrorMessage(new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.'))).toBe(
      'There was not enough memory to draw this page at this zoom. Try a smaller zoom.',
    );
    expect(viewerErrorMessage(new RenderTimeoutError())).toBe('Drawing this page took too long. Try again.');
    expect(viewerErrorMessage(new PdfToolsError('renderer-restarted', 'The page renderer had to restart.'))).toBe('The page renderer had to restart. Try again.');
    // A file's own error text (which can quote its name or content) is not shown.
    expect(viewerErrorMessage(new PdfToolsError('render-failed', 'This file has no page 9.'))).toBe('This page could not be drawn. The file may be damaged.');
    expect(viewerErrorMessage(new Error('Secret Client Ltd.pdf: bad XRef'))).toBe('This page could not be drawn. The file may be damaged.');
  });
});

describe('a retry after running out of memory', () => {
  it('is told apart from other failures', () => {
    expect(isLowMemory(new PdfToolsError('out-of-memory', 'x'))).toBe(true);
    expect(isLowMemory(new PdfToolsError('image-encode-failed', 'x'))).toBe(true);
    expect(isLowMemory(new PdfToolsError('render-failed', 'x'))).toBe(false);
    expect(isLowMemory(new RenderTimeoutError())).toBe(false);
    expect(isLowMemory(new Error('Array buffer allocation failed'))).toBe(false);
  });
});

describe('a drawing with nothing on it', () => {
  it('is every sampled pixel white, within a few levels', () => {
    const white = new Uint8ClampedArray(4 * 64).fill(255);
    expect(looksBlank(white)).toBe(true);
    const nearly = white.slice();
    nearly[4 * 10] = 252; // a level or two of noise
    expect(looksBlank(nearly)).toBe(true);
    const marked = white.slice();
    marked[4 * 10 + 1] = 230; // a faint mark
    expect(looksBlank(marked)).toBe(false);
    expect(looksBlank(new Uint8ClampedArray(0))).toBe(false);
  });
});

describe('the notes under a drawing', () => {
  it('a blank page is said quietly, with nothing to retry; a drawing held below the sharpness asked says so', () => {
    // Re-review 1: a scan's blank reverse side is a normal page, not an alarm.
    expect(drawingNotes({ blank: true, reduced: false })).toEqual([{ kind: 'blank', text: 'Blank page' }]);
    expect(drawingNotes({ blank: false, reduced: true })).toEqual([{ kind: 'reduced', text: 'Shown at reduced sharpness at this zoom' }]);
    expect(drawingNotes({ blank: true, reduced: true }).map((n) => n.kind)).toEqual(['blank', 'reduced']);
    expect(drawingNotes({ reduced: false })).toEqual([]);
    expect(drawingNotes(null)).toEqual([]);
  });
});

describe('opening the viewer from a page panel', () => {
  it('is not offered while a tool runs, and says why', () => {
    expect(viewAvailability(false)).toEqual({ enabled: true, reason: null });
    expect(viewAvailability(true)).toEqual({ enabled: false, reason: 'Wait for the tool to finish to view pages larger.' });
  });
});

describe('the words of the page choice in the viewer', () => {
  it('follow the panel: choosing pages, or marking them for removal', () => {
    expect(chooseWords('primary')).toEqual({ off: 'Choose this page', on: 'Chosen', onHint: 'Click to unchoose this page' });
    expect(chooseWords('destructive')).toEqual({ off: 'Mark for removal', on: 'Marked for removal', onHint: 'Click to keep this page' });
  });
});
