import { BuildInfoLabel } from '@/components/layout/BuildInfoLabel';
import { Bell, Search, User, ChevronDown, LogOut, Settings, Check, Trash2, MessageSquare, FileText, Briefcase, ArrowLeftRight, Keyboard, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/contexts/EngagementContext';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { useAutoUpdater } from '@/hooks/useAutoUpdater';
import { VersionBadge } from '@/components/UpdateNotifications';

export function Header() {
  const { profile, role, signOut } = useAuth();
  const { currentEngagement, engagements, setCurrentEngagement, clearEngagement } = useEngagement();
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAll } = useNotifications();
  const { currentVersion, isBeta, checkForUpdates, isCheckingForUpdates } = useAutoUpdater();

  const handleSignOut = async () => {
    clearEngagement();
    await signOut();
    navigate('/auth', { replace: true });
  };

  const handleSwitchEngagement = (engagement: typeof engagements[0]) => {
    setCurrentEngagement(engagement);
  };

  const handleGoToSelector = () => {
    clearEngagement();
    navigate('/select-engagement');
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'review_note_assigned':
        return <MessageSquare className="h-4 w-4 text-primary" />;
      case 'review_note_responded':
        return <FileText className="h-4 w-4 text-info" />;
      default:
        return <Bell className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getRoleLabel = (role: string | null) => {
    if (!role) return 'Team Member';
    return role.charAt(0).toUpperCase() + role.slice(1);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Filter out current engagement from the list
  const otherEngagements = engagements.filter(e => e.id !== currentEngagement?.id);

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between gap-4 px-6">
      {/* Left: Current Engagement */}
      <div className="flex items-center gap-4 min-w-0">
        <BuildInfoLabel compact className="hidden md:block shrink-0 px-2 py-1 text-[11px] leading-tight" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 text-foreground hover:bg-muted max-w-xs">
              <Briefcase className="h-4 w-4 text-primary shrink-0" />
              <div className="text-left truncate">
                {currentEngagement ? (
                  <>
                    <span className="font-medium truncate">{currentEngagement.client_name}</span>
                    <span className="text-muted-foreground ml-1">- {currentEngagement.financial_year}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No engagement selected</span>
                )}
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <DropdownMenuLabel>Switch Engagement</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <ScrollArea className="max-h-64">
              {otherEngagements.length === 0 ? (
                <div className="px-2 py-4 text-center text-muted-foreground text-sm">
                  No other engagements available
                </div>
              ) : (
                otherEngagements.slice(0, 5).map((engagement) => (
                  <DropdownMenuItem
                    key={engagement.id}
                    onClick={() => handleSwitchEngagement(engagement)}
                    className="cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{engagement.client_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {engagement.name} â€¢ {engagement.financial_year}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </ScrollArea>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleGoToSelector} className="cursor-pointer">
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              View All Engagements
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Center: Search */}
      <div className="flex-1 max-w-xl mx-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search evidence, notes..."
            className="pl-10 bg-muted/50 border-border focus:bg-background"
          />
        </div>
      </div>

      {/* Right: Version, Updates & Actions */}
      <div className="flex items-center gap-3">
        {/* Version badge */}
        <VersionBadge version={currentVersion || 'â€”'} isBeta={isBeta} />

        {/* Manual update check button */}
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={checkForUpdates}
          disabled={isCheckingForUpdates}
          title="Check for updates"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">
            {isCheckingForUpdates ? 'Checkingâ€¦' : 'Check for updates'}
          </span>
        </Button>

        {/* Other header actions */}
        {/* Keyboard Shortcuts Button */}
        <Button 
          variant="ghost" 
          size="icon" 
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            // Trigger the keyboard shortcuts dialog
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true }));
          }}
          title="Keyboard Shortcuts (Ctrl+/)"
        >
          <Keyboard className="h-5 w-5" />
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-4 w-4 bg-destructive rounded-full text-[10px] text-destructive-foreground flex items-center justify-center font-medium">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <h4 className="font-semibold text-sm">Notifications</h4>
              <div className="flex gap-1">
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllAsRead}>
                    <Check className="h-3 w-3 mr-1" />
                    Mark all read
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={clearAll}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <ScrollArea className="max-h-80">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-3 hover:bg-muted/50 cursor-pointer transition-colors ${
                        !notification.is_read ? 'bg-primary/5' : ''
                      }`}
                      onClick={() => {
                        markAsRead(notification.id);
                        if (notification.link) {
                          navigate(notification.link);
                        }
                      }}
                    >
                      <div className="flex gap-3">
                        <div className="mt-0.5">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${!notification.is_read ? 'font-medium' : ''}`}>
                            {notification.title}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {notification.message}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notification.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.full_name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-medium text-primary">
                    {profile?.full_name ? getInitials(profile.full_name) : <User className="h-4 w-4" />}
                  </span>
                )}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium text-foreground">
                  {profile?.full_name || 'User'}
                </p>
                <p className="text-xs text-muted-foreground">{getRoleLabel(role)}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground font-normal">{profile?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
