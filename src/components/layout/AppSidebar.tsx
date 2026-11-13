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

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const { currentEngagement } = useEngagement();
  const isAdmin = role === 'partner' || role === 'manager' || role === 'admin';
  const hasEngagement = !!currentEngagement;

  useEffect(() => {
    setCollapsed(false);
  }, [user?.id]);

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
            'underline underline-offset-2',
            useDoubleUnderline && 'decoration-double'
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
            'nav-link group relative cursor-not-allowed opacity-50',
          )}
        >
          <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          {!collapsed && (
            <span className="truncate text-muted-foreground">
              {renderName(item.name)}
            </span>
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
        className={cn(
          'nav-link group relative',
          isActive && 'active'
        )}
      >
        <item.icon className={cn(
          'h-5 w-5 shrink-0 transition-colors',
          isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
        )} />
        {!collapsed && (
          <span className={cn(
            'truncate transition-colors',
            isActive ? 'text-primary font-medium' : ''
          )}>
            {renderName(item.name)}
          </span>
        )}
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-primary rounded-r" />
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
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out',
        collapsed ? 'w-16' : 'w-64'
      )}
      style={{ background: 'var(--gradient-sidebar)' }}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center border-b border-sidebar-border h-16 px-4',
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
              <h1 className="font-semibold text-foreground text-sm">AuditPro</h1>
              <p className="text-xs text-muted-foreground">Audit Management</p>
            </div>
          </button>
        )}
        {collapsed && (
          <button
            onClick={handleLogoClick}
            className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer"
          >
            <Building2 className="h-5 w-5 text-primary-foreground" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
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
          onClick={() => setCollapsed(!collapsed)}
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
