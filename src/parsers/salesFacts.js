'use strict';

const { readSheetRows } = require('../lib/workbook');
const { toNumberOrNull, cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const MONTH_HEADER_ROW = 8; // "Январь 2025 г." etc, only at each month block's first column
const SUBHEADER_ROW = 9; // "Количество" / "Объем, л (дм3)" / "Выручка (EUR)"
const HEADER_ROWS = 12; // rows 0-11 are metadata/period/title/column-header rows
const FILTER_ROW = 6; // "Отбор:", "...В группе из списка \"Алматы\"..."
const BRAND_FREQUENCY_THRESHOLD = 2;

const MONTHS_RU = {
  'январь': 0, 'февраль': 1, 'март': 2, 'апрель': 3, 'май': 4, 'июнь': 5,
  'июль': 6, 'август': 7, 'сентябрь': 8, 'октябрь': 9, 'ноябрь': 10, 'декабрь': 11,
};

function parseMonthLabel(label) {
  const m = String(label).trim().match(/^([а-яё]+)\s+(\d{4})/i);
  if (!m) return null;
  const monthIndex = MONTHS_RU[m[1].toLowerCase()];
  if (monthIndex === undefined) return null;
  return new Date(Date.UTC(Number(m[2]), monthIndex, 1));
}

/** Locates the region name from the report's own "Отбор:" filter line. */
function detectRegion(rows) {
  const filterRow = rows[FILTER_ROW] || [];
  const text = filterRow.filter(Boolean).join(' ');
  const m = text.match(/"([^"]+)"/);
  return m ? m[1] : null;
}

function buildMonthColumns(rows) {
  const row8 = rows[MONTH_HEADER_ROW] || [];
  const row9 = rows[SUBHEADER_ROW] || [];
  const months = [];
  for (let c = 3; c < row9.length; c++) {
    if (row9[c] !== 'Количество') continue;
    let mc = c;
    while (mc >= 0 && !row8[mc]) mc--;
    const month = parseMonthLabel(row8[mc]);
    if (!month) continue;
    let volCol = null;
    let revCol = null;
    for (let k = c + 1; k < row9.length && k < c + 6; k++) {
      if (volCol === null && String(row9[k]).startsWith('Объем')) volCol = k;
      else if (volCol !== null && revCol === null && String(row9[k]).startsWith('Выручка')) {
        revCol = k;
        break;
      }
    }
    if (volCol !== null && revCol !== null) months.push({ month, qtyCol: c, volCol, revCol });
  }
  return months;
}

/**
 * Продажи (факт): региональная иерархия Регион->Менеджер->Клиент->Бренд
 * (ТЗ 4.6), flattened by 1C into one column of row labels with depth
 * carried in each row's outlineLevel. That attribute turned out NOT to be a
 * reliable depth signal here: client-name rows are supposed to sit one
 * level above their brand children, but in this export the vast majority
 * of client blocks (2918 of 2946 observed) have **no separate client-name
 * row at all** — client and manager boundaries collapse to the same
 * outlineLevel as ordinary brand rows once a group has already been
 * rendered once. See README.md "Известные ограничения" for the full
 * investigation.
 *
 * What *is* reliable: a real catalog brand (BOSCH, WINKOD, CTR, ...) is
 * purchased by many different clients and so its row label recurs
 * dozens-to-thousands of times across the file, while a client name is
 * structurally unique and appears exactly once. So instead of trusting
 * outlineLevel, this parser classifies every row label by how many times
 * it recurs in the whole sheet:
 *   - in `knownManagers` (from the plan file's manager roster) -> manager
 *   - equal to the detected region -> skip (region rollup, no new info)
 *   - recurs >= BRAND_FREQUENCY_THRESHOLD times -> brand (leaf fact row)
 *   - otherwise -> a new client boundary
 * This is empirically clean on the sample file (freq==1: 3026 labels,
 * matching managers/region/clients; freq>=2: 137 labels, matching the
 * known ~98-187 brand universe almost exactly) but is a best-effort
 * heuristic, not a guarantee — a brand a client bought only once in the
 * whole 19-month window would be misread as a client boundary, splitting
 * that one client's history in two. This is called out in the load report
 * as a known-limitation note, not hidden.
 */
async function parseSalesFacts(filePath, sheetName, knownManagers = []) {
  const rows = readSheetRows(filePath, sheetName);
  const collector = new ValidationCollector('sales_facts');

  const region = detectRegion(rows);
  const months = buildMonthColumns(rows);
  const managerSet = new Set(knownManagers.map((m) => m.trim()));

  const frequency = new Map();
  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const label = cleanString(rows[i] && rows[i][0]);
    if (!label) continue;
    frequency.set(label, (frequency.get(label) || 0) + 1);
  }

  const facts = [];
  let currentManager = null;
  let currentClient = null;
  let sawAnyManager = false;

  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
    const rowNumber = i + 1;
    const label = cleanString(row[0]);
    if (!label) continue;

    if (label === region) continue; // region rollup row — no new info
    if (managerSet.has(label)) {
      currentManager = label;
      currentClient = null;
      sawAnyManager = true;
      continue;
    }
    if ((frequency.get(label) || 0) < BRAND_FREQUENCY_THRESHOLD) {
      currentClient = label; // new client boundary (see limitation above)
      continue;
    }

    // Recurring label = brand leaf row.
    if (!currentManager && managerSet.size > 0) {
      collector.countRow();
      collector.fail(rowNumber, 'Иерархия', `Строка бренда "${label}" встретилась до определения менеджера — пропущена`, label);
      continue;
    }
    if (!currentClient) {
      // The client-name row was itself collapsed away by 1C right at a
      // manager boundary (same limitation as mid-file — see module docs);
      // bucket under a placeholder rather than dropping real sales data.
      currentClient = 'Клиент не определён (см. ограничения загрузчика)';
      collector.note(rowNumber, 'Иерархия', `Первая строка бренда "${label}" после менеджера "${currentManager}" встретилась без имени клиента — данные отнесены к плейсхолдеру`, label);
    }
    for (const mo of months) {
      const qty = toNumberOrNull(row[mo.qtyCol]);
      const vol = toNumberOrNull(row[mo.volCol]);
      const rev = toNumberOrNull(row[mo.revCol]);
      if (qty === null && vol === null && rev === null) continue; // no sales that month — not an error
      collector.countRow();
      facts.push({
        manager: currentManager || 'Не определён',
        client: currentClient,
        brand: label,
        month: mo.month,
        quantity: qty || 0,
        volumeL: vol || 0,
        revenueEur: rev || 0,
      });
    }
  }

  if (!sawAnyManager && managerSet.size > 0) {
    collector.note(null, 'Менеджер', 'Ни один известный менеджер не встретился в файле продаж — все факты записаны с менеджером "Не определён"', null);
  }

  return { region, facts, collector };
}

module.exports = { parseSalesFacts };
