import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Building2,
  FileSpreadsheet,
  Calculator,
  AlertTriangle,
  FileCheck,
  MessageSquare,
  Lock,
  History,
  Settings,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Wrench,
  ScanSearch,
  Briefcase,
  Shield,
  FileText,
  FileSignature,
  Landmark,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/contexts/EngagementContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { reservedShortcutKeys } from '@/hooks/useKeyboardShortcuts';

type SidebarItem = {
  name: string;
  href: string;
  icon: any;
  requiresEngagement?: boolean;
  children?: SidebarItem[];
};

const navItems: SidebarItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Assignments', href: '/engagements', icon: Briefcase },
  { name: 'Permanent File', href: '/permanent-file', icon: Building2, requiresEngagement: true },
  { name: 'Appointment & Engagement', href: '/appointment', icon: FileSignature, requiresEngagement: true },
  { name: 'Compliance Applicability', href: '/compliance-applicability', icon: Shield },
  {
    name: 'Materiality & Risk Assessment',
    href: '/materiality',
    icon: Calculator,
    requiresEngagement: true,
  },
  { name: 'Audit Execution', href: '/audit-execution', icon: ClipboardList, requiresEngagement: true },
  { name: 'Financial Statement Review', href: '/financial-statement-review', icon: FileSpreadsheet, requiresEngagement: true },
  { name: 'Audit Report', href: '/audit-report', icon: FileText, requiresEngagement: true },
  { name: 'Tax Audit', href: '/tax-audit', icon: Landmark, requiresEngagement: true },
  { name: 'Review Notes', href: '/review-notes', icon: MessageSquare, requiresEngagement: true },
  { name: 'Evidence Vault', href: '/evidence', icon: FileCheck, requiresEngagement: true },
  { name: 'VERA Tools', href: '/audit-tools', icon: Wrench, requiresEngagement: true },
  { name: 'CAAT Tools', href: '/caat-tools', icon: ScanSearch, requiresEngagement: true },
  { name: 'Feedback', href: '/feedback', icon: MessageSquare, requiresEngagement: true },
];

const secondaryNavItems = [
  { name: 'Audit Trail', href: '/audit-trail', icon: History, requiresEngagement: true },
  { name: 'Completion', href: '/completion', icon: Lock, requiresEngagement: true },
  { name: 'Admin', href: '/admin', icon: Shield, adminOnly: true },
  { name: 'Admin Settings', href: '/admin/settings', icon: Settings, adminOnly: true },
];

// T-088 (owner, 27 Nov 2026): the menu fills the sidebar from the brand to the Collapse button, without scrolling and
// without an empty band below it. Each row's vertical padding is shared out from the window height: the fixed parts
// (brand 52px, Collapse bar, section labels and gaps: about 13.5rem) and 1.5rem per row (20px icon + 4px gap) are taken
// off, and the rest is split between the rows (--nav-rows, set on <aside>), between 2px and 8px. Very short windows scroll.
const SHORT_ROW = '';
const ROW_PAD_VALUE = 'clamp(2px, calc((100vh - 13.5rem - var(--nav-rows, 19) * 1.5rem) / (var(--nav-rows, 19) * 2)), 8px)';
const ROW_PAD = { paddingTop: ROW_PAD_VALUE, paddingBottom: ROW_PAD_VALUE };

export function AppSidebar() {
  // Collapsed to the icon rail by the user's choice, or automatically below 1440px wide. The Collapse button always wins.
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1439px)').matches);
  const collapsed = manualCollapsed ?? narrow;
  const [altHeld, setAltHeld] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const { currentEngagement } = useEngagement();
  const isAdmin = role === 'partner' || role === 'manager' || role === 'admin';
  const hasEngagement = !!currentEngagement;

  useEffect(() => {
    setManualCollapsed(null);
  }, [user?.id]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1439px)');
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Access-key underlines are shown only while Alt is held.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(event.type === 'keydown');
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const handleLogoClick = () => {
    navigate('/');
  };

  const renderName = (name: string) => {
    if (!name) return name;
    const firstLetter = name[0];
    const useDoubleUnderline = reservedShortcutKeys.has(firstLetter.toLowerCase());

    return (
      <>
        <span
          className={cn(
            altHeld && 'underline underline-offset-2',
            altHeld && useDoubleUnderline && 'decoration-double'
          )}
        >
          {firstLetter}
        </span>
        <span>{name.slice(1)}</span>
      </>
    );
  };

  const NavItem = ({ item, disabled = false }: { item: SidebarItem; disabled?: boolean }) => {
    const isActive = location.pathname === item.href || Boolean(item.children?.some(child => location.pathname === child.href));
    
    if (disabled) {
      const content = (
        <div
          className={cn(
            'nav-link group relative cursor-not-allowed gap-2.5 px-2.5 py-1.5 text-[13px] opacity-50'+SHORT_ROW,
          )}
          style={ROW_PAD}
        >
          <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          {!collapsed ? (
            <span className="truncate text-muted-foreground">
              {renderName(item.name)}
            </span>
          ) : (
            <span className="sr-only" aria-hidden="true">{item.name}</span>
          )}
        </div>
      );

      if (collapsed) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>{content}</TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.name} - Select an engagement first</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }

      return content;
    }
    
    return (
      <NavLink
        to={item.href}
        title={item.name}
        aria-label={item.name}
        style={ROW_PAD}
        className={cn(
          'nav-link group relative gap-2.5 px-2.5 py-1.5 text-[13px]'+SHORT_ROW,
          collapsed && 'justify-center',
          isActive && 'active bg-white/10'
        )}
      >
        <item.icon className={cn(
          'h-5 w-5 shrink-0 transition-colors',
          isActive ? 'text-white' : 'text-muted-foreground group-hover:text-foreground'
        )} />
        {!collapsed ? (
          <span className={cn(
            'truncate transition-colors',
            isActive ? 'font-semibold text-white' : ''
          )}>
            {renderName(item.name)}
          </span>
        ) : (
          <span className="sr-only" aria-hidden="true">{item.name}</span>
        )}
        {isActive && (
          <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-[#9f1239]" />
        )}
      </NavLink>
    );
  };

  const renderChildItems = (children: SidebarItem[] | undefined) => {
    if (!children || children.length === 0 || collapsed) return null;

    return (
      <div className="ml-6 mt-1 space-y-1">
        {children.map((child) => {
          const isChildActive = location.pathname === child.href;
          const isChildDisabled = child.requiresEngagement && !hasEngagement;

          if (isChildDisabled) {
            return (
              <div
                key={child.name}
                className={cn('nav-link cursor-not-allowed opacity-50 py-1.5 text-xs')}
              >
                <child.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">
                  {renderName(child.name)}
                </span>
              </div>
            );
          }

          return (
            <NavLink
              key={child.name}
              to={child.href}
              className={cn('nav-link group py-1.5 text-xs', isChildActive && 'active')}
            >
              <child.icon className={cn(
                'h-4 w-4 shrink-0 transition-colors',
                isChildActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
              )} />
              <span className={cn('truncate transition-colors', isChildActive && 'text-primary font-medium')}>
                {renderName(child.name)}
              </span>
            </NavLink>
          );
        })}
      </div>
    );
  };

  return (
    <aside
      data-shell="sidebar"
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out',
        collapsed ? 'w-16' : 'w-64'
      )}
      style={{
        background: 'var(--gradient-sidebar)',
        // rows shown, for the fluid row padding (ROW_PAD); the Administration list depends on the role
        ['--nav-rows' as string]: navItems.length + secondaryNavItems.filter(item => (item.adminOnly ? isAdmin : ('staffOnly' in item && item.staffOnly) ? !isAdmin : true)).length,
      }}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center border-b border-sidebar-border h-[52px] px-4',
        collapsed ? 'justify-center' : 'justify-between'
      )}>
        {!collapsed && (
          <button
            onClick={handleLogoClick}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
          >
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="text-left">
              <h1 className="text-sm font-semibold leading-tight text-white">AuditPro</h1>
              <p className="text-xs leading-tight text-slate-300">Audit Management</p>
            </div>
          </button>
        )}
        {collapsed && (
          <button
            onClick={handleLogoClick}
            aria-label="Go to dashboard"
            className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer"
          >
            <Building2 className="h-5 w-5 text-primary-foreground" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
        <div className="space-y-1">
          {!collapsed && (
            <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Audit Workflow
            </p>
          )}
          {navItems.map((item) => (
            <div key={item.name}>
              <NavItem item={item} disabled={item.requiresEngagement && !hasEngagement} />
              {renderChildItems(item.children)}
            </div>
          ))}
        </div>

        <div className="pt-4 space-y-1">
          {!collapsed && (
            <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Administration
            </p>
          )}
          {secondaryNavItems
            .filter(item => {
              if (item.adminOnly) return isAdmin;
              if (item.staffOnly) return !isAdmin;
              return true;
            })
            .map((item) => (
              <NavItem 
                key={item.name} 
                item={item} 
                disabled={item.requiresEngagement && !hasEngagement} 
              />
          ))}
        </div>
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setManualCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'w-full justify-center text-muted-foreground hover:text-foreground hover:bg-sidebar-accent',
            !collapsed && 'justify-start'
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
