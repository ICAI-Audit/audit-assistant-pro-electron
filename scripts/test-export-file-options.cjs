const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveExportFileOptions } = require('../electron/export-file-options.cjs');

test('CSV export keeps the CSV extension and save-dialog filter', () => {
  assert.deepEqual(
    resolveExportFileOptions({ defaultFilename: 'GSTIN_Template.csv', fileExtension: 'csv' }, 'C:\\Downloads'),
    {
      defaultPath: 'C:\\Downloads\\GSTIN_Template.csv',
      title: 'Export CSV File',
      filters: [{ name: 'CSV File', extensions: ['csv'] }],
    }
  );
});

test('DOCX remains the default for existing Word exports', () => {
  assert.deepEqual(
    resolveExportFileOptions({ defaultFilename: 'Form_3CB.docx' }, 'C:\\Downloads'),
    {
      defaultPath: 'C:\\Downloads\\Form_3CB.docx',
      title: 'Export Word Document',
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    }
  );
});

test('unsupported export extensions are rejected', () => {
  assert.throws(
    () => resolveExportFileOptions({ defaultFilename: 'unsafe.exe', fileExtension: 'exe' }, 'C:\\Downloads'),
    /Unsupported export file type/
  );
});