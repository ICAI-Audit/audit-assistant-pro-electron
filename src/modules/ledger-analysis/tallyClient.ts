// Renderer side of the Ledger Analysis Tally fetch (electron/ledger-analysis/tally-xml.cjs).

import type { BuildInput, LedgerInput } from "./importers";
import type { DayBookLine } from "./types";

export interface TallyFetchProgress { step: string; done: number; total: number; label: string; rows?: number }

interface RawTally {
  company: string;
  companies: { name: string; booksFrom: string; startingFrom: string }[];
  from: string;
  to: string;
  ledgers: { name: string; parent: string; opening: number; closing: number; gstin: string; pan: string; gstRegistrationType: string }[];
  groups: { name: string; parent: string }[];
  lines: {
    voucherId: string; date: string; voucherType: string; voucherNo: string; reference: string; party: string; narration: string;
    partyGstin: string; ledger: string; amount: number; voucherAmount?: number;
    bills?: { name: string; type: string; creditPeriod: string; amount: number }[];
  }[];
  warnings: string[];
}

type Api = {
  tallyCompanies: (o: { host: string; port: string }) => Promise<{ success: boolean; companies?: RawTally["companies"]; error?: string }>;
  tallyFetch: (o: Record<string, unknown>) => Promise<{ success: boolean; data?: RawTally; error?: string }>;
  onProgress: (cb: (p: TallyFetchProgress) => void) => () => void;
};

function api(): Api {
  const a = (window as unknown as { electronAPI?: { ledgerAnalysis?: Api } }).electronAPI?.ledgerAnalysis;
  if (!a) throw new Error("Tally fetch is available in the ICAI VERA desktop app only (restart the app if it was updated).");
  return a;
}

export const tallyAvailable = () => Boolean((window as unknown as { electronAPI?: { ledgerAnalysis?: Api } }).electronAPI?.ledgerAnalysis);

export async function fetchFromTally(
  opts: { host: string; port: string; company: string; from: string; to: string; includeDayBook: boolean; method?: "auto" | "report" | "collection" },
  onProgress?: (p: TallyFetchProgress) => void,
): Promise<BuildInput> {
  const a = api();
  const off = onProgress ? a.onProgress(onProgress) : () => undefined;
  try {
    const res = await a.tallyFetch(opts);
    if (!res.success || !res.data) throw new Error(res.error || "Tally fetch failed");
    const d = res.data;
    // Tally signs: debit negative -> flip to debit positive
    const ledgers: LedgerInput[] = d.ledgers.map((l) => ({
      name: l.name, parent: l.parent, gstin: l.gstin, pan: l.pan, gstRegistrationType: l.gstRegistrationType,
      opening: -l.opening, closing: -l.closing, debit: 0, credit: 0, hasBalances: true,
    }));
    const lines: DayBookLine[] = d.lines.map((x) => ({
      voucherId: x.voucherId, date: x.date, voucherType: x.voucherType, voucherNo: x.voucherNo, reference: x.reference,
      party: x.party, ledger: x.ledger, amount: Math.round(-x.amount * 100) / 100, narration: x.narration, partyGstin: x.partyGstin,
      group: "", primaryGroup: "",
      voucherAmount: x.voucherAmount,
      bills: (x.bills || []).map((b) => ({ ...b, amount: Math.round(-b.amount * 100) / 100 })),
    }));
    return {
      company: d.company, from: d.from, to: d.to, ledgers, groups: d.groups, lines,
      sources: [`Tally (live) ${opts.host}:${opts.port}`], warnings: d.warnings,
      taxFields: { gstin: true, pan: true },
    };
  } finally {
    off();
  }
}
