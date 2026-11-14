'use strict';

const { canAccessPermanentFile } = require('./authorization.cjs');
const { requirePastOrToday } = require('./domain.cjs');

function assertAccess(db, context, clientId) {
  if (!canAccessPermanentFile(db, context, clientId)) throw new Error('Permanent-file access denied.');
}

function readEntity(db, context, clientId) {
  assertAccess(db, context, clientId);
  const client = db.prepare(`SELECT id, name, industry, constitution, cin, pan, address, state, pin
    FROM clients WHERE id = ?`).get(clientId);
  const details = db.prepare(`SELECT trade_name AS tradeName, incorporation_date AS incorporationDate,
    incorporation_place AS incorporationPlace, tan, branches_json AS branchesJson,
    group_details AS groupDetails, audit_partner AS auditPartner, key_personnel AS keyPersonnel
    FROM permanent_file_entities WHERE client_id = ?`).get(clientId);
  const registrations = db.prepare('SELECT gstin FROM client_gstins WHERE client_id = ? ORDER BY gstin')
    .all(clientId).map((row) => row.gstin);
  const pan = (client.pan || '').trim().toUpperCase();
  const validPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const matches = (gstin) => validPan && /^[A-Z0-9]{15}$/.test(gstin.trim().toUpperCase())
    && gstin.trim().toUpperCase().slice(2, 12) === pan;
  const gstins = registrations.filter(matches);
  const unmatchedGstins = registrations.filter((gstin) => !matches(gstin));
  return { client, details: details ? {
    tradeName: details.tradeName ?? '', incorporationDate: details.incorporationDate ?? '',
    incorporationPlace: details.incorporationPlace ?? '', tan: details.tan ?? '',
    branches: JSON.parse(details.branchesJson), groupDetails: details.groupDetails ?? '',
    auditPartner: details.auditPartner ?? '', keyPersonnel: details.keyPersonnel ?? '',
  } : null, gstins, unmatchedGstins, canEditMaster: context.isManagerOrAbove === true };
}

function saveClientMaster(db, context, clientId, master) {
  assertAccess(db, context, clientId);
  if (!context.isManagerOrAbove) throw new Error('Manager or above is required to edit client master details.');
  if (!master || Object.getPrototypeOf(master) !== Object.prototype) throw new TypeError('Invalid client details.');
  const fields = ['name', 'industry', 'constitution', 'cin', 'pan', 'address', 'state', 'pin'];
  for (const key of fields) {
    if (typeof master[key] !== 'string' || master[key].length > 4096) throw new TypeError(`Invalid ${key}.`);
  }
  const name = master.name.trim();
  const pan = master.pan.trim().toUpperCase();
  const cin = master.cin.trim().toUpperCase();
  const constitution = master.constitution;
  if (!name) throw new Error('Legal name is required.');
  const allowed = ['company', 'llp', 'partnership', 'proprietorship', 'trust', 'society', 'aop', 'huf', 'cooperative'];
  if (!allowed.includes(constitution)) throw new Error('Select a valid constitution.');
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error('PAN must contain five letters, four digits and one letter.');
  const panConstitutions = {
    C: ['company'], F: ['partnership', 'llp'], P: ['proprietorship'], H: ['huf'], T: ['trust'],
  };
  if (pan && panConstitutions[pan[3]] && !panConstitutions[pan[3]].includes(constitution)) {
    throw new Error('Constitution does not match the PAN holder type.');
  }
  if (cin && constitution === 'company' && !/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(cin)) {
    throw new Error('Enter a structurally valid 21-character CIN.');
  }
  if (cin && constitution === 'llp' && !/^[A-Z]{3}-[0-9]{4}$/.test(cin)) throw new Error('LLPIN must use the format AAA-0000.');
  if (cin && constitution !== 'company' && constitution !== 'llp') throw new Error('CIN/LLPIN applies only to companies or LLPs.');
  if (master.pin.trim() && !/^[0-9]{6}$/.test(master.pin.trim())) throw new Error('PIN must contain six digits.');

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT pan FROM clients WHERE id = ?').get(clientId);
    if ((existing.pan || '').trim().toUpperCase() !== pan) {
      const registrations = db.prepare('SELECT gstin FROM client_gstins WHERE client_id = ?').all(clientId);
      if (registrations.some(({ gstin }) => {
        const value = gstin.trim().toUpperCase();
        return !pan || !/^[A-Z0-9]{15}$/.test(value) || value.slice(2, 12) !== pan;
      })) {
        throw new Error('Reconcile linked GSTINs before changing the client PAN. Existing registrations remain stored.');
      }
    }
    db.prepare(`UPDATE clients SET name = ?, industry = ?, constitution = ?, cin = ?, pan = ?,
      address = ?, state = ?, pin = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(name, master.industry.trim() || null, constitution, cin || null, pan || null,
        master.address.trim() || null, master.state.trim() || null, master.pin.trim() || null, clientId);
    db.prepare("UPDATE engagements SET client_name = ?, updated_at = datetime('now') WHERE client_id = ?")
      .run(name, clientId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function saveEntity(db, context, clientId, details) {
  assertAccess(db, context, clientId);
  if (!details || Object.getPrototypeOf(details) !== Object.prototype) throw new TypeError('Invalid entity details.');
  const fields = ['tradeName', 'incorporationDate', 'incorporationPlace', 'tan', 'groupDetails', 'auditPartner', 'keyPersonnel'];
  for (const key of fields) {
    if (typeof details[key] !== 'string' || details[key].length > 4096) throw new TypeError(`Invalid ${key}.`);
  }
  if (!Array.isArray(details.branches) || details.branches.length > 200
      || details.branches.some((value) => typeof value !== 'string' || !value.trim() || value.length > 1000)) {
    throw new TypeError('Invalid branch addresses.');
  }
  if (details.incorporationDate) requirePastOrToday(details.incorporationDate, 'Date of incorporation');
  db.prepare(`INSERT INTO permanent_file_entities
    (client_id, trade_name, incorporation_date, incorporation_place, tan, branches_json, group_details, audit_partner, key_personnel, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET trade_name=excluded.trade_name, incorporation_date=excluded.incorporation_date,
      incorporation_place=excluded.incorporation_place, tan=excluded.tan, branches_json=excluded.branches_json,
      group_details=excluded.group_details, audit_partner=excluded.audit_partner, key_personnel=excluded.key_personnel,
      updated_by=excluded.updated_by, updated_at=datetime('now')`)
    .run(clientId, details.tradeName.trim(), details.incorporationDate || null, details.incorporationPlace.trim(),
      details.tan.trim(), JSON.stringify(details.branches.map((value) => value.trim())), details.groupDetails.trim(),
      details.auditPartner.trim(), details.keyPersonnel.trim(), context.userId);
}

module.exports = { readEntity, saveEntity, saveClientMaster };
