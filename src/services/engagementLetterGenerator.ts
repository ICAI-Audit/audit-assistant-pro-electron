// ============================================================================
// ENGAGEMENT LETTER GENERATION SERVICE (ORCHESTRATOR)
// ============================================================================
// Master service that coordinates master data → template selection → rendering → DOCX generation

import type { EngagementLetterMasterData, GeneratedLetterResult } from '@/types/engagementLetter';

/**
 * Main service for end-to-end engagement letter generation
 */
export class EngagementLetterGenerator {
  /**
   * Generate engagement letter in one operation
   * @param masterData Complete master data input
   * @returns Promise<GeneratedLetterResult> with DOCX buffer and metadata
   */
  static async generateLetter(masterData: EngagementLetterMasterData): Promise<GeneratedLetterResult> {
    try {
      this.validateMasterData(masterData);
      return {
        success: false,
        error: 'Uploaded engagement letter template is required. Generate letters through the uploaded-template workflow.',
        letter_type: masterData.engagement_type,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
        letter_type: masterData.engagement_type,
        generated_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Validate master data completeness and consistency
   */
  private static validateMasterData(masterData: EngagementLetterMasterData): void {
    const errors: string[] = [];

    // Validate engagement type
    const validTypes = [
      'statutory_audit_company_with_ifc',
      'statutory_audit_company_without_ifc',
      'tax_audit_partnership_3ca',
      'tax_audit_partnership_3cb',
    ];
    if (!validTypes.includes(masterData.engagement_type)) {
      errors.push(`Invalid engagement_type: ${masterData.engagement_type}`);
    }

    // Validate entity details
    if (!masterData.entity?.entity_name?.trim()) errors.push('entity.entity_name is required');
    if (!masterData.entity?.entity_type?.trim()) errors.push('entity.entity_type is required');
    if (!masterData.entity?.registration_no?.trim()) errors.push('entity.registration_no is required');
    if (!masterData.entity?.email?.trim()) errors.push('entity.email is required');

    // Validate period
    if (!masterData.period?.financial_year?.trim()) errors.push('period.financial_year is required');
    if (!masterData.period?.balance_sheet_date?.trim()) errors.push('period.balance_sheet_date is required');

    // Validate auditor
    if (!masterData.auditor?.firm_name?.trim()) errors.push('auditor.firm_name is required');
    if (!masterData.auditor?.partner_name?.trim()) errors.push('auditor.partner_name is required');
    if (!masterData.auditor?.place?.trim()) errors.push('auditor.place is required');

    // Validate commercial
    if (!masterData.commercial?.professional_fees) errors.push('commercial.professional_fees is required');

    // Conditional validations
    if (masterData.engagement_type.includes('statutory')) {
      if (!masterData.statutory_audit_config)
        errors.push('statutory_audit_config is required for statutory audit letters');
    }

    if (masterData.engagement_type.includes('tax_audit')) {
      if (!masterData.tax_audit_config) errors.push('tax_audit_config is required for tax audit letters');
      if (!masterData.period?.assessment_year)
        errors.push('period.assessment_year is required for tax audit letters');
    }

    if (errors.length > 0) {
      throw new Error(`Master data validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Get available engagement letter options
   */
  static getAvailableLetterTypes() {
    return [
      {
        id: 'statutory_audit_company_with_ifc',
        label: 'Statutory Audit - Unlisted Company with IFC',
        description: 'For unlisted companies with Internal Financial Controls (IFC) reporting requirements',
        category: 'Statutory Audit',
      },
      {
        id: 'statutory_audit_company_without_ifc',
        label: 'Statutory Audit - Unlisted Company without IFC',
        description: 'For companies where IFC audit is not applicable',
        category: 'Statutory Audit',
      },
      {
        id: 'tax_audit_partnership_3ca',
        label: 'Tax Audit - (3CA - Audited)',
        description: 'For entities with audited financial statements (Form 3CA)',
        category: 'Tax Audit',
      },
      {
        id: 'tax_audit_partnership_3cb',
        label: 'Tax Audit - (3CB - Non-Audited)',
        description: 'For entities with non-audited financial statements (Form 3CB)',
        category: 'Tax Audit',
      },
    ];
  }

  /**
   * Get required fields for a given engagement type
   */
  static getRequiredFieldsForType(engagementType: string) {
    const baseFields = [
      // Entity
      'entity.entity_name',
      'entity.entity_type',
      'entity.registration_no',
      'entity.email',
      'entity.phone',
      // Period
      'period.financial_year',
      'period.balance_sheet_date',
      'period.appointment_date',
      // Auditor
      'auditor.firm_name',
      'auditor.partner_name',
      'auditor.place',
      // Commercial
      'commercial.professional_fees',
    ];

    const conditionalFields: Record<string, string[]> = {
      statutory_audit_company_with_ifc: [
        'statutory_audit_config.ifc_applicable',
        'statutory_audit_config.caro_applicable',
        'statutory_audit_config.ind_as_applicable',
      ],
      statutory_audit_company_without_ifc: [
        'statutory_audit_config.ifc_applicable',
        'statutory_audit_config.caro_applicable',
        'statutory_audit_config.ind_as_applicable',
      ],
      tax_audit_partnership_3ca: [
        'period.assessment_year',
        'tax_audit_config.tax_audit_form',
        'tax_audit_config.audited_under_other_law',
        'tax_audit_config.accounting_standard',
      ],
      tax_audit_partnership_3cb: [
        'period.assessment_year',
        'tax_audit_config.tax_audit_form',
        'tax_audit_config.accounting_standard',
      ],
    };

    return [
      ...baseFields,
      ...(conditionalFields[engagementType] || []),
    ];
  }

  /**
   * Batch generate multiple letter types from same master data
   * (for future use: generate all applicable letters in one operation)
   */
  static async generateMultipleLetters(
    masterData: EngagementLetterMasterData,
    letterTypes: string[]
  ): Promise<GeneratedLetterResult[]> {
    const results: GeneratedLetterResult[] = [];

    for (const letterType of letterTypes) {
      const singleMasterData = {
        ...masterData,
        engagement_type: letterType as any,
      };

      const result = await this.generateLetter(singleMasterData);
      results.push(result);
    }

    return results;
  }
}

