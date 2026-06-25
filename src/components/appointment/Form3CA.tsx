import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { toast } from 'sonner';
import { Eye, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { AlignmentType, BorderStyle, Document, Paragraph, Packer, Table, TableCell, TableRow, TextRun, UnderlineType, WidthType } from 'docx';
import { useEngagement } from '@/contexts/EngagementContext';
import { useClient } from '@/hooks/useClient';
import { useFirmSettings } from '@/hooks/useFirmSettings';
import { usePartners } from '@/hooks/usePartners';
import { EvidenceFile, useEvidenceFiles } from '@/hooks/useEvidenceFiles';
import { useForm3CADocument } from '@/hooks/useForm3CADocument';
import { FORM_3CA_TEMPLATE_VERSION, form3caTemplate } from '@/data/form3caTemplate';

const FIELD_PLACEHOLDERS = {
  i_or_we: 'I/We',
  assessee_name_and_address: '(Name and address of the assessee)',
  me_or_us: 'me/us',
  statutory_auditor_name: '(Auditor/Firm name)',
  governing_act_name: '(Act name)',
  my_our_or_their: 'my/our/their',
  statutory_audit_report_date: 'DD MMMM YYYY',
  profit_loss_or_income_expenditure_account: '(Profit & Loss / Income & Expenditure Account)',
  period_start_date: '01 April YYYY',
  period_end_date: '31 March YYYY',
  balance_sheet_date: '31 March YYYY',
  my_or_our: 'my/our',
  observation_or_qualification_1: '(Observation or qualification 1)',
  observation_or_qualification_2: '(Observation or qualification 2)',
  additional_observations_or_qualifications: '(Additional observations or qualifications)',
  firm_name: '(Firm name)',
  firm_registration_number: '(Firm registration number)',
  partner_or_proprietor_name: '(Partner / Proprietor name)',
  partner_or_proprietor_designation: '(Partner / Proprietor designation)',
  report_date: 'DD MMMM YYYY',
  membership_number: '(Membership number)',
  udin: '(UDIN)',
  firm_full_address: '(Firm full address)',
};

type Form3CAProps = {
  governingActName?: string | null;
};

const CERTIFICATE_FILE_TYPE = 'form_3ca_certificate';

const formatFieldForTemplate = (value: string, fallback: string) => {
  const text = value.trim();
  if (!text) {
    return `<span class="missing">${fallback}</span>`;
  }
  return text.replace(/\n/g, '<br />');
};

const formatDateForTemplate = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB').format(date);
};

const populateTemplate = (values: Record<string, string>) => {
  return Object.entries(values).reduce((content, [key, value]) => {
    return content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }, form3caTemplate);
};

const editorStyles = `
.form-3ca-editor [contenteditable] {
  font-family: "Times New Roman", Times, serif;
  font-size: 12pt;
  line-height: 1.15;
  color: #1b1c21;
  height: 520px;
  overflow: auto;
  background: #fff;
  padding: 72px 88px;
  white-space: normal;
  overflow-wrap: break-word;
  box-sizing: border-box;
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}

.form-3ca-editor.prefill-collapsed [contenteditable] {
  height: 70vh;
  max-height: 720px;
}

.form-3ca-editor .preview-letter {
  width: 100%;
  font-size: 12pt;
  line-height: 1.15;
}

.form-3ca-editor .preview-letter,
.form-3ca-editor .preview-letter * {
  font-family: "Times New Roman", Times, serif;
  font-size: 12pt;
  line-height: 1.15;
}

.form-3ca-editor .preview-letter p {
  margin: 0 0 6pt 0;
  text-align: justify;
}

.form-3ca-editor .preview-letter .center { text-align: center; }
.form-3ca-editor .preview-letter .bold { font-weight: bold; }
.form-3ca-editor .preview-letter .italic { font-style: italic; }
.form-3ca-editor .preview-letter .heading { margin: 0; }
.form-3ca-editor .preview-letter .subheading { margin: 2px 0; }
.form-3ca-editor .preview-letter .clause { margin-left: 0; }
.form-3ca-editor .preview-letter .subclause { margin-left: 18px; text-indent: -18px; }
.form-3ca-editor .preview-letter .responsibility { margin-left: 18px; text-indent: -18px; }
.form-3ca-editor .preview-letter .placeholder {
  display: inline-block;
  min-width: 70px;
  padding: 0 3px;
  border-bottom: 1px dotted #555;
  background: #fff7cc;
  color: #000;
  font-family: Consolas, "Courier New", monospace;
  font-size: 10.5pt;
  line-height: 1.1;
  white-space: nowrap;
}
.form-3ca-editor .preview-letter .signature-block { margin-top: 34px; width: 100%; }
.form-3ca-editor .preview-letter .firm-block { text-align: left; margin-left: auto; width: 48%; }
.form-3ca-editor .preview-letter .small-note {
  color: #444;
  font-size: 10pt;
  margin-top: 18px;
  border-top: 1px solid #cfcfcf;
  padding-top: 8px;
}
.form-3ca-editor .preview-letter .missing {
  background: #fff3a3;
  border-bottom: 1px solid #333;
  padding: 0 4px;
}
.form-3ca-editor .preview-letter .spacer {
  height: 12pt;
  line-height: 12pt;
  margin: 6pt 0;
}
`;

const convertHtmlToDocxElements = (html: string) => {
  if (typeof document === 'undefined') {
    return [new Paragraph('')];
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  const elements: Array<Paragraph | Table> = [];

  const baseRunProps = {
    font: 'Times New Roman',
    size: 24,
  };

  type TrimState = { trimLeading: boolean };

  const buildRuns = (
    node: ChildNode,
    styles: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      missing?: boolean;
    } = {},
    state: TrimState
  ): TextRun[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent || '';
      if (state.trimLeading) {
        text = text.replace(/^\s+/, '');
      }
      text = text.replace(/\s+/g, ' ');
      if (!text.trim()) return [];
      state.trimLeading = false;
      return [
        new TextRun({
          ...baseRunProps,
          text,
          bold: styles.bold,
          italics: styles.italic,
          underline: styles.underline || styles.missing ? { type: UnderlineType.SINGLE } : undefined,
          highlight: styles.missing ? 'yellow' : undefined,
        }),
      ];
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === 'BR') {
        state.trimLeading = true;
        return [new TextRun({ ...baseRunProps, text: '', break: 1 })];
      }
      if (element.tagName === 'STYLE') {
        return [];
      }

      const nextStyles = { ...styles };
      if (element.tagName === 'B' || element.tagName === 'STRONG') nextStyles.bold = true;
      if (element.tagName === 'I' || element.tagName === 'EM') nextStyles.italic = true;
      if (element.tagName === 'U') nextStyles.underline = true;
      if (element.classList.contains('missing')) nextStyles.missing = true;

      let runs: TextRun[] = [];
      element.childNodes.forEach((child) => {
        runs = runs.concat(buildRuns(child, nextStyles, state));
      });
      return runs;
    }

    return [];
  };

  const buildRunsFromNodes = (
    nodes: NodeListOf<ChildNode> | ChildNode[],
    baseStyles: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      missing?: boolean;
    } = {}
  ) => {
    const state: TrimState = { trimLeading: true };
    let runs: TextRun[] = [];
    nodes.forEach((child) => {
      runs = runs.concat(buildRuns(child, baseStyles, state));
    });
    return runs;
  };

  const buildParagraphFromElement = (element: HTMLElement): Paragraph => {
    const isSpacer = element.classList.contains('spacer');
    
    if (isSpacer) {
      return new Paragraph({
        children: [new TextRun('')],
        spacing: { after: 120, line: 240 },
      });
    }

    const runs = buildRunsFromNodes(element.childNodes, {
      bold: element.classList.contains('bold'),
    });

    const isCenter = element.classList.contains('center');
    const isRight = element.classList.contains('right');
    const isHeading = element.classList.contains('heading');
    const isSubheading = element.classList.contains('subheading');
    const isClause = element.classList.contains('clause');
    const isSubclause = element.classList.contains('subclause');
    const isResponsibility = element.classList.contains('responsibility');

    let alignment = AlignmentType.LEFT;
    if (isCenter) alignment = AlignmentType.CENTER;
    if (isRight) alignment = AlignmentType.RIGHT;

    let indent = {};
    if (isSubclause || isResponsibility) {
      indent = {
        left: 720,
        firstLine: -360,
      };
    } else if (isClause) {
      indent = {
        left: 0,
      };
    }

    const spacing: any = {
      line: 276,
      after: 120,
    };

    if (isHeading) {
      spacing.after = 60;
    } else if (isSubheading) {
      spacing.after = 120;
    }

    return new Paragraph({
      children: runs.length ? runs : [new TextRun('')],
      alignment,
      spacing,
      indent: Object.keys(indent).length > 0 ? indent : undefined,
    });
  };

  const buildTableFromElement = (table: HTMLTableElement): Table => {
    const rows = Array.from(table.rows).map((row) => {
      const cells = Array.from(row.cells).map((cell) => {
        const cellElement = cell as HTMLTableCellElement;
        const runs = buildRunsFromNodes(cellElement.childNodes);
        const colSpan = cellElement.colSpan || 1;
        return new TableCell({
          children: [
            new Paragraph({
              children: runs.length ? runs : [new TextRun('')],
              alignment: cellElement.style.textAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
              spacing: { line: 276 },
            }),
          ],
          columnSpan: colSpan,
        });
      });
      return new TableRow({ children: cells });
    });

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
    });
  };

  const processElements = (parent: HTMLElement) => {
    Array.from(parent.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;

      if (child.tagName === 'TABLE') {
        elements.push(buildTableFromElement(child as HTMLTableElement));
        return;
      }

      if (child.tagName === 'P') {
        elements.push(buildParagraphFromElement(child));
        return;
      }

      if (child.tagName === 'DIV' || child.tagName === 'SECTION') {
        processElements(child);
        return;
      }
    });
  };

  const root = (container.querySelector('.preview-letter') as HTMLElement | null) || container;
  processElements(root);

  if (!elements.length) {
    elements.push(new Paragraph(''));
  }

  return elements;
};

const parseFinancialYearRange = (financialYear?: string) => {
  const match = financialYear?.trim().match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) {
    return { start: '', end: '', bsDate: '' };
  }
  const startYear = Number(match[1]);
  const endYear = match[2].length === 2 ? Number(match[1].slice(0, 2) + match[2]) : Number(match[2]);
  return {
    start: `01 April ${startYear}`,
    end: `31 March ${endYear}`,
    bsDate: `31 March ${endYear}`,
  };
};

export function Form3CA({ governingActName: governingActNameProp }: Form3CAProps) {
  const { currentEngagement } = useEngagement();
  const { client } = useClient(currentEngagement?.client_id || null);
  const { firmSettings } = useFirmSettings();
  const { partners } = usePartners();
  const { document: savedDocument, loading, saving, saveDocument } = useForm3CADocument(currentEngagement?.id);
  const { files: evidenceFiles, uploadFile: uploadEvidenceFile, deleteFile, getFileUrl } = useEvidenceFiles(currentEngagement?.id || undefined);

  const [editorHtml, setEditorHtml] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [assesseeNameAndAddress, setAssesseeNameAndAddress] = useState('');
  const [statutoryAuditorName, setStatutoryAuditorName] = useState('');
  const [governingActName, setGoverningActName] = useState(governingActNameProp || '');
  const [statutoryAuditReportDate, setStatutoryAuditReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [profitLossAccountLabel, setProfitLossAccountLabel] = useState('Profit & Loss Account');
  const [myOrOur, setMyOrOur] = useState('my/our');
  const [iOrWe, setIOrWe] = useState('I/We');
  const [meOrUs, setMeOrUs] = useState('me/us');
  const [observation1, setObservation1] = useState('');
  const [observation2, setObservation2] = useState('');
  const [additionalObservations, setAdditionalObservations] = useState('');
  const [partnerDesignation, setPartnerDesignation] = useState('Partner');
  const [udin, setUdin] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [prefillOpen, setPrefillOpen] = useState(true);
  const initializedRef = useRef<string | null>(null);
  const certificateInputRef = useRef<HTMLInputElement>(null);

  const period = useMemo(() => parseFinancialYearRange(currentEngagement?.financial_year), [currentEngagement?.financial_year]);

  useEffect(() => {
    if (client) {
      const formattedAddress = [client.name, client.address].filter(Boolean).join(', ');
      setAssesseeNameAndAddress(formattedAddress);
    }
  }, [client]);

  useEffect(() => {
    if (firmSettings) {
      setStatutoryAuditorName(firmSettings.firm_name || '');
      setPartnerDesignation('Partner');
    }
  }, [firmSettings]);

  useEffect(() => {
    if (governingActNameProp !== undefined) {
      setGoverningActName(governingActNameProp || '');
    }
  }, [governingActNameProp, currentEngagement?.id]);

  useEffect(() => {
    if (!currentEngagement || partners.length === 0) return;
    const matched = currentEngagement.partner_id ? partners.find((partner) => partner.id === currentEngagement.partner_id) : null;
    if (matched) {
      setPartnerDesignation(matched.name);
      setUdin(matched.membership_number || '');
    }
  }, [currentEngagement?.partner_id, partners]);

  const templateValues = useMemo(() => ({
    I_OR_WE: formatFieldForTemplate(iOrWe, FIELD_PLACEHOLDERS.i_or_we),
    ASSESSEE_NAME_AND_ADDRESS: formatFieldForTemplate(assesseeNameAndAddress, FIELD_PLACEHOLDERS.assessee_name_and_address),
    ME_OR_US: formatFieldForTemplate(meOrUs, FIELD_PLACEHOLDERS.me_or_us),
    STATUTORY_AUDITOR_NAME: formatFieldForTemplate(statutoryAuditorName, FIELD_PLACEHOLDERS.statutory_auditor_name),
    GOVERNING_ACT_NAME: formatFieldForTemplate(governingActName, FIELD_PLACEHOLDERS.governing_act_name),
    MY_OUR_OR_THEIR: formatFieldForTemplate(myOrOur, FIELD_PLACEHOLDERS.my_our_or_their),
    STATUTORY_AUDIT_REPORT_DATE: formatFieldForTemplate(formatDateForTemplate(statutoryAuditReportDate), FIELD_PLACEHOLDERS.statutory_audit_report_date),
    PROFIT_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT: formatFieldForTemplate(profitLossAccountLabel, FIELD_PLACEHOLDERS.profit_loss_or_income_expenditure_account),
    PERIOD_START_DATE: formatFieldForTemplate(period.start, FIELD_PLACEHOLDERS.period_start_date),
    PERIOD_END_DATE: formatFieldForTemplate(period.end, FIELD_PLACEHOLDERS.period_end_date),
    BALANCE_SHEET_DATE: formatFieldForTemplate(period.bsDate, FIELD_PLACEHOLDERS.balance_sheet_date),
    MY_OR_OUR: formatFieldForTemplate(myOrOur, FIELD_PLACEHOLDERS.my_or_our),
    OBSERVATION_OR_QUALIFICATION_1: formatFieldForTemplate(observation1, FIELD_PLACEHOLDERS.observation_or_qualification_1),
    OBSERVATION_OR_QUALIFICATION_2: formatFieldForTemplate(observation2, FIELD_PLACEHOLDERS.observation_or_qualification_2),
    ADDITIONAL_OBSERVATIONS_OR_QUALIFICATIONS: formatFieldForTemplate(additionalObservations, FIELD_PLACEHOLDERS.additional_observations_or_qualifications),
    FIRM_NAME: formatFieldForTemplate(firmSettings?.firm_name || '', FIELD_PLACEHOLDERS.firm_name),
    FIRM_REGISTRATION_NUMBER: formatFieldForTemplate(firmSettings?.firm_registration_no || '', FIELD_PLACEHOLDERS.firm_registration_number),
    PARTNER_OR_PROPRIETOR_NAME: formatFieldForTemplate(partnerDesignation, FIELD_PLACEHOLDERS.partner_or_proprietor_name),
    PARTNER_OR_PROPRIETOR_DESIGNATION: formatFieldForTemplate(partnerDesignation, FIELD_PLACEHOLDERS.partner_or_proprietor_designation),
    REPORT_DATE: formatFieldForTemplate(formatDateForTemplate(reportDate), FIELD_PLACEHOLDERS.report_date),
    MEMBERSHIP_NUMBER: formatFieldForTemplate(udin, FIELD_PLACEHOLDERS.membership_number),
    UDIN: formatFieldForTemplate(udin, FIELD_PLACEHOLDERS.udin),
    FIRM_FULL_ADDRESS: formatFieldForTemplate(firmSettings?.address || '', FIELD_PLACEHOLDERS.firm_full_address),
  }), [
    iOrWe,
    assesseeNameAndAddress,
    meOrUs,
    statutoryAuditorName,
    governingActName,
    myOrOur,
    statutoryAuditReportDate,
    profitLossAccountLabel,
    period.end,
    period.start,
    period.bsDate,
    observation1,
    observation2,
    additionalObservations,
    firmSettings,
    partnerDesignation,
    reportDate,
    udin,
  ]);

  const templateHtml = useMemo(() => populateTemplate(templateValues), [templateValues]);

  const certificateFiles = useMemo(
    () => evidenceFiles.filter((file) => file.file_type === CERTIFICATE_FILE_TYPE),
    [evidenceFiles]
  );

  const handleEditorChange = (value: string) => {
    setEditorHtml(value);
    setIsDirty(true);
  };

  const normalizeMissingHighlights = useCallback((root: HTMLDivElement) => {
    const nodes = root.querySelectorAll('span.missing');
    nodes.forEach((node) => {
      const text = node.textContent || '';
      if (text.replace(/[\s_]+/g, '') !== '') {
        node.classList.remove('missing');
        if (!node.className) {
          node.removeAttribute('class');
        }
      }
    });
  }, []);

  const isCurrentTemplate = useCallback(
    (content: string) => content.includes(`data-template-version="${FORM_3CA_TEMPLATE_VERSION}"`),
    []
  );

  const normalizeHtml = useCallback((value: string) => value.replace(/\s+/g, ' ').trim(), []);

  useEffect(() => {
    if (!currentEngagement) return;
    initializedRef.current = null;
    setShowEditor(false);
    setIsDirty(false);
    setEditorHtml('');
    setPrefillOpen(true);
    setReportDate(new Date().toISOString().split('T')[0]);
  }, [currentEngagement?.id]);

  useEffect(() => {
    if (!showEditor || !currentEngagement) return;
    if (initializedRef.current === currentEngagement.id) return;
    initializedRef.current = currentEngagement.id;

    if (savedDocument?.content_html && isCurrentTemplate(savedDocument.content_html)) {
      const savedHtml = savedDocument.content_html;
      const isSameAsTemplate = normalizeHtml(savedHtml) === normalizeHtml(templateHtml);
      setEditorHtml(savedHtml);
      setIsDirty(!isSameAsTemplate);
      return;
    }

    setEditorHtml(templateHtml);
    setIsDirty(false);
  }, [showEditor, currentEngagement?.id, savedDocument?.content_html, templateHtml, isCurrentTemplate, normalizeHtml]);

  useEffect(() => {
    if (!showEditor) return;
    if (!isDirty) {
      setEditorHtml(templateHtml);
    }
  }, [templateHtml, showEditor, isDirty]);

  const handleSaveDraft = async () => {
    if (!currentEngagement) {
      toast.error('Select an engagement before saving');
      return;
    }
    const draftHtml = editorHtml.trim() ? editorHtml : templateHtml;
    if (!draftHtml.trim()) {
      toast.error('Add content before saving');
      return;
    }
    const saved = await saveDocument(draftHtml, 'Form 3CA');
    if (saved) {
      toast.success('Draft saved');
    }
  };

  const handleApplyPrefill = () => {
    setEditorHtml(templateHtml);
    setIsDirty(false);
  };

  const handleExportWord = async () => {
    const exportHtml = editorHtml.trim() ? editorHtml : templateHtml;
    if (!exportHtml.trim()) {
      toast.error('Add content before exporting');
      return;
    }
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Times New Roman', size: 24 },
            paragraph: { spacing: { line: 276, after: 120 }, indent: { left: 0, right: 0, firstLine: 0, hanging: 0 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
          },
          children: convertHtmlToDocxElements(exportHtml),
        },
      ],
    });

    try {
      const blob = await Packer.toBlob(doc);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const safeName = currentEngagement?.client_name ? `Form_3CA_${currentEngagement.client_name}` : 'Form_3CA';
      link.download = `${safeName.replace(/\s+/g, '_')}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Word document generated');
    } catch (err: any) {
      console.error('Failed to export Word document', err);
      toast.error(err?.message || 'Failed to export Word document');
    }
  };

  const handleCertificateUpload = () => {
    return async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;
      const validExtensions = ['pdf', 'jpg', 'jpeg', 'png'];
      const invalidFiles = files.filter((item) => {
        const fileExtension = item.name.split('.').pop()?.toLowerCase();
        return !fileExtension || !validExtensions.includes(fileExtension);
      });
      if (invalidFiles.length) {
        toast.error('Invalid file format. Only PDF, JPG, JPEG, or PNG files are allowed.');
        event.target.value = '';
        return;
      }
      if (!currentEngagement) {
        toast.error('Please select an engagement before uploading.');
        event.target.value = '';
        return;
      }
      for (const file of files) {
        await uploadEvidenceFile(file, { name: file.name, file_type: CERTIFICATE_FILE_TYPE });
      }
      event.target.value = '';
    };
  };

  const openCertificatePreview = async (file: EvidenceFile) => {
    const url = await getFileUrl(file);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      toast.error('Unable to preview this file.');
    }
  };

  const renderCertificateFiles = () => {
    if (certificateFiles.length === 0) {
      return <p className="text-xs text-muted-foreground">No uploads yet.</p>;
    }
    return (
      <div className="space-y-2">
        {certificateFiles.map((file) => (
          <div key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{new Date(file.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => openCertificatePreview(file)}>
                <Eye className="h-4 w-4 mr-2" />
                View
              </Button>
              <Button size="sm" variant="destructive" onClick={() => deleteFile(file)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (!currentEngagement) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Form 3CA
          </CardTitle>
          <CardDescription>Select an engagement to edit Form 3CA.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={showEditor ? 'gap-3 sm:flex-row sm:items-start sm:justify-between' : undefined}>
        <div className="space-y-1.5">
          <CardTitle>Form 3CA</CardTitle>
          <CardDescription>Generate Form 3CA using engagement and client master data.</CardDescription>
        </div>
        {showEditor && (
          <Button variant="outline" size="sm" onClick={() => setShowEditor(false)}>
            Back to 3CA
          </Button>
        )}
      </CardHeader>
      {!showEditor ? (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Generate Form 3CA for the selected engagement and save the draft.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowEditor(true)}>Generate Form 3CA</Button>
            <Button variant="outline" onClick={() => certificateInputRef.current?.click()}>
              <UploadCloud className="h-4 w-4 mr-2" />
              Upload 3CA File
            </Button>
          </div>
          <input
            ref={certificateInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            onChange={handleCertificateUpload()}
            className="hidden"
          />
          <p className="text-xs text-muted-foreground">Supported formats: PDF, JPG/JPEG, PNG</p>
          {renderCertificateFiles()}
        </CardContent>
      ) : (
        <CardContent className="space-y-6">
          {loading && <p className="text-xs text-muted-foreground">Loading saved draft...</p>}
          <Collapsible open={prefillOpen} onOpenChange={setPrefillOpen}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Prefill details</p>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">{prefillOpen ? 'Collapse' : 'Expand'}</Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Tax audit Report date</Label>
                  <Input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
                </div>
                <div>
                  <Label>Assessee name and address</Label>
                  <Textarea
                    rows={2}
                    placeholder="Name and address"
                    value={assesseeNameAndAddress}
                    onChange={(event) => setAssesseeNameAndAddress(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Statutory auditor / firm name</Label>
                  <Input
                    placeholder="Statutory auditor name"
                    value={statutoryAuditorName}
                    onChange={(event) => setStatutoryAuditorName(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Governing Act name</Label>
                  <Input
                    placeholder="Income-tax"
                    value={governingActName}
                    onChange={(event) => setGoverningActName(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Date of audit report for audit under other law/act</Label>
                  <Input
                    type="date"
                    value={statutoryAuditReportDate}
                    onChange={(event) => setStatutoryAuditReportDate(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Profit / loss account label</Label>
                  <Select value={profitLossAccountLabel} onValueChange={(value) => setProfitLossAccountLabel(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Profit & Loss Account">Profit & Loss Account</SelectItem>
                      <SelectItem value="Income and Expenditure Account">Income and Expenditure Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>I/We label</Label>
                  <Input value={iOrWe} onChange={(event) => setIOrWe(event.target.value)} />
                </div>
                <div>
                  <Label>Me/Us label</Label>
                  <Input value={meOrUs} onChange={(event) => setMeOrUs(event.target.value)} />
                </div>
                <div>
                  <Label>My/Our label</Label>
                  <Input value={myOrOur} onChange={(event) => setMyOrOur(event.target.value)} />
                </div>
                <div>
                  <Label>Observation / Qualification 1</Label>
                  <Textarea
                    rows={2}
                    placeholder="Observation or qualification"
                    value={observation1}
                    onChange={(event) => setObservation1(event.target.value)}
                  />
                </div>
                <div>
                  <Label>Observation / Qualification 2</Label>
                  <Textarea
                    rows={2}
                    placeholder="Observation or qualification"
                    value={observation2}
                    onChange={(event) => setObservation2(event.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Additional observations/qualifications</Label>
                  <Textarea
                    rows={2}
                    placeholder="Additional observations or qualifications"
                    value={additionalObservations}
                    onChange={(event) => setAdditionalObservations(event.target.value)}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <p className="text-sm text-muted-foreground">Apply the current prefill data to the editor preview.</p>
            <Button variant="secondary" size="sm" onClick={handleApplyPrefill}>
              Apply prefill
            </Button>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Editable preview</p>
              <span className="text-xs text-muted-foreground">Word layout</span>
            </div>
            <style>{editorStyles}</style>
            <RichTextEditor
              value={editorHtml}
              onChange={handleEditorChange}
              normalizeDom={normalizeMissingHighlights}
              placeholder="Edit the Form 3CA here. All fields are editable."
              className={prefillOpen ? 'form-3ca-editor' : 'form-3ca-editor prefill-collapsed'}
            />

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSaveDraft} disabled={saving}>Save draft</Button>
              <Button onClick={handleExportWord}>Export Word</Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
