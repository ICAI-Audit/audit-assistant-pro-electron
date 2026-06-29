import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from 'docx';
import { toast } from 'sonner';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useEngagement } from '@/contexts/EngagementContext';
import { useClient } from '@/hooks/useClient';
import { useFirmSettings } from '@/hooks/useFirmSettings';
import { usePartners } from '@/hooks/usePartners';
import { useForm3CBDocument } from '@/hooks/useForm3CBDocument';
import { FORM_3CB_TEMPLATE_VERSION, form3cbTemplate } from '@/data/form3cbTemplate';
import type { TaxAuditReportObservation } from '@/types/taxAuditReportObservation';

type PronounSelection = 'i' | 'we';
type AccountLabel = 'Profit & Loss Account' | 'Income and Expenditure Account';
type ObservationRow = {
  id: string;
  text: string;
};

type Form3CBDraftJson = {
  manualPara3Observations?: ObservationRow[];
  manualPara5Observations?: ObservationRow[];
};

const FIELD_PLACEHOLDERS = {
  i_or_we: 'I/We',
  assessee_name: '(Name of the assessee)',
  assessee_address: '(Address of the assessee)',
  assessee_pan_or_aadhaar: '(PAN)',
  head_office_address: '(Head office address)',
  number_or_details_of_branches: '(Number/details of branches)',
  profit_loss_or_income_expenditure_account: '(Profit & Loss / Income & Expenditure Account)',
  result_term: '(profit/loss/surplus/deficit)',
  firm_name: '(Firm name)',
  firm_registration_number: '(Firm registration number)',
  partner_or_proprietor_name: '(Partner / Proprietor name)',
  partner_or_proprietor_designation: '(Partner / Proprietor designation)',
  report_date: 'DD MMMM YYYY',
  membership_number: '(Membership number)',
  udin: '(UDIN)',
  place_of_signing: '(Place of signing)',
};

const TAX_AUDITOR_PRONOUNS: Record<
  PronounSelection,
  {
    iOrWe: string;
    iOrWeLower: string;
    iOrWeBe: string;
    meOrUs: string;
    myOrOur: string;
  }
> = {
  i: { iOrWe: 'I', iOrWeLower: 'I', iOrWeBe: 'am', meOrUs: 'me', myOrOur: 'my' },
  we: { iOrWe: 'We', iOrWeLower: 'we', iOrWeBe: 'are', meOrUs: 'us', myOrOur: 'our' },
};

const RESULT_TERM_OPTIONS: Record<AccountLabel, string[]> = {
  'Profit & Loss Account': ['profit', 'loss'],
  'Income and Expenditure Account': ['surplus', 'deficit'],
};

const editorStyles = `
.form-3cb-editor [contenteditable] {
  font-family: "Times New Roman", Times, serif;
  font-size: 12pt;
  line-height: 1.15;
  color: #1b1c21;
  height: 520px;
  overflow: auto;
  background: #fff;
  padding: 64px 72px;
  white-space: normal;
  overflow-wrap: break-word;
  box-sizing: border-box;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}
.form-3cb-editor.prefill-collapsed [contenteditable] {
  height: 70vh;
  max-height: 720px;
}
.form-3cb-editor .preview-letter,
.form-3cb-editor .preview-letter * {
  font-family: "Times New Roman", Times, serif;
  font-size: 12pt;
  line-height: 1.15;
}
.form-3cb-editor .preview-letter p { margin: 0 0 6pt 0; text-align: left; }
.form-3cb-editor .preview-letter .center { text-align: center; }
.form-3cb-editor .preview-letter .bold { font-weight: bold; }
.form-3cb-editor .preview-letter .heading { margin: 0; }
.form-3cb-editor .preview-letter .subheading { margin: 2px 0; }
.form-3cb-editor .preview-letter .clause { margin-left: 0; }
.form-3cb-editor .preview-letter .responsibility { margin-left: 18px; text-indent: -18px; }
.form-3cb-editor .preview-letter .sub-responsibility { margin-left: 36px; text-indent: -18px; }
.form-3cb-editor .preview-letter .roman-list { margin: 0 0 6pt 34px; padding-left: 18px; }
.form-3cb-editor .preview-letter .roman-list li { margin-bottom: 4pt; }
.form-3cb-editor .preview-letter .lower-alpha-list { list-style-type: lower-alpha; margin: 4pt 0 0 24px; padding-left: 18px; }
.form-3cb-editor .preview-letter .lower-alpha-list li { margin-bottom: 4pt; }
.form-3cb-editor .preview-letter .placeholder {
  display: inline;
  padding: 0 3px;
  border-bottom: 1px dotted #555;
  background: #fff7cc;
  color: #000;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: normal;
  overflow-wrap: anywhere;
}
.form-3cb-editor .preview-letter .missing {
  background: #fff3a3;
  border-bottom: 1px solid #333;
  padding: 0 4px;
}
.form-3cb-editor .preview-letter .signature-block { margin-top: 34px; width: 100%; }
.form-3cb-editor .preview-letter .spacer { height: 12pt; line-height: 12pt; margin: 6pt 0; }
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
    const isSubResponsibility = element.classList.contains('sub-responsibility');

    let alignment = AlignmentType.LEFT;
    if (isCenter) alignment = AlignmentType.CENTER;
    if (isRight) alignment = AlignmentType.RIGHT;

    let indent = {};
    if (isSubclause || isResponsibility || isSubResponsibility) {
      indent = {
        left: isSubResponsibility ? 720 : 360,
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

const buildSafeDocxFilename = (value: string) =>
  `${value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_')}.docx`;

const formatFieldForTemplate = (value: string, fallback: string) => {
  const text = value.trim();
  if (!text) return `<span class="missing">${fallback}</span>`;
  return text.replace(/\n/g, '<br />');
};

const formatDateForTemplate = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB').format(date);
};

const includesText = (source: string | null | undefined, value: string | null | undefined) => {
  if (!source || !value) return false;
  return source.toLowerCase().includes(value.toLowerCase());
};

const buildClientAddress = (client: { address?: string | null; state?: string | null; pin?: string | null }) => {
  const address = client.address?.trim() || '';
  const state = client.state?.trim() || '';
  const pin = client.pin?.trim() || '';
  return [
    address,
    state && !includesText(address, state) ? state : '',
    pin && !includesText(address, pin) ? `PIN - ${pin}` : '',
  ].filter(Boolean).join(', ');
};

const parseFinancialYearRange = (financialYear?: string | null) => {
  const match = financialYear?.match(/(20\d{2})\D*(\d{2,4})?/);
  const startYear = match?.[1] ? Number(match[1]) : new Date().getFullYear();
  const endYear = match?.[2]
    ? Number(match[2].length === 2 ? `20${match[2]}` : match[2])
    : startYear + 1;

  return {
    start: `01 April ${startYear}`,
    end: `31 March ${endYear}`,
    bsDate: `31 March ${endYear}`,
  };
};

const createObservationId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `observation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const toRomanNumeral = (value: number) => {
  const numerals: Array<[number, string]> = [
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let remainingValue = value;
  let result = '';

  numerals.forEach(([amount, numeral]) => {
    while (remainingValue >= amount) {
      result += numeral;
      remainingValue -= amount;
    }
  });

  return result;
};

const buildObservationsHtml = (observations: ObservationRow[], startAt: number) => {
  return observations
    .map((observation) => observation.text.trim())
    .filter(Boolean)
    .map((text, index) => `<p class="responsibility"><span class="bold">(${toRomanNumeral(startAt + index)})</span> ${escapeHtml(text).replace(/\n/g, '<br />')}</p>`)
    .join('');
};

const parseDraftJson = (value: unknown): Form3CBDraftJson => {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? (parsed as Form3CBDraftJson) : {};
  } catch {
    return {};
  }
};

const sanitizeObservationRows = (value: unknown): ObservationRow[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: typeof item?.id === 'string' && item.id ? item.id : createObservationId(),
      text: typeof item?.text === 'string' ? item.text : '',
    }))
    .filter((item) => item.text.trim());
};

const buildClauseObservationsHtml = (observations: TaxAuditReportObservation[]) => {
  return observations
    .filter((observation) => observation.text.trim())
    .map((observation) => `Clause ${observation.clauseNo} - ${observation.clauseTitle}: ${observation.text.trim()}`);
};

const populateTemplate = (values: Record<string, string>) => {
  return Object.entries(values).reduce((content, [key, value]) => {
    return content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }, form3cbTemplate);
};

const resolvePartnerDesignation = (constitution?: string | null) => {
  return constitution?.toLowerCase() === 'proprietorship' ? 'Proprietor' : 'Partner';
};

const downloadWordBlob = (blob: Blob, filename: string) => {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

type Form3CBProps = {
  clauseObservations?: TaxAuditReportObservation[];
  onEditClauseObservation?: (clauseKey: string) => void;
};

export function Form3CB({ clauseObservations = [], onEditClauseObservation }: Form3CBProps) {
  const { currentEngagement } = useEngagement();
  const { client } = useClient(currentEngagement?.client_id || null);
  const { firmSettings } = useFirmSettings();
  const { partners } = usePartners();
  const { document: savedDocument, loading, saving, saveDocument } = useForm3CBDocument(currentEngagement?.id);

  const [editorHtml, setEditorHtml] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [prefillOpen, setPrefillOpen] = useState(true);
  const [assesseeName, setAssesseeName] = useState('');
  const [assesseeAddress, setAssesseeAddress] = useState('');
  const [assesseePan, setAssesseePan] = useState('');
  const [headOfficeAddress, setHeadOfficeAddress] = useState('');
  const [branchDetails, setBranchDetails] = useState('no');
  const [accountLabel, setAccountLabel] = useState<AccountLabel>('Profit & Loss Account');
  const [resultTerm, setResultTerm] = useState('profit');
  const [pronounSelection, setPronounSelection] = useState<PronounSelection>('we');
  const [para3Observations, setPara3Observations] = useState<ObservationRow[]>([]);
  const [para5Observations, setPara5Observations] = useState<ObservationRow[]>([]);
  const [signingPartnerId, setSigningPartnerId] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [placeOfSigning, setPlaceOfSigning] = useState('');
  const [udin, setUdin] = useState('');
  const initializedRef = useRef<string | null>(null);

  const period = useMemo(() => parseFinancialYearRange(currentEngagement?.financial_year), [currentEngagement?.financial_year]);
  const pronouns = TAX_AUDITOR_PRONOUNS[pronounSelection];
  const resultTermOptions = RESULT_TERM_OPTIONS[accountLabel];
  const signingPartner = useMemo(
    () => partners.find((partner) => partner.id === signingPartnerId) || null,
    [partners, signingPartnerId]
  );

  useEffect(() => {
    if (!client) return;
    const clientAddress = buildClientAddress(client);
    setAssesseeName(client.name || currentEngagement?.client_name || '');
    setAssesseeAddress(clientAddress);
    setAssesseePan(client.pan || '');
    setHeadOfficeAddress(clientAddress);
  }, [client, currentEngagement?.client_name]);

  useEffect(() => {
    if (!resultTermOptions.includes(resultTerm)) {
      setResultTerm(resultTermOptions[0]);
    }
  }, [resultTerm, resultTermOptions]);

  useEffect(() => {
    if (!currentEngagement || partners.length === 0) return;
    const matched = currentEngagement.partner_id ? partners.find((partner) => partner.id === currentEngagement.partner_id) : null;
    setSigningPartnerId(matched?.id || partners[0]?.id || '');
  }, [currentEngagement?.partner_id, partners]);

  const para3ObservationsHtml = useMemo(() => buildObservationsHtml(para3Observations, 2), [para3Observations]);
  const combinedPara5Observations = useMemo(
    () => [
      ...buildClauseObservationsHtml(clauseObservations).map((text, index) => ({
        id: `clause-observation-${clauseObservations[index]?.id || index}`,
        text,
      })),
      ...para5Observations,
    ],
    [clauseObservations, para5Observations]
  );
  const para5ObservationsHtml = useMemo(() => buildObservationsHtml(combinedPara5Observations, 3), [combinedPara5Observations]);

  const templateValues = useMemo(() => ({
    I_OR_WE: formatFieldForTemplate(pronouns.iOrWe, FIELD_PLACEHOLDERS.i_or_we),
    I_OR_WE_LOWER: formatFieldForTemplate(pronouns.iOrWeLower, FIELD_PLACEHOLDERS.i_or_we),
    I_OR_WE_BE: formatFieldForTemplate(pronouns.iOrWeBe, 'am/are'),
    I_AM_OR_WE_ARE: formatFieldForTemplate(pronouns.iOrWeBe, 'am/are'),
    ME_OR_US: formatFieldForTemplate(pronouns.meOrUs, 'me/us'),
    MY_OR_OUR: formatFieldForTemplate(pronouns.myOrOur, 'my/our'),
    ASSESSEE_NAME: formatFieldForTemplate(assesseeName, FIELD_PLACEHOLDERS.assessee_name),
    ASSESSEE_ADDRESS: formatFieldForTemplate(assesseeAddress, FIELD_PLACEHOLDERS.assessee_address),
    ASSESSEE_PAN_OR_AADHAAR: formatFieldForTemplate(assesseePan, FIELD_PLACEHOLDERS.assessee_pan_or_aadhaar),
    HEAD_OFFICE_ADDRESS: formatFieldForTemplate(headOfficeAddress, FIELD_PLACEHOLDERS.head_office_address),
    NUMBER_OR_DETAILS_OF_BRANCHES: formatFieldForTemplate(branchDetails, FIELD_PLACEHOLDERS.number_or_details_of_branches),
    PROFIT_AND_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT: formatFieldForTemplate(accountLabel, FIELD_PLACEHOLDERS.profit_loss_or_income_expenditure_account),
    RESULT_TERM_CONDITIONAL_ON_ACCOUNT_TYPE: formatFieldForTemplate(resultTerm, FIELD_PLACEHOLDERS.result_term),
    PERIOD_START_DATE: formatFieldForTemplate(period.start, '01 April YYYY'),
    PERIOD_END_DATE: formatFieldForTemplate(period.end, '31 March YYYY'),
    BALANCE_SHEET_DATE: formatFieldForTemplate(period.bsDate, '31 March YYYY'),
    PARA_3_OBSERVATIONS: para3ObservationsHtml,
    PARA_5_OBSERVATIONS: para5ObservationsHtml,
    CA_FIRM_NAME: formatFieldForTemplate(firmSettings?.firm_name || '', FIELD_PLACEHOLDERS.firm_name),
    FIRM_REGISTRATION_NUMBER: formatFieldForTemplate(firmSettings?.firm_registration_no || '', FIELD_PLACEHOLDERS.firm_registration_number),
    PARTNER_OR_PROPRIETOR_NAME: formatFieldForTemplate(signingPartner?.name || '', FIELD_PLACEHOLDERS.partner_or_proprietor_name),
    PARTNER_OR_PROPRIETOR_DESIGNATION: formatFieldForTemplate(resolvePartnerDesignation(firmSettings?.constitution), FIELD_PLACEHOLDERS.partner_or_proprietor_designation),
    MEMBERSHIP_NUMBER: formatFieldForTemplate(signingPartner?.membership_number || '', FIELD_PLACEHOLDERS.membership_number),
    REPORT_DATE: formatFieldForTemplate(formatDateForTemplate(reportDate), FIELD_PLACEHOLDERS.report_date),
    UDIN: formatFieldForTemplate(udin, FIELD_PLACEHOLDERS.udin),
    PLACE_OF_SIGNING: formatFieldForTemplate(placeOfSigning, FIELD_PLACEHOLDERS.place_of_signing),
  }), [
    pronouns,
    assesseeName,
    assesseeAddress,
    assesseePan,
    headOfficeAddress,
    branchDetails,
    accountLabel,
    resultTerm,
    period.start,
    period.end,
    period.bsDate,
    para3ObservationsHtml,
    para5ObservationsHtml,
    firmSettings,
    signingPartner,
    reportDate,
    udin,
    placeOfSigning,
  ]);

  const templateHtml = useMemo(() => populateTemplate(templateValues), [templateValues]);

  const isCurrentTemplate = useCallback(
    (content: string) => content.includes(`data-template-version="${FORM_3CB_TEMPLATE_VERSION}"`),
    []
  );

  const normalizeHtml = useCallback((value: string) => value.replace(/\s+/g, ' ').trim(), []);

  const replaceObservationSectionsHtml = useCallback((content: string) => {
    if (!content || typeof document === 'undefined') return content;
    const container = document.createElement('div');
    container.innerHTML = content;
    const para3Section = container.querySelector('[data-form3cb-observations-para3="true"]');
    const para5Section = container.querySelector('[data-form3cb-observations-para5="true"]');
    let didReplace = false;

    if (para3Section && para3Section.innerHTML !== para3ObservationsHtml) {
      para3Section.innerHTML = para3ObservationsHtml;
      didReplace = true;
    }

    if (para5Section && para5Section.innerHTML !== para5ObservationsHtml) {
      para5Section.innerHTML = para5ObservationsHtml;
      didReplace = true;
    }

    return didReplace ? container.innerHTML : content;
  }, [para3ObservationsHtml, para5ObservationsHtml]);

  useEffect(() => {
    if (!currentEngagement) return;
    initializedRef.current = null;
    setShowEditor(false);
    setIsDirty(false);
    setEditorHtml('');
    setPrefillOpen(true);
    setReportDate(new Date().toISOString().split('T')[0]);
    setPara3Observations([]);
    setPara5Observations([]);
  }, [currentEngagement?.id]);

  useEffect(() => {
    if (!showEditor || !currentEngagement) return;
    if (initializedRef.current === currentEngagement.id) return;
    initializedRef.current = currentEngagement.id;

    if (savedDocument?.content_html && isCurrentTemplate(savedDocument.content_html)) {
      const savedDraft = parseDraftJson(savedDocument.content_json);
      const savedManualPara3Observations = sanitizeObservationRows(savedDraft.manualPara3Observations);
      const savedManualPara5Observations = sanitizeObservationRows(savedDraft.manualPara5Observations);
      if (savedManualPara3Observations.length > 0) {
        setPara3Observations(savedManualPara3Observations);
      }
      if (savedManualPara5Observations.length > 0) {
        setPara5Observations(savedManualPara5Observations);
      }
      const savedHtml = savedDocument.content_html;
      const isSameAsTemplate = normalizeHtml(savedHtml) === normalizeHtml(templateHtml);
      setEditorHtml(savedHtml);
      setIsDirty(!isSameAsTemplate);
      return;
    }

    setEditorHtml(templateHtml);
    setIsDirty(false);
  }, [showEditor, currentEngagement?.id, savedDocument?.content_html, savedDocument?.content_json, templateHtml, isCurrentTemplate, normalizeHtml]);

  useEffect(() => {
    if (!showEditor) return;
    if (!isDirty) setEditorHtml(templateHtml);
  }, [templateHtml, showEditor, isDirty]);

  useEffect(() => {
    if (!showEditor || !isDirty) return;
    setEditorHtml((currentHtml) => replaceObservationSectionsHtml(currentHtml));
  }, [showEditor, isDirty, replaceObservationSectionsHtml]);

  const normalizeMissingHighlights = useCallback((root: HTMLDivElement) => {
    const nodes = root.querySelectorAll('span.missing');
    nodes.forEach((node) => {
      const text = node.textContent || '';
      if (text.replace(/[\s_]+/g, '') !== '') {
        node.classList.remove('missing');
        if (!node.className) node.removeAttribute('class');
      }
    });
  }, []);

  const handleAddObservation = (section: 'para3' | 'para5') => {
    const updater = section === 'para3' ? setPara3Observations : setPara5Observations;
    updater((currentObservations) => [
      ...currentObservations,
      { id: createObservationId(), text: '' },
    ]);
  };

  const handleObservationChange = (section: 'para3' | 'para5', id: string, text: string) => {
    const updater = section === 'para3' ? setPara3Observations : setPara5Observations;
    updater((currentObservations) =>
      currentObservations.map((observation) =>
        observation.id === id ? { ...observation, text } : observation
      )
    );
  };

  const handleRemoveObservation = (section: 'para3' | 'para5', id: string) => {
    const updater = section === 'para3' ? setPara3Observations : setPara5Observations;
    updater((currentObservations) => currentObservations.filter((observation) => observation.id !== id));
  };

  const buildDraftJson = useCallback(
    (): Form3CBDraftJson => ({
      manualPara3Observations: para3Observations,
      manualPara5Observations: para5Observations,
    }),
    [para3Observations, para5Observations]
  );

  const handleOpenPreview = async () => {
    setShowEditor(true);
    if (!currentEngagement) return;
    await saveDocument(templateHtml, 'Form 3CB', buildDraftJson());
  };

  const handleSaveDraft = async () => {
    if (!currentEngagement) {
      toast.error('Select an engagement before saving');
      return;
    }
    const draftHtml = editorHtml.trim() ? editorHtml : templateHtml;
    const saved = await saveDocument(draftHtml, 'Form 3CB', buildDraftJson());
    if (saved) toast.success('Draft saved');
  };

  const handleApplyPrefill = () => {
    setEditorHtml(templateHtml);
    setIsDirty(false);
  };

  const handleExportWord = async () => {
    const exportHtml = editorHtml.trim() ? editorHtml : templateHtml;
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
    const filename = buildSafeDocxFilename(currentEngagement?.client_name ? `Form_3CB_${currentEngagement.client_name}` : 'Form_3CB');

    try {
      const blob = await Packer.toBlob(doc);
      if (!window.electronAPI?.app?.exportFile) {
        downloadWordBlob(blob, filename);
        toast.success('Word document downloaded');
        return;
      }
      const exportedPath = await window.electronAPI.app.exportFile({
        defaultFilename: filename,
        buffer: await blob.arrayBuffer(),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        showSaveDialog: false,
      });

      if (exportedPath) {
        toast.success(`Word document exported to ${exportedPath}`);
        return;
      }

      if (exportedPath === null) {
        toast.info('Word export cancelled');
        return;
      }

      downloadWordBlob(blob, filename);
      toast.success('Word document downloaded');
    } catch (err: any) {
      try {
        const blob = await Packer.toBlob(doc);
        downloadWordBlob(blob, filename);
        toast.warning(`Electron export failed; downloaded instead. ${err?.message || ''}`.trim());
      } catch (fallbackError: any) {
        console.error('Failed to export Word document', fallbackError);
        toast.error(fallbackError?.message || err?.message || 'Failed to export Word document');
      }
    }
  };

  const renderObservationSection = (
    title: string,
    section: 'para3' | 'para5',
    observations: ObservationRow[]
  ) => (
    <div className="space-y-3 rounded-md border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">Rows entered here are inserted into the respective paragraph of Form 3CB.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => handleAddObservation(section)}>
          <Plus className="mr-2 h-4 w-4" />
          Add observation / qualification
        </Button>
      </div>

      {section === 'para5' && clauseObservations.length > 0 && (
        <div className="space-y-2 rounded-md border bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-800">Auto-populated from 3CD clause observations</p>
          <div className="space-y-2">
            {clauseObservations.map((observation, index) => (
              <div key={observation.id} className="rounded border bg-background p-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">
                    {index + 1}. Clause {observation.clauseNo} - {observation.clauseTitle}
                  </p>
                  {onEditClauseObservation && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onEditClauseObservation(observation.clauseKey)}
                    >
                      Edit in 3CD
                    </Button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{observation.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {observations.length === 0 ? (
        <p className="rounded-md border border-dashed bg-background p-3 text-sm text-muted-foreground">
          No direct Form {section === 'para5' ? '3CB para 5' : '3CB para 3'} observations added.
        </p>
      ) : (
        <div className="space-y-3">
          {observations.map((observation, index) => (
            <div key={observation.id} className="grid gap-2 rounded-md border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <Label>Observation / Qualification / Comment {index + 1}</Label>
                <Button variant="ghost" size="sm" onClick={() => handleRemoveObservation(section, observation.id)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder="Enter observation / qualification / comment"
                value={observation.text}
                onChange={(event) => handleObservationChange(section, observation.id, event.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (!currentEngagement) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Form 3CB
          </CardTitle>
          <CardDescription>Select an engagement to edit Form 3CB.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={showEditor ? 'gap-3 sm:flex-row sm:items-start sm:justify-between' : undefined}>
        <div className="space-y-1.5">
          <CardTitle>Form 3CB</CardTitle>
          <CardDescription>Generate Form 3CB using engagement, client master and firm master data.</CardDescription>
        </div>
        {showEditor && (
          <Button variant="outline" size="sm" onClick={() => setShowEditor(false)}>
            Back
          </Button>
        )}
      </CardHeader>
      {!showEditor ? (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Generate Form 3CB for the selected engagement and save the draft.</p>
          <Button onClick={handleOpenPreview}>Generate Form 3CB</Button>
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
              <div className="grid gap-2 lg:grid-cols-3">
                <div>
                  <Label>Client name</Label>
                  <Input value={assesseeName} onChange={(event) => setAssesseeName(event.target.value)} />
                </div>
                <div>
                  <Label>Profit &amp; Loss or Income &amp; Expenditure A/c (select)</Label>
                  <Select value={accountLabel} onValueChange={(value) => setAccountLabel(value as AccountLabel)}>
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
                  <Label>Tax auditor salutation (I/We)- select</Label>
                  <Select value={pronounSelection} onValueChange={(value) => setPronounSelection(value as PronounSelection)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="i">I</SelectItem>
                      <SelectItem value="we">We</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{accountLabel === 'Profit & Loss Account' ? 'Profit / Loss (select)' : 'Surplus / Deficit (select)'}</Label>
                  <Select value={resultTerm} onValueChange={setResultTerm}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resultTermOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Head office address</Label>
                  <Input value={headOfficeAddress} onChange={(event) => setHeadOfficeAddress(event.target.value)} />
                </div>
                <div>
                  <Label>Number/details of branches</Label>
                  <Input value={branchDetails} onChange={(event) => setBranchDetails(event.target.value)} />
                </div>
                <div className="lg:col-span-3 rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 space-y-0.5">
                    <p className="text-sm font-semibold text-foreground">Report Signing Details</p>
                    <p className="text-xs text-muted-foreground">These details will appear on the audit report signature block.</p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <Label>Signing Partner</Label>
                      <Select value={signingPartnerId} onValueChange={setSigningPartnerId} disabled={partners.length === 0}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select signing partner" />
                        </SelectTrigger>
                        <SelectContent>
                          {partners.map((partner) => (
                            <SelectItem key={partner.id} value={partner.id}>
                              {partner.name} {partner.membership_number ? `(M.No. ${partner.membership_number})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tax audit Report date</Label>
                      <Input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
                    </div>
                    <div>
                      <Label>Place of Signing</Label>
                      <Input value={placeOfSigning} onChange={(event) => setPlaceOfSigning(event.target.value)} placeholder="Place of signing" />
                    </div>
                    <div>
                      <Label>Tax audit UDIN</Label>
                      <Input
                        placeholder="18 character UDIN"
                        inputMode="text"
                        maxLength={18}
                        value={udin}
                        onChange={(event) => setUdin(event.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 18))}
                      />
                    </div>
                  </div>
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
              onChange={(value) => {
                setEditorHtml(value);
                setIsDirty(true);
              }}
              normalizeDom={normalizeMissingHighlights}
              placeholder="Edit the Form 3CB here. All fields are editable."
              className={prefillOpen ? 'form-3cb-editor' : 'form-3cb-editor prefill-collapsed'}
            />

            {renderObservationSection('Para 3 observations / comments / discrepancies / inconsistencies', 'para3', para3Observations)}
            {renderObservationSection('Para 5 observations / qualifications', 'para5', para5Observations)}

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
