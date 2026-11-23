// The form's own words on screen, word for word, from the definition: the wording of a question row
// (its HTML through a small allow-list: em, strong, br, a) and the text of Parts A and B, the notes and
// the hints (nodes of the definition through an allow-list of plain elements). An answer inside the text
// and a table are drawn by the caller. Nothing is shortened: long text wraps.
import * as React from 'react';

import type { Form26Node } from '@/data/taxAuditForm26Types';
import { parseWordingHtml } from '@/lib/taxAuditForm26EditorModel';
import { cn } from '@/lib/utils';

export type Form26ProseProps = {
  nodes: Form26Node[];
  /** Draws an answer found in the text. */
  renderField(key: string): React.ReactNode;
  /** Draws a table found in the text (Parts A and B hold theirs as blocks, so this is rarely needed). */
  renderTable?(tableId: string): React.ReactNode;
  /** A link of the form ("If yes, refer Schedule – …") was followed: show that schedule. */
  onLink?(scheduleId: string): void;
  className?: string;
};

type Element = Extract<Form26Node, { t: string }>;

const classes = (node: Element) => (node.c ?? '').split(/\s+/).filter(Boolean);

// The global stylesheet cuts every table cell at 250 px with `!important` (src/index.css): these tables
// override it, as src/components/ui/data-table.tsx does.
const CELL = '!max-w-none !overflow-visible !whitespace-normal !px-2 !py-1 !text-xs !leading-5 border border-border align-top';

function linkTarget(node: Element): string | null {
  const href = node.a?.href ?? '';
  return href.startsWith('#') && href.length > 1 ? href.slice(1) : null;
}

function render(nodes: Form26Node[] | undefined, props: Form26ProseProps, path: string): React.ReactNode[] {
  return (nodes ?? []).map((node, index) => renderNode(node, props, `${path}.${index}`));
}

function renderNode(node: Form26Node, props: Form26ProseProps, key: string): React.ReactNode {
  if (typeof node === 'string') return node;
  if ('f' in node) return <React.Fragment key={key}>{props.renderField(node.f)}</React.Fragment>;
  if ('tbl' in node) return <React.Fragment key={key}>{props.renderTable?.(node.tbl) ?? null}</React.Fragment>;

  const children = render(node.k, props, key);
  const has = (name: string) => classes(node).includes(name);
  const indented = (node.a?.style ?? '').includes('margin-left');
  switch (node.t) {
    case 'br':
      return <br key={key} />;
    case 'em':
      return <em key={key}>{children}</em>;
    case 'strong':
      return <strong key={key} className="font-semibold">{children}</strong>;
    case 'span':
      return (
        <span key={key} className={cn(has('note') && 'block pt-1 text-xs font-medium text-subtle')}>
          {children}
        </span>
      );
    case 'a': {
      const target = linkTarget(node);
      if (!target) return <span key={key}>{children}</span>;
      return (
        <button
          key={key}
          type="button"
          onClick={() => props.onLink?.(target)}
          className="rounded-sm text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {children}
        </button>
      );
    }
    case 'h1':
    case 'h2':
      return (
        <h3 key={key} className="pt-1 text-center text-sm font-semibold tracking-normal">
          {children}
        </h3>
      );
    case 'h3':
    case 'h4':
      return (
        <h4 key={key} className="pt-1 text-sm font-semibold">
          {children}
        </h4>
      );
    case 'p':
      // A paragraph of the form can hold answers, so it is drawn as a block that may hold controls.
      return (
        <div key={key} className={cn('text-sm leading-6', has('c') && 'text-center', indented && 'pl-5', has('note') && 'text-xs leading-5 text-subtle')}>
          {children}
        </div>
      );
    case 'div':
      return (
        <div
          key={key}
          className={cn(
            has('sub') && 'text-center text-xs text-subtle',
            has('toc') && 'rounded-md border bg-muted/30 px-3 py-2 text-xs leading-5 text-subtle',
            has('refline') && 'pt-1 text-xs leading-5 text-subtle',
            has('note') && 'text-xs leading-5 text-subtle',
            indented && 'pl-5',
          )}
        >
          {children}
        </div>
      );
    case 'label':
      return <span key={key}>{children}</span>;
    case 'ol':
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {children}
        </ol>
      );
    case 'li':
      return <li key={key}>{children}</li>;
    case 'table':
      return (
        <table key={key} className="my-1 border-collapse text-xs">
          {children}
        </table>
      );
    case 'thead':
      return <thead key={key}>{children}</thead>;
    case 'tbody':
      return <tbody key={key}>{children}</tbody>;
    case 'tr':
      return <tr key={key}>{children}</tr>;
    case 'th':
      return (
        <th key={key} scope="col" colSpan={Number(node.a?.colspan) || undefined} rowSpan={Number(node.a?.rowspan) || undefined} className={cn(CELL, 'bg-muted/60 text-left font-semibold')}>
          {children}
        </th>
      );
    case 'td':
      return (
        <td key={key} colSpan={Number(node.a?.colspan) || undefined} rowSpan={Number(node.a?.rowspan) || undefined} className={CELL}>
          {children}
        </td>
      );
    default:
      // Anything outside the allow-list keeps its text only.
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}

/** Text of the form with the answers in it, in the file's order. */
export function Form26Prose(props: Form26ProseProps): JSX.Element {
  return <div className={cn('space-y-2 break-words text-foreground', props.className)}>{render(props.nodes, props, 'n')}</div>;
}

/** The wording of a question row, exactly as the form has it. */
export function Form26Wording({ html, id, className }: { html: string; id?: string; className?: string }): JSX.Element {
  const nodes = React.useMemo(() => parseWordingHtml(html), [html]);
  return (
    <div id={id} className={cn('min-w-0 break-words text-sm leading-[1.375rem] text-foreground', className)}>
      {render(nodes, { nodes, renderField: () => null }, 'w')}
    </div>
  );
}
