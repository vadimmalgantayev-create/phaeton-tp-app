'use strict';

const XLSX = require('xlsx');

// ТЗ PHA-88 2.2. Тот же принцип, что exportClientsReport.js (2.1): `xlsx`
// вместо названного в ТЗ "exceljs" -- см. README, весь остальной экспорт
// проекта уже на `xlsx`, новую зависимость под один экран не заводим.
const HEADER = ['Менеджер', 'Бренд', 'Клиент', 'Артикул', 'Выручка, EUR', 'Литры'];

function buildBrandsReportWorkbookBuffer(rows) {
  const data = [
    HEADER,
    ...rows.map((r) => [
      r.managerName,
      r.brand,
      r.clientName,
      r.sku,
      Math.round(r.revenueEur * 100) / 100,
      r.volumeL === null ? '' : Math.round(r.volumeL * 100) / 100,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Продажи по брендам');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildBrandsReportWorkbookBuffer };
