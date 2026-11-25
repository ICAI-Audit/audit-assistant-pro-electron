// Form No. 26 against Form No. 3CD: the mapping, as data.
//
// Every row holds TWO entries:
//   office    — the entry of the office's mapping document ("Form No. 26 vis-à-vis Form No. 3CD"), cell for cell;
//   corrected — the entry corrected from the official texts, or null where the check found no difference.
// Sources of every corrected cell: form26/MAPPING-CHECK.md (sections 2, 3 and 5; the line is cited above each
// corrected entry) and the "Suggested entry" column of docs/project/TAX_AUDIT_FORM26_DOMAIN_REVIEW.md, Part Two.
// The corrected entry is the one shown (owner's decision of 21 November 2026); a cell the check could not
// confirm (notConfirmable) shows the office's value. Nothing here is rendered as a doubt: checkState and
// FORM26_MAPPING_OFFICE_MARKS are data only.
//
// How the office's cells are held:
//   - a dash (no entry) is held as ''; "None" in the Form 3CD column as [];
//   - its dagger marks and its two reminders are not part of the text: they are in FORM26_MAPPING_OFFICE_MARKS;
//   - the Form 3CD column is split into references only at " / ", ", " between two clause numbers and "(also n)";
//     "(part)" becomes part: true; everything else is the cell as written;
//   - each Form 3CD reference carries its own subject text (the application's Form 3CD list has no clause 28, 29 or 36):
//     the subject of the row, or the office's or the check's own words for that Form 3CD clause where they give them.
// kind: 'new' where the entry is marked NEW; 'same' where its "what has changed" begins "No change in substance";
// otherwise 'changed'.
//
// This text is commentary beside the form. It never enters an exported form.

export type Form26MappingKind = 'new' | 'changed' | 'same';
export type Form26MappingEntry = {
  subject: string;
  section2025: string;
  section1961: string;
  threeCd: { clause: string; part?: boolean; subject: string }[];     // own Form 3CD subject text; [] = none
  kind: Form26MappingKind;
  whatChanged: string;
  askClient?: string;
};
export type Form26MappingRow = {
  id: string;                                                          // 'm09', 'm11ab', 'm14be' … stable
  form26: { clause: string; subs: string[] }[];                        // e.g. [{clause:'13',subs:[]},{clause:'14',subs:['a']}]
  sectionHeading: string;
  office: Form26MappingEntry;
  corrected: Form26MappingEntry | null;                                // null = no difference
  notConfirmable?: ('section2025' | 'section1961')[];                  // these cells show the office's value
  checkState: 'to_check' | 'our_reading' | 'checked';                  // data only; never rendered
};
// A Form 3CD clause that has no clause of its own in Form 26. office: null = the office's list does not have the
// row; corrected: null = the corrected list does not have it (the clause is in Form 26 after all). A row that
// stands as the office wrote it carries the same entry twice.
export type Form26NotInForm26Entry = { threeCd: string; subject: string; position: string };
export type Form26NotInForm26Row = { id: string; office: Form26NotInForm26Entry | null; corrected: Form26NotInForm26Entry | null };

// The one-line switch (owner's decision of 21 November 2026): 'office' shows the office's document as written.
export const FORM26_MAPPING_SHOWN: 'corrected' | 'office' = 'corrected';

export const FORM26_MAPPING: Form26MappingRow[] = [
  {
    id: 'm09',
    form26: [{ clause: '9', subs: [] }],
    sectionHeading: 'A – General Information',
    office: {
      subject: 'Ground on which audit is conducted',
      section2025: '63; 58(2), 61(2), 58(8)',
      section1961: '44AB; 44AD/44ADA/44AE, 44B etc.; 44AD(4)',
      threeCd: [{ clause: '8', subject: 'Ground on which audit is conducted' }],
      kind: 'changed',
      whatChanged: 'Same substance; presumptive opt-out shown as a separate ground.',
    },
    // MAPPING-CHECK.md line 23 (row 9; 1961 column: D): for section 58(8) the counterpart is 44AD(5), not 44AD(4).
    // Domain review 2.2, row 9.
    corrected: {
      subject: 'Ground on which audit is conducted',
      section2025: '63; 58(2), 61(2), 58(8)',
      section1961: '44AB; 44AD/44ADA/44AE, 44B etc.; 44AD(5)',
      threeCd: [{ clause: '8', subject: 'Ground on which audit is conducted' }],
      kind: 'changed',
      whatChanged: 'Same substance; presumptive opt-out shown as a separate ground.',
    },
    checkState: 'checked',
  },
  {
    id: 'm10',
    form26: [{ clause: '10', subs: [] }],
    sectionHeading: 'A – General Information',
    office: {
      subject: 'Option for concessional tax regime',
      section2025: '199 to 204',
      section1961: '115BA, 115BAA, 115BAB, 115BAC, 115BAD, 115BAE',
      threeCd: [{ clause: '8a', subject: 'Option for concessional tax regime' }],
      kind: 'same',
      whatChanged: 'No change in substance; section numbers renamed.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm11ab',
    form26: [{ clause: '11', subs: ['a', 'b'] }],
    sectionHeading: 'A – General Information',
    office: {
      subject: 'Partners/members, PAN, profit-sharing ratio and changes',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '9', subject: 'Partners/members, PAN, profit-sharing ratio and changes' }],
      kind: 'changed',
      whatChanged: 'PAN of each partner/member now asked expressly.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm12ab',
    form26: [{ clause: '12', subs: ['a', 'b'] }],
    sectionHeading: 'A – General Information',
    office: {
      subject: 'Nature of business and change in it',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '10', subject: 'Nature of business and change in it' }],
      kind: 'changed',
      whatChanged: 'Business codes moved to Schedule – General Information.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm12c',
    form26: [{ clause: '12', subs: ['c'] }],
    sectionHeading: 'A – General Information',
    office: {
      subject: 'Cost audit carried out',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '37', subject: 'Cost audit carried out' }],
      kind: 'changed',
      whatChanged: 'Moved up into General Information.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm12d',
    form26: [{ clause: '12', subs: ['d'] }],
    sectionHeading: 'A – General Information',
    office: {
      subject: 'Turnover, GP, NP, stock and yield ratios – current and preceding year',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '40', subject: 'Turnover, GP, NP, stock and yield ratios – current and preceding year' }],
      kind: 'changed',
      whatChanged: 'Preceding-year figures now part of the same table.',
    },
    // MAPPING-CHECK.md line 28 (row 12(d); "what has changed": D): Form 3CD clause 40 already has both columns; only the words "tax year" are new.
    // Domain review 2.2, row 12(d).
    corrected: {
      subject: 'Turnover, GP, NP, stock and yield ratios – current and preceding year',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '40', subject: 'Turnover, GP, NP, stock and yield ratios – current and preceding year' }],
      kind: 'same',
      whatChanged: 'No change in substance; only the words "tax year" are new.',
    },
    checkState: 'checked',
  },
  {
    id: 'm13_14a',
    form26: [{ clause: '13', subs: [] }, { clause: '14', subs: ['a'] }],
    sectionHeading: 'B – Books of Account and Method of Accounting',
    office: {
      subject: 'Books maintained and address(es) where kept',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '11', subject: 'Books maintained and address(es) where kept' }],
      kind: 'changed',
      whatChanged: 'Address-wise list of books for multiple locations.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm14be',
    form26: [{ clause: '14', subs: ['b', 'c', 'd', 'e'] }],
    sectionHeading: 'B – Books of Account and Method of Accounting',
    office: {
      subject: 'Accounting software; cloud storage with IP address and country; rule 46(8) compliance; backup server address in India',
      section2025: 'Rule 46(8) of 2026 Rules',
      section1961: '',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW. Digital trail of books is now a reporting item.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm15',
    form26: [{ clause: '15', subs: [] }],
    sectionHeading: 'B – Books of Account and Method of Accounting',
    office: {
      subject: 'Method of accounting and change in it',
      section2025: '',
      section1961: '145',
      threeCd: [{ clause: '13(a)–(c)', subject: 'Method of accounting and change in it' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm16',
    form26: [{ clause: '16', subs: [] }],
    sectionHeading: 'B – Books of Account and Method of Accounting',
    office: {
      subject: 'Inventory valuation; adjustment needed to comply with section 277',
      section2025: '277',
      section1961: '145A',
      threeCd: [{ clause: '14', subject: 'Inventory valuation; adjustment needed to comply with section 277' }],
      kind: 'changed',
      whatChanged: 'Reporting is now "whether adjustment is required".',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm17_18',
    form26: [{ clause: '17', subs: [] }, { clause: '18', subs: [] }],
    sectionHeading: 'B – Books of Account and Method of Accounting',
    office: {
      subject: 'ICDS adjustments and disclosures',
      section2025: '276(2)',
      section1961: '145(2)',
      threeCd: [{ clause: '13(d)–(f)', subject: 'ICDS adjustments and disclosures' }],
      kind: 'changed',
      whatChanged: 'Split into two clauses; schedule-based reporting.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm19',
    form26: [{ clause: '19', subs: [] }],
    sectionHeading: 'B – Books of Account and Method of Accounting',
    office: {
      subject: 'Presumptive profits included in P&L',
      section2025: '58, 61',
      section1961: '44AD, 44AE, 44B etc.',
      threeCd: [{ clause: '12', subject: 'Presumptive profits included in P&L' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    // MAPPING-CHECK.md line 34 (row 19; 2025 column: N): the form cites no section in clause 19; "58, 61" is the office's own addition.
    notConfirmable: ['section2025'],
    checkState: 'our_reading',
  },
  {
    id: 'm20',
    form26: [{ clause: '20', subs: [] }],
    sectionHeading: 'C – Particulars of Receipt / Income',
    office: {
      subject: 'Income under 92(2)(m) not credited to P&L',
      section2025: '92(2)(m)',
      section1961: '56(2)(x)',
      threeCd: [{ clause: '29B', subject: 'Income under 92(2)(m) not credited to P&L' }],
      kind: 'changed',
      whatChanged: 'Now framed as "not credited to P&L".',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm21',
    form26: [{ clause: '21', subs: [] }],
    sectionHeading: 'C – Particulars of Receipt / Income',
    office: {
      subject: 'Other income chargeable but not credited to P&L',
      section2025: '',
      section1961: '',
      threeCd: [
        { clause: '16', subject: 'Other income chargeable but not credited to P&L' },
        { clause: '25', subject: 'Profits chargeable under section 41' },
      ],
      kind: 'changed',
      whatChanged: 'Section 41-type receipts appear to fall here.',
    },
    // MAPPING-CHECK.md line 36 (row 21; "what has changed": D): firm, by Schedule row "(iv) 38 – Deemed Profits and Gains".
    // Form 3CD clauses added from lines 82 (25), 84 (29A), 95 (36B), 97 (24) and line 66 (36A, receipt side); domain review 2.2, row 21.
    // The text names the table, not a clause: this tool, as the owner's file, opens the table headed "20." under
    // clause 20 (AS-BUILT-DEFINITION, schedule s20; the crossed tables are in the domain review, item 1.3).
    corrected: {
      subject: 'Other income chargeable but not credited to P&L',
      section2025: '',
      section1961: '',
      threeCd: [
        { clause: '16', subject: 'Other income chargeable but not credited to P&L' },
        { clause: '25', subject: 'Profits chargeable under section 41' },
        { clause: '24', subject: 'Amounts deemed to be profits and gains under section 32AC or 32AD or 33AB or 33ABA or 33AC' },
        { clause: '29A', subject: 'Income under section 56(2)(ix)' },
        { clause: '36B', subject: 'Whether the assessee has received any amount for buyback of shares as referred to in sub-clause (f) of clause (22) of section 2' },
        { clause: '36A', part: true, subject: 'Whether the assessee has received any amount in the nature of dividend' },
      ],
      kind: 'changed',
      whatChanged: 'Section 41-type receipts fall in row "(iv) 38" of the table headed "20.", which opens under clause 20.',
    },
    checkState: 'checked',
  },
  {
    id: 'm22',
    form26: [{ clause: '22', subs: [] }],
    sectionHeading: 'C – Particulars of Receipt / Income',
    office: {
      subject: 'Capital asset converted into stock-in-trade',
      section2025: '',
      section1961: '45(2)',
      threeCd: [{ clause: '15', subject: 'Capital asset converted into stock-in-trade' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm23',
    form26: [{ clause: '23', subs: [] }],
    sectionHeading: 'C – Particulars of Receipt / Income',
    office: {
      subject: 'Land/building transferred below stamp duty value',
      section2025: '53, 78',
      section1961: '43CA, 50C',
      threeCd: [{ clause: '17', subject: 'Land/building transferred below stamp duty value' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm24_25',
    form26: [{ clause: '24', subs: [] }, { clause: '25', subs: [] }],
    sectionHeading: 'C – Particulars of Receipt / Income',
    office: {
      subject: 'Hundi borrowing and repayment deemed as income',
      section2025: '106',
      section1961: '69D',
      threeCd: [{ clause: '30', subject: 'Hundi borrowing and repayment deemed as income' }],
      kind: 'changed',
      whatChanged: 'Split into two clauses.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm26',
    form26: [{ clause: '26', subs: [] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Expenditure relating to exempt income',
      section2025: '14',
      section1961: '14A',
      threeCd: [{ clause: '21(h)', subject: 'Expenditure relating to exempt income' }],
      kind: 'changed',
      whatChanged: 'Expressly covers years where exempt income has not accrued or been received.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm27a',
    form26: [{ clause: '27', subs: ['a'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Disallowance under 29, 31 and 32',
      section2025: '29, 31, 32',
      section1961: '36(1) items',
      threeCd: [
        { clause: '20', subject: 'Disallowance under 29, 31 and 32' },
        { clause: '21', part: true, subject: 'Disallowance under 29, 31 and 32' },
      ],
      kind: 'changed',
      whatChanged: 'Statute-wise tagging.',
    },
    // MAPPING-CHECK.md line 41 (row 27(a); 1961 column: D): "36(1) items" is incomplete; Form 3CD prints 20(a) [section 36(1)(ii)], 21(i) proviso to section 36(1)(iii), 21(e) section 40A(7), 21(f) section 40A(9), 21(g).
    // Domain review 2.2, row 27(a).
    corrected: {
      subject: 'Disallowance under 29, 31 and 32',
      section2025: '29, 31, 32',
      section1961: '36(1)(ii), proviso to 36(1)(iii), 40A(7), 40A(9)',
      threeCd: [
        { clause: '20(a)', subject: 'Bonus or commission' },
        { clause: '21(e), (f), (g), (i)', subject: 'Gratuity; sums paid as employer; contingent liability; interest on capital borrowed' },
      ],
      kind: 'changed',
      whatChanged: 'Statute-wise tagging.',
    },
    checkState: 'checked',
  },
  {
    id: 'm27b',
    form26: [{ clause: '27', subs: ['b'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Employees\' contributions disallowable',
      section2025: '29(1)(e)',
      section1961: '36(1)(va)',
      threeCd: [{ clause: '20(b)', subject: 'Employees\' contributions disallowable' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    // MAPPING-CHECK.md line 42 (row 27(b); "what has changed": D): Schedule 27(b) asks only the nature of fund and the amount disallowable; line 161: section 29(1)(e) substituted by the Finance Act, 2026.
    // Domain review 2.2, row 27(b).
    corrected: {
      subject: 'Employees\' contributions disallowable',
      section2025: '29(1)(e)',
      section1961: '36(1)(va)',
      threeCd: [{ clause: '20(b)', subject: 'Employees\' contributions disallowable' }],
      kind: 'changed',
      whatChanged: 'Reporting reduced to the nature of fund and the disallowable amount. Section 29(1)(e) substituted by the Finance Act, 2026.',
    },
    checkState: 'checked',
  },
  {
    id: 'm27c',
    form26: [{ clause: '27', subs: ['c'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Disallowance under section 34 (capital, personal, etc.)',
      section2025: '34',
      section1961: '37(1)',
      threeCd: [{ clause: '21(a)', subject: 'Disallowance under section 34 (capital, personal, etc.)' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    // MAPPING-CHECK.md line 43 (row 27(c); "what has changed": D): the rows Schedule 27(c) also lists.
    // Domain review 2.2, row 27(c): "Name these rows in the entry".
    corrected: {
      subject: 'Disallowance under section 34 (capital, personal, etc.)',
      section2025: '34',
      section1961: '37(1)',
      threeCd: [{ clause: '21(a)', subject: 'Disallowance under section 34 (capital, personal, etc.)' }],
      kind: 'changed',
      whatChanged: 'Schedule 27(c) also lists political-party advertisement, club expenses, offences or prohibited purposes, benefit or perquisite under section 34(3)(b), compounding, settlement of proceedings, and CSR.',
    },
    checkState: 'checked',
  },
  {
    id: 'm27d',
    form26: [{ clause: '27', subs: ['d'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Disallowance under section 35 (other than TDS items)',
      section2025: '35',
      section1961: '40 (other than 40(a)(i)/(ia))',
      threeCd: [{ clause: '21(b)/(c)', part: true, subject: 'Disallowance under section 35 (other than TDS items)' }],
      kind: 'changed',
      whatChanged: 'TDS-linked items moved to clause 51.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm28',
    form26: [{ clause: '28', subs: [] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Penalty levied under any law in or outside India',
      section2025: '',
      section1961: 'Explanation to 37(1)',
      threeCd: [{ clause: '21(a)', part: true, subject: 'Penalty levied under any law in or outside India' }],
      kind: 'changed',
      whatChanged: 'Now a separate clause.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm29',
    form26: [{ clause: '29', subs: [] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Payments to specified persons',
      section2025: '36(3)',
      section1961: '40A(2)(b)',
      threeCd: [{ clause: '23', subject: 'Payments to specified persons' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm30_31',
    form26: [{ clause: '30', subs: [] }, { clause: '31', subs: [] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Cash payments disallowable and deemed income on later cash payment',
      section2025: '36(4), 36(5)',
      section1961: '40A(3), 40A(3A)',
      threeCd: [{ clause: '21(d)', subject: 'Cash payments disallowable and deemed income on later cash payment' }],
      kind: 'changed',
      whatChanged: 'Split into two clauses.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm32ab',
    form26: [{ clause: '32', subs: ['a', 'b'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Sums allowable only on actual payment; later-year allowance',
      section2025: '37(2)(a)–(f)',
      section1961: '43B(a)–(g)',
      threeCd: [{ clause: '26', subject: 'Sums allowable only on actual payment; later-year allowance' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm33a',
    form26: [{ clause: '33', subs: ['a'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Interest under section 23 of MSMED Act',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '22', subject: 'Interest under section 23 of MSMED Act' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm33bc',
    form26: [{ clause: '33', subs: ['b', 'c'] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Payments to micro and small enterprises; later-year allowance',
      section2025: '37(2)(g)',
      section1961: '43B(h)',
      threeCd: [{ clause: '26 (sub-clause h)', subject: 'Payments to micro and small enterprises; later-year allowance' }],
      kind: 'changed',
      whatChanged: 'Separate clause with reversal reporting.',
    },
    // MAPPING-CHECK.md line 50 (row 33(b), (c); 3CD column: D): the MSME limb is reported in Form 3CD clause 22(ii) and (iii); clause 26(B) only carves it out.
    // Domain review 2.2, row 33(b), (c).
    corrected: {
      subject: 'Payments to micro and small enterprises; later-year allowance',
      section2025: '37(2)(g)',
      section1961: '43B(h)',
      threeCd: [{ clause: '22(ii), (iii)', subject: 'Payments to micro and small enterprises' }],
      kind: 'changed',
      whatChanged: 'Separate clause with reversal reporting.',
    },
    checkState: 'checked',
  },
  {
    id: 'm34',
    form26: [{ clause: '34', subs: [] }],
    sectionHeading: 'D – Particulars of Expenses',
    office: {
      subject: 'Amounts allowable as deduction under various sections',
      section2025: 'Various',
      section1961: '32AC, 33AB, 35 etc.',
      threeCd: [
        { clause: '19', subject: 'Amounts allowable as deduction under various sections' },
        { clause: '24', subject: 'Amounts allowable as deduction under various sections' },
      ],
      kind: 'changed',
      whatChanged: 'Consolidated into one clause.',
    },
    // MAPPING-CHECK.md line 51 (row 34; 1961 and 3CD columns: D): 32AC is no longer in clause 19; clause 24 is deemed income, whose place is clause 21.
    // Domain review 2.2, row 34.
    corrected: {
      subject: 'Amounts allowable as deduction under various sections',
      section2025: 'Various',
      section1961: '33AB, 33ABA, 35 etc.',
      threeCd: [{ clause: '19', subject: 'Amounts allowable as deduction under various sections' }],
      kind: 'changed',
      whatChanged: 'Consolidated into one clause.',
    },
    checkState: 'checked',
  },
  {
    id: 'm35ab',
    form26: [{ clause: '35', subs: ['a', 'b'] }],
    sectionHeading: 'E – Prior Period',
    office: {
      subject: 'Prior-period income and expenditure',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '27(b)', subject: 'Prior-period income and expenditure' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    // MAPPING-CHECK.md line 52 (row 35(a), (b); "what has changed": D).
    // Domain review 2.2, row 35(a), (b): "Say so in the entry".
    corrected: {
      subject: 'Prior-period income and expenditure',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '27(b)', subject: 'Prior-period income and expenditure' }],
      kind: 'changed',
      whatChanged: 'Schedule 35(b) also asks "Whether complete amount of such expenditure is allowable as deduction in this tax year (Yes/No)" and the allowable amount.',
    },
    checkState: 'checked',
  },
  {
    id: 'm36',
    form26: [{ clause: '36', subs: [] }],
    sectionHeading: 'F – Losses, Depreciation and Deductions',
    office: {
      subject: 'Depreciation allowable',
      section2025: '33',
      section1961: '32',
      threeCd: [{ clause: '18', subject: 'Depreciation allowable' }],
      kind: 'changed',
      whatChanged: 'Block-wise schedule.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm37ae',
    form26: [{ clause: '37', subs: ['a', 'b', 'c', 'd', 'e'] }],
    sectionHeading: 'F – Losses, Depreciation and Deductions',
    office: {
      subject: 'Brought-forward loss; shareholding change; speculation loss; deemed speculation; specified business loss',
      section2025: '119; 113(1); 113(5); 114',
      section1961: '79; 73; Expl. to 73; 73A',
      threeCd: [{ clause: '32(a)–(e)', subject: 'Brought-forward loss; shareholding change; speculation loss; deemed speculation; specified business loss' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm38',
    form26: [{ clause: '38', subs: [] }],
    sectionHeading: 'F – Losses, Depreciation and Deductions',
    office: {
      subject: 'Chapter VIII deductions',
      section2025: 'Chapter VIII',
      section1961: 'Chapter VI-A',
      threeCd: [{ clause: '33', subject: 'Chapter VIII deductions' }],
      kind: 'changed',
      whatChanged: 'Section references change.',
    },
    // MAPPING-CHECK.md line 55 (row 38; 1961 column: D): Form 3CD clause 33 covers "Chapter VIA or Chapter III (Section 10A, Section 10AA)".
    // Domain review 2.2, row 38.
    corrected: {
      subject: 'Chapter VIII deductions',
      section2025: 'Chapter VIII',
      section1961: 'Chapter VI-A and Chapter III (sections 10A, 10AA)',
      threeCd: [{ clause: '33', subject: 'Chapter VIII deductions' }],
      kind: 'changed',
      whatChanged: 'Section references change.',
    },
    checkState: 'checked',
  },
  {
    id: 'm39',
    form26: [{ clause: '39', subs: [] }],
    sectionHeading: 'F – Losses, Depreciation and Deductions',
    office: {
      subject: 'Utilisation of MAT/AMT credit',
      section2025: '206',
      section1961: '115JAA, 115JD',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm40',
    form26: [{ clause: '40', subs: [] }],
    sectionHeading: 'G – International Taxation',
    office: {
      subject: 'Primary transfer-pricing adjustment',
      section2025: '170(1)',
      section1961: '92CE',
      threeCd: [{ clause: '30A', subject: 'Primary transfer-pricing adjustment' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm41a',
    form26: [{ clause: '41', subs: ['a'] }],
    sectionHeading: 'G – International Taxation',
    office: {
      subject: 'Interest exceeding specified limit',
      section2025: '177(1)',
      section1961: '94B',
      threeCd: [{ clause: '30B', subject: 'Interest exceeding specified limit' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm41bc',
    form26: [{ clause: '41', subs: ['b', 'c'] }],
    sectionHeading: 'G – International Taxation',
    office: {
      subject: 'Interest brought forward and carried forward',
      section2025: '177(5)',
      section1961: '94B(4)',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW. Running tally of interest carried forward.',
    },
    // MAPPING-CHECK.md line 59 (row 41(b), (c); 3CD column and "what has changed": D): Form 3CD clause 30B(b)(iv) and (v); not new in substance.
    // Domain review 2.2, row 41(b), (c).
    corrected: {
      subject: 'Interest brought forward and carried forward',
      section2025: '177(5)',
      section1961: '94B(4)',
      threeCd: [{ clause: '30B(b)(iv), (v)', subject: 'Details of interest expenditure brought forward; details of interest expenditure carried forward' }],
      kind: 'changed',
      whatChanged: 'Not new in substance; each is now a separate Yes/No with its own table.',
    },
    checkState: 'checked',
  },
  {
    id: 'm42',
    form26: [{ clause: '42', subs: [] }],
    sectionHeading: 'G – International Taxation',
    office: {
      subject: 'Disallowance under section 60',
      section2025: '60',
      section1961: '44C',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm43',
    form26: [{ clause: '43', subs: [] }],
    sectionHeading: 'G – International Taxation',
    office: {
      subject: 'Remittances reported in Part D of Form 145',
      section2025: 'Form 145',
      section1961: 'Form 15CA',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm44',
    form26: [{ clause: '44', subs: [] }],
    sectionHeading: 'H – Other Key Parameters',
    office: {
      subject: 'Amounts not to be included as income under 92(2)(m)',
      section2025: '92(2)(m)',
      section1961: '56(2)(x) provisos',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW. Reporting of exempt receipts under gift provisions.',
    },
    corrected: null,
    // MAPPING-CHECK.md line 62 (row 44; 1961 column: N): section 56 of the 1961 Act was not read.
    notConfirmable: ['section1961'],
    checkState: 'to_check',
  },
  {
    id: 'm45ad',
    form26: [{ clause: '45', subs: ['a', 'b', 'c', 'd'] }],
    sectionHeading: 'H – Other Key Parameters',
    office: {
      subject: 'Loans/deposits taken, cash receipts, cash payments, repayments beyond limits',
      section2025: '185(1), 186(1), 188(1)',
      section1961: '269SS, 269ST, 269T',
      threeCd: [{ clause: '31(a)–(d)', subject: 'Loans/deposits taken, cash receipts, cash payments, repayments beyond limits' }],
      kind: 'changed',
      whatChanged: 'Mode codes A to L introduced.',
    },
    // MAPPING-CHECK.md line 63 (row 45(a)-(d); 3CD column and "what has changed": D): clause 31 has (a) to (e); the codes A to L are already in Form 3CD.
    // Domain review 2.2, row 45(a) to (d).
    corrected: {
      subject: 'Loans/deposits taken, cash receipts, cash payments, repayments beyond limits',
      section2025: '185(1), 186(1), 188(1)',
      section1961: '269SS, 269ST, 269T',
      threeCd: [{ clause: '31(a)–(e)', subject: 'Loans/deposits taken, cash receipts, cash payments, repayments beyond limits' }],
      kind: 'changed',
      whatChanged: 'Mode codes A to L carried over from Form 3CD.',
    },
    checkState: 'checked',
  },
  {
    id: 'm46',
    form26: [{ clause: '46', subs: [] }],
    sectionHeading: 'H – Other Key Parameters',
    office: {
      subject: 'Statements in Forms 98/165/166/167',
      section2025: 'Forms 98, 165–167',
      section1961: 'Form 61/61A/61B; Form 3CEAC/3CEAD',
      threeCd: [
        { clause: '42', subject: 'Statements in Forms 98/165/166/167' },
        { clause: '43', subject: 'Statements in Forms 98/165/166/167' },
      ],
      kind: 'changed',
      whatChanged: 'Merged into one clause.',
    },
    // MAPPING-CHECK.md line 64 (row 46; 1961 column, 3CD column and "what has changed": D): clause 42 is carried over, clause 43 is not; Form No. 167 is new.
    // Domain review 2.2, row 46.
    corrected: {
      subject: 'Statements in Forms 98/165/166/167',
      section2025: 'Forms 98, 165–167',
      section1961: 'Form 61/61A/61B',
      threeCd: [{ clause: '42', subject: 'Statements in Forms 98/165/166/167' }],
      kind: 'changed',
      whatChanged: 'Form 3CD clause 43 is not carried into Form 26; Form No. 167 is added.',
    },
    checkState: 'checked',
  },
  {
    id: 'm47',
    form26: [{ clause: '47', subs: [] }],
    sectionHeading: 'H – Other Key Parameters',
    office: {
      subject: 'Transactions in unquoted shares',
      section2025: '',
      section1961: '56(2)(x), 50CA',
      threeCd: [
        { clause: '28', subject: 'Transactions in unquoted shares' },
        { clause: '29', subject: 'Transactions in unquoted shares' },
      ],
      kind: 'changed',
      whatChanged: 'Replaces share-premium and shares-below-FMV clauses.',
    },
    // MAPPING-CHECK.md line 65 (row 47; 3CD column and "what has changed": D): clauses 28 and 29 were omitted from Form 3CD from 1 April 2025.
    // Domain review 2.2, row 47.
    corrected: {
      subject: 'Transactions in unquoted shares',
      section2025: '',
      section1961: '56(2)(x), 50CA',
      threeCd: [],
      kind: 'changed',
      whatChanged: 'In effect a new, wider clause: every acquisition or transfer of unquoted shares. Form 3CD clauses 28 and 29 were omitted from 1 April 2025.',
    },
    checkState: 'checked',
  },
  {
    id: 'm48',
    form26: [{ clause: '48', subs: [] }],
    sectionHeading: 'H – Other Key Parameters',
    office: {
      subject: 'Loan or advance treated as deemed dividend',
      section2025: '2(40)(e)',
      section1961: '2(22)(e)',
      threeCd: [{ clause: '36A', subject: 'Loan or advance treated as deemed dividend' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    // MAPPING-CHECK.md line 66 (row 48; "what has changed": D): Form 3CD 36A asks about an amount received; clause 48 about an advance or loan paid.
    // Domain review 2.2, row 48 ("The receipt side is row (i) of the table headed "20.""); the table is named, not a
    // clause, as for row 21 above.
    corrected: {
      subject: 'Loan or advance treated as deemed dividend',
      section2025: '2(40)(e)',
      section1961: '2(22)(e)',
      threeCd: [{ clause: '36A', subject: 'Loan or advance treated as deemed dividend' }],
      kind: 'changed',
      whatChanged: 'Now asked of the payer. The receipt is reported in row "(i) 2(40)(e)" of the table headed "20.", which opens under clause 20.',
    },
    checkState: 'checked',
  },
  {
    id: 'm49',
    form26: [{ clause: '49', subs: [] }],
    sectionHeading: 'I – TDS / TCS',
    office: {
      subject: 'All TANs held',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '34', part: true, subject: 'All TANs held' }],
      kind: 'changed',
      whatChanged: 'Separate clause for all TANs.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm50ab',
    form26: [{ clause: '50', subs: ['a', 'b'] }],
    sectionHeading: 'I – TDS / TCS',
    office: {
      subject: 'TDS/TCS particulars and statements',
      section2025: 'Chapter XIX-B',
      section1961: 'Chapter XVII-B / XVII-BB',
      threeCd: [{ clause: '34(a), (b)', subject: 'TDS/TCS particulars and statements' }],
      kind: 'changed',
      whatChanged: 'Added column for tax deducted at a lower rate; columns for transactions not reported.',
    },
    // MAPPING-CHECK.md line 68 (row 50(a), (b); "what has changed": D): the lower-rate column is Form 3CD 34(a) column (8); what is new is in 50(b).
    // Domain review 2.2, row 50(a), (b).
    corrected: {
      subject: 'TDS/TCS particulars and statements',
      section2025: 'Chapter XIX-B',
      section1961: 'Chapter XVII-B / XVII-BB',
      threeCd: [{ clause: '34(a), (b)', subject: 'TDS/TCS particulars and statements' }],
      kind: 'changed',
      whatChanged: '50(a): no change in substance. 50(b): numbers of transactions reported and not reported, and the amount not reported.',
    },
    checkState: 'checked',
  },
  {
    id: 'm50c',
    form26: [{ clause: '50', subs: ['c'] }],
    sectionHeading: 'I – TDS / TCS',
    office: {
      subject: 'Interest on late deduction or payment',
      section2025: '398(3)(a)',
      section1961: '201(1A), 206C(7)',
      threeCd: [{ clause: '34(c)', subject: 'Interest on late deduction or payment' }],
      kind: 'same',
      whatChanged: 'No change in substance.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm51ac',
    form26: [{ clause: '51', subs: ['a', 'c'] }],
    sectionHeading: 'I – TDS / TCS',
    office: {
      subject: 'Disallowance for TDS default – non-resident and resident payments',
      section2025: '35(b)(i), 35(b)(ii)',
      section1961: '40(a)(i), 40(a)(ia)',
      threeCd: [{ clause: '21(b)', subject: 'Disallowance for TDS default – non-resident and resident payments' }],
      kind: 'changed',
      whatChanged: 'Moved from expenses to the TDS section.',
    },
    // MAPPING-CHECK.md line 70 (row 51(a), (c); subject, 2025 and 1961 columns: D — the order is crossed): 51(a) = 35(b)(i), resident, 30% = 40(a)(ia) = Form 3CD 21(b)(ii); 51(c) = 35(b)(ii), outside India or non-resident, 100% = 40(a)(i) = Form 3CD 21(b)(i).
    // Domain review 2.2, row 51(a), (c).
    corrected: {
      subject: 'Disallowance for TDS default – resident payments (51(a)) and payments outside India or to a non-resident (51(c))',
      section2025: '51(a): 35(b)(i), 30%; 51(c): 35(b)(ii), 100%',
      section1961: '51(a): 40(a)(ia); 51(c): 40(a)(i)',
      threeCd: [
        { clause: '21(b)(ii)', subject: 'Resident payments (51(a))' },
        { clause: '21(b)(i)', subject: 'Payments outside India or to a non-resident (51(c))' },
      ],
      kind: 'changed',
      whatChanged: 'Moved from expenses to the TDS section.',
    },
    checkState: 'checked',
  },
  {
    id: 'm51bd',
    form26: [{ clause: '51', subs: ['b', 'd'] }],
    sectionHeading: 'I – TDS / TCS',
    office: {
      subject: 'Same disallowances allowed in a later year',
      section2025: '35(b)(i), 35(b)(ii)',
      section1961: 'Provisos to 40(a)(i)/(ia)',
      threeCd: [],
      kind: 'new',
      whatChanged: 'NEW. Reversal reporting.',
    },
    corrected: null,
    // MAPPING-CHECK.md line 71 (row 51(b), (d); 1961 column: N): the proviso to 40(a)(i) was not read.
    notConfirmable: ['section1961'],
    checkState: 'to_check',
  },
  {
    id: 'm52a',
    form26: [{ clause: '52', subs: ['a'] }],
    sectionHeading: 'J – Indirect Taxation',
    office: {
      subject: 'Registration / identification numbers',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '4', subject: 'Registration / identification numbers' }],
      kind: 'changed',
      whatChanged: 'Moved into Schedule – GST.',
    },
    corrected: null,
    checkState: 'checked',
  },
  {
    id: 'm52b',
    form26: [{ clause: '52', subs: ['b'] }],
    sectionHeading: 'J – Indirect Taxation',
    office: {
      subject: 'Expenditure split: GST-registered, unregistered, exempt supplies',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '44', subject: 'Expenditure split: GST-registered, unregistered, exempt supplies' }],
      kind: 'changed',
      whatChanged: 'Retained; through Schedule – GST.',
    },
    // MAPPING-CHECK.md line 73 (row 52(b); "what has changed": D): three lines only; no reconciliation with the entries of expenditure (FAQ 20).
    // Domain review 2.2, row 52(b).
    corrected: {
      subject: 'Expenditure split: GST-registered, unregistered, exempt supplies',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '44', subject: 'Expenditure split: GST-registered, unregistered, exempt supplies' }],
      kind: 'changed',
      whatChanged: 'Retained in a simpler form: three lines, no reconciliation.',
    },
    checkState: 'checked',
  },
  {
    id: 'm53ab',
    form26: [{ clause: '53', subs: ['a', 'b'] }],
    sectionHeading: 'K – Quantitative Details',
    office: {
      subject: 'Trading unit / manufacturing concern',
      section2025: '',
      section1961: '',
      threeCd: [{ clause: '35', subject: 'Trading unit / manufacturing concern' }],
      kind: 'changed',
      whatChanged: 'Yes/No gateway; detailed table follows on "Yes".',
    },
    corrected: null,
    checkState: 'checked',
  },
];

// What the office's document marks beside its own entries: a dagger on a cell (its own reading of a new
// section number, to be confirmed against the notified Act and Rules) and, on two rows, a reminder.
// All twelve marked cells were checked (MAPPING-CHECK.md line 141). Data only; never rendered.
export const FORM26_MAPPING_OFFICE_MARKS: Record<string, { daggerCells: ('section2025' | 'section1961')[]; note?: string }> = {
  m26: { daggerCells: ['section2025'] },
  m27a: { daggerCells: ['section2025', 'section1961'], note: 'Check against notified Rules.' },
  m27b: { daggerCells: ['section2025'] },
  m36: { daggerCells: ['section2025'] },
  m39: { daggerCells: ['section2025'] },
  m42: { daggerCells: ['section2025', 'section1961'], note: 'Check against notified Rules.' },
  m43: { daggerCells: ['section2025', 'section1961'] },
  m46: { daggerCells: ['section2025', 'section1961'] },
};

// Shown positions: a row of the table headed "20." is named by that table, which this tool (as the owner's file)
// opens under clause 20 (AS-BUILT-DEFINITION, schedule s20), never by "clause 21"; a Form 3CD clause with no
// place says "Not in Form 26." as the domain review 2.5 does (the office's "Not found in the file." is kept in
// its own entries).
export const FORM26_NOT_IN_FORM26: Form26NotInForm26Row[] = [
  // MAPPING-CHECK.md line 82 (25: C, "and firmer than appears"): Schedule row "(iv) 38 – Deemed Profits and Gains", reached through clause 21. Domain review 2.5.
  { id: 'n25', office: { threeCd: '25', subject: 'Profits chargeable under section 41', position: 'No separate clause; appears to be covered by clause 21.' }, corrected: { threeCd: '25', subject: 'Profits chargeable under section 41', position: 'No separate clause; covered by row "(iv) 38" of the table headed "20.", which opens under clause 20.' } },
  // MAPPING-CHECK.md line 83 (27(a): C). Domain review 2.5: "Not in Form 26. As the mapping says."
  { id: 'n27a', office: { threeCd: '27(a)', subject: 'CENVAT / input tax credit treatment', position: 'Not found in the file.' }, corrected: { threeCd: '27(a)', subject: 'CENVAT / input tax credit treatment', position: 'Not in Form 26.' } },
  // MAPPING-CHECK.md line 84 (29A: D): it IS in Form 26 — Schedule row "(vii) 92(2)(h) – Advance Forfeiture", reached through clause 21. Not in the corrected list; see row m21.
  { id: 'n29A', office: { threeCd: '29A', subject: 'Income under section 56(2)(ix)', position: 'Not found in the file.' }, corrected: null },
  // MAPPING-CHECK.md line 85 (30C: C). Domain review 2.5: "Not in Form 26. As the mapping says."
  { id: 'n30C', office: { threeCd: '30C', subject: 'GAAR – impermissible avoidance arrangement', position: 'Not found in the file.' }, corrected: { threeCd: '30C', subject: 'GAAR – impermissible avoidance arrangement', position: 'Not in Form 26.' } },
  // MAPPING-CHECK.md line 86 (36: C).
  { id: 'n36', office: { threeCd: '36', subject: 'Dividend distribution tax', position: 'Dropped (already obsolete).' }, corrected: { threeCd: '36', subject: 'Dividend distribution tax', position: 'Dropped (already obsolete).' } },
  // MAPPING-CHECK.md line 87 (38, 39: C).
  { id: 'n38_39', office: { threeCd: '38, 39', subject: 'Central excise and service tax audits', position: 'Dropped.' }, corrected: { threeCd: '38, 39', subject: 'Central excise and service tax audits', position: 'Dropped.' } },
  // MAPPING-CHECK.md line 88 (41: C). Domain review 2.5: "Not in Form 26. As the mapping says."
  { id: 'n41', office: { threeCd: '41', subject: 'Demands and refunds under other tax laws', position: 'Not found in the file.' }, corrected: { threeCd: '41', subject: 'Demands and refunds under other tax laws', position: 'Not in Form 26.' } },
  // MAPPING-CHECK.md line 94; domain review 2.5.
  { id: 'n43', office: null, corrected: { threeCd: '43', subject: 'Country-by-country report (section 286(2))', position: 'Not in Form 26.' } },
  // MAPPING-CHECK.md line 95; domain review 2.5.
  { id: 'n36B', office: null, corrected: { threeCd: '36B', subject: 'Whether the assessee has received any amount for buyback of shares as referred to in sub-clause (f) of clause (22) of section 2', position: 'Row "(ii) 2(40)(f)" of the table headed "20.", which opens under clause 20. Section 2(40)(f) was omitted by the Finance Act, 2026 from 1 April 2026.' } },
  // MAPPING-CHECK.md line 96; domain review 2.5.
  { id: 'n28_29', office: null, corrected: { threeCd: '28, 29', subject: 'Shares received / issued', position: 'Omitted from Form 3CD itself from 1 April 2025. Clause 47 covers unquoted shares generally.' } },
  // MAPPING-CHECK.md line 97; domain review 2.5.
  { id: 'n24', office: null, corrected: { threeCd: '24', subject: 'Amounts deemed to be profits and gains under section 32AC or 32AD or 33AB or 33ABA or 33AC', position: 'Rows (v) and (vi) of the table headed "20.", which opens under clause 20.' } },
  // MAPPING-CHECK.md line 98; domain review 2.5.
  { id: 'n11ac', office: null, corrected: { threeCd: '11(a), 11(c)', subject: 'Books prescribed under section 44AA; books of account and documents examined', position: 'Not in Form 26.' } },
  // MAPPING-CHECK.md line 99; domain review 2.5.
  { id: 'n16ac', office: null, corrected: { threeCd: '16(a)–(c)', subject: 'Items within section 28; proforma credits, drawbacks, refunds of duty; escalation claims — not credited to the profit and loss account', position: 'Rows (iii) and (x) of the table headed "20.", which opens under clause 20.' } },
  // MAPPING-CHECK.md line 100; domain review 2.5.
  { id: 'n18', office: null, corrected: { threeCd: '18 (detail)', subject: 'Asset-wise additions "with dates", date put to use, CENVAT, exchange-rate and subsidy adjustments', position: 'Replaced by the block tables of Schedule 36 (180 days or more; less than 180 days).' } },
  // MAPPING-CHECK.md line 101; domain review 2.5.
  { id: 'n26', office: null, corrected: { threeCd: '26 (closing words)', subject: 'Whether indirect taxes are passed through the profit and loss account', position: 'Not in Form 26.' } },
  // MAPPING-CHECK.md line 102; domain review 2.5.
  { id: 'n21b', office: null, corrected: { threeCd: '21(b)(i), (ii) detail', subject: 'Payee-wise details of each payment (date, amount, nature, name and address)', position: 'Schedules 51(a) and 51(c) ask nature of violation, nature of expenditure, payee, PAN, amount; no date, no address.' } },
];

export function shownEntry(row: Form26MappingRow, shown: 'corrected' | 'office' = FORM26_MAPPING_SHOWN): Form26MappingEntry {
  if (shown === 'office' || row.corrected === null) return row.office;
  if (!row.notConfirmable || row.notConfirmable.length === 0) return row.corrected;
  const entry: Form26MappingEntry = { ...row.corrected };
  for (const cell of row.notConfirmable) entry[cell] = row.office[cell];
  return entry;
}

/** The list "Form 3CD clauses without a clause of their own in Form 26", as shown. */
export function shownNotInForm26(shown: 'corrected' | 'office' = FORM26_MAPPING_SHOWN): Form26NotInForm26Entry[] {
  const entries: Form26NotInForm26Entry[] = [];
  for (const row of FORM26_NOT_IN_FORM26) {
    const entry = shown === 'office' ? row.office : row.corrected;
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/**
 * The mapping rows that cover a clause of Form 26 ('9' … '53'). Without a sub-clause: every row of the clause.
 * With one ('a' … 'e'): the rows that name it, and a row that covers the whole clause.
 */
export function mappingRowsForClause(clauseNo: string, sub?: string | null): Form26MappingRow[] {
  return FORM26_MAPPING.filter((row) =>
    row.form26.some((ref) => ref.clause === clauseNo && (sub === null || sub === undefined || ref.subs.length === 0 || ref.subs.includes(sub))));
}

/** True where the corrected mapping says the substance of the clause has not changed from Form 3CD. */
export function isSameSubstance(row: Form26MappingRow): boolean {
  return shownEntry(row, 'corrected').kind === 'same';
}
