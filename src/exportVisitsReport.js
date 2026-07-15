'use strict';

const XLSX = require('xlsx');

const HEADER = ['Регион', 'ТП', 'Клиент', 'Дата', 'Время', 'Гео', 'Расстояние до клиента, м'];

function formatDate(d) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d);
}

// PHA-81 QA: раньше время форматировалось в таймзоне процесса, а дата --
// явно в UTC (см. formatDate) -- у границы суток дата и время в одной
// строке могли относиться к разным календарным суткам и не совпадать ни с
// UTC, ни с честным локальным временем визита. `day`/`visitedAt` в БД
// оба привязаны к UTC-суткам (routeService.startOfDay), так что время тоже
// должно быть в UTC, а не в TZ процесса Node (которая на Render не зафиксирована).
function formatTime(d) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

// ТЗ PHA-81 ч.3: .xlsx собирается в памяти и отдаётся на скачивание --
// эфемерный диск Render всё стирает, поэтому файл никогда не пишется на
// диск сервера (см. также exportOrderTemplate.js, тот же принцип, но там
// это не требовалось явно и было решено писать в tmpdir на время скачивания).
function buildVisitsWorkbookBuffer(rows) {
  const data = [
    HEADER,
    ...rows.map((r) => [
      r.regionName,
      r.managerName,
      r.clientName,
      formatDate(r.day),
      formatTime(r.visitedAt),
      r.hasGeo ? 'да' : 'нет',
      r.distanceM == null ? '' : Math.round(r.distanceM),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Посещения');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildVisitsWorkbookBuffer };
