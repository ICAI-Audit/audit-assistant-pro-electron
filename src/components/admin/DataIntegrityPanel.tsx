import { useState, useMemo } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { getFsgEngagementSummary } from '@/lib/fsgEngagementSummary';
import { useAuth } from '@/contexts/AuthContext';

const db = getSQLiteClient();
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Search,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Archive,
  Trash2,
  Link2,
  Plus,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Unlink
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ProblemEngagement {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string;
  financial_year: string;
  status: string;
  created_at: string;
  problemType: 'orphan' | 'unlinked' | 'inactive_client';
}

interface ActiveClient {
  id: string;
  name: string;
  status: string;
}

interface ChildCounts {
  risks: number;
  review_notes: number;
  evidence_files: number;
  fsg_tb_rows: number;
  assignments: number;
}

export function DataIntegrityPanel() {
  const { user, profile } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  
  // Problem engagements by category
  const [orphans, setOrphans] = useState<ProblemEngagement[]>([]);
  const [unlinked, setUnlinked] = useState<ProblemEngagement[]>([]);
  const [inactiveClientEngagements, setInactiveClientEngagements] = useState<ProblemEngagement[]>([]);
  const [allClients, setAllClients] = useState<ActiveClient[]>([]);
  
  // Selection state - separate for each bucket
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<Set<string>>(new Set());
  const [selectedUnlinkedIds, setSelectedUnlinkedIds] = useState<Set<string>>(new Set());
  
  // Collapsible state
  const [orphansOpen, setOrphansOpen] = useState(true);
  const [unlinkedOpen, setUnlinkedOpen] = useState(true);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  
  // Reassign dialog state
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<ProblemEngagement | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [reassigning, setReassigning] = useState(false);
  
  // Create client dialog state
  const [createClientDialogOpen, setCreateClientDialogOpen] = useState(false);
  const [createClientTarget, setCreateClientTarget] = useState<ProblemEngagement | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientIndustry, setNewClientIndustry] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  
  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProblemEngagement | null>(null);
  const [archiving, setArchiving] = useState(false);
  
  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProblemEngagement | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [childCounts, setChildCounts] = useState<ChildCounts | null>(null);
  
  // Bulk action state
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [bulkReassignType, setBulkReassignType] = useState<'orphan' | 'unlinked'>('orphan');
  const [bulkArchiving, setBulkArchiving] = useState(false);

  const activeClients = useMemo(() => 
    allClients.filter(c => c.status === 'active'),
    [allClients]
  );

  const handleScan = async () => {
    setScanning(true);
    try {
      // Fetch ALL engagements
      const { data: engagements, error: engError } = await db
        .from('engagements')
        .select('id, name, client_id, client_name, financial_year, status, created_at')
        .execute();

      if (engError) throw engError;

      // Fetch all clients
      const { data: clients, error: clientError } = await db
        .from('clients')
        .select('id, name, status')
        .execute();

      if (clientError) throw clientError;

      const clientMap = new Map(clients?.map(c => [c.id, c]) || []);
      setAllClients(clients || []);

      // Categorize engagements
      const orphanList: ProblemEngagement[] = [];
      const unlinkedList: ProblemEngagement[] = [];
      const inactiveClientList: ProblemEngagement[] = [];

      (engagements || []).forEach(e => {
        if (e.client_id === null) {
          // Unlinked: client_id is NULL
          unlinkedList.push({ ...e, problemType: 'unlinked' });
        } else {
          const client = clientMap.get(e.client_id);
          if (!client) {
            // Orphan: client_id exists but client row missing
            orphanList.push({ ...e, problemType: 'orphan' });
          } else if (client.status !== 'active') {
            // Has client but client is inactive
            inactiveClientList.push({ ...e, problemType: 'inactive_client' });
          }
        }
      });

      setOrphans(orphanList);
      setUnlinked(unlinkedList);
      setInactiveClientEngagements(inactiveClientList);
      setScanned(true);
      setSelectedOrphanIds(new Set());
      setSelectedUnlinkedIds(new Set());
      
      const totalProblems = orphanList.length + unlinkedList.length;
      if (totalProblems === 0) {
        toast.success('All clear! No orphan or unlinked engagements found.');
      } else {
        toast.warning(`Found ${totalProblems} problem engagement(s): ${orphanList.length} orphan, ${unlinkedList.length} unlinked`);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to scan for problems');
    } finally {
      setScanning(false);
    }
  };

  const checkEngagementChildren = async (engagementId: string): Promise<ChildCounts> => {
    const [risks, notes, evidence, tb, assignments] = await Promise.all([
      db.from('risks').select('id').eq('engagement_id', engagementId).execute().then(r => ({ count: r.data?.length || 0 })),
      db.from('review_notes').select('id').eq('engagement_id', engagementId).execute().then(r => ({ count: r.data?.length || 0 })),
      db.from('evidence_files').select('id').eq('engagement_id', engagementId).execute().then(r => ({ count: r.data?.length || 0 })),
      getFsgEngagementSummary(engagementId).then(s => ({ count: s?.current.totalRows || 0 })),
      db.from('engagement_assignments').select('id').eq('engagement_id', engagementId).execute().then(r => ({ count: r.data?.length || 0 })),
    ]);

    return {
      risks: risks.count || 0,
      review_notes: notes.count || 0,
      evidence_files: evidence.count || 0,
      fsg_tb_rows: tb.count || 0,
      assignments: assignments.count || 0,
    };
  };

  const hasChildren = (counts: ChildCounts): boolean => {
    return (
      counts.risks > 0 ||
      counts.review_notes > 0 ||
      counts.evidence_files > 0 ||
      counts.fsg_tb_rows > 0
    );
  };

  // Reassign action
  const handleReassign = async () => {
    if (!reassignTarget || !selectedClientId) return;
    
    setReassigning(true);
    try {
      const selectedClient = activeClients.find(c => c.id === selectedClientId);
      const { error } = await db
        .from('engagements')
        .update({ 
          client_id: selectedClientId,
          client_name: selectedClient?.name || reassignTarget.client_name
        })
        .eq('id', reassignTarget.id)
        .execute();

      if (error) throw error;
      toast.success('Engagement reassigned successfully');
      setReassignDialogOpen(false);
      setReassignTarget(null);
      setSelectedClientId('');
      handleScan();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reassign engagement');
    } finally {
      setReassigning(false);
    }
  };

  // Create client and link
  const handleCreateClient = async () => {
    if (!createClientTarget || !newClientName.trim()) return;
    
    // Check if client with same name exists
    const existingClient = allClients.find(
      c => c.name.toLowerCase() === newClientName.trim().toLowerCase()
    );
    
    if (existingClient) {
      toast.error(`Client "${newClientName}" already exists. Please use "Reassign" instead.`);
      return;
    }
    
    setCreatingClient(true);
    try {
      // Create client
      const { data: newClient, error: createError } = await db
        .from('clients')
        .insert({
          name: newClientName.trim(),
          industry: newClientIndustry.trim() || 'General',
          created_by: user?.id || 'system',
          status: 'active'
        })
        .execute();

      if (createError) throw createError;

      // Link engagement to new client
      const { error: updateError } = await db
        .from('engagements')
        .update({ 
          client_id: newClient.id,
          client_name: newClient.name
        })
        .eq('id', createClientTarget.id)
        .execute();

      if (updateError) throw updateError;

      toast.success(`Created client "${newClient.name}" and linked engagement`);
      setCreateClientDialogOpen(false);
      setCreateClientTarget(null);
      setNewClientName('');
      setNewClientIndustry('');
      handleScan();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create client');
    } finally {
      setCreatingClient(false);
    }
  };

  // Archive action
  const handleArchive = async () => {
    if (!archiveTarget) return;
    
    setArchiving(true);
    try {
      const { error } = await db
        .from('engagements')
        .update({ status: 'archived' })
        .eq('id', archiveTarget.id)
        .execute();

      if (error) throw error;
      toast.success('Engagement archived successfully');
      setArchiveDialogOpen(false);
      setArchiveTarget(null);
      handleScan();
    } catch (error: any) {
      toast.error(error.message || 'Failed to archive engagement');
    } finally {
      setArchiving(false);
    }
  };

  // Delete action
  const handleOpenDelete = async (engagement: ProblemEngagement) => {
    setDeleteTarget(engagement);
    setDeleteConfirmText('');
    const counts = await checkEngagementChildren(engagement.id);
    setChildCounts(counts);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleteConfirmText !== 'DELETE') return;
    
    if (childCounts && hasChildren(childCounts)) {
      toast.error('Cannot delete: engagement has linked data. Archive instead.');
      return;
    }
    
    setDeleting(true);
    try {
      const { error } = await db
        .from('engagements')
        .delete()
        .eq('id', deleteTarget.id)
        .execute();

      if (error) throw error;
      toast.success('Engagement deleted permanently');
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      setChildCounts(null);
      handleScan();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete engagement');
    } finally {
      setDeleting(false);
    }
  };

  // Bulk actions
  const handleBulkArchive = async (type: 'orphan' | 'unlinked') => {
    const selectedIds = type === 'orphan' ? selectedOrphanIds : selectedUnlinkedIds;
    if (selectedIds.size === 0) return;
    
    setBulkArchiving(true);
    try {
      // Update each engagement individually (SQLite client doesn't support .in())
      const updates = Array.from(selectedIds).map(id =>
        db
          .from('engagements')
          .update({ status: 'archived' })
          .eq('id', id)
          .execute()
      );
      
      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      
      if (errors.length > 0) throw new Error(`Failed to archive ${errors.length} engagement(s)`);
      
      toast.success(`${selectedIds.size} engagement(s) archived`);
      handleScan();
    } catch (error: any) {
      toast.error(error.message || 'Failed to archive engagements');
    } finally {
      setBulkArchiving(false);
    }
  };

  const handleBulkReassign = async () => {
    const selectedIds = bulkReassignType === 'orphan' ? selectedOrphanIds : selectedUnlinkedIds;
    if (selectedIds.size === 0 || !selectedClientId) return;
    
    setReassigning(true);
    try {
      const selectedClient = activeClients.find(c => c.id === selectedClientId);
      
      // Update each engagement individually (SQLite client doesn't support .in())
      const updates = Array.from(selectedIds).map(id =>
        db
          .from('engagements')
          .update({ 
            client_id: selectedClientId,
            client_name: selectedClient?.name || ''
          })
          .eq('id', id)
          .execute()
      );
      
      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      
      if (errors.length > 0) throw new Error(`Failed to reassign ${errors.length} engagement(s)`);
      toast.success(`${selectedIds.size} engagement(s) reassigned`);
      setBulkReassignOpen(false);
      setSelectedClientId('');
      handleScan();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reassign engagements');
    } finally {
      setReassigning(false);
    }
  };

  const toggleSelect = (id: string, type: 'orphan' | 'unlinked') => {
    const setter = type === 'orphan' ? setSelectedOrphanIds : setSelectedUnlinkedIds;
    const current = type === 'orphan' ? selectedOrphanIds : selectedUnlinkedIds;
    
    const newSet = new Set(current);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setter(newSet);
  };

  const toggleSelectAll = (type: 'orphan' | 'unlinked') => {
    const list = type === 'orphan' ? orphans : unlinked;
    const current = type === 'orphan' ? selectedOrphanIds : selectedUnlinkedIds;
    const setter = type === 'orphan' ? setSelectedOrphanIds : setSelectedUnlinkedIds;
    
    if (current.size === list.length) {
      setter(new Set());
    } else {
      setter(new Set(list.map(o => o.id)));
    }
  };

  const totalProblems = orphans.length + unlinked.length;
  const allClear = scanned && totalProblems === 0;

  const renderEngagementTable = (
    items: ProblemEngagement[],
    type: 'orphan' | 'unlinked' | 'inactive_client',
    selectedIds?: Set<string>
  ) => {
    if (items.length === 0) return null;
    
    const showCheckbox = type !== 'inactive_client';
    
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {showCheckbox && (
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedIds?.size === items.length && items.length > 0}
                  onCheckedChange={() => toggleSelectAll(type as 'orphan' | 'unlinked')}
                />
              </TableHead>
            )}
            <TableHead>Engagement Name</TableHead>
            <TableHead>Stored Client Name</TableHead>
            {type === 'orphan' && <TableHead>Client ID (orphan)</TableHead>}
            <TableHead>Financial Year</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-40">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              {showCheckbox && (
                <TableCell>
                  <Checkbox
                    checked={selectedIds?.has(item.id)}
                    onCheckedChange={() => toggleSelect(item.id, type as 'orphan' | 'unlinked')}
                  />
                </TableCell>
              )}
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>{item.client_name || '—'}</TableCell>
              {type === 'orphan' && (
                <TableCell>
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {item.client_id?.slice(0, 8)}...
                  </code>
                </TableCell>
              )}
              <TableCell>{item.financial_year}</TableCell>
              <TableCell>
                <Badge variant={item.status === 'archived' ? 'secondary' : 'default'}>
                  {item.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {format(new Date(item.created_at), 'dd MMM yyyy')}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setReassignTarget(item);
                      setSelectedClientId('');
                      setReassignDialogOpen(true);
                    }}
                    title="Reassign to client"
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                  {type === 'unlinked' && item.client_name && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary"
                      onClick={() => {
                        setCreateClientTarget(item);
                        setNewClientName(item.client_name || '');
                        setNewClientIndustry('');
                        setCreateClientDialogOpen(true);
                      }}
                      title="Create client from name"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-amber-600"
                    onClick={() => {
                      setArchiveTarget(item);
                      setArchiveDialogOpen(true);
                    }}
                    title="Archive engagement"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleOpenDelete(item)}
                    title="Delete permanently"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <Card className="mt-6 border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-lg">Data Integrity</CardTitle>
        </div>
        <CardDescription>
          Scan for and fix orphan engagements (missing client) and unlinked engagements (no client_id)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Scan button and status */}
          <div className="flex items-center gap-4">
            <Button onClick={handleScan} disabled={scanning}>
              {scanning ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Scan for Problems
            </Button>
            
            {scanned && (
              <div className="flex items-center gap-2">
                {allClear ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-green-600 font-medium">All clear!</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <span className="text-amber-600 font-medium">
                      {totalProblems} problem(s) found
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Summary counters */}
          {scanned && (
            <div className="flex flex-wrap gap-2">
              <Badge variant={unlinked.length > 0 ? 'destructive' : 'secondary'} className="gap-1">
                <Unlink className="h-3 w-3" />
                Unlinked: {unlinked.length}
              </Badge>
              <Badge variant={orphans.length > 0 ? 'destructive' : 'secondary'} className="gap-1">
                <AlertCircle className="h-3 w-3" />
                Orphan: {orphans.length}
              </Badge>
              {inactiveClientEngagements.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  Inactive Client: {inactiveClientEngagements.length}
                </Badge>
              )}
            </div>
          )}

          {/* Unlinked Engagements Section */}
          {scanned && unlinked.length > 0 && (
            <Collapsible open={unlinkedOpen} onOpenChange={setUnlinkedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                  <div className="flex items-center gap-2">
                    {unlinkedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Unlink className="h-4 w-4 text-destructive" />
                    <span className="font-medium">Unlinked Engagements ({unlinked.length})</span>
                  </div>
                  <span className="text-xs text-muted-foreground">client_id is NULL</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                {/* Bulk actions for unlinked */}
                {selectedUnlinkedIds.size > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-2">
                    <span className="text-sm font-medium">{selectedUnlinkedIds.size} selected</span>
                    <Button size="sm" variant="outline" onClick={() => handleBulkArchive('unlinked')} disabled={bulkArchiving}>
                      {bulkArchiving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      <Archive className="h-3 w-3 mr-1" />
                      Archive Selected
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setBulkReassignType('unlinked');
                      setBulkReassignOpen(true);
                    }}>
                      <Link2 className="h-3 w-3 mr-1" />
                      Reassign Selected
                    </Button>
                  </div>
                )}
                {renderEngagementTable(unlinked, 'unlinked', selectedUnlinkedIds)}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Orphan Engagements Section */}
          {scanned && orphans.length > 0 && (
            <Collapsible open={orphansOpen} onOpenChange={setOrphansOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                  <div className="flex items-center gap-2">
                    {orphansOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span className="font-medium">Orphan Engagements ({orphans.length})</span>
                  </div>
                  <span className="text-xs text-muted-foreground">client_id exists but client missing</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                {/* Bulk actions for orphans */}
                {selectedOrphanIds.size > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-2">
                    <span className="text-sm font-medium">{selectedOrphanIds.size} selected</span>
                    <Button size="sm" variant="outline" onClick={() => handleBulkArchive('orphan')} disabled={bulkArchiving}>
                      {bulkArchiving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      <Archive className="h-3 w-3 mr-1" />
                      Archive Selected
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setBulkReassignType('orphan');
                      setBulkReassignOpen(true);
                    }}>
                      <Link2 className="h-3 w-3 mr-1" />
                      Reassign Selected
                    </Button>
                  </div>
                )}
                {renderEngagementTable(orphans, 'orphan', selectedOrphanIds)}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Inactive Client Engagements Section (info only) */}
          {scanned && inactiveClientEngagements.length > 0 && (
            <Collapsible open={inactiveOpen} onOpenChange={setInactiveOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                  <div className="flex items-center gap-2">
                    {inactiveOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-muted-foreground">
                      Inactive Client ({inactiveClientEngagements.length})
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">client exists but is inactive</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                {renderEngagementTable(inactiveClientEngagements, 'inactive_client')}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        {/* Reassign Dialog */}
        <Dialog open={reassignDialogOpen} onOpenChange={setReassignDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reassign Engagement</DialogTitle>
              <DialogDescription>
                Select an active client to reassign "{reassignTarget?.name}" to.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Client</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a client..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeClients.map(client => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReassignDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleReassign} disabled={!selectedClientId || reassigning}>
                {reassigning && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Reassign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Client Dialog */}
        <Dialog open={createClientDialogOpen} onOpenChange={setCreateClientDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Client & Link</DialogTitle>
              <DialogDescription>
                Create a new client from the engagement's stored name and link it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Client Name</Label>
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Client name"
                />
              </div>
              <div className="space-y-2">
                <Label>Industry</Label>
                <Input
                  value={newClientIndustry}
                  onChange={(e) => setNewClientIndustry(e.target.value)}
                  placeholder="e.g., Manufacturing (optional)"
                />
              </div>
              {allClients.some(c => c.name.toLowerCase() === newClientName.trim().toLowerCase()) && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    A client with this name already exists. Use "Reassign" instead.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateClientDialogOpen(false)}>Cancel</Button>
              <Button 
                onClick={handleCreateClient} 
                disabled={!newClientName.trim() || creatingClient || allClients.some(c => c.name.toLowerCase() === newClientName.trim().toLowerCase())}
              >
                {creatingClient && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create & Link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Reassign Dialog */}
        <Dialog open={bulkReassignOpen} onOpenChange={setBulkReassignOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bulk Reassign Engagements</DialogTitle>
              <DialogDescription>
                Reassign {bulkReassignType === 'orphan' ? selectedOrphanIds.size : selectedUnlinkedIds.size} selected engagement(s) to a new client.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Client</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a client..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeClients.map(client => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkReassignOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkReassign} disabled={!selectedClientId || reassigning}>
                {reassigning && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Reassign All
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Archive Confirmation */}
        <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive Engagement?</AlertDialogTitle>
              <AlertDialogDescription>
                This will mark "{archiveTarget?.name}" as archived. It will be preserved for audit history but removed from active lists.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleArchive} disabled={archiving}>
                {archiving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Confirmation with double-check */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Permanently Delete Engagement?
              </DialogTitle>
              <DialogDescription>
                This action is IRREVERSIBLE. The engagement "{deleteTarget?.name}" and all its data will be permanently deleted.
              </DialogDescription>
            </DialogHeader>
            
            {childCounts && hasChildren(childCounts) ? (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="font-medium text-destructive mb-2">Cannot delete: Linked data exists</p>
                <ul className="text-sm space-y-1">
                  {childCounts.risks > 0 && <li>• {childCounts.risks} risk(s)</li>}
                  {childCounts.review_notes > 0 && <li>• {childCounts.review_notes} review note(s)</li>}
                  {childCounts.evidence_files > 0 && <li>• {childCounts.evidence_files} evidence file(s)</li>}
                  {childCounts.fsg_tb_rows > 0 && <li>• {childCounts.fsg_tb_rows} Financial Statement Review trial balance row(s) for this client and year</li>}
                </ul>
                <p className="text-sm mt-2 text-muted-foreground">
                  Please archive this engagement instead to preserve audit history.
                </p>
              </div>
            ) : (
              <div className="space-y-4 py-4">
                <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Type <strong>DELETE</strong> below to confirm permanent deletion.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Confirmation</Label>
                  <Input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE to confirm"
                  />
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              {childCounts && hasChildren(childCounts) ? (
                <Button 
                  variant="outline"
                  onClick={() => {
                    setDeleteDialogOpen(false);
                    if (deleteTarget) {
                      setArchiveTarget(deleteTarget);
                      setArchiveDialogOpen(true);
                    }
                  }}
                >
                  <Archive className="h-4 w-4 mr-2" />
                  Archive Instead
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteConfirmText !== 'DELETE' || deleting}
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Delete Permanently
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
