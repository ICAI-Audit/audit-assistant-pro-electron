// The page viewer's find box, as people know it from any reader: one box, the count, previous and next,
// close. Enter and Shift + Enter move through the matches; Escape closes the box first and the viewer
// second (PageViewer). It floats over the top right of the page, or the bottom right when the current
// match would be under it, so opening it never changes the page's size.
//
// The typed words may be confidential: the field is wiped as it leaves the screen (its value and value
// attribute), and its ref is made outside the component so that React's leftover reference to a
// removed field leads to the node only (as the Protect dialog does; React DOM keeps the last focused
// field until the next focus change).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ViewerSearchModel } from './useViewerSearch';
import { searchCount, searchNotes, SEARCH_HELP } from './viewerSearch';

const UNAVAILABLE = 'cursor-not-allowed opacity-50 hover:bg-transparent';

/** A callback ref that records the field in `nodes`, to be wiped. Made outside the component on purpose. */
function fieldRef(nodes: Set<HTMLInputElement>, also: { current: HTMLInputElement | null }) {
  return (node: HTMLInputElement | null) => {
    also.current = node;
    if (node) nodes.add(node);
  };
}

export interface SearchBarProps {
  search: ViewerSearchModel;
  placement: 'top' | 'bottom';
  /** The viewer's tooltip (so that Escape on a tooltip closes the box, not only the tooltip). */
  tip: (text: string, child: ReactElement) => ReactElement;
  onClose: () => void;
  barRef?: Ref<HTMLDivElement>;
}

export default function SearchBar({ search, placement, tip, onClose, barRef }: SearchBarProps) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const ids = useId();
  const [field] = useState(() => {
    const nodes = new Set<HTMLInputElement>();
    return { nodes, ref: fieldRef(nodes, input) };
  });
  useLayoutEffect(
    () => () => {
      for (const node of field.nodes) {
        node.value = '';
        node.removeAttribute('value');
      }
      field.nodes.clear();
    },
    [field],
  );

  // Focus on opening, and on Ctrl + F while open: the words typed are selected, ready to replace.
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [search.focusRequest]);

  const state = search.state;
  const count = search.typed && state ? searchCount(state) : '';
  const notes = search.typed && state ? searchNotes(state) : [];
  const line = search.typed ? notes.join(' ') : SEARCH_HELP;
  const why = !search.typed ? 'Type what to find first.' : !state || state.found === 0 ? (state && state.status === 'reading' ? 'Still searching.' : 'There are no matches.') : null;

  const moveButton = (back: boolean) => {
    const label = back ? 'Previous match' : 'Next match';
    return tip(
      why ? `${label}: ${why}` : `${label} (${back ? 'Shift + Enter' : 'Enter'})`,
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('h-7 w-7 shrink-0', why && UNAVAILABLE)}
        data-testid={back ? 'pdf-tools-viewer-search-prev' : 'pdf-tools-viewer-search-next'}
        aria-label={label}
        aria-disabled={why ? true : undefined}
        aria-describedby={why ? `${ids}-why` : undefined}
        onClick={() => {
          if (!why) (back ? search.prev : search.next)();
        }}
      >
        {back ? <ChevronUp /> : <ChevronDown />}
      </Button>,
    );
  };

  return (
    <div
      ref={barRef}
      role="search"
      data-viewer-no-pan
      data-testid="pdf-tools-viewer-search"
      data-placement={placement}
      className={cn(
        'absolute right-5 z-20 w-[min(440px,calc(100%-2.5rem))] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg',
        placement === 'top' ? 'top-3' : 'bottom-3',
      )}
    >
      <div className="flex items-center gap-1">
        <Search className="ml-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          key="search-field"
          ref={field.ref}
          type="text"
          value={text}
          placeholder="Find in this file"
          aria-label="Find in this file"
          aria-describedby={`${ids}-count ${ids}-line`}
          autoComplete="off"
          spellCheck={false}
          data-testid="pdf-tools-viewer-search-input"
          onChange={(event) => {
            setText(event.target.value);
            search.setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter while a Hindi (or any) input method is still composing belongs to it.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            search.submit(event.shiftKey);
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span id={`${ids}-count`} data-testid="pdf-tools-viewer-search-count" className="min-w-[4.75rem] shrink-0 px-1 text-right text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
        {moveButton(true)}
        {moveButton(false)}
        {tip(
          'Close search (Esc)',
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="pdf-tools-viewer-search-close" aria-label="Close search" onClick={onClose}>
            <X />
          </Button>,
        )}
      </div>
      {line && (
        <p id={`${ids}-line`} data-testid="pdf-tools-viewer-search-note" className="px-1.5 pb-0.5 pt-1 text-[11px] leading-snug text-muted-foreground">
          {line}
        </p>
      )}
      {why && (
        <span id={`${ids}-why`} className="sr-only">
          {why}
        </span>
      )}
    </div>
  );
}
