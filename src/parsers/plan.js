'use strict';

const { readSheetRows, sheetNames } = require('../lib/workbook');
const { toNumberOrNull, cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const UNIT_MAP = {
  'Сумма EUR': 'EUR',
  Литры: 'LITERS',
  Штуки: 'PIECES',
};

const SHEET_BRAND_GROUPS = 'Шалблон - бренды и группы';
const SHEET_TOTAL = 'Шаблон общий план';
const SHEET_ACB = 'АКБ Общ и Масло';

/**
 * Загрузка по ТП (план), 3 листа per ТЗ 4.7. All three are flat tables
 * (no outline hierarchy, unlike debt/sales) — one manager per row, so
 * parsing is straightforward. Rows with an empty "Менеджер" (the AКБ
 * sheet's totals row at the bottom) are skipped as report totals, not data.
 */
function parsePlan(filePath) {
  const available = sheetNames(filePath);
  const collector = new ValidationCollector('plan');
  const brandGroupPlans = [];
  const totalPlans = [];
  const acbPlans = [];

  if (available.includes(SHEET_BRAND_GROUPS)) {
    const rows = readSheetRows(filePath, SHEET_BRAND_GROUPS);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
      const manager = cleanString(row[1]);
      if (!manager) continue;
      const rowNumber = i + 1;
      collector.countRow();
      const region = cleanString(row[0]);
      const productGroup = cleanString(row[2]);
      const planValue = toNumberOrNull(row[3]);
      const unit = UNIT_MAP[cleanString(row[4])];
      const weightPct = toNumberOrNull(row[5]);
      if (!region || !productGroup || planValue === null || !unit || weightPct === null) {
        collector.fail(rowNumber, 'Шаблон - бренды и группы', `Неполная строка плана для "${manager}"/"${productGroup}"`, JSON.stringify(row));
        continue;
      }
      brandGroupPlans.push({ region, manager, productGroup, planValue, unit, weightPct });
    }
  }

  if (available.includes(SHEET_TOTAL)) {
    const rows = readSheetRows(filePath, SHEET_TOTAL);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
      const manager = cleanString(row[1]);
      if (!manager) continue;
      const rowNumber = i + 1;
      collector.countRow();
      const region = cleanString(row[0]);
      const planValue = toNumberOrNull(row[2]);
      const weightPct = toNumberOrNull(row[3]);
      if (!region || planValue === null || weightPct === null) {
        collector.fail(rowNumber, 'Шаблон общий план', `Неполная строка общего плана для "${manager}"`, JSON.stringify(row));
        continue;
      }
      totalPlans.push({ region, manager, planValue, weightPct });
    }
  }

  if (available.includes(SHEET_ACB)) {
    const rows = readSheetRows(filePath, SHEET_ACB);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
      const manager = cleanString(row[1]);
      if (!manager) continue; // totals row at the bottom has no manager
      const rowNumber = i + 1;
      collector.countRow();
      const region = cleanString(row[0]);
      const acbTotal = toNumberOrNull(row[2]);
      const acbOil = toNumberOrNull(row[3]);
      const weightPct = toNumberOrNull(row[4]);
      if (!region || acbTotal === null || acbOil === null || weightPct === null) {
        collector.fail(rowNumber, 'АКБ Общ и Масло', `Неполная строка плана АКБ для "${manager}"`, JSON.stringify(row));
        continue;
      }
      acbPlans.push({ region, manager, acbTotal: Math.round(acbTotal), acbOil: Math.round(acbOil), weightPct });
    }
  }

  return { brandGroupPlans, totalPlans, acbPlans, collector };
}

module.exports = { parsePlan };
