export const FORM_3CA_TEMPLATE_VERSION = '1';

export const form3caTemplate = `
<div class="preview-letter" data-template-version="${FORM_3CA_TEMPLATE_VERSION}">
  <div class="page">
    <header>
      <p class="heading bold center">Form No. 3CA</p>
      <p class="subheading center">(See rule 6G(1)(a))</p>
      <p class="subheading bold center">Audit Report U/s 44AB of the Income-tax Act, 1961,</p>
      <p class="subheading center">in a case where the accounts of the business or profession of a person</p>
    </header>

    <p class="spacer"></p>

    <section>
      <p class="clause">
        <span class="bold">1.</span>&nbsp;&nbsp;&nbsp;<span class="placeholder">{{I_OR_WE}}</span> report that the statutory audit of M/s. <span class="placeholder">{{ASSESSEE_NAME_AND_ADDRESS}}</span> (Name and address of the assessee with Permanent Account Number or Aadhaar Number) was conducted by <span class="placeholder">{{ME_OR_US}}</span>/M/s. <span class="placeholder">{{STATUTORY_AUDITOR_NAME}}</span> in pursuance of the provisions of the <span class="placeholder">{{GOVERNING_ACT_NAME}}</span> Act, and <span class="placeholder">{{I_OR_WE}}</span> annex hereto a copy of <span class="placeholder">{{MY_OUR_OR_THEIR}}</span> audit report dated <span class="placeholder">{{STATUTORY_AUDIT_REPORT_DATE}}</span> along with a copy of each of:-
      </p>

      <p class="subclause">
        (a) the audited <span class="placeholder">{{PROFIT_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT}}</span> for the period beginning from <span class="placeholder">{{PERIOD_START_DATE}}</span> to ending on <span class="placeholder">{{PERIOD_END_DATE}}</span>;
      </p>

      <p class="subclause">
        (b) the audited balance sheet as at <span class="placeholder">{{BALANCE_SHEET_DATE}}</span>; and
      </p>

      <p class="subclause">
        (c) documents declared by the said Act to be part of, or annexed to, the <span class="placeholder">{{PROFIT_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT}}</span> and balance sheet.
      </p>

      <p class="clause">
        <span class="bold">2.</span>&nbsp;&nbsp;&nbsp;The statement of particulars required to be furnished u/s 44AB is annexed herewith in Form No. 3CD.
      </p>

      <p class="clause">
        <span class="bold">3.</span>&nbsp;&nbsp;&nbsp;In <span class="placeholder">{{MY_OR_OUR}}</span> opinion and to the best of <span class="placeholder">{{MY_OR_OUR}}</span> information and according to examination of books of account including other relevant documents and explanations given to <span class="placeholder">{{ME_OR_US}}</span>, the particulars given in the said Form No. 3CD and annexure thereto are true and correct subject to following observations/qualifications, if any:
      </p>

      <p class="responsibility">
        (i) <span class="bold">Assessee’s Responsibility for Statement of Particulars in Form 3CD</span> - The assessee is responsible for the preparation of the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(2) of Income Tax Rules, 1962 that give true and correct particulars as per the provisions of the Income-tax Act, 1961 read with Rules, Notifications, circulars etc. that are to be included in the Statement.
      </p>

      <p class="responsibility">
        (ii) <span class="bold">Tax Auditor’s Responsibility for Statement of Particulars in Form 3CD</span> - <span class="placeholder">{{I_OR_WE}}</span> are also responsible for verifying the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(2) of Income Tax Rules, 1962. <span class="placeholder">{{I_OR_WE}}</span> have conducted <span class="placeholder">{{MY_OR_OUR}}</span> verification of the statement in accordance with Guidance Note on Tax Audit under section 44AB of the Income-tax Act, 1961, issued by the Institute of Chartered Accountants of India.
      </p>

      <p class="responsibility">(iii) <span class="placeholder">{{OBSERVATION_OR_QUALIFICATION_1}}</span></p>

      <p class="responsibility">(iv) <span class="placeholder">{{OBSERVATION_OR_QUALIFICATION_2}}</span></p>

      <p class="responsibility"><span class="placeholder">{{ADDITIONAL_OBSERVATIONS_OR_QUALIFICATIONS}}</span></p>
    </section>

    <p class="spacer"></p>

    <section class="signature-block">
      <p>For <span class="placeholder">{{FIRM_NAME}}</span></p>
      <p>Chartered Accountants</p>
      <p>Firm Registration Number <span class="placeholder">{{FIRM_REGISTRATION_NUMBER}}</span></p>
      <p class="spacer"></p>
      <p>(<span class="placeholder">{{PARTNER_OR_PROPRIETOR_NAME}}</span>)</p>
      <p><span class="placeholder">{{PARTNER_OR_PROPRIETOR_DESIGNATION}}</span></p>
      <p class="spacer"></p>

      <table style="width: 100%;">
        <tr>
          <td style="width: 50%;">Dated: <span class="placeholder">{{REPORT_DATE}}</span></td>
          <td style="width: 50%; text-align: right;">Membership No. <span class="placeholder">{{MEMBERSHIP_NUMBER}}</span></td>
        </tr>
        <tr>
          <td>UDIN: <span class="placeholder">{{UDIN}}</span></td>
          <td></td>
        </tr>
        <tr>
          <td colspan="2">Full address: <span class="placeholder">{{FIRM_FULL_ADDRESS}}</span></td>
        </tr>
      </table>
    </section>

    <p class="spacer"></p>
  </div>
</div>
`;
