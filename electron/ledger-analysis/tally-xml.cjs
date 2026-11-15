/**
 * Ledger Analysis - live fetch from Tally over its HTTP XML server (TallyPrime / ERP 9, default port 9000).
 *
 * Fetches, for the period asked:
 *   - ledger masters: name, parent, opening / closing balance, GSTIN, PAN, GST registration type
 *   - group masters : name, parent (to build each ledger's group chain)
 *   - day book      : every non-optional voucher with all its ledger lines, month by month
 *
 * Signs are returned exactly as Tally gives them (debit = negative). The renderer converts.
 * Nothing is written to Tally: every request is an Export.
 */

const http = require('http');

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 9000;
const TIMEOUT_MS = 10 * 60 * 1000;

function xmlEscape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlUnescape(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => {
      const n = parseInt(d, 10);
      return n < 32 ? ' ' : String.fromCharCode(n);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return n < 32 ? ' ' : String.fromCharCode(n);
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(inner, name) {
  const m = String(inner || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? xmlUnescape(m[1]) : '';
}

function attr(openTag, name) {
  const m = String(openTag || '').match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? xmlUnescape(m[1]) : '';
}

function blocks(xml, name) {
  const out = [];
  const rx = new RegExp(`<${name.replace(/\./g, '\\.')}(\\s[^>]*)?>([\\s\\S]*?)<\\/${name.replace(/\./g, '\\.')}>`, 'gi');
  let m;
  while ((m = rx.exec(xml))) out.push({ open: m[1] || '', inner: m[2] });
  return out;
}

/** Removes nested *.LIST blocks so a tag read on the remainder belongs to this entry only. */
function stripLists(inner) {
  let s = String(inner || '');
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/<([A-Z0-9_.]+\.LIST)(\s[^>]*)?>[\s\S]*?<\/\1>/gi, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

function num(raw) {
  const t = String(raw || '').replace(/[₹,\s]/g, '');
  if (!t) return 0;
  const cr = /cr$/i.test(t);
  const dr = /dr$/i.test(t);
  const n = parseFloat(t.replace(/(dr|cr)$/i, '').replace(/[()]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (dr) return -Math.abs(n);
  if (cr) return Math.abs(n);
  return n;
}

const ymd = (iso) => String(iso || '').replace(/-/g, '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2025-04-01 -> 01-Apr-2025 (the form $$Date and the Day Book report accept in every Tally release). */
const tallyDate = (iso) => `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}-${iso.slice(0, 4)}`; // 01-Apr-2025, as TallyDayBook.exe
const isoFromTally = (d) => {
  const t = String(d || '').trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(t);
  if (m) {
    const mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].toLowerCase()];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
};

function tallyRequest(xmlBody, host, port, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(xmlBody, 'utf8');
    const req = http.request({
      hostname: host || DEFAULT_HOST,
      port: parseInt(port, 10) || DEFAULT_PORT,
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=utf-8', 'Content-Length': body.length },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Tally answers UTF-8, or UTF-16LE when its export encoding is set to Unicode.
        let text = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        resolve(text);
      });
      res.on('error', (e) => reject(new Error('Response error: ' + e.message)));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Tally did not answer within ${Math.round(timeoutMs / 1000)} s. Keep the company open, close any report/dialog in Tally and retry, or use a shorter period.`));
    });
    req.on('error', (err) => {
      const p = parseInt(port, 10) || DEFAULT_PORT;
      const map = {
        ECONNREFUSED: `Nothing is listening on ${host || DEFAULT_HOST}:${p}. Open Tally with the company loaded and enable it as a server (F1 Help > Settings > Connectivity > Client/Server: "Both", port ${p}).`,
        ECONNRESET: 'Tally closed the connection. Try again after a moment.',
        ENOTFOUND: `Host "${host}" not found.`,
        ETIMEDOUT: `Could not reach ${host}:${p}. Check firewall / network.`,
      };
      reject(new Error(map[err.code] || `${err.code || 'ERR'}: ${err.message}`));
    });
    req.write(body);
    req.end();
  });
}

function envelope(id, collectionXml, { from, to, company } = {}) {
  return `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${id}</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      ${from ? `<SVFROMDATE TYPE="Date">${ymd(from)}</SVFROMDATE>` : ''}
      ${to ? `<SVTODATE TYPE="Date">${ymd(to)}</SVTODATE>` : ''}
      ${company ? `<SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>` : ''}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>${collectionXml}</TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;
}

function checkTallyError(text) {
  const lineErr = tag(text, 'LINEERROR');
  if (lineErr) throw new Error(`Tally: ${lineErr}`);
}

async function fetchCompanies(host, port) {
  const xml = envelope('VERA LA Companies', `
    <COLLECTION NAME="VERA LA Companies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name,BooksFrom,StartingFrom</FETCH></COLLECTION>`);
  const text = await tallyRequest(xml, host, port, 30000);
  checkTallyError(text);
  return blocks(text, 'COMPANY').map((b) => ({
    name: attr(b.open, 'NAME') || tag(b.inner, 'NAME'),
    booksFrom: isoFromTally(tag(b.inner, 'BOOKSFROM')),
    startingFrom: isoFromTally(tag(b.inner, 'STARTINGFROM')),
  })).filter((c) => c.name);
}

async function fetchMasters(host, port, opts) {
  const ledXml = envelope('VERA LA Ledgers', `
    <COLLECTION NAME="VERA LA Ledgers" ISMODIFY="No">
      <TYPE>Ledger</TYPE>
      <FETCH>Name,Parent,OpeningBalance,ClosingBalance,PartyGSTIN,IncomeTaxNumber,GSTRegistrationType,LedGSTRegDetails.GSTIN,LedGSTRegDetails.GSTRegistrationType</FETCH>
    </COLLECTION>`, opts);
  const ledText = await tallyRequest(ledXml, host, port);
  checkTallyError(ledText);
  const ledgers = blocks(ledText, 'LEDGER').map((b) => {
    const own = stripLists(b.inner);
    const reg = blocks(b.inner, 'LEDGSTREGDETAILS.LIST');
    const lastReg = reg.length ? reg[reg.length - 1].inner : '';
    return {
      name: attr(b.open, 'NAME') || tag(own, 'NAME'),
      parent: tag(own, 'PARENT'),
      opening: num(tag(own, 'OPENINGBALANCE')),
      closing: num(tag(own, 'CLOSINGBALANCE')),
      gstin: (tag(own, 'PARTYGSTIN') || tag(lastReg, 'GSTIN')).toUpperCase(),
      pan: tag(own, 'INCOMETAXNUMBER').toUpperCase(),
      gstRegistrationType: tag(own, 'GSTREGISTRATIONTYPE') || tag(lastReg, 'GSTREGISTRATIONTYPE'),
    };
  }).filter((l) => l.name);

  const grpXml = envelope('VERA LA Groups', `
    <COLLECTION NAME="VERA LA Groups" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>Name,Parent</FETCH></COLLECTION>`, opts);
  const grpText = await tallyRequest(grpXml, host, port);
  checkTallyError(grpText);
  const groups = blocks(grpText, 'GROUP').map((b) => ({
    name: attr(b.open, 'NAME') || tag(stripLists(b.inner), 'NAME'),
    parent: tag(stripLists(b.inner), 'PARENT'),
  })).filter((g) => g.name);
  return { ledgers, groups };
}

function monthChunks(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const end = to;
  let start = from;
  while (start <= end && out.length < 120) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let stop = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    if (stop > end) stop = end;
    out.push({ from: start, to: stop });
    m++; if (m > 12) { m = 1; y++; }
    start = `${y}-${String(m).padStart(2, '0')}-01`;
  }
  return out;
}

/**
 * Same clean-up as TallyDayBook.exe v6 clean_xml(): drop characters that are not legal in XML 1.0
 * (Tally sometimes emits raw control characters in names / narrations) before parsing.
 */
function cleanXml(text) {
  return String(text || '').replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '');
}

const first = (inner, ...names) => {
  for (const n of names) { const v = tag(inner, n); if (v) return v; }
  return '';
};

/**
 * Vouchers -> ledger lines. Works for both answers:
 *   - the TDL collection ("collection" method), and
 *   - Tally's own Day Book report (the method of TallyDayBook.exe v6).
 * Field fallbacks are those of TallyDayBook.exe smart_parse(): DATE|VOUCHERDATE, VOUCHERNUMBER|VCHNO,
 * VOUCHERTYPENAME|VCHTYPE attribute, PARTYLEDGERNAME|PARTYNAME|BASICBUYERNAME, ALLLEDGERENTRIES|LEDGERENTRIES|LEDGER.LIST,
 * LEDGERNAME|NAME, and bill allocations BILLALLOCATIONS.LIST|BILL.LIST (NAME, BILLTYPE, credit period, AMOUNT).
 */
function parseVouchers(text, from, to, stats = {}, nonAccounting = null) {
  const lines = [];
  stats.vouchers = stats.vouchers || 0;
  stats.skippedOptional = stats.skippedOptional || 0;
  stats.skippedPostDated = stats.skippedPostDated || 0;
  stats.skippedTypes = stats.skippedTypes || {};
  for (const v of blocks(text, 'VOUCHER')) {
    const own = stripLists(v.inner);
    if (/^yes$/i.test(tag(own, 'ISOPTIONAL')) || /^yes$/i.test(tag(own, 'ISCANCELLED'))) { stats.skippedOptional++; continue; }
    // post-dated vouchers do not affect the books (or Tally's trial balance) until their date is reached
    if (/^yes$/i.test(tag(own, 'ISPOSTDATED'))) { stats.skippedPostDated++; continue; }
    const date = isoFromTally(first(own, 'DATE', 'VOUCHERDATE'));
    if (!date || date < from || date > to) continue;
    const vchType = first(own, 'VOUCHERTYPENAME', 'VCHTYPE') || attr(v.open, 'VCHTYPE');
    // orders, delivery / receipt notes, memorandum etc. carry ledger lines but post nothing to the books
    const base = nonAccounting && nonAccounting.get(String(vchType).trim().toLowerCase());
    if (base) { stats.skippedTypes[vchType] = (stats.skippedTypes[vchType] || 0) + 1; continue; }
    const vchNo = first(own, 'VOUCHERNUMBER', 'VCHNO');
    const id = tag(own, 'MASTERID') || attr(v.open, 'REMOTEID') || tag(own, 'GUID');
    const head = {
      voucherId: id ? `T${id}` : `T${date}|${vchType}|${vchNo}`,
      date,
      voucherType: vchType,
      voucherNo: vchNo,
      reference: tag(own, 'REFERENCE'),
      party: first(own, 'PARTYLEDGERNAME', 'PARTYNAME', 'BASICBUYERNAME'),
      narration: tag(own, 'NARRATION'),
      partyGstin: tag(own, 'PARTYGSTIN').toUpperCase(),
    };
    const read = (list) => blocks(v.inner, list).map((b) => {
      const e = stripLists(b.inner);
      // Tally AMOUNT is signed (debit negative). TallyDayBook.exe used ISDEEMEDPOSITIVE for the side;
      // the two agree in Tally's export, and the sign also covers entries where the flag is missing.
      const amount = num(tag(e, 'AMOUNT'));
      const bills = [...blocks(b.inner, 'BILLALLOCATIONS.LIST'), ...blocks(b.inner, 'BILL.LIST')].map((x) => {
        const bi = stripLists(x.inner);
        return {
          name: tag(bi, 'NAME'),
          type: tag(bi, 'BILLTYPE'),
          creditPeriod: first(bi, 'BILLCREDITPERIOD', 'CREDITPERIOD'),
          amount: num(tag(bi, 'AMOUNT')),
        };
      }).filter((x) => x.name || x.type || x.amount);
      return { ledger: first(e, 'LEDGERNAME', 'NAME'), amount, bills };
    }).filter((e) => e.ledger && e.amount);
    let entries = read('ALLLEDGERENTRIES.LIST');
    if (!entries.length) entries = read('LEDGERENTRIES.LIST');
    if (!entries.length) entries = read('LEDGER.LIST');
    const sum = (a) => a.reduce((t, e) => t + e.amount, 0);
    if (Math.abs(sum(entries)) > 0.5) {
      // item invoices: the sales / purchase ledger sits in the inventory lines' accounting allocations
      // (TallyDayBook.exe v6 did not read these, so its item invoices missed that line)
      const alloc = read('ACCOUNTINGALLOCATIONS.LIST');
      if (alloc.length && Math.abs(sum(entries) + sum(alloc)) < Math.abs(sum(entries))) entries = entries.concat(alloc);
    }
    if (!entries.length) continue;
    stats.vouchers++;
    const vchAmount = Math.abs(num(tag(own, 'AMOUNT'))) || Math.round(entries.filter((e) => e.amount < 0).reduce((t, e) => t - e.amount, 0) * 100) / 100;
    for (const e of entries) {
      lines.push({ ...head, voucherAmount: vchAmount, ledger: e.ledger, amount: e.amount, bills: e.bills });
    }
  }
  return lines;
}

/** Tally's own Day Book report - the request of TallyDayBook.exe v6 build_xml(), incl. its SVCURRENTDATE fix. */
function dayBookReportEnvelope(from, to, company) {
  return `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Export Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <EXPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
     <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
     <SVFROMDATE>${tallyDate(from)}</SVFROMDATE>
     <SVTODATE>${tallyDate(to)}</SVTODATE>
     <SVCURRENTDATE>${tallyDate(to)}</SVCURRENTDATE>
     ${company ? `<SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>` : ''}
    </STATICVARIABLES>
   </REQUESTDESC>
  </EXPORTDATA>
 </BODY>
</ENVELOPE>`;
}

function collectionEnvelope(c, opts) {
  return envelope('VERA LA DayBook', `
      <COLLECTION NAME="VERA LA DayBook" ISMODIFY="No">
        <TYPE>Voucher</TYPE>
        <FETCH>Date,VoucherTypeName,VoucherNumber,Reference,PartyLedgerName,PartyGSTIN,Narration,MasterID,IsOptional,IsCancelled,IsPostDated,AllLedgerEntries,LedgerEntries,AllInventoryEntries</FETCH>
        <FILTERS>VeraLAInPeriod</FILTERS>
      </COLLECTION>
      <SYSTEM TYPE="Formulae" NAME="VeraLAInPeriod">$Date &gt;= $$Date:"${tallyDate(c.from)}" AND $Date &lt;= $$Date:"${tallyDate(c.to)}"</SYSTEM>`,
  { ...opts, from: c.from, to: c.to });
}

const MONTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Tally's predefined voucher types that never post to the books. Stock / Physical Stock journals are NOT listed:
 * they normally carry no ledger lines (so add nothing), and when they do Tally counts those lines.
 */
const NON_ACCOUNTING_BASES = new Set([
  'purchase order', 'sales order', 'delivery note', 'receipt note', 'rejections in', 'rejections out',
  'memorandum', 'reversing journal', 'job work in order', 'job work out order', 'material in', 'material out',
]);

/**
 * Voucher type name (lower case) -> its predefined base type, for every type that does not post to the books.
 * User-created types ("Local Purchase", "Sales Order - Export") are resolved through their Parent chain.
 */
async function fetchNonAccountingTypes(host, port, opts) {
  const xml = envelope('VERA LA VchTypes', `
    <COLLECTION NAME="VERA LA VchTypes" ISMODIFY="No"><TYPE>VoucherType</TYPE><FETCH>Name,Parent</FETCH></COLLECTION>`, { company: opts.company });
  const text = await tallyRequest(xml, host, port, 60000);
  checkTallyError(text);
  const parent = new Map();
  for (const b of blocks(text, 'VOUCHERTYPE')) {
    const own = stripLists(b.inner);
    const name = (attr(b.open, 'NAME') || tag(own, 'NAME')).trim();
    if (name) parent.set(name.toLowerCase(), tag(own, 'PARENT').trim().toLowerCase());
  }
  const out = new Map();
  for (const name of parent.keys()) {
    let cur = name;
    for (let i = 0; i < 10 && cur; i++) {
      if (NON_ACCOUNTING_BASES.has(cur)) { out.set(name, cur); break; }
      const p = parent.get(cur);
      if (!p || p === cur) break;
      cur = p;
    }
  }
  return out;
}

/**
 * Day book, month by month (so one big period cannot hang Tally).
 * method: "auto" (voucher collection, then the Day Book report if the collection fails),
 *         "collection", or "report" (TallyDayBook.exe way).
 * The Day Book report honours only SVCURRENTDATE on TallyPrime: asked for a month it returns that one day,
 * so it is the fallback, and a month where it returns a single date is flagged as incomplete.
 * A month that times out is retried once; if it still fails it is skipped and named in the warnings
 * (TallyDayBook.exe skipped it silently).
 */
async function fetchDayBook(host, port, opts, onProgress) {
  const method = opts.method || 'auto';
  const chunks = monthChunks(opts.from, opts.to);
  const all = [];
  const warnings = [];
  const stats = {};
  const used = { report: 0, collection: 0 };
  const skipped = [];
  const oneDayMonths = [];
  let nonAccounting = null;
  try { nonAccounting = await fetchNonAccountingTypes(host, port, opts); } catch (e) {
    if (/Nothing is listening|closed the connection|not found|reach/i.test(e.message)) throw e;
    warnings.push(`Voucher types could not be read (${e.message}); orders / delivery notes are left out by name only.`);
  }
  if (!nonAccounting) {
    nonAccounting = new Map();
    for (const b of NON_ACCOUNTING_BASES) nonAccounting.set(b, b);
  }
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    onProgress?.({ step: 'daybook', done: i, total: chunks.length, label: `${c.from} to ${c.to}`, rows: all.length });
    const tryOne = async (how) => {
      const body = how === 'report' ? dayBookReportEnvelope(c.from, c.to, opts.company) : collectionEnvelope(c, opts);
      let text;
      try { text = await tallyRequest(body, host, port, MONTH_TIMEOUT_MS); } catch (e) {
        if (/did not answer/i.test(e.message)) text = await tallyRequest(body, host, port, MONTH_TIMEOUT_MS); // one retry
        else throw e;
      }
      text = cleanXml(text);
      checkTallyError(text);
      const parsed = parseVouchers(text, c.from, c.to, stats, nonAccounting);
      if (how === 'report' && c.from !== c.to && parsed.length && new Set(parsed.map((x) => x.date)).size === 1) {
        oneDayMonths.push(`${c.from} to ${c.to}`);
      }
      return parsed;
    };
    let rows = null;
    let lastErr = null;
    const order = method === 'report' ? ['report'] : method === 'collection' ? ['collection'] : ['collection', 'report'];
    for (const how of order) {
      try {
        rows = await tryOne(how);
        if (rows.length || how === order[order.length - 1]) { used[how]++; break; }
      } catch (e) {
        if (/Nothing is listening|closed the connection|not found|reach/i.test(e.message)) throw new Error(`Tally disconnected while fetching ${c.from} to ${c.to}. Keep Tally open and try again. (${e.message})`);
        lastErr = e;
        rows = null;
      }
    }
    if (rows === null) {
      skipped.push(`${c.from} to ${c.to}`);
      warnings.push(`Day book for ${c.from} to ${c.to} could not be fetched and is MISSING: ${lastErr ? lastErr.message : 'no answer'}`);
      continue;
    }
    all.push(...rows);
  }
  onProgress?.({ step: 'daybook', done: chunks.length, total: chunks.length, label: 'done', rows: all.length });
  if (stats.skippedOptional) warnings.push(`${stats.skippedOptional} optional / cancelled voucher(s) left out.`);
  if (stats.skippedPostDated) warnings.push(`${stats.skippedPostDated} post-dated voucher(s) left out (they do not affect the books yet).`);
  const typeSkips = Object.entries(stats.skippedTypes || {});
  if (typeSkips.length) {
    warnings.push(`Non-accounting vouchers left out (they post nothing to the ledgers): ${typeSkips.map(([t, n]) => `${t} ${n}`).join(', ')}.`);
  }
  if (oneDayMonths.length) {
    warnings.push(`The Day Book report returned only one date for ${oneDayMonths.length} month(s) (${oneDayMonths.slice(0, 3).join('; ')}${oneDayMonths.length > 3 ? '; ...' : ''}) - the day book is INCOMPLETE. Use the "Voucher collection" method.`);
  }
  if (method === 'auto' && used.collection && used.report) warnings.push(`Day book: ${used.collection} month(s) via the voucher collection, ${used.report} via the Day Book report.`);
  // parseVouchers keeps only vouchers dated inside each month, so a voucher is never counted twice.
  return { lines: all, warnings, skipped };
}

/** Everything the Ledger Analysis tool needs, in one call. */
async function fetchAll({ host, port, from, to, company, includeDayBook = true, method = 'auto' }, onProgress) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
    throw new Error('Give a valid period (from date not after to date).');
  }
  const warnings = [];
  onProgress?.({ step: 'company', done: 0, total: 1, label: 'Connecting to Tally' });
  let companies = [];
  try { companies = await fetchCompanies(host, port); } catch (e) {
    if (/ECONN|listening|not found|reach/i.test(e.message)) throw e;
    warnings.push(`Company list not available: ${e.message}`);
  }
  if (companies.length > 1 && !company) {
    warnings.push(`${companies.length} companies are open in Tally (${companies.map((c) => c.name).join(', ')}). Data is from the active company - type the company name to choose.`);
  }
  const opts = { from, to, company: company || '', method };
  onProgress?.({ step: 'masters', done: 0, total: 1, label: 'Ledger and group masters' });
  const masters = await fetchMasters(host, port, opts);
  if (!masters.ledgers.length) throw new Error('Tally answered but returned no ledgers. Check that the company is open (and the company name, if given).');
  let lines = [];
  if (includeDayBook) {
    const d = await fetchDayBook(host, port, opts, onProgress);
    lines = d.lines;
    warnings.push(...d.warnings);
  }
  return {
    company: company || (companies[0] && companies[0].name) || '',
    companies,
    from, to,
    ledgers: masters.ledgers,
    groups: masters.groups,
    lines,
    warnings,
  };
}

module.exports = { fetchAll, fetchCompanies, _internal: { parseVouchers, blocks, stripLists, num, monthChunks, xmlUnescape, cleanXml, dayBookReportEnvelope, fetchDayBook, fetchNonAccountingTypes } };
