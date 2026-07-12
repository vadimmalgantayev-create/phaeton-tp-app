'use strict';

const { readSheetRows } = require('../lib/workbook');
const { parseRuDate, toNumberOrNull, cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const BRAND_HEADER_ROW = 2; // "Бизнес регион","","","555","","AE",...
const SUBHEADER_ROW = 3; // "Клиент","","","Размер скидки","Дата окончания скидки",...
const FIRST_DATA_ROW = 4; // row 4 = region baseline ("Алматы"), row 5+ = per-client overrides

/**
 * Действующие скидки is a cross-tab: one row per client (plus one baseline
 * row for the region default), one column-pair per brand
 * (Размер скидки / Дата окончания скидки). ТЗ 4.2 asks for this normalized
 * to the long form Клиент—Бренд—Скидка%—ДатаОкончания, which is what this
 * returns:
 *   { regionDefaults: [{ brand, percent, validUntil }],
 *     clientDiscounts: [{ client, brand, percent, validUntil }] }
 * "Истёкшая" discounts (validUntil in the past) are still returned as-is —
 * expiry is a runtime concern for whoever computes the client's price
 * (ТЗ 7.1/6.6), not a reason to drop the row here.
 */
function parseDiscounts(filePath, sheetName) {
  const rows = readSheetRows(filePath, sheetName);
  const collector = new ValidationCollector('discounts');

  const brandRow = rows[BRAND_HEADER_ROW] || [];
  const subRow = rows[SUBHEADER_ROW] || [];
  const brandColumns = [];
  for (let c = 0; c < subRow.length; c++) {
    if (subRow[c] !== 'Размер скидки') continue;
    let bc = c;
    while (bc >= 0 && !brandRow[bc]) bc--;
    const brand = cleanString(brandRow[bc]);
    if (brand) brandColumns.push({ discountCol: c, endDateCol: c + 1, brand });
  }

  const regionDefaults = [];
  const clientDiscounts = [];

  for (let i = FIRST_DATA_ROW; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
    const rowNumber = i + 1;
    const name = cleanString(row[0]);
    if (!name) continue;
    const isBaseline = i === FIRST_DATA_ROW;

    for (const bc of brandColumns) {
      const pctRaw = row[bc.discountCol];
      if (pctRaw === '' || pctRaw === null || pctRaw === undefined) {
        continue; // no discount set for this client/brand pair — not an error, just absent
      }
      collector.countRow();
      const percent = toNumberOrNull(pctRaw);
      if (percent === null || percent < 0 || percent > 100) {
        collector.fail(rowNumber, `Скидка[${bc.brand}]`, `Некорректный размер скидки для "${name}"/${bc.brand}`, pctRaw);
        continue;
      }
      const endDateRaw = row[bc.endDateCol];
      const validUntil = parseRuDate(endDateRaw);
      if (endDateRaw && !validUntil) {
        collector.fail(rowNumber, `ДатаОкончания[${bc.brand}]`, `Нераспознанная дата окончания скидки для "${name}"/${bc.brand}`, endDateRaw);
        continue;
      }

      if (isBaseline) {
        regionDefaults.push({ brand: bc.brand, percent, validUntil });
      } else {
        clientDiscounts.push({ client: name, brand: bc.brand, percent, validUntil });
      }
    }
  }

  return { regionDefaults, clientDiscounts, collector };
}

module.exports = { parseDiscounts };
