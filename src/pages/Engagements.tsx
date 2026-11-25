import { useState, useEffect, useMemo } from 'react';
import { useEngagements, type Engagement } from '@/hooks/useEngagements';
import { useClients } from '@/hooks/useClients';
import { useFinancialYears } from '@/hooks/useFinancialYears';
import { useEngagement } from '@/contexts/EngagementContext';
import { StatusBadge, getStatusVariant } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Search, Calendar, Users, Building2, Loader2, MoreVertical, Download, UserPlus, AlertTriangle, Wrench } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { generateEngagementReport } from '@/utils/generateEngagementReport';
import { toast } from 'sonner';
import { TeamAssignmentDialog } from '@/components/engagements/TeamAssignmentDialog';
import { ClientCombobox } from '@/components/engagements/ClientCombobox';
import { CreateClientDialog } from '@/components/engagements/CreateClientDialog';
import { useNavigate } from 'react-router-dom';

export default function Engagements() {
  // State declarations
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  
  // Form state - now tracks both client name and ID
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientName, setClientName] = useState('');
  const [engagementName, setEngagementName] = useState('');
  const [engagementType, setEngagementType] = useState('statutory');
  const [financialYear, setFinancialYear] = useState('');
  const [newEngagementId, setNewEngagementId] = useState<string | null>(null);
  const [newEngagementName, setNewEngagementName] = useState<string | null>(null);
  const [showTeamDialog, setShowTeamDialog] = useState(false);

  const { engagements, loading, createEngagement } = useEngagements();
  const { clients, refetch: refetchClients } = useClients();
  const { financialYears } = useFinancialYears();
  const { currentEngagement, setCurrentEngagement } = useEngagement();
  const navigate = useNavigate();
  
  // Build a set of client IDs for detecting orphan engagements
  const clientIdsSet = useMemo(() => new Set(clients.map(c => c.id)), [clients]);
  
  // Helper to check engagement status
  const getEngagementIssue = (engagement: Engagement) => {
    if (!engagement.client_id) {
      return { type: 'unlinked' as const, label: 'Unlinked', tooltip: 'Not linked to a client. Fix in Admin Settings → Clients → Data Integrity.' };
    }
    if (!clientIdsSet.has(engagement.client_id)) {
      return { type: 'orphan' as const, label: 'Orphan', tooltip: 'Client record missing. Fix in Admin Settings → Clients → Data Integrity.' };
    }
    return null;
  };
  

  // When client name changes, find matching client ID
  useEffect(() => {
    if (clientName) {
      const normalizedName = clientName.trim().toLowerCase();
      const matchingClient = clients.find(c => c.name.trim().toLowerCase() === normalizedName);
      if (matchingClient) {
        setSelectedClientId(matchingClient.id);
      } else {
        setSelectedClientId('');
      }
    } else {
      setSelectedClientId('');
    }
  }, [clientName, clients]);

  const filteredEngagements = engagements.filter(
    (e) =>
      e.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = async () => {
    if (!clientName || !engagementName || !financialYear) return;
    
    // Require valid client_id - prevent unlinked engagements
    if (!selectedClientId) {
      toast.error('Please select a valid client or create a new one first.');
      return;
    }
    
    const pendingEngagementName = engagementName.trim();
    setCreating(true);
    try {
      const newEngagement = await createEngagement({
        name: engagementName,
        client_name: clientName,
        client_id: selectedClientId, // Always set client_id
        engagement_type: engagementType,
        financial_year: financialYear,
        status: 'planning',
        start_date: null,
        end_date: null,
        partner_id: null,
        manager_id: null,
        materiality_amount: null,
        performance_materiality: null,
        trivial_threshold: null,
        notes: null,
      });
      
      // Reset form
      setClientName('');
      setSelectedClientId('');
      setEngagementName('');
      setEngagementType('statutory');
      setFinancialYear('');
      setIsDialogOpen(false);
      
      // Open team assignment dialog for the new engagement
      if (newEngagement?.id) {
        setNewEngagementId(newEngagement.id);
        setNewEngagementName(newEngagement.name || pendingEngagementName || 'New Engagement');
        setShowTeamDialog(true);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async (engagement: any) => {
    setExportingId(engagement.id);
    try {
      await generateEngagementReport(engagement);
      toast.success('Report exported successfully');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export report');
    } finally {
      setExportingId(null);
    }
  };

  const handleClientCreated = (newClientName: string, newClientId: string) => {
    setClientName(newClientName);
    setSelectedClientId(newClientId);
    refetchClients();
  };

  const handleSelectEngagement = async (engagement: Engagement) => {
    if (!(await setCurrentEngagement(engagement))) return;
    toast.success(`Switched to ${engagement.client_name} - ${engagement.financial_year}`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Assignments</h1>
          <p className="text-muted-foreground mt-1">Manage all Assurance Assignments</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Engagement
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Engagement</DialogTitle>
              <DialogDescription>
                Set up a new audit engagement for a client.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name</Label>
                <ClientCombobox
                  clients={clients}
                  value={clientName}
                  onSelect={setClientName}
                  onCreateNew={() => setCreateClientOpen(true)}
                />
                {clientName && !selectedClientId && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This client doesn't exist. Please create a new client first.
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => setCreateClientOpen(true)}
                    >
                      Create client
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="engagementName">Engagement Name</Label>
                <Input 
                  id="engagementName" 
                  placeholder="e.g., Statutory Audit FY 2024-25"
                  value={engagementName}
                  onChange={(e) => setEngagementName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Engagement Type</Label>
                <Select value={engagementType} onValueChange={setEngagementType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="statutory">Statutory Audit</SelectItem>
                    <SelectItem value="internal">Internal Audit</SelectItem>
                    <SelectItem value="tax">Tax Audit</SelectItem>
                    <SelectItem value="special">Special Audit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="financialYear">Financial Year</Label>
                <Select value={financialYear} onValueChange={setFinancialYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select financial year" />
                  </SelectTrigger>
                  <SelectContent>
                    {financialYears.map((fy) => (
                      <SelectItem key={fy.id} value={fy.year_code}>
                        {fy.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreate}
                disabled={!selectedClientId || !engagementName || !financialYear || creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Engagement'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search engagements..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Engagements Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="audit-card">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div>
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))
        ) : filteredEngagements.length === 0 ? (
          <div className="col-span-full audit-card text-center py-12">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">No engagements found</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first engagement
            </Button>
          </div>
        ) : (
          filteredEngagements.map((engagement) => {
            const issue = getEngagementIssue(engagement);
            return (
            <div
              key={engagement.id}
              className={`audit-card hover:border-primary/50 transition-all ${issue ? 'border-destructive/50' : ''} ${currentEngagement?.id === engagement.id ? 'border-primary/60 ring-1 ring-primary/20' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectEngagement(engagement)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelectEngagement(engagement);
                }
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{engagement.client_name}</h3>
                      {issue && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                issue.type === 'orphan' 
                                  ? 'bg-destructive/15 text-destructive border border-destructive/20' 
                                  : 'bg-warning/15 text-warning border border-warning/20'
                              }`}>
                                <AlertTriangle className="h-3 w-3" />
                                {issue.label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">{issue.tooltip}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{engagement.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge variant={getStatusVariant(engagement.status)}>
                    {engagement.status}
                  </StatusBadge>
                  {currentEngagement?.id === engagement.id && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      Active
                    </span>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {exportingId === engagement.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreVertical className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleExport(engagement)}>
                        <Download className="h-4 w-4 mr-2" />
                        Export PDF Report
                      </DropdownMenuItem>
                      {issue && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => {
                              navigate('/admin/settings');
                              toast.info('Open Clients tab → Data Integrity to resolve this engagement.');
                            }}
                          >
                            <Wrench className="h-4 w-4 mr-2" />
                            Fix Data Issue
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <TeamAssignmentDialog
                            engagementId={engagement.id}
                            engagementName={engagement.name}
                            trigger={
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <UserPlus className="h-4 w-4" />
                                <span className="text-xs">Team</span>
                              </Button>
                            }
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Assign team members to this engagement</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">FY:</span>
                  <span className="text-foreground">{engagement.financial_year}</span>
                </div>
                {engagement.partner && (
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Partner:</span>
                    <span className="text-foreground">{engagement.partner.full_name}</span>
                  </div>
                )}

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <StatusBadge
                    variant={engagement.engagement_type === 'statutory' ? 'info' : 'default'}
                    dot={false}
                  >
                    {engagement.engagement_type}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(engagement.created_at), 'dd MMM yyyy')}
                  </span>
                </div>
              </div>
            </div>
          );
          })
        )}
      </div>

      {/* Create Client Dialog */}
      <CreateClientDialog
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        onClientCreated={handleClientCreated}
      />

      {/* Team Assignment Dialog for newly created engagement */}
      {newEngagementId && (
        <TeamAssignmentDialog
          engagementId={newEngagementId}
          engagementName={newEngagementName || 'New Engagement'}
          trigger={<span />}
          open={showTeamDialog}
          onOpenChange={(open) => {
            setShowTeamDialog(open);
            if (!open) {
              setNewEngagementId(null);
              setNewEngagementName(null);
            }
          }}
        />
      )}
    </div>
  );
}

