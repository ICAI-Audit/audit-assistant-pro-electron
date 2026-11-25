// The tokens a text may use, shown beside the field as small buttons that put the token in at the
// caret of the field last used (design 5.16, 5.17; useTokenTarget.ts). Each button says what its
// token is filled with.
import { cn } from '@/lib/utils';
import type { TokenHelpItem } from './markText';

export default function TokenBar({
  id,
  tokens,
  onInsert,
  label = 'Insert',
  className,
}: {
  id: string;
  tokens: readonly TokenHelpItem[];
  onInsert: (token: string) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} role="group" aria-label="Tokens, filled in when the tool runs" data-testid={id}>
      <span className="mr-0.5 text-[11px] text-muted-foreground">{label}</span>
      {tokens.map(({ token, meaning }) => (
        <button
          key={token}
          type="button"
          className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Insert ${token}: ${meaning}`}
          title={meaning}
          data-testid={`${id}-${token.slice(1, -1)}`}
          // Keep the field's caret: a mouse press would otherwise move focus first.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsert(token)}
        >
          {token}
        </button>
      ))}
    </div>
  );
}
