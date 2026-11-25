/** How long work may take before its control shows a busy state (shorter work shows none, so nothing flashes). */
export const BUSY_DELAY_MS = 300;

/**
 * Calls `show` if the work is still going after `delay`, and `hide` when it ends (only if it was
 * shown). Returns the function to call when the work ends; calling it again does nothing.
 */
export function delayedBusy(show: () => void, hide: () => void, delay = BUSY_DELAY_MS): () => void {
  let shown = false;
  let ended = false;
  const timer = setTimeout(() => {
    if (ended) return;
    shown = true;
    show();
  }, delay);
  return () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    if (shown) hide();
  };
}
