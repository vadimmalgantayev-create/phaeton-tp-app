'use strict';

const { readSheetRows } = require('../lib/workbook');
const { cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const COL = { client: 0, manager: 3, orderRef: 5, deliveryVariant: 6 };
const HEADER_ROWS = 4; // rows 0-3: filter note, blank, region group label, column header

/**
 * Нет накладных на отгрузку -> one row per order stuck without an invoice
 * (ТЗ 4.5). The file's first data row is always a region rollup with no
 * order reference — skipped by requiring a non-empty "Заказ ссылка".
 * Usually near-empty (ТЗ: "Файл обычно почти пуст").
 */
function parseMissingInvoices(filePath, sheetName) {
  const rows = readSheetRows(filePath, sheetName);
  const collector = new ValidationCollector('missing_invoices');
  const records = [];

  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
    const orderRef = cleanString(row[COL.orderRef]);
    if (!orderRef) continue; // region/manager rollup row, not an actual record

    const rowNumber = i + 1;
    collector.countRow();
    const client = cleanString(row[COL.client]);
    if (!client) {
      collector.fail(rowNumber, 'Партнер', 'Пустой клиент для сигнала "нет накладных" — строка пропущена', row[COL.client]);
      continue;
    }
    records.push({
      client,
      manager: cleanString(row[COL.manager]),
      orderRef,
      deliveryVariant: cleanString(row[COL.deliveryVariant]),
    });
  }

  return { records, collector };
}

module.exports = { parseMissingInvoices };
