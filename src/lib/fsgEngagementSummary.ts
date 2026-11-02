// Renderer client for the read-only Financial Statement Review summary of an
// engagement (T-021). Returns null outside the desktop application or when the
// main process refuses the request.

export interface FsgPeriodSummary {
  yearLabel: string | null;
  found: boolean;
  tbCount: number;
  totalRows: number;
  classifiedRows: number;
  unclassifiedRows: number;
}

export interface FsgEngagementSummary {
  engagementId: string;
  financialYear: string;
  current: FsgPeriodSummary;
  previous: FsgPeriodSummary;
  amounts: { paidUpCapital: number; reservesSurplus: number; borrowings: number } | null;
}

interface FsgBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
}

export async function getFsgEngagementSummary(engagementId: string): Promise<FsgEngagementSummary | null> {
  const bridge = (window as unknown as { electronAPI?: { fsg?: FsgBridge } }).electronAPI?.fsg;
  if (!bridge) return null;
  try {
    const response = await bridge.invoke('fsg:engagement:summary', engagementId);
    return response && response.ok ? (response.result as FsgEngagementSummary) : null;
  } catch {
    return null;
  }
}

export interface FinancialReviewPeriod {
  periodType: 'CY' | 'PY';
  hasData: boolean;
  totalLines: number;
  classifiedLines: number;
  unclassifiedLines: number;
  classificationComplete: boolean;
}

// CY is the engagement's financial year and PY the year before it.
export function buildFinancialReviewSnapshot(summary: FsgEngagementSummary): FinancialReviewPeriod[] {
  const toPeriod = (periodType: 'CY' | 'PY', p: FsgPeriodSummary): FinancialReviewPeriod => ({
    periodType,
    hasData: p.totalRows > 0,
    totalLines: p.totalRows,
    classifiedLines: p.classifiedRows,
    unclassifiedLines: p.unclassifiedRows,
    classificationComplete: p.totalRows > 0 && p.unclassifiedRows === 0,
  });
  return [toPeriod('CY', summary.current), toPeriod('PY', summary.previous)];
}