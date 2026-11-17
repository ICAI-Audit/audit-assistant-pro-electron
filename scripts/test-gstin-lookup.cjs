const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGstinLookupHandler,
  calculateCheckDigit,
  fetchGstinDetails,
  getGstinTaxpayerType,
  getGstinValidationError,
  parseGstinLookupResponse,
} = require('../electron/gstin-lookup.cjs');

test('main-process GSTIN validation accepts the checksum vector used by the renderer', () => {
  assert.equal(getGstinValidationError('07AABCT1234A1Z2'), null);
  assert.match(getGstinValidationError('00AABCT1234A1Z2'), /state code/i);
  assert.match(getGstinValidationError('07AABCT1234AAZ2'), /13th GSTIN character/i);
  assert.match(getGstinValidationError('07AABCT1234A1K2'), /14th GSTIN character/i);
  assert.match(getGstinValidationError('07AABCT1234A1Z9'), /checksum/i);

  const isdPrefix = '07AABCT1234A1S';
  assert.equal(getGstinValidationError(`${isdPrefix}${calculateCheckDigit(isdPrefix)}`), null);
  assert.equal(getGstinValidationError('072600100001NFT'), null);
  assert.equal(getGstinValidationError('072600100001UIN'), null);
  assert.equal(getGstinValidationError('072600100001ONP'), null);
  assert.equal(getGstinValidationError('072600000001TRP'), null);
  assert.equal(getGstinValidationError('072600000001TMP'), null);
});

test('taxpayer type is derived from character 14 with the requested labels/codes', () => {
  const codeTypes = {
    S: 'ISD',
    C: 'TCS',
    D: 'TDS',
    F: 'NON_RESIDENT',
    I: 'UN_BODIES',
    R: 'TAX_RETURN_PREPARER',
    M: 'TEMPORARY_ID',
    Z: 'REGULAR',
  };
  for (const [code, type] of Object.entries(codeTypes)) {
    assert.equal(getGstinTaxpayerType(`07AABCT1234A1${code}2`), type);
  }
});

test('lookup sends only a normalized, locally valid GSTIN to the fixed service URL', async () => {
  let requestUrl;
  const result = await fetchGstinDetails(' 07aabct1234a1z2 ', {
    fetchImpl: async (url) => {
      requestUrl = url;
      return {
        ok: true,
        text: async () => JSON.stringify({ valid: true, name: 'Example Limited' }),
      };
    },
  });

  assert.equal(requestUrl.origin, 'https://api.e-waybill.in');
  assert.equal(requestUrl.pathname, '/api/gstin/validate');
  assert.equal(requestUrl.searchParams.get('gstin'), '07AABCT1234A1Z2');
  assert.deepEqual(result, { valid: true, name: 'Example Limited', taxpayerType: 'REGULAR', message: null });
});

test('lookup refuses structurally invalid GSTINs before calling the network', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchGstinDetails('00AABCT1234A1Z2', {
      fetchImpl: async () => {
        requestCount += 1;
      },
    }),
    /state code/i
  );
  assert.equal(requestCount, 0);
});

test('lookup response parser reads provider name without relying on a provider taxpayer-type field', () => {
  assert.deepEqual(
    parseGstinLookupResponse(JSON.stringify({ valid: true, name: 'Example Limited' })),
    { valid: true, name: 'Example Limited', message: null }
  );
});

test('lookup response reports provider rejection without returning fabricated details', () => {
  assert.deepEqual(
    parseGstinLookupResponse(JSON.stringify({ valid: false, name: '', gstNumber: '07AABCT1234A1Z2' })),
    { valid: false, name: '', message: 'The lookup service did not confirm this GSTIN.' }
  );
});

test('IPC handler rejects unauthenticated callers and callers without explicit consent before network access', async () => {
  let requestCount = 0;
  const handler = createGstinLookupHandler({
    getAuthenticatedUserId: (event) => event?.authenticated,
    fetchDetails: async () => {
      requestCount += 1;
      return { valid: true, name: 'Example Limited', taxpayerType: null, message: null };
    },
  });

  assert.deepEqual(await handler({}, { gstin: '07AABCT1234A1Z2', consentConfirmed: true }), {
    success: false,
    error: 'Authentication required.',
  });
  assert.deepEqual(await handler({ authenticated: true }, { gstin: '07AABCT1234A1Z2', consentConfirmed: false }), {
    success: false,
    error: 'Confirm internet lookup consent before continuing.',
  });
  assert.equal(requestCount, 0);
});

test('IPC handler calls lookup only after authentication and consent are both present', async () => {
  const handler = createGstinLookupHandler({
    getAuthenticatedUserId: (event) => event?.authenticated,
    fetchDetails: async (gstin) => ({ valid: true, name: gstin, taxpayerType: null, message: null }),
  });
  const result = await handler({ authenticated: true }, { gstin: '07AABCT1234A1Z2', consentConfirmed: true });
  assert.deepEqual(result, {
    success: true,
    data: { valid: true, name: '07AABCT1234A1Z2', taxpayerType: null, message: null },
  });
});