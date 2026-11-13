import { useState, useEffect } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';

const db = getSQLiteClient();
import { useAuth } from '@/contexts/AuthContext';
import { useEngagement } from '@/contexts/EngagementContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EngagementLetterTemplateManager } from '@/components/admin/EngagementLetterTemplateManager';
import {
  Settings,
  Building2,
  Users,
  UserCog,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Shield,
  KeyRound,
  CalendarDays,
  Landmark,
  FileSignature,
  UserCheck,
  UserX,
  MessageCircle,
  Mail,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { BulkClientImportDialog } from '@/components/admin/BulkClientImportDialog';
import { BulkTeamImportDialog } from '@/components/admin/BulkTeamImportDialog';
import { ClientFormDialog, ClientFormData } from '@/components/clients/ClientFormDialog';
import { PartnersTabContent } from '@/components/admin/PartnersTabContent';
import { DataIntegrityPanel } from '@/components/admin/DataIntegrityPanel';
import { CAROTemplatesTab } from '@/components/admin/CAROTemplatesTab';
interface FinancialYear {
  id: string;
  year_code: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

const ROLES = ['partner', 'manager', 'senior', 'staff', 'viewer'] as const;
interface Client {
  id: string;
  name: string;
  industry: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  pan: string | null;
  cin: string | null;
  state: string | null;
  pin: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

interface TeamMember {
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
}

export default function AdminSettings() {
  const { user } = useAuth();
  const { refreshEngagements } = useEngagement();
  const [activeTab, setActiveTab] = useState('firm');

  // Clients state
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [togglingClientStatus, setTogglingClientStatus] = useState<string | null>(null);

  // Team members state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ full_name: '', email: '', phone: '', role: 'staff' });
  const [savingTeam, setSavingTeam] = useState(false);

  // Financial years state
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([]);
  const [loadingFinancialYears, setLoadingFinancialYears] = useState(true);
  const [fyDialogOpen, setFyDialogOpen] = useState(false);
  const [fyForm, setFyForm] = useState({ year_code: '', display_name: '' });
  const [savingFy, setSavingFy] = useState(false);

  // Password reset state
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Firm settings state
  interface FirmSettings {
    id?: string;
    firm_name: string;
    icai_unique_sl_no: string;
    constitution: string;
    no_of_partners: number | null;
    firm_registration_no: string;
    address: string;
    place: string;
  }
  const [firmSettings, setFirmSettings] = useState<FirmSettings>({
    firm_name: '',
    icai_unique_sl_no: '',
    constitution: '',
    no_of_partners: null,
    firm_registration_no: '',
    address: '',
    place: '',
  });
  const [loadingFirm, setLoadingFirm] = useState(true);
  const [savingFirm, setSavingFirm] = useState(false);


  useEffect(() => {
    fetchClients();
    fetchMembers();
    fetchFinancialYears();
    fetchFirmSettings();
  }, []);

  // ===================== FINANCIAL YEARS =====================
  const fetchFinancialYears = async () => {
    setLoadingFinancialYears(true);
    try {
      const { data, error } = await db
        .from('financial_years')
        .select('*')
        .order('year_code', { ascending: false })
        .execute();

      if (error) throw error;
      setFinancialYears(data || []);
    } catch (error) {
      console.error('Error fetching financial years:', error);
    } finally {
      setLoadingFinancialYears(false);
    }
  };

  const handleSaveFinancialYear = async () => {
    if (!fyForm.year_code.trim() || !fyForm.display_name.trim()) {
      toast.error('Year code and display name are required');
      return;
    }

    setSavingFy(true);
    try {
      const { error } = await db
        .from('financial_years')
        .insert({
          year_code: fyForm.year_code,
          display_name: fyForm.display_name,
          created_by: user?.id,
        })
        .execute();

      if (error) throw error;
      toast.success('Financial year added');
      setFyDialogOpen(false);
      setFyForm({ year_code: '', display_name: '' });
      fetchFinancialYears();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save financial year');
    } finally {
      setSavingFy(false);
    }
  };

  const handleToggleFinancialYear = async (id: string, isActive: boolean) => {
    try {
      const { error } = await db
        .from('financial_years')
        .update({ is_active: !isActive })
        .eq('id', id)
        .execute();

      if (error) throw error;
      toast.success(`Financial year ${isActive ? 'disabled' : 'enabled'}`);
      fetchFinancialYears();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update financial year');
    }
  };

  const handleDeleteFinancialYear = async (id: string) => {
    if (!confirm('Are you sure you want to delete this financial year?')) return;

    try {
      const { error } = await db.from('financial_years').delete().eq('id', id).execute();
      if (error) throw error;
      toast.success('Financial year deleted');
      fetchFinancialYears();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete financial year');
    }
  };

  // ===================== FIRM SETTINGS =====================
  const fetchFirmSettings = async () => {
    setLoadingFirm(true);
    try {
      const { data, error } = await db
        .from('firm_settings')
        .select('*')
        .limit(1)
        .single()
        .execute();

      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setFirmSettings({
          id: data.id,
          firm_name: data.firm_name || '',
          icai_unique_sl_no: data.icai_unique_sl_no || '',
          constitution: data.constitution || '',
          no_of_partners: data.no_of_partners,
          firm_registration_no: data.firm_registration_no || '',
          address: data.address || '',
          place: data.place || '',
        });
      }
    } catch (error) {
      console.error('Error fetching firm settings:', error);
    } finally {
      setLoadingFirm(false);
    }
  };

  const handleSaveFirmSettings = async () => {
    if (!firmSettings.firm_name.trim()) {
      toast.error('Firm name is required');
      return;
    }

    setSavingFirm(true);
    try {
      if (firmSettings.id) {
        const { error } = await db
          .from('firm_settings')
          .update({
            firm_name: firmSettings.firm_name,
            icai_unique_sl_no: firmSettings.icai_unique_sl_no || null,
            constitution: firmSettings.constitution || null,
            no_of_partners: firmSettings.no_of_partners,
            firm_registration_no: firmSettings.firm_registration_no || null,
            address: firmSettings.address || null,
            place: firmSettings.place.trim() || null,
          })
          .eq('id', firmSettings.id)
          .execute();
        if (error) throw error;
      } else {
        const { data, error } = await db
          .from('firm_settings')
          .insert({
            firm_name: firmSettings.firm_name,
            icai_unique_sl_no: firmSettings.icai_unique_sl_no || null,
            constitution: firmSettings.constitution || null,
            no_of_partners: firmSettings.no_of_partners,
            firm_registration_no: firmSettings.firm_registration_no || null,
            address: firmSettings.address || null,
            place: firmSettings.place.trim() || null,
            created_by: user?.id || 'system',
          })
          .select()
          .single()
          .execute();
        if (error) throw error;
        if (data) setFirmSettings(prev => ({ ...prev, id: data.id }));
      }
      toast.success('Firm settings saved');
      await fetchFirmSettings(); // Refresh to get updated data
    } catch (error: any) {
      toast.error(error.message || 'Failed to save firm settings');
    } finally {
      setSavingFirm(false);
    }
  };

  // ===================== CLIENTS =====================
  const fetchClients = async () => {
    setLoadingClients(true);
    try {
      const { data, error } = await db
        .from('clients')
        .select('*')
        .order('name')
        .execute();

      if (error) throw error;
      setClients(data || []);
      await refreshEngagements();
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setLoadingClients(false);
    }
  };

  const handleDeleteClient = async (id: string, clientName: string) => {
    // Check if client has engagements
    const { data: engagements, error: countError } = await db
      .from('engagements')
      .select('*')
      .eq('client_id', id)
      .execute();

    if (countError) {
      toast.error('Failed to check engagements');
      return;
    }

    const count = engagements?.length || 0;
    if (count > 0) {
      toast.error(`Cannot delete "${clientName}". This client has ${count} engagement(s). Consider deactivating instead.`);
      return;
    }

    if (!confirm('Are you sure you want to delete this client?')) return;

    try {
      const { error } = await db.from('clients').delete().eq('id', id).execute();
      if (error) {
        // Handle FK violation specifically
        if (error.code === '23503' || error.message?.includes('violates foreign key constraint')) {
          toast.error(`Cannot delete "${clientName}": engagements exist. Deactivate client instead.`);
        } else {
          throw error;
        }
        return;
      }
      toast.success('Client deleted');
      fetchClients();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete client');
    }
  };

  const handleToggleClientStatus = async (client: Client) => {
    const newStatus = client.status === 'active' ? 'inactive' : 'active';
    setTogglingClientStatus(client.id);

    try {
      const { error } = await db
        .from('clients')
        .update({ status: newStatus })
        .eq('id', client.id)
        .execute();

      if (error) throw error;
      toast.success(`Client ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      fetchClients();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update client status');
    } finally {
      setTogglingClientStatus(null);
    }
  };

  // ===================== MEMBERS =====================
  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const { data: profiles, error: profilesError } = await db
        .from('profiles')
        .select('user_id, full_name, email, phone')
        .execute();

      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await db
        .from('user_roles')
        .select('user_id, role')
        .execute();

      if (rolesError) throw rolesError;

      const membersWithRoles = (profiles || []).map(p => ({
        ...p,
        phone: p.phone || null,
        role: roles?.find(r => r.user_id === p.user_id)?.role || 'staff'
      }));

      setMembers(membersWithRoles);
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleSaveTeamMember = async () => {
    if (!teamForm.full_name.trim() || !teamForm.email.trim()) {
      toast.error('Name and email are required');
      return;
    }

    setSavingTeam(true);
    try {
      // Check if email already exists
      const { data: existingUser } = await db
        .from('profiles')
        .select('email')
        .eq('email', teamForm.email.toLowerCase().trim())
        .execute();

      if (existingUser && existingUser.length > 0) {
        toast.error('A user with this email already exists');
        return;
      }

      // Generate a random user_id (UUID-like)
      const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Create profile with a default temporary password (user can change later)
      const defaultPassword = 'Welcome@123'; // Default password for new users

      // Use the auth signup to create the user properly
      const { auth } = await import('@/integrations/sqlite/client');
      const { data: authData, error: authError } = await auth.signUp({
        email: teamForm.email.toLowerCase().trim(),
        password: defaultPassword,
        options: {
          data: {
            full_name: teamForm.full_name.trim()
          }
        }
      });

      if (authError) throw authError;

      // Add phone if provided
      if (teamForm.phone && authData?.user) {
        await db
          .from('profiles')
          .update({ phone: teamForm.phone.trim() })
          .eq('user_id', authData.user.user_id)
          .execute();
      }

      // Create user role
      if (authData?.user) {
        const { error: roleError } = await db
          .from('user_roles')
          .insert({
            user_id: authData.user.user_id,
            role: teamForm.role
          })
          .execute();

        if (roleError) {
          console.error('Role creation error:', roleError);
          // Don't fail the whole operation if role creation fails
        }
      }

      toast.success(
        `Team member added successfully! Email: ${teamForm.email}\nTemporary Password: ${defaultPassword}\n\nPlease share these credentials with the new team member.`,
        { duration: 10000 }
      );

      setTeamDialogOpen(false);
      setTeamForm({ full_name: '', email: '', phone: '', role: 'staff' });
      fetchMembers();
    } catch (error: any) {
      console.error('Error adding team member:', error);
      toast.error(error.message || 'Failed to add team member');
    } finally {
      setSavingTeam(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const { error } = await db
        .from('user_roles')
        .update({ role: newRole as typeof ROLES[number] })
        .eq('user_id', userId)
        .execute();

      if (error) throw error;
      toast.success('Role updated');
      fetchMembers();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update role');
    }
  };

  // ===================== PASSWORD RESET =====================
  const handleAdminPasswordReset = async () => {
    if (!resetEmail.trim() || !resetPassword.trim()) {
      toast.error('Email and new password are required');
      return;
    }

    if (resetPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsResetting(true);
    try {
      // Edge functions not available in SQLite
      toast.warning('Admin password reset feature not yet implemented in SQLite.');
      // const response = await db.functions.invoke('admin-reset-password', {
      //   body: { email: resetEmail, password: resetPassword }
      // });

      // if (response.error) throw response.error;
      // if (response.data?.error) throw new Error(response.data.error);

      // toast.success(`Password reset successfully for ${resetEmail}`);
      setResetEmail('');
      setResetPassword('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Settings</h1>
          <p className="text-muted-foreground">Manage clients, team, and firm settings</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-9">
          <TabsTrigger value="firm" className="gap-2">
            <Landmark className="h-4 w-4" />
            Firm
          </TabsTrigger>
          <TabsTrigger value="partners" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Partners
          </TabsTrigger>
          <TabsTrigger value="clients" className="gap-2">
            <Building2 className="h-4 w-4" />
            Clients
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="roles" className="gap-2">
            <UserCog className="h-4 w-4" />
            Roles
          </TabsTrigger>
          <TabsTrigger value="caro-templates" className="gap-2">
            <FileText className="h-4 w-4" />
            CARO
          </TabsTrigger>
          <TabsTrigger value="letter-templates" className="gap-2">
            <FileSignature className="h-4 w-4" />
            Letter Templates
          </TabsTrigger>
          <TabsTrigger value="financial-years" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            FY
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
        </TabsList>

        {/* FIRM TAB */}
        <TabsContent value="firm">
          <Card>
            <CardHeader>
              <CardTitle>About the CA Firm</CardTitle>
              <CardDescription>Manage your firm details and registration information</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFirm ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firm_name">Name of Firm *</Label>
                      <Input
                        id="firm_name"
                        value={firmSettings.firm_name}
                        onChange={(e) => setFirmSettings(prev => ({ ...prev, firm_name: e.target.value }))}
                        placeholder="ABC & Associates"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="icai_unique_sl_no">ICAI Unique Sl No</Label>
                      <Input
                        id="icai_unique_sl_no"
                        value={firmSettings.icai_unique_sl_no}
                        onChange={(e) => setFirmSettings(prev => ({ ...prev, icai_unique_sl_no: e.target.value }))}
                        placeholder="XXXXXX"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="constitution">Constitution</Label>
                      <Select
                        value={firmSettings.constitution}
                        onValueChange={(value) => setFirmSettings(prev => ({ ...prev, constitution: value }))}
                      >
                        <SelectTrigger id="constitution">
                          <SelectValue placeholder="Select constitution" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Proprietorship">Proprietorship</SelectItem>
                          <SelectItem value="Partnership">Partnership</SelectItem>
                          <SelectItem value="LLP">LLP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="no_of_partners">No of Partners</Label>
                      <Input
                        id="no_of_partners"
                        type="number"
                        min={1}
                        value={firmSettings.no_of_partners ?? ''}
                        onChange={(e) => setFirmSettings(prev => ({ ...prev, no_of_partners: e.target.value ? parseInt(e.target.value) : null }))}
                        placeholder="1"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="firm_registration_no">Firm Registration No</Label>
                      <Input
                        id="firm_registration_no"
                        value={firmSettings.firm_registration_no}
                        onChange={(e) => setFirmSettings(prev => ({ ...prev, firm_registration_no: e.target.value }))}
                        placeholder="XXXXXXX"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="admin-firm-place">Place</Label>
                      <Input id="admin-firm-place" value={firmSettings.place}
                        onChange={(e) => setFirmSettings(prev => ({ ...prev, place: e.target.value }))}
                        placeholder="City / town of the firm" />
                      <p className="text-sm text-muted-foreground">Default signing place for financial statements; editable when generating financials.</p>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="firm_address">Firm Address (for letterhead footer)</Label>
                      <Textarea
                        id="firm_address"
                        value={firmSettings.address}
                        onChange={(e) => setFirmSettings(prev => ({ ...prev, address: e.target.value }))}
                        placeholder="Enter your firm's complete address for report letterheads"
                        rows={2}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={handleSaveFirmSettings} disabled={savingFirm}>
                      {savingFirm && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Save Firm Settings
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* PARTNERS TAB */}
        <TabsContent value="partners">
          <PartnersTabContent />
        </TabsContent>

        {/* CLIENTS TAB */}
        <TabsContent value="clients">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Client Management</CardTitle>
                <CardDescription>Add and manage your audit clients</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <BulkClientImportDialog onSuccess={fetchClients} />
                <Button onClick={() => { setEditingClient(null); setClientDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Client
                </Button>
                <ClientFormDialog
                  open={clientDialogOpen}
                  onOpenChange={setClientDialogOpen}
                  client={editingClient ? {
                    id: editingClient.id,
                    name: editingClient.name,
                    industry: editingClient.industry || '',
                    constitution: (editingClient as any).constitution || 'company',
                    contact_person: editingClient.contact_person || '',
                    contact_email: editingClient.contact_email || '',
                    contact_phone: editingClient.contact_phone || '',
                    address: editingClient.address || '',
                    pan: editingClient.pan || '',
                    cin: editingClient.cin || '',
                    state: editingClient.state || '',
                    pin: editingClient.pin || '',
                    notes: editingClient.notes || '',
                  } : null}
                  onSuccess={fetchClients}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client Name</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingClients ? (
                    [1, 2, 3].map(i => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : clients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">
                        <div className="flex flex-col items-center gap-3">
                          <Building2 className="h-10 w-10 text-muted-foreground/50" />
                          <p className="text-muted-foreground">No clients yet</p>
                          <Button size="sm" onClick={() => { setEditingClient(null); setClientDialogOpen(true); }}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Your First Client
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    clients.map(client => (
                      <TableRow key={client.id}>
                        <TableCell className="font-medium">{client.name}</TableCell>
                        <TableCell>{client.industry || '—'}</TableCell>
                        <TableCell>
                          {client.contact_person && <div>{client.contact_person}</div>}
                          {client.contact_email && <div className="text-xs text-muted-foreground">{client.contact_email}</div>}
                          {!client.contact_person && !client.contact_email && '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={client.status === 'active' ? 'default' : 'secondary'}>{client.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingClient(client); setClientDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" onClick={() => handleToggleClientStatus(client)} disabled={togglingClientStatus === client.id} title={client.status === 'active' ? 'Deactivate' : 'Activate'}>
                              {togglingClientStatus === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : client.status === 'active' ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteClient(client.id, client.name)} title="Delete (only if no engagements)">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Data Integrity Panel - Partner only */}
          <DataIntegrityPanel />
        </TabsContent>

        {/* TEAM TAB */}
        <TabsContent value="team">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>Add team members manually or bulk import via Excel.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <BulkTeamImportDialog onSuccess={fetchMembers} />
                <Dialog open={teamDialogOpen} onOpenChange={setTeamDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setTeamForm({ full_name: '', email: '', phone: '', role: 'staff' })}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Member
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Team Member</DialogTitle>
                      <DialogDescription>Send an invitation to join the team</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Full Name *</Label>
                        <Input
                          value={teamForm.full_name}
                          onChange={(e) => setTeamForm(f => ({ ...f, full_name: e.target.value }))}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Email *</Label>
                        <Input
                          type="email"
                          value={teamForm.email}
                          onChange={(e) => setTeamForm(f => ({ ...f, email: e.target.value }))}
                          placeholder="john@example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Phone Number</Label>
                        <Input
                          value={teamForm.phone}
                          onChange={(e) => setTeamForm(f => ({ ...f, phone: e.target.value }))}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <Select value={teamForm.role} onValueChange={(value) => setTeamForm(f => ({ ...f, role: value }))}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map(role => (
                              <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setTeamDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleSaveTeamMember} disabled={savingTeam}>
                        {savingTeam && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Send Invitation
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMembers ? (
                    [1, 2, 3].map(i => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                      </TableRow>
                    ))
                  ) : members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8">
                        <div className="flex flex-col items-center gap-3">
                          <Users className="h-10 w-10 text-muted-foreground/50" />
                          <p className="text-muted-foreground">No team members yet</p>
                          <Button size="sm" onClick={() => { setTeamForm({ full_name: '', email: '', phone: '', role: 'staff' }); setTeamDialogOpen(true); }}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Your First Team Member
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    members.map(member => {
                      const cleanPhone = member.phone?.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
                      return (
                        <TableRow key={member.user_id}>
                          <TableCell className="font-medium">{member.full_name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span>{member.email}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                asChild
                              >
                                <a href={`mailto:${member.email}`} title="Send Email">
                                  <Mail className="h-4 w-4 text-blue-500" />
                                </a>
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span>{member.phone || '—'}</span>
                              {cleanPhone && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  asChild
                                >
                                  <a
                                    href={`https://wa.me/${cleanPhone}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open WhatsApp"
                                  >
                                    <MessageCircle className="h-4 w-4 text-green-500" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{member.role}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ROLES TAB */}
        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle>Role Management</CardTitle>
              <CardDescription>Assign and update roles for team members</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Current Role</TableHead>
                    <TableHead className="w-40">Change Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMembers ? (
                    [1, 2, 3].map(i => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-28" /></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    members.map(member => (
                      <TableRow key={member.user_id}>
                        <TableCell className="font-medium">{member.full_name}</TableCell>
                        <TableCell className="text-muted-foreground">{member.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{member.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Select value={member.role} onValueChange={v => handleRoleChange(member.user_id, v)}>
                            <SelectTrigger className="w-28 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map(role => (
                                <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SECURITY TAB */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Admin Password Reset
              </CardTitle>
              <CardDescription>
                Reset a user's password directly. Use this when a team member cannot access their email or needs immediate password reset.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-md space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">User Email</Label>
                  <Select value={resetEmail} onValueChange={setResetEmail}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map(member => (
                        <SelectItem key={member.user_id} value={member.email}>
                          {member.full_name} ({member.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-password">New Password</Label>
                  <Input
                    id="reset-password"
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)"
                  />
                </div>
                <Button
                  onClick={handleAdminPasswordReset}
                  disabled={isResetting || !resetEmail || !resetPassword}
                  className="w-full"
                >
                  {isResetting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Resetting Password...
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4 mr-2" />
                      Reset Password
                    </>
                  )}
                </Button>
              </div>
              <div className="mt-6 p-4 rounded-lg border bg-muted/50">
                <p className="text-sm text-muted-foreground">
                  <strong>Note:</strong> The user will be able to log in immediately with the new password.
                  For security, advise them to change their password after logging in.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FINANCIAL YEARS TAB */}
        <TabsContent value="financial-years">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Financial Years</CardTitle>
                <CardDescription>Manage financial year options for engagements</CardDescription>
              </div>
              <Dialog open={fyDialogOpen} onOpenChange={setFyDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={() => setFyForm({ year_code: '', display_name: '' })}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Financial Year
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Financial Year</DialogTitle>
                    <DialogDescription>Enter financial year details</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Year Code *</Label>
                      <Input
                        value={fyForm.year_code}
                        onChange={(e) => setFyForm((f) => ({ ...f, year_code: e.target.value }))}
                        placeholder="e.g., 2025-26"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Display Name *</Label>
                      <Input
                        value={fyForm.display_name}
                        onChange={(e) => setFyForm((f) => ({ ...f, display_name: e.target.value }))}
                        placeholder="e.g., FY 2025-26"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setFyDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveFinancialYear} disabled={savingFy}>
                      {savingFy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Add Financial Year
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingFinancialYears ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : financialYears.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No financial years configured</p>
                  <Button onClick={() => setFyDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add your first financial year
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Year Code</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {financialYears.map((fy) => (
                      <TableRow key={fy.id}>
                        <TableCell className="font-medium">{fy.year_code}</TableCell>
                        <TableCell>{fy.display_name}</TableCell>
                        <TableCell>
                          <Badge variant={fy.is_active ? 'default' : 'secondary'}>
                            {fy.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleToggleFinancialYear(fy.id, fy.is_active)}
                              title={fy.is_active ? 'Disable' : 'Enable'}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteFinancialYear(fy.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* CARO TEMPLATES TAB */}
        <TabsContent value="caro-templates">
          <CAROTemplatesTab />
        </TabsContent>

        {/* LETTER TEMPLATES TAB */}
        <TabsContent value="letter-templates">
          <EngagementLetterTemplateManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
