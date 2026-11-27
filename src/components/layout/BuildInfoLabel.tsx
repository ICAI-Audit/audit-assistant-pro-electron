import { BUILD_MESSAGE, buildDetailLines } from '@/config/buildMessage';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface BuildInfoLabelProps {
  className?: string;
  compact?: boolean;
}

export function BuildInfoLabel({ className, compact = false }: BuildInfoLabelProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="build-info-label"
            className={cn(
              compact ? 'cursor-help rounded-md border border-slate-200 bg-slate-50 text-slate-600' : 'cursor-help rounded-lg border-2 border-solid border-red-600 bg-red-50 px-3 py-2 text-xs leading-snug text-slate-900',
              compact ? 'text-left' : 'text-center',
              className,
            )}
          >
            {compact ? <div>v0.9.1 · Updated 22 Nov 2026</div> : <>{BUILD_MESSAGE.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>Update: {BUILD_MESSAGE.updateNote}</div></>}
          </div>
        </TooltipTrigger>
        <TooltipContent data-testid="build-details-tooltip">
          <div className="font-semibold">Build details</div>
          <div>{BUILD_MESSAGE.updateNote}</div>
          {buildDetailLines().map((line) => (
            <div key={line}>{line}</div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
