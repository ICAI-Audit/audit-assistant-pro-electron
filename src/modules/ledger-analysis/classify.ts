// Classifies a ledger into Asset / Liability / Income / Expense and Debtor / Creditor
// from its group chain. Works with Tally's reserved groups (ERP 9 and TallyPrime spellings),
// Busy primary groups and Zoho sections / account types.

import type { Nature, PartyType } from "./types";

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Ordered: more specific names first. Each entry: pattern on the normalised group name.
const RESERVED: { rx: RegExp; nature: Nature; name: string; party?: PartyType }[] = [
  { rx: /^sundry debtors?$|^trade receivables?$|^accounts? receivables?$|^debtors$/, nature: "Asset", name: "Sundry Debtors", party: "Debtor" },
  { rx: /^sundry creditors?$|^trade payables?$|^accounts? payables?$|^creditors$/, nature: "Liability", name: "Sundry Creditors", party: "Creditor" },
  { rx: /^bank od a ?c$|^bank od accounts?$|^bank occ a ?c$|^bank overdraft/, nature: "Liability", name: "Bank OD A/c" },
  { rx: /^bank accounts?$/, nature: "Asset", name: "Bank Accounts" },
  { rx: /^cash in hand$|^cash$/, nature: "Asset", name: "Cash-in-Hand" },
  { rx: /^stock in hand$|^stock$|^inventor(y|ies)$/, nature: "Asset", name: "Stock-in-Hand" },
  { rx: /^deposits? asset$/, nature: "Asset", name: "Deposits (Asset)" },
  { rx: /^loans? advances? asset$/, nature: "Asset", name: "Loans & Advances (Asset)" },
  { rx: /^fixed assets?$|^property plant/, nature: "Asset", name: "Fixed Assets" },
  { rx: /^investments?$/, nature: "Asset", name: "Investments" },
  { rx: /^current assets?$|^other current assets?$|^assets?$/, nature: "Asset", name: "Current Assets" },
  { rx: /^misc expenses asset$|^miscellaneous expenses asset$|^pre operative expenses$/, nature: "Asset", name: "Misc. Expenses (Asset)" },
  { rx: /^duties taxes$|^duties and taxes$/, nature: "Liability", name: "Duties & Taxes" },
  { rx: /^provisions?$/, nature: "Liability", name: "Provisions" },
  { rx: /^secured loans?$/, nature: "Liability", name: "Secured Loans" },
  { rx: /^unsecured loans?$/, nature: "Liability", name: "Unsecured Loans" },
  { rx: /^loans? liability$/, nature: "Liability", name: "Loans (Liability)" },
  { rx: /^current liabilit(y|ies)$|^other current liabilit(y|ies)$|^liabilit(y|ies)$/, nature: "Liability", name: "Current Liabilities" },
  { rx: /^reserves? surplus$|^reserves? and surplus$|^retained earnings$/, nature: "Liability", name: "Reserves & Surplus" },
  { rx: /^capital account$|^capital$|^equit(y|ies)$|^owner s equity$/, nature: "Liability", name: "Capital Account" },
  { rx: /^sales accounts?$|^sales$|^revenue from operations$/, nature: "Income", name: "Sales Accounts" },
  { rx: /^direct incomes?$|^income direct$/, nature: "Income", name: "Direct Incomes" },
  { rx: /^indirect incomes?$|^income indirect$|^other incomes?$|^income$/, nature: "Income", name: "Indirect Incomes" },
  { rx: /^purchase accounts?$|^purchases?$|^cost of goods sold$/, nature: "Expense", name: "Purchase Accounts" },
  { rx: /^direct expenses?$|^expenses direct$/, nature: "Expense", name: "Direct Expenses" },
  { rx: /^indirect expenses?$|^expenses indirect$|^other expenses?$|^expenses?$/, nature: "Expense", name: "Indirect Expenses" },
];

export interface Classification {
  nature: Nature;
  partyType: PartyType;
  reservedGroup: string;
}

/**
 * chain = [parent, grandparent, ..., primary]. Nature is decided by the outermost recognised group
 * (the primary), the party type and the reserved group by the nearest recognised one.
 */
export function classifyChain(chain: string[], ledgerName = ""): Classification {
  const hits = chain
    .map((g) => ({ g, hit: RESERVED.find((r) => r.rx.test(norm(g))) }))
    .filter((x) => x.hit);
  let nature: Nature = "Unknown";
  let partyType: PartyType = null;
  let reservedGroup = "";
  if (hits.length) {
    // The OUTERMOST recognised group (the primary) decides the nature, so a user sub-group called
    // "Expenses" under Current Assets stays an asset; the NEAREST one names the reserved group.
    const nearest = hits[0].hit!;
    reservedGroup = nearest.name;
    nature = hits[hits.length - 1].hit!.nature;
    partyType = hits.map((h) => h.hit!.party).find((p) => p) || null;
  }
  if (nature === "Unknown") {
    // last resort - keywords in the group names / ledger name
    const all = norm(chain.join(" ") + " " + ledgerName);
    if (/debtor|receivable/.test(all)) { nature = "Asset"; partyType = "Debtor"; reservedGroup = "Sundry Debtors"; }
    else if (/creditor|payable/.test(all)) { nature = "Liability"; partyType = "Creditor"; reservedGroup = "Sundry Creditors"; }
  }
  if (/^profit (and )?loss a ?c(count)?$/.test(norm(ledgerName))) {
    nature = "Liability";
    reservedGroup = reservedGroup || "Capital Account";
  }
  return { nature, partyType, reservedGroup };
}

/** Normal side of a nature: +1 = debit, -1 = credit, 0 = unknown. */
export function normalSide(n: Nature): 1 | -1 | 0 {
  if (n === "Asset" || n === "Expense") return 1;
  if (n === "Liability" || n === "Income") return -1;
  return 0;
}

/** Builds the parent chain of a group from a group -> parent map (Tally "Primary" parent stops the walk). */
export function chainFromGroups(parent: string, groupParent: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let g = (parent || "").trim();
  while (g && !seen.has(g.toLowerCase()) && out.length < 20) {
    seen.add(g.toLowerCase());
    out.push(g);
    // Tally writes the parent of a primary group as "&#4; Primary" (control character + Primary)
    const p = (groupParent.get(g.toLowerCase().replace(/\s+/g, " ").trim()) || "").replace(/^[^A-Za-z0-9]+/, "").trim();
    if (!p || /^primary$/i.test(p)) break;
    g = p;
  }
  return out;
}
