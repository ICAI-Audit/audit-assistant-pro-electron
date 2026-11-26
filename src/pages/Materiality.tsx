import { useState, useEffect, useRef } from 'react';
import { sampleMateriality } from '@/data/sampleData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calculator, AlertCircle, Trash2, Plus, FileDown, AlertTriangle, Save, RotateCcw, ShieldCheck, Check, PenLine } from 'lucide-react';
import { format } from 'date-fns';
import ExcelJS from 'exceljs';
import { useEngagement } from '@/contexts/EngagementContext';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { RiskRegisterContent } from '@/pages/RiskRegister';
import { useAuth } from '@/contexts/AuthContext';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { toast } from 'sonner';
import { getUserFriendlyError } from '@/utils/errorMessages';

const db = getSQLiteClient();

// ICAI-CAQD SUGGESTED MATERIALITY GUIDANCE (ADVISORY)
const CAQD_GUIDE: Record<string, Record<string, string>> = {
  "Revenue / Gross Receipts": {
    "Low Risk": "0.80% \u2013 1.00%",
    "Medium Risk": "0.70% \u2013 0.80%",
    "High Risk": "0.50% \u2013 0.70%"
  },
  "Profit Before Tax": {
    "Low Risk": "8% \u2013 10%",
    "Medium Risk": "7% \u2013 8%",
    "High Risk": "5% \u2013 7%"
  },
  "Total Assets": {
    "Low Risk": "1.6% \u2013 2.0%",
    "Medium Risk": "1.3% \u2013 1.6%",
    "High Risk": "1.0% \u2013 1.3%"
  },
  "Net Worth": {
    "Low Risk": "3.85% \u2013 5.0%",
    "Medium Risk": "3.15% \u2013 3.85%",
    "High Risk": "2.0% \u2013 3.15%"
  }
};

// RISK FACTORS
const DEFAULT_RISK_FACTORS = [
  "New Engagement",
  "Startup Entity",
  "Client acceptance / continuance concerns",
  "Integrity of management",
  "Operating effectiveness of controls",
  "Effectiveness of Internal Audit",
  "Ongoing investigations",
  "Negative publicity",
  "Complexity in operations / structure",
  "Economic / regulatory changes",
  "Going concern & liquidity issues",
  "Threat of bankruptcy",
  "New IT systems affecting financial reporting",
  "History of fraud or error",
  "Risk of management override",
  "Capital / credit constraints",
  "Complex financing arrangements",
  "Corporate restructuring",
  "Significant change from prior period",
  "Related party transactions",
  "Change / exit of key personnel",
  "IFCoFR / internal control weakness",
  "Inefficient accounting systems",
  "Prior audit qualification",
  "Change in accounting policies",
  "Rapid growth / unusual profitability",
  "Any other auditor-considered significant risk"
];

interface RiskItem {
  level: string;
  score: number;
}

const sanitizeNumericInput = (value: string, options?: { allowTrailingDot?: boolean }) => {
  const cleaned = value.replace(/,/g, '');
  const hasTrailingDot = options?.allowTrailingDot && cleaned.endsWith('.');
  const parts = cleaned.split('.');
  const intPart = parts[0].replace(/\D/g, '');
  const fracPart = parts.length > 1 ? parts.slice(1).join('').replace(/\D/g, '') : '';
  if (fracPart) return `${intPart}.${fracPart}`;
  if (hasTrailingDot) return `${intPart}.`;
  return intPart;
};

const formatIndianNumber = (value: string) => {
  const cleaned = sanitizeNumericInput(value);
  if (!cleaned) return '';
  const [intPart, fracPart] = cleaned.split('.');
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const formatted = rest ? `${grouped},${last3}` : last3;
  return fracPart ? `${formatted}.${fracPart}` : formatted;
};

const parseNumber = (value: string) => {
  const cleaned = sanitizeNumericInput(value);
  const parsed = Number(cleaned || 0);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sanitizeNumericLoose = (value: string) => sanitizeNumericInput(value, { allowTrailingDot: true });
const sanitizeNumericStrict = (value: string) => sanitizeNumericInput(value);

export default function Materiality() {
  // Engagement Context
  const { currentEngagement } = useEngagement();
  const { user } = useAuth();
  const { members } = useTeamMembers();
  
  // View State
  const [currentView, setCurrentView] = useState<'risk' | 'materiality' | 'register'>('risk');
  
  // Header Fields
  const [entityName, setEntityName] = useState('');
  const [financialYear, setFinancialYear] = useState('');
  const [materialityStage, setMaterialityStage] = useState('Planning');
  const [engagementType, setEngagementType] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [reviewedBy, setReviewedBy] = useState('');
  const [date, setDate] = useState(format(new Date(), 'dd-MM-yyyy'));

  // Auto-populate from engagement
  useEffect(() => {
    if (currentEngagement) {
      setEntityName(currentEngagement.client_name || '');
      setFinancialYear(currentEngagement.financial_year || '');
      setEngagementType(currentEngagement.engagement_type || '');
    }
  }, [currentEngagement]);

  // Financial Base
  const [profitBeforeTax, setProfitBeforeTax] = useState('');
  const [revenue, setRevenue] = useState('');
  const [totalAssets, setTotalAssets] = useState('');
  const [netWorth, setNetWorth] = useState('');
  const [othersName, setOthersName] = useState('');
  const [othersAmount, setOthersAmount] = useState('');

  // Materiality
  const [benchmark, setBenchmark] = useState('Profit Before Tax');
  const [percentage, setPercentage] = useState('8');
  const [omAmount, setOmAmount] = useState(0);
  const [pmPercentage, setPmPercentage] = useState('75');
  const [pmAmount, setPmAmount] = useState(0);
  const [ctPercentage, setCtPercentage] = useState('5');
  const [ctAmount, setCtAmount] = useState(0);
  const [rationale, setRationale] = useState(sampleMateriality.rationale);

  // Risk Assessment
  const [riskFactors, setRiskFactors] = useState<string[]>(DEFAULT_RISK_FACTORS);
  const [riskItems, setRiskItems] = useState<Record<number, RiskItem>>({});
  const [newQuestion, setNewQuestion] = useState('');
  const [totalRiskScore, setTotalRiskScore] = useState(0);
  const [riskPercentage, setRiskPercentage] = useState(0);
  const [systemRisk, setSystemRisk] = useState('');
  const [finalRisk, setFinalRisk] = useState('');
  const [isRiskFinalized, setIsRiskFinalized] = useState(false);
  const [remarks, setRemarks] = useState('');

  // CAQD Guidance
  const [caqdSuggestion, setCaqdSuggestion] = useState('\u2014');
  const isHydratingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const UNIT_MAP: Record<string, number> = {
    "Ones (\u20B9)": 1,
    "Thousands (\u20B91,000)": 1_000,
    "Lakhs (\u20B91,00,000)": 1_00_000,
    "Crores (\u20B91,00,00,000)": 1_00_00_000,
  };

  const buildRiskStatePayload = () => ({
    riskFactors,
    riskItems,
    newQuestion,
    totalRiskScore,
    riskPercentage,
    systemRisk,
    finalRisk,
    isRiskFinalized,
    remarks,
  });

  const buildMaterialityStatePayload = () => ({
    entityName,
    financialYear,
    materialityStage,
    engagementType,
    preparedBy,
    reviewedBy,
    date,
    profitBeforeTax: parseNumber(profitBeforeTax),
    revenue: parseNumber(revenue),
    totalAssets: parseNumber(totalAssets),
    netWorth: parseNumber(netWorth),
    othersName,
    othersAmount: parseNumber(othersAmount),
    benchmark,
    percentage: parseNumber(percentage),
    omAmount,
    pmPercentage: parseNumber(pmPercentage),
    pmAmount,
    ctPercentage: parseNumber(ctPercentage),
    ctAmount,
    rationale,
    caqdSuggestion,
  });

  // Load compliance applicability data to auto-populate financial fields
  useEffect(() => {
    const loadComplianceData = async () => {
      if (!currentEngagement?.id) return;
      
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

        // Extract financial data
        const denomination = inputs.denomination || "Ones (\u20B9)";
        const multiplier = UNIT_MAP[denomination] || 1;

        // Convert values to base currency (Ones) if they exist and current fields are empty
        if (inputs.pyNetprofit && !profitBeforeTax) {
          const value = parseFloat(inputs.pyNetprofit) * multiplier;
          setProfitBeforeTax(formatIndianNumber(String(value)));
        }
        if (inputs.pyTurnover && !revenue) {
          const value = parseFloat(inputs.pyTurnover) * multiplier;
          setRevenue(formatIndianNumber(String(value)));
        }
        if (inputs.pyNetworth && !netWorth) {
          const value = parseFloat(inputs.pyNetworth) * multiplier;
          setNetWorth(formatIndianNumber(String(value)));
        }
        // Note: Compliance doesn't have totalAssets, so we don't auto-populate it
      } catch (e) {
        console.error('Failed to load compliance applicability data:', e);
      }
    };

    loadComplianceData();
  }, [currentEngagement?.id]);

  useEffect(() => {
    const loadData = async () => {
      if (!currentEngagement?.id) return;
      isHydratingRef.current = true;
      try {
        const { data, error } = await db
          .from('materiality_risk_assessment')
          .select('*')
          .eq('engagement_id', currentEngagement.id)
          .single();

        if (error) throw error;
        if (!data) return;

        // Parse JSON strings from SQLite (stored as TEXT)
        const riskState = typeof data.risk_state === 'string' 
          ? JSON.parse(data.risk_state) 
          : (data.risk_state || {}) as Record<string, any>;
        const materialityState = typeof data.materiality_state === 'string'
          ? JSON.parse(data.materiality_state)
          : (data.materiality_state || {}) as Record<string, any>;

        if (Array.isArray(riskState.riskFactors)) setRiskFactors(riskState.riskFactors);
        if (riskState.riskItems) setRiskItems(riskState.riskItems);
        if (typeof riskState.newQuestion === 'string') setNewQuestion(riskState.newQuestion);
        if (typeof riskState.totalRiskScore === 'number') setTotalRiskScore(riskState.totalRiskScore);
        if (typeof riskState.riskPercentage === 'number') setRiskPercentage(riskState.riskPercentage);
        if (typeof riskState.systemRisk === 'string') setSystemRisk(riskState.systemRisk);
        if (typeof riskState.finalRisk === 'string') setFinalRisk(riskState.finalRisk);
        if (typeof riskState.isRiskFinalized === 'boolean') setIsRiskFinalized(riskState.isRiskFinalized);
        if (typeof riskState.remarks === 'string') setRemarks(riskState.remarks);

        if (typeof materialityState.entityName === 'string') setEntityName(materialityState.entityName);
        if (typeof materialityState.financialYear === 'string') setFinancialYear(materialityState.financialYear);
        if (typeof materialityState.materialityStage === 'string') setMaterialityStage(materialityState.materialityStage);
        if (typeof materialityState.engagementType === 'string') setEngagementType(materialityState.engagementType);
        if (typeof materialityState.preparedBy === 'string') setPreparedBy(materialityState.preparedBy);
        if (typeof materialityState.reviewedBy === 'string') setReviewedBy(materialityState.reviewedBy);
        if (typeof materialityState.date === 'string') setDate(materialityState.date);
        if (typeof materialityState.profitBeforeTax === 'number') setProfitBeforeTax(formatIndianNumber(String(materialityState.profitBeforeTax)));
        if (typeof materialityState.revenue === 'number') setRevenue(formatIndianNumber(String(materialityState.revenue)));
        if (typeof materialityState.totalAssets === 'number') setTotalAssets(formatIndianNumber(String(materialityState.totalAssets)));
        if (typeof materialityState.netWorth === 'number') setNetWorth(formatIndianNumber(String(materialityState.netWorth)));
        if (typeof materialityState.othersName === 'string') setOthersName(materialityState.othersName);
        if (typeof materialityState.othersAmount === 'number') setOthersAmount(formatIndianNumber(String(materialityState.othersAmount)));
        if (typeof materialityState.benchmark === 'string') setBenchmark(materialityState.benchmark);
        if (typeof materialityState.percentage === 'number') setPercentage(String(materialityState.percentage));
        if (typeof materialityState.omAmount === 'number') setOmAmount(materialityState.omAmount);
        if (typeof materialityState.pmPercentage === 'number') setPmPercentage(String(materialityState.pmPercentage));
        if (typeof materialityState.pmAmount === 'number') setPmAmount(materialityState.pmAmount);
        if (typeof materialityState.ctPercentage === 'number') setCtPercentage(String(materialityState.ctPercentage));
        if (typeof materialityState.ctAmount === 'number') setCtAmount(materialityState.ctAmount);
        if (typeof materialityState.rationale === 'string') setRationale(materialityState.rationale);
        if (typeof materialityState.caqdSuggestion === 'string') setCaqdSuggestion(materialityState.caqdSuggestion);
      } catch (e) {
        console.error('Failed to load materiality risk assessment:', e);
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
          risk_state: JSON.stringify(buildRiskStatePayload()),
          materiality_state: JSON.stringify(buildMaterialityStatePayload()),
          updated_by: user?.id || null,
          created_by: user?.id || null,
        };

        // Check if record exists (upsert logic for SQLite)
        const { data: existing } = await db
          .from('materiality_risk_assessment')
          .select('id')
          .eq('engagement_id', currentEngagement.id)
          .single();

        if (existing) {
          // Update existing record
          const { error } = await db
            .from('materiality_risk_assessment')
            .update(payload)
            .eq('engagement_id', currentEngagement.id)
            .execute();
          
          if (error) throw error;
        } else {
          // Insert new record
          const { error } = await db
            .from('materiality_risk_assessment')
            .insert(payload)
            .execute();
          
          if (error) throw error;
        }
      } catch (e) {
        console.error('Failed to save materiality risk assessment:', e);
      }
    }, 800);

    return () => clearTimeout(timeout);
  }, [
    currentEngagement?.id,
    riskFactors,
    riskItems,
    newQuestion,
    totalRiskScore,
    riskPercentage,
    systemRisk,
    finalRisk,
    isRiskFinalized,
    remarks,
    entityName,
    financialYear,
    materialityStage,
    engagementType,
    preparedBy,
    reviewedBy,
    date,
    profitBeforeTax,
    revenue,
    totalAssets,
    netWorth,
    othersName,
    othersAmount,
    benchmark,
    percentage,
    omAmount,
    pmPercentage,
    pmAmount,
    ctPercentage,
    ctAmount,
    rationale,
    caqdSuggestion,
    user?.id,
  ]);

  // Calculate risk totals
  useEffect(() => {
    let total = 0;
    let count = 0;

    Object.values(riskItems).forEach((item) => {
      if (item.level !== 'NA') {
        total += item.score;
        count += 1;
      }
    });

    setTotalRiskScore(total);

    if (count === 0) {
      setRiskPercentage(0);
      setSystemRisk('');
      if (!isRiskFinalized) {
        setFinalRisk('');
      }
      return;
    }

    const pct = Math.round((total / (count * 10)) * 1000) / 10;
    setRiskPercentage(pct);

    const calculatedRisk = pct <= 40 ? 'Low Risk' : pct <= 70 ? 'Medium Risk' : 'High Risk';
    setSystemRisk(calculatedRisk);
    
    if (!isRiskFinalized) {
      setFinalRisk(calculatedRisk);
    }
  }, [riskItems, isRiskFinalized]);

  // Update CAQD guidance
  useEffect(() => {
    const risk = finalRisk || systemRisk;
    if (benchmark in CAQD_GUIDE && risk in CAQD_GUIDE[benchmark]) {
      setCaqdSuggestion(`Suggested range (ICAI-CAQD): ${CAQD_GUIDE[benchmark][risk]}`);
    } else {
      setCaqdSuggestion('Suggested range: Benchmark not defined');
    }
  }, [benchmark, finalRisk, systemRisk]);

  const getBenchmarkAmount = () => {
    switch (benchmark) {
      case 'Profit Before Tax':
        return parseNumber(profitBeforeTax);
      case 'Revenue / Gross Receipts':
        return parseNumber(revenue);
      case 'Total Assets':
        return parseNumber(totalAssets);
      case 'Net Worth':
        return parseNumber(netWorth);
      case 'Others':
        return parseNumber(othersAmount);
      default:
        return 0;
    }
  };

  const calculateOM = () => {
    if (!currentEngagement) {
      alert('Please select an engagement first to proceed with materiality calculations.');
      return;
    }
    
    const base = getBenchmarkAmount();
    const percentageValue = parseNumber(percentage);
    const om = base * (percentageValue / 100);
    setOmAmount(Number(om.toFixed(2)));

    // Check if percentage is within suggested range
    const risk = finalRisk || systemRisk;
    if (benchmark in CAQD_GUIDE && risk in CAQD_GUIDE[benchmark]) {
      const rangeStr = CAQD_GUIDE[benchmark][risk];
      const [min, max] = parseRange(rangeStr);
      if (percentageValue < min || percentageValue > max) {
        alert(`Warning: The selected materiality percentage (${percentageValue}%) is outside the suggested ICAI-CAQD range (${rangeStr}). Please review.`);
      }
    }
  };

  const calculatePM = () => {
    const pm = omAmount * (parseNumber(pmPercentage) / 100);
    setPmAmount(Number(pm.toFixed(2)));
  };

  const calculateCT = () => {
    const ct = omAmount * (parseNumber(ctPercentage) / 100);
    setCtAmount(Number(ct.toFixed(2)));
  };

  const parseRange = (rangeStr: string): [number, number] => {
    const parts = rangeStr.replace('%', '').split('\u2013').map(s => s.trim());
    return [parseFloat(parts[0]), parseFloat(parts[1])];
  };

  const handleRiskLevelChange = (index: number, level: string) => {
    let score = 0;
    if (level === 'High_Risk') score = 8;
    else if (level === 'Medium_Risk') score = 4;
    else if (level === 'Low_Risk') score = 1;
    
    setRiskItems(prev => ({
      ...prev,
      [index]: { level, score }
    }));
  };

  const handleRiskScoreChange = (index: number, score: number) => {
    setRiskItems(prev => ({
      ...prev,
      [index]: { ...prev[index], score }
    }));
  };

  const addQuestion = () => {
    if (!newQuestion.trim()) {
      alert('Please enter a question.');
      return;
    }
    setRiskFactors([...riskFactors, newQuestion.trim()]);
    setNewQuestion('');
  };

  const deleteQuestion = (index: number) => {
    const newFactors = riskFactors.filter((_, i) => i !== index);
    const newItems = { ...riskItems };
    delete newItems[index];
    
    // Reindex items
    const reindexedItems: Record<number, RiskItem> = {};
    Object.keys(newItems).forEach((key) => {
      const oldIndex = parseInt(key);
      const newIndex = oldIndex > index ? oldIndex - 1 : oldIndex;
      reindexedItems[newIndex] = newItems[oldIndex];
    });
    
    setRiskFactors(newFactors);
    setRiskItems(reindexedItems);
  };

  const resetAllQuestions = () => {
    setRiskFactors(DEFAULT_RISK_FACTORS);
    setRiskItems({});
    setIsRiskFinalized(false);
  };

  const recalculateRisk = () => {
    // Recalculate the system risk based on current questionnaire responses
    // This allows users to update their assessment without losing data
    setIsRiskFinalized(false);
    
    // The useEffect hooks will automatically recalculate totalRiskScore, riskPercentage, and systemRisk
    // Then update the finalRisk to match the new systemRisk
    setTimeout(() => {
      setFinalRisk(systemRisk);
    }, 50);
  };

  const handleSaveDraft = async () => {
    if (!currentEngagement?.id) {
      toast.error('No engagement selected');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        engagement_id: currentEngagement.id,
        risk_state: JSON.stringify(buildRiskStatePayload()),
        materiality_state: JSON.stringify(buildMaterialityStatePayload()),
        updated_by: user?.id || null,
        created_by: user?.id || null,
      };

      // Check if record exists (upsert logic for SQLite)
      const { data: existing } = await db
        .from('materiality_risk_assessment')
        .select('id')
        .eq('engagement_id', currentEngagement.id)
        .single();

      if (existing) {
        // Update existing record
        const { error } = await db
          .from('materiality_risk_assessment')
          .update(payload)
          .eq('engagement_id', currentEngagement.id)
          .execute();
        
        if (error) throw error;
      } else {
        // Insert new record
        const { error } = await db
          .from('materiality_risk_assessment')
          .insert(payload)
          .execute();
        
        if (error) throw error;
      }

      toast.success('Materiality & Risk data saved successfully');
    } catch (error: any) {
      const friendlyMessage = getUserFriendlyError(error);
      toast.error(friendlyMessage);
      console.error('Failed to save materiality risk assessment:', error);
    } finally {
      setSaving(false);
    }
  };

  const finalizeRisk = () => {
    if (!finalRisk) {
      alert('Please select a risk level (Low Risk, Medium Risk, or High Risk) before finalizing.');
      return;
    }
    setIsRiskFinalized(true);
  };

  const switchToMateriality = () => {
    if (!isRiskFinalized || !finalRisk) {
      const result = window.confirm('Risk assessment is not finalized. Do you want to skip and proceed to materiality?');
      if (!result) {
        return;
      }
    }
    setCurrentView('materiality');
  };

  const switchToRisk = () => {
    setCurrentView('risk');
  };

  const switchToRegister = () => {
    setCurrentView('register');
  };

  const exportToExcel = async () => {
    if (!isRiskFinalized || !finalRisk) {
      const result = window.confirm('Risk assessment is not finalized. Do you want to skip and proceed with export?');
      if (!result) {
        return;
      }
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Materiality & Risk');
    
    // Define heading style
    const headingStyle = {
      font: { bold: true, color: { argb: 'FF0000FF' } } // Blue color
    };
    
    // Header
    worksheet.addRow(['DETERMINING MATERIALITY']).getCell(1).font = headingStyle.font;
    worksheet.addRow(['Name of Entity', entityName]);
    worksheet.addRow(['Financial Year', financialYear]);
    worksheet.addRow(['Materiality Stage', materialityStage]);
    worksheet.addRow(['Type of Engagement', engagementType]);
    worksheet.addRow(['Prepared By', preparedBy]);
    worksheet.addRow(['Reviewed By', reviewedBy]);
    worksheet.addRow(['Date', date]);
    worksheet.addRow([]);
    
    // Financial Base
    worksheet.addRow(['FINANCIAL BASE']).getCell(1).font = headingStyle.font;
    worksheet.addRow(['Profit Before Tax', parseNumber(profitBeforeTax)]);
    worksheet.addRow(['Revenue / Gross Receipts', parseNumber(revenue)]);
    worksheet.addRow(['Total Assets', parseNumber(totalAssets)]);
    worksheet.addRow(['Net Worth', parseNumber(netWorth)]);
    worksheet.addRow([othersName || 'Others', parseNumber(othersAmount)]);
    worksheet.addRow([]);
    
    // Materiality
    worksheet.addRow(['MATERIALITY']).getCell(1).font = headingStyle.font;
    worksheet.addRow(['Benchmark Selected', benchmark]);
    worksheet.addRow(['Overall Materiality', omAmount]);
    worksheet.addRow(['Performance Materiality', pmAmount]);
    worksheet.addRow(['Clearly Trivial Threshold', ctAmount]);
    worksheet.addRow([]);
    
    // Risk Assessment
    worksheet.addRow(['RISK ASSESSMENT QUESTIONNAIRE']).getCell(1).font = headingStyle.font;
    worksheet.addRow(['Question', 'Risk Level', 'Score', 'Included']);
    riskFactors.forEach((factor, index) => {
      const item = riskItems[index];
      worksheet.addRow([
        factor,
        item?.level || 'NA',
        item?.score || 0,
        item?.level !== 'NA' ? 'Yes' : 'No'
      ]);
    });
    worksheet.addRow([]);
    
    // Risk Summary
    worksheet.addRow(['RISK SUMMARY']).getCell(1).font = headingStyle.font;
    worksheet.addRow(['Total Risk Score', totalRiskScore]);
    worksheet.addRow(['Risk %', `${riskPercentage}%`]);
    worksheet.addRow(['System Risk', systemRisk]);
    worksheet.addRow(['Auditor Override', finalRisk]);
    worksheet.addRow([]);
    
    // Remarks
    worksheet.addRow(['REMARKS/RATIONALE']).getCell(1).font = headingStyle.font;
    worksheet.addRow([remarks]);
    
    // Auto-resize columns
    worksheet.columns.forEach(column => {
      let maxLength = 10;
      column.eachCell?.({ includeEmpty: false }, cell => {
        const cellValue = cell.value ? String(cell.value) : '';
        maxLength = Math.max(maxLength, cellValue.length);
      });
      column.width = Math.min(maxLength + 2, 50);
    });
    
    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Materiality_Risk_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const getRiskColor = (risk: string) => {
    if (risk === 'High Risk') return 'text-red-600';
    if (risk === 'Medium Risk') return 'text-orange-600';
    if (risk === 'Low Risk') return 'text-green-600';
    return 'text-gray-600';
  };

  const getScoreOptions = (level: string): number[] => {
    if (level === 'High_Risk') return [8, 9, 10];
    if (level === 'Medium_Risk') return [4, 5, 6];
    if (level === 'Low_Risk') return [1, 2, 3];
    return [0];
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) {
      return `\u20B9${(amount / 10000000).toFixed(2)} Cr`;
    } else if (amount >= 100000) {
      return `\u20B9${(amount / 100000).toFixed(2)} L`;
    }
    return `\u20B9${amount.toLocaleString('en-IN')}`;
  };

  // T-088 presentation refresh (owner request, 27 Nov 2026): the Risk Assessment view fits one screen at 1100px and wider;
  // only the questionnaire list scrolls. Handlers, values, labels and placeholders are unchanged.
  const viewBtn = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${active ? 'bg-white text-[#9f1239] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`;
  const riskPill = (risk: string) =>
    risk === 'High Risk' ? 'bg-red-50 text-red-700 border-red-200'
      : risk === 'Medium Risk' ? 'bg-orange-50 text-orange-700 border-orange-200'
        : risk === 'Low Risk' ? 'bg-green-50 text-green-700 border-green-200'
          : 'bg-slate-50 text-slate-600 border-slate-200';
  const currentRisk = finalRisk || systemRisk;

  return (
    <div className={`flex flex-col gap-4 animate-fade-in ${currentView === 'risk' ? 'min-[1100px]:h-full min-[1100px]:min-h-0' : ''}`}>
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold leading-tight text-foreground">
            Materiality & Risk Assessment Tool
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calculate materiality and assess risk of material misstatement
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="View" className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            <button type="button" role="tab" aria-selected={currentView === 'risk'} onClick={switchToRisk} className={viewBtn(currentView === 'risk')}>
              Risk Assessment
            </button>
            <button type="button" role="tab" aria-selected={currentView === 'materiality'} onClick={switchToMateriality} className={viewBtn(currentView === 'materiality')}>
              Materiality
            </button>
            <button type="button" role="tab" aria-selected={currentView === 'register'} onClick={switchToRegister} className={viewBtn(currentView === 'register')}>
              <AlertTriangle className="h-4 w-4" />
              Risk Register
            </button>
          </div>
          <Button variant="outline" className="h-9 gap-2" onClick={exportToExcel}>
            <FileDown className="h-4 w-4" />
            Export to Excel
          </Button>
          <Button
            className="h-9 gap-2 bg-[#9f1239] text-white hover:bg-[#881337]"
            onClick={handleSaveDraft}
            disabled={saving}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
        </div>
      </div>

      {currentView === 'risk' ? (
        // RISK ASSESSMENT VIEW
        <div className="grid grid-cols-1 gap-4 min-[1100px]:min-h-0 min-[1100px]:flex-1 min-[1100px]:grid-cols-[minmax(0,1fr)_340px] min-[1100px]:grid-rows-[minmax(0,1fr)_150px]">
          {/* Risk Assessment Questionnaire */}
          <section aria-label="Risk Assessment Questionnaire" className="flex min-w-0 flex-col rounded-[10px] border border-slate-200 bg-white shadow-sm min-[1100px]:min-h-0">
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700" aria-hidden="true">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <h2 className="text-[15px] font-semibold text-foreground">Risk Assessment Questionnaire</h2>
              </div>
              <div className="flex gap-2">
                {isRiskFinalized && (
                  <Button variant="default" size="sm" onClick={recalculateRisk} className="h-8 gap-2">
                    <Calculator className="h-4 w-4" />
                    Recalculate Risk
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-slate-700" onClick={resetAllQuestions}>
                  <RotateCcw className="h-4 w-4" />
                  Reset All Questions
                </Button>
              </div>
            </header>

            <div className="grid grid-cols-[minmax(0,1fr)_11rem_7rem_2.25rem] items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Risk factor</span>
              <span>Risk Level</span>
              <span>Score</span>
              <span className="sr-only">Actions</span>
            </div>

            <div className="overflow-y-auto min-[1100px]:min-h-0 min-[1100px]:flex-1">
              {riskFactors.map((factor, index) => (
                <div key={index} className="grid h-9 grid-cols-[minmax(0,1fr)_11rem_7rem_2.25rem] items-center gap-3 border-b border-slate-100 px-4 odd:bg-white even:bg-slate-50/70 hover:bg-slate-100/70">
                  <Label className="truncate text-sm font-normal" title={factor}>{factor}</Label>
                  <Select
                    value={riskItems[index]?.level || 'NA'}
                    onValueChange={(value) => handleRiskLevelChange(index, value)}
                  >
                    <SelectTrigger className="h-7 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="High_Risk">High Risk</SelectItem>
                      <SelectItem value="Medium_Risk">Medium Risk</SelectItem>
                      <SelectItem value="Low_Risk">Low Risk</SelectItem>
                      <SelectItem value="NA">N/A</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={riskItems[index]?.score?.toString() || '0'}
                    onValueChange={(value) => handleRiskScoreChange(index, parseInt(value))}
                    disabled={!riskItems[index] || riskItems[index].level === 'NA'}
                  >
                    <SelectTrigger className="h-7 text-sm tabular-nums">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getScoreOptions(riskItems[index]?.level || 'NA').map(score => (
                        <SelectItem key={score} value={score.toString()}>{score}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end">
                    {index >= DEFAULT_RISK_FACTORS.length && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Delete ${factor}`}
                        onClick={() => deleteQuestion(index)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Question (pinned) */}
            <div className="flex shrink-0 gap-2 border-t border-slate-100 px-4 py-3">
              <Input
                placeholder="Add custom risk factor..."
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addQuestion()}
                className="h-9"
              />
              <Button variant="outline" onClick={addQuestion} className="h-9 gap-2">
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </section>

          {/* Risk Summary Sidebar */}
          <div className="flex min-w-0 flex-col gap-4 min-[1100px]:min-h-0 min-[1100px]:overflow-y-auto">
            <section aria-label="Risk Conclusion" className="rounded-[10px] border border-slate-200 bg-white shadow-sm">
              <header className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-[#9f1239]" aria-hidden="true">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <h3 className="text-[15px] font-semibold text-foreground">Risk Conclusion</h3>
              </header>

              <div className="space-y-3.5 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Total Risk Score</Label>
                    <output className="mt-0.5 block text-2xl font-bold tabular-nums text-foreground" aria-label="Total Risk Score">{totalRiskScore}</output>
                  </div>
                  <div className="rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Risk Percentage</Label>
                    <output className="mt-0.5 block text-2xl font-bold tabular-nums text-foreground" aria-label="Risk Percentage">{`${riskPercentage}%`}</output>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">System Risk</Label>
                  <Input
                    value={systemRisk}
                    readOnly
                    className={`h-9 bg-muted font-semibold ${getRiskColor(systemRisk)}`}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Auditor Override</Label>
                  <Select
                    value={finalRisk}
                    onValueChange={setFinalRisk}
                    disabled={isRiskFinalized}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low Risk">Low Risk</SelectItem>
                      <SelectItem value="Medium Risk">Medium Risk</SelectItem>
                      <SelectItem value="High Risk">High Risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="h-10 w-full gap-2 bg-[#9f1239] text-white hover:bg-[#881337]"
                  onClick={finalizeRisk}
                  disabled={isRiskFinalized}
                >
                  <Check className="h-4 w-4" />
                  {isRiskFinalized ? 'Risk Finalized' : 'Finalize Risk Conclusion'}
                </Button>
              </div>
            </section>

            <section aria-label="Current Risk Level" className="flex items-center justify-between gap-3 rounded-[10px] border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Current Risk Level
                </p>
                {!currentRisk && <p className="mt-0.5 text-xs text-muted-foreground">Appears after assessment</p>}
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold ${riskPill(currentRisk)}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                {currentRisk || 'Not assessed'}
              </span>
            </section>
          </div>

          {/* Remarks/Rationale */}
          <section aria-label="Remarks/Rationale" className="flex min-w-0 flex-col rounded-[10px] border border-slate-200 bg-white shadow-sm min-[1100px]:col-span-2 min-[1100px]:min-h-0">
            <header className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700" aria-hidden="true">
                <PenLine className="h-4 w-4" />
              </span>
              <h2 className="text-[15px] font-semibold text-foreground">Remarks/Rationale</h2>
            </header>
            <div className="flex min-h-0 flex-1 p-3">
              <Textarea
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Document the rationale for risk assessment..."
                className="min-h-0 flex-1 resize-none"
              />
            </div>
          </section>
        </div>
      ) : currentView === 'materiality' ? (
        // MATERIALITY VIEW
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Inputs */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header Information */}
            <div className="audit-card">
              <h2 className="font-semibold text-foreground mb-4">Determining Materiality</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name of Entity</Label>
                  <Input 
                    value={entityName} 
                    readOnly 
                    className="bg-muted"
                    placeholder="Select an engagement first"
                  />
                  <p className="text-xs text-muted-foreground">Auto-populated from selected engagement</p>
                </div>
                <div className="space-y-2">
                  <Label>Financial Year</Label>
                  <Input 
                    value={financialYear} 
                    readOnly 
                    className="bg-muted"
                    placeholder="Select an engagement first"
                  />
                  <p className="text-xs text-muted-foreground">Auto-populated from selected engagement</p>
                </div>
                <div className="space-y-2">
                  <Label>Materiality Stage</Label>
                  <Input value={materialityStage} readOnly className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Type of Engagement</Label>
                  <Input 
                    value={engagementType} 
                    readOnly 
                    className="bg-muted"
                    placeholder="Select an engagement first"
                  />
                  <p className="text-xs text-muted-foreground">Auto-populated from selected engagement</p>
                </div>
                <div className="space-y-2">
                  <Label>Prepared By</Label>
                  <Select value={preparedBy} onValueChange={setPreparedBy}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select team member..." />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem key={member.user_id} value={member.full_name}>
                          {member.full_name} ({member.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Reviewed By</Label>
                  <Select value={reviewedBy} onValueChange={setReviewedBy}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select team member..." />
                    </SelectTrigger>
                    <SelectContent>
                      {members.filter(m => m.role === 'partner' || m.role === 'manager').map((member) => (
                        <SelectItem key={member.user_id} value={member.full_name}>
                          {member.full_name} ({member.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Financial Base */}
            <div className="audit-card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-foreground">Financial Base</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    <AlertCircle className="h-3 w-3 inline mr-1" />
                    Financial data is auto-populated from Compliance Applicability (if available)
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Profit Before Tax</Label>
                  <Input
                    inputMode="decimal"
                    value={profitBeforeTax}
                    onChange={(e) => setProfitBeforeTax(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setProfitBeforeTax(formatIndianNumber(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">{formatCurrency(parseNumber(profitBeforeTax))}</p>
                </div>
                <div className="space-y-2">
                  <Label>Revenue / Gross Receipts</Label>
                  <Input
                    value={revenue}
                    inputMode="decimal"
                    onChange={(e) => setRevenue(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setRevenue(formatIndianNumber(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">{formatCurrency(parseNumber(revenue))}</p>
                </div>
                <div className="space-y-2">
                  <Label>Total Assets</Label>
                  <Input
                    value={totalAssets}
                    inputMode="decimal"
                    onChange={(e) => setTotalAssets(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setTotalAssets(formatIndianNumber(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">{formatCurrency(parseNumber(totalAssets))}</p>
                </div>
                <div className="space-y-2">
                  <Label>Net Worth</Label>
                  <Input
                    value={netWorth}
                    inputMode="decimal"
                    onChange={(e) => setNetWorth(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setNetWorth(formatIndianNumber(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">{formatCurrency(parseNumber(netWorth))}</p>
                </div>
                <div className="space-y-2">
                  <Label>Others Name</Label>
                  <Input
                    value={othersName}
                    onChange={(e) => setOthersName(e.target.value)}
                    placeholder="e.g., Gross Profit"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Others Amount</Label>
                  <Input
                    value={othersAmount}
                    inputMode="decimal"
                    onChange={(e) => setOthersAmount(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setOthersAmount(formatIndianNumber(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">{formatCurrency(parseNumber(othersAmount))}</p>
                </div>
              </div>
            </div>

            {/* Rationale */}
            <div className="audit-card">
              <h2 className="font-semibold text-foreground mb-4">Materiality Rationale</h2>
              <Textarea
                rows={4}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Document the rationale for the selected benchmark and percentage..."
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Explain why the chosen benchmark is appropriate for this entity and stakeholders.
              </p>
            </div>


          </div>

          {/* Right Column - Calculations */}
          <div className="space-y-4">
            {/* Risk Level Display */}
            <div className="audit-card text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Risk Level
              </p>
              <p className={`text-2xl font-bold ${getRiskColor(finalRisk || systemRisk)}`}>
                {finalRisk || systemRisk || 'Not Assessed'}
              </p>
            </div>

            {/* CAQD Guidance */}
            <div className="audit-card">
              <h3 className="font-medium text-foreground mb-3 text-sm">
                ICAI-CAQD Suggested Materiality Range
              </h3>
              <p className="text-sm text-muted-foreground italic mb-2">{caqdSuggestion}</p>
              <p className="text-xs text-muted-foreground">
                Suggested range based on concluded Risk of Material Misstatement. 
                This is guidance only. Auditor judgment prevails.
              </p>
            </div>

            {/* Overall Materiality */}
            <div className="audit-card">
              <h3 className="font-medium text-foreground mb-3">Overall Materiality</h3>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Benchmark</Label>
                  <Select value={benchmark} onValueChange={setBenchmark}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Profit Before Tax">Profit Before Tax</SelectItem>
                      <SelectItem value="Revenue / Gross Receipts">Revenue / Gross Receipts</SelectItem>
                      <SelectItem value="Total Assets">Total Assets</SelectItem>
                      <SelectItem value="Net Worth">Net Worth</SelectItem>
                      {othersName && <SelectItem value="Others">{othersName}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Percentage (%)</Label>
                  <Input
                    value={percentage}
                    inputMode="decimal"
                    onChange={(e) => setPercentage(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setPercentage(sanitizeNumericStrict(e.target.value))}
                  />
                </div>
                <Button className="w-full" onClick={calculateOM}>
                  <Calculator className="h-4 w-4 mr-2" />
                  Calculate
                </Button>
                <div className="pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <p className="text-2xl font-bold text-primary mt-1">{formatCurrency(omAmount)}</p>
                </div>
              </div>
            </div>

            {/* Performance Materiality */}
            <div className="audit-card">
              <h3 className="font-medium text-foreground mb-3">Performance Materiality</h3>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Percentage of OM (%)</Label>
                  <Input
                    value={pmPercentage}
                    inputMode="decimal"
                    placeholder="e.g., 75"
                    onChange={(e) => setPmPercentage(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setPmPercentage(sanitizeNumericStrict(e.target.value))}
                  />
                </div>
                <Button className="w-full" onClick={calculatePM}>
                  <Calculator className="h-4 w-4 mr-2" />
                  Calculate
                </Button>
                <div className="pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(pmAmount)}</p>
                </div>
              </div>
            </div>

            {/* Clearly Trivial */}
            <div className="audit-card">
              <h3 className="font-medium text-foreground mb-3">Clearly Trivial Threshold</h3>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Percentage of OM (%)</Label>
                  <Input
                    value={ctPercentage}
                    inputMode="decimal"
                    placeholder="e.g., 5"
                    onChange={(e) => setCtPercentage(sanitizeNumericLoose(e.target.value))}
                    onBlur={(e) => setCtPercentage(sanitizeNumericStrict(e.target.value))}
                  />
                </div>
                <Button className="w-full" onClick={calculateCT}>
                  <Calculator className="h-4 w-4 mr-2" />
                  Calculate
                </Button>
                <div className="pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(ctAmount)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">Risk Register</div>
          </div>
          <RiskRegisterContent showPageHeader={false} />
        </div>
      )}
    </div>
  );
}
