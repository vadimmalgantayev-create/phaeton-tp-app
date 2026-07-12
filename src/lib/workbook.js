'use strict';

const XLSX = require('xlsx');

/**
 * Reads one sheet as an array-of-arrays with real numeric values (not the
 * thousands-separator display string) and raw text for everything else.
 * `header:1` keeps rows positional, which every parser here relies on since
 * these 1C exports have multi-row, non-uniform headers.
 */
function readSheetRows(filePath, sheetName) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const name = sheetName || wb.SheetNames[0];
  if (!wb.Sheets[name]) {
    throw new Error(`Sheet "${name}" not found. Available: ${wb.SheetNames.join(', ')}`);
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
}

function sheetNames(filePath) {
  const wb = XLSX.readFile(filePath, { bookSheets: true });
  return wb.SheetNames;
}

module.exports = { readSheetRows, sheetNames, XLSX };
