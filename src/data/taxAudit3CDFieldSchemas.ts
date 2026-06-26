export type TaxAuditStructuredFieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number' | 'percentage';

export type TaxAuditStructuredFieldOption = {
  label: string;
  value: string;
};

export type TaxAuditStructuredField = {
  key: string;
  label: string;
  type: TaxAuditStructuredFieldType;
  required?: boolean;
  placeholder?: string;
  options?: TaxAuditStructuredFieldOption[];
  sourceHint?: string;
  visibleWhen?: {
    fieldKey: string;
    value?: StructuredValueForVisibility;
    values?: StructuredValueForVisibility[];
  };
};

type StructuredValueForVisibility = string | number | boolean | null;

export type TaxAuditStructuredTableColumn = TaxAuditStructuredField & {
  width?: string;
};

export type TaxAuditStructuredTable = {
  key: string;
  label: string;
  shortLabel?: string;
  description?: string;
  summaryFields?: string[];
  required?: boolean;
  columns: TaxAuditStructuredTableColumn[];
};

export type TaxAudit3CDFieldSchema = {
  clauseKey: string;
  fields?: TaxAuditStructuredField[];
  table?: TaxAuditStructuredTable;
  tables?: TaxAuditStructuredTable[];
};

const ASSESSEE_STATUS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Individual', value: 'Individual' },
  { label: 'HUF', value: 'HUF' },
  { label: 'Firm', value: 'Firm' },
  { label: 'LLP', value: 'LLP' },
  { label: 'Company', value: 'Company' },
  { label: 'AOP/BOI', value: 'AOP/BOI' },
  { label: 'Trust', value: 'Trust' },
  { label: 'Other', value: 'Other' },
];

const SECTION_44AB_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '44AB(a) - Business turnover threshold', value: '44AB(a)' },
  { label: '44AB(b) - Profession gross receipts threshold', value: '44AB(b)' },
  { label: '44AB(c) - Presumptive taxation review', value: '44AB(c)' },
  { label: '44AB(d) - Presumptive taxation review', value: '44AB(d)' },
  { label: '44AB(e) - Presumptive taxation review', value: '44AB(e)' },
  {
    label: 'Third proviso to 44AB: audited under any other law',
    value: 'Third proviso to 44AB: audited under any other law',
  },
  {
    label: 'Clause 44AB(a)- proviso where cash receipt and cash payments do not exceed the specified percentage of total transactions, but the turnover exceeds the specified limit',
    value: 'Clause 44AB(a)- proviso where cash receipt and cash payments do not exceed the specified percentage of total transactions, but the turnover exceeds the specified limit',
  },
  { label: 'Other / Review required', value: 'Other / Review required' },
];

const YES_NO_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'Not applicable', value: 'not_applicable' },
];

const YES_NO_ONLY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

const SECTION_115_TAX_REGIME_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '115BA', value: '115BA' },
  { label: '115BAA', value: '115BAA' },
  { label: '115BAB', value: '115BAB' },
  { label: '115BAC', value: '115BAC' },
  { label: '115BAD', value: '115BAD' },
  { label: '115BAE', value: '115BAE' },
];

const PRESUMPTIVE_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '44AD', value: '44AD' },
  { label: '44ADA', value: '44ADA' },
  { label: '44AE', value: '44AE' },
  { label: '44B', value: '44B' },
  { label: '44BB', value: '44BB' },
  { label: '44BBA', value: '44BBA' },
  { label: '44BBB', value: '44BBB' },
  { label: 'Other', value: 'Other' },
];

const ACCOUNTING_METHOD_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Mercantile', value: 'Mercantile' },
  { label: 'Cash', value: 'Cash' },
  { label: 'Hybrid / Other', value: 'Hybrid / Other' },
];

const CLAUSE_16_CATEGORY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Items falling within scope of section 28', value: 'Items falling within scope of section 28' },
  { label: 'Pro forma credits, drawbacks, refunds or duty remission', value: 'Pro forma credits, drawbacks, refunds or duty remission' },
  { label: 'Escalation claims accepted during the previous year', value: 'Escalation claims accepted during the previous year' },
  { label: 'Any other item of income', value: 'Any other item of income' },
  { label: 'Capital receipt', value: 'Capital receipt' },
  { label: 'Other', value: 'Other' },
];

const PROPERTY_TRANSFER_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Land', value: 'Land' },
  { label: 'Building', value: 'Building' },
  { label: 'Land and building', value: 'Land and building' },
];

const LAND_BUILDING_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '43CA', value: '43CA' },
  { label: '50C', value: '50C' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_19_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  '33AB',
  '33ABA',
  '35(1)(i)',
  '35(1)(ii)',
  '35(1)(iia)',
  '35(1)(iii)',
  '35(1)(iv)',
  '35(2AA)',
  '35(2AB)',
  '35ABA',
  '35ABB',
  '35AD',
  '35CCA',
  '35CCC',
  '35CCD',
  '35D',
  '35DD',
  '35DDA',
  '35E',
  'Any other relevant section',
].map((section) => ({ label: section, value: section }));

const CONDITIONS_FULFILLED_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const BONUS_COMMISSION_NATURE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Bonus', value: 'Bonus' },
  { label: 'Commission', value: 'Commission' },
  { label: 'Other', value: 'Other' },
];

const ADMISSIBILITY_VIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Admissible', value: 'Admissible' },
  { label: 'Not admissible', value: 'Not admissible' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const EMPLOYEE_CONTRIBUTION_FUND_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Provident Fund', value: 'Provident Fund' },
  { label: 'ESI', value: 'ESI' },
  { label: 'Superannuation Fund', value: 'Superannuation Fund' },
  { label: 'Gratuity Fund', value: 'Gratuity Fund' },
  { label: 'Other welfare fund', value: 'Other welfare fund' },
];

const CONTRIBUTION_DELAY_STATUS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Deposited within due date', value: 'Deposited within due date' },
  { label: 'Delayed', value: 'Delayed' },
  { label: 'Not deposited', value: 'Not deposited' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_21A_CATEGORY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  {
    label: 'Capital expenditure',
    value: 'Capital expenditure',
  },
  {
    label: 'Personal expenditure',
    value: 'Personal expenditure',
  },
  {
    label: 'Advertisement expenditure in political party souvenir, brochure, tract, pamphlet or similar publication',
    value: 'Advertisement expenditure in political party souvenir, brochure, tract, pamphlet or similar publication',
  },
  {
    label: 'Club entrance fees and subscriptions',
    value: 'Club entrance fees and subscriptions',
  },
  {
    label: 'Club services and facilities',
    value: 'Club services and facilities',
  },
  {
    label: 'Penalty or fine for violation of law',
    value: 'Penalty or fine for violation of law',
  },
  {
    label: 'Any other penalty or fine',
    value: 'Any other penalty or fine',
  },
  {
    label: 'Expenditure for any purpose which is an offence or prohibited by law',
    value: 'Expenditure for any purpose which is an offence or prohibited by law',
  },
  {
    label: 'Benefit or perquisite where acceptance by recipient violates law, rule, regulation or guideline',
    value: 'Benefit or perquisite where acceptance by recipient violates law, rule, regulation or guideline',
  },
  {
    label: 'Expenditure to settle proceedings relating to notified contravention',
    value: 'Expenditure to settle proceedings relating to notified contravention',
  },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21B_SUB_CLAUSE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '40(a)(i) payment to non-resident where tax not deducted', value: '40(a)(i) payment to non-resident where tax not deducted' },
  { label: '40(a)(i) payment to non-resident where tax deducted but not paid', value: '40(a)(i) payment to non-resident where tax deducted but not paid' },
  { label: '40(a)(ia) resident payment where tax not deducted', value: '40(a)(ia) resident payment where tax not deducted' },
  {
    label: '40(a)(ia) resident payment where tax deducted but not paid before due date',
    value: '40(a)(ia) resident payment where tax deducted but not paid before due date',
  },
  { label: '40(a)(ic)', value: '40(a)(ic)' },
  { label: '40(a)(iia)', value: '40(a)(iia)' },
  { label: '40(a)(iib)', value: '40(a)(iib)' },
  { label: '40(a)(iii)', value: '40(a)(iii)' },
  { label: '40(a)(iv)', value: '40(a)(iv)' },
  { label: '40(a)(v)', value: '40(a)(v)' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21B_REASON_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Tax not deducted', value: 'Tax not deducted' },
  { label: 'Tax deducted but not paid', value: 'Tax deducted but not paid' },
  { label: 'Tax paid late', value: 'Tax paid late' },
  { label: 'Statutory disallowance', value: 'Statutory disallowance' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21C_NATURE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Interest', value: 'Interest' },
  { label: 'Salary', value: 'Salary' },
  { label: 'Bonus', value: 'Bonus' },
  { label: 'Commission', value: 'Commission' },
  { label: 'Remuneration', value: 'Remuneration' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21C_PAYEE_CAPACITY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Partner', value: 'Partner' },
  { label: 'Working partner', value: 'Working partner' },
  { label: 'Non-working partner', value: 'Non-working partner' },
  { label: 'Member of AOP', value: 'Member of AOP' },
  { label: 'Member of BOI', value: 'Member of BOI' },
  { label: 'Representative capacity', value: 'Representative capacity' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21C_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Not authorised by deed or agreement', value: 'Not authorised by deed or agreement' },
  { label: 'Exceeds permissible limit', value: 'Exceeds permissible limit' },
  { label: 'Paid to non-working partner', value: 'Paid to non-working partner' },
  { label: 'Representative capacity issue', value: 'Representative capacity issue' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_21D_SUB_CLAUSE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '40A(3)', value: '40A(3)' },
  { label: '40A(3A)', value: '40A(3A)' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_21D_PAYMENT_MODE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Cash', value: 'Cash' },
  { label: 'Account payee cheque', value: 'Account payee cheque' },
  { label: 'Account payee bank draft', value: 'Account payee bank draft' },
  { label: 'Electronic clearing system', value: 'Electronic clearing system' },
  { label: 'Other electronic mode', value: 'Other electronic mode' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21E_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Approved gratuity fund', value: 'Approved gratuity fund' },
  { label: 'Actual payment', value: 'Actual payment' },
  { label: 'Provision only', value: 'Provision only' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21F_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Required by law', value: 'Required by law' },
  { label: 'Recognised provident fund', value: 'Recognised provident fund' },
  { label: 'Approved superannuation fund', value: 'Approved superannuation fund' },
  { label: 'Approved gratuity fund', value: 'Approved gratuity fund' },
  { label: 'Other approved fund', value: 'Other approved fund' },
  { label: 'Not approved', value: 'Not approved' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_21G_ACCOUNTING_TREATMENT_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Debited to profit and loss account', value: 'Debited to profit and loss account' },
  { label: 'Disclosed as contingent liability', value: 'Disclosed as contingent liability' },
  { label: 'Not debited', value: 'Not debited' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_21H_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Assessee computation', value: 'Assessee computation' },
  { label: 'Auditor review', value: 'Auditor review' },
  { label: 'Rule 8D reference', value: 'Rule 8D reference' },
  { label: 'Management representation', value: 'Management representation' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_21I_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Direct borrowing for asset', value: 'Direct borrowing for asset' },
  { label: 'Capital work in progress review', value: 'Capital work in progress review' },
  { label: 'Management representation', value: 'Management representation' },
  { label: 'Auditor working', value: 'Auditor working' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const MSMED_ENTERPRISE_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Micro', value: 'Micro' },
  { label: 'Small', value: 'Small' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Not available', value: 'Not available' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_22_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Books of account', value: 'Books of account' },
  { label: 'Supplier confirmation', value: 'Supplier confirmation' },
  { label: 'Ageing analysis', value: 'Ageing analysis' },
  { label: 'Management representation', value: 'Management representation' },
  { label: 'Auditor working', value: 'Auditor working' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAIMED_AS_DEDUCTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_23_RELATIONSHIP_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Director', value: 'Director' },
  { label: 'Partner', value: 'Partner' },
  { label: 'Relative', value: 'Relative' },
  { label: 'Substantial interest holder', value: 'Substantial interest holder' },
  { label: 'Related concern', value: 'Related concern' },
  { label: 'Associated enterprise', value: 'Associated enterprise' },
  { label: 'Key management personnel', value: 'Key management personnel' },
  { label: 'Other specified person', value: 'Other specified person' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_23_PAYMENT_NATURE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Purchase', value: 'Purchase' },
  { label: 'Service charge', value: 'Service charge' },
  { label: 'Rent', value: 'Rent' },
  { label: 'Interest', value: 'Interest' },
  { label: 'Salary or remuneration', value: 'Salary or remuneration' },
  { label: 'Commission', value: 'Commission' },
  { label: 'Reimbursement', value: 'Reimbursement' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_23_AUDITOR_VIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Reasonable', value: 'Reasonable' },
  { label: 'Excessive or unreasonable', value: 'Excessive or unreasonable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Not applicable', value: 'Not applicable' },
];

const CLAUSE_24_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '32AC', value: '32AC' },
  { label: '32AD', value: '32AD' },
  { label: '33AB', value: '33AB' },
  { label: '33ABA', value: '33ABA' },
  { label: '33AC', value: '33AC' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_25_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '41(1)', value: '41(1)' },
  { label: '41(2)', value: '41(2)' },
  { label: '41(3)', value: '41(3)' },
  { label: '41(4)', value: '41(4)' },
  { label: '41(4A)', value: '41(4A)' },
  { label: '41(5)', value: '41(5)' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_25_TAXABILITY_EVENT_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Remission or cessation of liability', value: 'Remission or cessation of liability' },
  { label: 'Recovery of earlier allowed expenditure', value: 'Recovery of earlier allowed expenditure' },
  { label: 'Sale or recovery relating to depreciable asset', value: 'Sale or recovery relating to depreciable asset' },
  { label: 'Withdrawal from reserve or special account', value: 'Withdrawal from reserve or special account' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_26_SECTION_43B_CATEGORY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '43B(a) Tax, duty, cess or fee', value: '43B(a) Tax, duty, cess or fee' },
  {
    label: '43B(b) Employer contribution to provident fund, superannuation fund, gratuity fund or other welfare fund',
    value: '43B(b) Employer contribution to provident fund, superannuation fund, gratuity fund or other welfare fund',
  },
  { label: '43B(c) Bonus or commission to employees', value: '43B(c) Bonus or commission to employees' },
  {
    label: '43B(d) Interest on loan or borrowing from public financial institution or similar institution',
    value: '43B(d) Interest on loan or borrowing from public financial institution or similar institution',
  },
  {
    label: '43B(da) Interest on loan, deposit or advance from scheduled bank or co-operative bank',
    value: '43B(da) Interest on loan, deposit or advance from scheduled bank or co-operative bank',
  },
  { label: '43B(e) Leave encashment', value: '43B(e) Leave encashment' },
  {
    label: '43B(f) Sum payable to Indian Railways for use of railway assets',
    value: '43B(f) Sum payable to Indian Railways for use of railway assets',
  },
  {
    label: '43B(h) Micro or small enterprise payable, to be reviewed with Clause 22',
    value: '43B(h) Micro or small enterprise payable, to be reviewed with Clause 22',
  },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_26_INDIRECT_TAX_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'GST', value: 'GST' },
  { label: 'Customs duty', value: 'Customs duty' },
  { label: 'Excise duty', value: 'Excise duty' },
  { label: 'Cess', value: 'Cess' },
  { label: 'Fee', value: 'Fee' },
  { label: 'Levy', value: 'Levy' },
  { label: 'Other indirect tax', value: 'Other indirect tax' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_26_ACCOUNTING_TREATMENT_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Debited to profit and loss account', value: 'Debited to profit and loss account' },
  { label: 'Credited to profit and loss account', value: 'Credited to profit and loss account' },
  { label: 'Netted off', value: 'Netted off' },
  { label: 'Balance sheet only', value: 'Balance sheet only' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_27_CREDIT_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'CENVAT credit', value: 'CENVAT credit' },
  { label: 'Input Tax Credit', value: 'Input Tax Credit' },
  { label: 'GST input tax credit', value: 'GST input tax credit' },
  { label: 'Customs or excise credit', value: 'Customs or excise credit' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_27_APPLICABILITY_VIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Applicable', value: 'Applicable' },
  { label: 'Not applicable after GST', value: 'Not applicable after GST' },
  { label: 'Applicable for specified excise products', value: 'Applicable for specified excise products' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_27_P_AND_L_TREATMENT_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Debited to profit and loss account', value: 'Debited to profit and loss account' },
  { label: 'Credited to profit and loss account', value: 'Credited to profit and loss account' },
  { label: 'Netted off', value: 'Netted off' },
  { label: 'Not routed through profit and loss account', value: 'Not routed through profit and loss account' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_27_PRIOR_PERIOD_ITEM_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Prior period income', value: 'Prior period income' },
  { label: 'Prior period expenditure', value: 'Prior period expenditure' },
  { label: 'Prior period error', value: 'Prior period error' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_27_PROFIT_AND_LOSS_ROUTING_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Credited', value: 'Credited' },
  { label: 'Debited', value: 'Debited' },
  { label: 'Not routed through profit and loss account', value: 'Not routed through profit and loss account' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_27_CRYSTALLISED_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_27_AUDITOR_VIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Reportable as prior period item', value: 'Reportable as prior period item' },
  {
    label: 'Not reportable because crystallised during current year',
    value: 'Not reportable because crystallised during current year',
  },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_29_NEGOTIATION_TRANSFER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_29B_PROPERTY_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Shares and securities', value: 'Shares and securities' },
  { label: 'Jewellery', value: 'Jewellery' },
  { label: 'Archaeological collection', value: 'Archaeological collection' },
  { label: 'Drawings', value: 'Drawings' },
  { label: 'Paintings', value: 'Paintings' },
  { label: 'Sculptures', value: 'Sculptures' },
  { label: 'Any work of art', value: 'Any work of art' },
  { label: 'Bullion', value: 'Bullion' },
  { label: 'Other specified property', value: 'Other specified property' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_29B_EXCEPTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'None', value: 'None' },
  { label: 'Relative', value: 'Relative' },
  { label: 'On occasion of marriage', value: 'On occasion of marriage' },
  { label: 'Under will or inheritance', value: 'Under will or inheritance' },
  { label: 'In contemplation of death', value: 'In contemplation of death' },
  { label: 'From local authority', value: 'From local authority' },
  { label: 'From specified fund, foundation, trust or institution', value: 'From specified fund, foundation, trust or institution' },
  { label: 'Business reorganisation or specified transaction', value: 'Business reorganisation or specified transaction' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_30_TRANSACTION_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Amount borrowed on hundi', value: 'Amount borrowed on hundi' },
  { label: 'Amount due on hundi repaid', value: 'Amount due on hundi repaid' },
  { label: 'Interest on hundi repaid', value: 'Interest on hundi repaid' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_30_PAYMENT_MODE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Cash', value: 'Cash' },
  { label: 'Bearer cheque', value: 'Bearer cheque' },
  { label: 'Account payee cheque', value: 'Account payee cheque' },
  { label: 'Account payee bank draft', value: 'Account payee bank draft' },
  { label: 'Electronic transfer', value: 'Electronic transfer' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_30_ACCOUNT_PAYEE_CHECK_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_30A_PRIMARY_ADJUSTMENT_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Suo motu adjustment by assessee', value: 'Suo motu adjustment by assessee' },
  { label: 'Adjustment made by Assessing Officer and accepted', value: 'Adjustment made by Assessing Officer and accepted' },
  { label: 'Advance Pricing Agreement', value: 'Advance Pricing Agreement' },
  { label: 'Safe Harbour Rules', value: 'Safe Harbour Rules' },
  { label: 'Mutual Agreement Procedure', value: 'Mutual Agreement Procedure' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_30A_YES_NO_REVIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_30B_NATURE_OF_DEBT_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Loan', value: 'Loan' },
  { label: 'Deposit', value: 'Deposit' },
  { label: 'Advance', value: 'Advance' },
  { label: 'Debt issued by non-resident associated enterprise', value: 'Debt issued by non-resident associated enterprise' },
  { label: 'Debt guaranteed by associated enterprise', value: 'Debt guaranteed by associated enterprise' },
  { label: 'Debt backed by matching deposit by associated enterprise', value: 'Debt backed by matching deposit by associated enterprise' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_30C_SECTION_96_CONDITION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  {
    label: "Creates rights or obligations not ordinarily created between parties dealing at arm's length",
    value: "Creates rights or obligations not ordinarily created between parties dealing at arm's length",
  },
  {
    label: 'Results directly or indirectly in misuse or abuse of provisions of the Act',
    value: 'Results directly or indirectly in misuse or abuse of provisions of the Act',
  },
  {
    label: 'Lacks commercial substance or is deemed to lack commercial substance',
    value: 'Lacks commercial substance or is deemed to lack commercial substance',
  },
  {
    label: 'Entered into or carried out in a manner not ordinarily employed for bona fide purposes',
    value: 'Entered into or carried out in a manner not ordinarily employed for bona fide purposes',
  },
  { label: 'Multiple conditions', value: 'Multiple conditions' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_30C_REPORTING_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Management representation', value: 'Management representation' },
  { label: 'Tax computation review', value: 'Tax computation review' },
  { label: 'Legal opinion', value: 'Legal opinion' },
  { label: 'Auditor review', value: 'Auditor review' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_31_TRANSACTION_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Loan', value: 'Loan' },
  { label: 'Deposit', value: 'Deposit' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_MODE_OF_ACCEPTANCE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Account payee cheque', value: 'Account payee cheque' },
  { label: 'Account payee bank draft', value: 'Account payee bank draft' },
  { label: 'Electronic clearing system through bank account', value: 'Electronic clearing system through bank account' },
  { label: 'Other prescribed electronic mode', value: 'Other prescribed electronic mode' },
  { label: 'Cash', value: 'Cash' },
  { label: 'Bearer cheque', value: 'Bearer cheque' },
  { label: 'Non-account payee cheque', value: 'Non-account payee cheque' },
  { label: 'Journal entry', value: 'Journal entry' },
  { label: 'Transfer of asset', value: 'Transfer of asset' },
  { label: 'Conversion of liability', value: 'Conversion of liability' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_31_YES_NO_REVIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_EXEMPTION_OR_REVIEW_STATUS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'No exception claimed', value: 'No exception claimed' },
  { label: 'Government', value: 'Government' },
  { label: 'Banking company', value: 'Banking company' },
  { label: 'Post office savings bank', value: 'Post office savings bank' },
  { label: 'Co-operative bank', value: 'Co-operative bank' },
  { label: 'Other statutory exception', value: 'Other statutory exception' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_SPECIFIED_SUM_NATURE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Advance for transfer of immovable property', value: 'Advance for transfer of immovable property' },
  { label: 'Other amount in relation to transfer of immovable property', value: 'Other amount in relation to transfer of immovable property' },
  { label: 'Booking amount', value: 'Booking amount' },
  { label: 'Security deposit', value: 'Security deposit' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31BA_RECEIPT_TRIGGER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Aggregate from a person in a day', value: 'Aggregate from a person in a day' },
  { label: 'Single transaction', value: 'Single transaction' },
  { label: 'Transactions relating to one event or occasion', value: 'Transactions relating to one event or occasion' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31BC_PAYMENT_TRIGGER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Aggregate to a person in a day', value: 'Aggregate to a person in a day' },
  { label: 'Single transaction', value: 'Single transaction' },
  { label: 'Transactions relating to one event or occasion', value: 'Transactions relating to one event or occasion' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_269ST_NON_PERMITTED_MODE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Cash', value: 'Cash' },
  { label: 'Bearer cheque', value: 'Bearer cheque' },
  { label: 'Non-account payee cheque', value: 'Non-account payee cheque' },
  { label: 'Non-account payee bank draft', value: 'Non-account payee bank draft' },
  { label: 'Journal entry', value: 'Journal entry' },
  { label: 'Transfer of asset', value: 'Transfer of asset' },
  { label: 'Other non-banking mode', value: 'Other non-banking mode' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_269ST_ACCOUNT_PAYEE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Cannot verify', value: 'Cannot verify' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_INSTRUMENT_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Cheque', value: 'Cheque' },
  { label: 'Bank draft', value: 'Bank draft' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_NATURE_OF_AMOUNT_CODE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'A: Cash payment', value: 'A: Cash payment' },
  { label: 'B: Cash receipt', value: 'B: Cash receipt' },
  { label: 'C: Payment through non-account payee cheque', value: 'C: Payment through non-account payee cheque' },
  { label: 'D: Receipt through non-account payee cheque', value: 'D: Receipt through non-account payee cheque' },
  { label: 'E: Transfer of asset', value: 'E: Transfer of asset' },
  { label: 'F: Transfer of liability', value: 'F: Transfer of liability' },
  { label: 'G: Conversion of assets', value: 'G: Conversion of assets' },
  { label: 'H: Conversion of liabilities', value: 'H: Conversion of liabilities' },
  { label: 'I: Journal entry Debit', value: 'I: Journal entry Debit' },
  { label: 'J: Journal entry Credit', value: 'J: Journal entry Credit' },
  { label: 'K: Any other mode Debit', value: 'K: Any other mode Debit' },
  { label: 'L: Any other mode Credit', value: 'L: Any other mode Credit' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31_EXCEPTION_OR_EXCLUDED_COUNTERPARTY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'No exception claimed', value: 'No exception claimed' },
  { label: 'Government', value: 'Government' },
  { label: 'Government company', value: 'Government company' },
  { label: 'Banking company', value: 'Banking company' },
  { label: 'Corporation established by Central, State or Provincial Act', value: 'Corporation established by Central, State or Provincial Act' },
  { label: 'Other statutory exception', value: 'Other statutory exception' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31C_TRANSACTION_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Repayment of loan', value: 'Repayment of loan' },
  { label: 'Repayment of deposit', value: 'Repayment of deposit' },
  { label: 'Repayment of specified advance', value: 'Repayment of specified advance' },
  { label: 'Interest on loan or deposit', value: 'Interest on loan or deposit' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_31D_TRANSACTION_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Repayment of loan received', value: 'Repayment of loan received' },
  { label: 'Repayment of deposit received', value: 'Repayment of deposit received' },
  { label: 'Repayment of specified advance received', value: 'Repayment of specified advance received' },
  { label: 'Interest received', value: 'Interest received' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_32_LOSS_OR_ALLOWANCE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Unabsorbed depreciation under section 32(2)', value: 'Unabsorbed depreciation under section 32(2)' },
  { label: 'House property loss under section 71B', value: 'House property loss under section 71B' },
  { label: 'Business loss under section 72', value: 'Business loss under section 72' },
  { label: 'Speculation loss under section 73', value: 'Speculation loss under section 73' },
  { label: 'Specified business loss under section 73A', value: 'Specified business loss under section 73A' },
  { label: 'Capital loss under section 74', value: 'Capital loss under section 74' },
  { label: 'Loss from owning and maintaining race horses under section 74A', value: 'Loss from owning and maintaining race horses under section 74A' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_32_SECTION_79_VIEW_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Loss carry forward affected', value: 'Loss carry forward affected' },
  { label: 'Loss carry forward not affected', value: 'Loss carry forward not affected' },
  { label: 'Exception claimed', value: 'Exception claimed' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Not applicable', value: 'Not applicable' },
];

const CLAUSE_32_YES_NO_REVIEW_NOT_APPLICABLE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Not applicable', value: 'Not applicable' },
];

const CLAUSE_33_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  '10A',
  '10AA',
  '80C',
  '80CCC',
  '80CCD(1)',
  '80CCD(1B)',
  '80CCD(2)',
  '80CCH',
  '80D',
  '80DD',
  '80DDB',
  '80E',
  '80EE',
  '80EEA',
  '80EEB',
  '80G',
  '80GGA',
  '80GGC',
  '80-IA',
  '80-IAB',
  '80-IAC',
  '80-IB',
  '80-IBA',
  '80-IC',
  '80-ID',
  '80-IE',
  '80JJA',
  '80JJAA',
  '80LA',
  '80M',
  '80P',
  'Other',
  'To be reviewed',
].map((section) => ({ label: section, value: section }));

const CLAUSE_33_DEDUCTION_CATEGORY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Chapter III deduction', value: 'Chapter III deduction' },
  { label: 'Chapter VIA deduction', value: 'Chapter VIA deduction' },
  { label: 'Business-linked deduction', value: 'Business-linked deduction' },
  { label: 'Personal deduction', value: 'Personal deduction' },
  { label: 'Donation-based deduction', value: 'Donation-based deduction' },
  { label: 'Employment-linked deduction', value: 'Employment-linked deduction' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_33_CONDITIONS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Partly', value: 'Partly' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_34_TDS_OR_TCS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'TDS', value: 'TDS' },
  { label: 'TCS', value: 'TCS' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_34_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  '192',
  '193',
  '194',
  '194A',
  '194C',
  '194D',
  '194H',
  '194I',
  '194IA',
  '194IB',
  '194IC',
  '194J',
  '194K',
  '194Q',
  '195',
  '196D',
  '206C',
  '206C(1H)',
  'Other',
  'To be reviewed',
].map((section) => ({ label: section, value: section }));

const CLAUSE_34_LOWER_OR_NIL_RATE_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Section 197 certificate', value: 'Section 197 certificate' },
  { label: 'Section 195 order / certificate', value: 'Section 195 order / certificate' },
  { label: 'Threshold limit', value: 'Threshold limit' },
  { label: 'DTAA', value: 'DTAA' },
  { label: 'Form 15G / 15H', value: 'Form 15G / 15H' },
  { label: 'Lower rate view taken by assessee', value: 'Lower rate view taken by assessee' },
  { label: 'Difference of opinion', value: 'Difference of opinion' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_34_TYPE_OF_FORM_OPTIONS: TaxAuditStructuredFieldOption[] = [
  'Form 24Q',
  'Form 26Q',
  'Form 27Q',
  'Form 27EQ',
  'Form 26QB',
  'Form 26QC',
  'Form 26QD',
  'Form 26QE',
  'Correction statement',
  'Other',
  'To be reviewed',
].map((item) => ({ label: item, value: item }));

const CLAUSE_34_QUARTER_OR_PERIOD_OPTIONS: TaxAuditStructuredFieldOption[] = [
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Annual',
  'Transaction-wise',
  'Other',
  'To be reviewed',
].map((item) => ({ label: item, value: item }));

const CLAUSE_34_STATEMENT_FURNISHED_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_34_TRANSACTIONS_REPORTED_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Cannot verify', value: 'Cannot verify' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_34_INTEREST_SECTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '201(1A)', value: '201(1A)' },
  { label: '206C(7)', value: '206C(7)' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_34_DEFAULT_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Non-deduction', value: 'Non-deduction' },
  { label: 'Short deduction', value: 'Short deduction' },
  { label: 'Late deduction', value: 'Late deduction' },
  { label: 'Late deposit', value: 'Late deposit' },
  { label: 'Non-collection', value: 'Non-collection' },
  { label: 'Short collection', value: 'Short collection' },
  { label: 'Late collection', value: 'Late collection' },
  { label: 'Late deposit of TCS', value: 'Late deposit of TCS' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_35_PRINCIPAL_ITEM_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_35_TRADING_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'More than 10 percent of purchases', value: 'More than 10 percent of purchases' },
  { label: 'More than 10 percent of turnover', value: 'More than 10 percent of turnover' },
  { label: 'Management identified principal item', value: 'Management identified principal item' },
  { label: 'Auditor review', value: 'Auditor review' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_35_RAW_MATERIAL_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'More than 10 percent of purchases', value: 'More than 10 percent of purchases' },
  { label: 'More than 10 percent of consumption', value: 'More than 10 percent of consumption' },
  { label: 'Management identified principal item', value: 'Management identified principal item' },
  { label: 'Auditor review', value: 'Auditor review' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_35_PRODUCT_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Finished product', value: 'Finished product' },
  { label: 'By-product', value: 'By-product' },
  { label: 'Scrap', value: 'Scrap' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_35_FINISHED_PRODUCT_BASIS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'More than 10 percent of turnover', value: 'More than 10 percent of turnover' },
  { label: 'More than 10 percent of production', value: 'More than 10 percent of production' },
  { label: 'Management identified principal item', value: 'Management identified principal item' },
  { label: 'Auditor review', value: 'Auditor review' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
  { label: 'Other', value: 'Other' },
];

const CLAUSE_36A_CLOSELY_HELD_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_36A_NATURE_OF_PAYMENT_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Loan', value: 'Loan' },
  { label: 'Advance', value: 'Advance' },
  { label: 'Payment on behalf of shareholder', value: 'Payment on behalf of shareholder' },
  { label: 'Payment for benefit of shareholder', value: 'Payment for benefit of shareholder' },
  { label: 'Current account transaction', value: 'Current account transaction' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_36A_COMMERCIAL_TRANSACTION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_36B_SHARE_CLASS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Equity shares', value: 'Equity shares' },
  { label: 'Preference shares', value: 'Preference shares' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_37_TO_39_WHETHER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_37_TO_39_DISQUALIFICATION_NATURE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Disqualification', value: 'Disqualification' },
  { label: 'Disagreement', value: 'Disagreement' },
  { label: 'Adverse observation', value: 'Adverse observation' },
  { label: 'Qualification', value: 'Qualification' },
  { label: 'Other matter', value: 'Other matter' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_40_ACTIVITY_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Trading', value: 'Trading' },
  { label: 'Manufacturing', value: 'Manufacturing' },
  { label: 'Service', value: 'Service' },
  { label: 'Mixed', value: 'Mixed' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_40_DEVIATION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_41_TAX_LAW_CATEGORY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'GST', value: 'GST' },
  { label: 'Central Excise', value: 'Central Excise' },
  { label: 'Service Tax', value: 'Service Tax' },
  { label: 'Customs', value: 'Customs' },
  { label: 'VAT', value: 'VAT' },
  { label: 'Central Sales Tax', value: 'Central Sales Tax' },
  { label: 'Professional Tax', value: 'Professional Tax' },
  { label: 'Entry Tax', value: 'Entry Tax' },
  { label: 'Local Body Tax', value: 'Local Body Tax' },
  { label: 'Stamp Duty', value: 'Stamp Duty' },
  { label: 'Other tax law', value: 'Other tax law' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_41_DEMAND_OR_REFUND_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Demand', value: 'Demand' },
  { label: 'Refund', value: 'Refund' },
  { label: 'Refund adjusted against demand', value: 'Refund adjusted against demand' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_41_CURRENT_STATUS_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Paid', value: 'Paid' },
  { label: 'Received', value: 'Received' },
  { label: 'Adjusted', value: 'Adjusted' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Under appeal', value: 'Under appeal' },
  { label: 'Stayed', value: 'Stayed' },
  { label: 'Partly paid', value: 'Partly paid' },
  { label: 'Partly received', value: 'Partly received' },
  { label: 'Dropped', value: 'Dropped' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_41_WHETHER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_42_FORM_NO_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Form 61', value: 'Form 61' },
  { label: 'Form 61A', value: 'Form 61A' },
  { label: 'Form 61B', value: 'Form 61B' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_42_REQUIRED_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_42_WHETHER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_42_INFORMATION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Cannot verify', value: 'Cannot verify' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_42_REPORTING_PERIOD_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: '1 April to 30 September', value: '1 April to 30 September' },
  { label: '1 October to 31 March', value: '1 October to 31 March' },
  { label: 'Full financial year', value: 'Full financial year' },
  { label: 'Calendar year', value: 'Calendar year' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_43_WHETHER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_43_ASSESSEE_ROLE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Parent entity resident in India', value: 'Parent entity resident in India' },
  { label: 'Alternate reporting entity resident in India', value: 'Alternate reporting entity resident in India' },
  { label: 'Constituent entity resident in India', value: 'Constituent entity resident in India' },
  { label: 'Constituent entity with non-resident parent', value: 'Constituent entity with non-resident parent' },
  { label: 'Not part of international group', value: 'Not part of international group' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_43_REPORT_FURNISHED_BY_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Assessee', value: 'Assessee' },
  { label: 'Parent entity', value: 'Parent entity' },
  { label: 'Alternate reporting entity', value: 'Alternate reporting entity' },
  { label: 'Other constituent entity resident in India', value: 'Other constituent entity resident in India' },
  { label: 'Not furnished', value: 'Not furnished' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_43_FORM_OR_REPORT_REFERENCE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Form 3CEAC', value: 'Form 3CEAC' },
  { label: 'Form 3CEAD', value: 'Form 3CEAD' },
  { label: 'Form 3CEAE', value: 'Form 3CEAE' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_44_EXPENDITURE_TYPE_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Revenue expenditure', value: 'Revenue expenditure' },
  { label: 'Capital expenditure', value: 'Capital expenditure' },
  { label: 'Mixed', value: 'Mixed' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_44_BASIS_OF_CLASSIFICATION_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Supplier GST registration status at time of supply', value: 'Supplier GST registration status at time of supply' },
  { label: 'Purchase register classification', value: 'Purchase register classification' },
  { label: 'Management working', value: 'Management working' },
  { label: 'GST portal verification', value: 'GST portal verification' },
  { label: 'Test-check basis', value: 'Test-check basis' },
  { label: 'Other', value: 'Other' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

const CLAUSE_44_WHETHER_OPTIONS: TaxAuditStructuredFieldOption[] = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
  { label: 'Not applicable', value: 'Not applicable' },
  { label: 'To be reviewed', value: 'To be reviewed' },
];

export const TAX_AUDIT_3CD_FIELD_SCHEMAS: TaxAudit3CDFieldSchema[] = [
  {
    clauseKey: 'clause_1',
    fields: [
      {
        key: 'assessee_name',
        label: 'Name of the assessee',
        type: 'text',
        required: true,
        placeholder: 'Enter assessee name',
        sourceHint: 'Client master / Tax Audit setup',
      },
    ],
  },
  {
    clauseKey: 'clause_2',
    fields: [
      {
        key: 'address',
        label: 'Address',
        type: 'textarea',
        required: true,
        placeholder: 'Enter address',
        sourceHint: 'Client master / Tax Audit setup',
      },
      {
        key: 'state',
        label: 'State',
        type: 'text',
        placeholder: 'State',
        sourceHint: 'Client master',
      },
      {
        key: 'pin_code',
        label: 'PIN code',
        type: 'text',
        placeholder: 'PIN code',
        sourceHint: 'Client master',
      },
    ],
  },
  {
    clauseKey: 'clause_3',
    fields: [
      {
        key: 'pan_or_aadhaar',
        label: 'PAN or Aadhaar number',
        type: 'text',
        required: true,
        placeholder: 'ABCDE1234F or 12 digit Aadhaar',
        sourceHint: 'Client master / Tax Audit setup',
      },
    ],
  },
  {
    clauseKey: 'clause_4',
    table: {
      key: 'registrations',
      label: 'Indirect tax registrations',
      required: true,
      columns: [
        {
          key: 'law',
          label: 'Law',
          type: 'select',
          required: true,
          options: [
            { label: 'GST', value: 'GST' },
            { label: 'Customs', value: 'Customs' },
            { label: 'Excise', value: 'Excise' },
            { label: 'VAT', value: 'VAT' },
            { label: 'Service Tax', value: 'Service Tax' },
            { label: 'Other', value: 'Other' },
          ],
          width: '160px',
        },
        {
          key: 'registration_number',
          label: 'Registration number',
          type: 'text',
          required: true,
          placeholder: 'GSTIN / registration number',
        },
        {
          key: 'description',
          label: 'Description',
          type: 'text',
          placeholder: 'State, authority, or notes',
        },
      ],
    },
  },
  {
    clauseKey: 'clause_5',
    fields: [
      {
        key: 'assessee_status',
        label: 'Status of the assessee',
        type: 'select',
        required: true,
        options: ASSESSEE_STATUS_OPTIONS,
        sourceHint: 'Client master / Tax Audit setup',
      },
    ],
  },
  {
    clauseKey: 'clause_6',
    fields: [
      {
        key: 'previous_year_from',
        label: 'Previous year from',
        type: 'date',
        required: true,
        sourceHint: 'Engagement financial year',
      },
      {
        key: 'previous_year_to',
        label: 'Previous year to',
        type: 'date',
        required: true,
        sourceHint: 'Engagement financial year',
      },
    ],
  },
  {
    clauseKey: 'clause_7',
    fields: [
      {
        key: 'assessment_year',
        label: 'Assessment year',
        type: 'text',
        required: true,
        placeholder: 'AY 2025-26',
        sourceHint: 'Engagement financial year',
      },
    ],
  },
  {
    clauseKey: 'clause_8',
    fields: [
      {
        key: 'relevant_clause_44ab',
        label: 'Relevant clause of section 44AB',
        type: 'select',
        required: true,
        options: SECTION_44AB_OPTIONS,
        sourceHint: 'Tax Audit applicability setup',
      },
      {
        key: 'applicability_reason',
        label: 'Applicability basis',
        type: 'textarea',
        placeholder: 'Basis for relevant clause selection',
        sourceHint: 'Tax Audit applicability setup',
      },
    ],
  },
  {
    clauseKey: 'clause_8a',
    fields: [
      {
        key: 'opted_for_section_115_taxation',
        label: 'Whether the assessee has opted for taxation under section 115BA/115BAA/115BAB/115BAC/115BAD/115BAE?',
        type: 'select',
        required: true,
        options: YES_NO_ONLY_OPTIONS,
      },
      {
        key: 'selected_section_115_taxation',
        label: 'Selected section',
        type: 'select',
        required: true,
        options: SECTION_115_TAX_REGIME_OPTIONS,
        visibleWhen: {
          fieldKey: 'opted_for_section_115_taxation',
          value: 'yes',
        },
      },
    ],
  },
  {
    clauseKey: 'clause_9',
    fields: [
      {
        key: 'whether_there_was_change_during_year',
        label: 'Whether there was change during the previous year',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
      {
        key: 'change_remarks',
        label: 'Change remarks',
        type: 'textarea',
        placeholder: 'Summarise admission, retirement, ratio change, remuneration or interest changes',
      },
    ],
    table: {
      key: 'partners_or_members',
      label: 'Partners or members',
      required: true,
      columns: [
        { key: 'name', label: 'Name', type: 'text', required: true, width: '180px' },
        { key: 'status_or_capacity', label: 'Status / capacity', type: 'text', placeholder: 'Partner / member', width: '150px' },
        { key: 'profit_sharing_ratio', label: 'Profit sharing %', type: 'percentage', placeholder: '0-100', width: '130px' },
        { key: 'remuneration_or_interest_change', label: 'Remuneration / interest change', type: 'text', width: '220px' },
        { key: 'date_of_change', label: 'Date of change', type: 'date', width: '150px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_10',
    fields: [
      {
        key: 'whether_change_during_year',
        label: 'Whether change during the previous year',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
      {
        key: 'change_details',
        label: 'Change details',
        type: 'textarea',
        placeholder: 'Describe changes in nature of business or profession',
      },
    ],
    table: {
      key: 'business_or_profession_rows',
      label: 'Business or profession activities',
      required: true,
      columns: [
        {
          key: 'nature_of_business_or_profession',
          label: 'Nature of business or profession',
          type: 'text',
          required: true,
        },
        {
          key: 'business_or_profession_code',
          label: 'Code',
          type: 'text',
          placeholder: 'If available',
          width: '140px',
        },
        {
          key: 'remarks',
          label: 'Remarks',
          type: 'text',
        },
      ],
    },
  },
  {
    clauseKey: 'clause_11',
    fields: [
      {
        key: 'whether_books_prescribed_under_44aa',
        label: 'Books prescribed under section 44AA',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
      {
        key: 'books_prescribed',
        label: 'Books prescribed',
        type: 'textarea',
        placeholder: 'List books prescribed, if applicable',
      },
      {
        key: 'books_maintained',
        label: 'Books maintained',
        type: 'textarea',
        required: true,
        placeholder: 'List books maintained',
      },
      {
        key: 'books_examined',
        label: 'Books examined',
        type: 'textarea',
        required: true,
        placeholder: 'List books examined',
      },
      {
        key: 'whether_books_kept_at_multiple_locations',
        label: 'Books kept at multiple locations',
        type: 'select',
        options: YES_NO_OPTIONS,
      },
    ],
    table: {
      key: 'book_locations',
      label: 'Book locations',
      required: true,
      columns: [
        {
          key: 'place_where_books_are_kept',
          label: 'Place where books are kept',
          type: 'text',
          required: true,
        },
        {
          key: 'location_details',
          label: 'Location details',
          type: 'text',
        },
      ],
    },
  },
  {
    clauseKey: 'clause_12',
    fields: [
      {
        key: 'whether_profit_loss_includes_presumptive_income',
        label: 'P&L includes presumptive income',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
        sourceHint: 'Tax Audit setup',
      },
      {
        key: 'applicable_presumptive_section',
        label: 'Applicable presumptive section',
        type: 'select',
        options: PRESUMPTIVE_SECTION_OPTIONS,
      },
      {
        key: 'amount',
        label: 'Amount',
        type: 'number',
        placeholder: '0.00',
      },
      {
        key: 'basis_or_remarks',
        label: 'Basis or remarks',
        type: 'textarea',
        placeholder: 'Basis for presumptive income disclosure',
      },
    ],
  },
  {
    clauseKey: 'clause_13',
    fields: [
      {
        key: 'method_of_accounting',
        label: 'Method of accounting',
        type: 'select',
        required: true,
        options: ACCOUNTING_METHOD_OPTIONS,
      },
      {
        key: 'whether_change_in_method',
        label: 'Change in method',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
      {
        key: 'change_details',
        label: 'Change details',
        type: 'textarea',
      },
      {
        key: 'effect_on_profit',
        label: 'Effect on profit',
        type: 'number',
        placeholder: '0.00',
      },
      {
        key: 'whether_icds_applicable',
        label: 'ICDS applicable',
        type: 'select',
        options: YES_NO_OPTIONS,
      },
      {
        key: 'icds_adjustments',
        label: 'ICDS adjustments',
        type: 'textarea',
        placeholder: 'Simple ICDS adjustment summary',
      },
      {
        key: 'disclosure_or_remarks',
        label: 'Disclosure or remarks',
        type: 'textarea',
      },
    ],
  },
  {
    clauseKey: 'clause_14',
    fields: [
      {
        key: 'method_of_valuation_opening_stock',
        label: 'Method of valuation of opening stock',
        type: 'textarea',
        required: true,
      },
      {
        key: 'method_of_valuation_closing_stock',
        label: 'Method of valuation of closing stock',
        type: 'textarea',
        required: true,
      },
      {
        key: 'whether_deviation_from_section_145A',
        label: 'Deviation from section 145A',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
      {
        key: 'deviation_details',
        label: 'Deviation details',
        type: 'textarea',
      },
      {
        key: 'effect_on_profit',
        label: 'Effect on profit',
        type: 'number',
        placeholder: '0.00',
      },
      {
        key: 'remarks',
        label: 'Remarks',
        type: 'textarea',
      },
    ],
  },
  {
    clauseKey: 'clause_15',
    fields: [
      {
        key: 'whether_any_capital_asset_converted_into_stock_in_trade',
        label: 'Any capital asset converted into stock-in-trade',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
    ],
    table: {
      key: 'rows',
      label: 'Capital assets converted into stock-in-trade',
      columns: [
        { key: 'asset_description', label: 'Asset description', type: 'text', required: true },
        { key: 'date_of_acquisition', label: 'Date of acquisition', type: 'date', width: '150px' },
        { key: 'cost_of_acquisition', label: 'Cost of acquisition', type: 'number', width: '150px' },
        {
          key: 'amount_at_which_asset_is_converted_into_stock_in_trade',
          label: 'Conversion amount',
          type: 'number',
          width: '160px',
        },
        {
          key: 'fair_market_value_on_date_of_conversion',
          label: 'FMV on conversion',
          type: 'number',
          width: '160px',
        },
        { key: 'date_of_conversion', label: 'Date of conversion', type: 'date', width: '150px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_16',
    table: {
      key: 'rows',
      label: 'Amounts not credited to profit and loss account',
      columns: [
        {
          key: 'category',
          label: 'Category',
          type: 'select',
          options: CLAUSE_16_CATEGORY_OPTIONS,
          width: '260px',
        },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'number', width: '150px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_17',
    table: {
      key: 'rows',
      label: 'Transfers of land or building or both',
      columns: [
        { key: 'property_description', label: 'Property description', type: 'text', required: true },
        { key: 'address_or_location', label: 'Address / location', type: 'text' },
        {
          key: 'whether_land_or_building_or_both',
          label: 'Type',
          type: 'select',
          options: PROPERTY_TRANSFER_TYPE_OPTIONS,
          width: '170px',
        },
        { key: 'date_of_transfer', label: 'Date of transfer', type: 'date', width: '150px' },
        {
          key: 'consideration_received_or_accrued',
          label: 'Consideration',
          type: 'number',
          width: '150px',
        },
        {
          key: 'value_adopted_or_assessed_or_assessable',
          label: 'Stamp value',
          type: 'number',
          width: '150px',
        },
        {
          key: 'section_reference',
          label: 'Section',
          type: 'select',
          options: LAND_BUILDING_SECTION_OPTIONS,
          width: '150px',
        },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_18',
    fields: [
      {
        key: 'depreciation_working_available',
        label: 'Depreciation working available',
        type: 'select',
        required: true,
        options: YES_NO_OPTIONS,
      },
      {
        key: 'remarks',
        label: 'Remarks',
        type: 'textarea',
        placeholder: 'Manual depreciation working remarks',
      },
    ],
    table: {
      key: 'rows',
      label: 'Depreciation blocks',
      columns: [
        { key: 'block_or_asset_class', label: 'Block / asset class', type: 'text', required: true },
        { key: 'rate_of_depreciation', label: 'Rate %', type: 'percentage', width: '120px' },
        { key: 'opening_wdv', label: 'Opening WDV', type: 'number', width: '140px' },
        { key: 'additions_more_than_180_days', label: 'Additions >180 days', type: 'number', width: '160px' },
        { key: 'additions_less_than_180_days', label: 'Additions <180 days', type: 'number', width: '160px' },
        { key: 'deductions_or_sales', label: 'Deductions / sales', type: 'number', width: '150px' },
        { key: 'depreciation_allowable', label: 'Depreciation allowable', type: 'number', width: '170px' },
        { key: 'closing_wdv', label: 'Closing WDV', type: 'number', width: '140px' },
        { key: 'additional_depreciation', label: 'Additional depreciation', type: 'number', width: '170px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_19',
    table: {
      key: 'deduction_rows',
      label: 'Amounts admissible under specified sections',
      columns: [
        {
          key: 'section',
          label: 'Section',
          type: 'select',
          options: CLAUSE_19_SECTION_OPTIONS,
          width: '190px',
        },
        {
          key: 'amount_debited_to_profit_and_loss',
          label: 'Amount debited to P&L',
          type: 'number',
          width: '170px',
        },
        {
          key: 'amount_admissible_under_income_tax_act',
          label: 'Amount admissible',
          type: 'number',
          width: '160px',
        },
        {
          key: 'conditions_fulfilled',
          label: 'Conditions fulfilled',
          type: 'select',
          options: CONDITIONS_FULFILLED_OPTIONS,
          width: '170px',
        },
        {
          key: 'evidence_or_working_reference',
          label: 'Evidence / working ref',
          type: 'text',
          width: '190px',
        },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_20',
    tables: [
      {
        key: 'bonus_commission_rows',
        label: 'Bonus or commission under section 36(1)(ii)',
        shortLabel: '36(1)(ii)',
        description: 'Bonus or commission paid to employees or payees requiring manual admissibility review.',
        summaryFields: ['employee_or_payee_name', 'nature_of_payment', 'amount'],
        columns: [
          { key: 'employee_or_payee_name', label: 'Employee / payee', type: 'text', width: '190px' },
          {
            key: 'nature_of_payment',
            label: 'Nature',
            type: 'select',
            options: BONUS_COMMISSION_NATURE_OPTIONS,
            width: '140px',
          },
          { key: 'amount', label: 'Amount', type: 'number', width: '140px' },
          {
            key: 'whether_payable_as_profit_or_dividend_if_not_paid_as_bonus_or_commission',
            label: 'Payable as profit/dividend',
            type: 'select',
            options: YES_NO_OPTIONS,
            width: '190px',
          },
          {
            key: 'admissibility_view',
            label: 'Admissibility view',
            type: 'select',
            options: ADMISSIBILITY_VIEW_OPTIONS,
            width: '170px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'employee_contribution_rows',
        label: 'Employee contribution under section 36(1)(va)',
        shortLabel: '36(1)(va)',
        description: 'Employee contribution receipts and deposit details requiring manual due-date review.',
        summaryFields: ['fund_name', 'month_or_period', 'amount_received_from_employees'],
        columns: [
          {
            key: 'fund_name',
            label: 'Fund',
            type: 'select',
            options: EMPLOYEE_CONTRIBUTION_FUND_OPTIONS,
            width: '180px',
          },
          { key: 'month_or_period', label: 'Month / period', type: 'text', width: '150px' },
          {
            key: 'amount_received_from_employees',
            label: 'Amount received',
            type: 'number',
            width: '150px',
          },
          { key: 'due_date_for_deposit', label: 'Due date', type: 'date', width: '150px' },
          { key: 'actual_date_of_deposit', label: 'Actual deposit date', type: 'date', width: '160px' },
          { key: 'amount_deposited', label: 'Amount deposited', type: 'number', width: '150px' },
          {
            key: 'delay_status',
            label: 'Delay status',
            type: 'select',
            options: CONTRIBUTION_DELAY_STATUS_OPTIONS,
            width: '190px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_21',
    tables: [
      {
        key: 'clause_21a_rows',
        label: '21(a) Specified expenditure items',
        shortLabel: '21(a)',
        description: 'Capital, personal, advertisement, penalty and other specified expenditure items.',
        summaryFields: ['category', 'nature_of_expenditure', 'amount_inadmissible'],
        columns: [
          {
            key: 'category',
            label: 'Category',
            type: 'select',
            options: CLAUSE_21A_CATEGORY_OPTIONS,
            width: '280px',
          },
          { key: 'nature_of_expenditure', label: 'Nature of expenditure', type: 'text', width: '220px' },
          {
            key: 'amount_debited_to_profit_and_loss',
            label: 'Amount debited to P&L',
            type: 'number',
            width: '170px',
          },
          { key: 'amount_inadmissible', label: 'Amount inadmissible', type: 'number', width: '170px' },
          { key: 'ledger_or_working_reference', label: 'Ledger / working ref', type: 'text', width: '190px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21b_rows',
        label: '21(b) Section 40(a) inadmissible amounts',
        shortLabel: '21(b)',
        description: 'Manual capture of payments inadmissible under section 40(a), including tax deduction and deposit particulars.',
        summaryFields: ['sub_clause', 'payee_name', 'amount_of_payment'],
        columns: [
          {
            key: 'sub_clause',
            label: 'Sub-clause',
            type: 'select',
            options: CLAUSE_21B_SUB_CLAUSE_OPTIONS,
            width: '280px',
          },
          { key: 'date_of_payment', label: 'Date of payment', type: 'date', width: '150px' },
          { key: 'nature_of_payment', label: 'Nature of payment', type: 'text', width: '200px' },
          { key: 'amount_of_payment', label: 'Amount of payment', type: 'number', width: '160px' },
          { key: 'payee_name', label: 'Payee name', type: 'text', width: '190px' },
          { key: 'payee_address', label: 'Payee address', type: 'text', width: '220px' },
          { key: 'payee_pan_or_aadhaar', label: 'Payee PAN / Aadhaar', type: 'text', width: '180px' },
          {
            key: 'tax_deducted',
            label: 'Tax deducted',
            type: 'select',
            options: YES_NO_OPTIONS,
            width: '150px',
          },
          { key: 'tax_deducted_amount', label: 'Tax deducted amount', type: 'number', width: '170px' },
          { key: 'tax_deposited_amount', label: 'Tax deposited amount', type: 'number', width: '170px' },
          {
            key: 'reason_for_inadmissibility',
            label: 'Reason',
            type: 'select',
            options: CLAUSE_21B_REASON_OPTIONS,
            width: '190px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21c_rows',
        label: '21(c) Section 40(b) / 40(ba) inadmissible amounts',
        shortLabel: '21(c)',
        description: 'Partner, AOP or BOI related payments requiring manual section 40(b) or 40(ba) review.',
        summaryFields: ['payee_name', 'nature_of_payment', 'amount_inadmissible'],
        columns: [
          { key: 'payee_name', label: 'Payee name', type: 'text', width: '190px' },
          {
            key: 'payee_capacity',
            label: 'Payee capacity',
            type: 'select',
            options: CLAUSE_21C_PAYEE_CAPACITY_OPTIONS,
            width: '180px',
          },
          {
            key: 'nature_of_payment',
            label: 'Nature of payment',
            type: 'select',
            options: CLAUSE_21C_NATURE_OPTIONS,
            width: '170px',
          },
          {
            key: 'amount_debited_to_profit_and_loss',
            label: 'Amount debited to P&L',
            type: 'number',
            width: '170px',
          },
          { key: 'amount_admissible', label: 'Amount admissible', type: 'number', width: '160px' },
          { key: 'amount_inadmissible', label: 'Amount inadmissible', type: 'number', width: '170px' },
          {
            key: 'basis_of_inadmissibility',
            label: 'Basis of inadmissibility',
            type: 'select',
            options: CLAUSE_21C_BASIS_OPTIONS,
            width: '210px',
          },
          {
            key: 'deed_or_authorisation_reference',
            label: 'Deed / authorisation ref',
            type: 'text',
            width: '210px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21d_rows',
        label: '21(d) Section 40A(3) / 40A(3A)',
        shortLabel: '21(d)',
        description: 'Cash and other payment mode review under section 40A(3) and 40A(3A).',
        summaryFields: ['sub_clause', 'mode_of_payment', 'amount_inadmissible'],
        columns: [
          {
            key: 'sub_clause',
            label: 'Sub-clause',
            type: 'select',
            options: CLAUSE_21D_SUB_CLAUSE_OPTIONS,
            width: '150px',
          },
          { key: 'date_of_payment', label: 'Date of payment', type: 'date', width: '150px' },
          { key: 'nature_of_payment', label: 'Nature of payment', type: 'text', width: '200px' },
          { key: 'amount', label: 'Amount', type: 'number', width: '150px' },
          { key: 'payee_name', label: 'Payee name', type: 'text', width: '190px' },
          { key: 'payee_pan_or_aadhaar', label: 'Payee PAN / Aadhaar', type: 'text', width: '180px' },
          {
            key: 'mode_of_payment',
            label: 'Mode of payment',
            type: 'select',
            options: CLAUSE_21D_PAYMENT_MODE_OPTIONS,
            width: '190px',
          },
          {
            key: 'whether_covered_by_rule_6dd',
            label: 'Covered by Rule 6DD',
            type: 'select',
            options: YES_NO_OPTIONS,
            width: '180px',
          },
          { key: 'rule_6dd_reference', label: 'Rule 6DD reference', type: 'text', width: '180px' },
          { key: 'amount_inadmissible', label: 'Amount inadmissible', type: 'number', width: '170px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21e_rows',
        label: '21(e) Provision for gratuity',
        shortLabel: '21(e)',
        description: 'Provision or payment details for gratuity disallowance review under section 40A(7).',
        summaryFields: ['nature_of_provision', 'basis', 'amount_inadmissible'],
        columns: [
          { key: 'nature_of_provision', label: 'Nature of provision', type: 'text', width: '220px' },
          {
            key: 'amount_debited_to_profit_and_loss',
            label: 'Amount debited to P&L',
            type: 'number',
            width: '170px',
          },
          { key: 'amount_admissible', label: 'Amount admissible', type: 'number', width: '160px' },
          { key: 'amount_inadmissible', label: 'Amount inadmissible', type: 'number', width: '170px' },
          {
            key: 'basis',
            label: 'Basis',
            type: 'select',
            options: CLAUSE_21E_BASIS_OPTIONS,
            width: '190px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21f_rows',
        label: '21(f) Employer sums under section 40A(9)',
        shortLabel: '21(f)',
        description: 'Employer contributions or sums requiring approval or statutory basis review under section 40A(9).',
        summaryFields: ['nature_of_sum', 'recipient_or_fund_name', 'amount_inadmissible'],
        columns: [
          { key: 'nature_of_sum', label: 'Nature of sum', type: 'text', width: '210px' },
          { key: 'recipient_or_fund_name', label: 'Recipient / fund', type: 'text', width: '210px' },
          { key: 'amount', label: 'Amount', type: 'number', width: '150px' },
          {
            key: 'statutory_or_approved_basis',
            label: 'Statutory / approved basis',
            type: 'select',
            options: CLAUSE_21F_BASIS_OPTIONS,
            width: '220px',
          },
          { key: 'amount_inadmissible', label: 'Amount inadmissible', type: 'number', width: '170px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21g_rows',
        label: '21(g) Contingent liabilities',
        shortLabel: '21(g)',
        description: 'Contingent liabilities and their accounting treatment for manual auditor review.',
        summaryFields: ['nature_of_contingent_liability', 'accounting_treatment', 'amount'],
        columns: [
          { key: 'nature_of_contingent_liability', label: 'Nature of contingent liability', type: 'text', width: '250px' },
          { key: 'amount', label: 'Amount', type: 'number', width: '150px' },
          { key: 'reason_for_contingency', label: 'Reason for contingency', type: 'text', width: '230px' },
          {
            key: 'accounting_treatment',
            label: 'Accounting treatment',
            type: 'select',
            options: CLAUSE_21G_ACCOUNTING_TREATMENT_OPTIONS,
            width: '230px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21h_rows',
        label: '21(h) Section 14A',
        shortLabel: '21(h)',
        description: 'Manual section 14A disallowance particulars without automated Rule 8D computation.',
        summaryFields: ['nature_of_exempt_income', 'exempt_income_amount', 'amount_inadmissible_under_14a'],
        columns: [
          { key: 'nature_of_exempt_income', label: 'Nature of exempt income', type: 'text', width: '220px' },
          { key: 'exempt_income_amount', label: 'Exempt income amount', type: 'number', width: '170px' },
          { key: 'expenditure_claimed', label: 'Expenditure claimed', type: 'number', width: '170px' },
          {
            key: 'amount_inadmissible_under_14a',
            label: 'Amount inadmissible under 14A',
            type: 'number',
            width: '200px',
          },
          {
            key: 'basis_of_disallowance',
            label: 'Basis of disallowance',
            type: 'select',
            options: CLAUSE_21H_BASIS_OPTIONS,
            width: '210px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_21i_rows',
        label: '21(i) Proviso to section 36(1)(iii)',
        shortLabel: '21(i)',
        description: 'Interest capitalisation review under proviso to section 36(1)(iii).',
        summaryFields: ['asset_or_project_description', 'interest_amount_debited', 'amount_inadmissible'],
        columns: [
          { key: 'asset_or_project_description', label: 'Asset / project description', type: 'text', width: '240px' },
          { key: 'date_of_borrowing', label: 'Date of borrowing', type: 'date', width: '150px' },
          { key: 'date_asset_first_put_to_use', label: 'Date first put to use', type: 'date', width: '170px' },
          { key: 'interest_amount_debited', label: 'Interest debited', type: 'number', width: '160px' },
          { key: 'amount_inadmissible', label: 'Amount inadmissible', type: 'number', width: '170px' },
          {
            key: 'basis_of_identification',
            label: 'Basis of identification',
            type: 'select',
            options: CLAUSE_21I_BASIS_OPTIONS,
            width: '220px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_22',
    tables: [
      {
        key: 'clause_22i_interest_rows',
        label: '22(i) Interest inadmissible',
        shortLabel: '22(i)',
        description: 'Interest paid or payable to micro and small enterprises that is inadmissible under section 23 of the MSMED Act.',
        summaryFields: ['supplier_name', 'enterprise_type', 'amount_inadmissible_under_section_23'],
        columns: [
          { key: 'supplier_name', label: 'Supplier name', type: 'text', width: '220px' },
          { key: 'supplier_udyam_registration_number', label: 'Udyam registration number', type: 'text', width: '210px' },
          {
            key: 'enterprise_type',
            label: 'Enterprise type',
            type: 'select',
            options: MSMED_ENTERPRISE_TYPE_OPTIONS,
            width: '170px',
          },
          {
            key: 'amount_of_interest_paid_or_payable',
            label: 'Interest paid / payable',
            type: 'number',
            width: '170px',
          },
          {
            key: 'amount_debited_to_profit_and_loss',
            label: 'Amount debited to P&L',
            type: 'number',
            width: '170px',
          },
          {
            key: 'amount_inadmissible_under_section_23',
            label: 'Amount inadmissible u/s 23',
            type: 'number',
            width: '190px',
          },
          {
            key: 'basis_of_identification',
            label: 'Basis of identification',
            type: 'select',
            options: CLAUSE_22_BASIS_OPTIONS,
            width: '210px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_22ii_mse_payable_rows',
        label: '22(ii) Amount required to be paid to micro and small enterprises',
        shortLabel: '22(ii)',
        description: 'Amounts required to be paid to micro and small enterprises during the previous year under section 15 of the MSMED Act.',
        summaryFields: ['supplier_name', 'enterprise_type', 'amount_required_to_be_paid_during_previous_year'],
        columns: [
          { key: 'supplier_name', label: 'Supplier name', type: 'text', width: '220px' },
          { key: 'supplier_udyam_registration_number', label: 'Udyam registration number', type: 'text', width: '210px' },
          {
            key: 'enterprise_type',
            label: 'Enterprise type',
            type: 'select',
            options: MSMED_ENTERPRISE_TYPE_OPTIONS,
            width: '170px',
          },
          { key: 'invoice_or_reference_number', label: 'Invoice / reference number', type: 'text', width: '210px' },
          {
            key: 'date_of_acceptance_or_deemed_acceptance',
            label: 'Acceptance / deemed acceptance date',
            type: 'date',
            width: '230px',
          },
          {
            key: 'amount_required_to_be_paid_during_previous_year',
            label: 'Amount required to be paid',
            type: 'number',
            width: '190px',
          },
          {
            key: 'whether_written_agreement_exists',
            label: 'Written agreement exists',
            type: 'select',
            options: YES_NO_OPTIONS,
            width: '190px',
          },
          { key: 'agreed_payment_period_days', label: 'Agreed payment period days', type: 'number', width: '200px' },
          { key: 'due_date_under_section_15', label: 'Due date u/s 15', type: 'date', width: '160px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_22iii_payment_status_rows',
        label: '22(iii) Paid within time / not paid within time',
        shortLabel: '22(iii)',
        description: 'Payment status of amounts covered in 22(ii), including amounts paid within and beyond the time under section 15.',
        summaryFields: ['supplier_name', 'amount_referred_to_in_22ii', 'amount_inadmissible_for_previous_year'],
        columns: [
          { key: 'supplier_name', label: 'Supplier name', type: 'text', width: '220px' },
          { key: 'invoice_or_reference_number', label: 'Invoice / reference number', type: 'text', width: '210px' },
          { key: 'amount_referred_to_in_22ii', label: 'Amount referred to in 22(ii)', type: 'number', width: '190px' },
          {
            key: 'amount_paid_within_time_under_section_15',
            label: 'Amount paid within time u/s 15',
            type: 'number',
            width: '210px',
          },
          {
            key: 'amount_not_paid_within_time_under_section_15',
            label: 'Amount not paid within time u/s 15',
            type: 'number',
            width: '230px',
          },
          {
            key: 'amount_inadmissible_for_previous_year',
            label: 'Amount inadmissible for previous year',
            type: 'number',
            width: '230px',
          },
          { key: 'actual_payment_date', label: 'Actual payment date', type: 'date', width: '170px' },
          { key: 'due_date_under_section_15', label: 'Due date u/s 15', type: 'date', width: '160px' },
          {
            key: 'whether_claimed_as_deduction',
            label: 'Claimed as deduction',
            type: 'select',
            options: CLAIMED_AS_DEDUCTION_OPTIONS,
            width: '180px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_23',
    table: {
      key: 'clause_23_rows',
      label: 'Payments to specified persons under section 40A(2)(b)',
      summaryFields: ['specified_person_name', 'nature_of_payment', 'amount_paid_or_payable'],
      columns: [
        { key: 'specified_person_name', label: 'Specified person name', type: 'text', width: '220px' },
        {
          key: 'relationship_or_nature_of_connection',
          label: 'Relationship / connection',
          type: 'select',
          options: CLAUSE_23_RELATIONSHIP_OPTIONS,
          width: '220px',
        },
        { key: 'pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
        {
          key: 'nature_of_payment',
          label: 'Nature of payment',
          type: 'select',
          options: CLAUSE_23_PAYMENT_NATURE_OPTIONS,
          width: '190px',
        },
        { key: 'amount_paid_or_payable', label: 'Amount paid / payable', type: 'number', width: '180px' },
        { key: 'basis_of_reasonableness', label: 'Basis of reasonableness', type: 'text', width: '230px' },
        {
          key: 'auditor_view',
          label: 'Auditor view',
          type: 'select',
          options: CLAUSE_23_AUDITOR_VIEW_OPTIONS,
          width: '190px',
        },
        { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_24',
    table: {
      key: 'clause_24_rows',
      label: 'Amounts deemed to be profits and gains',
      summaryFields: ['section', 'nature_of_amount', 'amount'],
      columns: [
        {
          key: 'section',
          label: 'Section',
          type: 'select',
          options: CLAUSE_24_SECTION_OPTIONS,
          width: '160px',
        },
        { key: 'nature_of_amount', label: 'Nature of amount', type: 'text', width: '230px' },
        { key: 'amount', label: 'Amount', type: 'number', width: '150px' },
        {
          key: 'year_of_original_deduction_or_allowance',
          label: 'Year of original deduction / allowance',
          type: 'text',
          width: '240px',
        },
        { key: 'reason_for_deeming', label: 'Reason for deeming', type: 'text', width: '230px' },
        { key: 'computation_or_basis', label: 'Computation / basis', type: 'text', width: '220px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_25',
    table: {
      key: 'clause_25_rows',
      label: 'Profit chargeable to tax under section 41',
      summaryFields: ['section_41_reference', 'nature_of_liability_or_asset', 'amount_chargeable'],
      columns: [
        {
          key: 'section_41_reference',
          label: 'Section 41 reference',
          type: 'select',
          options: CLAUSE_25_SECTION_OPTIONS,
          width: '180px',
        },
        { key: 'nature_of_liability_or_asset', label: 'Nature of liability / asset', type: 'text', width: '240px' },
        { key: 'amount_chargeable', label: 'Amount chargeable', type: 'number', width: '170px' },
        {
          key: 'year_in_which_deduction_or_allowance_was_claimed',
          label: 'Year deduction / allowance claimed',
          type: 'text',
          width: '240px',
        },
        {
          key: 'event_triggering_taxability',
          label: 'Event triggering taxability',
          type: 'select',
          options: CLAUSE_25_TAXABILITY_EVENT_OPTIONS,
          width: '240px',
        },
        { key: 'computation_or_basis', label: 'Computation / basis', type: 'text', width: '220px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_26',
    tables: [
      {
        key: 'clause_26ia_opening_liability_rows',
        label: '26(i)(A) Opening section 43B liabilities',
        shortLabel: '26(i)(A)',
        description: 'Liabilities covered under section 43B that existed on the first day of the previous year.',
        summaryFields: [
          'section_43b_category',
          'nature_of_liability',
          'amount_outstanding_on_first_day_of_previous_year',
        ],
        columns: [
          {
            key: 'section_43b_category',
            label: 'Section 43B category',
            type: 'select',
            options: CLAUSE_26_SECTION_43B_CATEGORY_OPTIONS,
            width: '260px',
          },
          { key: 'nature_of_liability', label: 'Nature of liability', type: 'text', width: '240px' },
          {
            key: 'amount_outstanding_on_first_day_of_previous_year',
            label: 'Outstanding on first day',
            type: 'number',
            width: '190px',
          },
          { key: 'amount_paid_during_previous_year', label: 'Paid during previous year', type: 'number', width: '200px' },
          { key: 'date_of_payment', label: 'Date of payment', type: 'date', width: '160px' },
          {
            key: 'amount_remaining_unpaid_on_last_day_of_previous_year',
            label: 'Remaining unpaid on last day',
            type: 'number',
            width: '210px',
          },
          {
            key: 'amount_allowed_during_current_year',
            label: 'Allowed during current year',
            type: 'number',
            width: '210px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_26ib_current_year_liability_rows',
        label: '26(i)(B) Current year section 43B liabilities',
        shortLabel: '26(i)(B)',
        description: 'Liabilities covered under section 43B that were incurred during the previous year.',
        summaryFields: [
          'section_43b_category',
          'nature_of_liability',
          'amount_incurred_during_previous_year',
        ],
        columns: [
          {
            key: 'section_43b_category',
            label: 'Section 43B category',
            type: 'select',
            options: CLAUSE_26_SECTION_43B_CATEGORY_OPTIONS,
            width: '260px',
          },
          { key: 'nature_of_liability', label: 'Nature of liability', type: 'text', width: '240px' },
          {
            key: 'amount_incurred_during_previous_year',
            label: 'Amount incurred during PY',
            type: 'number',
            width: '200px',
          },
          {
            key: 'amount_paid_on_or_before_due_date_under_section_139_1',
            label: 'Paid on / before 139(1) due date',
            type: 'number',
            width: '230px',
          },
          {
            key: 'amount_not_paid_on_or_before_due_date_under_section_139_1',
            label: 'Not paid on / before 139(1) due date',
            type: 'number',
            width: '250px',
          },
          { key: 'due_date_under_section_139_1', label: 'Due date u/s 139(1)', type: 'date', width: '170px' },
          { key: 'actual_payment_date', label: 'Actual payment date', type: 'date', width: '170px' },
          {
            key: 'amount_disallowable_or_to_be_reviewed',
            label: 'Disallowable / to be reviewed',
            type: 'number',
            width: '220px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_26ii_indirect_tax_rows',
        label: '26(ii) Indirect taxes passed through profit and loss account',
        shortLabel: '26(ii)',
        description: 'Indirect taxes, duties, cess, fees or levies passed through the profit and loss account.',
        summaryFields: ['tax_or_levy_type', 'amount_passed_through_profit_and_loss', 'accounting_treatment'],
        columns: [
          {
            key: 'tax_or_levy_type',
            label: 'Tax / levy type',
            type: 'select',
            options: CLAUSE_26_INDIRECT_TAX_TYPE_OPTIONS,
            width: '190px',
          },
          {
            key: 'amount_passed_through_profit_and_loss',
            label: 'Amount passed through P&L',
            type: 'number',
            width: '210px',
          },
          {
            key: 'accounting_treatment',
            label: 'Accounting treatment',
            type: 'select',
            options: CLAUSE_26_ACCOUNTING_TREATMENT_OPTIONS,
            width: '230px',
          },
          { key: 'nature_of_account', label: 'Nature of account', type: 'text', width: '230px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_27',
    tables: [
      {
        key: 'clause_27a_credit_rows',
        label: '27(a) CENVAT / Input Tax Credit',
        shortLabel: '27(a)',
        description: 'CENVAT credit or Input Tax Credit availed, utilised and its accounting treatment.',
        summaryFields: ['credit_type', 'credit_availed_during_previous_year', 'credit_utilised_during_previous_year'],
        columns: [
          {
            key: 'credit_type',
            label: 'Credit type',
            type: 'select',
            options: CLAUSE_27_CREDIT_TYPE_OPTIONS,
            width: '190px',
          },
          { key: 'opening_balance', label: 'Opening balance', type: 'number', width: '160px' },
          {
            key: 'credit_availed_during_previous_year',
            label: 'Credit availed during PY',
            type: 'number',
            width: '200px',
          },
          {
            key: 'credit_utilised_during_previous_year',
            label: 'Credit utilised during PY',
            type: 'number',
            width: '200px',
          },
          {
            key: 'closing_or_outstanding_balance',
            label: 'Closing / outstanding balance',
            type: 'number',
            width: '210px',
          },
          {
            key: 'treatment_in_profit_and_loss_account',
            label: 'Treatment in P&L',
            type: 'select',
            options: CLAUSE_27_P_AND_L_TREATMENT_OPTIONS,
            width: '250px',
          },
          {
            key: 'treatment_in_balance_sheet',
            label: 'Treatment in balance sheet',
            type: 'text',
            width: '230px',
          },
          {
            key: 'applicability_view',
            label: 'Applicability view',
            type: 'select',
            options: CLAUSE_27_APPLICABILITY_VIEW_OPTIONS,
            width: '240px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_27b_prior_period_rows',
        label: '27(b) Prior period income or expenditure',
        shortLabel: '27(b)',
        description: 'Prior period income or expenditure credited or debited to the profit and loss account.',
        summaryFields: ['item_type', 'particulars', 'amount'],
        columns: [
          {
            key: 'item_type',
            label: 'Item type',
            type: 'select',
            options: CLAUSE_27_PRIOR_PERIOD_ITEM_TYPE_OPTIONS,
            width: '210px',
          },
          { key: 'particulars', label: 'Particulars', type: 'text', width: '260px' },
          { key: 'amount', label: 'Amount', type: 'number', width: '150px' },
          {
            key: 'prior_period_to_which_it_relates',
            label: 'Prior period to which it relates',
            type: 'text',
            width: '240px',
          },
          {
            key: 'credited_or_debited_to_profit_and_loss',
            label: 'Credited / debited to P&L',
            type: 'select',
            options: CLAUSE_27_PROFIT_AND_LOSS_ROUTING_OPTIONS,
            width: '250px',
          },
          {
            key: 'whether_crystallised_during_current_year',
            label: 'Crystallised during current year',
            type: 'select',
            options: CLAUSE_27_CRYSTALLISED_OPTIONS,
            width: '230px',
          },
          {
            key: 'accounting_standard_reference',
            label: 'Accounting standard reference',
            type: 'text',
            width: '230px',
          },
          {
            key: 'auditor_view',
            label: 'Auditor view',
            type: 'select',
            options: CLAUSE_27_AUDITOR_VIEW_OPTIONS,
            width: '280px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_29a',
    table: {
      key: 'clause_29a_rows',
      label: '29A Amount chargeable under section 56(2)(ix)',
      summaryFields: ['payer_name', 'nature_of_capital_asset', 'amount_chargeable_under_section_56_2_ix'],
      columns: [
        { key: 'payer_name', label: 'Payer name', type: 'text', width: '220px' },
        { key: 'payer_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
        { key: 'nature_of_capital_asset', label: 'Nature of capital asset', type: 'text', width: '220px' },
        { key: 'description_of_capital_asset', label: 'Description of capital asset', type: 'text', width: '240px' },
        { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
        { key: 'amount_received_as_advance', label: 'Advance received', type: 'number', width: '170px' },
        { key: 'amount_forfeited', label: 'Amount forfeited', type: 'number', width: '160px' },
        {
          key: 'whether_negotiations_resulted_in_transfer',
          label: 'Negotiations resulted in transfer',
          type: 'select',
          options: CLAUSE_29_NEGOTIATION_TRANSFER_OPTIONS,
          width: '230px',
        },
        {
          key: 'amount_chargeable_under_section_56_2_ix',
          label: 'Amount chargeable u/s 56(2)(ix)',
          type: 'number',
          width: '220px',
        },
        { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_29b',
    tables: [
      {
        key: 'clause_29b_money_rows',
        label: '29B(a) Money received',
        shortLabel: '29B(a)',
        description: 'Money received without or for inadequate consideration requiring review under section 56(2)(x).',
        summaryFields: ['person_from_whom_received', 'amount_received', 'amount_chargeable_under_section_56_2_x'],
        columns: [
          { key: 'person_from_whom_received', label: 'Person from whom received', type: 'text', width: '230px' },
          { key: 'pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '160px' },
          { key: 'consideration_paid_if_any', label: 'Consideration paid, if any', type: 'number', width: '200px' },
          {
            key: 'amount_chargeable_under_section_56_2_x',
            label: 'Amount chargeable u/s 56(2)(x)',
            type: 'number',
            width: '220px',
          },
          {
            key: 'exception_or_exemption_claimed',
            label: 'Exception / exemption claimed',
            type: 'select',
            options: CLAUSE_29B_EXCEPTION_OPTIONS,
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_29b_immovable_property_rows',
        label: '29B(b) Immovable property received',
        shortLabel: '29B(b)',
        description: 'Immovable property received without or for inadequate consideration requiring review under section 56(2)(x).',
        summaryFields: ['property_description', 'stamp_duty_value', 'difference_or_amount_chargeable'],
        columns: [
          { key: 'property_description', label: 'Property description', type: 'text', width: '230px' },
          { key: 'property_address', label: 'Property address', type: 'text', width: '250px' },
          { key: 'date_of_receipt_or_registration', label: 'Receipt / registration date', type: 'date', width: '190px' },
          { key: 'stamp_duty_value', label: 'Stamp duty value', type: 'number', width: '170px' },
          { key: 'consideration_paid', label: 'Consideration paid', type: 'number', width: '170px' },
          { key: 'difference_or_amount_chargeable', label: 'Difference / amount chargeable', type: 'number', width: '220px' },
          { key: 'valuation_reference', label: 'Valuation reference', type: 'text', width: '220px' },
          {
            key: 'exception_or_exemption_claimed',
            label: 'Exception / exemption claimed',
            type: 'select',
            options: CLAUSE_29B_EXCEPTION_OPTIONS,
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_29b_other_property_rows',
        label: '29B(c) Other specified property received',
        shortLabel: '29B(c)',
        description: 'Specified movable property received without or for inadequate consideration requiring review under section 56(2)(x).',
        summaryFields: ['property_type', 'property_description', 'difference_or_amount_chargeable'],
        columns: [
          {
            key: 'property_type',
            label: 'Property type',
            type: 'select',
            options: CLAUSE_29B_PROPERTY_TYPE_OPTIONS,
            width: '220px',
          },
          { key: 'property_description', label: 'Property description', type: 'text', width: '250px' },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
          { key: 'fair_market_value', label: 'Fair market value', type: 'number', width: '170px' },
          { key: 'consideration_paid', label: 'Consideration paid', type: 'number', width: '170px' },
          { key: 'difference_or_amount_chargeable', label: 'Difference / amount chargeable', type: 'number', width: '220px' },
          { key: 'valuation_reference', label: 'Valuation reference', type: 'text', width: '220px' },
          {
            key: 'exception_or_exemption_claimed',
            label: 'Exception / exemption claimed',
            type: 'select',
            options: CLAUSE_29B_EXCEPTION_OPTIONS,
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_30',
    table: {
      key: 'clause_30_hundi_rows',
      label: '30 Hundi borrowings and repayments under section 69D',
      summaryFields: ['transaction_type', 'name_of_lender_or_payee', 'amount_repaid'],
      columns: [
        {
          key: 'transaction_type',
          label: 'Transaction type',
          type: 'select',
          options: CLAUSE_30_TRANSACTION_TYPE_OPTIONS,
          width: '220px',
        },
        { key: 'name_of_lender_or_payee', label: 'Lender / payee name', type: 'text', width: '220px' },
        { key: 'pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
        { key: 'address', label: 'Address', type: 'text', width: '240px' },
        { key: 'date_of_borrowing_or_repayment', label: 'Borrowing / repayment date', type: 'date', width: '190px' },
        { key: 'amount_borrowed', label: 'Amount borrowed', type: 'number', width: '160px' },
        { key: 'amount_repaid', label: 'Amount repaid', type: 'number', width: '160px' },
        { key: 'interest_amount', label: 'Interest amount', type: 'number', width: '150px' },
        {
          key: 'mode_of_payment_or_repayment',
          label: 'Mode of payment / repayment',
          type: 'select',
          options: CLAUSE_30_PAYMENT_MODE_OPTIONS,
          width: '230px',
        },
        {
          key: 'whether_otherwise_than_account_payee_cheque',
          label: 'Otherwise than account payee cheque',
          type: 'select',
          options: CLAUSE_30_ACCOUNT_PAYEE_CHECK_OPTIONS,
          width: '250px',
        },
        { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_30a',
    table: {
      key: 'clause_30a_primary_adjustment_rows',
      label: '30A Primary adjustment to transfer price under section 92CE',
      summaryFields: ['associated_enterprise_name', 'nature_of_international_transaction', 'amount_of_primary_adjustment'],
      columns: [
        { key: 'associated_enterprise_name', label: 'Associated enterprise name', type: 'text', width: '230px' },
        { key: 'associated_enterprise_country', label: 'Associated enterprise country', type: 'text', width: '220px' },
        {
          key: 'nature_of_international_transaction',
          label: 'Nature of international transaction',
          type: 'text',
          width: '260px',
        },
        {
          key: 'basis_of_primary_adjustment',
          label: 'Basis of primary adjustment',
          type: 'select',
          options: CLAUSE_30A_PRIMARY_ADJUSTMENT_BASIS_OPTIONS,
          width: '260px',
        },
        { key: 'amount_of_primary_adjustment', label: 'Amount of primary adjustment', type: 'number', width: '210px' },
        {
          key: 'whether_excess_money_available_with_associated_enterprise',
          label: 'Excess money available with associated enterprise',
          type: 'select',
          options: CLAUSE_30A_YES_NO_REVIEW_OPTIONS,
          width: '280px',
        },
        {
          key: 'whether_repatriation_required',
          label: 'Repatriation required',
          type: 'select',
          options: CLAUSE_30A_YES_NO_REVIEW_OPTIONS,
          width: '190px',
        },
        { key: 'prescribed_repatriation_due_date', label: 'Prescribed repatriation due date', type: 'date', width: '220px' },
        { key: 'amount_repatriated', label: 'Amount repatriated', type: 'number', width: '170px' },
        { key: 'date_of_repatriation', label: 'Date of repatriation', type: 'date', width: '170px' },
        { key: 'balance_not_repatriated', label: 'Balance not repatriated', type: 'number', width: '190px' },
        { key: 'imputed_interest_income', label: 'Imputed interest income', type: 'number', width: '180px' },
        { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_30b',
    tables: [
      {
        key: 'clause_30b_interest_rows',
        label: '30B(a) Interest / similar expenditure details',
        shortLabel: '30B(a)',
        description: 'Interest or similar expenditure details relevant for review under section 94B.',
        summaryFields: ['lender_name', 'nature_of_debt', 'amount_of_interest_or_similar_expenditure'],
        columns: [
          { key: 'lender_name', label: 'Lender name', type: 'text', width: '220px' },
          { key: 'lender_country', label: 'Lender country', type: 'text', width: '180px' },
          {
            key: 'whether_lender_is_associated_enterprise',
            label: 'Lender is associated enterprise',
            type: 'select',
            options: CLAUSE_30A_YES_NO_REVIEW_OPTIONS,
            width: '220px',
          },
          {
            key: 'whether_debt_deemed_issued_by_associated_enterprise',
            label: 'Debt deemed issued by associated enterprise',
            type: 'select',
            options: CLAUSE_30A_YES_NO_REVIEW_OPTIONS,
            width: '270px',
          },
          {
            key: 'nature_of_debt',
            label: 'Nature of debt',
            type: 'select',
            options: CLAUSE_30B_NATURE_OF_DEBT_OPTIONS,
            width: '250px',
          },
          {
            key: 'nature_of_interest_or_similar_expenditure',
            label: 'Nature of interest / similar expenditure',
            type: 'text',
            width: '260px',
          },
          {
            key: 'amount_of_interest_or_similar_expenditure',
            label: 'Interest / similar expenditure amount',
            type: 'number',
            width: '230px',
          },
          {
            key: 'guarantee_or_matching_deposit_details',
            label: 'Guarantee / matching deposit details',
            type: 'text',
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_30b_summary_rows',
        label: '30B(b) Computation summary',
        shortLabel: '30B(b)',
        description: 'Manual summary inputs used to review the section 94B limitation without automatic computation.',
        summaryFields: ['aggregate_interest_or_similar_expenditure', 'excess_interest_expenditure', 'interest_disallowed_current_year'],
        columns: [
          {
            key: 'aggregate_interest_or_similar_expenditure',
            label: 'Aggregate interest / similar expenditure',
            type: 'number',
            width: '230px',
          },
          {
            key: 'threshold_of_one_crore_exceeded',
            label: 'Threshold of one crore exceeded',
            type: 'select',
            options: CLAUSE_30A_YES_NO_REVIEW_OPTIONS,
            width: '220px',
          },
          { key: 'ebitda_for_previous_year', label: 'EBITDA for previous year', type: 'number', width: '180px' },
          { key: 'thirty_percent_of_ebitda', label: '30% of EBITDA', type: 'number', width: '170px' },
          { key: 'excess_interest_expenditure', label: 'Excess interest expenditure', type: 'number', width: '190px' },
          { key: 'interest_disallowed_current_year', label: 'Interest disallowed current year', type: 'number', width: '210px' },
          {
            key: 'interest_brought_forward_from_earlier_years',
            label: 'Interest brought forward',
            type: 'number',
            width: '190px',
          },
          {
            key: 'interest_carried_forward_to_subsequent_years',
            label: 'Interest carried forward',
            type: 'number',
            width: '190px',
          },
          { key: 'basis_of_computation', label: 'Basis of computation', type: 'text', width: '230px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_30c',
    table: {
      key: 'clause_30c_arrangement_rows',
      label: '30C Impermissible avoidance arrangement under section 96',
      summaryFields: ['arrangement_name_or_reference', 'whether_impermissible_avoidance_arrangement_identified', 'amount_of_tax_benefit'],
      columns: [
        { key: 'arrangement_name_or_reference', label: 'Arrangement name / reference', type: 'text', width: '250px' },
        { key: 'parties_involved', label: 'Parties involved', type: 'text', width: '240px' },
        { key: 'nature_of_arrangement', label: 'Nature of arrangement', type: 'text', width: '240px' },
        {
          key: 'whether_impermissible_avoidance_arrangement_identified',
          label: 'Impermissible avoidance arrangement identified',
          type: 'select',
          options: CLAUSE_30A_YES_NO_REVIEW_OPTIONS,
          width: '290px',
        },
        {
          key: 'section_96_condition',
          label: 'Section 96 condition',
          type: 'select',
          options: CLAUSE_30C_SECTION_96_CONDITION_OPTIONS,
          width: '320px',
        },
        { key: 'amount_of_tax_benefit', label: 'Amount of tax benefit', type: 'number', width: '170px' },
        {
          key: 'reporting_basis',
          label: 'Reporting basis',
          type: 'select',
          options: CLAUSE_30C_REPORTING_BASIS_OPTIONS,
          width: '200px',
        },
        { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_31',
    tables: [
      {
        key: 'clause_31a_loan_deposit_rows',
        label: '31(a) Loans or deposits accepted',
        shortLabel: '31(a)',
        description: 'Loans or deposits taken or accepted during the previous year for manual review under section 269SS.',
        summaryFields: ['lender_or_depositor_name', 'transaction_type', 'amount_of_loan_or_deposit'],
        columns: [
          { key: 'lender_or_depositor_name', label: 'Lender / depositor name', type: 'text', width: '230px' },
          { key: 'address', label: 'Address', type: 'text', width: '240px' },
          { key: 'pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          {
            key: 'transaction_type',
            label: 'Transaction type',
            type: 'select',
            options: CLAUSE_31_TRANSACTION_TYPE_OPTIONS,
            width: '170px',
          },
          { key: 'amount_of_loan_or_deposit', label: 'Amount of loan / deposit', type: 'number', width: '190px' },
          { key: 'date_of_acceptance', label: 'Date of acceptance', type: 'date', width: '160px' },
          {
            key: 'whether_squared_up_during_year',
            label: 'Squared up during year',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '180px',
          },
          {
            key: 'maximum_amount_outstanding_during_year',
            label: 'Maximum outstanding during year',
            type: 'number',
            width: '210px',
          },
          {
            key: 'amount_outstanding_on_date_of_acceptance',
            label: 'Outstanding on date of acceptance',
            type: 'number',
            width: '220px',
          },
          {
            key: 'mode_of_acceptance',
            label: 'Mode of acceptance',
            type: 'select',
            options: CLAUSE_31_MODE_OF_ACCEPTANCE_OPTIONS,
            width: '260px',
          },
          {
            key: 'whether_account_payee_or_prescribed_mode',
            label: 'Account payee / prescribed mode',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '220px',
          },
          {
            key: 'whether_269ss_threshold_crossed',
            label: '269SS threshold crossed',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '190px',
          },
          {
            key: 'exemption_or_review_status',
            label: 'Exemption / review status',
            type: 'select',
            options: CLAUSE_31_EXEMPTION_OR_REVIEW_STATUS_OPTIONS,
            width: '220px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31b_specified_sum_rows',
        label: '31(b) Specified sums accepted',
        shortLabel: '31(b)',
        description: 'Specified sums taken or accepted during the previous year in relation to transfer of immovable property.',
        summaryFields: ['payer_name', 'nature_of_specified_sum', 'amount_of_specified_sum'],
        columns: [
          { key: 'payer_name', label: 'Payer name', type: 'text', width: '220px' },
          { key: 'address', label: 'Address', type: 'text', width: '240px' },
          { key: 'pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          { key: 'property_description', label: 'Property description', type: 'text', width: '240px' },
          {
            key: 'nature_of_specified_sum',
            label: 'Nature of specified sum',
            type: 'select',
            options: CLAUSE_31_SPECIFIED_SUM_NATURE_OPTIONS,
            width: '250px',
          },
          { key: 'amount_of_specified_sum', label: 'Amount of specified sum', type: 'number', width: '190px' },
          { key: 'date_of_acceptance', label: 'Date of acceptance', type: 'date', width: '160px' },
          {
            key: 'whether_transaction_resulted_in_transfer',
            label: 'Transaction resulted in transfer',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '220px',
          },
          {
            key: 'mode_of_acceptance',
            label: 'Mode of acceptance',
            type: 'select',
            options: CLAUSE_31_MODE_OF_ACCEPTANCE_OPTIONS,
            width: '260px',
          },
          {
            key: 'whether_account_payee_or_prescribed_mode',
            label: 'Account payee / prescribed mode',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '220px',
          },
          {
            key: 'whether_269ss_threshold_crossed',
            label: '269SS threshold crossed',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '190px',
          },
          {
            key: 'exemption_or_review_status',
            label: 'Exemption / review status',
            type: 'select',
            options: CLAUSE_31_EXEMPTION_OR_REVIEW_STATUS_OPTIONS,
            width: '220px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31ba_receipt_other_than_permitted_mode_rows',
        label: '31(ba) Receipts otherwise than permitted modes',
        shortLabel: '31(ba)',
        description: 'Receipts of 2 lakh or more otherwise than by permitted banking modes for manual review under section 269ST.',
        summaryFields: ['payer_name', 'reporting_trigger', 'amount_received'],
        columns: [
          { key: 'payer_name', label: 'Payer name', type: 'text', width: '220px' },
          { key: 'payer_address', label: 'Payer address', type: 'text', width: '230px' },
          { key: 'payer_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          { key: 'nature_of_transaction', label: 'Nature of transaction', type: 'text', width: '230px' },
          {
            key: 'reporting_trigger',
            label: 'Reporting trigger',
            type: 'select',
            options: CLAUSE_31BA_RECEIPT_TRIGGER_OPTIONS,
            width: '230px',
          },
          { key: 'transaction_or_event_reference', label: 'Transaction / event reference', type: 'text', width: '230px' },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '170px' },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
          {
            key: 'mode_of_receipt',
            label: 'Mode of receipt',
            type: 'select',
            options: CLAUSE_31_269ST_NON_PERMITTED_MODE_OPTIONS,
            width: '220px',
          },
          {
            key: 'whether_permitted_mode',
            label: 'Permitted mode',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '170px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31bb_receipt_non_account_payee_rows',
        label: '31(bb) Receipts by non-account payee cheque/draft',
        shortLabel: '31(bb)',
        description: 'Receipts of 2 lakh or more by cheque or bank draft not being account payee instruments.',
        summaryFields: ['payer_name', 'reporting_trigger', 'amount_received'],
        columns: [
          { key: 'payer_name', label: 'Payer name', type: 'text', width: '220px' },
          { key: 'payer_address', label: 'Payer address', type: 'text', width: '230px' },
          { key: 'payer_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          {
            key: 'reporting_trigger',
            label: 'Reporting trigger',
            type: 'select',
            options: CLAUSE_31BA_RECEIPT_TRIGGER_OPTIONS,
            width: '230px',
          },
          { key: 'transaction_or_event_reference', label: 'Transaction / event reference', type: 'text', width: '230px' },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '170px' },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
          {
            key: 'instrument_type',
            label: 'Instrument type',
            type: 'select',
            options: CLAUSE_31_INSTRUMENT_TYPE_OPTIONS,
            width: '160px',
          },
          { key: 'instrument_number', label: 'Instrument number', type: 'text', width: '180px' },
          {
            key: 'whether_account_payee',
            label: 'Account payee',
            type: 'select',
            options: CLAUSE_31_269ST_ACCOUNT_PAYEE_OPTIONS,
            width: '170px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31bc_payment_other_than_permitted_mode_rows',
        label: '31(bc) Payments otherwise than permitted modes',
        shortLabel: '31(bc)',
        description: 'Payments of 2 lakh or more otherwise than by permitted banking modes for manual review under section 269ST.',
        summaryFields: ['payee_name', 'reporting_trigger', 'amount_paid'],
        columns: [
          { key: 'payee_name', label: 'Payee name', type: 'text', width: '220px' },
          { key: 'payee_address', label: 'Payee address', type: 'text', width: '230px' },
          { key: 'payee_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          { key: 'nature_of_transaction', label: 'Nature of transaction', type: 'text', width: '230px' },
          {
            key: 'reporting_trigger',
            label: 'Reporting trigger',
            type: 'select',
            options: CLAUSE_31BC_PAYMENT_TRIGGER_OPTIONS,
            width: '230px',
          },
          { key: 'transaction_or_event_reference', label: 'Transaction / event reference', type: 'text', width: '230px' },
          { key: 'amount_paid', label: 'Amount paid', type: 'number', width: '170px' },
          { key: 'date_of_payment', label: 'Date of payment', type: 'date', width: '160px' },
          {
            key: 'mode_of_payment',
            label: 'Mode of payment',
            type: 'select',
            options: CLAUSE_31_269ST_NON_PERMITTED_MODE_OPTIONS,
            width: '220px',
          },
          {
            key: 'whether_permitted_mode',
            label: 'Permitted mode',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '170px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31bd_payment_non_account_payee_rows',
        label: '31(bd) Payments by non-account payee cheque/draft',
        shortLabel: '31(bd)',
        description: 'Payments of 2 lakh or more by cheque or bank draft not being account payee instruments.',
        summaryFields: ['payee_name', 'reporting_trigger', 'amount_paid'],
        columns: [
          { key: 'payee_name', label: 'Payee name', type: 'text', width: '220px' },
          { key: 'payee_address', label: 'Payee address', type: 'text', width: '230px' },
          { key: 'payee_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          {
            key: 'reporting_trigger',
            label: 'Reporting trigger',
            type: 'select',
            options: CLAUSE_31BC_PAYMENT_TRIGGER_OPTIONS,
            width: '230px',
          },
          { key: 'transaction_or_event_reference', label: 'Transaction / event reference', type: 'text', width: '230px' },
          { key: 'amount_paid', label: 'Amount paid', type: 'number', width: '170px' },
          { key: 'date_of_payment', label: 'Date of payment', type: 'date', width: '160px' },
          {
            key: 'instrument_type',
            label: 'Instrument type',
            type: 'select',
            options: CLAUSE_31_INSTRUMENT_TYPE_OPTIONS,
            width: '160px',
          },
          { key: 'instrument_number', label: 'Instrument number', type: 'text', width: '180px' },
          {
            key: 'whether_account_payee',
            label: 'Account payee',
            type: 'select',
            options: CLAUSE_31_269ST_ACCOUNT_PAYEE_OPTIONS,
            width: '170px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31c_repayment_made_rows',
        label: '31(c) Repayments made',
        shortLabel: '31(c)',
        description: 'Repayment of loan, deposit or specified advance made during the previous year for manual review under section 269T.',
        summaryFields: ['payee_name', 'transaction_type', 'amount_of_repayment'],
        columns: [
          { key: 'payee_name', label: 'Payee name', type: 'text', width: '220px' },
          { key: 'payee_address', label: 'Payee address', type: 'text', width: '230px' },
          { key: 'payee_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          {
            key: 'nature_of_amount_code',
            label: 'Nature code',
            type: 'select',
            options: CLAUSE_31_NATURE_OF_AMOUNT_CODE_OPTIONS,
            width: '250px',
          },
          {
            key: 'transaction_type',
            label: 'Transaction type',
            type: 'select',
            options: CLAUSE_31C_TRANSACTION_TYPE_OPTIONS,
            width: '220px',
          },
          { key: 'amount_of_repayment', label: 'Amount of repayment', type: 'number', width: '180px' },
          { key: 'date_of_repayment', label: 'Date of repayment', type: 'date', width: '160px' },
          {
            key: 'maximum_amount_outstanding_during_year',
            label: 'Maximum outstanding during year',
            type: 'number',
            width: '210px',
          },
          {
            key: 'mode_of_repayment',
            label: 'Mode of repayment',
            type: 'select',
            options: [
              { label: 'Account payee cheque', value: 'Account payee cheque' },
              { label: 'Account payee bank draft', value: 'Account payee bank draft' },
              { label: 'Electronic clearing system through bank account', value: 'Electronic clearing system through bank account' },
              { label: 'Other prescribed electronic mode', value: 'Other prescribed electronic mode' },
              { label: 'Cash', value: 'Cash' },
              { label: 'Bearer cheque', value: 'Bearer cheque' },
              { label: 'Non-account payee cheque', value: 'Non-account payee cheque' },
              { label: 'Non-account payee bank draft', value: 'Non-account payee bank draft' },
              { label: 'Journal entry', value: 'Journal entry' },
              { label: 'Transfer of asset', value: 'Transfer of asset' },
              { label: 'Conversion of liability', value: 'Conversion of liability' },
              { label: 'Other', value: 'Other' },
            ],
            width: '260px',
          },
          {
            key: 'whether_repayment_by_cheque_bank_draft_or_ecs',
            label: 'Repayment by cheque / draft / ECS',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '240px',
          },
          {
            key: 'whether_account_payee_if_cheque_or_draft',
            label: 'Account payee if cheque / draft',
            type: 'select',
            options: CLAUSE_31_269ST_ACCOUNT_PAYEE_OPTIONS,
            width: '230px',
          },
          {
            key: 'exception_or_excluded_counterparty_status',
            label: 'Exception / excluded counterparty',
            type: 'select',
            options: CLAUSE_31_EXCEPTION_OR_EXCLUDED_COUNTERPARTY_OPTIONS,
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31d_repayment_received_other_than_permitted_mode_rows',
        label: '31(d) Repayments received otherwise than permitted modes',
        shortLabel: '31(d)',
        description: 'Repayment of loan, deposit or specified advance received otherwise than by permitted banking modes.',
        summaryFields: ['payer_name', 'transaction_type', 'amount_received'],
        columns: [
          { key: 'payer_name', label: 'Payer name', type: 'text', width: '220px' },
          { key: 'payer_address', label: 'Payer address', type: 'text', width: '230px' },
          { key: 'payer_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          {
            key: 'nature_of_amount_code',
            label: 'Nature code',
            type: 'select',
            options: CLAUSE_31_NATURE_OF_AMOUNT_CODE_OPTIONS,
            width: '250px',
          },
          {
            key: 'transaction_type',
            label: 'Transaction type',
            type: 'select',
            options: CLAUSE_31D_TRANSACTION_TYPE_OPTIONS,
            width: '240px',
          },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '170px' },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
          {
            key: 'mode_of_receipt',
            label: 'Mode of receipt',
            type: 'select',
            options: [
              { label: 'Cash', value: 'Cash' },
              { label: 'Bearer cheque', value: 'Bearer cheque' },
              { label: 'Non-account payee cheque', value: 'Non-account payee cheque' },
              { label: 'Non-account payee bank draft', value: 'Non-account payee bank draft' },
              { label: 'Journal entry', value: 'Journal entry' },
              { label: 'Transfer of asset', value: 'Transfer of asset' },
              { label: 'Conversion of liability', value: 'Conversion of liability' },
              { label: 'Other non-banking mode', value: 'Other non-banking mode' },
              { label: 'Other', value: 'Other' },
              { label: 'To be reviewed', value: 'To be reviewed' },
            ],
            width: '240px',
          },
          {
            key: 'maximum_amount_outstanding_during_year',
            label: 'Maximum outstanding during year',
            type: 'number',
            width: '210px',
          },
          {
            key: 'exception_or_excluded_counterparty_status',
            label: 'Exception / excluded counterparty',
            type: 'select',
            options: CLAUSE_31_EXCEPTION_OR_EXCLUDED_COUNTERPARTY_OPTIONS,
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_31e_repayment_received_non_account_payee_rows',
        label: '31(e) Repayments received by non-account payee cheque/draft',
        shortLabel: '31(e)',
        description: 'Repayment of loan, deposit or specified advance received by cheque or bank draft not being account payee.',
        summaryFields: ['payer_name', 'transaction_type', 'amount_received'],
        columns: [
          { key: 'payer_name', label: 'Payer name', type: 'text', width: '220px' },
          { key: 'payer_address', label: 'Payer address', type: 'text', width: '230px' },
          { key: 'payer_pan_or_aadhaar', label: 'PAN / Aadhaar', type: 'text', width: '170px' },
          {
            key: 'nature_of_amount_code',
            label: 'Nature code',
            type: 'select',
            options: CLAUSE_31_NATURE_OF_AMOUNT_CODE_OPTIONS,
            width: '250px',
          },
          {
            key: 'transaction_type',
            label: 'Transaction type',
            type: 'select',
            options: CLAUSE_31D_TRANSACTION_TYPE_OPTIONS,
            width: '240px',
          },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '170px' },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '160px' },
          {
            key: 'instrument_type',
            label: 'Instrument type',
            type: 'select',
            options: CLAUSE_31_INSTRUMENT_TYPE_OPTIONS,
            width: '160px',
          },
          { key: 'instrument_number', label: 'Instrument number', type: 'text', width: '180px' },
          {
            key: 'whether_account_payee',
            label: 'Account payee',
            type: 'select',
            options: CLAUSE_31_269ST_ACCOUNT_PAYEE_OPTIONS,
            width: '170px',
          },
          {
            key: 'maximum_amount_outstanding_during_year',
            label: 'Maximum outstanding during year',
            type: 'number',
            width: '210px',
          },
          {
            key: 'exception_or_excluded_counterparty_status',
            label: 'Exception / excluded counterparty',
            type: 'select',
            options: CLAUSE_31_EXCEPTION_OR_EXCLUDED_COUNTERPARTY_OPTIONS,
            width: '260px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_32',
    tables: [
      {
        key: 'clause_32a_loss_depreciation_rows',
        label: '32(a) Brought forward loss / depreciation',
        shortLabel: '32(a)',
        description: 'Brought forward loss or depreciation allowance details captured for manual review and reporting.',
        summaryFields: ['assessment_year', 'nature_of_loss_or_allowance', 'amount_available_for_carry_forward_or_setoff'],
        columns: [
          { key: 'assessment_year', label: 'Assessment year', type: 'text', width: '150px' },
          {
            key: 'nature_of_loss_or_allowance',
            label: 'Nature of loss / allowance',
            type: 'select',
            options: CLAUSE_32_LOSS_OR_ALLOWANCE_OPTIONS,
            width: '280px',
          },
          { key: 'amount_as_returned', label: 'Amount as returned', type: 'number', width: '170px' },
          {
            key: 'amount_not_allowed_under_115baa_115bac_115bad_115bae',
            label: 'Amount not allowed under 115BAA/115BAC/115BAD/115BAE',
            type: 'number',
            width: '310px',
          },
          {
            key: 'amount_adjusted_by_withdrawal_of_additional_depreciation',
            label: 'Amount adjusted by withdrawal of additional depreciation',
            type: 'number',
            width: '290px',
          },
          { key: 'amount_as_assessed', label: 'Amount as assessed', type: 'number', width: '170px' },
          { key: 'reference_to_relevant_order', label: 'Reference to relevant order', type: 'text', width: '220px' },
          {
            key: 'amount_available_for_carry_forward_or_setoff',
            label: 'Available for carry forward / set-off',
            type: 'number',
            width: '240px',
          },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_32b_shareholding_change_rows',
        label: '32(b) Section 79 shareholding change',
        shortLabel: '32(b)',
        description: 'Change in shareholding affecting carry forward of losses under section 79.',
        summaryFields: ['whether_change_in_shareholding_during_previous_year', 'percentage_change', 'section_79_view'],
        columns: [
          {
            key: 'whether_company',
            label: 'Whether company',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '150px',
          },
          {
            key: 'whether_change_in_shareholding_during_previous_year',
            label: 'Change in shareholding during previous year',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '260px',
          },
          { key: 'date_or_period_of_change', label: 'Date / period of change', type: 'text', width: '200px' },
          { key: 'nature_of_shareholding_change', label: 'Nature of shareholding change', type: 'text', width: '240px' },
          { key: 'percentage_change', label: 'Percentage change', type: 'number', width: '150px' },
          { key: 'loss_affected', label: 'Loss affected', type: 'text', width: '200px' },
          { key: 'assessment_year_to_which_loss_relates', label: 'Assessment year to which loss relates', type: 'text', width: '230px' },
          {
            key: 'section_79_view',
            label: 'Section 79 view',
            type: 'select',
            options: CLAUSE_32_SECTION_79_VIEW_OPTIONS,
            width: '210px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_32c_speculation_loss_rows',
        label: '32(c) Speculation loss',
        shortLabel: '32(c)',
        description: 'Speculation loss referred to in section 73 captured for manual review.',
        summaryFields: ['nature_of_speculation_business', 'amount_of_speculation_loss', 'amount_carried_forward'],
        columns: [
          { key: 'nature_of_speculation_business', label: 'Nature of speculation business', type: 'text', width: '240px' },
          { key: 'amount_of_speculation_loss', label: 'Amount of speculation loss', type: 'number', width: '190px' },
          { key: 'assessment_year_or_previous_year', label: 'Assessment year / previous year', type: 'text', width: '220px' },
          {
            key: 'whether_loss_incurred_during_previous_year',
            label: 'Loss incurred during previous year',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '220px',
          },
          { key: 'amount_carried_forward', label: 'Amount carried forward', type: 'number', width: '180px' },
          { key: 'basis_of_identification', label: 'Basis of identification', type: 'text', width: '220px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_32d_specified_business_loss_rows',
        label: '32(d) Specified business loss',
        shortLabel: '32(d)',
        description: 'Loss referred to in section 73A in respect of specified business captured for manual review.',
        summaryFields: ['specified_business_description', 'amount_of_specified_business_loss', 'amount_carried_forward'],
        columns: [
          { key: 'specified_business_description', label: 'Specified business description', type: 'text', width: '240px' },
          { key: 'section_35ad_reference_or_business_type', label: 'Section 35AD reference / business type', type: 'text', width: '260px' },
          { key: 'amount_of_specified_business_loss', label: 'Amount of specified business loss', type: 'number', width: '220px' },
          { key: 'assessment_year_or_previous_year', label: 'Assessment year / previous year', type: 'text', width: '220px' },
          { key: 'amount_carried_forward', label: 'Amount carried forward', type: 'number', width: '180px' },
          { key: 'basis_of_identification', label: 'Basis of identification', type: 'text', width: '220px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
      {
        key: 'clause_32e_deemed_speculation_rows',
        label: '32(e) Deemed speculation business',
        shortLabel: '32(e)',
        description: 'Deemed speculation business under Explanation to section 73, where applicable to a company.',
        summaryFields: ['whether_company', 'whether_deemed_speculation_business', 'amount_of_speculation_loss_if_any'],
        columns: [
          {
            key: 'whether_company',
            label: 'Whether company',
            type: 'select',
            options: CLAUSE_31_YES_NO_REVIEW_OPTIONS,
            width: '150px',
          },
          {
            key: 'whether_deemed_speculation_business',
            label: 'Deemed speculation business',
            type: 'select',
            options: CLAUSE_32_YES_NO_REVIEW_NOT_APPLICABLE_OPTIONS,
            width: '220px',
          },
          { key: 'nature_of_business', label: 'Nature of business', type: 'text', width: '220px' },
          { key: 'basis_for_deemed_speculation_view', label: 'Basis for deemed speculation view', type: 'text', width: '240px' },
          { key: 'amount_of_speculation_loss_if_any', label: 'Amount of speculation loss, if any', type: 'number', width: '220px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
          { key: 'remarks', label: 'Remarks', type: 'text' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_33',
    table: {
      key: 'clause_33_deduction_rows',
      label: '33 Section-wise deduction details',
      summaryFields: ['section', 'amount_claimed_by_assessee', 'amount_admissible_as_per_act'],
      columns: [
        {
          key: 'section',
          label: 'Section',
          type: 'select',
          options: CLAUSE_33_SECTION_OPTIONS,
          width: '160px',
        },
        {
          key: 'deduction_category',
          label: 'Deduction category',
          type: 'select',
          options: CLAUSE_33_DEDUCTION_CATEGORY_OPTIONS,
          width: '220px',
        },
        { key: 'description', label: 'Description', type: 'text', width: '230px' },
        { key: 'amount_claimed_by_assessee', label: 'Amount claimed by assessee', type: 'number', width: '210px' },
        { key: 'amount_admissible_as_per_act', label: 'Amount admissible as per Act', type: 'number', width: '210px' },
        {
          key: 'conditions_fulfilled',
          label: 'Conditions fulfilled',
          type: 'select',
          options: CLAUSE_33_CONDITIONS_OPTIONS,
          width: '170px',
        },
        { key: 'basis_of_admissibility', label: 'Basis of admissibility', type: 'text', width: '220px' },
        {
          key: 'whether_restricted_under_special_tax_regime',
          label: 'Restricted under special tax regime',
          type: 'select',
          options: CLAUSE_32_YES_NO_REVIEW_NOT_APPLICABLE_OPTIONS,
          width: '240px',
        },
        { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '200px' },
        { key: 'remarks', label: 'Remarks', type: 'text' },
      ],
    },
  },
  {
    clauseKey: 'clause_34',
    tables: [
      {
        key: 'clause_34a_tds_tcs_summary_rows',
        label: '34(a) TDS/TCS deduction and collection summary',
        shortLabel: '34(a)',
        description: 'TAN-wise and section-wise manual summary of TDS or TCS where tax was required to be deducted or collected at source.',
        summaryFields: ['tan', 'section', 'amount_on_which_tax_required_to_be_deducted_or_collected'],
        columns: [
          { key: 'tan', label: 'TAN', type: 'text', width: '150px' },
          {
            key: 'tds_or_tcs',
            label: 'TDS / TCS',
            type: 'select',
            options: CLAUSE_34_TDS_OR_TCS_OPTIONS,
            width: '150px',
          },
          {
            key: 'section',
            label: 'Section',
            type: 'select',
            options: CLAUSE_34_SECTION_OPTIONS,
            width: '170px',
          },
          {
            key: 'nature_of_payment_or_receipt',
            label: 'Nature of payment / receipt',
            type: 'text',
            width: '260px',
          },
          {
            key: 'total_amount_of_payment_or_receipt',
            label: 'Total amount of payment / receipt',
            type: 'number',
            width: '210px',
          },
          {
            key: 'amount_on_which_tax_required_to_be_deducted_or_collected',
            label: 'Amount on which tax required to be deducted / collected',
            type: 'number',
            width: '280px',
          },
          { key: 'specified_rate', label: 'Specified rate', type: 'text', width: '150px' },
          {
            key: 'amount_on_which_tax_deducted_or_collected_at_specified_rate',
            label: 'Amount on which tax deducted / collected at specified rate',
            type: 'number',
            width: '290px',
          },
          {
            key: 'tax_deducted_or_collected_at_specified_rate',
            label: 'Tax deducted / collected at specified rate',
            type: 'number',
            width: '250px',
          },
          {
            key: 'amount_on_which_tax_deducted_or_collected_at_lower_or_nil_rate',
            label: 'Amount on which tax deducted / collected at lower or nil rate',
            type: 'number',
            width: '300px',
          },
          {
            key: 'tax_deducted_or_collected_at_lower_or_nil_rate',
            label: 'Tax deducted / collected at lower or nil rate',
            type: 'number',
            width: '260px',
          },
          {
            key: 'lower_or_nil_rate_basis',
            label: 'Lower or nil rate basis',
            type: 'select',
            options: CLAUSE_34_LOWER_OR_NIL_RATE_BASIS_OPTIONS,
            width: '240px',
          },
          {
            key: 'amount_on_which_tax_not_deducted_or_collected',
            label: 'Amount on which tax not deducted / collected',
            type: 'number',
            width: '260px',
          },
          {
            key: 'tax_not_deducted_or_collected',
            label: 'Tax not deducted / collected',
            type: 'number',
            width: '220px',
          },
          {
            key: 'amount_on_which_tax_deducted_or_collected_but_not_deposited',
            label: 'Amount on which tax deducted / collected but not deposited',
            type: 'number',
            width: '310px',
          },
          {
            key: 'tax_deducted_or_collected_but_not_deposited',
            label: 'Tax deducted / collected but not deposited',
            type: 'number',
            width: '270px',
          },
          { key: 'reason_or_review_note', label: 'Reason or review note', type: 'text', width: '240px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
      {
        key: 'clause_34b_statement_rows',
        label: '34(b) TDS/TCS statement filing details',
        shortLabel: '34(b)',
        description: 'Manual capture of TDS or TCS statement filing details for the relevant form and period.',
        summaryFields: ['tan', 'type_of_form', 'quarter_or_period'],
        columns: [
          { key: 'tan', label: 'TAN', type: 'text', width: '150px' },
          {
            key: 'tds_or_tcs',
            label: 'TDS / TCS',
            type: 'select',
            options: CLAUSE_34_TDS_OR_TCS_OPTIONS,
            width: '150px',
          },
          {
            key: 'type_of_form',
            label: 'Type of form',
            type: 'select',
            options: CLAUSE_34_TYPE_OF_FORM_OPTIONS,
            width: '180px',
          },
          {
            key: 'quarter_or_period',
            label: 'Quarter / period',
            type: 'select',
            options: CLAUSE_34_QUARTER_OR_PERIOD_OPTIONS,
            width: '170px',
          },
          {
            key: 'due_date_for_furnishing',
            label: 'Due date for furnishing',
            type: 'date',
            width: '180px',
          },
          {
            key: 'date_of_furnishing',
            label: 'Date of furnishing',
            type: 'date',
            width: '170px',
          },
          {
            key: 'acknowledgment_number_or_token',
            label: 'Acknowledgment number / token',
            type: 'text',
            width: '220px',
          },
          {
            key: 'whether_statement_furnished',
            label: 'Whether statement furnished',
            type: 'select',
            options: CLAUSE_34_STATEMENT_FURNISHED_OPTIONS,
            width: '210px',
          },
          {
            key: 'whether_statement_contains_all_required_transactions',
            label: 'Contains all required transactions',
            type: 'select',
            options: CLAUSE_34_TRANSACTIONS_REPORTED_OPTIONS,
            width: '250px',
          },
          {
            key: 'details_of_transactions_not_reported',
            label: 'Details of transactions not reported',
            type: 'text',
            width: '270px',
          },
          {
            key: 'reason_for_delay_or_omission',
            label: 'Reason for delay or omission',
            type: 'text',
            width: '240px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
      {
        key: 'clause_34c_interest_rows',
        label: '34(c) Interest under section 201(1A) / 206C(7)',
        shortLabel: '34(c)',
        description: 'Manual capture of interest payable and paid under section 201(1A) or section 206C(7).',
        summaryFields: ['tan', 'interest_section', 'amount_of_interest_payable'],
        columns: [
          { key: 'tan', label: 'TAN', type: 'text', width: '150px' },
          {
            key: 'tds_or_tcs',
            label: 'TDS / TCS',
            type: 'select',
            options: CLAUSE_34_TDS_OR_TCS_OPTIONS,
            width: '150px',
          },
          {
            key: 'interest_section',
            label: 'Interest section',
            type: 'select',
            options: CLAUSE_34_INTEREST_SECTION_OPTIONS,
            width: '180px',
          },
          {
            key: 'default_type',
            label: 'Default type',
            type: 'select',
            options: CLAUSE_34_DEFAULT_TYPE_OPTIONS,
            width: '190px',
          },
          {
            key: 'quarter_or_period',
            label: 'Quarter / period',
            type: 'select',
            options: CLAUSE_34_QUARTER_OR_PERIOD_OPTIONS,
            width: '170px',
          },
          {
            key: 'nature_of_payment_or_receipt',
            label: 'Nature of payment / receipt',
            type: 'text',
            width: '250px',
          },
          {
            key: 'amount_of_interest_payable',
            label: 'Amount of interest payable',
            type: 'number',
            width: '210px',
          },
          {
            key: 'amount_of_interest_paid',
            label: 'Amount of interest paid',
            type: 'number',
            width: '190px',
          },
          {
            key: 'balance_interest_payable',
            label: 'Balance interest payable',
            type: 'number',
            width: '200px',
          },
          {
            key: 'date_of_payment',
            label: 'Date of payment',
            type: 'date',
            width: '170px',
          },
          {
            key: 'challan_bsr_code',
            label: 'Challan BSR code',
            type: 'text',
            width: '170px',
          },
          {
            key: 'challan_serial_number',
            label: 'Challan serial number',
            type: 'text',
            width: '190px',
          },
          {
            key: 'challan_date',
            label: 'Challan date',
            type: 'date',
            width: '160px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_35',
    tables: [
      {
        key: 'clause_35a_trading_goods_rows',
        label: '35(a) Trading goods',
        shortLabel: '35(a)',
        description: 'Quantitative details of principal items of goods traded, captured manually for tax audit reporting.',
        summaryFields: ['item_name', 'unit_of_measurement', 'sales_quantity'],
        columns: [
          { key: 'item_name', label: 'Item name', type: 'text', width: '220px' },
          { key: 'item_description', label: 'Item description', type: 'text', width: '240px' },
          { key: 'unit_of_measurement', label: 'Unit of measurement', type: 'text', width: '170px' },
          {
            key: 'whether_principal_item',
            label: 'Principal item',
            type: 'select',
            options: CLAUSE_35_PRINCIPAL_ITEM_OPTIONS,
            width: '150px',
          },
          { key: 'opening_stock_quantity', label: 'Opening stock quantity', type: 'number', width: '190px' },
          { key: 'purchases_quantity', label: 'Purchases quantity', type: 'number', width: '180px' },
          { key: 'sales_quantity', label: 'Sales quantity', type: 'number', width: '160px' },
          { key: 'closing_stock_quantity', label: 'Closing stock quantity', type: 'number', width: '190px' },
          { key: 'shortage_or_excess_quantity', label: 'Shortage / excess quantity', type: 'number', width: '210px' },
          { key: 'reason_for_shortage_or_excess', label: 'Reason for shortage / excess', type: 'text', width: '230px' },
          {
            key: 'basis_of_identification_as_principal_item',
            label: 'Basis of identification as principal item',
            type: 'select',
            options: CLAUSE_35_TRADING_BASIS_OPTIONS,
            width: '280px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
      {
        key: 'clause_35b_raw_material_rows',
        label: '35(b)(A) Raw materials',
        shortLabel: '35(b)(A)',
        description: 'Quantitative details of principal items of raw materials for manufacturing concerns.',
        summaryFields: ['raw_material_name', 'unit_of_measurement', 'consumption_quantity'],
        columns: [
          { key: 'raw_material_name', label: 'Raw material name', type: 'text', width: '220px' },
          { key: 'raw_material_description', label: 'Raw material description', type: 'text', width: '240px' },
          { key: 'unit_of_measurement', label: 'Unit of measurement', type: 'text', width: '170px' },
          {
            key: 'whether_principal_item',
            label: 'Principal item',
            type: 'select',
            options: CLAUSE_35_PRINCIPAL_ITEM_OPTIONS,
            width: '150px',
          },
          { key: 'opening_stock_quantity', label: 'Opening stock quantity', type: 'number', width: '190px' },
          { key: 'purchases_quantity', label: 'Purchases quantity', type: 'number', width: '180px' },
          { key: 'consumption_quantity', label: 'Consumption quantity', type: 'number', width: '190px' },
          { key: 'sales_quantity', label: 'Sales quantity', type: 'number', width: '160px' },
          { key: 'closing_stock_quantity', label: 'Closing stock quantity', type: 'number', width: '190px' },
          {
            key: 'yield_or_related_finished_product_reference',
            label: 'Yield / related finished product ref',
            type: 'text',
            width: '260px',
          },
          { key: 'shortage_or_excess_quantity', label: 'Shortage / excess quantity', type: 'number', width: '210px' },
          { key: 'reason_for_shortage_or_excess', label: 'Reason for shortage / excess', type: 'text', width: '230px' },
          {
            key: 'basis_of_identification_as_principal_item',
            label: 'Basis of identification as principal item',
            type: 'select',
            options: CLAUSE_35_RAW_MATERIAL_BASIS_OPTIONS,
            width: '290px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
      {
        key: 'clause_35b_finished_product_rows',
        label: '35(b)(B) Finished products / by-products',
        shortLabel: '35(b)(B)',
        description: 'Quantitative details of principal finished products and by-products for manufacturing concerns.',
        summaryFields: ['product_name', 'product_type', 'quantity_manufactured'],
        columns: [
          { key: 'product_name', label: 'Product name', type: 'text', width: '220px' },
          { key: 'product_description', label: 'Product description', type: 'text', width: '240px' },
          {
            key: 'product_type',
            label: 'Product type',
            type: 'select',
            options: CLAUSE_35_PRODUCT_TYPE_OPTIONS,
            width: '170px',
          },
          { key: 'unit_of_measurement', label: 'Unit of measurement', type: 'text', width: '170px' },
          {
            key: 'whether_principal_item',
            label: 'Principal item',
            type: 'select',
            options: CLAUSE_35_PRINCIPAL_ITEM_OPTIONS,
            width: '150px',
          },
          { key: 'opening_stock_quantity', label: 'Opening stock quantity', type: 'number', width: '190px' },
          { key: 'purchases_quantity', label: 'Purchases quantity', type: 'number', width: '180px' },
          { key: 'quantity_manufactured', label: 'Quantity manufactured', type: 'number', width: '190px' },
          { key: 'sales_quantity', label: 'Sales quantity', type: 'number', width: '160px' },
          { key: 'closing_stock_quantity', label: 'Closing stock quantity', type: 'number', width: '190px' },
          { key: 'shortage_or_excess_quantity', label: 'Shortage / excess quantity', type: 'number', width: '210px' },
          { key: 'reason_for_shortage_or_excess', label: 'Reason for shortage / excess', type: 'text', width: '230px' },
          { key: 'yield_percentage_if_available', label: 'Yield %, if available', type: 'number', width: '170px' },
          {
            key: 'basis_of_identification_as_principal_item',
            label: 'Basis of identification as principal item',
            type: 'select',
            options: CLAUSE_35_FINISHED_PRODUCT_BASIS_OPTIONS,
            width: '290px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_36a',
    tables: [
      {
        key: 'clause_36a_deemed_dividend_rows',
        label: '36A Deemed dividend under section 2(22)(e)',
        shortLabel: '36A',
        description: 'Manual capture of receipts that may be treated as deemed dividend under section 2(22)(e).',
        summaryFields: ['payer_company_name', 'nature_of_payment', 'amount_treated_as_deemed_dividend'],
        columns: [
          { key: 'payer_company_name', label: 'Payer company name', type: 'text', width: '230px' },
          { key: 'payer_company_pan', label: 'Payer company PAN', type: 'text', width: '170px' },
          {
            key: 'whether_company_is_closely_held',
            label: 'Closely held company',
            type: 'select',
            options: CLAUSE_36A_CLOSELY_HELD_OPTIONS,
            width: '180px',
          },
          {
            key: 'nature_of_payment',
            label: 'Nature of payment',
            type: 'select',
            options: CLAUSE_36A_NATURE_OF_PAYMENT_OPTIONS,
            width: '240px',
          },
          { key: 'date_of_receipt', label: 'Date of receipt', type: 'date', width: '170px' },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '180px' },
          { key: 'accumulated_profits_available', label: 'Accumulated profits available', type: 'number', width: '220px' },
          { key: 'assessee_shareholding_or_interest', label: 'Assessee shareholding / interest', type: 'text', width: '230px' },
          {
            key: 'concern_in_which_substantial_interest_exists',
            label: 'Concern in which substantial interest exists',
            type: 'text',
            width: '280px',
          },
          {
            key: 'whether_trade_advance_or_commercial_transaction',
            label: 'Trade advance / commercial transaction',
            type: 'select',
            options: CLAUSE_36A_COMMERCIAL_TRANSACTION_OPTIONS,
            width: '250px',
          },
          { key: 'amount_treated_as_deemed_dividend', label: 'Amount treated as deemed dividend', type: 'number', width: '240px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_36b',
    tables: [
      {
        key: 'clause_36b_buyback_rows',
        label: '36B Amount received for buyback of shares under section 2(22)(f)',
        shortLabel: '36B',
        description: 'Manual capture of buyback receipts that may be treated as dividend under section 2(22)(f).',
        summaryFields: ['company_name', 'class_or_type_of_shares', 'amount_treated_as_dividend'],
        columns: [
          { key: 'company_name', label: 'Company name', type: 'text', width: '230px' },
          { key: 'company_pan', label: 'Company PAN', type: 'text', width: '170px' },
          {
            key: 'class_or_type_of_shares',
            label: 'Class / type of shares',
            type: 'select',
            options: CLAUSE_36B_SHARE_CLASS_OPTIONS,
            width: '190px',
          },
          { key: 'date_of_buyback', label: 'Date of buyback', type: 'date', width: '170px' },
          { key: 'number_of_shares_bought_back', label: 'No. of shares bought back', type: 'number', width: '210px' },
          { key: 'amount_received', label: 'Amount received', type: 'number', width: '180px' },
          {
            key: 'cost_of_acquisition_of_shares_bought_back',
            label: 'Cost of acquisition of shares bought back',
            type: 'number',
            width: '280px',
          },
          { key: 'amount_treated_as_dividend', label: 'Amount treated as dividend', type: 'number', width: '220px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_37',
    tables: [
      {
        key: 'clause_37_cost_audit_rows',
        label: '37 Cost audit report',
        shortLabel: '37',
        description: 'Manual capture of cost audit applicability, report details, and reported disqualifications or disagreements.',
        summaryFields: ['period_covered', 'cost_auditor_name', 'cost_audit_report_date'],
        columns: [
          {
            key: 'whether_cost_audit_applicable',
            label: 'Cost audit applicable',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '190px',
          },
          {
            key: 'whether_cost_audit_carried_out',
            label: 'Cost audit carried out',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '190px',
          },
          { key: 'law_or_section_reference', label: 'Law / section reference', type: 'text', width: '220px' },
          { key: 'period_covered', label: 'Period covered', type: 'text', width: '180px' },
          { key: 'cost_auditor_name', label: 'Cost auditor name', type: 'text', width: '220px' },
          { key: 'cost_auditor_registration_or_membership_no', label: 'Registration / membership no.', type: 'text', width: '240px' },
          { key: 'cost_audit_report_date', label: 'Report date', type: 'date', width: '160px' },
          { key: 'cost_audit_report_reference', label: 'Report reference', type: 'text', width: '210px' },
          {
            key: 'whether_disqualification_or_disagreement_reported',
            label: 'Disqualification / disagreement reported',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '280px',
          },
          { key: 'matter_or_item_reported', label: 'Matter / item reported', type: 'text', width: '240px' },
          {
            key: 'nature_of_disqualification_or_disagreement',
            label: 'Nature of matter',
            type: 'select',
            options: CLAUSE_37_TO_39_DISQUALIFICATION_NATURE_OPTIONS,
            width: '220px',
          },
          { key: 'amount_value_or_quantity_involved', label: 'Amount / value / quantity involved', type: 'number', width: '250px' },
          { key: 'management_response', label: 'Management response', type: 'text', width: '240px' },
          { key: 'auditor_review_note', label: 'Auditor review note', type: 'text', width: '240px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_38',
    tables: [
      {
        key: 'clause_38_excise_audit_rows',
        label: '38 Central excise audit report',
        shortLabel: '38',
        description: 'Manual capture of central excise audit applicability, report details, and reported disqualifications or disagreements.',
        summaryFields: ['period_covered', 'auditor_or_authority_name', 'excise_audit_report_date'],
        columns: [
          {
            key: 'whether_excise_audit_applicable',
            label: 'Excise audit applicable',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '190px',
          },
          {
            key: 'whether_excise_audit_carried_out',
            label: 'Excise audit carried out',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '190px',
          },
          { key: 'period_covered', label: 'Period covered', type: 'text', width: '180px' },
          { key: 'excise_registration_or_reference_no', label: 'Registration / reference no.', type: 'text', width: '230px' },
          { key: 'auditor_or_authority_name', label: 'Auditor / authority name', type: 'text', width: '230px' },
          { key: 'excise_audit_report_date', label: 'Report date', type: 'date', width: '160px' },
          { key: 'excise_audit_report_reference', label: 'Report reference', type: 'text', width: '210px' },
          {
            key: 'whether_disqualification_or_disagreement_reported',
            label: 'Disqualification / disagreement reported',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '280px',
          },
          { key: 'matter_or_item_reported', label: 'Matter / item reported', type: 'text', width: '240px' },
          {
            key: 'nature_of_disqualification_or_disagreement',
            label: 'Nature of matter',
            type: 'select',
            options: CLAUSE_37_TO_39_DISQUALIFICATION_NATURE_OPTIONS,
            width: '220px',
          },
          { key: 'amount_value_or_quantity_involved', label: 'Amount / value / quantity involved', type: 'number', width: '250px' },
          { key: 'management_response', label: 'Management response', type: 'text', width: '240px' },
          { key: 'auditor_review_note', label: 'Auditor review note', type: 'text', width: '240px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_39',
    tables: [
      {
        key: 'clause_39_service_tax_audit_rows',
        label: '39 Service tax audit report',
        shortLabel: '39',
        description: 'Manual capture of service tax audit applicability, report details, and reported disqualifications or disagreements.',
        summaryFields: ['period_covered', 'auditor_or_authority_name', 'service_tax_audit_report_date'],
        columns: [
          {
            key: 'whether_service_tax_audit_applicable',
            label: 'Service tax audit applicable',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '210px',
          },
          {
            key: 'whether_service_tax_audit_carried_out',
            label: 'Service tax audit carried out',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '220px',
          },
          { key: 'period_covered', label: 'Period covered', type: 'text', width: '180px' },
          { key: 'service_tax_registration_or_reference_no', label: 'Registration / reference no.', type: 'text', width: '230px' },
          { key: 'auditor_or_authority_name', label: 'Auditor / authority name', type: 'text', width: '230px' },
          { key: 'service_tax_audit_report_date', label: 'Report date', type: 'date', width: '160px' },
          { key: 'service_tax_audit_report_reference', label: 'Report reference', type: 'text', width: '210px' },
          {
            key: 'whether_disqualification_or_disagreement_reported',
            label: 'Disqualification / disagreement reported',
            type: 'select',
            options: CLAUSE_37_TO_39_WHETHER_OPTIONS,
            width: '280px',
          },
          { key: 'matter_or_item_reported', label: 'Matter / item reported', type: 'text', width: '240px' },
          {
            key: 'nature_of_disqualification_or_disagreement',
            label: 'Nature of matter',
            type: 'select',
            options: CLAUSE_37_TO_39_DISQUALIFICATION_NATURE_OPTIONS,
            width: '220px',
          },
          { key: 'amount_value_or_quantity_involved', label: 'Amount / value / quantity involved', type: 'number', width: '250px' },
          { key: 'management_response', label: 'Management response', type: 'text', width: '240px' },
          { key: 'auditor_review_note', label: 'Auditor review note', type: 'text', width: '240px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_40',
    tables: [
      {
        key: 'clause_40_ratio_rows',
        label: '40 Accounting ratios',
        shortLabel: '40',
        description: 'Manual capture of current year and preceding previous year ratios for goods traded, goods manufactured or services rendered.',
        summaryFields: ['activity_or_segment_name', 'activity_type', 'principal_item_or_service'],
        columns: [
          { key: 'activity_or_segment_name', label: 'Activity / segment name', type: 'text', width: '230px' },
          {
            key: 'activity_type',
            label: 'Activity type',
            type: 'select',
            options: CLAUSE_40_ACTIVITY_TYPE_OPTIONS,
            width: '170px',
          },
          { key: 'principal_item_or_service', label: 'Principal item / service', type: 'text', width: '230px' },
          { key: 'current_year_total_turnover', label: 'Current year total turnover', type: 'number', width: '220px' },
          { key: 'preceding_year_total_turnover', label: 'Preceding year total turnover', type: 'number', width: '230px' },
          { key: 'current_year_gross_profit_to_turnover_ratio', label: 'Current year gross profit / turnover ratio', type: 'number', width: '300px' },
          { key: 'preceding_year_gross_profit_to_turnover_ratio', label: 'Preceding year gross profit / turnover ratio', type: 'number', width: '310px' },
          { key: 'current_year_net_profit_to_turnover_ratio', label: 'Current year net profit / turnover ratio', type: 'number', width: '290px' },
          { key: 'preceding_year_net_profit_to_turnover_ratio', label: 'Preceding year net profit / turnover ratio', type: 'number', width: '300px' },
          { key: 'current_year_stock_in_trade_to_turnover_ratio', label: 'Current year stock-in-trade / turnover ratio', type: 'number', width: '310px' },
          { key: 'preceding_year_stock_in_trade_to_turnover_ratio', label: 'Preceding year stock-in-trade / turnover ratio', type: 'number', width: '320px' },
          {
            key: 'current_year_material_consumed_to_finished_goods_ratio',
            label: 'Current year material consumed / finished goods ratio',
            type: 'number',
            width: '350px',
          },
          {
            key: 'preceding_year_material_consumed_to_finished_goods_ratio',
            label: 'Preceding year material consumed / finished goods ratio',
            type: 'number',
            width: '360px',
          },
          { key: 'basis_of_computation', label: 'Basis of computation', type: 'text', width: '240px' },
          {
            key: 'whether_significant_deviation_observed',
            label: 'Significant deviation observed',
            type: 'select',
            options: CLAUSE_40_DEVIATION_OPTIONS,
            width: '240px',
          },
          { key: 'reason_for_significant_deviation', label: 'Reason for significant deviation', type: 'text', width: '270px' },
          { key: 'financial_statement_or_working_reference', label: 'Financial statement / working ref', type: 'text', width: '270px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_41',
    tables: [
      {
        key: 'clause_41_demand_refund_rows',
        label: '41 Demand or refund under other tax laws',
        shortLabel: '41',
        description: 'Manual capture of demand raised or refund issued during the previous year under tax laws other than Income-tax Act and Wealth-tax Act.',
        summaryFields: ['name_of_applicable_act', 'demand_or_refund', 'amount_of_demand_or_refund'],
        columns: [
          { key: 'financial_year_to_which_demand_or_refund_relates', label: 'Financial year to which demand / refund relates', type: 'text', width: '320px' },
          { key: 'name_of_applicable_act', label: 'Name of applicable Act', type: 'text', width: '240px' },
          {
            key: 'tax_law_category',
            label: 'Tax law category',
            type: 'select',
            options: CLAUSE_41_TAX_LAW_CATEGORY_OPTIONS,
            width: '190px',
          },
          {
            key: 'demand_or_refund',
            label: 'Demand / refund',
            type: 'select',
            options: CLAUSE_41_DEMAND_OR_REFUND_OPTIONS,
            width: '240px',
          },
          { key: 'order_number', label: 'Order number', type: 'text', width: '190px' },
          { key: 'date_of_demand_or_refund_order', label: 'Order date', type: 'date', width: '160px' },
          { key: 'amount_of_demand_or_refund', label: 'Demand / refund amount', type: 'number', width: '210px' },
          { key: 'authority_issuing_order', label: 'Authority issuing order', type: 'text', width: '230px' },
          { key: 'relevant_proceeding_details', label: 'Relevant proceeding details', type: 'text', width: '260px' },
          { key: 'authority_before_which_matter_is_pending', label: 'Pending before authority', type: 'text', width: '250px' },
          {
            key: 'current_status',
            label: 'Current status',
            type: 'select',
            options: CLAUSE_41_CURRENT_STATUS_OPTIONS,
            width: '180px',
          },
          {
            key: 'whether_paid_received_or_adjusted',
            label: 'Paid / received / adjusted',
            type: 'select',
            options: CLAUSE_41_WHETHER_OPTIONS,
            width: '230px',
          },
          { key: 'amount_paid_received_or_adjusted', label: 'Amount paid / received / adjusted', type: 'number', width: '260px' },
          { key: 'date_of_payment_receipt_or_adjustment', label: 'Payment / receipt / adjustment date', type: 'date', width: '270px' },
          { key: 'mode_or_reference_of_payment_receipt_or_adjustment', label: 'Payment / receipt / adjustment ref', type: 'text', width: '280px' },
          {
            key: 'whether_verified_with_portal',
            label: 'Verified with portal',
            type: 'select',
            options: CLAUSE_41_WHETHER_OPTIONS,
            width: '190px',
          },
          {
            key: 'whether_management_representation_obtained',
            label: 'Management representation obtained',
            type: 'select',
            options: CLAUSE_41_WHETHER_OPTIONS,
            width: '270px',
          },
          { key: 'financial_statement_or_caro_reference', label: 'Financial statement / CARO ref', type: 'text', width: '260px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_42',
    tables: [
      {
        key: 'clause_42_reporting_rows',
        label: '42 Form 61, Form 61A and Form 61B reporting',
        shortLabel: '42',
        description: 'Manual capture of Form 61, Form 61A and Form 61B reporting requirements and furnishing status.',
        summaryFields: ['form_no', 'reporting_period', 'date_of_actual_furnishing'],
        columns: [
          {
            key: 'form_no',
            label: 'Form no.',
            type: 'select',
            options: CLAUSE_42_FORM_NO_OPTIONS,
            width: '170px',
          },
          {
            key: 'whether_required_to_furnish',
            label: 'Required to furnish',
            type: 'select',
            options: CLAUSE_42_REQUIRED_OPTIONS,
            width: '190px',
          },
          { key: 'section_and_rule_reference', label: 'Section / rule reference', type: 'text', width: '230px' },
          {
            key: 'reporting_period',
            label: 'Reporting period',
            type: 'select',
            options: CLAUSE_42_REPORTING_PERIOD_OPTIONS,
            width: '230px',
          },
          { key: 'registration_number_or_itdrein', label: 'Registration no. / ITDREIN', type: 'text', width: '230px' },
          {
            key: 'designated_director_or_principal_officer_details',
            label: 'Designated director / principal officer details',
            type: 'text',
            width: '320px',
          },
          {
            key: 'due_date_for_furnishing',
            label: 'Due date for furnishing',
            type: 'date',
            placeholder: 'Form 61: 31 Oct / 30 Apr; Form 61A/61B: 31 May',
            width: '210px',
          },
          { key: 'date_of_actual_furnishing', label: 'Date of actual furnishing', type: 'date', width: '220px' },
          { key: 'acknowledgment_number', label: 'Acknowledgment number', type: 'text', width: '220px' },
          {
            key: 'whether_form_furnished',
            label: 'Form furnished',
            type: 'select',
            options: CLAUSE_42_WHETHER_OPTIONS,
            width: '180px',
          },
          {
            key: 'whether_furnished_within_due_date',
            label: 'Furnished within due date',
            type: 'select',
            options: CLAUSE_42_WHETHER_OPTIONS,
            width: '230px',
          },
          {
            key: 'whether_form_contains_all_required_information',
            label: 'Contains all required information',
            type: 'select',
            options: CLAUSE_42_INFORMATION_OPTIONS,
            width: '260px',
          },
          {
            key: 'details_of_information_or_transactions_not_reported',
            label: 'Information / transactions not reported',
            type: 'text',
            width: '300px',
          },
          { key: 'reason_for_delay_or_omission', label: 'Reason for delay / omission', type: 'text', width: '250px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_43',
    tables: [
      {
        key: 'clause_43_cbcr_rows',
        label: '43 Country-by-country reporting under section 286',
        shortLabel: '43',
        description: 'Manual capture of country-by-country reporting applicability and report furnishing under section 286.',
        summaryFields: ['international_group_name', 'assessee_role_in_international_group', 'report_furnished_by'],
        columns: [
          {
            key: 'whether_liable_to_furnish_report_under_section_286_2',
            label: 'Liable to furnish report under section 286(2)',
            type: 'select',
            options: CLAUSE_43_WHETHER_OPTIONS,
            width: '300px',
          },
          {
            key: 'assessee_role_in_international_group',
            label: 'Assessee role in international group',
            type: 'select',
            options: CLAUSE_43_ASSESSEE_ROLE_OPTIONS,
            width: '300px',
          },
          { key: 'international_group_name', label: 'International group name', type: 'text', width: '240px' },
          { key: 'reporting_accounting_year', label: 'Reporting accounting year', type: 'text', width: '220px' },
          { key: 'parent_entity_name', label: 'Parent entity name', type: 'text', width: '230px' },
          { key: 'parent_entity_country_or_territory', label: 'Parent entity country / territory', type: 'text', width: '260px' },
          { key: 'parent_entity_pan_or_tax_identification_number', label: 'Parent PAN / tax identification no.', type: 'text', width: '280px' },
          { key: 'alternate_reporting_entity_name', label: 'Alternate reporting entity name', type: 'text', width: '270px' },
          {
            key: 'alternate_reporting_entity_country_or_territory',
            label: 'Alternate reporting entity country / territory',
            type: 'text',
            width: '330px',
          },
          {
            key: 'alternate_reporting_entity_pan_or_tax_identification_number',
            label: 'Alternate reporting PAN / tax identification no.',
            type: 'text',
            width: '330px',
          },
          {
            key: 'whether_form_3ceac_furnished',
            label: 'Form 3CEAC furnished',
            type: 'select',
            options: CLAUSE_43_WHETHER_OPTIONS,
            width: '200px',
          },
          { key: 'form_3ceac_date_of_furnishing', label: 'Form 3CEAC furnishing date', type: 'date', width: '230px' },
          { key: 'form_3ceac_acknowledgment_number', label: 'Form 3CEAC acknowledgment no.', type: 'text', width: '250px' },
          {
            key: 'whether_report_under_section_286_2_furnished',
            label: 'Report under section 286(2) furnished',
            type: 'select',
            options: CLAUSE_43_WHETHER_OPTIONS,
            width: '280px',
          },
          {
            key: 'report_furnished_by',
            label: 'Report furnished by',
            type: 'select',
            options: CLAUSE_43_REPORT_FURNISHED_BY_OPTIONS,
            width: '260px',
          },
          {
            key: 'form_or_report_reference',
            label: 'Form / report reference',
            type: 'select',
            options: CLAUSE_43_FORM_OR_REPORT_REFERENCE_OPTIONS,
            width: '210px',
          },
          { key: 'date_of_furnishing_of_report', label: 'Report furnishing date', type: 'date', width: '210px' },
          { key: 'acknowledgment_number', label: 'Acknowledgment number', type: 'text', width: '220px' },
          {
            key: 'whether_copy_of_report_or_acknowledgment_verified',
            label: 'Copy / acknowledgment verified',
            type: 'select',
            options: CLAUSE_43_WHETHER_OPTIONS,
            width: '250px',
          },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
  {
    clauseKey: 'clause_44',
    tables: [
      {
        key: 'clause_44_gst_expenditure_rows',
        label: '44 GST expenditure break-up',
        shortLabel: '44',
        description: 'Manual capture of expenditure head-wise GST registration status break-up.',
        summaryFields: ['expenditure_head', 'total_amount_of_expenditure', 'total_expenditure_relating_to_registered_entities'],
        columns: [
          { key: 'expenditure_head', label: 'Expenditure head', type: 'text', width: '230px' },
          {
            key: 'expenditure_type',
            label: 'Expenditure type',
            type: 'select',
            options: CLAUSE_44_EXPENDITURE_TYPE_OPTIONS,
            width: '190px',
          },
          { key: 'total_amount_of_expenditure', label: 'Total amount of expenditure', type: 'number', width: '230px' },
          {
            key: 'expenditure_relating_to_exempt_goods_or_services_from_registered_entities',
            label: 'Exempt goods / services from registered entities',
            type: 'number',
            width: '340px',
          },
          { key: 'expenditure_relating_to_composition_entities', label: 'Composition entities', type: 'number', width: '210px' },
          { key: 'expenditure_relating_to_other_registered_entities', label: 'Other registered entities', type: 'number', width: '240px' },
          {
            key: 'total_expenditure_relating_to_registered_entities',
            label: 'Total expenditure relating to registered entities',
            type: 'number',
            width: '330px',
          },
          { key: 'expenditure_relating_to_unregistered_entities', label: 'Unregistered entities', type: 'number', width: '230px' },
          { key: 'reconciliation_difference', label: 'Reconciliation difference', type: 'number', width: '230px' },
          { key: 'reason_for_reconciliation_difference', label: 'Reason for reconciliation difference', type: 'text', width: '300px' },
          {
            key: 'basis_of_classification',
            label: 'Basis of classification',
            type: 'select',
            options: CLAUSE_44_BASIS_OF_CLASSIFICATION_OPTIONS,
            width: '310px',
          },
          {
            key: 'whether_capital_expenditure_included',
            label: 'Capital expenditure included',
            type: 'select',
            options: CLAUSE_44_WHETHER_OPTIONS,
            width: '230px',
          },
          {
            key: 'whether_multiple_gstin_consolidation_involved',
            label: 'Multiple GSTIN consolidation involved',
            type: 'select',
            options: CLAUSE_44_WHETHER_OPTIONS,
            width: '280px',
          },
          { key: 'gstin_or_branch_reference', label: 'GSTIN / branch reference', type: 'text', width: '230px' },
          { key: 'evidence_or_working_reference', label: 'Evidence / working ref', type: 'text', width: '220px' },
          { key: 'remarks', label: 'Remarks', type: 'text', width: '220px' },
        ],
      },
    ],
  },
];

export const TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE = new Map(
  TAX_AUDIT_3CD_FIELD_SCHEMAS.map((schema) => [schema.clauseKey, schema])
);
