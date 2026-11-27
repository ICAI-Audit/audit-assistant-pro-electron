
import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Minus, XCircle, Save, Zap, FileText, Calculator, Landmark, Info, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useEngagement } from "@/contexts/EngagementContext";
import { useAuth } from "@/contexts/AuthContext";
import { getSQLiteClient } from "@/integrations/sqlite/client";
import { toast } from "sonner";
import { getUserFriendlyError } from "@/utils/errorMessages";

// ── Presentation helpers (T-088 UI refresh; no data or logic) ──────────────────────────────────────────────────────────
const CTRL = "h-9";
const TONES = {
  blue: "bg-blue-50 text-blue-700",
  rose: "bg-rose-50 text-[#9f1239]",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
} as const;

function PanelCard({ icon: Icon, tone, title, action, grow = false, children }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  title: string;
  action?: React.ReactNode;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`flex min-w-0 flex-col rounded-[10px] border border-slate-200 bg-white shadow-sm ${grow ? "min-[1100px]:min-h-0 min-[1100px]:flex-1" : "shrink-0"}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${TONES[tone]}`} aria-hidden="true">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        </div>
        {action}
      </header>
      <div className={`p-4 ${grow ? "flex flex-col min-[1100px]:min-h-0 min-[1100px]:flex-1 overflow-y-auto" : ""}`}>{children}</div>
    </section>
  );
}

function Field({ label, tag, children }: { label: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <span className="truncate">{label}</span>
        {tag && <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-semibold text-violet-700">{tag}</span>}
      </Label>
      {children}
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[6rem] flex-1 flex-col items-center justify-center rounded-[10px] border border-dashed border-slate-300 bg-slate-50/60 px-4 py-4 text-center">
      <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#9f1239]" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">{children}</p>
    </div>
  );
}


const db = getSQLiteClient();

const UNIT_MAP = {
  "Ones (\u20B9)": 1,
  "Thousands (\u20B91,000)": 1_000,
  "Lakhs (\u20B91,00,000)": 1_00_000,
  "Crores (\u20B91,00,00,000)": 1_00_00_000,
};

const ENTITY_CLASSIFICATION_MAP = {
  Company: [
    "Private Limited Company",
    "Public Limited Company (Unlisted)",
    "Listed Company",
    "Section 8 Company",
    "One Person Company (OPC)",
  ],
  "Non-Company": [
    "Individual / HUF",
    "Partnership Firm",
    "LLP",
  ],
};

const STATUTE_LINKS: Record<string, string> = {
  "Section 2(85)": "https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf",
  "Section 139(2)": "https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf",
  "Section 135": "https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf",
  "Section 188": "https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf",
  "Section 143(3)(i)": "https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf",
  "Section 129 & Schedule III": "https://www.mca.gov.in/Ministry/pdf/ScheduleIIICompaniesAct.pdf",
  "CARO 2020": "https://www.mca.gov.in/Ministry/pdf/CARO2020_25022020.pdf",
  "Section 44AB": "https://incometaxindia.gov.in/Acts/Income-tax%20Act,%201961.pdf",
};

const yesNoOptions = [
  { label: "No", value: "No" },
  { label: "Yes", value: "Yes" },
];

const ComplianceApplicability: React.FC = () => {
  const { currentEngagement } = useEngagement();
  const { user } = useAuth();
  // State for all input fields
  const [denomination, setDenomination] = useState("Ones (\u20B9)");
  const [cyTurnover, setCyTurnover] = useState("");
  const [cyCapital, setCyCapital] = useState("");
  const [pyTurnover, setPyTurnover] = useState("");
  const [pyNetworth, setPyNetworth] = useState("");
  const [pyBorrowings, setPyBorrowings] = useState("");
  const [pyNetprofit, setPyNetprofit] = useState("");

  const [assesseeType, setAssesseeType] = useState("Business");
  const [cashReceipt, setCashReceipt] = useState("No");
  const [cashPayment, setCashPayment] = useState("No");
  const [presumptive, setPresumptive] = useState("No");
  const [lowerPresumptive, setLowerPresumptive] = useState("No");
  const [rpt, setRpt] = useState("No");

  const [entityClass, setEntityClass] = useState("Company");
  const [constitution, setConstitution] = useState(ENTITY_CLASSIFICATION_MAP["Company"][0]);
  const [subConstitution, setSubConstitution] = useState("Neither");
  const [dormant, setDormant] = useState("No");

  // Results
  const [results, setResults] = useState<Array<[string, string, string]>>([]);
  const [resultReasons, setResultReasons] = useState<Array<[string, string]>>([]);
  const [saving, setSaving] = useState(false);
  const isHydratingRef = useRef(false);

  const buildInputsPayload = () => ({
    denomination,
    cyTurnover,
    cyCapital,
    pyTurnover,
    pyNetworth,
    pyBorrowings,
    pyNetprofit,
    assesseeType,
    cashReceipt,
    cashPayment,
    presumptive,
    lowerPresumptive,
    rpt,
    entityClass,
    constitution,
    subConstitution,
    dormant,
  });

  // Manual save function
  const handleSaveDraft = async () => {
    if (!currentEngagement?.id) {
      toast.error('No engagement selected');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        engagement_id: currentEngagement.id,
        inputs: JSON.stringify(buildInputsPayload()),
        results: JSON.stringify(results),
        reasons: JSON.stringify(resultReasons),
        updated_by: user?.id || null,
        created_by: user?.id || null,
      };

      const { error } = await db
        .from('compliance_applicability')
        .upsert(payload, { onConflict: 'engagement_id' })
        .execute();

      if (error) throw error;
      toast.success('Compliance data saved successfully');
    } catch (error: any) {
      const friendlyMessage = getUserFriendlyError(error);
      toast.error(friendlyMessage);
      console.error('Failed to save compliance applicability:', error);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (!currentEngagement?.id) return;
      isHydratingRef.current = true;
      try {
        const { data, error } = await db
          .from('compliance_applicability')
          .select('*')
          .eq('engagement_id', currentEngagement.id)
          .maybeSingle()
          .execute();

        if (error) throw error;
        if (!data) return;

        // Parse JSON fields
        const inputs = typeof data.inputs === 'string' 
          ? JSON.parse(data.inputs || '{}') 
          : (data.inputs || {}) as Record<string, string>;
        
        const results = typeof data.results === 'string'
          ? JSON.parse(data.results || '[]')
          : (data.results || []) as Array<[string, string, string]>;
        
        const reasons = typeof data.reasons === 'string'
          ? JSON.parse(data.reasons || '[]')
          : (data.reasons || []) as Array<[string, string]>;

        setDenomination(inputs.denomination || "Ones (\u20B9)");
        setCyTurnover(inputs.cyTurnover || "");
        setCyCapital(inputs.cyCapital || "");
        setPyTurnover(inputs.pyTurnover || "");
        setPyNetworth(inputs.pyNetworth || "");
        setPyBorrowings(inputs.pyBorrowings || "");
        setPyNetprofit(inputs.pyNetprofit || "");
        setAssesseeType(inputs.assesseeType || "Business");
        setCashReceipt(inputs.cashReceipt || "No");
        setCashPayment(inputs.cashPayment || "No");
        setPresumptive(inputs.presumptive || "No");
        setLowerPresumptive(inputs.lowerPresumptive || "No");
        setRpt(inputs.rpt || "No");
        setEntityClass(inputs.entityClass || "Company");
        setConstitution(inputs.constitution || ENTITY_CLASSIFICATION_MAP["Company"][0]);
        setSubConstitution(inputs.subConstitution || "Neither");
        setDormant(inputs.dormant || "No");
        setResults(results);
        setResultReasons(reasons);
      } catch (e) {
        console.error('Failed to load compliance applicability:', e);
        toast.error('Failed to load saved data');
      } finally {
        isHydratingRef.current = false;
      }
    };

    loadData();
  }, [currentEngagement?.id]);

  useEffect(() => {
    if (!currentEngagement?.id) return;
    if (isHydratingRef.current) return;

    const timeout = setTimeout(async () => {
      try {
        const payload = {
          engagement_id: currentEngagement.id,
          inputs: JSON.stringify(buildInputsPayload()),
          results: JSON.stringify(results),
          reasons: JSON.stringify(resultReasons),
          updated_by: user?.id || null,
          created_by: user?.id || null,
        };

        const { error } = await db
          .from('compliance_applicability')
          .upsert(payload, { onConflict: 'engagement_id' })
          .execute();

        if (error) throw error;
      } catch (e) {
        console.error('Failed to auto-save compliance applicability:', e);
      }
    }, 800);

    return () => clearTimeout(timeout);
  }, [
    currentEngagement?.id,
    denomination,
    cyTurnover,
    cyCapital,
    pyTurnover,
    pyNetworth,
    pyBorrowings,
    pyNetprofit,
    assesseeType,
    cashReceipt,
    cashPayment,
    presumptive,
    lowerPresumptive,
    rpt,
    entityClass,
    constitution,
    subConstitution,
    dormant,
    results,
    resultReasons,
    user?.id,
  ]);

  // Update constitution options when entityClass changes
  React.useEffect(() => {
    const options = ENTITY_CLASSIFICATION_MAP[entityClass] || [];
    if (!options.includes(constitution)) {
      setConstitution(options[0] || '');
    }
  }, [constitution, entityClass]);

  function sanitizeNumeric(value: string) {
    const cleaned = value.replace(/,/g, "");
    const parts = cleaned.split(".");
    const intPart = parts[0].replace(/\D/g, "");
    const fracPart = parts.length > 1 ? parts.slice(1).join("").replace(/\D/g, "") : "";
    return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  }

  function formatIndianNumber(value: string) {
    const cleaned = sanitizeNumeric(value);
    if (!cleaned) return "";
    const [intPart, fracPart] = cleaned.split(".");
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    const formatted = rest ? `${grouped},${last3}` : last3;
    return fracPart ? `${formatted}.${fracPart}` : formatted;
  }

  function parseNumber(value: string) {
    const cleaned = sanitizeNumeric(value);
    return parseFloat(cleaned || "0");
  }

  // Logic functions
  function determineTaxAudit(turnover: number) {
    if (assesseeType === "Profession") {
      return turnover > 5_000_000 ? "Yes" : "No";
    }
    if (turnover > 100_000_000) return "Yes";
    if (
      turnover > 10_000_000 &&
      (cashReceipt === "Yes" || cashPayment === "Yes")
    ) {
      return "Yes";
    }
    if (presumptive === "Yes" && lowerPresumptive === "Yes") {
      return "Yes";
    }
    return "No";
  }

  function evaluateCompliance() {
    try {
      const m = UNIT_MAP[denomination];
      const cy_turnover = parseNumber(cyTurnover) * m;
      const cy_capital = parseNumber(cyCapital) * m;
      const py_turnover = parseNumber(pyTurnover) * m;
      const py_networth = parseNumber(pyNetworth) * m;
      const py_borrowings = parseNumber(pyBorrowings) * m;
      const py_netprofit = parseNumber(pyNetprofit) * m;

      const is_company = entityClass === "Company";
      const is_listed = constitution === "Listed Company";
      const is_opc = constitution === "One Person Company (OPC)";
      const is_section8 = constitution === "Section 8 Company";
      const is_dormant = dormant === "Yes";
      const is_holding = subConstitution === "Holding Company";
      const is_subsidiary = subConstitution === "Subsidiary Company";

      const small_company =
        is_company &&
        constitution !== "Public Limited Company (Unlisted)" &&
        !is_listed &&
        !is_opc &&
        !is_section8 &&
        !is_holding &&
        !is_subsidiary &&
        cy_capital <= 100_000_000 &&
        py_turnover <= 1_000_000_000;

      let caro = "";
      if (!is_company) caro = "Not Applicable";
      else if (is_listed) caro = "Yes";
      else if (small_company || is_opc || is_section8) caro = "No";
      else caro = "Yes";

      let auditor_rotation = "";
      if (!is_company) auditor_rotation = "Not Applicable";
      else if (is_listed) auditor_rotation = "Yes";
      else if (
        (constitution === "Public Limited Company (Unlisted)" && cy_capital >= 100_000_000) ||
        (constitution === "Private Limited Company" && cy_capital >= 500_000_000) ||
        py_borrowings >= 500_000_000
      ) {
        auditor_rotation = "Yes";
      } else auditor_rotation = "No";

      let csr = "";
      if (!is_company) csr = "Not Applicable";
      else if (
        py_networth >= 5_000_000_000 ||
        py_turnover >= 10_000_000_000 ||
        py_netprofit >= 50_000_000
      ) {
        csr = "Yes";
      } else csr = "No";

      let ifc = "";
      if (!is_company) ifc = "Not Applicable";
      else if (is_listed) ifc = "Yes";
      else if (constitution === "Public Limited Company (Unlisted)") ifc = "Yes";
      else if (
        constitution === "Private Limited Company" &&
        (py_turnover >= 500_000_000 || py_borrowings >= 250_000_000)
      ) {
        ifc = "Yes";
      } else ifc = "No";

      let cashflow = "";
      if (!is_company) cashflow = "Not Applicable";
      else if (small_company || is_opc || is_dormant) cashflow = "No";
      else cashflow = "Yes";

      const tax_audit = determineTaxAudit(cy_turnover);

      let aoc2 = "";
      if (!is_company) aoc2 = "Not Applicable";
      else aoc2 = rpt === "Yes" ? "Yes" : "No";

      const resultsArr: Array<[string, string, string]> = [
        [
          "Small Company",
          !is_company ? "Not Applicable" : small_company ? "Yes" : "No",
          "Section 2(85)",
        ],
        ["CARO Applicability", caro, "CARO 2020"],
        ["Auditor Rotation", auditor_rotation, "Section 139(2)"],
        ["CSR Applicability", csr, "Section 135"],
        ["Tax Audit Applicability", tax_audit, "Section 44AB"],
        ["Cash Flow Statement", cashflow, "Section 129 & Schedule III"],
        ["IFC Reporting", ifc, "Section 143(3)(i)"],
        ["AOC-2 (RPT)", aoc2, "Section 188"],
      ];
      const reasonsArr: Array<[string, string]> = [
        [
          "Small Company",
          !is_company
            ? "Not applicable because the entity is not a company."
            : small_company
              ? "Yes because paid-up capital <= 10 Cr and turnover <= 100 Cr, and the entity is not listed, OPC, Section 8, holding, or subsidiary."
              : "No because one or more thresholds or exclusions apply (listed/OPC/Section 8/holding/subsidiary or capital/turnover exceed limits).",
        ],
        [
          "CARO Applicability",
          !is_company
            ? "Not applicable because CARO applies only to companies."
            : is_listed
              ? "Yes because listed companies are covered under CARO."
              : small_company || is_opc || is_section8
                ? "No because small companies, OPCs, and Section 8 companies are exempt."
                : "Yes because the company is not exempt under CARO thresholds or category.",
        ],
        [
          "Auditor Rotation",
          !is_company
            ? "Not applicable because the entity is not a company."
            : auditor_rotation === "Yes"
              ? "Yes because paid-up capital or borrowings meet the rotation thresholds for the company type."
              : "No because the rotation thresholds are not met.",
        ],
        [
          "CSR Applicability",
          !is_company
            ? "Not applicable because the entity is not a company."
            : csr === "Yes"
              ? "Yes because net worth >= 500 Cr, turnover >= 1,000 Cr, or net profit >= 5 Cr."
              : "No because CSR thresholds are not met.",
        ],
        [
          "Tax Audit Applicability",
          tax_audit === "Yes"
            ? "Yes because turnover limits or cash receipt/payment or presumptive conditions trigger tax audit."
            : "No because tax audit thresholds and conditions are not met.",
        ],
        [
          "Cash Flow Statement",
          !is_company
            ? "Not applicable because the entity is not a company."
            : cashflow === "No"
              ? "No because the entity is a small company/OPC/dormant company."
              : "Yes because the entity is not exempt from cash flow requirements.",
        ],
        [
          "IFC Reporting",
          !is_company
            ? "Not applicable because the entity is not a company."
            : ifc === "Yes"
              ? "Yes because the company is listed, a public company, or a private company meeting turnover/borrowing thresholds."
              : "No because IFC thresholds are not met.",
        ],
        [
          "AOC-2 (RPT)",
          !is_company
            ? "Not applicable because the entity is not a company."
            : aoc2 === "Yes"
              ? "Yes because related party transactions are indicated."
              : "No because no related party transactions are indicated.",
        ],
      ];
      setResults(resultsArr);
      setResultReasons(reasonsArr);
    } catch (e) {
      setResults([]);
      setResultReasons([]);
    }
  }

  // UI (T-088 presentation refresh, owner request 27 Nov 2026: fits one screen; panels scroll inside, the page does not)
  const yesNoSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={CTRL}><SelectValue /></SelectTrigger>
      <SelectContent>
        {yesNoOptions.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const amountInput = (value: string, set: (v: string) => void) => (
    <Input
      value={value}
      onChange={e => set(formatIndianNumber(e.target.value))}
      onBlur={e => set(formatIndianNumber(e.target.value))}
      inputMode="decimal"
      placeholder="0"
      className={`${CTRL} text-right tabular-nums`}
    />
  );

  return (
    <div className="flex flex-col gap-4 min-[1100px]:h-full min-[1100px]:min-h-0">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-tight text-slate-900">
            Compliance Applicability Engine
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Statutory applicability checks and audit planning signals in one view.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-9" onClick={handleSaveDraft} disabled={saving}>
            {saving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Draft
              </>
            )}
          </Button>
          <Button className="h-9 px-5 bg-[#9f1239] text-white hover:bg-[#881337]" onClick={evaluateCompliance}>
            <Zap className="h-4 w-4 mr-2" />
            Evaluate Compliance
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4 min-[1100px]:min-h-0">
          <PanelCard icon={FileText} tone="blue" title="Entity Classification">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
              <Field label="Amount Denomination">
                <Select value={denomination} onValueChange={setDenomination}>
                  <SelectTrigger className={CTRL}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(UNIT_MAP).map(unit => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Entity Type">
                <Select value={entityClass} onValueChange={setEntityClass}>
                  <SelectTrigger className={CTRL}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Company">Company</SelectItem>
                    <SelectItem value="Non-Company">Non-Company</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Constitution">
                <Select value={constitution} onValueChange={setConstitution}>
                  <SelectTrigger className={CTRL}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENTITY_CLASSIFICATION_MAP[entityClass].map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sub-Constitution">
                <Select value={subConstitution} onValueChange={setSubConstitution}>
                  <SelectTrigger className={CTRL}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Neither">Neither</SelectItem>
                    <SelectItem value="Holding Company">Holding Company</SelectItem>
                    <SelectItem value="Subsidiary Company">Subsidiary Company</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Dormant Company">{yesNoSelect(dormant, setDormant)}</Field>
            </div>
          </PanelCard>

          <div className="grid shrink-0 grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
            <PanelCard icon={Calculator} tone="rose" title="Financial Parameters">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Field label="Current Year Turnover">{amountInput(cyTurnover, setCyTurnover)}</Field>
                <Field label="Previous Year Turnover">{amountInput(pyTurnover, setPyTurnover)}</Field>
                <Field label="Paid-up Capital">{amountInput(cyCapital, setCyCapital)}</Field>
                <Field label="Previous Year Net Worth">{amountInput(pyNetworth, setPyNetworth)}</Field>
                <Field label="Previous Year Borrowings">{amountInput(pyBorrowings, setPyBorrowings)}</Field>
                <Field label="Previous Year Net Profit">{amountInput(pyNetprofit, setPyNetprofit)}</Field>
              </div>
            </PanelCard>

            <PanelCard icon={Landmark} tone="emerald" title="Income-tax & Company Law">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Field label="Assessee Type">
                  <Select value={assesseeType} onValueChange={setAssesseeType}>
                    <SelectTrigger className={CTRL}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Business">Business</SelectItem>
                      <SelectItem value="Profession">Profession</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Presumptive Scheme">{yesNoSelect(presumptive, setPresumptive)}</Field>
                <Field label="Cash Receipts > 5%">{yesNoSelect(cashReceipt, setCashReceipt)}</Field>
                <Field label="Cash Payments > 5%">{yesNoSelect(cashPayment, setCashPayment)}</Field>
                <Field label="Lower than Presumptive">{yesNoSelect(lowerPresumptive, setLowerPresumptive)}</Field>
                <Field label="Significant RPT Exists" tag="Co. Law">{yesNoSelect(rpt, setRpt)}</Field>
              </div>
            </PanelCard>
          </div>

          <PanelCard icon={Info} tone="amber" title="Evaluation Basis" grow>
            {resultReasons.length === 0 ? (
              <EmptyPanel icon={FileText} title="Reasons appear here">
                Run evaluation to see the exact reason for each decision.
              </EmptyPanel>
            ) : (
              <ul className="space-y-2 text-sm text-slate-600">
                {resultReasons.map(([label, reason]) => (
                  <li key={label}>
                    <span className="font-semibold text-slate-700">{label}:</span> {reason}
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>
        </div>

        <PanelCard
          icon={ShieldCheck}
          tone="rose"
          title="Evaluation Output"
          grow
          action={
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700">
              {results.length} checks
            </span>
          }
        >
          <div className="flex flex-1 flex-col gap-3">
            {results.length === 0 && (
              <EmptyPanel icon={ShieldCheck} title="No evaluation yet">
                No evaluation yet. Click "Evaluate Compliance" to view outcomes.
              </EmptyPanel>
            )}

            {results.map(([area, applicable, statute]) => {
              const isYes = applicable === "Yes";
              const isNo = applicable === "No";
              const badgeClass = isYes
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : isNo
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-slate-50 text-slate-600 border-slate-200";

              return (
                <div key={area} className="rounded-[10px] border border-slate-200 bg-white px-3.5 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{area}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {STATUTE_LINKS[statute] ? (
                          <a
                            href={STATUTE_LINKS[statute]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-600 underline decoration-dotted underline-offset-4 hover:text-slate-900"
                          >
                            {statute}
                          </a>
                        ) : (
                          statute
                        )}
                      </p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
                      {isYes ? <CheckCircle2 className="h-4 w-4" /> : isNo ? <XCircle className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      {isYes ? "Yes" : isNo ? "No" : "N/A"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </PanelCard>
      </div>
    </div>
  );
};

export default ComplianceApplicability;


