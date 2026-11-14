import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CloudOff,
  FileSignature,
  FolderArchive,
  HardDrive,
  Loader2,
  Lock,
  Paperclip,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import type { Destination, FileOrigin, WorkingFile } from '@/lib/pdf-tools/types';
import { focusAfterRemove, groupTitle, listUnits, movesToOrder, orderAfterMove, unitIds, visibleRows, type ListUnit, type VisibleRow } from './fileGroups';
import { isUnsavedResult, SENT_TONES } from './destinations';
import { formatBytes, plural } from './format';
import HintButton from './HintButton';
import Thumb from './Thumb';

const SELECT_ALL = '__select-all__';
// Compact actions so the whole selection bar fits on one line at 1280 px.
const BAR_BUTTON = 'h-8 gap-1.5 px-2.5 text-xs';

const ORIGINS: Record<FileOrigin, { label: string; icon: typeof HardDrive }> = {
  computer: { label: 'Computer', icon: HardDrive },
  vault: { label: 'Evidence Vault', icon: Archive },
  result: { label: 'Result', icon: Sparkles },
};

const SENT_LABELS: Record<Destination, string> = {
  computer: 'Saved to computer',
  download: 'Sent to download',
  vault: 'In Evidence Vault',
  'working-paper': 'On working paper',
};

type Tone = 'neutral' | 'info' | 'warning' | 'success';

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  success: 'border-success/40 bg-success/10 text-success',
};

function Tag({ tone = 'neutral', icon, children, hint }: { tone?: Tone; icon?: ReactNode; children: ReactNode; hint?: string }) {
  const tag = (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', TONES[tone])}>
      {icon}
      {children}
      {hint && <span className="sr-only">{`: ${hint}`}</span>}
    </span>
  );
  if (!hint) return tag;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tag}</TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

function FileTags({ file }: { file: WorkingFile }) {
  const tags: ReactNode[] = [];
  if (file.wasProtected && file.origin === 'result') {
    tags.push(
      <Tag key="protection" tone="info" icon={<ShieldCheck className="h-3 w-3" />} hint="Made from a password-protected file. This result has no password.">
        Protection removed
      </Tag>,
    );
  } else if (file.wasProtected) {
    tags.push(
      <Tag
        key="protection"
        tone="info"
        icon={<Lock className="h-3 w-3" />}
        hint={
          file.hasRestrictions
            ? 'Opened without a password — protection removed. The copy in this list is not protected.'
            : 'Opened with its password. The copy in this list has no password.'
        }
      >
        {file.hasRestrictions ? 'Protection removed' : 'Unlocked'}
      </Tag>,
    );
  }
  if (file.hasSignature) {
    tags.push(
      <Tag key="signed" tone="warning" icon={<FileSignature className="h-3 w-3" />} hint="Carries a digital signature. Results made from it will not carry a valid signature.">
        Signed
      </Tag>,
    );
  } else if (file.signatureInvalid) {
    tags.push(
      <Tag
        key="signed"
        icon={<FileSignature className="h-3 w-3" />}
        hint="Made from a signed file. The signature in this copy is no longer valid. The original signed file is unchanged."
      >
        Signature no longer valid
      </Tag>,
    );
  }
  if (file.sharedResourcesKept) {
    tags.push(
      <Tag
        key="resources-kept"
        tone="warning"
        icon={<TriangleAlert className="h-3 w-3" />}
        hint="Some pages could not be read with certainty, so everything they could draw with was kept. The file may still contain images or fonts from pages that were left out."
      >
        May hold left-out pages&apos; images
      </Tag>,
    );
  }
  if (file.origin === 'result') {
    if (file.sentTo.length === 0) {
      tags.push(
        <Tag key="unsaved" tone="warning" icon={<CloudOff className="h-3 w-3" />} hint="This result exists only in this list until you save it somewhere.">
          Not saved
        </Tag>,
      );
    }
    for (const destination of file.sentTo) {
      tags.push(
        <Tag
          key={destination}
          tone={SENT_TONES[destination]}
          hint={
            destination === 'vault' && file.vaultRecord
              ? `In this engagement's Evidence Vault as ${file.vaultRecord.name}.`
              : destination === 'download'
                ? 'Handed to a download because no save dialog was available. PDF Tools cannot see whether it was saved, or where.'
                : undefined
          }
        >
          {SENT_LABELS[destination]}
        </Tag>,
      );
    }
  }
  return <>{tags}</>;
}

function describe(file: WorkingFile): string {
  if (file.kind === 'image') return `Image, ${file.mimeType === 'image/png' ? 'PNG' : 'JPG'}`;
  return file.pageCount === null ? 'PDF' : plural(file.pageCount, 'page');
}

/** "12 PNG images", "3 PDFs, 21 pages" for a group row. */
function describeGroup(files: WorkingFile[]): string {
  if (files.every((f) => f.kind === 'image')) {
    const types = new Set(files.map((f) => (f.mimeType === 'image/png' ? 'PNG' : 'JPG')));
    return `${files.length} ${types.size === 1 ? `${[...types][0]} ` : ''}images`;
  }
  const pages = files.reduce((sum, f) => sum + (f.pageCount ?? 0), 0);
  return `${plural(files.length, 'PDF')}, ${plural(pages, 'page')}`;
}

/** Alt+ArrowUp/Down moves a row or group. VERA Tools also uses Alt+Arrow (on window) to change tab. */
function moveKey(event: KeyboardEvent<HTMLElement>, move: (direction: 'up' | 'down') => void): void {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
  event.preventDefault();
  event.stopPropagation();
  move(event.key === 'ArrowUp' ? 'up' : 'down');
}

interface MoveButtonsProps {
  name: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: 'up' | 'down') => void;
}

function MoveButtons({ name, isFirst, isLast, onMove }: MoveButtonsProps) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-action="up"
            disabled={isFirst}
            aria-label={`Move ${name} up`}
            onClick={() => onMove('up')}
          >
            <ArrowUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">Move up (Alt+↑)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-action="down"
            disabled={isLast}
            aria-label={`Move ${name} down`}
            onClick={() => onMove('down')}
          >
            <ArrowDown />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">Move down (Alt+↓)</TooltipContent>
      </Tooltip>
    </>
  );
}

function RemoveButton({ name, onRemove, hint = 'Remove from the list' }: { name: string; onRemove: () => void; hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          data-action="remove"
          aria-label={`Remove ${name} from the list`}
          onClick={onRemove}
        >
          <X />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

interface RowProps {
  file: WorkingFile;
  /** The number shown at the left: the row's place in the list, or in its group. */
  position: number;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
  /** A file shown inside an open group: it moves with its group, not on its own. */
  member?: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onMove: (key: string, direction: 'up' | 'down') => void;
  onRemove: (id: string) => void;
}

// Memoised with stable handlers: a change to one row (or a thumbnail arriving) does not redraw the others.
const FileRow = memo(function FileRow({ file, position, isFirst, isLast, selected, member = false, onToggle, onMove, onRemove }: RowProps) {
  const origin = ORIGINS[file.origin];
  const checkId = `pdf-tools-check-${file.id}`;
  // A file inside a group moves with its group; the keys are still kept from VERA Tools' tab shortcut.
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) =>
    moveKey(event, (direction) => {
      if (!member) onMove(file.id, direction);
    });

  return (
    <li
      data-testid="pdf-tools-row"
      data-origin={file.origin}
      data-name={file.name}
      data-row-id={file.id}
      data-member={member ? 'true' : undefined}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-3 py-2 pr-3 transition-colors sm:pr-4', member ? 'pl-12 sm:pl-14' : 'pl-3 sm:pl-4', selected ? 'bg-accent/50' : 'hover:bg-muted/40')}
    >
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
        {position}
      </span>
      <Checkbox
        id={checkId}
        data-testid="pdf-tools-row-check"
        checked={selected}
        onCheckedChange={(checked) => onToggle(file.id, checked === true)}
        aria-label={`Select ${file.name}`}
      />
      <Thumb file={file} width={38} alt={file.kind === 'pdf' ? `First page of ${file.name}` : `Preview of ${file.name}`} className="h-[50px]" />
      <label htmlFor={checkId} className="min-w-0 flex-1 cursor-pointer select-none">
        <span className="block truncate text-sm font-medium text-foreground" title={file.name}>
          {file.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <origin.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {origin.label}
          </span>
          <span aria-hidden="true">·</span>
          <span>{describe(file)}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatBytes(file.size)}</span>
          <FileTags file={file} />
        </span>
      </label>
      <div className="flex shrink-0 items-center gap-0.5">
        {!member && <MoveButtons name={file.name} isFirst={isFirst} isLast={isLast} onMove={(direction) => onMove(file.id, direction)} />}
        <RemoveButton name={file.name} onRemove={() => onRemove(file.id)} />
      </div>
    </li>
  );
});

interface GroupRowProps {
  unit: Extract<ListUnit, { kind: 'group' }>;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  /** How many of the group's files are selected. */
  selectedCount: number;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleGroup: (groupId: string, checked: boolean) => void;
  onExpand: (groupId: string) => void;
  onMove: (key: string, direction: 'up' | 'down') => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (groupId: string) => void;
}

/** One row for results that belong together; it opens to show them. */
const GroupRow = memo(function GroupRow({
  unit,
  position,
  isFirst,
  isLast,
  expanded,
  selectedCount,
  selectedIds,
  onToggle,
  onToggleGroup,
  onExpand,
  onMove,
  onRemove,
  onRemoveGroup,
}: GroupRowProps) {
  const { files, groupId, key } = unit;
  const { title, range } = groupTitle(files);
  const listId = `pdf-tools-group-${groupId}`;
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const unsaved = files.filter((f) => f.origin === 'result' && f.sentTo.length === 0).length;
  // Where every file of the group has been sent (the rows inside say it for each one).
  const sharedDestinations = (Object.keys(SENT_LABELS) as Destination[]).filter((d) => files.every((f) => f.sentTo.includes(d)));
  const all = selectedCount === files.length;
  const origin = ORIGINS[files[0].origin];

  return (
    <li data-testid="pdf-tools-group" data-row-id={key} data-group-id={groupId} data-count={files.length}>
      <div
        onKeyDown={(event) => moveKey(event, (direction) => onMove(key, direction))}
        className={cn('flex items-center gap-3 px-3 py-2 transition-colors sm:px-4', all ? 'bg-accent/50' : 'hover:bg-muted/40')}
      >
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {position}
        </span>
        <Checkbox
          data-testid="pdf-tools-group-check"
          checked={all ? true : selectedCount > 0 ? 'indeterminate' : false}
          onCheckedChange={(checked) => onToggleGroup(groupId, checked === true)}
          aria-label={`Select all ${files.length} files of ${title}`}
        />
        <button
          type="button"
          data-action="expand"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          title={range}
          onClick={() => onExpand(groupId)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="relative shrink-0" aria-hidden="true">
            <span className="absolute -right-1 -top-1 h-[50px] w-[38px] rounded border bg-muted" />
            <Thumb file={files[0]} width={38} alt="" className="relative h-[50px] bg-card" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              <span className="truncate text-sm font-medium text-foreground">{title}</span>
              <span className="sr-only">{expanded ? ', open' : ', closed'}. {range}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <origin.icon className="h-3.5 w-3.5" />
                {origin.label}
              </span>
              <span>·</span>
              <span>{describeGroup(files)}</span>
              <span>·</span>
              <span className="tabular-nums">{formatBytes(size)}</span>
              {files.some((f) => f.wasProtected) && (
                <Tag tone="info" icon={<ShieldCheck className="h-3 w-3" />}>
                  Protection removed
                </Tag>
              )}
              {unsaved > 0 && (
                <Tag tone="warning" icon={<CloudOff className="h-3 w-3" />}>
                  {unsaved === files.length ? 'Not saved' : `${unsaved} not saved`}
                </Tag>
              )}
              {sharedDestinations.map((destination) => (
                <Tag key={destination} tone={SENT_TONES[destination]}>
                  {files.length > 1 ? `All ${SENT_LABELS[destination].charAt(0).toLowerCase()}${SENT_LABELS[destination].slice(1)}` : SENT_LABELS[destination]}
                </Tag>
              ))}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <MoveButtons name={title} isFirst={isFirst} isLast={isLast} onMove={(direction) => onMove(key, direction)} />
          <RemoveButton name={`all ${files.length} files of ${title}`} hint="Remove the whole group from the list" onRemove={() => onRemoveGroup(groupId)} />
        </div>
      </div>
      {expanded && (
        <ul id={listId} aria-label={`Files of ${title}`} className="divide-y border-t bg-muted/20">
          {files.map((file, i) => (
            <FileRow
              key={file.id}
              file={file}
              position={i + 1}
              isFirst
              isLast
              member
              selected={selectedIds.has(file.id)}
              onToggle={onToggle}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

export interface FileListProps {
  files: WorkingFile[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onRemove: (ids: string[]) => void;
  saving: boolean;
  onSaveToComputer: (asZip: boolean) => void;
  onSendToVault: () => void;
  onAttachToWorkingPaper: () => void;
  /** Why the destination cannot be used now (for example "This engagement has no audit programme yet"); null when it can. */
  vaultHint?: string | null;
  attachHint?: string | null;
  /** The destination button whose vault check is taking a while: it shows a spinner and takes no second click. */
  checking?: 'vault' | 'attach' | null;
  /** Scrolls the row holding this file into view (its group row while the group is closed). */
  reveal?: { id: string; token: number } | null;
  /** Where focus goes when removing rows emptied the list (this component is then gone). */
  onListEmptied?: () => void;
}

export default function FileList({
  files,
  selectedIds,
  onSelectionChange,
  onMove,
  onRemove,
  saving,
  onSaveToComputer,
  onSendToVault,
  onAttachToWorkingPaper,
  vaultHint = null,
  attachHint = null,
  checking = null,
  reveal,
  onListEmptied,
}: FileListProps) {
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const refocus = useRef<{ key: string; direction: 'up' | 'down' } | null>(null);
  // After rows are removed: the next row's remove button, else the previous row's, else select-all.
  const removeFocus = useRef<VisibleRow | typeof SELECT_ALL | null>(null);
  // The confirmation is opened from state, with no trigger, so Radix has nowhere to return focus:
  // it is done here. `opener` is the control that asked; `removedByConfirm` says whether the rows
  // went; `holdFocus` keeps the list from moving focus while the confirmation (which traps focus)
  // is still open or closing.
  const opener = useRef<HTMLElement | null>(null);
  const removedByConfirm = useRef(false);
  const holdFocus = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const selectAllRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [stickTop, setStickTop] = useState(0);
  const units = useMemo(() => listUnits(files), [files]);

  // A sticky bar stops at the scrolling box's padding edge; pull it up by that padding so rows do
  // not show through the gap above it.
  useLayoutEffect(() => {
    let box = barRef.current?.parentElement ?? null;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (box) setStickTop(-(parseFloat(getComputedStyle(box).paddingTop) || 0));
  }, []);

  // Kept between renders, so memoised group rows redraw only when the selection changes.
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = selectedIds.length;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const allSelected = files.length > 0 && selectedCount === files.length;
  const nothingSelected = selectedCount === 0;

  // The rows get stable handlers; these read the latest props through a ref.
  const latest = useRef({ files, units, expanded, selectedIds, onSelectionChange, onMove, onRemove, onListEmptied });
  latest.current = { files, units, expanded, selectedIds, onSelectionChange, onMove, onRemove, onListEmptied };

  // The row (or group row) on screen that holds a file.
  const rowFor = useCallback((ids: string[]): HTMLElement | null => {
    const list = listRef.current;
    if (!list) return null;
    for (const id of ids) {
      const row = list.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
      if (row) return row;
      const unit = listUnits(latest.current.files).find((u) => unitIds(u).includes(id));
      const holder = unit && list.querySelector<HTMLElement>(`[data-row-id="${unit.key}"]`);
      if (holder) return holder;
    }
    return null;
  }, []);

  // After a move, keep focus on the moved row's control (React may move the row's DOM node).
  useLayoutEffect(() => {
    const pending = refocus.current;
    if (!pending || !listRef.current) return;
    refocus.current = null;
    const row = listRef.current.querySelector<HTMLElement>(`[data-row-id="${pending.key}"]`);
    const same = row?.querySelector<HTMLButtonElement>(`[data-action="${pending.direction}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`[data-action="${pending.direction === 'up' ? 'down' : 'up'}"]`);
    (same && !same.disabled ? same : other)?.focus();
  }, [files]);

  const focusRemoveTarget = useCallback(() => {
    const target = removeFocus.current;
    if (!target) return;
    removeFocus.current = null;
    const row = target === SELECT_ALL ? null : (listRef.current?.querySelector<HTMLElement>(`[data-row-id="${target.key}"]`) ?? rowFor(target.ids));
    const button = row?.querySelector<HTMLButtonElement>('[data-action="remove"]') ?? selectAllRef.current;
    // The list may be gone altogether (its last rows were removed): the screen decides then.
    if (button?.isConnected) button.focus();
    else latest.current.onListEmptied?.();
  }, [rowFor]);

  // Not while a confirmation is open or closing: it traps focus, and would take it back.
  useLayoutEffect(() => {
    if (!holdFocus.current) focusRemoveTarget();
  }, [files, focusRemoveTarget]);

  // After a run, show its results: the row, or the group row that holds them. 'nearest' scrolls only
  // the screen's own scroll box; 'center' would also shift the app's fixed layout to centre a last row.
  useLayoutEffect(() => {
    if (!reveal) return;
    rowFor([reveal.id])?.scrollIntoView({ block: 'nearest' });
  }, [reveal, rowFor]);

  const removeNow = useCallback((ids: string[]) => {
    const { units: current, expanded: open } = latest.current;
    removeFocus.current = focusAfterRemove(visibleRows(current, open), ids) ?? SELECT_ALL;
    latest.current.onRemove(ids);
  }, []);

  const requestRemove = useCallback(
    (ids: string[]) => {
      // A result only handed to a download counts as unsaved too: its completion cannot be seen.
      const unsaved = latest.current.files.filter((f) => ids.includes(f.id) && isUnsavedResult(f));
      if (unsaved.length > 0) {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        holdFocus.current = true;
        setConfirming(ids);
      } else {
        removeNow(ids);
      }
    },
    [removeNow],
  );

  const changeSelection = useCallback((ids: string[], checked: boolean) => {
    const { selectedIds: current, onSelectionChange: change } = latest.current;
    const affected = new Set(ids);
    change(checked ? [...current.filter((x) => !affected.has(x)), ...ids] : current.filter((x) => !affected.has(x)));
  }, []);

  const toggle = useCallback((id: string, checked: boolean) => changeSelection([id], checked), [changeSelection]);

  const toggleGroup = useCallback(
    (groupId: string, checked: boolean) => {
      const unit = latest.current.units.find((u) => u.kind === 'group' && u.groupId === groupId);
      if (unit) changeSelection(unitIds(unit), checked);
    },
    [changeSelection],
  );

  const expand = useCallback((groupId: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // A row moves past a whole group, and a group moves as one: done as single-place moves in the store.
  const move = useCallback((key: string, direction: 'up' | 'down') => {
    const { files: current, onMove: moveOne } = latest.current;
    const target = orderAfterMove(current, key, direction);
    if (!target) return;
    refocus.current = { key, direction };
    for (const step of movesToOrder(current.map((f) => f.id), target)) moveOne(step.id, step.direction);
  }, []);

  const removeOne = useCallback((id: string) => requestRemove([id]), [requestRemove]);

  const removeGroup = useCallback(
    (groupId: string) => {
      const unit = latest.current.units.find((u) => u.kind === 'group' && u.groupId === groupId);
      if (unit) requestRemove(unitIds(unit));
    },
    [requestRemove],
  );

  const unsavedInConfirm = confirming ? files.filter((f) => confirming.includes(f.id) && isUnsavedResult(f)).length : 0;
  const downloadOnlyInConfirm = confirming ? files.filter((f) => confirming.includes(f.id) && isUnsavedResult(f) && f.sentTo.length > 0).length : 0;
  // Why each destination is unavailable, or null. A reason from the screen (no programme) comes first.
  const CHECKING = 'Checking the Evidence Vault…';
  const vaultBlock = checking === 'vault' ? CHECKING : (vaultHint ?? (nothingSelected ? 'Select the results to add.' : null));
  const attachBlock = checking === 'attach' ? CHECKING : (attachHint ?? (nothingSelected ? 'Select the results to attach.' : null));

  return (
    // overflow-clip (not hidden) keeps the rounded corners without making the card a scroll box, so
    // the selection bar can stay in view while the screen scrolls.
    <section aria-label="Files" className="overflow-clip rounded-lg border bg-card shadow-sm">
      <div ref={barRef} style={{ top: stickTop }} className="sticky z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted px-3 py-1.5 sm:px-4">
        <div className="flex items-center gap-3">
          <Checkbox
            ref={selectAllRef}
            checked={allSelected ? true : nothingSelected ? false : 'indeterminate'}
            onCheckedChange={(checked) => onSelectionChange(checked === true ? files.map((f) => f.id) : [])}
            aria-label={allSelected ? 'Clear the selection' : 'Select all files'}
          />
          <p className="text-sm">
            <span className="font-medium text-foreground">{nothingSelected ? plural(files.length, 'file') : `${selectedCount} of ${files.length} selected`}</span>
            <span className={cn('ml-2 text-xs tabular-nums', totalSize > LIST_WARN_BYTES ? 'text-warning' : 'text-muted-foreground')}>
              {formatBytes(totalSize)} of {formatBytes(LIST_MAX_BYTES)}
            </span>
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <HintButton
            type="button"
            variant="ghost"
            size="sm"
            enabled={!nothingSelected}
            className={BAR_BUTTON}
            hint="Select the files to remove from the list."
            onClick={() => requestRemove(selectedIds)}
          >
            <Trash2 />
            Remove
          </HintButton>

          <div className="flex items-center">
            <HintButton
              type="button"
              variant="outline"
              size="sm"
              data-testid="pdf-tools-dest-computer"
              className={cn(BAR_BUTTON, 'rounded-r-none')}
              enabled={!nothingSelected && !saving}
              hint={saving ? 'Saving…' : 'Select the files to save.'}
              onClick={() => onSaveToComputer(false)}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? 'Saving…' : 'Save to computer'}
            </HintButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="pdf-tools-dest-computer-more"
                  className="h-8 rounded-l-none border-l-0 px-1.5"
                  disabled={selectedCount < 2 || saving}
                  aria-label="More ways to save"
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onSaveToComputer(true)}>
                  <FolderArchive className="mr-2 h-4 w-4" />
                  Save as one zip (for emailing)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <HintButton
            type="button"
            variant="outline"
            size="sm"
            data-testid="pdf-tools-dest-vault"
            className={BAR_BUTTON}
            enabled={vaultBlock === null}
            hint={vaultBlock ?? 'Select the results to add.'}
            aria-busy={checking === 'vault' || undefined}
            onClick={onSendToVault}
          >
            {checking === 'vault' ? <Loader2 className="animate-spin" /> : <Archive />}
            Add to Evidence Vault
          </HintButton>
          <HintButton
            type="button"
            variant="outline"
            size="sm"
            data-testid="pdf-tools-dest-working-paper"
            className={BAR_BUTTON}
            enabled={attachBlock === null}
            hint={attachBlock ?? 'Select the results to attach.'}
            aria-busy={checking === 'attach' || undefined}
            onClick={onAttachToWorkingPaper}
          >
            {checking === 'attach' ? <Loader2 className="animate-spin" /> : <Paperclip />}
            Attach to working paper
          </HintButton>
        </div>
      </div>

      <ul ref={listRef} aria-label="Files in the list" className="divide-y">
        {units.map((unit, index) =>
          unit.kind === 'file' ? (
            <FileRow
              key={unit.key}
              file={unit.file}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === units.length - 1}
              selected={selected.has(unit.file.id)}
              onToggle={toggle}
              onMove={move}
              onRemove={removeOne}
            />
          ) : (
            <GroupRow
              key={unit.key}
              unit={unit}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === units.length - 1}
              expanded={expanded.has(unit.groupId)}
              selectedCount={unit.files.filter((f) => selected.has(f.id)).length}
              selectedIds={selected}
              onToggle={toggle}
              onToggleGroup={toggleGroup}
              onExpand={expand}
              onMove={move}
              onRemove={removeOne}
              onRemoveGroup={removeGroup}
            />
          ),
        )}
      </ul>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Radix would focus a trigger, and there is none. After Remove, focus goes to the next row
            // (chosen when the rows were removed); after Keep or Escape, back to the control that asked.
            event.preventDefault();
            holdFocus.current = false;
            const back = opener.current;
            opener.current = null;
            if (removedByConfirm.current) {
              removedByConfirm.current = false;
              focusRemoveTarget();
            } else if (back?.isConnected) {
              back.focus();
            } else {
              selectAllRef.current?.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {unsavedInConfirm === 1 ? 'an unsaved result' : `${unsavedInConfirm} unsaved results`}?</AlertDialogTitle>
            <AlertDialogDescription>
              {unsavedInConfirm === 1 ? 'This result has' : 'These results have'} not been saved anywhere PDF Tools can confirm and will be lost
              {downloadOnlyInConfirm > 0 ? ' (a download was started, but whether it was kept cannot be seen)' : ''}. Files in the Evidence Vault are never
              affected by removing them from this list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirming) {
                  removedByConfirm.current = true;
                  removeNow(confirming);
                }
                setConfirming(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
