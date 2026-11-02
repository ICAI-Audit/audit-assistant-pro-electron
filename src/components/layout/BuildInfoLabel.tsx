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
              'cursor-help rounded-lg border-2 border-solid border-red-600 bg-red-50 px-3 py-2 text-xs leading-snug text-slate-900',
              compact ? 'text-left' : 'text-center',
              className,
            )}
          >
            {BUILD_MESSAGE.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>Update: {BUILD_MESSAGE.updateNote}</div>
          </div>
        </TooltipTrigger>
        <TooltipContent data-testid="build-details-tooltip">
          <div className="font-semibold">Build details</div>
          {buildDetailLines().map((line) => (
            <div key={line}>{line}</div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
