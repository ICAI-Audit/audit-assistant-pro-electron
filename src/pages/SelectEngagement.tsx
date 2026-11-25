import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEngagement } from '@/contexts/EngagementContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Search, Calendar, Briefcase, ArrowRight, LogOut, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function SelectEngagement() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { engagements, loading, setCurrentEngagement, clearEngagement } = useEngagement();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');

  // Get unique clients and years for filters
  const uniqueClients = useMemo(() => {
    const clients = [...new Set(engagements.map(e => e.client_name))];
    return clients.sort();
  }, [engagements]);

  const uniqueYears = useMemo(() => {
    const years = [...new Set(engagements.map(e => e.financial_year))];
    return years.sort().reverse();
  }, [engagements]);

  // Filter engagements
  const filteredEngagements = useMemo(() => {
    return engagements.filter(engagement => {
      const matchesSearch = 
        engagement.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        engagement.client_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesClient = clientFilter === 'all' || engagement.client_name === clientFilter;
      const matchesYear = yearFilter === 'all' || engagement.financial_year === yearFilter;
      return matchesSearch && matchesClient && matchesYear;
    });
  }, [engagements, searchQuery, clientFilter, yearFilter]);

  const handleSelectEngagement = async (engagement: typeof engagements[0]) => {
    if (!(await setCurrentEngagement(engagement))) return;
    navigate('/');
  };

  const handleSignOut = async () => {
    if (!(await clearEngagement('sign-out'))) return;
    await signOut();
    navigate('/auth', { replace: true });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'planning':
        return 'bg-blue-500/20 text-blue-600';
      case 'fieldwork':
        return 'bg-amber-500/20 text-amber-600';
      case 'review':
        return 'bg-purple-500/20 text-purple-600';
      case 'completed':
        return 'bg-green-500/20 text-green-600';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getEngagementTypeLabel = (type: string) => {
    switch (type) {
      case 'statutory':
        return 'Statutory Audit';
      case 'internal':
        return 'Internal Audit';
      case 'tax':
        return 'Tax Audit';
      case 'limited_review':
        return 'Limited Review';
      default:
        return type;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
          >
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold text-foreground">AuditPro</h1>
              <p className="text-xs text-muted-foreground">Select an engagement to continue</p>
            </div>
          </button>
          <div className="flex items-center gap-4">
            <Button onClick={() => navigate('/engagements')} className="gap-2">
              <Plus className="h-4 w-4" />
              New Engagement
            </Button>
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{profile?.full_name}</p>
              <p className="text-xs text-muted-foreground">{profile?.email}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">Select Engagement</h2>
          <p className="text-muted-foreground">
            Choose a client engagement to work on. Each engagement is a separate workspace with its own data.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search engagements..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {uniqueClients.map(client => (
                <SelectItem key={client} value={client}>{client}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="All Years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {uniqueYears.map(year => (
                <SelectItem key={year} value={year}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Engagements Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="p-6 rounded-lg border border-border bg-card">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : filteredEngagements.length === 0 ? (
          <div className="text-center py-16">
            <Briefcase className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {engagements.length === 0 ? 'No Engagements Yet' : 'No Matching Engagements'}
            </h3>
            <p className="text-muted-foreground mb-6">
              {engagements.length === 0
                ? 'Create your first engagement to get started.'
                : 'Try adjusting your filters or search query.'}
            </p>
            {engagements.length === 0 && (
              <Button onClick={() => navigate('/engagements')} className="gap-2">
                <Plus className="h-4 w-4" />
                Create Engagement
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEngagements.map((engagement) => (
              <button
                key={engagement.id}
                onClick={() => handleSelectEngagement(engagement)}
                className="p-6 rounded-lg border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all text-left group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Briefcase className="h-5 w-5 text-primary" />
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full capitalize ${getStatusColor(engagement.status)}`}>
                    {engagement.status}
                  </span>
                </div>
                
                <h3 className="font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">
                  {engagement.client_name}
                </h3>
                <p className="text-sm text-muted-foreground mb-3">{engagement.name}</p>
                
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {engagement.financial_year}
                  </span>
                  <span>{getEngagementTypeLabel(engagement.engagement_type)}</span>
                </div>

                <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Click to enter</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
