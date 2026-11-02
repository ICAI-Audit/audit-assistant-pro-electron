import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2, CheckCircle2, AlertTriangle, Info, ArrowRight, User, Calendar, MapPin, FileSignature } from 'lucide-react';
import type { AuditReportSetup as SetupType } from '@/hooks/useAuditReportSetup';
import { getFsgEngagementSummary, type FsgEngagementSummary } from '@/lib/fsgEngagementSummary';
import { usePartners } from '@/hooks/usePartners';
import { useEngagement } from '@/contexts/EngagementContext';
import { useClient } from '@/hooks/useClient';
import { cn } from '@/lib/utils';

interface AuditReportSetupProps {
  engagementId: string;
  setup: SetupType | null;
  loading: boolean;
  saveSetup: (data: Partial<SetupType>) => Promise<SetupType | null>;
  refetchSetup: () => Promise<void>;
  onSetupComplete: () => void;
}

const companyTypes = [
  { value: 'public_company', label: 'Public Company' },
  { value: 'private_company', label: 'Private Company' },
  { value: 'opc', label: 'One Person Company (OPC)' },
  { value: 'small_company', label: 'Small Company' },
  { value: 'section_8', label: 'Section 8 Company' },
  { value: 'banking', label: 'Banking Company' },
  { value: 'insurance', label: 'Insurance Company' },
];

const CARO_EXCLUDED_TYPES = ['banking', 'insurance', 'section_8', 'opc', 'small_company'] as const;

type TBCrosscheck = {
  available: boolean;
  paidUpCapitalTB: number;
  reservesSurplusTB: number;
  borrowingsTB: number;
};

const mapConstitutionToCompanyType = (value: string | null) => {
  const normalized = (value || '').toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('public')) return 'public_company';
  if (normalized.includes('private')) return 'private_company';
  if (normalized.includes('opc') || normalized.includes('one person')) return 'opc';
  if (normalized.includes('section 8') || normalized.includes('section-8')) return 'section_8';
  if (normalized.includes('small')) return 'small_company';
  if (normalized.includes('bank')) return 'banking';
  if (normalized.includes('insurance')) return 'insurance';
  return '';
};

export function AuditReportSetup({
  engagementId,
  setup,
  loading,
  saveSetup,
  refetchSetup,
  onSetupComplete,
}: AuditReportSetupProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isEditingSetup, setIsEditingSetup] = useState(false);
  const hasInitialized = useRef(false);
  const { partners, loading: partnersLoading } = usePartners();
  const { currentEngagement } = useEngagement();
  const { client } = useClient(currentEngagement?.client_id || null);
  const [formData, setFormData] = useState({
    company_cin: '',
    registered_office: '',
    nature_of_business: '',
    is_standalone: true,
    accounting_framework: 'AS',
    company_type: '',
    is_private_company: false,
    paid_up_capital: 0,
    reserves_surplus: 0,
    borrowings_amount: 0,
    caro_applicable_status: 'pending',
    caro_exclusion_reason: '',
    signing_partner_id: '',
    report_date: '',
    report_city: '',
    udin: '',
  });

  const [fsgSummary, setFsgSummary] = useState<FsgEngagementSummary | null>(null);
  const [tbLoading, setTbLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setTbLoading(true);
    getFsgEngagementSummary(engagementId).then((summary) => {
      if (cancelled) return;
      setFsgSummary(summary);
      setTbLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

  const tbCrosscheck: TBCrosscheck = useMemo(() => {
    const amounts = fsgSummary?.amounts;
    if (!amounts) {
      return { available: false, paidUpCapitalTB: 0, reservesSurplusTB: 0, borrowingsTB: 0 };
    }
    return {
      available: true,
      paidUpCapitalTB: amounts.paidUpCapital,
      reservesSurplusTB: amounts.reservesSurplus,
      borrowingsTB: amounts.borrowings,
    };
  }, [fsgSummary]);
  const formatINR = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

  const paidUpDiff = tbCrosscheck.available
    ? Math.abs(tbCrosscheck.paidUpCapitalTB - formData.paid_up_capital)
    : 0;
  const reservesDiff = tbCrosscheck.available
    ? Math.abs(tbCrosscheck.reservesSurplusTB - formData.reserves_surplus)
    : 0;
  const borrowingsDiff = tbCrosscheck.available
    ? Math.abs(tbCrosscheck.borrowingsTB - formData.borrowings_amount)
    : 0;

  const hasTbMismatch =
    tbCrosscheck.available && (paidUpDiff > 1 || reservesDiff > 1 || borrowingsDiff > 1);


  useEffect(() => {
    if (!setup) return;

    setFormData({
      company_cin: setup.company_cin || '',
      registered_office: setup.registered_office || '',
      nature_of_business: setup.nature_of_business || '',
      is_standalone: setup.is_standalone ?? true,
      accounting_framework: setup.accounting_framework || 'AS',
      company_type: setup.company_type || '',
      is_private_company: setup.is_private_company ?? false,
      paid_up_capital: setup.paid_up_capital || 0,
      reserves_surplus: setup.reserves_surplus || 0,
      borrowings_amount: setup.borrowings_amount || 0,
      caro_applicable_status: setup.caro_applicable_status || 'pending',
      caro_exclusion_reason: setup.caro_exclusion_reason || '',
      signing_partner_id: (setup as any).signing_partner_id || '',
      report_date: (setup as any).report_date || '',
      report_city: (setup as any).report_city || '',
      udin: (setup as any).udin || '',
    });

    if (!hasInitialized.current) {
      if (setup.setup_completed) {
        setCurrentStep(3);
      }
      hasInitialized.current = true;
      return;
    }

    if (!isEditingSetup && setup.setup_completed) {
      setCurrentStep(3);
    }
  }, [setup, isEditingSetup]);

  useEffect(() => {
    if (!client) return;
    setFormData((prev) => {
      const next = { ...prev };
      if (!next.company_cin && client.cin) next.company_cin = client.cin;
      if (!next.registered_office && client.address) next.registered_office = client.address;
      if (!next.nature_of_business && client.industry) next.nature_of_business = client.industry;
      if (!next.company_type) {
        const mapped = mapConstitutionToCompanyType(client.constitution);
        if (mapped) next.company_type = mapped;
      }
      return next;
    });
  }, [client?.id]);

  const isCaroExcludedType = CARO_EXCLUDED_TYPES.includes(formData.company_type as any);
  const isPublicCompanyType = formData.company_type === 'public_company';
  const isPrivateThresholdDisabled = isCaroExcludedType || isPublicCompanyType;

  useEffect(() => {
    if (!isPrivateThresholdDisabled || !formData.is_private_company) return;
    setFormData((prev) => ({ ...prev, is_private_company: false }));
  }, [isPrivateThresholdDisabled, formData.is_private_company]);

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const startEditing = (step: number) => {
    setIsEditingSetup(true);
    setCurrentStep(step);
  };

  const calculateCAROApplicability = () => {
    if (!formData.company_type) {
      return 'pending';
    }
    if (!formData.is_standalone) {
      return 'cfs_only_xxi';
    }
    if (
      formData.company_type !== 'public_company' &&
      !CARO_EXCLUDED_TYPES.includes(formData.company_type as any) &&
      !formData.is_private_company
    ) {
      return 'pending';
    }
    // CARO exclusions based on company type
    if (CARO_EXCLUDED_TYPES.includes(formData.company_type as any)) {
      return 'not_applicable';
    }
    if (formData.company_type === 'public_company') {
      return 'applicable';
    }
    if (formData.company_type === 'private_company' && !formData.is_private_company) {
      return 'pending';
    }

    // Private company threshold test
    if (formData.is_private_company) {
      const totalCapital = formData.paid_up_capital + formData.reserves_surplus;
      if (
        formData.paid_up_capital <= 10000000 && // 1 crore
        formData.reserves_surplus <= 10000000 && // 1 crore
        formData.borrowings_amount <= 10000000 && // 1 crore (from banks/FIs)
        totalCapital <= 20000000 // 2 crores total
      ) {
        return 'not_applicable';
      }
    }

    return 'applicable';
  };

  const handleNextStep = async () => {
    if (currentStep === 1) {
      // Save Step 1 data
      await saveSetup({
        company_cin: formData.company_cin,
        registered_office: formData.registered_office,
        nature_of_business: formData.nature_of_business,
        is_standalone: formData.is_standalone,
        accounting_framework: formData.accounting_framework,
        company_type: formData.company_type,
      });
      await refetchSetup();
      setCurrentStep(2);
    } else if (currentStep === 2) {
      // Calculate and save CARO applicability
      const caroStatus = calculateCAROApplicability();
      await saveSetup({
        is_private_company: formData.is_private_company,
        paid_up_capital: formData.paid_up_capital,
        reserves_surplus: formData.reserves_surplus,
        borrowings_amount: formData.borrowings_amount,
        caro_applicable_status: caroStatus,
        caro_exclusion_reason: caroStatus === 'not_applicable' ? formData.caro_exclusion_reason : null,
        setup_completed: true,
        report_status: 'in_progress',
      });
      await refetchSetup();
      setIsEditingSetup(false);
      setCurrentStep(3);
    }
  };

  const getApplicabilityBadge = () => {
    const status = calculateCAROApplicability();
    switch (status) {
      case 'applicable':
        return <Badge className="bg-success text-success-foreground gap-1"><CheckCircle2 className="h-3 w-3" /> CARO Applicable</Badge>;
      case 'not_applicable':
        return <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-3 w-3" /> CARO Not Applicable</Badge>;
      case 'cfs_only_xxi':
        return <Badge variant="outline" className="gap-1"><Info className="h-3 w-3" /> CFS - Only Clause 3(xxi)</Badge>;
      case 'pending':
        return <Badge variant="outline" className="gap-1"><Info className="h-3 w-3" /> CARO Inactive</Badge>;
      default:
        return <Badge variant="outline">Pending Evaluation</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-muted-foreground">Loading setup...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-4">
        {[1, 2, 3].map((step) => (
          <div key={step} className="flex items-center gap-2">
            <div className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium',
              currentStep >= step 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-muted-foreground'
            )}>
              {step}
            </div>
            <span className={cn(
              'text-sm',
              currentStep >= step ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {step === 1 && 'Client Profile'}
              {step === 2 && 'CARO Applicability'}
              {step === 3 && 'Complete'}
            </span>
            {step < 3 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 1: Client Profile */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Step 1: Client Profile
            </CardTitle>
          <CardDescription>
              Enter the basic company information for the audit report
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="company_type">Company Type</Label>
              <Select 
                value={formData.company_type} 
                onValueChange={(v) => updateField('company_type', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company type" />
                </SelectTrigger>
                <SelectContent>
                  {companyTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Client master details are auto-fetched for reference.
              </p>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <Label>Financial Statements Type</Label>
                <RadioGroup
                  value={formData.is_standalone ? 'standalone' : 'consolidated'}
                  onValueChange={(v) => updateField('is_standalone', v === 'standalone')}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="standalone" id="standalone" />
                    <Label htmlFor="standalone" className="font-normal">Standalone Financial Statements</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-4">
                <Label>Accounting Framework</Label>
                <RadioGroup
                  value={formData.accounting_framework}
                  onValueChange={(v) => updateField('accounting_framework', v)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="AS" id="as" />
                    <Label htmlFor="as" className="font-normal">Accounting Standards (AS)</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleNextStep} className="gap-2">
                Next Step
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: CARO Applicability */}
      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Step 2: CARO Applicability Test
            </CardTitle>
            <CardDescription>
              Determine whether CARO 2020 applies to this engagement
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                CARO 2020 does not apply to: Banking companies, Insurance companies, Section 8 companies, 
                One Person Companies, and Small Companies.
              </AlertDescription>
            </Alert>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_private"
                checked={formData.is_private_company}
                disabled={isPrivateThresholdDisabled}
                onCheckedChange={(v) => updateField('is_private_company', !!v)}
              />
              <Label
                htmlFor="is_private"
                className={`font-normal ${isPrivateThresholdDisabled ? 'text-muted-foreground' : ''}`}
              >
                This is a Private Company (for threshold test)
              </Label>
            </div>

            {formData.is_private_company && !isPrivateThresholdDisabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                  <div className="space-y-2">
                    <Label htmlFor="paid_up_capital">Paid-up Capital (₹)</Label>
                    <Input
                      id="paid_up_capital"
                      type="number"
                      value={formData.paid_up_capital}
                      onChange={(e) => updateField('paid_up_capital', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">Threshold: ₹1 Crore</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reserves_surplus">Reserves & Surplus (₹)</Label>
                    <Input
                      id="reserves_surplus"
                      type="number"
                      value={formData.reserves_surplus}
                      onChange={(e) => updateField('reserves_surplus', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">Threshold: ₹1 Crore</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="borrowings_amount">Borrowings from Banks/FIs (₹)</Label>
                    <Input
                      id="borrowings_amount"
                      type="number"
                      value={formData.borrowings_amount}
                      onChange={(e) => updateField('borrowings_amount', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">Threshold: ₹1 Crore</p>
                  </div>
                </div>

                {tbLoading ? (
                  <p className="text-xs text-muted-foreground">Loading Trial Balance cross-check...</p>
                ) : tbCrosscheck.available ? (
                  <Alert className={cn(hasTbMismatch && 'border-warning')}>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Trial Balance cross-check (mapped Balance Sheet)</p>
                        <ul className="list-disc list-inside text-sm">
                          <li>
                            Paid-up Capital: TB {formatINR(tbCrosscheck.paidUpCapitalTB)} | Entered {formatINR(formData.paid_up_capital)}
                            {paidUpDiff > 1 ? ` | Diff ${formatINR(paidUpDiff)}` : ''}
                          </li>
                          <li>
                            Reserves & Surplus: TB {formatINR(tbCrosscheck.reservesSurplusTB)} | Entered {formatINR(formData.reserves_surplus)}
                            {reservesDiff > 1 ? ` | Diff ${formatINR(reservesDiff)}` : ''}
                          </li>
                          <li>
                            Borrowings (TB total): TB {formatINR(tbCrosscheck.borrowingsTB)} | Entered {formatINR(formData.borrowings_amount)}
                            {borrowingsDiff > 1 ? ` | Diff ${formatINR(borrowingsDiff)}` : ''}
                          </li>
                        </ul>
                        {hasTbMismatch && (
                          <p className="text-sm">
                            Note: Trial Balance amounts differ from your inputs; please cross-check.
                          </p>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No mapped Financial Statement Review trial balance was found for this client and financial year. Import and map the trial balance in Financial Statement Review to enable the cross-check.
                  </p>
                )}
              </div>
            )}

            {!formData.is_standalone && (
              <Alert className="border-warning">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertDescription>
                  For Consolidated Financial Statements, CARO 2020 does not apply except for Clause 3(xxi) 
                  which requires reporting on qualifications/adverse remarks in component CARO reports.
                </AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">CARO Applicability Result:</p>
                <div className="mt-2">{getApplicabilityBadge()}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  Back
                </Button>
                <Button onClick={handleNextStep} className="gap-2">
                  Complete Setup
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Complete & Report Details */}
      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" />
              Audit Report- Setup- Initial
            </CardTitle>
            <CardDescription>
              Configure signing partner and report details for PDF generation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground">Company Type</p>
                <p className="text-lg font-semibold capitalize">{formData.company_type?.replace('_', ' ') || 'Not specified'}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground">Financial Statements</p>
                <p className="text-lg font-semibold">{formData.is_standalone ? 'Standalone' : 'Consolidated'}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground">Accounting Framework</p>
                <p className="text-lg font-semibold">{formData.accounting_framework}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground">CARO Status</p>
                <div className="mt-1">{getApplicabilityBadge()}</div>
              </div>
            </div>

            <Separator />

            {/* Report Signing Details */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <FileSignature className="h-4 w-4" />
                Report Signing Details
              </h3>
              <p className="text-sm text-muted-foreground">
                These details will appear on the audit report signature block
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="signing_partner" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Signing Partner
                  </Label>
                  <Select 
                    value={formData.signing_partner_id} 
                    onValueChange={(v) => updateField('signing_partner_id', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select signing partner" />
                    </SelectTrigger>
                    <SelectContent>
                      {partnersLoading ? (
                        <SelectItem value="__loading" disabled>Loading partners...</SelectItem>
                      ) : partners.length === 0 ? (
                        <SelectItem value="__empty" disabled>No partners found - add in Admin Settings</SelectItem>
                      ) : (
                        partners.map((partner) => (
                          <SelectItem key={partner.id} value={partner.id}>
                            {partner.name} (M.No. {partner.membership_number})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="report_date" className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Report Date
                  </Label>
                  <Input
                    id="report_date"
                    type="date"
                    value={formData.report_date}
                    onChange={(e) => updateField('report_date', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="report_city" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Place of Signing
                  </Label>
                  <Input
                    id="report_city"
                    value={formData.report_city}
                    onChange={(e) => updateField('report_city', e.target.value)}
                    placeholder="E.g., Mumbai, Delhi, Bengaluru"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="udin">UDIN (Unique Document Identification Number)</Label>
                  <Input
                    id="udin"
                    value={formData.udin}
                    onChange={(e) => updateField('udin', e.target.value)}
                    placeholder="E.g., 25012345BMOCIU1234"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-between">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => startEditing(1)}>
                  Edit Client Profile
                </Button>
                <Button variant="outline" onClick={() => startEditing(2)}>
                  Edit CARO Applicability
                </Button>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={async () => {
                    await saveSetup({
                      signing_partner_id: formData.signing_partner_id || null,
                      report_date: formData.report_date || null,
                      report_city: formData.report_city || null,
                      udin: formData.udin || null,
                    } as any);
                  }}
                >
                  Save Details
                </Button>
                <Button onClick={onSetupComplete} className="gap-2">
                  Proceed
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
