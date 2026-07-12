'use strict';

const { readSheetRows } = require('../lib/workbook');
const { toNumberOrNull, cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const WAREHOUSE_COLUMNS = [
  { index: 10, name: 'Алматы СКЛАД' },
  { index: 11, name: 'Астана СКЛАД' },
  { index: 12, name: 'Кар Сити СКЛАД' },
];

const HEADER_ROWS = 2; // row0 = column names, row1 = "Количество" sub-header for warehouse columns

/**
 * Прайс-лист с остатками -> [{ article, brand, name, tnved, packQty,
 * priceGross, generalDiscountPct, priceNet, application, article1c,
 * isServiceRow, stocks: [{warehouse, quantity}] }]
 */
function parsePriceList(filePath, sheetName) {
  const rows = readSheetRows(filePath, sheetName);
  const collector = new ValidationCollector('price_list');
  const items = [];
  const seen = new Set();

  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
    const rowNumber = i + 1;
    collector.countRow();

    const article = cleanString(row[0]);
    const brand = cleanString(row[1]);
    const name = cleanString(row[2]);

    if (!article) {
      collector.fail(rowNumber, 'Артикул', 'Пустой артикул — строка пропущена', row[0]);
      continue;
    }
    if (!brand) {
      collector.fail(rowNumber, 'Бренд', 'Пустой бренд — строка пропущена', row[1]);
      continue;
    }
    const key = `${article} ${brand}`;
    if (seen.has(key)) {
      collector.fail(rowNumber, 'Артикул+Бренд', `Дублирующаяся позиция ${article}/${brand} — строка пропущена`, key);
      continue;
    }
    seen.add(key);

    const priceGross = toNumberOrNull(row[5]);
    const generalDiscountPct = toNumberOrNull(row[6]);
    const priceNet = toNumberOrNull(row[7]);
    const packQtyRaw = toNumberOrNull(row[4]);

    const stocks = [];
    for (const wh of WAREHOUSE_COLUMNS) {
      const qty = toNumberOrNull(row[wh.index]);
      if (qty !== null && qty !== 0) stocks.push({ warehouse: wh.name, quantity: qty });
    }

    items.push({
      article,
      brand,
      name: name || article,
      tnved: cleanString(row[3]),
      packQty: packQtyRaw !== null ? Math.round(packQtyRaw) : null,
      priceGross,
      generalDiscountPct,
      priceNet,
      application: cleanString(row[8]),
      article1c: cleanString(row[9]),
      isServiceRow: priceGross === null && priceNet === null,
      stocks,
    });
  }

  return { items, collector };
}

module.exports = { parsePriceList };
