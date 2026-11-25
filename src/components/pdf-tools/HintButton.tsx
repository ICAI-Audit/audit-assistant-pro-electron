import { forwardRef, useCallback, useContext, useRef, useState, type ForwardedRef } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { endQuietFocus, isQuietlyFocused } from './quietFocus';
import { WhyContext } from './whyLine';

/** One element for both the caller's ref and this component's own. */
function useBothRefs<T>(outer: ForwardedRef<T>) {
  const own = useRef<T | null>(null);
  const set = useCallback(
    (node: T | null) => {
      own.current = node;
      if (typeof outer === 'function') outer(node);
      else if (outer) outer.current = node;
    },
    [outer],
  );
  return [own, set] as const;
}

interface HintButtonProps extends ButtonProps {
  enabled: boolean;
  /** Shown as a tooltip, and read out, while the button is unavailable. */
  hint?: string;
  hintSide?: 'top' | 'bottom';
}

/**
 * A button that stays reachable by keyboard when it is unavailable (aria-disabled rather than
 * disabled), so that it can say why: on hover, on focus and, when clicked, in its tooltip and in the
 * screen's status line (whyLine.ts; UX audit C4.2). Its unavailable look keeps its text readable
 * (70% instead of 50% opacity: 6.4:1 on the list bar in the light theme, 8.1:1 in the dark).
 */
const HintButton = forwardRef<HTMLButtonElement, HintButtonProps>(({ enabled, hint, hintSide = 'top', onClick, onBlur, onPointerMove, onKeyDown, className, children, ...rest }, ref) => {
  const [open, setOpen] = useState(false);
  const sayWhy = useContext(WhyContext);
  const [own, setRef] = useBothRefs(ref);
  const button = (
    <Button
      ref={setRef}
      aria-disabled={enabled ? undefined : true}
      data-enabled={enabled ? 'true' : 'false'}
      // Focus given back by a closing dialog opens no tooltip until the user acts (quietFocus.ts).
      onBlur={(event) => {
        endQuietFocus(event.currentTarget);
        onBlur?.(event);
      }}
      onPointerMove={(event) => {
        endQuietFocus(event.currentTarget);
        onPointerMove?.(event);
      }}
      onKeyDown={(event) => {
        endQuietFocus(event.currentTarget);
        onKeyDown?.(event);
      }}
      onClick={(event) => {
        endQuietFocus(event.currentTarget);
        if (!enabled) {
          event.preventDefault();
          if (hint) {
            setOpen(true);
            sayWhy?.(hint);
          }
          return;
        }
        onClick?.(event);
      }}
      className={cn(!enabled && 'cursor-not-allowed opacity-70 hover:bg-transparent', className)}
      {...rest}
    >
      {children}
      {!enabled && hint && <span className="sr-only">{`. ${hint}`}</span>}
    </Button>
  );
  if (!hint) return button;
  // The tooltip wrapper stays in place either way, so the button keeps focus when it becomes available.
  return (
    <Tooltip
      open={!enabled && open}
      onOpenChange={(next) => {
        if (next && isQuietlyFocused(own.current)) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      {!enabled && (
        <TooltipContent side={hintSide} collisionPadding={8} className="max-w-[260px] text-xs">
          {hint}
        </TooltipContent>
      )}
    </Tooltip>
  );
});
HintButton.displayName = 'HintButton';

export default HintButton;
