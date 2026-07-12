'use strict';

const { readSheetRows } = require('../lib/workbook');
const { getRowOutlineLevels } = require('../lib/outline');
const { toNumberOrNull, parseRuDateTimeFromText, cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const BUCKET_COLUMNS = [
  { field: 'bucketUnder3d', index: 4 },
  { field: 'bucket3to7d', index: 5 },
  { field: 'bucket7to14d', index: 6 },
  { field: 'bucket14to30d', index: 7 },
  { field: 'bucket30to60d', index: 8 },
  { field: 'bucket60to90d', index: 9 },
  { field: 'bucket90to180d', index: 10 },
  { field: 'bucket180dTo1y', index: 11 },
  { field: 'bucket1to2y', index: 12 },
  { field: 'bucket2to3y', index: 13 },
  { field: 'bucketOver3y', index: 14 },
];
const TOTAL_DEBT_COL = 2; // "Долг"
const OVERDUE_TOTAL_COL = 15; // "Итого" (of the overdue buckets)
const LIMIT_COL = 16; // "Лимит"
const PAYMENT_DATE_COL = 1; // only populated on order (leaf) rows

// Row depth per ТЗ 4.3 / observed outlineLevel: 0=регион, 1=менеджер,
// 2=партнёр(клиент), 3=договор, 4=заказ клиента. See README.md.
const CLIENT_LEVEL = 2;
const HEADER_ROWS = 5; // rows 0-4 are the multi-row column header block

/**
 * ДЗ и просроченная задолженность -> per-client debt aggregates. Only the
 * client-level (level 2) row's own totals are used — they already are 1C's
 * rollup across that client's contracts/orders, which is all the app needs
 * (ТЗ 4.3: "В карточке клиента: общий долг, лимит, ближайшая дата
 * платежа, разбивка по корзинам"). Contract/order rows underneath are
 * walked only to find the nearest upcoming payment date.
 */
async function parseDebt(filePath, sheetName) {
  const rows = readSheetRows(filePath, sheetName);
  const resolvedSheetName = sheetName || require('../lib/workbook').sheetNames(filePath)[0];
  const levels = await getRowOutlineLevels(filePath, resolvedSheetName);
  const collector = new ValidationCollector('debt');

  const records = [];
  let current = null; // in-progress client record

  const flush = () => {
    if (current) records.push(current);
    current = null;
  };

  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
    const rowNumber = i + 1;
    const level = levels.get(rowNumber) ?? 0;
    const label = cleanString(row[0]);
    if (!label) continue;

    if (level === CLIENT_LEVEL) {
      flush();
      collector.countRow();
      const totalDebt = toNumberOrNull(row[TOTAL_DEBT_COL]);
      if (totalDebt === null) {
        collector.fail(rowNumber, 'Долг', `Не удалось разобрать сумму долга клиента "${label}"`, row[TOTAL_DEBT_COL]);
        continue;
      }
      const overdueTotal = toNumberOrNull(row[OVERDUE_TOTAL_COL]) || 0;
      current = {
        client: label,
        totalDebt,
        limitAmount: toNumberOrNull(row[LIMIT_COL]),
        nearestPaymentDate: null,
        isOverdue: overdueTotal > 0,
      };
      for (const bucket of BUCKET_COLUMNS) {
        current[bucket.field] = toNumberOrNull(row[bucket.index]) || 0;
      }
    } else if (level > CLIENT_LEVEL && current) {
      // Contract or order row nested under the current client — only the
      // payment date is of interest at this granularity.
      const paymentDate = parseRuDateTimeFromText(row[PAYMENT_DATE_COL]);
      if (paymentDate && (!current.nearestPaymentDate || paymentDate < current.nearestPaymentDate)) {
        current.nearestPaymentDate = paymentDate;
      }
    }
    // level < CLIENT_LEVEL (region/manager subtotal rows) carry no new info
    // beyond what's already rolled up into each client's own row — skipped.
  }
  flush();

  return { records, collector };
}

module.exports = { parseDebt };
