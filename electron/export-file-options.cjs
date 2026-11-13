const path = require('node:path');

function resolveExportFileOptions(payload, downloadsPath) {
  const fileExtension = String(payload?.fileExtension || 'docx').toLowerCase();
  if (fileExtension !== 'csv' && fileExtension !== 'docx') {
    throw new Error('Unsupported export file type.');
  }

  const safeFilename = String(payload?.defaultFilename || `export.${fileExtension}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_');
  const filenameBase = safeFilename.replace(/\.[^.]+$/, '') || 'export';
  const filename = `${filenameBase}.${fileExtension}`;

  return {
    defaultPath: path.join(downloadsPath, filename),
    title: fileExtension === 'csv' ? 'Export CSV File' : 'Export Word Document',
    filters: [{
      name: fileExtension === 'csv' ? 'CSV File' : 'Word Document',
      extensions: [fileExtension],
    }],
  };
}

module.exports = { resolveExportFileOptions };