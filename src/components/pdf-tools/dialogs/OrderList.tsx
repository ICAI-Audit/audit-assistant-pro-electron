// "In this order": the files of Merge or Images to PDF as the run will take them, with a pair of arrows
// per row and Alt + Up / Alt + Down to change the order inside the dialog (UX audit C6.7, T2-6; the logic
// is fileOrder.ts). Each move is read out politely ("Three.pdf moved to position 1 of 2."), and the focus
// stays on the moved row's arrow, as it does in the file list. No tooltip layer: inside a dialog it would
// take Escape; the arrows' names and the line under the list say what they do.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import MiddleName from '../MiddleName';
import { focusAfterMove, moveOne, orderAnnouncement, orderMoveKey, type OrderMove } from './fileOrder';

/** Two polite regions taking turns, so the same sentence is read out again (as Organise pages does). */
function Announcer({ text, count }: { text: string; count: number }) {
  const odd = count % 2 === 1;
  return (
    <div className="sr-only" data-testid="pdf-tools-order-announce" data-count={count}>
      <p role="status" aria-live="polite" aria-atomic="true">
        {odd ? text : ''}
      </p>
      <p role="status" aria-live="polite" aria-atomic="true">
        {odd ? '' : text}
      </p>
    </div>
  );
}

export interface OrderListProps {
  files: WorkingFile[];
  onChange: (files: WorkingFile[]) => void;
  /** The heading above the list, for example "In this order". */
  label: ReactNode;
  /** Test id of the list (kept from phase 1: `pdf-tools-merge-order`, `pdf-tools-image-order`). */
  testId: string;
  /** The icon or thumbnail at the start of a row. */
  leading: (file: WorkingFile) => ReactNode;
  /** The short facts at the end of a row (pages, size). */
  meta: (file: WorkingFile) => ReactNode;
  className?: string;
}

export default function OrderList({ files, onChange, label, testId, leading, meta, className }: OrderListProps) {
  const id = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [said, setSaid] = useState({ text: '', count: 0 });
  // The row and arrow to focus once the moved row is drawn in its new place (React may move its node).
  const refocus = useRef<{ fileId: string; arrow: OrderMove } | null>(null);
  const movable = files.length > 1;

  const say = (text: string) => setSaid((s) => ({ text, count: s.count + 1 }));

  const move = (index: number, direction: OrderMove) => {
    const file = files[index];
    const next = moveOne(files, index, direction);
    if (!file) return;
    if (!next) {
      say(orderAnnouncement(file.name, { moved: false, position: index + 1, total: files.length }));
      return;
    }
    const at = direction === 'up' ? index - 1 : index + 1;
    refocus.current = { fileId: file.id, arrow: focusAfterMove(direction, at, files.length) };
    onChange(next);
    say(orderAnnouncement(file.name, { moved: true, position: at + 1, total: files.length }));
  };

  useLayoutEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    refocus.current = null;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-order-id]') ?? []).find((r) => r.dataset.orderId === pending.fileId);
    row?.querySelector<HTMLButtonElement>(`[data-action="${pending.arrow}"]`)?.focus();
  }, [files]);

  const onRowKey = (index: number) => (event: KeyboardEvent<HTMLLIElement>) => {
    const direction = orderMoveKey(event);
    if (!direction || !movable) return;
    // The dialog's own key: acted on here; the frame's guard then keeps it from VERA Tools' tab shortcut.
    event.preventDefault();
    if (!event.repeat || moveOne(files, index, direction)) move(index, direction);
  };

  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-sm font-medium leading-none">
        {label}
      </p>
      <ol
        ref={listRef}
        aria-labelledby={`${id}-label`}
        aria-describedby={movable ? `${id}-hint` : undefined}
        className={cn('max-h-[220px] divide-y overflow-y-auto rounded-md border', className)}
        data-testid={testId}
      >
        {files.map((file, i) => (
          <li
            key={file.id}
            data-testid="pdf-tools-order-row"
            data-order-id={file.id}
            data-name={file.name}
            onKeyDown={onRowKey(i)}
            className="flex items-center gap-2.5 py-1 pl-3 pr-1.5 text-sm"
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
              {i + 1}
            </span>
            {leading(file)}
            <MiddleName name={file.name} className="flex-1" />
            <span className="shrink-0 text-xs text-muted-foreground">{meta(file)}</span>
            {movable && (
              <span className="flex shrink-0 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  data-action="up"
                  data-testid="pdf-tools-order-up"
                  disabled={i === 0}
                  aria-label={`Move ${file.name} up`}
                  aria-keyshortcuts="Alt+ArrowUp"
                  onClick={() => move(i, 'up')}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  data-action="down"
                  data-testid="pdf-tools-order-down"
                  disabled={i === files.length - 1}
                  aria-label={`Move ${file.name} down`}
                  aria-keyshortcuts="Alt+ArrowDown"
                  onClick={() => move(i, 'down')}
                >
                  <ArrowDown />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {movable && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground" data-testid="pdf-tools-order-hint">
          Change the order with the arrows, or with Alt+↑ and Alt+↓ on a row.
        </p>
      )}
      <Announcer text={said.text} count={said.count} />
    </div>
  );
}
