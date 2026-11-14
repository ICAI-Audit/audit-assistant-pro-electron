/**
 * Where the active row of a one-Tab-stop list goes for a key: arrows by one, Home/End, and the
 * page keys by `page`. Returns null for other keys or an empty list. -1 means no row is active yet.
 */
export function moveIndex(key: string, index: number, count: number, page = 10): number | null {
  if (count <= 0) return null;
  const at = Math.min(index, count - 1);
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return at < 0 ? 0 : Math.min(at + 1, last);
    case 'ArrowUp':
      return at < 0 ? last : Math.max(at - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageDown':
      return Math.min(Math.max(at, 0) + page, last);
    case 'PageUp':
      return Math.max(at - page, 0);
    default:
      return null;
  }
}
