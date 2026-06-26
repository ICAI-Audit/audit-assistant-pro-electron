import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, FileText, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFirmSettings } from '@/hooks/useFirmSettings';
import { useEngagement } from '@/contexts/EngagementContext';
import { useClient } from '@/hooks/useClient';
import { usePartners } from '@/hooks/usePartners';
import { useEngagementLetterTemplates } from '@/hooks/useEngagementLetterTemplates';
import { EngagementLetterDocxTemplate } from '@/services/engagementLetterDocxTemplate';
import {
  parseEngagementLetterTemplatePayload,
  type EngagementLetterTemplatePayload,
} from '@/services/engagementLetterTemplatePayload';
import type { EngagementLetterMasterData } from '@/types/engagementLetter';

interface LettersPageProps {
  engagementId: string;
}

const SHOW_DUPLICATE_APPOINTMENT_FIELDS = false;

export function LettersPage({ engagementId }: LettersPageProps) {
  const { currentEngagement } = useEngagement();
  const { client } = useClient(currentEngagement?.client_id || null);
  const { partners } = usePartners();
  const { getTemplateByType, loading: templatesLoading } = useEngagementLetterTemplates();
  const [activeTab, setActiveTab] = useState('letter-selection');
  const [letterType, setLetterType] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [activeTemplatePayload, setActiveTemplatePayload] = useState<EngagementLetterTemplatePayload | null>(null);
  const { firmSettings } = useFirmSettings();
  const isStatutoryCompanyLetter = letterType.startsWith('statutory-audit-company');

  // Entity Section
  const [entityName, setEntityName] = useState('');
  const [entityType, setEntityType] = useState('Company');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [gstinNumber, setGstinNumber] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Engagement Period Section
  const [financialYearStart, setFinancialYearStart] = useState('');
  const [financialYearEnd, setFinancialYearEnd] = useState('');
  const [appointmentLetterDate, setAppointmentLetterDate] = useState('');
  const [agmDate, setAgmDate] = useState('');
  const [appointmentType, setAppointmentType] = useState('appointment');
  const [assessmentYear, setAssessmentYear] = useState('');

  // Auditor Section - prefilled from firm settings
  const [firmName, setFirmName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerPlace, setPartnerPlace] = useState('');
  const [partnerSignatureDate, setPartnerSignatureDate] = useState('');

  // Prefill from firm settings on component mount
  useEffect(() => {
    if (firmSettings) {
      setFirmName(firmSettings.firm_name || '');
      // Address can be used for firm location/place
      if (firmSettings.address) {
        // Extract city/place from address (last part usually)
        const addressParts = firmSettings.address.split(',');
        const place = addressParts[addressParts.length - 2]?.trim() || '';
        setPartnerPlace(place);
      }
    }
  }, [firmSettings]);

  // Auto-populate partner name when partners load or engagement changes
  useEffect(() => {
    if (currentEngagement?.partner_id && partners.length > 0) {
      const matched = partners.find((partner) => partner.id === currentEngagement.partner_id);
      if (matched) {
        setPartnerName(matched.name);
        return;
      }
    }
    if (partners.length > 0 && !partnerName) {
      setPartnerName(partners[0].name);
    }
  }, [currentEngagement?.partner_id, partners]);

  // Prefill Entity Information from Client Master when engagement changes
  useEffect(() => {
    if (!client) return;
    setEntityName(client.name || '');

    const constitution = (client.constitution || '').toLowerCase();
    const constitutionToEntityType: Record<string, string> = {
      company: 'Company',
      llp: 'LLP',
      partnership: 'Partnership',
      proprietorship: 'Proprietorship',
      trust: 'Trust',
      society: 'Society',
      aop: 'Association of Persons (AOP)',
      huf: 'HUF',
      cooperative: 'Cooperative Society',
    };
    if (letterType.startsWith('statutory-audit-company')) {
      setEntityType('Company');
    } else {
      setEntityType(constitutionToEntityType[constitution] || 'Company');
    }

    setRegistrationNumber(client.cin || '');
    setPanNumber((client.pan || '').toUpperCase());
    setAddress(client.address || '');
    setEmail(client.contact_email || '');
    setPhone(client.contact_phone || '');
    // GSTIN not stored in clients table currently; leave as entered by user
  }, [client, letterType]);

  // Commercial Terms Section
  const [professionalFees, setProfessionalFees] = useState('');
  const [gstExtraApplicable, setGstExtraApplicable] = useState(false);
  const [outOfPocketExpenses, setOutOfPocketExpenses] = useState(false);

  // Management Responsibility Section
  const [acceptManagementResponsibility, setAcceptManagementResponsibility] = useState(false);
  const [understandAuditProcess, setUnderstandAuditProcess] = useState(false);
  const [confirmDataAccess, setConfirmDataAccess] = useState(false);

  // Statutory Audit Config (Conditional)
  const [ifcApplicable, setIfcApplicable] = useState(false);
  const [caroApplicable, setCaroApplicable] = useState(false);

  // Tax Audit Config (Conditional)
  const [taxAuditForm, setTaxAuditForm] = useState('');
  const [auditedUnderOtherLaw, setAuditedUnderOtherLaw] = useState(false);
  const [otherLawDetails, setOtherLawDetails] = useState('');

  // Draft save/load helpers
  const draftKey = useMemo(() => `eng_letter_draft_${engagementId}`, [engagementId]);
  const isCompanyEntity = entityType === 'Company';
  const taxAuditLetterType = isCompanyEntity ? 'tax-audit-partnership-3ca' : 'tax-audit-partnership-3cb';

  const buildDraft = () => ({
    letterType,
    entityName,
    entityType,
    registrationNumber,
    panNumber,
    gstinNumber,
    address,
    email,
    phone,
    financialYearStart,
    financialYearEnd,
    appointmentLetterDate,
    agmDate,
    appointmentType,
    assessmentYear,
    firmName,
    partnerName,
    partnerPlace,
    partnerSignatureDate,
    professionalFees,
    gstExtraApplicable,
    outOfPocketExpenses,
    acceptManagementResponsibility,
    understandAuditProcess,
    confirmDataAccess,
    ifcApplicable,
    caroApplicable,
    taxAuditForm,
    auditedUnderOtherLaw,
    otherLawDetails,
  });

  const applyDraft = (d: any) => {
    if (!d) return;
    setLetterType(d.letterType || '');
    setEntityName(d.entityName || '');
    setEntityType(d.entityType || 'Company');
    setRegistrationNumber(d.registrationNumber || '');
    setPanNumber(d.panNumber || '');
    setGstinNumber(d.gstinNumber || '');
    setAddress(d.address || '');
    setEmail(d.email || '');
    setPhone(d.phone || '');
    setFinancialYearStart(d.financialYearStart || '');
    setFinancialYearEnd(d.financialYearEnd || '');
    setAppointmentLetterDate(d.appointmentLetterDate || '');
    setAgmDate(d.agmDate || '');
    setAppointmentType(d.appointmentType || 'appointment');
    setAssessmentYear(d.assessmentYear || '');
    setFirmName(d.firmName || firmName);
    setPartnerName(d.partnerName || '');
    setPartnerPlace(d.partnerPlace || partnerPlace);
    setPartnerSignatureDate(d.partnerSignatureDate || '');
    setProfessionalFees(d.professionalFees || '');
    setOutOfPocketExpenses(!!d.outOfPocketExpenses);
    const gstExtra =
      typeof d.gstExtraApplicable === 'boolean'
        ? d.gstExtraApplicable
        : false;
    setGstExtraApplicable(gstExtra);
    setAcceptManagementResponsibility(!!d.acceptManagementResponsibility);
    setUnderstandAuditProcess(!!d.understandAuditProcess);
    setConfirmDataAccess(!!d.confirmDataAccess);
    setIfcApplicable(!!d.ifcApplicable);
    setCaroApplicable(!!d.caroApplicable);
    setTaxAuditForm(d.taxAuditForm || '');
    setAuditedUnderOtherLaw(!!d.auditedUnderOtherLaw);
    setOtherLawDetails(d.otherLawDetails || '');
  };

  const handleSaveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(buildDraft()));
      toast.success('Draft saved');
    } catch (e) {
      toast.error('Failed to save draft');
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) applyDraft(JSON.parse(raw));
    } catch {}
  }, [draftKey]);

  useEffect(() => {
    if (!letterType.includes('tax-audit')) return;
    if (letterType !== taxAuditLetterType) {
      setLetterType(taxAuditLetterType);
    }
    const desiredForm = isCompanyEntity ? '3CA' : '3CB';
    if (taxAuditForm !== desiredForm) {
      setTaxAuditForm(desiredForm);
    }
  }, [letterType, taxAuditLetterType, isCompanyEntity, taxAuditForm]);

  useEffect(() => {
    if (letterType === 'statutory-audit-company-ifc') {
      setIfcApplicable(true);
    } else if (letterType === 'statutory-audit-company') {
      setIfcApplicable(false);
    }
    if (letterType.startsWith('statutory-audit-company')) {
      setEntityType('Company');
    }
  }, [letterType]);


  const getLetterTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'statutory-audit-company': 'Statutory Audit - Company (Unlisted without IFC)',
      'statutory-audit-company-ifc': 'Statutory Audit - Company (Unlisted with IFC)',
      'tax-audit-partnership-3ca': 'Tax Audit - Company (3CA - Audited)',
      'tax-audit-partnership-3cb': 'Tax Audit - Non-Company (3CB - Non-Audited)',
    };
    return labels[type] || type;
  };

  const engagementTypeMap: Record<string, string> = {
    'statutory-audit-company': 'statutory_audit_company_without_ifc',
    'statutory-audit-company-ifc': 'statutory_audit_company_with_ifc',
    'tax-audit-partnership-3ca': 'tax_audit_partnership_3ca',
    'tax-audit-partnership-3cb': 'tax_audit_partnership_3cb',
  };

  const getComputedAssessmentYear = () => {
    if (assessmentYear.trim()) return assessmentYear.trim();
    if (!financialYearStart) return '';
    const startYear = parseInt(financialYearStart.split('-')[0], 10);
    if (!Number.isFinite(startYear)) return '';
    const assessmentStart = startYear + 1;
    const assessmentEnd = String(assessmentStart + 1).slice(-2);
    return `${assessmentStart}-${assessmentEnd}`;
  };

  const buildMasterData = (): EngagementLetterMasterData => {
    const startYear = financialYearStart?.split('-')[0] || '';
    const endYear = financialYearEnd?.split('-')[0] || '';
    const assessmentYearValue = getComputedAssessmentYear();

    return {
      engagement_type: (engagementTypeMap[letterType] || letterType) as any,
      entity: {
        entity_name: entityName,
        entity_type: entityType as any,
        entity_status: entityType as any,
        registration_no: registrationNumber,
        pan: panNumber,
        gstin: gstinNumber,
        registered_address: address,
        email,
        phone,
      },
      period: {
        financial_year: startYear && endYear ? `${startYear}-${endYear}` : '',
        assessment_year: assessmentYearValue,
        balance_sheet_date: financialYearEnd,
        appointment_date: appointmentLetterDate,
        appointment_letter_date: appointmentLetterDate,
        agm_date: agmDate,
        financial_year_start: financialYearStart,
        financial_year_end: financialYearEnd,
        appointment_type: appointmentType,
      },
      auditor: {
        firm_name: firmName,
        firm_reg_no: firmSettings?.firm_registration_no || '',
        partner_name: partnerName,
        partner_mem_no: '',
        partner_pan: '',
        place: partnerPlace,
        letter_date: partnerSignatureDate,
      },
      commercial: {
        professional_fees: parseFloat(professionalFees) || 0,
        professional_fees_currency: 'INR',
        taxes_extra: gstExtraApplicable,
        payment_terms: '',
        out_of_pocket_exp: outOfPocketExpenses,
      },
      mgmt_responsibilities: {
        mgmt_responsibility_ack: acceptManagementResponsibility,
        books_responsibility_ack: understandAuditProcess,
        internal_control_ack: confirmDataAccess,
        fraud_prevention_ack: confirmDataAccess,
      },
      ...(letterType.includes('statutory') && {
        statutory_audit_config: {
          ifc_applicable: ifcApplicable,
          caro_applicable: caroApplicable,
          ind_as_applicable: false,
        },
      }),
      ...(letterType.includes('tax-audit') && {
        tax_audit_config: {
          tax_audit_form: taxAuditForm as '3CA' | '3CB',
          audited_under_other_law: auditedUnderOtherLaw,
          accounting_standard: 'AS',
        },
      }),
    };
  };

  const validateForm = (): boolean => {
    if (!letterType.trim()) {
      toast.error('Please select a letter type');
      return false;
    }
    if (!entityName.trim()) {
      toast.error('Entity name is required');
      return false;
    }
    if (!firmName.trim()) {
      toast.error('Firm name is required');
      return false;
    }
    if (!partnerName.trim()) {
      toast.error('Partner name is required');
      return false;
    }
    if (!professionalFees.trim()) {
      toast.error('Professional fees are required');
      return false;
    }
    if (letterType.includes('tax-audit') && !taxAuditForm.trim()) {
      toast.error('Tax audit form (3CA/3CB) is required');
      return false;
    }
    return true;
  };

  const handleGeneratePreview = async () => {
    if (!validateForm()) return;

    setGenerating(true);
    try {
      const masterData: EngagementLetterMasterData = buildMasterData();

      const templateType = engagementTypeMap[letterType];
      const dbTemplate = getTemplateByType(templateType);

      if (!dbTemplate?.file_content) {
        toast.error('Template not uploaded. Please upload the template in Admin Settings > Letter Templates.', {
          duration: 5000,
        });
        setGenerating(false);
        return;
      }

      const payload = parseEngagementLetterTemplatePayload(dbTemplate.file_content);
      setActiveTemplatePayload(payload);
      if (!payload) {
        toast.info('Template is stored as plain text. Re-upload to preserve Word formatting.');
      }

      const templateText = payload?.text ?? dbTemplate.file_content;

      if (!templateText.trim()) {
        toast.info('Preview text not available for this template. You can still export to Word.');
        setPreviewContent('Preview not available for this template.');
        setShowPreview(true);
        return;
      }
      const { EngagementLetterTemplateEngine } = await import('@/services/engagementLetterEngine');
      const context = EngagementLetterTemplateEngine.buildContext(masterData);
      const rendered = EngagementLetterTemplateEngine.render(templateText, context);

      setPreviewContent(rendered);
      setShowPreview(true);
    } catch (error) {
      console.error('Error generating preview:', error);
      toast.error(`Error: ${error instanceof Error ? error.message : 'Failed to generate preview'}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmAndGenerate = async () => {
    setGenerating(true);
    try {
      const masterData: EngagementLetterMasterData = buildMasterData();
      const templateType = engagementTypeMap[letterType];
      const dbTemplate = getTemplateByType(templateType);

      if (!dbTemplate) {
        toast.error('Template not uploaded. Please upload the template in Admin Settings → Letter Templates.', {
          duration: 5000,
        });
        return;
      }

      const payload = parseEngagementLetterTemplatePayload(dbTemplate.file_content);
      setActiveTemplatePayload(payload);

      let result;
      if (payload) {
        result = await EngagementLetterDocxTemplate.generateFromTemplate(payload, masterData);
      } else {
        const { EngagementLetterTemplateEngine } = await import('@/services/engagementLetterEngine');
        const context = EngagementLetterTemplateEngine.buildContext(masterData);
        const renderedText = EngagementLetterTemplateEngine.render(dbTemplate.file_content, context);

        const { EngagementLetterDocxGenerator } = await import('@/services/engagementLetterDocxGenerator');
        result = await EngagementLetterDocxGenerator.generateDocx(renderedText, masterData);
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to generate document');
      }

      const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      let blob: Blob | null = null;

      if (result.document_buffer) {
        blob = new Blob([result.document_buffer as unknown as ArrayBuffer], { type: mime });
      } else if (result.document_base64) {
        const byteCharacters = atob(result.document_base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        blob = new Blob([byteArray], { type: mime });
      }

      if (!blob) {
        throw new Error('No document data returned');
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `EngagementLetter_${entityName}_${new Date().toISOString().split('T')[0]}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Engagement letter generated and downloaded successfully!');
      setShowPreview(false);
      setPreviewContent('');
      setActiveTab('letter-selection');
    } catch (error) {
      console.error('Error generating letter:', error);
      toast.error(`Error: ${error instanceof Error ? error.message : 'Failed to generate letter'}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Engagement Letters Generator
          </CardTitle>
          <CardDescription>
            Create professional engagement letters for different audit engagement types. Fill in the master data below
            and generate customized letters.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="letter-selection">Letter Type</TabsTrigger>
          <TabsTrigger value="entity">Entity Info</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="auditor">Auditor</TabsTrigger>
          <TabsTrigger value="commercial">Commercial</TabsTrigger>
          <TabsTrigger value="generate">Review & Generate</TabsTrigger>
        </TabsList>

        {/* Step 1: Letter Type Selection */}
        <TabsContent value="letter-selection" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Select Letter Type</CardTitle>
              <CardDescription>Choose the type of engagement letter to generate</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {[
                  {
                    id: 'statutory-audit-company',
                    label: 'Statutory Audit - Company (Unlisted without IFC)',
                    description: 'For unlisted companies without IFC compliance requirements',
                  },
                  {
                    id: 'statutory-audit-company-ifc',
                    label: 'Statutory Audit - Company (Unlisted with IFC)',
                    description: 'For unlisted companies with Internal Financial Controls (IFC) reporting requirements',
                  },
                  {
                    id: 'tax-audit-partnership-3ca',
                    label: 'Tax Audit - Company (3CA - Audited)',
                    description: 'For companies with audited financial statements (Form 3CA)',
                    disabled: !isCompanyEntity,
                  },
                  {
                    id: 'tax-audit-partnership-3cb',
                    label: 'Tax Audit - Non-Company (3CB - Non-Audited)',
                    description: 'For non-company entities with non-audited financial statements (Form 3CB)',
                    disabled: isCompanyEntity,
                  },
                ].map((option) => (
                  <div
                    key={option.id}
                    onClick={() => (!option.disabled ? setLetterType(option.id) : null)}
                    className={`rounded-lg border-2 p-4 transition-colors ${
                      letterType === option.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    } ${option.disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                          letterType === option.id ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                        }`}
                      >
                        {letterType === option.id && <CheckCircle2 className="h-4 w-4 text-white" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{option.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
                        {option.disabled && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {isCompanyEntity ? 'Available only for non-company entities.' : 'Available only for companies.'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between gap-2 pt-4">
                <Button variant="outline" onClick={handleSaveDraft}>
                  Save changes
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleGeneratePreview} disabled={!letterType}>
                    Preview
                  </Button>
                  <Button onClick={() => setActiveTab('entity')} disabled={!letterType}>
                    Continue
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step 2: Entity Information */}
        <TabsContent value="entity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entity Information</CardTitle>
              <CardDescription>Provide details about the client entity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Entity Name *</Label>
                  <Input
                    value={entityName}
                    onChange={(e) => setEntityName(e.target.value)}
                    placeholder="e.g., ABC Private Limited"
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <Label>Entity Type</Label>
                  {isStatutoryCompanyLetter ? (
                    <Input value="Company" disabled />
                  ) : (
                    <Select value={entityType} onValueChange={setEntityType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Company">Company</SelectItem>
                        <SelectItem value="Partnership">Partnership</SelectItem>
                        <SelectItem value="Proprietorship">Proprietorship</SelectItem>
                        <SelectItem value="LLP">LLP</SelectItem>
                        <SelectItem value="Trust">Trust</SelectItem>
                        <SelectItem value="Society">Society</SelectItem>
                        <SelectItem value="Association of Persons (AOP)">Association of Persons (AOP)</SelectItem>
                        <SelectItem value="HUF">HUF</SelectItem>
                        <SelectItem value="Cooperative Society">Cooperative Society</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Registration/Incorporation Number</Label>
                  <Input
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="e.g., 12345678"
                  />
                </div>

                <div className="space-y-2">
                  <Label>PAN Number</Label>
                  <Input
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value)}
                    placeholder="e.g., ABCDE1234F"
                  />
                </div>

                <div className="space-y-2">
                  <Label>GSTIN</Label>
                  <Input
                    value={gstinNumber}
                    onChange={(e) => setGstinNumber(e.target.value)}
                    placeholder="e.g., 27AABCT1234H1Z0"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g., +91-22-XXXX-XXXX"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Full business address"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@entity.com"
                  type="email"
                />
              </div>

              <div className="flex justify-between gap-2 pt-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setActiveTab('letter-selection')}>
                    Back
                  </Button>
                  <Button variant="outline" onClick={handleSaveDraft}>Save changes</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleGeneratePreview}>Preview</Button>
                  <Button onClick={() => setActiveTab('engagement')}>Continue</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step 3: Engagement Period */}
        <TabsContent value="engagement" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Engagement Period & Dates</CardTitle>
              <CardDescription>Specify the audit engagement and financial year dates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-sm mb-3">Engagement Period</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-4">
                      {letterType.includes('statutory') && (
                        <div className="space-y-2">
                          <Label>AGM Date in which appointed</Label>
                          <Input
                            type="date"
                            value={agmDate}
                            onChange={(e) => setAgmDate(e.target.value)}
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Appointment Letter Date</Label>
                        <Input
                          type="date"
                          value={appointmentLetterDate}
                          onChange={(e) => setAppointmentLetterDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Appointment / Reappointment</Label>
                      <Select value={appointmentType} onValueChange={setAppointmentType}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="appointment">Appointment</SelectItem>
                          <SelectItem value="reappointment">Reappointment</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {SHOW_DUPLICATE_APPOINTMENT_FIELDS && (
                      <>
                        <div className="space-y-2">
                          <Label>Appointment Letter Date</Label>
                          <Input
                            type="date"
                            value={appointmentLetterDate}
                            onChange={(e) => setAppointmentLetterDate(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Appointment / Reappointment</Label>
                          <Select value={appointmentType} onValueChange={setAppointmentType}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="appointment">Appointment</SelectItem>
                              <SelectItem value="reappointment">Reappointment</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold text-sm mb-3">Engagement period coverage</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Engagement period FY Start Date</Label>
                      <Input
                        type="date"
                        value={financialYearStart}
                        onChange={(e) => setFinancialYearStart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Engagement period FY End Date</Label>
                      <Input
                        type="date"
                        value={financialYearEnd}
                        onChange={(e) => setFinancialYearEnd(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {letterType.includes('tax-audit') && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="font-semibold text-sm mb-3">Tax Audit</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Assessment Year</Label>
                          <Input
                            value={assessmentYear}
                            onChange={(e) => setAssessmentYear(e.target.value)}
                            placeholder="e.g., 2025-26"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

              </div>

              <div className="flex justify-between gap-2 pt-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setActiveTab('entity')}>
                    Back
                  </Button>
                  <Button variant="outline" onClick={handleSaveDraft}>Save changes</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleGeneratePreview}>Preview</Button>
                  <Button onClick={() => setActiveTab('auditor')}>Continue</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step 4: Auditor Details */}
        <TabsContent value="auditor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auditor Details</CardTitle>
              <CardDescription>
                Firm details are prefilled from Admin Settings. Update partner information as needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Firm Name * <span className="text-xs text-amber-600">(from Admin Settings)</span></Label>
                  <Input
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="e.g., XYZ Chartered Accountants"
                    disabled={!firmName ? false : true}
                  />
                  <p className="text-xs text-muted-foreground">Edit from Admin Settings G�� Firm</p>
                </div>

                <div className="space-y-2">
                  <Label>Partner / Proprietor Name *</Label>
                  {partners && partners.length > 0 ? (
                    <Select value={partnerName || undefined} onValueChange={setPartnerName}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select partner" />
                      </SelectTrigger>
                      <SelectContent>
                        {partners.map(partner => (
                          <SelectItem key={partner.id} value={partner.name || ''}>
                            {partner.name} {partner.membership_number && `(${partner.membership_number})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="p-3 border border-dashed rounded-md bg-muted/50">
                      <p className="text-sm text-muted-foreground text-center">
                        No partners found - Add partners in Admin Settings
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">From Admin Settings → Partners</p>
                </div>

                <div className="space-y-2">
                  <Label>Partner Place / Location <span className="text-xs text-amber-600">(from Admin Settings)</span></Label>
                  <Input
                    value={partnerPlace}
                    onChange={(e) => setPartnerPlace(e.target.value)}
                    placeholder="e.g., Mumbai"
                  />
                  <p className="text-xs text-muted-foreground">Extracted from firm address</p>
                </div>

                <div className="space-y-2">
                  <Label>Partner Signature Date</Label>
                  <Input
                    type="date"
                    value={partnerSignatureDate}
                    onChange={(e) => setPartnerSignatureDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
                <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-800">
                  <p><strong>Firm information is prefilled from Admin Settings.</strong></p>
                  <p className="mt-1">To change firm name or address, go to Admin Settings G�� Firm tab.</p>
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setActiveTab('engagement')}>
                    Back
                  </Button>
                  <Button variant="outline" onClick={handleSaveDraft}>Save changes</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleGeneratePreview}>Preview</Button>
                  <Button onClick={() => setActiveTab('commercial')}>Continue</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step 5: Commercial Terms & Management Responsibility */}
        <TabsContent value="commercial" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Commercial Terms & Management Responsibility</CardTitle>
              <CardDescription>Specify fees and get management acknowledgments</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Commercial Terms */}
              <div>
                <h4 className="font-semibold text-sm mb-4">Commercial Terms</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Professional Fees (INR) *</Label>
                    <Input
                      type="number"
                      value={professionalFees}
                      onChange={(e) => setProfessionalFees(e.target.value)}
                      placeholder="e.g., 50000"
                    />
                  </div>

                  <div className="flex items-center gap-2 md:pt-7">
                    <Checkbox
                      checked={gstExtraApplicable}
                      onCheckedChange={(v) => setGstExtraApplicable(!!v)}
                    />
                    <Label className="font-normal">GST extra (as applicable)</Label>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Management Responsibility */}
              <div>
                <h4 className="font-semibold text-sm mb-4">Management Responsibility Acknowledgments</h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={acceptManagementResponsibility}
                      onCheckedChange={(v) => setAcceptManagementResponsibility(!!v)}
                    />
                    <Label className="font-normal leading-relaxed">
                      Management accepts responsibility for the preparation and fair presentation of financial
                      statements in accordance with applicable accounting standards
                    </Label>
                  </div>

                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={understandAuditProcess}
                      onCheckedChange={(v) => setUnderstandAuditProcess(!!v)}
                    />
                    <Label className="font-normal leading-relaxed">
                      Management understands the audit process and is committed to provide all necessary information and
                      cooperation
                    </Label>
                  </div>

                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={confirmDataAccess}
                      onCheckedChange={(v) => setConfirmDataAccess(!!v)}
                    />
                    <Label className="font-normal leading-relaxed">
                      Management confirms access to all books, records, and necessary data for audit procedures
                    </Label>
                  </div>
                </div>
              </div>

              {/* Conditional Sections based on Letter Type */}
              {letterType.includes('statutory') && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-semibold text-sm mb-4">Statutory Audit Configuration</h4>
                    <div className="space-y-3">
                      {letterType === 'statutory-audit-company-ifc' && (
                        <div className="flex items-center gap-2">
                          <Checkbox checked={ifcApplicable} disabled />
                          <Label className="font-normal">IFC (Internal Financial Controls) Reporting Applicable</Label>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={caroApplicable}
                          onCheckedChange={(v) => setCaroApplicable(!!v)}
                        />
                        <Label className="font-normal">CARO (Auditor's Report on CARO 2020) Applicable</Label>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {letterType.includes('tax-audit') && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-semibold text-sm mb-4">Tax Audit Configuration</h4>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Tax Audit Form *</Label>
                        <Select value={taxAuditForm} onValueChange={setTaxAuditForm} disabled>
                          <SelectTrigger>
                            <SelectValue placeholder="Select form type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3CA">3CA (Audited Accounts)</SelectItem>
                            <SelectItem value="3CB">3CB (Non-Audited Accounts)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={auditedUnderOtherLaw}
                          onCheckedChange={(v) => setAuditedUnderOtherLaw(!!v)}
                        />
                        <Label className="font-normal">Also audited under other law (e.g., Companies Act)</Label>
                      </div>

                      {auditedUnderOtherLaw && (
                        <div className="space-y-2">
                          <Label>Other Law Details</Label>
                          <Textarea
                            value={otherLawDetails}
                            onChange={(e) => setOtherLawDetails(e.target.value)}
                            placeholder="Specify which law and audit scope"
                            rows={2}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-between gap-2 pt-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setActiveTab('auditor')}>
                    Back
                  </Button>
                  <Button variant="outline" onClick={handleSaveDraft}>Save changes</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleGeneratePreview}>Preview</Button>
                  <Button onClick={() => setActiveTab('generate')}>Review & Generate</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step 6: Review & Generate */}
        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review & Generate Letter</CardTitle>
              <CardDescription>Review the information provided and generate the engagement letter</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-4">
                  <div>
                    <h5 className="font-semibold text-sm text-muted-foreground mb-2">Letter Type</h5>
                    <p className="text-sm">{getLetterTypeLabel(letterType)}</p>
                  </div>

                  <Separator />

                  <div>
                    <h5 className="font-semibold text-sm text-muted-foreground mb-2">Entity</h5>
                    <p className="text-sm font-medium">{entityName}</p>
                    {panNumber && <p className="text-xs text-muted-foreground">PAN: {panNumber}</p>}
                    {registrationNumber && (
                      <p className="text-xs text-muted-foreground">Reg: {registrationNumber}</p>
                    )}
                  </div>

                  <Separator />

                  <div>
                    <h5 className="font-semibold text-sm text-muted-foreground mb-2">Auditor Firm</h5>
                    <p className="text-sm font-medium">{firmName}</p>
                    <p className="text-sm">Partner: {partnerName}</p>
                  </div>

                  <Separator />

                  <div>
                    <h5 className="font-semibold text-sm text-muted-foreground mb-2">Professional Fees</h5>
                    <p className="text-sm font-medium">
                      ₹{Number(professionalFees).toLocaleString('en-IN')}
                      {gstExtraApplicable && ' + GST extra'}
                    </p>
                  </div>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                  <div>
                    <h5 className="font-semibold text-sm text-muted-foreground mb-2">Engagement Period Coverage</h5>
                    {financialYearStart && financialYearEnd ? (
                      <p className="text-sm">
                        {new Date(financialYearStart).toLocaleDateString()} to{' '}
                        {new Date(financialYearEnd).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600">Coverage dates not fully specified</p>
                    )}
                  </div>

                  <Separator />

                  {letterType.includes('statutory') && (
                    <div>
                      <h5 className="font-semibold text-sm text-muted-foreground mb-2">Reporting</h5>
                      <div className="space-y-1 text-sm">
                        {ifcApplicable && <p>✓ IFC Reporting</p>}
                        {caroApplicable && <p>✓ CARO 2020</p>}
                        {!ifcApplicable && !caroApplicable && (
                          <p className="text-muted-foreground">Standard statutory audit</p>
                        )}
                      </div>
                    </div>
                  )}

                  {letterType.includes('tax-audit') && (
                    <div>
                      <h5 className="font-semibold text-sm text-muted-foreground mb-2">Tax Audit</h5>
                      <p className="text-sm">Form: {taxAuditForm}</p>
                      {auditedUnderOtherLaw && (
                        <p className="text-xs text-muted-foreground">Also audited under other law</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-semibold">Ready to generate?</p>
                  <p className="mt-1">
                    The engagement letter will be generated as a Word document (.docx) with all the information you
                    provided.
                  </p>
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-4">
                <Button variant="outline" onClick={() => setActiveTab('commercial')}>
                  Back
                </Button>
                <Button
                  onClick={handleGeneratePreview}
                  disabled={generating}
                  className="gap-2"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Preview Letter
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col">
            <CardHeader className="border-b">
              <CardTitle>Letter Preview</CardTitle>
              <CardDescription>Review the generated letter before downloading</CardDescription>
            </CardHeader>
            <div className="flex-1 overflow-auto p-6 bg-white">
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-xs leading-relaxed font-mono">
                {previewContent}
              </div>
            </div>
            <div className="border-t p-4 flex justify-between gap-2 bg-gray-50">
              <Button variant="outline" onClick={() => { setShowPreview(false); setPreviewContent(''); }}>
                Cancel
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {
                  const element = document.createElement('a');
                  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(previewContent));
                  element.setAttribute('download', `letter_preview_${new Date().toISOString().split('T')[0]}.txt`);
                  element.style.display = 'none';
                  document.body.appendChild(element);
                  element.click();
                  document.body.removeChild(element);
                }}>
                  Export Preview as Text
                </Button>
                <Button
                  variant="outline"
                  onClick={handleConfirmAndGenerate}
                  disabled={generating}
                  className="gap-2"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Export to Word
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
