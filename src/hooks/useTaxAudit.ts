import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';
import { FORM_3CD_CLAUSES, TAX_AUDIT_STATUTORY_VERSION } from '@/data/taxAudit3CDClauses';
import {
  TaxAuditAcceptanceCheck,
  TaxAuditClauseDefinition,
  TaxAuditClauseEvidence,
  TaxAuditClauseResponse,
  TaxAuditPrefillStatus,
  TaxAuditReviewStatus,
  TaxAuditSetup,
  TaxAuditSourceLink,
  TaxAuditSummary,
} from '@/types/taxAudit';
import {
  deriveAssessmentYear,
  derivePreviousYearRange,
} from '@/utils/tax-audit/applicability';
import { calculateApplicability, TaxAuditApplicabilityInputs } from '@/lib/taxAuditApplicability';

const db = getSQLiteClient();

const toBoolNumber = (value: boolean | number | undefined | null) => (value === true || value === 1 ? 1 : 0);

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stringify = (value: unknown) => JSON.stringify(value ?? null);

const sourceHash = (value: unknown) => JSON.stringify(value ?? {});

const buildApplicabilityPatch = (setup: Partial<TaxAuditSetup>) => {
  const setupJson = parseJson<Record<string, unknown>>(setup.setup_json, {});
  const applicabilityInputs =
    setupJson.applicabilityInputs && typeof setupJson.applicabilityInputs === 'object'
      ? (setupJson.applicabilityInputs as TaxAuditApplicabilityInputs)
      : {};
  const calculation = calculateApplicability({ ...setup, ...applicabilityInputs });

  return {
    applicability_result: calculation.overall.result,
    applicability_reason: calculation.overall.reason,
    setup_json: stringify({
      ...setupJson,
      applicability: {
        business: calculation.business,
        profession: calculation.profession,
        suggestedFormType: calculation.suggestedFormType,
        warnings: calculation.warnings,
        calculatedAt: new Date().toISOString(),
      },
    }),
  };
};

const isCompanyConstitution = (value?: string | null) => {
  const normalized = (value || '').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('llp') || normalized.includes('limited liability partnership')) return false;
  return (
    normalized.includes('company') ||
    normalized.includes('private limited') ||
    normalized.includes('public limited') ||
    normalized.includes('one person company') ||
    normalized.includes('opc') ||
    normalized.includes('section 8')
  );
};

type EngagementLike = {
  id: string;
  client_id: string | null;
  client_name: string;
  financial_year: string;
  engagement_type?: string;
};

type ClientLike = {
  id: string;
  name: string;
  pan?: string | null;
  address?: string | null;
  state?: string | null;
  pin?: string | null;
  constitution?: string | null;
  industry?: string | null;
};

type GstinRow = {
  id: string;
  gstin: string;
  created_at?: string;
};

type ClausePrefill = {
  responseHtml: string;
  responseJson: Record<string, unknown>;
  status: TaxAuditPrefillStatus;
  links: TaxAuditSourceLink[];
  missingFields?: string[];
};

const isBlankStructuredValue = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const includesText = (source: string | null | undefined, value: string | null | undefined) => {
  if (!source || !value) return false;
  return source.toLowerCase().includes(value.toLowerCase());
};

const buildClientAddress = (client: Pick<ClientLike, 'address' | 'state' | 'pin'> | null | undefined) => {
  if (!client) return '';
  const address = client.address?.trim() || '';
  const state = client.state?.trim() || '';
  const pin = client.pin?.trim() || '';

  return [
    address,
    state && !includesText(address, state) ? state : '',
    pin && !includesText(address, pin) ? `PIN - ${pin}` : '',
  ].filter(Boolean).join(', ');
};

const mergeStructuredPrefill = (existingResponseJson: string | null | undefined, prefillResponseJson: Record<string, unknown>) => {
  const existing = parseJson<Record<string, unknown>>(existingResponseJson, {});
  const existingStructured =
    existing.structured && typeof existing.structured === 'object' && !Array.isArray(existing.structured)
      ? (existing.structured as Record<string, unknown>)
      : {};
  const prefillStructured =
    prefillResponseJson.structured && typeof prefillResponseJson.structured === 'object' && !Array.isArray(prefillResponseJson.structured)
      ? (prefillResponseJson.structured as Record<string, unknown>)
      : {};

  // Preserve any structured values already captured by the auditor while still backfilling new defaults.
  const mergedStructured = { ...existingStructured };
  Object.entries(prefillStructured).forEach(([key, value]) => {
    if (isBlankStructuredValue(mergedStructured[key])) {
      mergedStructured[key] = value;
    }
  });

  return {
    ...existing,
    ...prefillResponseJson,
    structured: mergedStructured,
  };
};

const resolveSection44AB = (setup: TaxAuditSetup) => {
  const setupJson = parseJson<Record<string, unknown>>(setup.setup_json, {});
  const applicability =
    setupJson.applicability && typeof setupJson.applicability === 'object'
      ? (setupJson.applicability as Record<string, unknown>)
      : {};
  const business = applicability.business && typeof applicability.business === 'object'
    ? (applicability.business as Record<string, unknown>)
    : {};
  const profession = applicability.profession && typeof applicability.profession === 'object'
    ? (applicability.profession as Record<string, unknown>)
    : {};

  if (business.result === 'Applicable' && typeof business.sectionReference === 'string') return business.sectionReference;
  if (profession.result === 'Applicable' && typeof profession.sectionReference === 'string') return profession.sectionReference;
  if (setup.applicability_result === 'Review required') return 'Other / Review required';
  return setup.applicability_result || '';
};

const sourceChip = (
  label: string,
  module: TaxAuditSourceLink['module'],
  route: string,
  field?: string,
  displayValue?: string | number | null
): TaxAuditSourceLink => ({
  label,
  module,
  route,
  field,
  displayValue,
});

const createClausePrefill = (
  definition: TaxAuditClauseDefinition,
  setup: TaxAuditSetup,
  client: ClientLike | null,
  gstins: GstinRow[]
): ClausePrefill => {
  const clientLink = sourceChip('Client', 'client_master', '/engagements');
  const setupLink = sourceChip('Setup', 'tax_audit_setup', '/tax-audit');
  const engagementLink = sourceChip('Engagement', 'engagement', '/select-engagement');
  const gstLink = sourceChip('GST', 'gst', '/audit-tools?tab=gst', 'client_gstins');
  const financialReviewLink = sourceChip('FR', 'financial_review', '/financial-review');
  const clientAddress = buildClientAddress(client);

  switch (definition.key) {
    case 'clause_1':
      return client?.name || setup.assessee_name
        ? {
            responseHtml: client?.name || setup.assessee_name || '',
            responseJson: {
              assessee_name: client?.name || setup.assessee_name,
              structured: { assessee_name: client?.name || setup.assessee_name || '' },
            },
            status: 'auto_filled',
            links: [clientLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [clientLink], missingFields: ['Name of assessee'] };
    case 'clause_2':
      return clientAddress || setup.address
        ? {
            responseHtml: clientAddress || setup.address || '',
            responseJson: {
              address: clientAddress || setup.address,
              state: client?.state || '',
              pin: client?.pin || '',
              structured: {
                address: client?.address || setup.address || '',
                state: client?.state || '',
                pin_code: client?.pin || '',
              },
            },
            status: 'auto_filled',
            links: [clientLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [clientLink], missingFields: ['Address'] };
    case 'clause_3':
      return client?.pan || setup.pan
        ? {
            responseHtml: client?.pan || setup.pan || '',
            responseJson: {
              pan: client?.pan || setup.pan,
              structured: { pan_or_aadhaar: client?.pan || setup.pan || '' },
            },
            status: 'auto_filled',
            links: [clientLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [clientLink], missingFields: ['PAN'] };
    case 'clause_4':
      if (gstins.length > 0) {
        const gstinList = gstins.map((item) => item.gstin).join(', ');
        return {
          responseHtml: `GST registration(s): ${gstinList}`,
          responseJson: {
            gstins,
            structured: {
              registrations: gstins.map((item) => ({
                law: 'GST',
                registration_number: item.gstin,
                description: '',
              })),
            },
          },
          status: 'auto_filled',
          links: [gstLink],
        };
      }
      return {
        responseHtml: '',
        responseJson: { gstins: [], structured: { registrations: [] } },
        status: 'needs_input',
        links: [gstLink],
        missingFields: ['Indirect tax registration details'],
      };
    case 'clause_5':
      return client?.constitution || setup.status
        ? {
            responseHtml: client?.constitution || setup.status || '',
            responseJson: {
              status: client?.constitution || setup.status,
              structured: { assessee_status: client?.constitution || setup.status || '' },
            },
            status: 'auto_filled',
            links: [clientLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [clientLink], missingFields: ['Status'] };
    case 'clause_6':
      return setup.previous_year_from && setup.previous_year_to
        ? {
            responseHtml: `${setup.previous_year_from} to ${setup.previous_year_to}`,
            responseJson: {
              from: setup.previous_year_from,
              to: setup.previous_year_to,
              structured: {
                previous_year_from: setup.previous_year_from,
                previous_year_to: setup.previous_year_to,
              },
            },
            status: 'auto_filled',
            links: [engagementLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [engagementLink], missingFields: ['Previous year'] };
    case 'clause_7':
      return setup.assessment_year
        ? {
            responseHtml: setup.assessment_year,
            responseJson: {
              assessment_year: setup.assessment_year,
              structured: { assessment_year: setup.assessment_year },
            },
            status: 'auto_filled',
            links: [engagementLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [engagementLink], missingFields: ['Assessment year'] };
    case 'clause_8':
      return {
        responseHtml: setup.applicability_result || '',
        responseJson: {
          relevant_clause: setup.applicability_result,
          reason: setup.applicability_reason,
          form_type: setup.form_type,
          structured: {
            relevant_clause_44ab: resolveSection44AB(setup),
            applicability_reason: setup.applicability_reason || '',
          },
        },
        status: setup.applicability_result ? 'auto_filled' : 'needs_input',
        links: [setupLink],
        missingFields: setup.applicability_result ? [] : ['Relevant clause of section 44AB'],
      };
    case 'clause_8a':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            opted_for_section_115_taxation: '',
            selected_section_115_taxation: '',
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Whether the assessee has opted for taxation under section 115BA/115BAA/115BAB/115BAC/115BAD/115BAE'],
      };
    case 'clause_9':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            whether_there_was_change_during_year: '',
            change_remarks: '',
            partners_or_members: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Partners or members particulars'],
      };
    case 'clause_10':
      return client?.industry || setup.nature_of_business
        ? {
            responseHtml: client?.industry || setup.nature_of_business || '',
            responseJson: {
              nature_of_business: client?.industry || setup.nature_of_business,
              structured: {
                whether_change_during_year: '',
                change_details: '',
                business_or_profession_rows: [
                  {
                    nature_of_business_or_profession: client?.industry || setup.nature_of_business || '',
                    business_or_profession_code: '',
                    remarks: '',
                  },
                ],
              },
            },
            status: 'auto_filled',
            links: [clientLink],
          }
        : { responseHtml: '', responseJson: {}, status: 'needs_input', links: [clientLink], missingFields: ['Nature of business or profession'] };
    case 'clause_11':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            whether_books_prescribed_under_44aa: '',
            books_prescribed: '',
            books_maintained: '',
            books_examined: '',
            whether_books_kept_at_multiple_locations: '',
            book_locations: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Books of account particulars'],
      };
    case 'clause_12':
      return {
        responseHtml: toBoolNumber(setup.presumptive_taxation) ? 'Yes' : '',
        responseJson: {
          structured: {
            whether_profit_loss_includes_presumptive_income: toBoolNumber(setup.presumptive_taxation) ? 'yes' : '',
            applicable_presumptive_section: '',
            amount: '',
            basis_or_remarks: toBoolNumber(setup.lower_than_presumptive)
              ? 'Lower than presumptive threshold selected in setup. Review applicable presumptive provisions.'
              : '',
          },
        },
        status: toBoolNumber(setup.presumptive_taxation) ? 'auto_filled' : 'needs_input',
        links: [setupLink],
        missingFields: toBoolNumber(setup.presumptive_taxation) ? [] : ['Presumptive income particulars'],
      };
    case 'clause_13':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            method_of_accounting: '',
            whether_change_in_method: '',
            change_details: '',
            effect_on_profit: '',
            whether_icds_applicable: '',
            icds_adjustments: '',
            disclosure_or_remarks: '',
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause particulars'],
      };
    case 'clause_14':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            method_of_valuation_opening_stock: '',
            method_of_valuation_closing_stock: '',
            whether_deviation_from_section_145A: '',
            deviation_details: '',
            effect_on_profit: '',
            remarks: '',
          },
        },
        status: 'needs_input',
        links: [financialReviewLink],
        missingFields: ['Stock valuation particulars'],
      };
    case 'clause_15':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            whether_any_capital_asset_converted_into_stock_in_trade: '',
            rows: [],
          },
        },
        status: 'needs_input',
        links: [financialReviewLink],
        missingFields: ['Capital asset conversion particulars'],
      };
    case 'clause_16':
      return {
        responseHtml: '',
        responseJson: { structured: { rows: [] } },
        status: 'needs_input',
        links: [financialReviewLink],
        missingFields: ['Amounts not credited to profit and loss account'],
      };
    case 'clause_17':
      return {
        responseHtml: '',
        responseJson: { structured: { rows: [] } },
        status: 'needs_input',
        links: [financialReviewLink],
        missingFields: ['Land or building transfer particulars'],
      };
    case 'clause_18':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            depreciation_working_available: '',
            remarks: '',
            rows: [],
          },
        },
        status: 'needs_input',
        links: [financialReviewLink],
        missingFields: ['Depreciation particulars'],
      };
    case 'clause_19':
      return {
        responseHtml: '',
        responseJson: { structured: { deduction_rows: [] } },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Section-wise admissible amount particulars'],
      };
    case 'clause_20':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            bonus_commission_rows: [],
            employee_contribution_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Bonus, commission and employee contribution particulars'],
      };
    case 'clause_21':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_21a_rows: [],
            clause_21b_rows: [],
            clause_21c_rows: [],
            clause_21d_rows: [],
            clause_21e_rows: [],
            clause_21f_rows: [],
            clause_21g_rows: [],
            clause_21h_rows: [],
            clause_21i_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 21(a) to 21(i) particulars'],
      };
    case 'clause_22':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_22i_interest_rows: [],
            clause_22ii_mse_payable_rows: [],
            clause_22iii_payment_status_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 22 MSMED payment and interest particulars'],
      };
    case 'clause_23':
      return {
        responseHtml: '',
        responseJson: { structured: { clause_23_rows: [] } },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Payments to specified persons under section 40A(2)(b)'],
      };
    case 'clause_24':
      return {
        responseHtml: '',
        responseJson: { structured: { clause_24_rows: [] } },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Amounts deemed to be profits and gains particulars'],
      };
    case 'clause_25':
      return {
        responseHtml: '',
        responseJson: { structured: { clause_25_rows: [] } },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Section 41 profit chargeable particulars'],
      };
    case 'clause_26':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_26ia_opening_liability_rows: [],
            clause_26ib_current_year_liability_rows: [],
            clause_26ii_indirect_tax_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 26 section 43B liability particulars'],
      };
    case 'clause_27':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_27a_credit_rows: [],
            clause_27b_prior_period_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 27 credit treatment and prior period particulars'],
      };
    case 'clause_29a':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_29a_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 29A advance forfeiture particulars'],
      };
    case 'clause_29b':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_29b_money_rows: [],
            clause_29b_immovable_property_rows: [],
            clause_29b_other_property_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 29B property receipt particulars'],
      };
    case 'clause_30':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_30_hundi_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 30 hundi borrowing and repayment particulars'],
      };
    case 'clause_30a':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_30a_primary_adjustment_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 30A primary adjustment particulars'],
      };
    case 'clause_30b':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_30b_interest_rows: [],
            clause_30b_summary_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 30B interest limitation particulars'],
      };
    case 'clause_30c':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_30c_arrangement_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 30C arrangement particulars'],
      };
    case 'clause_31':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_31a_loan_deposit_rows: [],
            clause_31b_specified_sum_rows: [],
            clause_31ba_receipt_other_than_permitted_mode_rows: [],
            clause_31bb_receipt_non_account_payee_rows: [],
            clause_31bc_payment_other_than_permitted_mode_rows: [],
            clause_31bd_payment_non_account_payee_rows: [],
            clause_31c_repayment_made_rows: [],
            clause_31d_repayment_received_other_than_permitted_mode_rows: [],
            clause_31e_repayment_received_non_account_payee_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 31(a) and 31(b) receipt particulars'],
      };
    case 'clause_32':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_32a_loss_depreciation_rows: [],
            clause_32b_shareholding_change_rows: [],
            clause_32c_speculation_loss_rows: [],
            clause_32d_specified_business_loss_rows: [],
            clause_32e_deemed_speculation_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 32 loss and carry forward particulars'],
      };
    case 'clause_33':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_33_deduction_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 33 deduction particulars'],
      };
    case 'clause_34':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_34a_tds_tcs_summary_rows: [],
            clause_34b_statement_rows: [],
            clause_34c_interest_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 34(a), 34(b) and 34(c) TDS/TCS particulars'],
      };
    case 'clause_35':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_35a_trading_goods_rows: [],
            clause_35b_raw_material_rows: [],
            clause_35b_finished_product_rows: [],
          },
        },
        status: 'needs_input',
        links: [financialReviewLink],
        missingFields: ['Clause 35 quantitative details'],
      };
    case 'clause_36a':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_36a_deemed_dividend_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 36A deemed dividend particulars'],
      };
    case 'clause_36b':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_36b_buyback_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 36B buyback particulars'],
      };
    case 'clause_37':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_37_cost_audit_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 37 cost audit report particulars'],
      };
    case 'clause_38':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_38_excise_audit_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 38 central excise audit report particulars'],
      };
    case 'clause_39':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_39_service_tax_audit_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 39 service tax audit report particulars'],
      };
    case 'clause_40':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_40_ratio_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 40 accounting ratio particulars'],
      };
    case 'clause_41':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_41_demand_refund_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 41 demand or refund particulars'],
      };
    case 'clause_42':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_42_reporting_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 42 Form 61, Form 61A and Form 61B particulars'],
      };
    case 'clause_43':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_43_cbcr_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 43 country-by-country reporting particulars'],
      };
    case 'clause_44':
      return {
        responseHtml: '',
        responseJson: {
          structured: {
            clause_44_gst_expenditure_rows: [],
          },
        },
        status: 'needs_input',
        links: [setupLink],
        missingFields: ['Clause 44 GST expenditure break-up particulars'],
      };
    default:
      if (definition.prefillStrategy === 'financial_review') {
        return {
          responseHtml: '',
          responseJson: {},
          status: 'needs_input',
          links: [financialReviewLink],
          missingFields: ['Review Financial Review source and enter clause particulars'],
        };
      }
      return {
        responseHtml: '',
        responseJson: {},
        status: 'needs_input',
        links: definition.prefillStrategy === 'gst' ? [gstLink] : [setupLink],
        missingFields: ['Manual review required'],
      };
  }
};

export function useTaxAudit(engagement: EngagementLike | null | undefined) {
  const { user } = useAuth();
  const [setup, setSetup] = useState<TaxAuditSetup | null>(null);
  const [acceptanceCheck, setAcceptanceCheck] = useState<TaxAuditAcceptanceCheck | null>(null);
  const [clauses, setClauses] = useState<TaxAuditClauseResponse[]>([]);
  const [evidenceLinks, setEvidenceLinks] = useState<TaxAuditClauseEvidence[]>([]);
  const [client, setClient] = useState<ClientLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchClient = useCallback(async () => {
    if (!engagement?.client_id) return null;
    const { data, error } = await db
      .from('clients')
      .select('*')
      .eq('id', engagement.client_id)
      .maybeSingle();
    if (error) throw error;
    setClient((data || null) as ClientLike | null);
    return (data || null) as ClientLike | null;
  }, [engagement?.client_id]);

  const fetchGstins = useCallback(async (clientId?: string | null) => {
    if (!clientId) return [] as GstinRow[];
    try {
      const { data, error } = await db
        .from('client_gstins')
        .select('id, gstin, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .execute();
      if (error) throw error;
      return (data || []) as GstinRow[];
    } catch (error) {
      console.warn('GSTIN prefill unavailable:', error);
      return [] as GstinRow[];
    }
  }, []);

  const buildDefaultSetup = useCallback(
    async (clientRow: ClientLike | null) => {
      if (!engagement) return null;
      const assessmentYear = deriveAssessmentYear(engagement.financial_year);
      const period = derivePreviousYearRange(engagement.financial_year);
      const companyAccountsAudited = isCompanyConstitution(clientRow?.constitution);
      const baseSetup: TaxAuditSetup = {
        engagement_id: engagement.id,
        client_id: engagement.client_id,
        statutory_version: TAX_AUDIT_STATUTORY_VERSION,
        form_type: '3CB',
        financial_year: engagement.financial_year,
        assessment_year: assessmentYear,
        previous_year_from: period.from,
        previous_year_to: period.to,
        assessee_name: clientRow?.name || engagement.client_name,
        pan: clientRow?.pan || '',
        address: buildClientAddress(clientRow),
        status: clientRow?.constitution || '',
        business_or_profession: 'business',
        nature_of_business: clientRow?.industry || '',
        books_audited_under_other_law: companyAccountsAudited || engagement.engagement_type === 'statutory' ? 1 : 0,
        other_law_name: companyAccountsAudited ? 'Companies Act, 2013' : '',
        turnover: 0,
        gross_receipts: 0,
        cash_receipts_percent: 0,
        cash_payments_percent: 0,
        presumptive_taxation: 0,
        lower_than_presumptive: 0,
        review_status: 'draft',
        locked: 0,
        created_by: user?.id || null,
        setup_json: '{}',
        source_links_json: stringify([
          sourceChip('Client', 'client_master', '/engagements'),
          sourceChip('Engagement', 'engagement', '/select-engagement'),
        ]),
      };
      return {
        ...baseSetup,
        ...buildApplicabilityPatch(baseSetup),
      };
    },
    [engagement, user?.id]
  );

  const seedClauses = useCallback(
    async (taxAuditSetup: TaxAuditSetup, clientRow: ClientLike | null, gstins: GstinRow[]) => {
      if (!taxAuditSetup.id) return [];
      const rows = FORM_3CD_CLAUSES.map((definition) => {
        const prefill = createClausePrefill(definition, taxAuditSetup, clientRow, gstins);
        return {
          tax_audit_id: taxAuditSetup.id,
          clause_key: definition.key,
          clause_no: definition.clauseNo,
          clause_title: definition.title,
          statutory_version: TAX_AUDIT_STATUTORY_VERSION,
          applicability_status: 'applicable',
          response_json: stringify(prefill.responseJson),
          response_html: prefill.responseHtml,
          auditor_remarks_html: '',
          prefill_status: prefill.status,
          source_links_json: stringify(prefill.links),
          missing_fields_json: stringify(prefill.missingFields || []),
          last_source_hash: sourceHash(prefill.responseJson),
          validation_status: prefill.status === 'needs_input' ? 'warning' : 'valid',
          validation_messages_json: stringify(prefill.missingFields || []),
          qualification_required: 0,
          qualification_text_html: '',
          workpaper_ref: `TA-3CD-${definition.clauseNo}`,
          review_status: 'draft',
          locked: 0,
        };
      });
      const { error } = await db.from('tax_audit_clause_responses').insert(rows).execute();
      if (error) throw error;
      return rows as TaxAuditClauseResponse[];
    },
    []
  );

  const refresh = useCallback(async () => {
    if (!engagement?.id) {
      setSetup(null);
      setAcceptanceCheck(null);
      setClauses([]);
      setEvidenceLinks([]);
      setClient(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const clientRow = await fetchClient();
      const { data: existingSetup, error: setupError } = await db
        .from('tax_audit_engagements')
        .select('*')
        .eq('engagement_id', engagement.id)
        .eq('statutory_version', TAX_AUDIT_STATUTORY_VERSION)
        .maybeSingle();

      if (setupError) throw setupError;

      let nextSetup = existingSetup as TaxAuditSetup | null;
      if (!nextSetup) {
        const defaultSetup = await buildDefaultSetup(clientRow);
        if (!defaultSetup) return;
        const { data: insertedSetup, error: insertError } = await db
          .from('tax_audit_engagements')
          .insert(defaultSetup)
          .select()
          .single();
        if (insertError) throw insertError;
        nextSetup = insertedSetup as TaxAuditSetup;
      }

      if (
        nextSetup?.id &&
        nextSetup.review_status === 'draft' &&
        isCompanyConstitution(clientRow?.constitution) &&
        !toBoolNumber(nextSetup.books_audited_under_other_law)
      ) {
        const companyAuditPatch = {
          books_audited_under_other_law: 1,
          other_law_name: nextSetup.other_law_name || 'Companies Act, 2013',
        };
        const { error: companyPatchError } = await db
          .from('tax_audit_engagements')
          .update(companyAuditPatch)
          .eq('id', nextSetup.id)
          .execute();
        if (companyPatchError) throw companyPatchError;
        nextSetup = { ...nextSetup, ...companyAuditPatch } as TaxAuditSetup;
      }

      setSetup(nextSetup);

      const { data: acceptanceData, error: acceptanceError } = await db
        .from('tax_audit_acceptance_checks')
        .select('*')
        .eq('tax_audit_id', nextSetup.id)
        .maybeSingle();
      if (acceptanceError) throw acceptanceError;
      setAcceptanceCheck((acceptanceData || null) as TaxAuditAcceptanceCheck | null);

      const { data: existingClauses, error: clausesError } = await db
        .from('tax_audit_clause_responses')
        .select('*')
        .eq('tax_audit_id', nextSetup.id)
        .order('clause_no', { ascending: true })
        .execute();
      if (clausesError) throw clausesError;

      let nextClauses = (existingClauses || []) as TaxAuditClauseResponse[];
      if (nextClauses.length === 0) {
        const gstins = await fetchGstins(nextSetup.client_id);
        await seedClauses(nextSetup, clientRow, gstins);
        const { data: seededClauses, error: seededError } = await db
          .from('tax_audit_clause_responses')
          .select('*')
          .eq('tax_audit_id', nextSetup.id)
          .order('clause_no', { ascending: true })
          .execute();
        if (seededError) throw seededError;
        nextClauses = (seededClauses || []) as TaxAuditClauseResponse[];
      }
      setClauses(nextClauses);

      const { data: evidenceData, error: evidenceError } = await db
        .from('tax_audit_clause_evidence')
        .select('*')
        .eq('tax_audit_id', nextSetup.id)
        .execute();
      if (evidenceError) throw evidenceError;
      setEvidenceLinks((evidenceData || []) as TaxAuditClauseEvidence[]);
    } catch (error) {
      console.error('Error loading tax audit:', error);
      setSetup(null);
      setAcceptanceCheck(null);
      setClauses([]);
      setEvidenceLinks([]);
    } finally {
      setLoading(false);
    }
  }, [buildDefaultSetup, engagement?.id, fetchClient, fetchGstins, seedClauses]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateSetup = useCallback(
    async (updates: Partial<TaxAuditSetup>) => {
      if (!setup?.id) return null;
      setSaving(true);
      try {
        const next = { ...setup, ...updates };
        const applicabilityPatch = buildApplicabilityPatch(next);

        const payload = {
          ...updates,
          books_audited_under_other_law: updates.books_audited_under_other_law !== undefined ? toBoolNumber(updates.books_audited_under_other_law) : undefined,
          presumptive_taxation: updates.presumptive_taxation !== undefined ? toBoolNumber(updates.presumptive_taxation) : undefined,
          lower_than_presumptive: updates.lower_than_presumptive !== undefined ? toBoolNumber(updates.lower_than_presumptive) : undefined,
          applicability_result: applicabilityPatch.applicability_result,
          applicability_reason: applicabilityPatch.applicability_reason,
          setup_json: applicabilityPatch.setup_json,
        };

        Object.keys(payload).forEach((key) => {
          if ((payload as Record<string, unknown>)[key] === undefined) {
            delete (payload as Record<string, unknown>)[key];
          }
        });

        const { error } = await db
          .from('tax_audit_engagements')
          .update(payload)
          .eq('id', setup.id)
          .execute();
        if (error) throw error;
        await refresh();
        return payload;
      } finally {
        setSaving(false);
      }
    },
    [refresh, setup]
  );

  const saveAcceptanceCheck = useCallback(
    async (updates: Omit<TaxAuditAcceptanceCheck, 'tax_audit_id'>) => {
      if (!setup?.id) return null;
      setSaving(true);
      try {
        const payload = {
          checklist_json: updates.checklist_json || '{}',
          overall_status: updates.overall_status || 'not_started',
          remarks_html: updates.remarks_html || '',
          reviewed_by: updates.reviewed_by || null,
          reviewed_at: updates.reviewed_at || null,
          approved_by: updates.approved_by || null,
          approved_at: updates.approved_at || null,
        };

        if (acceptanceCheck?.id) {
          const { error } = await db
            .from('tax_audit_acceptance_checks')
            .update(payload)
            .eq('id', acceptanceCheck.id)
            .execute();
          if (error) throw error;
          const next = { ...acceptanceCheck, ...payload } as TaxAuditAcceptanceCheck;
          setAcceptanceCheck(next);
          return next;
        }

        const { data, error } = await db
          .from('tax_audit_acceptance_checks')
          .insert({
            tax_audit_id: setup.id,
            ...payload,
          })
          .select()
          .single();
        if (error) throw error;
        const next = data as TaxAuditAcceptanceCheck;
        setAcceptanceCheck(next);
        return next;
      } finally {
        setSaving(false);
      }
    },
    [acceptanceCheck, setup?.id]
  );

  const refreshPrefill = useCallback(async () => {
    if (!setup?.id) return;
    const clientRow = client || (await fetchClient());
    const gstins = await fetchGstins(setup.client_id);
    for (const definition of FORM_3CD_CLAUSES) {
      const clause = clauses.find((item) => item.clause_key === definition.key);
      if (!clause || clause.review_status !== 'draft') continue;
      const prefill = createClausePrefill(definition, setup, clientRow, gstins);
      const responseJson = mergeStructuredPrefill(clause.response_json, prefill.responseJson);
      const { error } = await db
        .from('tax_audit_clause_responses')
        .update({
          response_json: stringify(responseJson),
          response_html: clause.response_html || prefill.responseHtml,
          prefill_status: prefill.status,
          source_links_json: stringify(prefill.links),
          missing_fields_json: stringify(prefill.missingFields || []),
          last_source_hash: sourceHash(responseJson),
          validation_status: prefill.status === 'needs_input' ? 'warning' : 'valid',
          validation_messages_json: stringify(prefill.missingFields || []),
        })
        .eq('id', clause.id)
        .execute();
      if (error) throw error;
    }
    await refresh();
  }, [clauses, client, fetchClient, fetchGstins, refresh, setup]);

  const updateClause = useCallback(
    async (clauseId: string, updates: Partial<TaxAuditClauseResponse>) => {
      const payload = {
        ...updates,
        prefill_status: updates.prefill_status || (updates.response_html !== undefined || updates.auditor_remarks_html !== undefined ? 'manual_override' : undefined),
      };
      Object.keys(payload).forEach((key) => {
        if ((payload as Record<string, unknown>)[key] === undefined) {
          delete (payload as Record<string, unknown>)[key];
        }
      });
      const { error } = await db
        .from('tax_audit_clause_responses')
        .update(payload)
        .eq('id', clauseId)
        .execute();
      if (error) throw error;
      setClauses((prev) => prev.map((item) => (item.id === clauseId ? { ...item, ...payload } as TaxAuditClauseResponse : item)));
    },
    []
  );

  const updateClauseStatus = useCallback(
    async (clauseId: string, status: TaxAuditReviewStatus, options?: { unlockReason?: string }) => {
      const timestamp = new Date().toISOString();
      const isUnlockForEdit = Boolean(options?.unlockReason);
      const payload: Partial<TaxAuditClauseResponse> & Record<string, unknown> = {
        review_status: status,
        locked: isUnlockForEdit ? 0 : status === 'approved' || status === 'locked' ? 1 : 0,
      };
      if (status === 'prepared') {
        payload.prepared_by = user?.id || null;
        payload.prepared_at = timestamp;
      }
      if (status === 'reviewed') {
        payload.reviewed_by = user?.id || null;
        payload.reviewed_at = timestamp;
      }
      if (status === 'approved') {
        payload.approved_by = user?.id || null;
        payload.approved_at = timestamp;
        payload.locked_by = user?.id || null;
        payload.locked_at = timestamp;
      }
      if (isUnlockForEdit) {
        payload.unlock_reason = options?.unlockReason || null;
        payload.locked_by = null;
        payload.locked_at = null;
      }
      await updateClause(clauseId, payload as Partial<TaxAuditClauseResponse>);
    },
    [updateClause, user?.id]
  );

  const linkEvidence = useCallback(
    async (clause: TaxAuditClauseResponse, evidenceFileId: string) => {
      if (!setup?.id || !user?.id) return;
      const { error } = await db
        .from('tax_audit_clause_evidence')
        .insert({
          tax_audit_id: setup.id,
          clause_response_id: clause.id,
          clause_key: clause.clause_key,
          evidence_file_id: evidenceFileId,
          workpaper_ref: clause.workpaper_ref || `TA-3CD-${clause.clause_no}`,
          linked_by: user.id,
        })
        .execute();
      if (error) throw error;
      await refresh();
    },
    [refresh, setup?.id, user?.id]
  );

  const unlinkEvidence = useCallback(
    async (linkId: string) => {
      const { error } = await db
        .from('tax_audit_clause_evidence')
        .delete()
        .eq('id', linkId)
        .execute();
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const summary: TaxAuditSummary = useMemo(() => {
    const evidenceClauseIds = new Set(evidenceLinks.map((link) => link.clause_response_id));
    return {
      totalClauses: FORM_3CD_CLAUSES.length,
      prepared: clauses.filter((item) => item.review_status === 'prepared').length,
      reviewed: clauses.filter((item) => item.review_status === 'reviewed').length,
      approved: clauses.filter((item) => item.review_status === 'approved' || item.review_status === 'locked').length,
      needsInput: clauses.filter((item) => item.prefill_status === 'needs_input').length,
      partial: clauses.filter((item) => item.prefill_status === 'partially_filled').length,
      conflicts: clauses.filter((item) => item.prefill_status === 'source_conflict' || item.validation_status === 'error').length,
      evidenceLinked: clauses.filter((item) => evidenceClauseIds.has(item.id)).length,
      qualifications: clauses.filter((item) => Boolean(item.qualification_required)).length,
    };
  }, [clauses, evidenceLinks]);

  return {
    setup,
    acceptanceCheck,
    clauses,
    evidenceLinks,
    client,
    loading,
    saving,
    summary,
    refresh,
    updateSetup,
    saveAcceptanceCheck,
    refreshPrefill,
    updateClause,
    updateClauseStatus,
    linkEvidence,
    unlinkEvidence,
    parseJson,
  };
}
