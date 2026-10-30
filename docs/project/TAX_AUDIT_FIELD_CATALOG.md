# Tax audit configured clause and field catalogue

Source baseline `cc5c04729604fba7d05240a07f24682e0644665c`. This catalogue documents code configuration only. AY 2025-26 is the configured statutory label; this documentation does not validate current law, complete legal subclause coverage, source notifications or portal schema.

## Configured clauses

The live array contains 49 configured clause definitions. Subclauses are separate configured keys. Missing historical numbers must not be interpreted without legal review.

| Key | Display clause | Configured title |
| --- | --- | --- |
| clause_1 | 1 | Name of the assessee |
| clause_2 | 2 | Address |
| clause_3 | 3 | PAN or Aadhaar number |
| clause_4 | 4 | Indirect tax registration details |
| clause_5 | 5 | Status of the assessee |
| clause_6 | 6 | Previous year |
| clause_7 | 7 | Assessment year |
| clause_8 | 8 | Relevant clause of section 44AB |
| clause_8a | 8a | Whether the assessee has opted for taxation under section 115BA/115BAA/115BAB/115BAC/115BAD/115BAE |
| clause_9 | 9 | Firm or AOP/BOI partner or member details |
| clause_10 | 10 | Nature of business or profession |
| clause_11 | 11 | Books of account and locations where books are kept |
| clause_12 | 12 | Whether profit and loss account includes presumptive income |
| clause_13 | 13 | Method of accounting and changes therein |
| clause_14 | 14 | Method of valuation of closing stock |
| clause_15 | 15 | Capital asset converted into stock-in-trade |
| clause_16 | 16 | Amounts not credited to profit and loss account |
| clause_17 | 17 | Transfer of land or building below stamp value |
| clause_18 | 18 | Depreciation allowable under the Act |
| clause_19 | 19 | Amounts admissible under specified sections |
| clause_20 | 20 | Employee contribution and bonus/commission details |
| clause_21 | 21 | Amounts debited to profit and loss account and disallowances |
| clause_22 | 22 | MSMED payments and interest reporting |
| clause_23 | 23 | Payments to persons specified under section 40A(2)(b) |
| clause_24 | 24 | Deemed profits and gains under section 32AC/33AB/33ABA/33AC |
| clause_25 | 25 | Amounts chargeable under section 41 |
| clause_26 | 26 | Liabilities covered by section 43B |
| clause_27 | 27 | CENVAT/Input tax credit and prior period items |
| clause_29a | 29A | Amount chargeable under section 56(2)(ix) |
| clause_29b | 29B | Amount chargeable under section 56(2)(x) |
| clause_30 | 30 | Hundi borrowings and repayments under section 69D |
| clause_30a | 30A | Primary adjustment to transfer price under section 92CE |
| clause_30b | 30B | Limitation on interest deduction under section 94B |
| clause_30c | 30C | Impermissible avoidance arrangement under section 96 |
| clause_31 | 31 | Loans, deposits and specified sums |
| clause_32 | 32 | Brought forward losses, depreciation and section 115BAA/115BAC details |
| clause_33 | 33 | Deductions under Chapter VIA and other sections |
| clause_34 | 34 | TDS/TCS compliance |
| clause_35 | 35 | Trading and manufacturing quantitative details |
| clause_36a | 36A | Deemed dividend under section 2(22)(e) |
| clause_36b | 36B | Amount received for buyback of shares under section 2(22)(f) |
| clause_37 | 37 | Cost audit report |
| clause_38 | 38 | Central excise audit report |
| clause_39 | 39 | Service tax audit report |
| clause_40 | 40 | Accounting ratios |
| clause_41 | 41 | Demand or refund under any tax law other than Income-tax Act and Wealth-tax Act |
| clause_42 | 42 | Form 61, Form 61A and Form 61B reporting |
| clause_43 | 43 | Country-by-country reporting under section 286 |
| clause_44 | 44 | GST expenditure break-up |

## Extracted literal field definitions

The following 785 literal field/table-column objects were extracted where key, label and type appear together in the source. This is not a full evaluated field-schema model: helper-generated objects, visibility expressions, option arrays, shared references and table grouping remain in the source file. Requiredness below is lexical, not proof of actual UI enforcement. Review the complete configured schema at [source](../../src/data/taxAudit3CDFieldSchemas.ts).

| Key | Label | Type | Required in extracted object | Source line |
| --- | --- | --- | --- | --- |
| assessee_name | Name of the assessee | text | yes | 1202 |
| address | Address | textarea | yes | 1215 |
| state | State | text | not explicit in extracted object | 1223 |
| pin_code | PIN code | text | not explicit in extracted object | 1230 |
| pan_or_aadhaar | PAN or Aadhaar number | text | yes | 1242 |
| law | Law | select | yes | 1259 |
| registration_number | Registration number | text | yes | 1274 |
| description | Description | text | not explicit in extracted object | 1281 |
| assessee_status | Status of the assessee | select | yes | 1293 |
| previous_year_from | Previous year from | date | yes | 1306 |
| previous_year_to | Previous year to | date | yes | 1313 |
| assessment_year | Assessment year | text | yes | 1325 |
| relevant_clause_44ab | Relevant clause of section 44AB | select | yes | 1338 |
| applicability_reason | Applicability basis | textarea | not explicit in extracted object | 1346 |
| opted_for_section_115_taxation | Whether the assessee has opted for taxation under section 115BA/115BAA/115BAB/115BAC/115BAD/115BAE? | select | yes | 1358 |
| selected_section_115_taxation | Selected section | select | yes | 1365 |
| whether_there_was_change_during_year | Whether there was change during the previous year | select | yes | 1381 |
| change_remarks | Change remarks | textarea | not explicit in extracted object | 1388 |
| name | Name | text | yes | 1400 |
| status_or_capacity | Status / capacity | text | not explicit in extracted object | 1401 |
| profit_sharing_ratio | Profit sharing % | percentage | not explicit in extracted object | 1402 |
| remuneration_or_interest_change | Remuneration / interest change | text | not explicit in extracted object | 1403 |
| date_of_change | Date of change | date | not explicit in extracted object | 1404 |
| remarks | Remarks | text | not explicit in extracted object | 1405 |
| whether_change_during_year | Whether change during the previous year | select | yes | 1412 |
| change_details | Change details | textarea | not explicit in extracted object | 1419 |
| nature_of_business_or_profession | Nature of business or profession | text | yes | 1431 |
| business_or_profession_code | Code | text | not explicit in extracted object | 1437 |
| remarks | Remarks | text | not explicit in extracted object | 1444 |
| whether_books_prescribed_under_44aa | Books prescribed under section 44AA | select | yes | 1455 |
| books_prescribed | Books prescribed | textarea | not explicit in extracted object | 1462 |
| books_maintained | Books maintained | textarea | yes | 1468 |
| books_examined | Books examined | textarea | yes | 1475 |
| whether_books_kept_at_multiple_locations | Books kept at multiple locations | select | not explicit in extracted object | 1482 |
| place_where_books_are_kept | Place where books are kept | text | yes | 1494 |
| location_details | Location details | text | not explicit in extracted object | 1500 |
| whether_profit_loss_includes_presumptive_income | P&L includes presumptive income | select | yes | 1511 |
| applicable_presumptive_section | Applicable presumptive section | select | not explicit in extracted object | 1519 |
| amount | Amount | number | not explicit in extracted object | 1525 |
| basis_or_remarks | Basis or remarks | textarea | not explicit in extracted object | 1531 |
| method_of_accounting | Method of accounting | select | yes | 1542 |
| whether_change_in_method | Change in method | select | yes | 1549 |
| change_details | Change details | textarea | not explicit in extracted object | 1556 |
| effect_on_profit | Effect on profit | number | not explicit in extracted object | 1561 |
| whether_icds_applicable | ICDS applicable | select | not explicit in extracted object | 1567 |
| icds_adjustments | ICDS adjustments | textarea | not explicit in extracted object | 1573 |
| disclosure_or_remarks | Disclosure or remarks | textarea | not explicit in extracted object | 1579 |
| method_of_valuation_opening_stock | Method of valuation of opening stock | textarea | yes | 1589 |
| method_of_valuation_closing_stock | Method of valuation of closing stock | textarea | yes | 1595 |
| whether_deviation_from_section_145A | Deviation from section 145A | select | yes | 1601 |
| deviation_details | Deviation details | textarea | not explicit in extracted object | 1608 |
| effect_on_profit | Effect on profit | number | not explicit in extracted object | 1613 |
| remarks | Remarks | textarea | not explicit in extracted object | 1619 |
| whether_any_capital_asset_converted_into_stock_in_trade | Any capital asset converted into stock-in-trade | select | yes | 1629 |
| asset_description | Asset description | text | yes | 1641 |
| date_of_acquisition | Date of acquisition | date | not explicit in extracted object | 1642 |
| cost_of_acquisition | Cost of acquisition | number | not explicit in extracted object | 1643 |
| amount_at_which_asset_is_converted_into_stock_in_trade | Conversion amount | number | not explicit in extracted object | 1644 |
| fair_market_value_on_date_of_conversion | FMV on conversion | number | not explicit in extracted object | 1650 |
| date_of_conversion | Date of conversion | date | not explicit in extracted object | 1656 |
| remarks | Remarks | text | not explicit in extracted object | 1657 |
| category | Category | select | not explicit in extracted object | 1667 |
| description | Description | text | not explicit in extracted object | 1674 |
| amount | Amount | number | not explicit in extracted object | 1675 |
| remarks | Remarks | text | not explicit in extracted object | 1676 |
| property_description | Property description | text | yes | 1686 |
| address_or_location | Address / location | text | not explicit in extracted object | 1687 |
| whether_land_or_building_or_both | Type | select | not explicit in extracted object | 1688 |
| date_of_transfer | Date of transfer | date | not explicit in extracted object | 1695 |
| consideration_received_or_accrued | Consideration | number | not explicit in extracted object | 1696 |
| value_adopted_or_assessed_or_assessable | Stamp value | number | not explicit in extracted object | 1702 |
| section_reference | Section | select | not explicit in extracted object | 1708 |
| remarks | Remarks | text | not explicit in extracted object | 1715 |
| depreciation_working_available | Depreciation working available | select | yes | 1722 |
| remarks | Remarks | textarea | not explicit in extracted object | 1729 |
| block_or_asset_class | Block / asset class | text | yes | 1740 |
| rate_of_depreciation | Rate % | percentage | not explicit in extracted object | 1741 |
| opening_wdv | Opening WDV | number | not explicit in extracted object | 1742 |
| additions_more_than_180_days | Additions >180 days | number | not explicit in extracted object | 1743 |
| additions_less_than_180_days | Additions <180 days | number | not explicit in extracted object | 1744 |
| deductions_or_sales | Deductions / sales | number | not explicit in extracted object | 1745 |
| depreciation_allowable | Depreciation allowable | number | not explicit in extracted object | 1746 |
| closing_wdv | Closing WDV | number | not explicit in extracted object | 1747 |
| additional_depreciation | Additional depreciation | number | not explicit in extracted object | 1748 |
| remarks | Remarks | text | not explicit in extracted object | 1749 |
| section | Section | select | not explicit in extracted object | 1759 |
| amount_debited_to_profit_and_loss | Amount debited to P&L | number | not explicit in extracted object | 1766 |
| amount_admissible_under_income_tax_act | Amount admissible | number | not explicit in extracted object | 1772 |
| conditions_fulfilled | Conditions fulfilled | select | not explicit in extracted object | 1778 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 1785 |
| remarks | Remarks | text | not explicit in extracted object | 1791 |
| employee_or_payee_name | Employee / payee | text | not explicit in extracted object | 1805 |
| nature_of_payment | Nature | select | not explicit in extracted object | 1806 |
| amount | Amount | number | not explicit in extracted object | 1813 |
| whether_payable_as_profit_or_dividend_if_not_paid_as_bonus_or_commission | Payable as profit/dividend | select | not explicit in extracted object | 1814 |
| admissibility_view | Admissibility view | select | not explicit in extracted object | 1821 |
| remarks | Remarks | text | not explicit in extracted object | 1828 |
| fund_name | Fund | select | not explicit in extracted object | 1838 |
| month_or_period | Month / period | text | not explicit in extracted object | 1845 |
| amount_received_from_employees | Amount received | number | not explicit in extracted object | 1846 |
| due_date_for_deposit | Due date | date | not explicit in extracted object | 1852 |
| actual_date_of_deposit | Actual deposit date | date | not explicit in extracted object | 1853 |
| amount_deposited | Amount deposited | number | not explicit in extracted object | 1854 |
| delay_status | Delay status | select | not explicit in extracted object | 1855 |
| remarks | Remarks | text | not explicit in extracted object | 1862 |
| category | Category | select | not explicit in extracted object | 1877 |
| nature_of_expenditure | Nature of expenditure | text | not explicit in extracted object | 1884 |
| amount_debited_to_profit_and_loss | Amount debited to P&L | number | not explicit in extracted object | 1885 |
| amount_inadmissible | Amount inadmissible | number | not explicit in extracted object | 1891 |
| ledger_or_working_reference | Ledger / working ref | text | not explicit in extracted object | 1892 |
| remarks | Remarks | text | not explicit in extracted object | 1893 |
| sub_clause | Sub-clause | select | not explicit in extracted object | 1903 |
| date_of_payment | Date of payment | date | not explicit in extracted object | 1910 |
| nature_of_payment | Nature of payment | text | not explicit in extracted object | 1911 |
| amount_of_payment | Amount of payment | number | not explicit in extracted object | 1912 |
| payee_name | Payee name | text | not explicit in extracted object | 1913 |
| payee_address | Payee address | text | not explicit in extracted object | 1914 |
| payee_pan_or_aadhaar | Payee PAN / Aadhaar | text | not explicit in extracted object | 1915 |
| tax_deducted | Tax deducted | select | not explicit in extracted object | 1916 |
| tax_deducted_amount | Tax deducted amount | number | not explicit in extracted object | 1923 |
| tax_deposited_amount | Tax deposited amount | number | not explicit in extracted object | 1924 |
| reason_for_inadmissibility | Reason | select | not explicit in extracted object | 1925 |
| remarks | Remarks | text | not explicit in extracted object | 1932 |
| payee_name | Payee name | text | not explicit in extracted object | 1942 |
| payee_capacity | Payee capacity | select | not explicit in extracted object | 1943 |
| nature_of_payment | Nature of payment | select | not explicit in extracted object | 1950 |
| amount_debited_to_profit_and_loss | Amount debited to P&L | number | not explicit in extracted object | 1957 |
| amount_admissible | Amount admissible | number | not explicit in extracted object | 1963 |
| amount_inadmissible | Amount inadmissible | number | not explicit in extracted object | 1964 |
| basis_of_inadmissibility | Basis of inadmissibility | select | not explicit in extracted object | 1965 |
| deed_or_authorisation_reference | Deed / authorisation ref | text | not explicit in extracted object | 1972 |
| remarks | Remarks | text | not explicit in extracted object | 1978 |
| sub_clause | Sub-clause | select | not explicit in extracted object | 1988 |
| date_of_payment | Date of payment | date | not explicit in extracted object | 1995 |
| nature_of_payment | Nature of payment | text | not explicit in extracted object | 1996 |
| amount | Amount | number | not explicit in extracted object | 1997 |
| payee_name | Payee name | text | not explicit in extracted object | 1998 |
| payee_pan_or_aadhaar | Payee PAN / Aadhaar | text | not explicit in extracted object | 1999 |
| mode_of_payment | Mode of payment | select | not explicit in extracted object | 2000 |
| whether_covered_by_rule_6dd | Covered by Rule 6DD | select | not explicit in extracted object | 2007 |
| rule_6dd_reference | Rule 6DD reference | text | not explicit in extracted object | 2014 |
| amount_inadmissible | Amount inadmissible | number | not explicit in extracted object | 2015 |
| remarks | Remarks | text | not explicit in extracted object | 2016 |
| nature_of_provision | Nature of provision | text | not explicit in extracted object | 2026 |
| amount_debited_to_profit_and_loss | Amount debited to P&L | number | not explicit in extracted object | 2027 |
| amount_admissible | Amount admissible | number | not explicit in extracted object | 2033 |
| amount_inadmissible | Amount inadmissible | number | not explicit in extracted object | 2034 |
| basis | Basis | select | not explicit in extracted object | 2035 |
| remarks | Remarks | text | not explicit in extracted object | 2042 |
| nature_of_sum | Nature of sum | text | not explicit in extracted object | 2052 |
| recipient_or_fund_name | Recipient / fund | text | not explicit in extracted object | 2053 |
| amount | Amount | number | not explicit in extracted object | 2054 |
| statutory_or_approved_basis | Statutory / approved basis | select | not explicit in extracted object | 2055 |
| amount_inadmissible | Amount inadmissible | number | not explicit in extracted object | 2062 |
| remarks | Remarks | text | not explicit in extracted object | 2063 |
| nature_of_contingent_liability | Nature of contingent liability | text | not explicit in extracted object | 2073 |
| amount | Amount | number | not explicit in extracted object | 2074 |
| reason_for_contingency | Reason for contingency | text | not explicit in extracted object | 2075 |
| accounting_treatment | Accounting treatment | select | not explicit in extracted object | 2076 |
| remarks | Remarks | text | not explicit in extracted object | 2083 |
| nature_of_exempt_income | Nature of exempt income | text | not explicit in extracted object | 2093 |
| exempt_income_amount | Exempt income amount | number | not explicit in extracted object | 2094 |
| expenditure_claimed | Expenditure claimed | number | not explicit in extracted object | 2095 |
| amount_inadmissible_under_14a | Amount inadmissible under 14A | number | not explicit in extracted object | 2096 |
| basis_of_disallowance | Basis of disallowance | select | not explicit in extracted object | 2102 |
| remarks | Remarks | text | not explicit in extracted object | 2109 |
| asset_or_project_description | Asset / project description | text | not explicit in extracted object | 2119 |
| date_of_borrowing | Date of borrowing | date | not explicit in extracted object | 2120 |
| date_asset_first_put_to_use | Date first put to use | date | not explicit in extracted object | 2121 |
| interest_amount_debited | Interest debited | number | not explicit in extracted object | 2122 |
| amount_inadmissible | Amount inadmissible | number | not explicit in extracted object | 2123 |
| basis_of_identification | Basis of identification | select | not explicit in extracted object | 2124 |
| remarks | Remarks | text | not explicit in extracted object | 2131 |
| supplier_name | Supplier name | text | not explicit in extracted object | 2146 |
| supplier_udyam_registration_number | Udyam registration number | text | not explicit in extracted object | 2147 |
| enterprise_type | Enterprise type | select | not explicit in extracted object | 2148 |
| amount_of_interest_paid_or_payable | Interest paid / payable | number | not explicit in extracted object | 2155 |
| amount_debited_to_profit_and_loss | Amount debited to P&L | number | not explicit in extracted object | 2161 |
| amount_inadmissible_under_section_23 | Amount inadmissible u/s 23 | number | not explicit in extracted object | 2167 |
| basis_of_identification | Basis of identification | select | not explicit in extracted object | 2173 |
| remarks | Remarks | text | not explicit in extracted object | 2180 |
| supplier_name | Supplier name | text | not explicit in extracted object | 2190 |
| supplier_udyam_registration_number | Udyam registration number | text | not explicit in extracted object | 2191 |
| enterprise_type | Enterprise type | select | not explicit in extracted object | 2192 |
| invoice_or_reference_number | Invoice / reference number | text | not explicit in extracted object | 2199 |
| date_of_acceptance_or_deemed_acceptance | Acceptance / deemed acceptance date | date | not explicit in extracted object | 2200 |
| amount_required_to_be_paid_during_previous_year | Amount required to be paid | number | not explicit in extracted object | 2206 |
| whether_written_agreement_exists | Written agreement exists | select | not explicit in extracted object | 2212 |
| agreed_payment_period_days | Agreed payment period days | number | not explicit in extracted object | 2219 |
| due_date_under_section_15 | Due date u/s 15 | date | not explicit in extracted object | 2220 |
| remarks | Remarks | text | not explicit in extracted object | 2221 |
| supplier_name | Supplier name | text | not explicit in extracted object | 2231 |
| invoice_or_reference_number | Invoice / reference number | text | not explicit in extracted object | 2232 |
| amount_referred_to_in_22ii | Amount referred to in 22(ii) | number | not explicit in extracted object | 2233 |
| amount_paid_within_time_under_section_15 | Amount paid within time u/s 15 | number | not explicit in extracted object | 2234 |
| amount_not_paid_within_time_under_section_15 | Amount not paid within time u/s 15 | number | not explicit in extracted object | 2240 |
| amount_inadmissible_for_previous_year | Amount inadmissible for previous year | number | not explicit in extracted object | 2246 |
| actual_payment_date | Actual payment date | date | not explicit in extracted object | 2252 |
| due_date_under_section_15 | Due date u/s 15 | date | not explicit in extracted object | 2253 |
| whether_claimed_as_deduction | Claimed as deduction | select | not explicit in extracted object | 2254 |
| remarks | Remarks | text | not explicit in extracted object | 2261 |
| specified_person_name | Specified person name | text | not explicit in extracted object | 2273 |
| relationship_or_nature_of_connection | Relationship / connection | select | not explicit in extracted object | 2274 |
| pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 2281 |
| nature_of_payment | Nature of payment | select | not explicit in extracted object | 2282 |
| amount_paid_or_payable | Amount paid / payable | number | not explicit in extracted object | 2289 |
| basis_of_reasonableness | Basis of reasonableness | text | not explicit in extracted object | 2290 |
| auditor_view | Auditor view | select | not explicit in extracted object | 2291 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2298 |
| remarks | Remarks | text | not explicit in extracted object | 2299 |
| section | Section | select | not explicit in extracted object | 2310 |
| nature_of_amount | Nature of amount | text | not explicit in extracted object | 2317 |
| amount | Amount | number | not explicit in extracted object | 2318 |
| year_of_original_deduction_or_allowance | Year of original deduction / allowance | text | not explicit in extracted object | 2319 |
| reason_for_deeming | Reason for deeming | text | not explicit in extracted object | 2325 |
| computation_or_basis | Computation / basis | text | not explicit in extracted object | 2326 |
| remarks | Remarks | text | not explicit in extracted object | 2327 |
| section_41_reference | Section 41 reference | select | not explicit in extracted object | 2338 |
| nature_of_liability_or_asset | Nature of liability / asset | text | not explicit in extracted object | 2345 |
| amount_chargeable | Amount chargeable | number | not explicit in extracted object | 2346 |
| year_in_which_deduction_or_allowance_was_claimed | Year deduction / allowance claimed | text | not explicit in extracted object | 2347 |
| event_triggering_taxability | Event triggering taxability | select | not explicit in extracted object | 2353 |
| computation_or_basis | Computation / basis | text | not explicit in extracted object | 2360 |
| remarks | Remarks | text | not explicit in extracted object | 2361 |
| section_43b_category | Section 43B category | select | not explicit in extracted object | 2379 |
| nature_of_liability | Nature of liability | text | not explicit in extracted object | 2386 |
| amount_outstanding_on_first_day_of_previous_year | Outstanding on first day | number | not explicit in extracted object | 2387 |
| amount_paid_during_previous_year | Paid during previous year | number | not explicit in extracted object | 2393 |
| date_of_payment | Date of payment | date | not explicit in extracted object | 2394 |
| amount_remaining_unpaid_on_last_day_of_previous_year | Remaining unpaid on last day | number | not explicit in extracted object | 2395 |
| amount_allowed_during_current_year | Allowed during current year | number | not explicit in extracted object | 2401 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2407 |
| remarks | Remarks | text | not explicit in extracted object | 2408 |
| section_43b_category | Section 43B category | select | not explicit in extracted object | 2422 |
| nature_of_liability | Nature of liability | text | not explicit in extracted object | 2429 |
| amount_incurred_during_previous_year | Amount incurred during PY | number | not explicit in extracted object | 2430 |
| amount_paid_on_or_before_due_date_under_section_139_1 | Paid on / before 139(1) due date | number | not explicit in extracted object | 2436 |
| amount_not_paid_on_or_before_due_date_under_section_139_1 | Not paid on / before 139(1) due date | number | not explicit in extracted object | 2442 |
| due_date_under_section_139_1 | Due date u/s 139(1) | date | not explicit in extracted object | 2448 |
| actual_payment_date | Actual payment date | date | not explicit in extracted object | 2449 |
| amount_disallowable_or_to_be_reviewed | Disallowable / to be reviewed | number | not explicit in extracted object | 2450 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2456 |
| remarks | Remarks | text | not explicit in extracted object | 2457 |
| tax_or_levy_type | Tax / levy type | select | not explicit in extracted object | 2467 |
| amount_passed_through_profit_and_loss | Amount passed through P&L | number | not explicit in extracted object | 2474 |
| accounting_treatment | Accounting treatment | select | not explicit in extracted object | 2480 |
| nature_of_account | Nature of account | text | not explicit in extracted object | 2487 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2488 |
| remarks | Remarks | text | not explicit in extracted object | 2489 |
| credit_type | Credit type | select | not explicit in extracted object | 2504 |
| opening_balance | Opening balance | number | not explicit in extracted object | 2511 |
| credit_availed_during_previous_year | Credit availed during PY | number | not explicit in extracted object | 2512 |
| credit_utilised_during_previous_year | Credit utilised during PY | number | not explicit in extracted object | 2518 |
| closing_or_outstanding_balance | Closing / outstanding balance | number | not explicit in extracted object | 2524 |
| treatment_in_profit_and_loss_account | Treatment in P&L | select | not explicit in extracted object | 2530 |
| treatment_in_balance_sheet | Treatment in balance sheet | text | not explicit in extracted object | 2537 |
| applicability_view | Applicability view | select | not explicit in extracted object | 2543 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2550 |
| remarks | Remarks | text | not explicit in extracted object | 2551 |
| item_type | Item type | select | not explicit in extracted object | 2561 |
| particulars | Particulars | text | not explicit in extracted object | 2568 |
| amount | Amount | number | not explicit in extracted object | 2569 |
| prior_period_to_which_it_relates | Prior period to which it relates | text | not explicit in extracted object | 2570 |
| credited_or_debited_to_profit_and_loss | Credited / debited to P&L | select | not explicit in extracted object | 2576 |
| whether_crystallised_during_current_year | Crystallised during current year | select | not explicit in extracted object | 2583 |
| accounting_standard_reference | Accounting standard reference | text | not explicit in extracted object | 2590 |
| auditor_view | Auditor view | select | not explicit in extracted object | 2596 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2603 |
| remarks | Remarks | text | not explicit in extracted object | 2604 |
| payer_name | Payer name | text | not explicit in extracted object | 2616 |
| payer_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 2617 |
| nature_of_capital_asset | Nature of capital asset | text | not explicit in extracted object | 2618 |
| description_of_capital_asset | Description of capital asset | text | not explicit in extracted object | 2619 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 2620 |
| amount_received_as_advance | Advance received | number | not explicit in extracted object | 2621 |
| amount_forfeited | Amount forfeited | number | not explicit in extracted object | 2622 |
| whether_negotiations_resulted_in_transfer | Negotiations resulted in transfer | select | not explicit in extracted object | 2623 |
| amount_chargeable_under_section_56_2_ix | Amount chargeable u/s 56(2)(ix) | number | not explicit in extracted object | 2630 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2636 |
| remarks | Remarks | text | not explicit in extracted object | 2637 |
| person_from_whom_received | Person from whom received | text | not explicit in extracted object | 2651 |
| pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 2652 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 2653 |
| amount_received | Amount received | number | not explicit in extracted object | 2654 |
| consideration_paid_if_any | Consideration paid, if any | number | not explicit in extracted object | 2655 |
| amount_chargeable_under_section_56_2_x | Amount chargeable u/s 56(2)(x) | number | not explicit in extracted object | 2656 |
| exception_or_exemption_claimed | Exception / exemption claimed | select | not explicit in extracted object | 2662 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2669 |
| remarks | Remarks | text | not explicit in extracted object | 2670 |
| property_description | Property description | text | not explicit in extracted object | 2680 |
| property_address | Property address | text | not explicit in extracted object | 2681 |
| date_of_receipt_or_registration | Receipt / registration date | date | not explicit in extracted object | 2682 |
| stamp_duty_value | Stamp duty value | number | not explicit in extracted object | 2683 |
| consideration_paid | Consideration paid | number | not explicit in extracted object | 2684 |
| difference_or_amount_chargeable | Difference / amount chargeable | number | not explicit in extracted object | 2685 |
| valuation_reference | Valuation reference | text | not explicit in extracted object | 2686 |
| exception_or_exemption_claimed | Exception / exemption claimed | select | not explicit in extracted object | 2687 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2694 |
| remarks | Remarks | text | not explicit in extracted object | 2695 |
| property_type | Property type | select | not explicit in extracted object | 2705 |
| property_description | Property description | text | not explicit in extracted object | 2712 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 2713 |
| fair_market_value | Fair market value | number | not explicit in extracted object | 2714 |
| consideration_paid | Consideration paid | number | not explicit in extracted object | 2715 |
| difference_or_amount_chargeable | Difference / amount chargeable | number | not explicit in extracted object | 2716 |
| valuation_reference | Valuation reference | text | not explicit in extracted object | 2717 |
| exception_or_exemption_claimed | Exception / exemption claimed | select | not explicit in extracted object | 2718 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2725 |
| remarks | Remarks | text | not explicit in extracted object | 2726 |
| transaction_type | Transaction type | select | not explicit in extracted object | 2738 |
| name_of_lender_or_payee | Lender / payee name | text | not explicit in extracted object | 2745 |
| pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 2746 |
| address | Address | text | not explicit in extracted object | 2747 |
| date_of_borrowing_or_repayment | Borrowing / repayment date | date | not explicit in extracted object | 2748 |
| amount_borrowed | Amount borrowed | number | not explicit in extracted object | 2749 |
| amount_repaid | Amount repaid | number | not explicit in extracted object | 2750 |
| interest_amount | Interest amount | number | not explicit in extracted object | 2751 |
| mode_of_payment_or_repayment | Mode of payment / repayment | select | not explicit in extracted object | 2752 |
| whether_otherwise_than_account_payee_cheque | Otherwise than account payee cheque | select | not explicit in extracted object | 2759 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2766 |
| remarks | Remarks | text | not explicit in extracted object | 2767 |
| associated_enterprise_name | Associated enterprise name | text | not explicit in extracted object | 2778 |
| associated_enterprise_country | Associated enterprise country | text | not explicit in extracted object | 2779 |
| nature_of_international_transaction | Nature of international transaction | text | not explicit in extracted object | 2780 |
| basis_of_primary_adjustment | Basis of primary adjustment | select | not explicit in extracted object | 2786 |
| amount_of_primary_adjustment | Amount of primary adjustment | number | not explicit in extracted object | 2793 |
| whether_excess_money_available_with_associated_enterprise | Excess money available with associated enterprise | select | not explicit in extracted object | 2794 |
| whether_repatriation_required | Repatriation required | select | not explicit in extracted object | 2801 |
| prescribed_repatriation_due_date | Prescribed repatriation due date | date | not explicit in extracted object | 2808 |
| amount_repatriated | Amount repatriated | number | not explicit in extracted object | 2809 |
| date_of_repatriation | Date of repatriation | date | not explicit in extracted object | 2810 |
| balance_not_repatriated | Balance not repatriated | number | not explicit in extracted object | 2811 |
| imputed_interest_income | Imputed interest income | number | not explicit in extracted object | 2812 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2813 |
| remarks | Remarks | text | not explicit in extracted object | 2814 |
| lender_name | Lender name | text | not explicit in extracted object | 2828 |
| lender_country | Lender country | text | not explicit in extracted object | 2829 |
| whether_lender_is_associated_enterprise | Lender is associated enterprise | select | not explicit in extracted object | 2830 |
| whether_debt_deemed_issued_by_associated_enterprise | Debt deemed issued by associated enterprise | select | not explicit in extracted object | 2837 |
| nature_of_debt | Nature of debt | select | not explicit in extracted object | 2844 |
| nature_of_interest_or_similar_expenditure | Nature of interest / similar expenditure | text | not explicit in extracted object | 2851 |
| amount_of_interest_or_similar_expenditure | Interest / similar expenditure amount | number | not explicit in extracted object | 2857 |
| guarantee_or_matching_deposit_details | Guarantee / matching deposit details | text | not explicit in extracted object | 2863 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2869 |
| remarks | Remarks | text | not explicit in extracted object | 2870 |
| aggregate_interest_or_similar_expenditure | Aggregate interest / similar expenditure | number | not explicit in extracted object | 2880 |
| threshold_of_one_crore_exceeded | Threshold of one crore exceeded | select | not explicit in extracted object | 2886 |
| ebitda_for_previous_year | EBITDA for previous year | number | not explicit in extracted object | 2893 |
| thirty_percent_of_ebitda | 30% of EBITDA | number | not explicit in extracted object | 2894 |
| excess_interest_expenditure | Excess interest expenditure | number | not explicit in extracted object | 2895 |
| interest_disallowed_current_year | Interest disallowed current year | number | not explicit in extracted object | 2896 |
| interest_brought_forward_from_earlier_years | Interest brought forward | number | not explicit in extracted object | 2897 |
| interest_carried_forward_to_subsequent_years | Interest carried forward | number | not explicit in extracted object | 2903 |
| basis_of_computation | Basis of computation | text | not explicit in extracted object | 2909 |
| remarks | Remarks | text | not explicit in extracted object | 2910 |
| arrangement_name_or_reference | Arrangement name / reference | text | not explicit in extracted object | 2922 |
| parties_involved | Parties involved | text | not explicit in extracted object | 2923 |
| nature_of_arrangement | Nature of arrangement | text | not explicit in extracted object | 2924 |
| whether_impermissible_avoidance_arrangement_identified | Impermissible avoidance arrangement identified | select | not explicit in extracted object | 2925 |
| section_96_condition | Section 96 condition | select | not explicit in extracted object | 2932 |
| amount_of_tax_benefit | Amount of tax benefit | number | not explicit in extracted object | 2939 |
| reporting_basis | Reporting basis | select | not explicit in extracted object | 2940 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 2947 |
| remarks | Remarks | text | not explicit in extracted object | 2948 |
| lender_or_depositor_name | Lender / depositor name | text | not explicit in extracted object | 2962 |
| address | Address | text | not explicit in extracted object | 2963 |
| pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 2964 |
| transaction_type | Transaction type | select | not explicit in extracted object | 2965 |
| amount_of_loan_or_deposit | Amount of loan / deposit | number | not explicit in extracted object | 2972 |
| date_of_acceptance | Date of acceptance | date | not explicit in extracted object | 2973 |
| whether_squared_up_during_year | Squared up during year | select | not explicit in extracted object | 2974 |
| maximum_amount_outstanding_during_year | Maximum outstanding during year | number | not explicit in extracted object | 2981 |
| amount_outstanding_on_date_of_acceptance | Outstanding on date of acceptance | number | not explicit in extracted object | 2987 |
| mode_of_acceptance | Mode of acceptance | select | not explicit in extracted object | 2993 |
| whether_account_payee_or_prescribed_mode | Account payee / prescribed mode | select | not explicit in extracted object | 3000 |
| whether_269ss_threshold_crossed | 269SS threshold crossed | select | not explicit in extracted object | 3007 |
| exemption_or_review_status | Exemption / review status | select | not explicit in extracted object | 3014 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3021 |
| remarks | Remarks | text | not explicit in extracted object | 3022 |
| payer_name | Payer name | text | not explicit in extracted object | 3032 |
| address | Address | text | not explicit in extracted object | 3033 |
| pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3034 |
| property_description | Property description | text | not explicit in extracted object | 3035 |
| nature_of_specified_sum | Nature of specified sum | select | not explicit in extracted object | 3036 |
| amount_of_specified_sum | Amount of specified sum | number | not explicit in extracted object | 3043 |
| date_of_acceptance | Date of acceptance | date | not explicit in extracted object | 3044 |
| whether_transaction_resulted_in_transfer | Transaction resulted in transfer | select | not explicit in extracted object | 3045 |
| mode_of_acceptance | Mode of acceptance | select | not explicit in extracted object | 3052 |
| whether_account_payee_or_prescribed_mode | Account payee / prescribed mode | select | not explicit in extracted object | 3059 |
| whether_269ss_threshold_crossed | 269SS threshold crossed | select | not explicit in extracted object | 3066 |
| exemption_or_review_status | Exemption / review status | select | not explicit in extracted object | 3073 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3080 |
| remarks | Remarks | text | not explicit in extracted object | 3081 |
| payer_name | Payer name | text | not explicit in extracted object | 3091 |
| payer_address | Payer address | text | not explicit in extracted object | 3092 |
| payer_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3093 |
| nature_of_transaction | Nature of transaction | text | not explicit in extracted object | 3094 |
| reporting_trigger | Reporting trigger | select | not explicit in extracted object | 3095 |
| transaction_or_event_reference | Transaction / event reference | text | not explicit in extracted object | 3102 |
| amount_received | Amount received | number | not explicit in extracted object | 3103 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 3104 |
| mode_of_receipt | Mode of receipt | select | not explicit in extracted object | 3105 |
| whether_permitted_mode | Permitted mode | select | not explicit in extracted object | 3112 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3119 |
| remarks | Remarks | text | not explicit in extracted object | 3120 |
| payer_name | Payer name | text | not explicit in extracted object | 3130 |
| payer_address | Payer address | text | not explicit in extracted object | 3131 |
| payer_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3132 |
| reporting_trigger | Reporting trigger | select | not explicit in extracted object | 3133 |
| transaction_or_event_reference | Transaction / event reference | text | not explicit in extracted object | 3140 |
| amount_received | Amount received | number | not explicit in extracted object | 3141 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 3142 |
| instrument_type | Instrument type | select | not explicit in extracted object | 3143 |
| instrument_number | Instrument number | text | not explicit in extracted object | 3150 |
| whether_account_payee | Account payee | select | not explicit in extracted object | 3151 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3158 |
| remarks | Remarks | text | not explicit in extracted object | 3159 |
| payee_name | Payee name | text | not explicit in extracted object | 3169 |
| payee_address | Payee address | text | not explicit in extracted object | 3170 |
| payee_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3171 |
| nature_of_transaction | Nature of transaction | text | not explicit in extracted object | 3172 |
| reporting_trigger | Reporting trigger | select | not explicit in extracted object | 3173 |
| transaction_or_event_reference | Transaction / event reference | text | not explicit in extracted object | 3180 |
| amount_paid | Amount paid | number | not explicit in extracted object | 3181 |
| date_of_payment | Date of payment | date | not explicit in extracted object | 3182 |
| mode_of_payment | Mode of payment | select | not explicit in extracted object | 3183 |
| whether_permitted_mode | Permitted mode | select | not explicit in extracted object | 3190 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3197 |
| remarks | Remarks | text | not explicit in extracted object | 3198 |
| payee_name | Payee name | text | not explicit in extracted object | 3208 |
| payee_address | Payee address | text | not explicit in extracted object | 3209 |
| payee_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3210 |
| reporting_trigger | Reporting trigger | select | not explicit in extracted object | 3211 |
| transaction_or_event_reference | Transaction / event reference | text | not explicit in extracted object | 3218 |
| amount_paid | Amount paid | number | not explicit in extracted object | 3219 |
| date_of_payment | Date of payment | date | not explicit in extracted object | 3220 |
| instrument_type | Instrument type | select | not explicit in extracted object | 3221 |
| instrument_number | Instrument number | text | not explicit in extracted object | 3228 |
| whether_account_payee | Account payee | select | not explicit in extracted object | 3229 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3236 |
| remarks | Remarks | text | not explicit in extracted object | 3237 |
| payee_name | Payee name | text | not explicit in extracted object | 3247 |
| payee_address | Payee address | text | not explicit in extracted object | 3248 |
| payee_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3249 |
| nature_of_amount_code | Nature code | select | not explicit in extracted object | 3250 |
| transaction_type | Transaction type | select | not explicit in extracted object | 3257 |
| amount_of_repayment | Amount of repayment | number | not explicit in extracted object | 3264 |
| date_of_repayment | Date of repayment | date | not explicit in extracted object | 3265 |
| maximum_amount_outstanding_during_year | Maximum outstanding during year | number | not explicit in extracted object | 3266 |
| mode_of_repayment | Mode of repayment | select | not explicit in extracted object | 3272 |
| whether_repayment_by_cheque_bank_draft_or_ecs | Repayment by cheque / draft / ECS | select | not explicit in extracted object | 3292 |
| whether_account_payee_if_cheque_or_draft | Account payee if cheque / draft | select | not explicit in extracted object | 3299 |
| exception_or_excluded_counterparty_status | Exception / excluded counterparty | select | not explicit in extracted object | 3306 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3313 |
| remarks | Remarks | text | not explicit in extracted object | 3314 |
| payer_name | Payer name | text | not explicit in extracted object | 3324 |
| payer_address | Payer address | text | not explicit in extracted object | 3325 |
| payer_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3326 |
| nature_of_amount_code | Nature code | select | not explicit in extracted object | 3327 |
| transaction_type | Transaction type | select | not explicit in extracted object | 3334 |
| amount_received | Amount received | number | not explicit in extracted object | 3341 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 3342 |
| mode_of_receipt | Mode of receipt | select | not explicit in extracted object | 3343 |
| maximum_amount_outstanding_during_year | Maximum outstanding during year | number | not explicit in extracted object | 3361 |
| exception_or_excluded_counterparty_status | Exception / excluded counterparty | select | not explicit in extracted object | 3367 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3374 |
| remarks | Remarks | text | not explicit in extracted object | 3375 |
| payer_name | Payer name | text | not explicit in extracted object | 3385 |
| payer_address | Payer address | text | not explicit in extracted object | 3386 |
| payer_pan_or_aadhaar | PAN / Aadhaar | text | not explicit in extracted object | 3387 |
| nature_of_amount_code | Nature code | select | not explicit in extracted object | 3388 |
| transaction_type | Transaction type | select | not explicit in extracted object | 3395 |
| amount_received | Amount received | number | not explicit in extracted object | 3402 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 3403 |
| instrument_type | Instrument type | select | not explicit in extracted object | 3404 |
| instrument_number | Instrument number | text | not explicit in extracted object | 3411 |
| whether_account_payee | Account payee | select | not explicit in extracted object | 3412 |
| maximum_amount_outstanding_during_year | Maximum outstanding during year | number | not explicit in extracted object | 3419 |
| exception_or_excluded_counterparty_status | Exception / excluded counterparty | select | not explicit in extracted object | 3425 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3432 |
| remarks | Remarks | text | not explicit in extracted object | 3433 |
| assessment_year | Assessment year | text | not explicit in extracted object | 3448 |
| nature_of_loss_or_allowance | Nature of loss / allowance | select | not explicit in extracted object | 3449 |
| amount_as_returned | Amount as returned | number | not explicit in extracted object | 3456 |
| amount_not_allowed_under_115baa_115bac_115bad_115bae | Amount not allowed under 115BAA/115BAC/115BAD/115BAE | number | not explicit in extracted object | 3457 |
| amount_adjusted_by_withdrawal_of_additional_depreciation | Amount adjusted by withdrawal of additional depreciation | number | not explicit in extracted object | 3463 |
| amount_as_assessed | Amount as assessed | number | not explicit in extracted object | 3469 |
| reference_to_relevant_order | Reference to relevant order | text | not explicit in extracted object | 3470 |
| amount_available_for_carry_forward_or_setoff | Available for carry forward / set-off | number | not explicit in extracted object | 3471 |
| remarks | Remarks | text | not explicit in extracted object | 3477 |
| whether_company | Whether company | select | not explicit in extracted object | 3487 |
| whether_change_in_shareholding_during_previous_year | Change in shareholding during previous year | select | not explicit in extracted object | 3494 |
| date_or_period_of_change | Date / period of change | text | not explicit in extracted object | 3501 |
| nature_of_shareholding_change | Nature of shareholding change | text | not explicit in extracted object | 3502 |
| percentage_change | Percentage change | number | not explicit in extracted object | 3503 |
| loss_affected | Loss affected | text | not explicit in extracted object | 3504 |
| assessment_year_to_which_loss_relates | Assessment year to which loss relates | text | not explicit in extracted object | 3505 |
| section_79_view | Section 79 view | select | not explicit in extracted object | 3506 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3513 |
| remarks | Remarks | text | not explicit in extracted object | 3514 |
| nature_of_speculation_business | Nature of speculation business | text | not explicit in extracted object | 3524 |
| amount_of_speculation_loss | Amount of speculation loss | number | not explicit in extracted object | 3525 |
| assessment_year_or_previous_year | Assessment year / previous year | text | not explicit in extracted object | 3526 |
| whether_loss_incurred_during_previous_year | Loss incurred during previous year | select | not explicit in extracted object | 3527 |
| amount_carried_forward | Amount carried forward | number | not explicit in extracted object | 3534 |
| basis_of_identification | Basis of identification | text | not explicit in extracted object | 3535 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3536 |
| remarks | Remarks | text | not explicit in extracted object | 3537 |
| specified_business_description | Specified business description | text | not explicit in extracted object | 3547 |
| section_35ad_reference_or_business_type | Section 35AD reference / business type | text | not explicit in extracted object | 3548 |
| amount_of_specified_business_loss | Amount of specified business loss | number | not explicit in extracted object | 3549 |
| assessment_year_or_previous_year | Assessment year / previous year | text | not explicit in extracted object | 3550 |
| amount_carried_forward | Amount carried forward | number | not explicit in extracted object | 3551 |
| basis_of_identification | Basis of identification | text | not explicit in extracted object | 3552 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3553 |
| remarks | Remarks | text | not explicit in extracted object | 3554 |
| whether_company | Whether company | select | not explicit in extracted object | 3564 |
| whether_deemed_speculation_business | Deemed speculation business | select | not explicit in extracted object | 3571 |
| nature_of_business | Nature of business | text | not explicit in extracted object | 3578 |
| basis_for_deemed_speculation_view | Basis for deemed speculation view | text | not explicit in extracted object | 3579 |
| amount_of_speculation_loss_if_any | Amount of speculation loss, if any | number | not explicit in extracted object | 3580 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3581 |
| remarks | Remarks | text | not explicit in extracted object | 3582 |
| section | Section | select | not explicit in extracted object | 3594 |
| deduction_category | Deduction category | select | not explicit in extracted object | 3601 |
| description | Description | text | not explicit in extracted object | 3608 |
| amount_claimed_by_assessee | Amount claimed by assessee | number | not explicit in extracted object | 3609 |
| amount_admissible_as_per_act | Amount admissible as per Act | number | not explicit in extracted object | 3610 |
| conditions_fulfilled | Conditions fulfilled | select | not explicit in extracted object | 3611 |
| basis_of_admissibility | Basis of admissibility | text | not explicit in extracted object | 3618 |
| whether_restricted_under_special_tax_regime | Restricted under special tax regime | select | not explicit in extracted object | 3619 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3626 |
| remarks | Remarks | text | not explicit in extracted object | 3627 |
| tan | TAN | text | not explicit in extracted object | 3641 |
| tds_or_tcs | TDS / TCS | select | not explicit in extracted object | 3642 |
| section | Section | select | not explicit in extracted object | 3649 |
| nature_of_payment_or_receipt | Nature of payment / receipt | text | not explicit in extracted object | 3656 |
| total_amount_of_payment_or_receipt | Total amount of payment / receipt | number | not explicit in extracted object | 3662 |
| amount_on_which_tax_required_to_be_deducted_or_collected | Amount on which tax required to be deducted / collected | number | not explicit in extracted object | 3668 |
| specified_rate | Specified rate | text | not explicit in extracted object | 3674 |
| amount_on_which_tax_deducted_or_collected_at_specified_rate | Amount on which tax deducted / collected at specified rate | number | not explicit in extracted object | 3675 |
| tax_deducted_or_collected_at_specified_rate | Tax deducted / collected at specified rate | number | not explicit in extracted object | 3681 |
| amount_on_which_tax_deducted_or_collected_at_lower_or_nil_rate | Amount on which tax deducted / collected at lower or nil rate | number | not explicit in extracted object | 3687 |
| tax_deducted_or_collected_at_lower_or_nil_rate | Tax deducted / collected at lower or nil rate | number | not explicit in extracted object | 3693 |
| lower_or_nil_rate_basis | Lower or nil rate basis | select | not explicit in extracted object | 3699 |
| amount_on_which_tax_not_deducted_or_collected | Amount on which tax not deducted / collected | number | not explicit in extracted object | 3706 |
| tax_not_deducted_or_collected | Tax not deducted / collected | number | not explicit in extracted object | 3712 |
| amount_on_which_tax_deducted_or_collected_but_not_deposited | Amount on which tax deducted / collected but not deposited | number | not explicit in extracted object | 3718 |
| tax_deducted_or_collected_but_not_deposited | Tax deducted / collected but not deposited | number | not explicit in extracted object | 3724 |
| reason_or_review_note | Reason or review note | text | not explicit in extracted object | 3730 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3731 |
| remarks | Remarks | text | not explicit in extracted object | 3732 |
| tan | TAN | text | not explicit in extracted object | 3742 |
| tds_or_tcs | TDS / TCS | select | not explicit in extracted object | 3743 |
| type_of_form | Type of form | select | not explicit in extracted object | 3750 |
| quarter_or_period | Quarter / period | select | not explicit in extracted object | 3757 |
| due_date_for_furnishing | Due date for furnishing | date | not explicit in extracted object | 3764 |
| date_of_furnishing | Date of furnishing | date | not explicit in extracted object | 3770 |
| acknowledgment_number_or_token | Acknowledgment number / token | text | not explicit in extracted object | 3776 |
| whether_statement_furnished | Whether statement furnished | select | not explicit in extracted object | 3782 |
| whether_statement_contains_all_required_transactions | Contains all required transactions | select | not explicit in extracted object | 3789 |
| details_of_transactions_not_reported | Details of transactions not reported | text | not explicit in extracted object | 3796 |
| reason_for_delay_or_omission | Reason for delay or omission | text | not explicit in extracted object | 3802 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3808 |
| remarks | Remarks | text | not explicit in extracted object | 3809 |
| tan | TAN | text | not explicit in extracted object | 3819 |
| tds_or_tcs | TDS / TCS | select | not explicit in extracted object | 3820 |
| interest_section | Interest section | select | not explicit in extracted object | 3827 |
| default_type | Default type | select | not explicit in extracted object | 3834 |
| quarter_or_period | Quarter / period | select | not explicit in extracted object | 3841 |
| nature_of_payment_or_receipt | Nature of payment / receipt | text | not explicit in extracted object | 3848 |
| amount_of_interest_payable | Amount of interest payable | number | not explicit in extracted object | 3854 |
| amount_of_interest_paid | Amount of interest paid | number | not explicit in extracted object | 3860 |
| balance_interest_payable | Balance interest payable | number | not explicit in extracted object | 3866 |
| date_of_payment | Date of payment | date | not explicit in extracted object | 3872 |
| challan_bsr_code | Challan BSR code | text | not explicit in extracted object | 3878 |
| challan_serial_number | Challan serial number | text | not explicit in extracted object | 3884 |
| challan_date | Challan date | date | not explicit in extracted object | 3890 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3896 |
| remarks | Remarks | text | not explicit in extracted object | 3897 |
| item_name | Item name | text | not explicit in extracted object | 3912 |
| item_description | Item description | text | not explicit in extracted object | 3913 |
| unit_of_measurement | Unit of measurement | text | not explicit in extracted object | 3914 |
| whether_principal_item | Principal item | select | not explicit in extracted object | 3915 |
| opening_stock_quantity | Opening stock quantity | number | not explicit in extracted object | 3922 |
| purchases_quantity | Purchases quantity | number | not explicit in extracted object | 3923 |
| sales_quantity | Sales quantity | number | not explicit in extracted object | 3924 |
| closing_stock_quantity | Closing stock quantity | number | not explicit in extracted object | 3925 |
| shortage_or_excess_quantity | Shortage / excess quantity | number | not explicit in extracted object | 3926 |
| reason_for_shortage_or_excess | Reason for shortage / excess | text | not explicit in extracted object | 3927 |
| basis_of_identification_as_principal_item | Basis of identification as principal item | select | not explicit in extracted object | 3928 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3935 |
| remarks | Remarks | text | not explicit in extracted object | 3936 |
| raw_material_name | Raw material name | text | not explicit in extracted object | 3946 |
| raw_material_description | Raw material description | text | not explicit in extracted object | 3947 |
| unit_of_measurement | Unit of measurement | text | not explicit in extracted object | 3948 |
| whether_principal_item | Principal item | select | not explicit in extracted object | 3949 |
| opening_stock_quantity | Opening stock quantity | number | not explicit in extracted object | 3956 |
| purchases_quantity | Purchases quantity | number | not explicit in extracted object | 3957 |
| consumption_quantity | Consumption quantity | number | not explicit in extracted object | 3958 |
| sales_quantity | Sales quantity | number | not explicit in extracted object | 3959 |
| closing_stock_quantity | Closing stock quantity | number | not explicit in extracted object | 3960 |
| yield_or_related_finished_product_reference | Yield / related finished product ref | text | not explicit in extracted object | 3961 |
| shortage_or_excess_quantity | Shortage / excess quantity | number | not explicit in extracted object | 3967 |
| reason_for_shortage_or_excess | Reason for shortage / excess | text | not explicit in extracted object | 3968 |
| basis_of_identification_as_principal_item | Basis of identification as principal item | select | not explicit in extracted object | 3969 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 3976 |
| remarks | Remarks | text | not explicit in extracted object | 3977 |
| product_name | Product name | text | not explicit in extracted object | 3987 |
| product_description | Product description | text | not explicit in extracted object | 3988 |
| product_type | Product type | select | not explicit in extracted object | 3989 |
| unit_of_measurement | Unit of measurement | text | not explicit in extracted object | 3996 |
| whether_principal_item | Principal item | select | not explicit in extracted object | 3997 |
| opening_stock_quantity | Opening stock quantity | number | not explicit in extracted object | 4004 |
| purchases_quantity | Purchases quantity | number | not explicit in extracted object | 4005 |
| quantity_manufactured | Quantity manufactured | number | not explicit in extracted object | 4006 |
| sales_quantity | Sales quantity | number | not explicit in extracted object | 4007 |
| closing_stock_quantity | Closing stock quantity | number | not explicit in extracted object | 4008 |
| shortage_or_excess_quantity | Shortage / excess quantity | number | not explicit in extracted object | 4009 |
| reason_for_shortage_or_excess | Reason for shortage / excess | text | not explicit in extracted object | 4010 |
| yield_percentage_if_available | Yield %, if available | number | not explicit in extracted object | 4011 |
| basis_of_identification_as_principal_item | Basis of identification as principal item | select | not explicit in extracted object | 4012 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4019 |
| remarks | Remarks | text | not explicit in extracted object | 4020 |
| payer_company_name | Payer company name | text | not explicit in extracted object | 4035 |
| payer_company_pan | Payer company PAN | text | not explicit in extracted object | 4036 |
| whether_company_is_closely_held | Closely held company | select | not explicit in extracted object | 4037 |
| nature_of_payment | Nature of payment | select | not explicit in extracted object | 4044 |
| date_of_receipt | Date of receipt | date | not explicit in extracted object | 4051 |
| amount_received | Amount received | number | not explicit in extracted object | 4052 |
| accumulated_profits_available | Accumulated profits available | number | not explicit in extracted object | 4053 |
| assessee_shareholding_or_interest | Assessee shareholding / interest | text | not explicit in extracted object | 4054 |
| concern_in_which_substantial_interest_exists | Concern in which substantial interest exists | text | not explicit in extracted object | 4055 |
| whether_trade_advance_or_commercial_transaction | Trade advance / commercial transaction | select | not explicit in extracted object | 4061 |
| amount_treated_as_deemed_dividend | Amount treated as deemed dividend | number | not explicit in extracted object | 4068 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4069 |
| remarks | Remarks | text | not explicit in extracted object | 4070 |
| company_name | Company name | text | not explicit in extracted object | 4085 |
| company_pan | Company PAN | text | not explicit in extracted object | 4086 |
| class_or_type_of_shares | Class / type of shares | select | not explicit in extracted object | 4087 |
| date_of_buyback | Date of buyback | date | not explicit in extracted object | 4094 |
| number_of_shares_bought_back | No. of shares bought back | number | not explicit in extracted object | 4095 |
| amount_received | Amount received | number | not explicit in extracted object | 4096 |
| cost_of_acquisition_of_shares_bought_back | Cost of acquisition of shares bought back | number | not explicit in extracted object | 4097 |
| amount_treated_as_dividend | Amount treated as dividend | number | not explicit in extracted object | 4103 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4104 |
| remarks | Remarks | text | not explicit in extracted object | 4105 |
| whether_cost_audit_applicable | Cost audit applicable | select | not explicit in extracted object | 4120 |
| whether_cost_audit_carried_out | Cost audit carried out | select | not explicit in extracted object | 4127 |
| law_or_section_reference | Law / section reference | text | not explicit in extracted object | 4134 |
| period_covered | Period covered | text | not explicit in extracted object | 4135 |
| cost_auditor_name | Cost auditor name | text | not explicit in extracted object | 4136 |
| cost_auditor_registration_or_membership_no | Registration / membership no. | text | not explicit in extracted object | 4137 |
| cost_audit_report_date | Report date | date | not explicit in extracted object | 4138 |
| cost_audit_report_reference | Report reference | text | not explicit in extracted object | 4139 |
| whether_disqualification_or_disagreement_reported | Disqualification / disagreement reported | select | not explicit in extracted object | 4140 |
| matter_or_item_reported | Matter / item reported | text | not explicit in extracted object | 4147 |
| nature_of_disqualification_or_disagreement | Nature of matter | select | not explicit in extracted object | 4148 |
| amount_value_or_quantity_involved | Amount / value / quantity involved | number | not explicit in extracted object | 4155 |
| management_response | Management response | text | not explicit in extracted object | 4156 |
| auditor_review_note | Auditor review note | text | not explicit in extracted object | 4157 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4158 |
| remarks | Remarks | text | not explicit in extracted object | 4159 |
| whether_excise_audit_applicable | Excise audit applicable | select | not explicit in extracted object | 4174 |
| whether_excise_audit_carried_out | Excise audit carried out | select | not explicit in extracted object | 4181 |
| period_covered | Period covered | text | not explicit in extracted object | 4188 |
| excise_registration_or_reference_no | Registration / reference no. | text | not explicit in extracted object | 4189 |
| auditor_or_authority_name | Auditor / authority name | text | not explicit in extracted object | 4190 |
| excise_audit_report_date | Report date | date | not explicit in extracted object | 4191 |
| excise_audit_report_reference | Report reference | text | not explicit in extracted object | 4192 |
| whether_disqualification_or_disagreement_reported | Disqualification / disagreement reported | select | not explicit in extracted object | 4193 |
| matter_or_item_reported | Matter / item reported | text | not explicit in extracted object | 4200 |
| nature_of_disqualification_or_disagreement | Nature of matter | select | not explicit in extracted object | 4201 |
| amount_value_or_quantity_involved | Amount / value / quantity involved | number | not explicit in extracted object | 4208 |
| management_response | Management response | text | not explicit in extracted object | 4209 |
| auditor_review_note | Auditor review note | text | not explicit in extracted object | 4210 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4211 |
| remarks | Remarks | text | not explicit in extracted object | 4212 |
| whether_service_tax_audit_applicable | Service tax audit applicable | select | not explicit in extracted object | 4227 |
| whether_service_tax_audit_carried_out | Service tax audit carried out | select | not explicit in extracted object | 4234 |
| period_covered | Period covered | text | not explicit in extracted object | 4241 |
| service_tax_registration_or_reference_no | Registration / reference no. | text | not explicit in extracted object | 4242 |
| auditor_or_authority_name | Auditor / authority name | text | not explicit in extracted object | 4243 |
| service_tax_audit_report_date | Report date | date | not explicit in extracted object | 4244 |
| service_tax_audit_report_reference | Report reference | text | not explicit in extracted object | 4245 |
| whether_disqualification_or_disagreement_reported | Disqualification / disagreement reported | select | not explicit in extracted object | 4246 |
| matter_or_item_reported | Matter / item reported | text | not explicit in extracted object | 4253 |
| nature_of_disqualification_or_disagreement | Nature of matter | select | not explicit in extracted object | 4254 |
| amount_value_or_quantity_involved | Amount / value / quantity involved | number | not explicit in extracted object | 4261 |
| management_response | Management response | text | not explicit in extracted object | 4262 |
| auditor_review_note | Auditor review note | text | not explicit in extracted object | 4263 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4264 |
| remarks | Remarks | text | not explicit in extracted object | 4265 |
| activity_or_segment_name | Activity / segment name | text | not explicit in extracted object | 4280 |
| activity_type | Activity type | select | not explicit in extracted object | 4281 |
| principal_item_or_service | Principal item / service | text | not explicit in extracted object | 4288 |
| current_year_total_turnover | Current year total turnover | number | not explicit in extracted object | 4289 |
| preceding_year_total_turnover | Preceding year total turnover | number | not explicit in extracted object | 4290 |
| current_year_gross_profit_to_turnover_ratio | Current year gross profit / turnover ratio | number | not explicit in extracted object | 4291 |
| preceding_year_gross_profit_to_turnover_ratio | Preceding year gross profit / turnover ratio | number | not explicit in extracted object | 4292 |
| current_year_net_profit_to_turnover_ratio | Current year net profit / turnover ratio | number | not explicit in extracted object | 4293 |
| preceding_year_net_profit_to_turnover_ratio | Preceding year net profit / turnover ratio | number | not explicit in extracted object | 4294 |
| current_year_stock_in_trade_to_turnover_ratio | Current year stock-in-trade / turnover ratio | number | not explicit in extracted object | 4295 |
| preceding_year_stock_in_trade_to_turnover_ratio | Preceding year stock-in-trade / turnover ratio | number | not explicit in extracted object | 4296 |
| current_year_material_consumed_to_finished_goods_ratio | Current year material consumed / finished goods ratio | number | not explicit in extracted object | 4297 |
| preceding_year_material_consumed_to_finished_goods_ratio | Preceding year material consumed / finished goods ratio | number | not explicit in extracted object | 4303 |
| basis_of_computation | Basis of computation | text | not explicit in extracted object | 4309 |
| whether_significant_deviation_observed | Significant deviation observed | select | not explicit in extracted object | 4310 |
| reason_for_significant_deviation | Reason for significant deviation | text | not explicit in extracted object | 4317 |
| financial_statement_or_working_reference | Financial statement / working ref | text | not explicit in extracted object | 4318 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4319 |
| remarks | Remarks | text | not explicit in extracted object | 4320 |
| financial_year_to_which_demand_or_refund_relates | Financial year to which demand / refund relates | text | not explicit in extracted object | 4335 |
| name_of_applicable_act | Name of applicable Act | text | not explicit in extracted object | 4336 |
| tax_law_category | Tax law category | select | not explicit in extracted object | 4337 |
| demand_or_refund | Demand / refund | select | not explicit in extracted object | 4344 |
| order_number | Order number | text | not explicit in extracted object | 4351 |
| date_of_demand_or_refund_order | Order date | date | not explicit in extracted object | 4352 |
| amount_of_demand_or_refund | Demand / refund amount | number | not explicit in extracted object | 4353 |
| authority_issuing_order | Authority issuing order | text | not explicit in extracted object | 4354 |
| relevant_proceeding_details | Relevant proceeding details | text | not explicit in extracted object | 4355 |
| authority_before_which_matter_is_pending | Pending before authority | text | not explicit in extracted object | 4356 |
| current_status | Current status | select | not explicit in extracted object | 4357 |
| whether_paid_received_or_adjusted | Paid / received / adjusted | select | not explicit in extracted object | 4364 |
| amount_paid_received_or_adjusted | Amount paid / received / adjusted | number | not explicit in extracted object | 4371 |
| date_of_payment_receipt_or_adjustment | Payment / receipt / adjustment date | date | not explicit in extracted object | 4372 |
| mode_or_reference_of_payment_receipt_or_adjustment | Payment / receipt / adjustment ref | text | not explicit in extracted object | 4373 |
| whether_verified_with_portal | Verified with portal | select | not explicit in extracted object | 4374 |
| whether_management_representation_obtained | Management representation obtained | select | not explicit in extracted object | 4381 |
| financial_statement_or_caro_reference | Financial statement / CARO ref | text | not explicit in extracted object | 4388 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4389 |
| remarks | Remarks | text | not explicit in extracted object | 4390 |
| form_no | Form no. | select | not explicit in extracted object | 4405 |
| whether_required_to_furnish | Required to furnish | select | not explicit in extracted object | 4412 |
| section_and_rule_reference | Section / rule reference | text | not explicit in extracted object | 4419 |
| reporting_period | Reporting period | select | not explicit in extracted object | 4420 |
| registration_number_or_itdrein | Registration no. / ITDREIN | text | not explicit in extracted object | 4427 |
| designated_director_or_principal_officer_details | Designated director / principal officer details | text | not explicit in extracted object | 4428 |
| due_date_for_furnishing | Due date for furnishing | date | not explicit in extracted object | 4434 |
| date_of_actual_furnishing | Date of actual furnishing | date | not explicit in extracted object | 4441 |
| acknowledgment_number | Acknowledgment number | text | not explicit in extracted object | 4442 |
| whether_form_furnished | Form furnished | select | not explicit in extracted object | 4443 |
| whether_furnished_within_due_date | Furnished within due date | select | not explicit in extracted object | 4450 |
| whether_form_contains_all_required_information | Contains all required information | select | not explicit in extracted object | 4457 |
| details_of_information_or_transactions_not_reported | Information / transactions not reported | text | not explicit in extracted object | 4464 |
| reason_for_delay_or_omission | Reason for delay / omission | text | not explicit in extracted object | 4470 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4471 |
| remarks | Remarks | text | not explicit in extracted object | 4472 |
| whether_liable_to_furnish_report_under_section_286_2 | Liable to furnish report under section 286(2) | select | not explicit in extracted object | 4487 |
| assessee_role_in_international_group | Assessee role in international group | select | not explicit in extracted object | 4494 |
| international_group_name | International group name | text | not explicit in extracted object | 4501 |
| reporting_accounting_year | Reporting accounting year | text | not explicit in extracted object | 4502 |
| parent_entity_name | Parent entity name | text | not explicit in extracted object | 4503 |
| parent_entity_country_or_territory | Parent entity country / territory | text | not explicit in extracted object | 4504 |
| parent_entity_pan_or_tax_identification_number | Parent PAN / tax identification no. | text | not explicit in extracted object | 4505 |
| alternate_reporting_entity_name | Alternate reporting entity name | text | not explicit in extracted object | 4506 |
| alternate_reporting_entity_country_or_territory | Alternate reporting entity country / territory | text | not explicit in extracted object | 4507 |
| alternate_reporting_entity_pan_or_tax_identification_number | Alternate reporting PAN / tax identification no. | text | not explicit in extracted object | 4513 |
| whether_form_3ceac_furnished | Form 3CEAC furnished | select | not explicit in extracted object | 4519 |
| form_3ceac_date_of_furnishing | Form 3CEAC furnishing date | date | not explicit in extracted object | 4526 |
| form_3ceac_acknowledgment_number | Form 3CEAC acknowledgment no. | text | not explicit in extracted object | 4527 |
| whether_report_under_section_286_2_furnished | Report under section 286(2) furnished | select | not explicit in extracted object | 4528 |
| report_furnished_by | Report furnished by | select | not explicit in extracted object | 4535 |
| form_or_report_reference | Form / report reference | select | not explicit in extracted object | 4542 |
| date_of_furnishing_of_report | Report furnishing date | date | not explicit in extracted object | 4549 |
| acknowledgment_number | Acknowledgment number | text | not explicit in extracted object | 4550 |
| whether_copy_of_report_or_acknowledgment_verified | Copy / acknowledgment verified | select | not explicit in extracted object | 4551 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4558 |
| remarks | Remarks | text | not explicit in extracted object | 4559 |
| expenditure_head | Expenditure head | text | not explicit in extracted object | 4574 |
| expenditure_type | Expenditure type | select | not explicit in extracted object | 4575 |
| total_amount_of_expenditure | Total amount of expenditure | number | not explicit in extracted object | 4582 |
| expenditure_relating_to_exempt_goods_or_services_from_registered_entities | Exempt goods / services from registered entities | number | not explicit in extracted object | 4583 |
| expenditure_relating_to_composition_entities | Composition entities | number | not explicit in extracted object | 4589 |
| expenditure_relating_to_other_registered_entities | Other registered entities | number | not explicit in extracted object | 4590 |
| total_expenditure_relating_to_registered_entities | Total expenditure relating to registered entities | number | not explicit in extracted object | 4591 |
| expenditure_relating_to_unregistered_entities | Unregistered entities | number | not explicit in extracted object | 4597 |
| reconciliation_difference | Reconciliation difference | number | not explicit in extracted object | 4598 |
| reason_for_reconciliation_difference | Reason for reconciliation difference | text | not explicit in extracted object | 4599 |
| basis_of_classification | Basis of classification | select | not explicit in extracted object | 4600 |
| whether_capital_expenditure_included | Capital expenditure included | select | not explicit in extracted object | 4607 |
| whether_multiple_gstin_consolidation_involved | Multiple GSTIN consolidation involved | select | not explicit in extracted object | 4614 |
| gstin_or_branch_reference | GSTIN / branch reference | text | not explicit in extracted object | 4621 |
| evidence_or_working_reference | Evidence / working ref | text | not explicit in extracted object | 4622 |
| remarks | Remarks | text | not explicit in extracted object | 4623 |

## Fields beyond standalone columns

Tax setup, programme, compliance tracker, acknowledgement, prefill provenance and review state also use nested JSON and TypeScript contracts. Their business fields are described in M-14. Exact form visibility, summary fields and selection options must be read with the source definitions and tested for the target year. Empty, zero, not applicable, pending and unknown require distinct review treatment.
