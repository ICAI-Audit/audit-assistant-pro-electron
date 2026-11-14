/**
 * Chromium remembers a failed import of a URL and fails every later import of it without asking
 * again. To retry, the same module is requested under a fresh URL, taken from the failure message
 * ("Failed to fetch dynamically imported module: <url>"). Returns null when the message names no
 * module (for example the code loaded but failed while running).
 */
export function retryUrl(message: string, attempt: number): string | null {
  const url = /((?:https?|file):\/\/[^\s'"?]+?\.(?:m?js|tsx?))(?:\?[^\s'"]*)?(?=$|[\s'"])/.exec(message)?.[1];
  return url ? `${url}?retry=${attempt}` : null;
}

/**
 * What the error boundary says. `loadFailure` is the error the screen's import last failed with:
 * only that error means the code could not be loaded; anything else went wrong while it ran.
 */
export function failureMessage(error: unknown, loadFailure: unknown): { title: string; text: string } {
  if (loadFailure !== null && error === loadFailure) {
    return { title: 'PDF Tools could not be displayed', text: 'Its screen could not be loaded. Try again; if this keeps happening, restart the application.' };
  }
  return {
    title: 'PDF Tools ran into a problem',
    text: 'Something went wrong while showing PDF Tools. The files in your list are kept. Try again; if this keeps happening, restart the application.',
  };
}
