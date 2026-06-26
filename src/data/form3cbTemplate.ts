export const FORM_3CB_TEMPLATE_VERSION = '5';

export const form3cbTemplate = `
<div class="preview-letter" data-template-version="${FORM_3CB_TEMPLATE_VERSION}">
  <div class="page">
    <header>
      <p class="heading bold center">Form No. 3CB</p>
      <p class="subheading center">(See rule 6G(1)(b))</p>
      <p class="subheading bold center">Audit Report under section 44AB of the Income-tax Act, 1961, in the case of a person referred to in clause (b) of sub-rule (1) of rule 6G</p>
    </header>

    <p class="spacer"></p>

    <section>
      <p class="clause"><span class="bold">1.</span>&nbsp;&nbsp;&nbsp;<span class="placeholder">{{I_OR_WE}}</span> have examined the balance sheet as on <span class="placeholder">{{BALANCE_SHEET_DATE}}</span> and the <span class="placeholder">{{PROFIT_AND_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT}}</span> for the period beginning from <span class="placeholder">{{PERIOD_START_DATE}}</span> to ending on <span class="placeholder">{{PERIOD_END_DATE}}</span>, attached herewith, of <span class="placeholder">{{ASSESSEE_NAME}}</span>, <span class="placeholder">{{ASSESSEE_ADDRESS}}</span>, PAN: <span class="placeholder">{{ASSESSEE_PAN_OR_AADHAAR}}</span>.</p>

      <p class="clause"><span class="bold">2.</span>&nbsp;&nbsp;&nbsp;<span class="placeholder">{{I_OR_WE}}</span> certify that the balance sheet and the <span class="placeholder">{{PROFIT_AND_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT}}</span> are in agreement with the books of account maintained at the head office at <span class="placeholder">{{HEAD_OFFICE_ADDRESS}}</span> and <span class="placeholder">{{NUMBER_OR_DETAILS_OF_BRANCHES}}</span> branches.</p>

      <p class="clause"><span class="bold">3.</span>&nbsp;&nbsp;&nbsp;<span class="bold">(a)</span> <span class="placeholder">{{I_OR_WE}}</span> report that the following observations / comments / discrepancies / inconsistencies, if any:</p>

      <p class="responsibility"><span class="bold">(i) Assessee's Responsibility for the Financial Statements and Statement of Particulars in Form 3CD</span></p>
      <ol class="roman-list">
        <li>The assessee is responsible for the preparation and fair presentation of the financial statements ("FS") in accordance with the Accounting Standards issued by the Institute of Chartered Accountants of India ("ICAI"), and for such internal control as management determines is necessary to enable the preparation of the financial statements that are free from material misstatement, whether due to fraud or error.</li>
        <li>In preparing the financial statements, management is responsible for assessing the entity's ability to continue as a going concern, disclosing, as applicable, matters related to going concern and using the going concern basis of accounting unless the assessee either intends to liquidate the entity or to cease operations, or has no realistic alternative but to do so.</li>
        <li>Those charged with governance are responsible for overseeing the entity's financial reporting process.</li>
      </ol>

      <p class="responsibility"><span class="bold">B. Tax Auditor's Responsibility</span></p>
      <ol class="roman-list">
        <li><span class="placeholder">{{MY_OR_OUR}}</span> responsibility is to obtain reasonable assurance about whether the financial statements as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditor's report that includes <span class="placeholder">{{MY_OR_OUR}}</span> opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with Standards on Auditing will always detect a material misstatement when it exists. Misstatements can arise from fraud or error and are considered material if, individually or in the aggregate, they could reasonably be expected to influence the economic decisions of users taken on the basis of these financial statements.</li>
        <li>As part of an audit in accordance with the Standards on Auditing issued by the Institute of Chartered Accountants of India, <span class="placeholder">{{I_OR_WE_LOWER}}</span> exercise professional judgement and maintain professional skepticism throughout the audit.</li>
        <li><span class="placeholder">{{I_OR_WE}}</span> also:
          <ol class="lower-alpha-list">
            <li>Identify and assess the risks of material misstatement of the financial statements, whether due to fraud or error, design and perform audit procedures responsive to those risks, and obtain audit evidence that is sufficient and appropriate to provide a basis for <span class="placeholder">{{MY_OR_OUR}}</span> opinion. The risk of not detecting a material misstatement resulting from fraud is higher than for one resulting from error, as fraud may involve collusion, forgery, intentional omissions, misrepresentations, or override of internal control.</li>
            <li>Obtain an understanding of internal control relevant to the audit in order to design audit procedures that are appropriate in the circumstances, but not for the purpose of expressing an opinion on the effectiveness of the entity's internal control.</li>
            <li>Evaluate the appropriateness of accounting policies used and the reasonableness of accounting estimates and related disclosures made by the assessee.</li>
            <li>Conclude on the appropriateness of management's use of the going concern basis of accounting and, based on the audit evidence obtained, whether a material uncertainty exists related to events or conditions that may cast significant doubt on the assessee's ability to continue as a going concern. If <span class="placeholder">{{I_OR_WE_LOWER}}</span> conclude that a material uncertainty exists, <span class="placeholder">{{I_AM_OR_WE_ARE}}</span> required to draw attention in <span class="placeholder">{{MY_OR_OUR}}</span> auditor's report to the related disclosures in the financial statements or, if such disclosures are inadequate, to modify <span class="placeholder">{{MY_OR_OUR}}</span> opinion. <span class="placeholder">{{MY_OR_OUR}}</span> conclusions are based on the audit evidence obtained up to the date of <span class="placeholder">{{MY_OR_OUR}}</span> auditor's report. However, future events or conditions may cause the assessee to cease to continue as a going concern.</li>
            <li>Evaluate the overall presentation, structure and content of the financial statements, including the disclosures, and whether the financial statements represent the underlying transactions and events in a manner that achieves fair presentation.</li>
          </ol>
        </li>
        <li><span class="placeholder">{{I_OR_WE}}</span> communicate with those charged with governance regarding, among other matters, the planned scope and timing of the audit and significant audit findings, including any significant deficiencies in internal control that <span class="placeholder">{{I_OR_WE_LOWER}}</span> identify during <span class="placeholder">{{MY_OR_OUR}}</span> audit.</li>
        <li><span class="placeholder">{{I_OR_WE}}</span> also provide those charged with governance with a statement that <span class="placeholder">{{I_OR_WE_LOWER}}</span> have complied with relevant ethical requirements regarding independence, and to communicate with them all relationships and other matters that may reasonably be thought to bear on <span class="placeholder">{{MY_OR_OUR}}</span> independence, and where applicable, related safeguards.</li>
      </ol>

      <div data-form3cb-observations-para3="true">{{PARA_3_OBSERVATIONS}}</div>

      <p class="responsibility"><span class="bold">(b)</span> Subject to above, -</p>
      <p class="responsibility"><span class="bold">(A)</span> <span class="placeholder">{{I_OR_WE}}</span> have obtained all the information and explanations which, to the best of <span class="placeholder">{{MY_OR_OUR}}</span> knowledge and belief, were necessary for the purposes of audit.</p>
      <p class="responsibility"><span class="bold">(B)</span> In <span class="placeholder">{{MY_OR_OUR}}</span> opinion, proper books of account have been kept by the head office and branches, if any, so far as appears from <span class="placeholder">{{MY_OR_OUR}}</span> examination of the books.</p>
      <p class="responsibility"><span class="bold">(C)</span> In <span class="placeholder">{{MY_OR_OUR}}</span> opinion and to the best of <span class="placeholder">{{MY_OR_OUR}}</span> information and according to the explanations given to <span class="placeholder">{{ME_OR_US}}</span>, the said accounts, read with notes thereon, if any, give a true and fair view:</p>
      <p class="sub-responsibility"><span class="bold">(i)</span> in the case of the balance sheet, of the state of affairs of the assessee as at <span class="placeholder">{{BALANCE_SHEET_DATE}}</span>; and</p>
      <p class="sub-responsibility"><span class="bold">(ii)</span> in the case of the <span class="placeholder">{{PROFIT_AND_LOSS_OR_INCOME_EXPENDITURE_ACCOUNT}}</span>, of the <span class="placeholder">{{RESULT_TERM_CONDITIONAL_ON_ACCOUNT_TYPE}}</span> of the assessee for the year ended on that date.</p>

      <p class="clause"><span class="bold">4.</span>&nbsp;&nbsp;&nbsp;The statement of particulars required to be furnished under section 44AB is annexed herewith in Form No. 3CD.</p>

      <p class="clause"><span class="bold">5.</span>&nbsp;&nbsp;&nbsp;In <span class="placeholder">{{MY_OR_OUR}}</span> opinion and to the best of <span class="placeholder">{{MY_OR_OUR}}</span> information and according to explanations given to <span class="placeholder">{{ME_OR_US}}</span>, the particulars given in said Form No. 3CD and annexure thereto are true and correct subject to following observation / qualifications, if any:</p>
      <p class="responsibility"><span class="bold">(i) Assessee's Responsibility for Statement of Particulars in Form 3CD</span> - The assessee is responsible for the preparation of the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(2) of the Income-tax Rules, 1962, that give true and correct particulars as per the provisions of the Income-tax Act, 1961 read with Rules, Notifications, Circulars, etc., that are to be included in the Statement.</p>
      <p class="responsibility"><span class="bold">(ii) Tax Auditor's Responsibility for Statement of Particulars in Form 3CD</span> - <span class="placeholder">{{I_OR_WE}}</span> <span class="placeholder">{{I_OR_WE_BE}}</span> also responsible for verifying the statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 annexed herewith in Form No. 3CD read with Rule 6G(2) of the Income-tax Rules, 1962. <span class="placeholder">{{I_OR_WE}}</span> have conducted <span class="placeholder">{{MY_OR_OUR}}</span> verification of the statement in accordance with the Guidance Note on Tax Audit under section 44AB of the Income-tax Act, 1961, issued by the Institute of Chartered Accountants of India.</p>
      <div data-form3cb-observations-para5="true">{{PARA_5_OBSERVATIONS}}</div>
    </section>

    <p class="spacer"></p>

    <section class="signature-block">
      <p>For <span class="placeholder">{{CA_FIRM_NAME}}</span></p>
      <p>Chartered Accountants</p>
      <p>Firm Registration Number <span class="placeholder">{{FIRM_REGISTRATION_NUMBER}}</span></p>
      <p class="spacer"></p>
      <p>(<span class="placeholder">{{PARTNER_OR_PROPRIETOR_NAME}}</span>)</p>
      <p><span class="placeholder">{{PARTNER_OR_PROPRIETOR_DESIGNATION}}</span></p>
      <p>Membership No. <span class="placeholder">{{MEMBERSHIP_NUMBER}}</span></p>
      <p class="spacer"></p>
      <table style="width: 100%;">
        <tr>
          <td style="width: 50%;">Dated: <span class="placeholder">{{REPORT_DATE}}</span></td>
          <td style="width: 50%;"></td>
        </tr>
        <tr>
          <td>UDIN: <span class="placeholder">{{UDIN}}</span></td>
          <td></td>
        </tr>
        <tr>
          <td colspan="2">Place: <span class="placeholder">{{PLACE_OF_SIGNING}}</span></td>
        </tr>
      </table>
    </section>
  </div>
</div>
`;
