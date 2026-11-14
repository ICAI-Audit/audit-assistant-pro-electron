import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Archive, FileText, Image as ImageIcon, Loader2, Lock, Search, SearchX } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LIST_MAX_BYTES } from '@/lib/pdf-tools/workingList';
import { EVIDENCE_TYPES } from '../destinations';
import { formatBytes, plural } from '../format';
import { filterChoices, type VaultChoice } from '../vaultBytes';
import { DestinationFrame } from './DestinationFrame';
import { moveIndex } from './listNavigation';
import { Notice } from './ToolDialog';

export interface VaultPickerDialogProps {
  /** This engagement's vault files that PDF Tools can open. */
  choices: VaultChoice[];
  loading: boolean;
  /** Evidence ids of vault files already in the list. */
  inList: ReadonlySet<string>;
  /** Bytes the list holds now. */
  listBytes: number;
  /** Adds the chosen files (in the order shown); the dialog closes. */
  onAdd: (chosen: VaultChoice[]) => void;
  onClose: () => void;
  onReturnFocus: () => void;
}

const TYPE_LABELS: Record<string, string> = Object.fromEntries(EVIDENCE_TYPES.map((t) => [t.value, t.label]));
const optionId = (id: string) => `pdf-tools-vault-option-${id}`;
const STAGES: Record<string, string> = { draft: 'Draft', prepared: 'Prepared', reviewed: 'Reviewed', approved: 'Approved' };

function shortDate(text: string): string {
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC.
  const date = new Date(/Z|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Add from Evidence Vault: this engagement's PDFs and images, with a name search and ticks. The
 * files chosen are copied into the list through the same checks as files from the computer
 * (password-protected PDFs ask for their password); the vault files themselves are not changed.
 */
export default function VaultPickerDialog({ choices, loading, inList, listBytes, onAdd, onClose, onReturnFocus }: VaultPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const search = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => filterChoices(choices, query), [choices, query]);
  const picked = choices.filter((c) => chosen.has(c.id));
  const pickedBytes = picked.reduce((sum, c) => sum + c.size, 0);
  const shownChosen = shown.filter((c) => chosen.has(c.id)).length;
  const allShown = shown.length > 0 && shownChosen === shown.length;
  const room = Math.max(0, LIST_MAX_BYTES - listBytes);

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleShown = (on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const c of shown) {
        if (on) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });

  // The active row of the list (aria-activedescendant); it follows the search by staying in range.
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(-1);
  const [listFocused, setListFocused] = useState(false);
  const activeIndex = shown.length === 0 ? -1 : Math.min(active, shown.length - 1);
  const activeChoice = activeIndex >= 0 ? shown[activeIndex] : null;
  useEffect(() => {
    if (activeChoice) document.getElementById(optionId(activeChoice.id))?.scrollIntoView({ block: 'nearest' });
  }, [activeChoice]);
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (activeChoice) toggle(activeChoice.id, !chosen.has(activeChoice.id));
      return;
    }
    const next = moveIndex(event.key, activeIndex, shown.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <DestinationFrame
      testId="pdf-tools-vault-picker"
      icon={Archive}
      title="Add from Evidence Vault"
      description="PDFs and images in this engagement's Evidence Vault. They are copied into the list; the files in the Evidence Vault are not changed."
      size="lg"
      initialFocus={search}
      confirmLabel={picked.length > 1 ? `Add ${picked.length} files` : picked.length === 1 ? 'Add file' : 'Add files'}
      confirmTestId="pdf-tools-vault-add"
      confirmDisabled={picked.length === 0}
      footerNote={picked.length > 0 ? `${plural(picked.length, 'file')} chosen · ${formatBytes(pickedBytes)}` : null}
      onConfirm={() => picked.length > 0 && onAdd(picked)}
      onClose={onClose}
      onReturnFocus={onReturnFocus}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={search}
          type="search"
          data-testid="pdf-tools-vault-search"
          aria-label="Search the Evidence Vault by name"
          placeholder="Search by name"
          className="pl-9"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {pickedBytes > room && (
        <Notice tone="warning" title="These files may not all fit">
          The list can take {formatBytes(room)} more ({formatBytes(LIST_MAX_BYTES)} in all). Files that do not fit are not added, and you are told which.
        </Notice>
      )}

      {loading && choices.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the Evidence Vault…
        </p>
      ) : choices.length === 0 ? (
        <div data-testid="pdf-tools-vault-empty" className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
          <Archive className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No PDFs or images in this engagement's Evidence Vault yet</p>
          <p className="text-xs text-muted-foreground">Files uploaded in the Evidence Vault, or added there from PDF Tools, appear here.</p>
        </div>
      ) : shown.length === 0 ? (
        <div data-testid="pdf-tools-vault-empty" className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
          <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No file matches “{query.trim()}”</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <div className="flex items-center gap-3 border-b bg-muted/60 px-3 py-2">
            <Checkbox
              data-testid="pdf-tools-vault-select-all"
              checked={allShown ? true : shownChosen > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) => toggleShown(checked === true)}
              aria-label={allShown ? 'Clear the files shown' : `Choose all ${shown.length} files shown`}
            />
            <span className="text-xs font-medium text-muted-foreground">
              {query.trim() ? `${shown.length} of ${plural(choices.length, 'file')}` : plural(choices.length, 'file')}
            </span>
          </div>
          {/* One Tab stop: the arrow keys (and Home, End, Page Up/Down) move, Space ticks. */}
          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Evidence Vault files. Use the arrow keys to move and Space to choose."
            aria-activedescendant={activeChoice ? optionId(activeChoice.id) : undefined}
            tabIndex={0}
            data-testid="pdf-tools-vault-list"
            onKeyDown={onListKeyDown}
            onFocus={() => {
              setListFocused(true);
              if (active < 0) setActive(0);
            }}
            onBlur={() => setListFocused(false)}
            className="max-h-[min(46vh,360px)] divide-y overflow-y-auto outline-none"
          >
            {shown.map((choice, index) => {
              const on = chosen.has(choice.id);
              const isActive = index === activeIndex;
              const Kind = choice.kind === 'pdf' ? FileText : ImageIcon;
              const date = shortDate(choice.createdAt);
              return (
                <li
                  key={choice.id}
                  id={optionId(choice.id)}
                  role="option"
                  aria-selected={on}
                  data-testid="pdf-tools-vault-item"
                  data-name={choice.name}
                  data-evidence-id={choice.id}
                  data-active={isActive ? 'true' : undefined}
                  // A click ticks the row and keeps focus on the list (one Tab stop).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setActive(index);
                    toggle(choice.id, !on);
                    listRef.current?.focus();
                  }}
                  className={cn(
                    'flex cursor-pointer select-none items-center gap-3 px-3 py-2 transition-colors',
                    on ? 'bg-accent/50' : 'hover:bg-muted/40',
                    isActive && listFocused && 'relative z-[1] ring-2 ring-inset ring-ring',
                  )}
                >
                  <Checkbox tabIndex={-1} aria-hidden="true" data-testid="pdf-tools-vault-item-check" checked={on} className="pointer-events-none" />
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
                    <Kind className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground" title={choice.name}>
                      {choice.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{choice.kind === 'pdf' ? 'PDF' : 'Image'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{TYPE_LABELS[choice.fileType] ?? choice.fileType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatBytes(choice.size)}</span>
                      {date && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{date}</span>
                        </>
                      )}
                      <span className="rounded-full border px-1.5 text-[11px] leading-4">{STAGES[choice.stage] ?? choice.stage}</span>
                      {choice.locked && (
                        <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px] leading-4" title="Locked in the Evidence Vault. It can still be used here, since it is only read.">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Locked
                        </span>
                      )}
                      {inList.has(choice.id) && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 text-[11px] leading-4 text-primary">In the list</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DestinationFrame>
  );
}
