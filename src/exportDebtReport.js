'use strict';

const XLSX = require('xlsx');

// ТЗ PHA-88 2.3. Тот же принцип, что exportClientsReport.js/exportBrandsReport.js
// (2.1/2.2): `xlsx` вместо названного в ТЗ "exceljs" -- см. README, весь
// остальной экспорт проекта уже на `xlsx`, новую зависимость под один экран
// не заводим.
// Без указания валюты в колонках -- в отличие от продаж (`revenueEur`),
// исходный файл ДЗ (`samples/ДЗ и просроченная задолженость.xlsx`) не
// маркирует валюту суммы долга явно (колонка "Долг" в 1С), а карточка
// клиента (`clientDetail.ejs`) уже показывает то же поле без единицы
// измерения -- здесь та же осторожность: не приписывать валюту, которой нет
// в данных.
const HEADER = ['Менеджер', 'Клиент', 'Задолженность', 'Просрочено', 'Ближайший платёж'];

function buildDebtReportWorkbookBuffer(rows) {
  const data = [
    HEADER,
    ...rows.map((r) => [
      r.managerName,
      r.clientName,
      Math.round(r.totalDebt * 100) / 100,
      Math.round(r.overdueEur * 100) / 100,
      r.nearestPaymentDate ? new Intl.DateTimeFormat('ru-RU').format(r.nearestPaymentDate) : '',
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Дебиторская задолженность');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildDebtReportWorkbookBuffer };
