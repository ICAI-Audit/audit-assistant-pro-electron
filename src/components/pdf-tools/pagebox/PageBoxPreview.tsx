// The preview beside the Resize or crop pages options: one chosen page, drawn by pdf.js as the run will
// make it (resize, margins), or as it is with the crop frame over it (trim); buttons to step through the
// chosen pages; the page's size before and after; and what the user should know about this page.
import type { ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BoxPreview } from './usePageBoxData';

export interface PageBoxPreviewProps {
  /** Test id of the pane; its parts add -image, -prev, -next, -page, -caption, -notes, -error. */
  id: string;
  preview: BoxPreview | null;
  pending: boolean;
  /** The page shown (from 1). */
  page: number;
  /** The pages the preview can show, in order (the chosen pages). */
  pages: readonly number[];
  onPage: (page: number) => void;
  alt: string;
  /** Drawn over the page (the crop frame), sized to the picture. */
  overlay?: ReactNode;
  /** The page's size, and what it becomes. */
  caption?: ReactNode;
  notes?: readonly string[];
  /**
   * A problem with the options, shown beside the picture. Not an alert: every problem of this dialog is a field's,
   * read out at the field already (REV-B minor 6).
   */
  problem?: string | null;
  /** What a screen reader hears when the frame moves (polite). */
  announcement?: string;
  maxHeight?: number;
  /** The widest the picture is drawn (the pane's inner width beside the options). */
  maxWidth?: number;
}

export default function PageBoxPreview({ id, preview, pending, page, pages, onPage, alt, overlay, caption, notes = [], problem, announcement = '', maxHeight = 340, maxWidth = 254 }: PageBoxPreviewProps) {
  const at = pages.indexOf(page);
  const atFirst = at <= 0;
  const atLast = at < 0 || at >= pages.length - 1;
  const ready = preview?.status === 'ready' ? preview : null;
  return (
    <section aria-label="Preview" className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid={id}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground" data-testid={`${id}-page`}>
          Preview of page {page}
        </span>
        <span className="flex items-center gap-1">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Updating the preview" />}
          {pages.length > 1 && (
            <>
              {/* aria-disabled, not disabled, at either end: a disabled button would drop the focus (REV-B S7). */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', atFirst && 'cursor-default opacity-50 hover:bg-transparent')}
                aria-label="Previous chosen page"
                data-testid={`${id}-prev`}
                aria-disabled={atFirst || undefined}
                onClick={() => !atFirst && onPage(pages[at - 1])}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', atLast && 'cursor-default opacity-50 hover:bg-transparent')}
                aria-label="Next chosen page"
                data-testid={`${id}-next`}
                aria-disabled={atLast || undefined}
                onClick={() => !atLast && onPage(pages[at + 1])}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </span>
      </div>

      <div className="flex min-h-[180px] items-center justify-center">
        {ready ? (
          // The overlay must cover exactly the picture: the box is given the picture's shown size and shape
          // (a box that shrinks to its picture comes out wider than a height-limited picture), and its outline is
          // a ring, which takes no room, so the picture fills the box to the pixel.
          <div
            className="relative select-none bg-white shadow-sm ring-1 ring-border"
            style={{ width: Math.min(maxWidth, (maxHeight * ready.width) / ready.height), maxWidth: '100%', aspectRatio: `${ready.width} / ${ready.height}` }}
          >
            <img src={ready.url} alt={alt} data-testid={`${id}-image`} data-page={ready.pageIndex + 1} draggable={false} className="block h-full w-full" />
            {overlay}
          </div>
        ) : (
          !problem && (
            <div className="flex h-[220px] w-full items-center justify-center rounded border border-dashed px-3 text-center text-xs text-muted-foreground">
              {preview?.status === 'error' ? preview.message : 'Drawing the preview…'}
            </div>
          )
        )}
      </div>

      {caption && (
        <p className="text-xs text-muted-foreground" data-testid={`${id}-caption`}>
          {caption}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1" data-testid={`${id}-notes`}>
          {notes.map((note) => (
            <li key={note} className="flex gap-1.5 text-xs text-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              {note}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p data-testid={`${id}-error`} className="flex gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite" data-testid={`${id}-announce`}>
        {announcement}
      </p>
    </section>
  );
}
