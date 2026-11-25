import { useCallback, useMemo, useState } from 'react';
import { formatPageList } from '@/lib/pdf-tools/pageList';
import { chosenPageNumbers, readPageList, togglePage, type ListOrder } from '../pageSelection';

/**
 * A typed page list kept in step with the page thumbnails. The text is what the tool uses; a
 * click on a thumbnail rewrites it from the last valid list. While the text is not valid the
 * thumbnails keep showing the last valid choice.
 */
export function usePageList(pageCount: number, order: ListOrder) {
  const [text, setText] = useState('');
  const [lastValid, setLastValid] = useState<number[]>([]);
  const reading = useMemo(() => readPageList(text, pageCount, order), [text, pageCount, order]);
  const empty = text.trim() === '';

  const type = useCallback(
    (value: string) => {
      setText(value);
      const next = readPageList(value, pageCount, order);
      if (next.indices) setLastValid(next.indices);
      else if (value.trim() === '') setLastValid([]);
    },
    [pageCount, order],
  );

  const toggle = useCallback(
    (pageNumber: number) => {
      const next = togglePage(lastValid, pageNumber - 1, order);
      setLastValid(next);
      setText(formatPageList(next));
    },
    [lastValid, order],
  );

  return {
    text,
    type,
    toggle,
    /** The pages to use (0-based), or null while the text is empty or not valid. */
    indices: empty ? null : reading.indices,
    /** 1-based pages to show as chosen. */
    chosen: chosenPageNumbers(lastValid),
    /** The parser's message, only once something has been typed. */
    error: empty ? null : reading.error,
    empty,
  };
}
