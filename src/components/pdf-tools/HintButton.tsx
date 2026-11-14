import { forwardRef } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HintButtonProps extends ButtonProps {
  enabled: boolean;
  /** Shown as a tooltip, and read out, while the button is unavailable. */
  hint?: string;
  hintSide?: 'top' | 'bottom';
}

/**
 * A button that stays reachable by keyboard when it is unavailable (aria-disabled rather than
 * disabled), so that its tooltip can say why.
 */
const HintButton = forwardRef<HTMLButtonElement, HintButtonProps>(({ enabled, hint, hintSide = 'top', onClick, className, children, ...rest }, ref) => {
  const button = (
    <Button
      ref={ref}
      aria-disabled={enabled ? undefined : true}
      data-enabled={enabled ? 'true' : 'false'}
      onClick={(event) => {
        if (!enabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(!enabled && 'cursor-not-allowed opacity-50 hover:bg-transparent', className)}
      {...rest}
    >
      {children}
      {!enabled && hint && <span className="sr-only">{`. ${hint}`}</span>}
    </Button>
  );
  if (!hint) return button;
  // The tooltip wrapper stays in place either way, so the button keeps focus when it becomes available.
  return (
    <Tooltip>
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
