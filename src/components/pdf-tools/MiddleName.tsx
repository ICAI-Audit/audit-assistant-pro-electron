import { cn } from '@/lib/utils';
import { nameEnds } from './format';

/**
 * A file name that keeps its end in view when the space is short (QA-FIX G): the start is cut with "…",
 * the last words stay ("Synthetic M-s Gamma Traders Pr…final copy v3 revised.pdf"). The whole name is the
 * hover title and, as the element's text, what a screen reader reads.
 */
export default function MiddleName({ name, className, title = true }: { name: string; className?: string; title?: boolean }) {
  const { head, tail } = nameEnds(name);
  return (
    <span className={cn('flex min-w-0 overflow-hidden', className)} title={title ? name : undefined}>
      <span className="min-w-0 truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}
