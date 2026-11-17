import { describe, expect, it } from 'vitest';
import { failureMessage, retryUrl } from './chunkRetry';

describe('failureMessage', () => {
  it('says the screen could not be loaded only when loading it failed', () => {
    const loadError = new TypeError('Failed to fetch dynamically imported module: file:///x/PdfTools-1.js');
    expect(failureMessage(loadError, loadError)).toEqual({
      title: 'PDF Tools could not be displayed',
      text: 'Its screen could not be loaded. Try again; if this keeps happening, restart the application.',
    });
  });

  it('does not call a failure while running a loading failure', () => {
    const earlierLoadError = new TypeError('Failed to fetch dynamically imported module: file:///x/PdfTools-1.js');
    const message = failureMessage(new TypeError("Cannot read properties of undefined (reading 'name')"), earlierLoadError);
    expect(message.title).toBe('PDF Tools ran into a problem');
    expect(message.text).not.toMatch(/could not be loaded/);
    expect(failureMessage(new Error('x'), null).title).toBe('PDF Tools ran into a problem');
  });
});

describe('retryUrl', () => {
  it('asks for the failed chunk again under a fresh URL', () => {
    const message = 'Failed to fetch dynamically imported module: file:///C:/Program%20Files/ICAI%20VERA/resources/app.asar/dist/assets/PdfTools-By7TmK84.js';
    expect(retryUrl(message, 1)).toBe('file:///C:/Program%20Files/ICAI%20VERA/resources/app.asar/dist/assets/PdfTools-By7TmK84.js?retry=1');
    expect(retryUrl(message, 2)).toMatch(/\?retry=2$/);
  });

  it('works for the development server', () => {
    expect(retryUrl('Failed to fetch dynamically imported module: http://localhost:8080/src/components/pdf-tools/PdfTools.tsx', 1)).toBe(
      'http://localhost:8080/src/components/pdf-tools/PdfTools.tsx?retry=1',
    );
  });

  it('replaces an earlier retry number instead of adding another', () => {
    expect(retryUrl('Failed to fetch dynamically imported module: file:///x/PdfTools-1.js?retry=1', 2)).toBe('file:///x/PdfTools-1.js?retry=2');
  });

  it('gives nothing when the failure names no module', () => {
    expect(retryUrl('Cannot read properties of undefined', 1)).toBeNull();
    expect(retryUrl('', 1)).toBeNull();
  });
});
