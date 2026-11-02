import { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';
import { useGlobalKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';

interface MainLayoutProps {
  children: ReactNode;
  /** Page manages its own scrolling and spacing (e.g. Financial Statement Review). */
  fullBleed?: boolean;
}

export function MainLayout({ children, fullBleed = false }: MainLayoutProps) {
  // Enable global keyboard shortcuts
  useGlobalKeyboardShortcuts();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main className={fullBleed ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto scrollbar-thin p-6'}>
          {children}
        </main>
      </div>
      <KeyboardShortcutsDialog />
    </div>
  );
}
