import { useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEngagement } from '@/contexts/EngagementContext';

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  action: () => void;
  description: string;
  category: string;
}

export const reservedShortcutKeys = new Set(['c', 'v', 'x', 'z']);

// Global navigation shortcuts
export const navigationShortcuts = [
  { key: 'd', route: '/', description: 'Dashboard', category: 'Navigation' },
  { key: 'e', route: '/engagements', description: 'Engagements', category: 'Navigation' },
  { key: 'c', route: '/compliance-applicability', description: 'Compliance Applicability', category: 'Navigation', requiresEngagement: true },
  { key: 'x', route: '/appointment', description: 'Appointment', category: 'Navigation', requiresEngagement: true },
  { key: 'b', route: '/financial-statement-review', description: 'Financial Statement Review', category: 'Navigation', requiresEngagement: true },
  { key: 'm', route: '/materiality', description: 'Materiality', category: 'Navigation', requiresEngagement: true },
  { key: 'r', route: '/risks', description: 'Risk Register', category: 'Navigation', requiresEngagement: true },
  { key: 'v', route: '/evidence', description: 'Evidence Vault', category: 'Navigation', requiresEngagement: true },
  { key: 'n', route: '/review-notes', description: 'Review Notes', category: 'Navigation', requiresEngagement: true },
  { key: 'i', route: '/misstatements', description: 'Misstatements', category: 'Navigation', requiresEngagement: true },
  { key: 'a', route: '/audit-report', description: 'Audit Report', category: 'Navigation', requiresEngagement: true },
  { key: 'o', route: '/audit-tools', description: 'VERA Tools', category: 'Navigation', requiresEngagement: true },
  { key: 'h', route: '/audit-trail', description: 'Audit Trail (History)', category: 'Navigation', requiresEngagement: true },
  { key: 'l', route: '/completion', description: 'Completion (Lock)', category: 'Navigation', requiresEngagement: true },
  { key: 'y', route: '/my-dashboard', description: 'My Tasks', category: 'Navigation', requiresEngagement: true },
  { key: 's', route: '/settings', description: 'Settings', category: 'Navigation' },
  { key: 'g', route: '/gstr1-integration', description: 'GSTR1 Integration', category: 'Navigation' },
];

export function useGlobalKeyboardShortcuts() {
  const navigate = useNavigate();
  const { currentEngagement } = useEngagement();

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // A screen with its own shortcuts (e.g. Financial Statement Review) has
    // already handled this key.
    if (event.defaultPrevented) {
      return;
    }

    // Don't trigger shortcuts when typing in inputs
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Ctrl/Cmd + key for navigation (Shift required for reserved keys)
    if (event.ctrlKey || event.metaKey) {
      const normalizedKey = event.key.toLowerCase();
      if (reservedShortcutKeys.has(normalizedKey) && !event.shiftKey) {
        return;
      }

      const shortcut = navigationShortcuts.find(s => s.key.toLowerCase() === normalizedKey);
      
      if (shortcut) {
        // Check if engagement is required
        if (shortcut.requiresEngagement && !currentEngagement) {
          return;
        }
        
        event.preventDefault();
        navigate(shortcut.route);
      }
    }
  }, [navigate, currentEngagement]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// Hook for tab switching within a page
export function useTabShortcuts(
  tabs: string[],
  activeTab: string,
  setActiveTab: (tab: string) => void
) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Ctrl/Cmd + number for tab switching
    if (event.ctrlKey || event.metaKey) {
      const num = parseInt(event.key);
      if (!isNaN(num) && num >= 1 && num <= tabs.length) {
        event.preventDefault();
        setActiveTab(tabs[num - 1]);
      }
    }

    // Alt + Arrow keys for next/prev tab
    if (event.altKey) {
      const currentIndex = tabs.indexOf(activeTab);
      
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTab(tabs[nextIndex]);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        setActiveTab(tabs[prevIndex]);
      }
    }
  }, [tabs, activeTab, setActiveTab]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
