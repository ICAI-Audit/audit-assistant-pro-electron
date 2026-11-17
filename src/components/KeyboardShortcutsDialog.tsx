import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Keyboard } from 'lucide-react';
import { navigationShortcuts, reservedShortcutKeys } from '@/hooks/useKeyboardShortcuts';

interface ShortcutRowProps {
  keys: string[];
  description: string;
}

const modifierKeys = new Set(['CTRL', 'CMD', 'ALT', 'SHIFT']);

const shouldDoubleUnderlineKey = (key: string, keys: string[]) => {
  if (modifierKeys.has(key.toUpperCase())) {
    return false;
  }
  if (!reservedShortcutKeys.has(key.toLowerCase())) {
    return false;
  }
  return keys.some((item) => item.toUpperCase() === 'SHIFT');
};

const ShortcutRow = ({ keys, description }: ShortcutRowProps) => (
  <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
    <span className="text-sm text-foreground">{description}</span>
    <div className="flex items-center gap-1">
      {keys.map((key, i) => (
        <span key={i} className="flex items-center gap-1">
          <kbd
            className={[
              'px-2 py-1 text-xs font-semibold rounded border shadow-sm',
              modifierKeys.has(key.toUpperCase())
                ? 'bg-muted text-foreground border-border underline underline-offset-2'
                : shouldDoubleUnderlineKey(key, keys)
                ? 'bg-muted text-foreground border-border underline decoration-double underline-offset-2'
                : 'bg-muted text-foreground border-border',
            ].join(' ')}
          >
            {key}
          </kbd>
          {i < keys.length - 1 && <span className="text-muted-foreground">+</span>}
        </span>
      ))}
    </div>
  </div>
);

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + ? or Ctrl/Cmd + / to open shortcuts dialog
      if ((event.ctrlKey || event.metaKey) && (event.key === '?' || event.key === '/')) {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? 'Cmd' : 'Ctrl';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Use Ctrl/Cmd with the keys below to navigate quickly through the application. For C, V, X, and Z shortcuts, use Ctrl/Cmd + Shift.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Navigation Shortcuts */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge variant="outline">Navigation</Badge>
            </h3>
            <div className="bg-muted/30 rounded-lg p-4">
              {navigationShortcuts.map((shortcut) => (
                <ShortcutRow
                  key={shortcut.route}
                  keys={[
                    modKey,
                    ...(reservedShortcutKeys.has(shortcut.key.toLowerCase()) ? ['Shift'] : []),
                    shortcut.key.toUpperCase(),
                  ]}
                  description={shortcut.description}
                />
              ))}
            </div>
          </div>

          {/* Tab Shortcuts */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge variant="outline">Tab Navigation</Badge>
            </h3>
            <div className="bg-muted/30 rounded-lg p-4">
              <ShortcutRow keys={[modKey, '1-9']} description="Switch to tab 1-9" />
              <ShortcutRow keys={['Alt', 'ArrowRight']} description="Next tab" />
              <ShortcutRow keys={['Alt', 'ArrowLeft']} description="Previous tab" />
            </div>
          </div>

          {/* Financial Statement Review */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge variant="outline">Financial Statement Review</Badge>
            </h3>
            <div className="bg-muted/30 rounded-lg p-4">
              <ShortcutRow keys={[modKey, 'Shift', 'letter']} description="Open the menu tab whose letter is underlined" />
              <ShortcutRow keys={['Esc']} description="Back to the previous screen" />
              <ShortcutRow keys={[modKey, 'Z']} description="Undo the last categorisation" />
              <ShortcutRow keys={[modKey, 'Y']} description="Redo the categorisation" />
            </div>
          </div>

          {/* VERA Tools Specific */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge variant="outline">VERA Tools Tabs</Badge>
            </h3>
            <div className="bg-muted/30 rounded-lg p-4">
              <ShortcutRow keys={[modKey, '1']} description="Ledger Analysis" />
              <ShortcutRow keys={[modKey, '2']} description="GST Related" />
              <ShortcutRow keys={[modKey, '3']} description="MCA Data" />
              <ShortcutRow keys={[modKey, '4']} description="Income Tax" />
              <ShortcutRow keys={[modKey, '5']} description="PDF Tools" />
              <ShortcutRow keys={[modKey, '6']} description="Analytics" />
            </div>
          </div>

          {/* General Shortcuts */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Badge variant="outline">General</Badge>
            </h3>
            <div className="bg-muted/30 rounded-lg p-4">
              <ShortcutRow keys={[modKey, '/']} description="Show keyboard shortcuts" />
              <ShortcutRow keys={['Alt']} description="Focus menu bar (File/Edit/View)" />
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">{modKey} + /</kbd> anytime to view shortcuts
        </div>
      </DialogContent>
    </Dialog>
  );
}
