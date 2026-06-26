import {
  buildAuditorResponsibilitiesParagraph,
  BASIS_FOR_OPINION_STARTER,
  buildKAMIntro,
  buildOpinionHeading,
  buildOpinionParagraph,
  buildSA720Paragraph,
  buildManagementResponsibilitiesParagraph,
} from '@/data/auditReportStandardWordings';
import { buildLegalRegulatorySection } from '@/data/legalRegulatoryWordings';
import type { AuditReportSetup } from '@/hooks/useAuditReportSetup';
import type { AuditReportMainContent } from '@/hooks/useAuditReportContent';
import type { KeyAuditMatter } from '@/hooks/useKeyAuditMatters';
import type { FirmSettings } from '@/hooks/useFirmSettings';
import type { Partner } from '@/hooks/usePartners';

const KAM_ENABLED = false;

export type ReportBlock =
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'paragraph'; text: string; highlight?: 'yellow' }
  | { kind: 'signature'; lines: string[] };

export type GenerateParams = {
  setup: AuditReportSetup;
  content: AuditReportMainContent;
  kams: KeyAuditMatter[];
  clientName: string;
  financialYearLabel: string;
  firmSettings?: FirmSettings;
  signingPartner?: Partner;
};

function cleanLines(lines: Array<string | null | undefined>) {
  return lines.map((l) => (l || '').trim()).filter(Boolean);
}

export class AuditReportGenerator {
  constructor(private params: GenerateParams) {}

  generateBlocks(): ReportBlock[] {
    const { setup, content, kams, clientName, financialYearLabel, firmSettings, signingPartner } = this.params;

    const emphasisExample1 =
      'We draw attention to Note ______ of the standalone financial statements___________________________________ which describes_______________________________________(user defined)';
    const emphasisExample2 =
      'We draw attention to Note ______ of the standalone financial statements___________________________________ which describes________________ (user defined)';
    const emphasisStandardTail = 'Our opinion is not modified in respect of this matter';

    const includeCashFlow = Boolean(setup.cash_flow_required);
    const addressee = `To the Members of ${clientName}`;

    const blocks: ReportBlock[] = [
      { kind: 'title', text: 'Independent Auditor’s Report' },
      { kind: 'subtitle', text: addressee },
      { kind: 'heading', text: 'Report on the Audit of the Standalone Financial Statements' },
      {
        kind: 'subheading',
        text: buildOpinionHeading(content.opinion_type),
      },
      {
        kind: 'paragraph',
        text: buildOpinionParagraph({
          opinionType: content.opinion_type,
          entityName: clientName,
          periodEndLabel: financialYearLabel,
          includeCashFlow,
          hasBranchAuditors: Boolean(setup.has_branch_auditors),
          branchLocations: setup.branch_locations,
          profitOrLoss: setup.company_profit_or_loss as 'profit' | 'loss' | null,
          ifcApplicable: Boolean(setup.ifc_applicable),
          ifcAnnexureLetter: setup.ifc_annexure_letter,
        }),
      },
    ];

    // Basis for Opinion
    blocks.push({ kind: 'subheading', text: this.basisHeading(content.opinion_type) });
    const rawBasis = content.basis_for_opinion_is_example ? '' : content.basis_for_opinion?.trim();
    // Qualified opinion: render user basis first, then always show the standard auditor-responsibilities paragraph
    if (content.opinion_type === 'qualified') {
      if (rawBasis) {
        blocks.push({ kind: 'paragraph', text: rawBasis });
      }
      // Always append the standard second paragraph (auditor responsibilities / independence wording) unhighlighted
      blocks.push({ kind: 'paragraph', text: BASIS_FOR_OPINION_STARTER['qualified'] });
    } else if (content.opinion_type === 'adverse') {
      // Adverse opinion: first line is user-defined reason, then constant starter
      if (rawBasis) {
        blocks.push({ kind: 'paragraph', text: rawBasis });
      }
      blocks.push({ kind: 'paragraph', text: BASIS_FOR_OPINION_STARTER['adverse'] });
    } else if (content.opinion_type === 'disclaimer') {
      // Disclaimer: entirely user-defined single paragraph; no constant second paragraph
      if (rawBasis) {
        blocks.push({ kind: 'paragraph', text: rawBasis });
      }
    } else {
      // Unqualified opinion: always use the standard starter wording
      blocks.push({ kind: 'paragraph', text: BASIS_FOR_OPINION_STARTER['unqualified'] });
    }

    // Emphasis of Matter
    if (content.has_emphasis_of_matter) {
      blocks.push({ kind: 'subheading', text: 'Emphasis of Matter' });

      const eomItems = content.emphasis_of_matter_items || [];
      if (eomItems.length > 0) {
        for (const item of eomItems) {
          blocks.push({ kind: 'paragraph', text: item.paragraph || '', highlight: item.is_example ? 'yellow' : undefined });
        }
      } else {
        // Prefill illustrative examples in yellow to prompt user edits
        blocks.push({ kind: 'paragraph', text: emphasisExample1, highlight: 'yellow' });
        blocks.push({ kind: 'paragraph', text: emphasisExample2, highlight: 'yellow' });
      }

      // Always append the standard non-highlighted closing sentence
      blocks.push({ kind: 'paragraph', text: emphasisStandardTail });
    }

    // Going concern
    if (content.has_going_concern_uncertainty) {
      blocks.push({ kind: 'subheading', text: 'Material Uncertainty Related to Going Concern' });
      blocks.push({
        kind: 'paragraph',
        text:
          content.going_concern_details?.trim() ||
          '[Describe the material uncertainty related to going concern and relevant disclosures.]',
      });
      if (content.going_concern_note_ref) {
        blocks.push({ kind: 'paragraph', text: `Note reference: ${content.going_concern_note_ref}` });
      }
    }

    // Key Audit Matters
    const includeKams = KAM_ENABLED && Boolean(content.include_kam ?? setup.is_listed_company);
    if (includeKams && kams.length > 0) {
      blocks.push({ kind: 'subheading', text: 'Key Audit Matters' });
      blocks.push({ kind: 'paragraph', text: buildKAMIntro() });
      for (const kam of kams) {
        blocks.push({ kind: 'paragraph', text: kam.title });
        blocks.push({ kind: 'paragraph', text: `Description: ${kam.description}` });
        blocks.push({ kind: 'paragraph', text: `How our audit addressed the matter: ${kam.audit_response}` });
      }
    }

    // Other Information (SA 720)
    blocks.push({
      kind: 'subheading',
      text: 'Information Other than the Standalone Financial Statements and Auditor’s Report Thereon',
    });
    {
      const status = content.board_report_status || 'received_no_misstatement';
      const details = content.board_report_misstatement_details;
      const text = buildSA720Paragraph(status, details);
      const highlight = status === 'received_material_misstatement' && !details ? 'yellow' : undefined;
      blocks.push({ kind: 'paragraph', text, highlight });
    }

    // Responsibilities
    blocks.push({ kind: 'subheading', text: 'Responsibilities of Management and Those Charged with Governance for the Standalone Financial Statements' });
    blocks.push({ kind: 'paragraph', text: buildManagementResponsibilitiesParagraph(includeCashFlow) });

    blocks.push({ kind: 'subheading', text: "Auditor's Responsibilities for the Audit of the Standalone Financial Statements" });
    blocks.push({ kind: 'paragraph', text: buildAuditorResponsibilitiesParagraph(Boolean(setup.ifc_applicable), includeKams) });

    // Other Matter
    const hasBranchAuditorsMatter = setup.has_branch_auditors;
    const hasPredecessorAuditorMatter = setup.has_predecessor_auditor;
    
    // Check if user has provided actual content in other matter items
    const userOtherMatterItems = (content.other_matter_items || []).filter(item => item.paragraph?.trim());
    const hasUserOtherMatterContent = userOtherMatterItems.length > 0;
    
    if (content.has_other_matter || hasBranchAuditorsMatter || hasPredecessorAuditorMatter) {
      blocks.push({ kind: 'subheading', text: 'Other Matter' });
      
      // Mandatory branch auditors paragraph (highlighted yellow) + closing sentence (not highlighted)
      if (hasBranchAuditorsMatter) {
        const branchAuditorsParagraph = `We did not audit the financial statements/ information of ………………. (number) branches included in the standalone financial statements of the company whose financial statements/financial information reflect total assets of Rs. ……...as at ${financialYearLabel} and total revenue of Rs. ……for the year ended on that date, as considered in the standalone financial statements. The financial statements/information of these branches have been audited by the branch auditors whose reports have been furnished to us, and our opinion in so far as it relates to the amounts and disclosures included in respect of these branches, is based solely on the report of such branch auditors.`;
        blocks.push({ kind: 'paragraph', text: branchAuditorsParagraph, highlight: 'yellow' });
        blocks.push({ kind: 'paragraph', text: 'Our opinion is not modified in respect of this matter.' });
      }
      
      // Mandatory predecessor auditor paragraph (highlighted yellow) + closing sentence (not highlighted)
      if (hasPredecessorAuditorMatter) {
        const predecessorAuditorParagraph = `The comparative financial information of the Company included in these standalone financial statements, are based on the previously issued standalone financial statements for the year ended ${financialYearLabel}, which were audited by the predecessor auditors who, vide their report dated ______________, expressed an unmodified opinion.`;
        blocks.push({ kind: 'paragraph', text: predecessorAuditorParagraph, highlight: 'yellow' });
        blocks.push({ kind: 'paragraph', text: 'Our opinion is not modified in respect of this matter.' });
      }
      
      // User-defined other matter items (title is internal only, not rendered in preview)
      if (hasUserOtherMatterContent) {
        for (const item of userOtherMatterItems) {
          blocks.push({ kind: 'paragraph', text: item.paragraph.trim() });
        }
        // Add closing line after user-defined other matter
        blocks.push({ kind: 'paragraph', text: 'Our opinion is not modified in respect of this matter.' });
      } else if (content.has_other_matter && !hasBranchAuditorsMatter && !hasPredecessorAuditorMatter) {
        // User selected other matter but provided no content and no mandatory matters
        blocks.push({ kind: 'paragraph', text: "USER DEFINED - kinldy fill up - in case applicable-else remove this 'other matter' paragraph", highlight: 'yellow' });
        blocks.push({ kind: 'paragraph', text: 'Our opinion is not modified in respect of this matter.' });
      }
    }

    // Legal & Regulatory requirements
    blocks.push({ kind: 'heading', text: 'Report on Other Legal and Regulatory Requirements' });
    
    // Build comprehensive section with all conditional paragraphs
    const legalRegulatoryParagraphs = buildLegalRegulatorySection(setup, content, financialYearLabel, content.opinion_type || 'unqualified');
    for (const para of legalRegulatoryParagraphs) {
      blocks.push({ kind: 'paragraph', text: para.text, highlight: para.highlight });
    }

    // Signature - prioritize firmSettings and signingPartner from partners table
    const firmName = firmSettings?.firm_name || content.firm_name;
    const firmRegNo = firmSettings?.firm_registration_no || content.firm_registration_no;
    const partnerName = signingPartner?.name || content.partner_name;
    const membershipNo = signingPartner?.membership_number || content.membership_no;

    const signatureLines = cleanLines([
      firmName ? `For ${firmName}` : 'For [Firm Name]',
      'Chartered Accountants',
      firmRegNo ? `Firm Registration No.: ${firmRegNo}` : null,
      '',
      partnerName ? `${partnerName}` : '[Partner Name]',
      'Partner',
      membershipNo ? `Membership No.: ${membershipNo}` : null,
      setup.udin ? `UDIN: ${setup.udin}` : null,
      '',
      setup.report_city ? `Place: ${setup.report_city}` : null,
      setup.report_date ? `Date: ${setup.report_date}` : null,
    ]);

    blocks.push({ kind: 'signature', lines: signatureLines });

    return blocks;
  }

  private basisHeading(opinionType: AuditReportMainContent['opinion_type']) {
    switch (opinionType) {
      case 'unqualified':
        return 'Basis for Opinion';
      case 'qualified':
        return 'Basis for Qualified Opinion';
      case 'adverse':
        return 'Basis for Adverse Opinion';
      case 'disclaimer':
        return 'Basis for Disclaimer of Opinion';
    }
  }

  private build1433Summary(content: AuditReportMainContent) {
    // Minimal structured starter. Users can replace/extend text in future iterations.
    const lines = cleanLines([
      'As required by the Companies (Auditor’s Report) Order, 2020 ("CARO 2020"), issued by the Central Government of India in terms of section 143(11) of the Act, we give in the Annexure a statement on the matters specified in paragraphs 3 and 4 of the Order (to the extent applicable).',
      content.clause_143_3_a_status ? `143(3)(a) Proper books of account: ${content.clause_143_3_a_status}` : null,
      content.clause_143_3_a_details || null,
      content.clause_143_3_b_audit_trail_status ? `143(3)(b) Audit trail: ${content.clause_143_3_b_audit_trail_status}` : null,
      content.clause_143_3_b_audit_trail_details || null,
      content.clause_143_3_c_branch_returns ? `143(3)(c) Branch returns: ${content.clause_143_3_c_branch_returns}` : null,
      content.clause_143_3_e_going_concern_impact ? `143(3)(e) Going concern impact: ${content.clause_143_3_e_going_concern_impact}` : null,
      content.clause_143_3_f_directors_disqualified != null
        ? `143(3)(f) Directors disqualified: ${content.clause_143_3_f_directors_disqualified ? 'Yes' : 'No'}`
        : null,
      content.clause_143_3_f_disqualified_details || null,
      content.clause_143_3_g_qualification_impact ? `143(3)(g) Qualification impact: ${content.clause_143_3_g_qualification_impact}` : null,
      content.clause_143_3_h_remuneration_status ? `197(16) - Managerial Remuneration: ${content.clause_143_3_h_remuneration_status}` : null,
      content.clause_143_3_h_details || null,
      content.clause_143_3_i_ifc_qualification ? `143(3)(i) IFC: ${content.clause_143_3_i_ifc_qualification}` : null,
    ]);

    return lines.join('\n');
  }

  private buildRule11Summary(content: AuditReportMainContent) {
    const lines = cleanLines([
      'As required by Rule 11 of the Companies (Audit and Auditors) Rules, 2014, in our opinion and to the best of our information and according to the explanations given to us:',
      content.rule_11_a_pending_litigations ? `Rule 11(a) Pending litigations: ${content.rule_11_a_pending_litigations}` : null,
      content.rule_11_b_long_term_contracts ? `Rule 11(b) Long-term contracts including derivatives: ${content.rule_11_b_long_term_contracts}` : null,
      content.rule_11_c_iepf_status ? `Rule 11(c) IEPF transfers: ${content.rule_11_c_iepf_status}` : null,
      content.rule_11_c_delay_details || null,
      content.rule_11_g_funds_advanced_status ? `Rule 11(e) Funds routing via intermediaries: ${content.rule_11_g_funds_advanced_status}` : null,
      content.rule_11_g_funds_advanced_details || null,
      content.rule_11_e_dividend_status ? `Rule 11(f) Dividend (Section 123 compliance): ${content.rule_11_e_dividend_status}` : null,
      content.rule_11_f_audit_trail_status ? `Rule 11(g) Audit trail (Rule 3(1)): ${content.rule_11_f_audit_trail_status}` : null,
      content.rule_11_f_audit_trail_details || null,
    ]);

    return lines.join('\n');
  }
}
