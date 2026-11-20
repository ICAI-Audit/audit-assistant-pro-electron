import { memo, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
  Maximize2,
  MessageSquareText,
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
import { LIST_MAX_BYTES, LIST_WARN_BYTES, listHeldBytes, viewableFile } from '@/lib/pdf-tools/workingList';
import type { Destination, FileOrigin, WorkingFile } from '@/lib/pdf-tools/types';
import { focusAfterRemove, groupTitle, listUnits, movesToOrder, orderAfterMove, unitIds, visibleRows, type ListUnit, type VisibleRow } from './fileGroups';
import { carriedGroupLabel, carriedTagLabel } from './carriedNotice';
import { isUnsavedResult, SENT_TONES } from './destinations';
import { formatBytes, plural, unsavedLine, unsavedWarning } from './format';
import { convertedNote } from './intake';
import HintButton from './HintButton';
import MiddleName from './MiddleName';
import { isOfficeFile, officeInfo } from './officeFiles';
import { focusQuietly } from './quietFocus';
import Thumb from './Thumb';
import QuietTip from './viewer/QuietTip';
import { WhyContext } from './whyLine';
import { useDialogKeys } from './useDialogKeys';

const SELECT_ALL = '__select-all__';
// Compact actions so the whole selection bar fits on one line at 1280 px.
const BAR_BUTTON = 'h-8 gap-1.5 px-2.5 text-xs';

const ORIGINS: Record<FileOrigin, { label: string; icon: typeof HardDrive }> = {
  computer: { label: 'Computer', icon: HardDrive },
  vault: { label: 'Evidence Vault', icon: Archive },
  result: { label: 'Result', icon: Sparkles },
};

// The badge says what the toast said (UX audit C10): "Saved to computer", "Download started".
const SENT_LABELS: Record<Destination, string> = {
  computer: 'Saved to computer',
  download: 'Download started',
  vault: 'In Evidence Vault',
  'working-paper': 'On working paper',
};

type Tone = 'neutral' | 'info' | 'warning' | 'success';

// Badge text is always the normal text colour (UX audit C3.2: coloured text on its own tint measured
// 2.4:1 for amber and 3.3:1 for green); the tint, the border and the icon carry the tone.
const TONES: Record<Tone, { box: string; icon: string }> = {
  neutral: { box: 'border-border bg-muted', icon: 'text-muted-foreground' },
  info: { box: 'border-primary/30 bg-primary/10', icon: 'text-primary' },
  warning: { box: 'border-warning/40 bg-warning/10', icon: 'text-warning' },
  success: { box: 'border-success/40 bg-success/10', icon: 'text-success' },
};

function Tag({ tone = 'neutral', icon, children, hint, testId }: { tone?: Tone; icon?: ReactNode; children: ReactNode; hint?: string; testId?: string }) {
  const tag = (
    <span data-testid={testId} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 text-foreground', TONES[tone].box)}>
      {icon && (
        <span className={cn('inline-flex', TONES[tone].icon)} aria-hidden="true">
          {icon}
        </span>
      )}
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
  if (file.protectedOutput) {
    // A result of Protect (design 5.18): it opens only with the password just set.
    tags.push(
      <Tag key="protection" tone="info" icon={<Lock className="h-3 w-3" />} testId="pdf-tools-file-protected" hint="Opens only with the password you set. VERA does not keep it.">
        Protected
      </Tag>,
    );
  } else if (file.wasProtected && file.origin !== 'result') {
    // The file in hand (QA-FIX E): a file that opened without a password had restrictions, not a password.
    // A result never has either; that a source had one is in its record ("protection removed").
    tags.push(
      <Tag
        key="protection"
        tone="info"
        icon={file.hasRestrictions ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        hint={
          file.hasRestrictions
            ? 'It opens without a password but restricts things such as copying or printing. The copy in this list has no restrictions.'
            : 'Opened with its password. The copy in this list has no password.'
        }
      >
        {file.hasRestrictions ? 'Restrictions removed' : 'Unlocked'}
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
        hint="Some pages could not be read with certainty, so everything they could draw with was kept. The file may still contain images or fonts from pages that were removed."
      >
        May contain traces of removed pages
      </Tag>,
    );
  }
  // What a result still carries besides its pages (QA-FIX A): one short label, only when there is any.
  const carried = file.origin === 'result' ? carriedTagLabel(file.carried) : null;
  if (carried) {
    tags.push(
      <Tag key="carried" icon={<MessageSquareText className="h-3 w-3" />} testId="pdf-tools-file-carried">
        {carried}
      </Tag>,
    );
  }
  if (file.origin === 'result') {
    if (file.sentTo.length === 0) {
      tags.push(
        <Tag key="unsaved" icon={<CloudOff className="h-3 w-3" />} hint="This result exists only in this list until you save it somewhere.">
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
                ? 'A download was started, because no save dialog was available. PDF Tools cannot tell if it was kept, or where.'
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

/**
 * "More ways to save" (UX audit C4.3): unavailable, it stays focusable and says why on hover, on focus
 * and on a click (tooltip and the line under the toolbar), as the other destinations do.
 */
function ZipChevron({ blocked }: { blocked: string | null }) {
  const [tip, setTip] = useState(false);
  const sayWhy = useContext(WhyContext);
  const stop = (event: { preventDefault: () => void }) => {
    if (!blocked) return false;
    event.preventDefault();
    setTip(true);
    sayWhy?.(blocked);
    return true;
  };
  return (
    <Tooltip open={Boolean(blocked) && tip} onOpenChange={setTip}>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="pdf-tools-dest-computer-more"
            data-enabled={blocked ? 'false' : 'true'}
            aria-disabled={blocked ? true : undefined}
            className={cn('h-8 rounded-l-none border-l-0 px-1.5', blocked && 'cursor-not-allowed opacity-70 hover:bg-transparent')}
            aria-label={blocked ? `More ways to save. ${blocked}` : 'More ways to save'}
            // The menu opens on pointer down and on Enter, Space or Down: while unavailable those say why instead.
            onPointerDown={(event) => stop(event)}
            onKeyDown={(event) => {
              if (['Enter', ' ', 'ArrowDown'].includes(event.key)) stop(event);
            }}
            onClick={(event) => stop(event)}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      {blocked && (
        <TooltipContent side="top" collisionPadding={8} className="max-w-[260px] text-xs">
          {blocked}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function describe(file: WorkingFile): string {
  // A converted TIFF says so, never "Image, PNG" (TIFF-report.md 7.3): "Converted from a 12-page TIFF" | "Converted from TIFF".
  const converted = convertedNote(file);
  if (converted) return converted;
  // An Excel or Word result has no pages to count: it says what it is.
  if (isOfficeFile(file)) return officeInfo(file).label;
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

/** Opens the page viewer at page 1 (an image: the image itself). */
function ViewButton({ file, onView }: { file: WorkingFile; onView: (id: string, opener: HTMLElement) => void }) {
  return (
    <QuietTip text={file.kind === 'pdf' ? 'View the pages larger' : 'View the image larger'}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        data-action="view"
        data-testid="pdf-tools-file-view"
        aria-haspopup="dialog"
        aria-label={`View ${file.name}`}
        onClick={(event) => onView(file.id, event.currentTarget)}
      >
        <Maximize2 />
      </Button>
    </QuietTip>
  );
}

/**
 * The row's thumbnail opens the viewer with a single click (UX audit C3.3, T1-11), as the View button
 * does. It is for the mouse: the View button stays the keyboard's and screen readers' way (one Tab stop
 * per action), and the picture keeps its own description. Focus goes back to the View button on close.
 */
function ThumbView({ file, onView }: { file: WorkingFile; onView: (id: string, opener: HTMLElement) => void }) {
  return (
    <QuietTip text={file.kind === 'pdf' ? 'View the pages larger' : 'View the image larger'}>
      <div
        data-testid="pdf-tools-row-thumb"
        className="shrink-0 cursor-zoom-in rounded-sm transition-shadow hover:ring-2 hover:ring-primary/40"
        onClick={(event) => {
          const viewButton = event.currentTarget.closest('[data-testid="pdf-tools-row"]')?.querySelector<HTMLElement>('[data-action="view"]');
          onView(file.id, viewButton ?? event.currentTarget);
        }}
      >
        <Thumb file={viewableFile(file)} width={36} alt={file.kind === 'pdf' ? `First page of ${file.name}` : `Preview of ${file.name}`} className="h-[48px]" />
      </div>
    </QuietTip>
  );
}

/**
 * An Excel or Word result's tile (T-064, decision 9). There is no viewer for it: the tile says, on hover, what
 * to do instead ("Save it, then open it in Excel."); the row says the same to a screen reader.
 */
function OfficeTip({ file }: { file: WorkingFile }) {
  const info = officeInfo(file);
  return (
    <QuietTip text={info.tip}>
      <div data-testid="pdf-tools-row-office" className="shrink-0 rounded-sm">
        <Thumb file={file} width={36} alt={`${info.label}: ${file.name}`} className="h-[48px]" />
      </div>
    </QuietTip>
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
  onView?: (id: string, opener: HTMLElement) => void;
}

// Memoised with stable handlers: a change to one row (or a thumbnail arriving) does not redraw the others.
const FileRow = memo(function FileRow({ file, position, isFirst, isLast, selected, member = false, onToggle, onMove, onRemove, onView }: RowProps) {
  const origin = ORIGINS[file.origin];
  const checkId = `pdf-tools-check-${file.id}`;
  // An Excel or Word result: a tile in place of the preview, and no View action (there is nothing to view here).
  const office = isOfficeFile(file);
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
      data-kind={file.kind}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-3 py-1 pr-3 transition-colors sm:pr-4', member ? 'pl-12 sm:pl-14' : 'pl-3 sm:pl-4', selected ? 'bg-accent/50' : 'hover:bg-muted/40')}
    >
      <span className={cn('w-5 shrink-0 text-right text-xs tabular-nums', selected ? 'text-foreground/70' : 'text-muted-foreground')} aria-hidden="true">
        {position}
      </span>
      <Checkbox
        id={checkId}
        data-testid="pdf-tools-row-check"
        checked={selected}
        onCheckedChange={(checked) => onToggle(file.id, checked === true)}
        aria-label={`Select ${file.name}`}
      />
      {office ? (
        <OfficeTip file={file} />
      ) : onView ? (
        <ThumbView file={file} onView={onView} />
      ) : (
        <Thumb file={viewableFile(file)} width={36} alt={file.kind === 'pdf' ? `First page of ${file.name}` : `Preview of ${file.name}`} className="h-[48px]" />
      )}
      <label htmlFor={checkId} className="min-w-0 flex-1 cursor-pointer select-none">
        <MiddleName name={file.name} className="text-sm font-medium text-foreground" />

        <span className={cn('mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', selected ? 'text-foreground/70' : 'text-muted-foreground')}>
          <span className="inline-flex items-center gap-1">
            <origin.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {origin.label}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="pdf-tools-row-kind">
            {describe(file)}
            {office && <span className="sr-only">{`. ${officeInfo(file).tip}`}</span>}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatBytes(file.size)}</span>
          <FileTags file={file} />
        </span>
      </label>
      <div className="flex shrink-0 items-center gap-0.5">
        {onView && !office && <ViewButton file={file} onView={onView} />}
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
  onView?: (id: string, opener: HTMLElement) => void;
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
  onView,
}: GroupRowProps) {
  const { files, groupId, key } = unit;
  const { title, range } = groupTitle(files);
  const listId = `pdf-tools-group-${groupId}`;
  const size = files.reduce((sum, f) => sum + f.size, 0);
  // One meaning of "not saved" everywhere: also a result only handed to a download (REV-B S12).
  const unsaved = files.filter(isUnsavedResult).length;
  // Where every file of the group has been sent (the rows inside say it for each one).
  const sharedDestinations = (Object.keys(SENT_LABELS) as Destination[]).filter((d) => files.every((f) => f.sentTo.includes(d)));
  const all = selectedCount === files.length;
  const origin = ORIGINS[files[0].origin];
  const carried = carriedGroupLabel(files);

  return (
    <li data-testid="pdf-tools-group" data-row-id={key} data-group-id={groupId} data-count={files.length}>
      <div
        onKeyDown={(event) => moveKey(event, (direction) => onMove(key, direction))}
        className={cn('flex items-center gap-3 px-3 py-1 transition-colors sm:px-4', all ? 'bg-accent/50' : 'hover:bg-muted/40')}
      >
        <span className={cn('w-5 shrink-0 text-right text-xs tabular-nums', all ? 'text-foreground/70' : 'text-muted-foreground')} aria-hidden="true">
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
            <span className="absolute -right-1 -top-1 h-[48px] w-[36px] rounded border bg-muted" />
            <Thumb file={viewableFile(files[0])} width={36} alt="" className="relative h-[48px] bg-card" retryButton={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              <MiddleName name={title} title={false} className="text-sm font-medium text-foreground" />
              <span className="sr-only">{expanded ? ', open' : ', closed'}. {range}</span>
            </span>
            <span className={cn('mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-xs', all ? 'text-foreground/70' : 'text-muted-foreground')}>
              <span className="inline-flex items-center gap-1">
                <origin.icon className="h-3.5 w-3.5" />
                {origin.label}
              </span>
              <span>·</span>
              <span>{describeGroup(files)}</span>
              <span>·</span>
              <span className="tabular-nums">{formatBytes(size)}</span>
              {carried && (
                <Tag icon={<MessageSquareText className="h-3 w-3" />} testId="pdf-tools-group-carried">
                  {carried}
                </Tag>
              )}
              {unsaved > 0 && (
                <Tag icon={<CloudOff className="h-3 w-3" />}>
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
              onView={onView}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

export interface FileListProps {
  /** The screen's "Add files" controls, shown first in the list bar (no drop strip once files are listed). */
  addControls?: ReactNode;
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
  /** The row's View action: opens the page viewer on that file. `opener` gets focus back on close. */
  onView?: (id: string, opener: HTMLElement) => void;
  /** Saves every result not saved yet (the "N not saved" count in the list bar; QA-FIX K). */
  onSaveUnsaved?: () => void;
}

export default function FileList({
  addControls,
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
  onView,
  onSaveUnsaved,
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
  // While the remove question is open, the application's shortcuts never act behind it (useDialogKeys.ts); an
  // Escape that no layer took closes it, as Escape does (REV-B S13).
  const confirmContent = useRef<HTMLDivElement>(null);
  useDialogKeys(confirmContent, () => setConfirming(null));
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
  // What the list holds against its limit: a protected result's preview bytes count too (workingList.ts).
  const totalSize = listHeldBytes(files);
  // The same count as the Remove and leave questions: a result only handed to a download is not known to be kept (REV-B S12).
  const unsavedCount = files.filter(isUnsavedResult).length;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const nothingSelected = selectedCount === 0;

  // The rows get stable handlers; these read the latest props through a ref.
  const latest = useRef({ files, units, expanded, selectedIds, onSelectionChange, onMove, onRemove, onListEmptied, onView });
  latest.current = { files, units, expanded, selectedIds, onSelectionChange, onMove, onRemove, onListEmptied, onView };
  // A stable View handler for the memoised rows; none when the screen offers no viewer.
  const viewFile = useCallback((id: string, opener: HTMLElement) => latest.current.onView?.(id, opener), []);
  const rowView = onView ? viewFile : undefined;

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
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium text-foreground">{nothingSelected ? plural(files.length, 'file') : `${selectedCount} of ${files.length} selected`}</span>
            {unsavedCount > 0 && (
              // "3 not saved" on a laptop, "3 results not saved yet" on a wide screen; on hover and focus, and read
              // out in full, what happens to them (cleared when the engagement changes or VERA closes); a click saves
              // them all (QA-FIX K). An engagement change through VERA's own controls now asks first (leaveGuard.ts),
              // so the wide line no longer repeats it.
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="pdf-tools-unsaved-count"
                    data-count={unsavedCount}
                    aria-label={unsavedWarning(unsavedCount)}
                    disabled={saving || !onSaveUnsaved}
                    onClick={() => onSaveUnsaved?.()}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-foreground ring-offset-background transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  >
                    <CloudOff className="h-3 w-3 text-warning" aria-hidden="true" />
                    <span className="2xl:hidden" aria-hidden="true">
                      {unsavedCount} not saved
                    </span>
                    <span className="hidden 2xl:inline" aria-hidden="true">
                      {unsavedLine(unsavedCount)}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-xs" data-testid="pdf-tools-unsaved-tip">
                  {unsavedWarning(unsavedCount)}
                </TooltipContent>
              </Tooltip>
            )}
            {totalSize > LIST_WARN_BYTES && (
              <span data-testid="pdf-tools-list-size" className="inline-flex items-center gap-1 text-xs tabular-nums text-foreground">
                <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                List is large: {formatBytes(totalSize)} of {formatBytes(LIST_MAX_BYTES)}
              </span>
            )}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {addControls}
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
            {/* Short on a laptop (only the icon), in words on a wide screen; its name is always "Remove". */}
            <span className="sr-only 2xl:not-sr-only">Remove</span>
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
              {saving ? (
                'Saving…'
              ) : (
                <span>
                  Save<span className="sr-only 2xl:not-sr-only"> to computer</span>
                </span>
              )}
            </HintButton>
            <DropdownMenu>
              <ZipChevron blocked={saving ? 'Saving…' : selectedCount < 2 ? 'Select two or more files to save them as one zip.' : null} />
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
              onView={rowView}
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
              onView={rowView}
            />
          ),
        )}
      </ul>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent
          ref={confirmContent}
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
              focusQuietly(back);
            } else {
              selectAllRef.current?.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {unsavedInConfirm === 1 ? 'an unsaved result' : `${unsavedInConfirm} unsaved results`}?</AlertDialogTitle>
            <AlertDialogDescription>
              {unsavedInConfirm === 1 ? 'This result has' : 'These results have'} not been saved and will be lost. Files in the Evidence Vault are not
              affected.{downloadOnlyInConfirm > 0 ? ' A download was started, but PDF Tools cannot tell if it was kept.' : ''}
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
