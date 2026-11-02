import { BUILD_MESSAGE } from '@/config/buildMessage';
import { cn } from '@/lib/utils';

interface BuildInfoLabelProps {
  className?: string;
  compact?: boolean;
}

// Static label only. The commit and the local-changes flag are fixed at build
// time by vite.config.ts; nothing here checks GitHub or whether the code is current.
export function BuildInfoLabel({ className, compact = false }: BuildInfoLabelProps) {
  const commit = __BUILD_COMMIT__;
  const parts = [
    ...(BUILD_MESSAGE.sourceBranch ? [`Source branch: ${BUILD_MESSAGE.sourceBranch}`] : []),
    `Build: ${commit}`,
    ...(__BUILD_DIRTY__ ? ['Local changes present'] : []),
  ];
  return (
    <div
      data-testid="build-info-label"
      className={cn('text-xs leading-tight text-muted-foreground', compact ? 'text-left' : 'text-center', className)}
    >
      {BUILD_MESSAGE.lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
      <div>{parts.join(' · ')}</div>
    </div>
  );
}
