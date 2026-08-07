'use strict';

const XLSX = require('xlsx');

// ТЗ PHA-88 2.1: "Выгрузить в Excel". ТЗ называет библиотеку "exceljs", но
// весь остальной экспорт в проекте (exportVisitsReport.js,
// exportOrderTemplate.js) уже сделан на `xlsx` (SheetJS) -- новой
// зависимости под один экран не заводим, важна суть требования
// ("формирование в памяти", не конкретное имя пакета), а не буква.
const HEADER = ['Менеджер', 'Клиент', 'Группа', 'Бренд', 'Артикул', 'Выручка, EUR', 'Литры'];

function buildClientsReportWorkbookBuffer(rows) {
  const data = [
    HEADER,
    ...rows.map((r) => [
      r.managerName,
      r.clientName,
      r.productGroup,
      r.brand,
      r.sku,
      Math.round(r.revenueEur * 100) / 100,
      r.volumeL === null ? '' : Math.round(r.volumeL * 100) / 100,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Продажи по клиентам');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildClientsReportWorkbookBuffer };
