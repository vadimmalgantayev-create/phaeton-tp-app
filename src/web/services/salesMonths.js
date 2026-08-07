'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

/** "2026-07" -> Date(2026-07-01 UTC), или null. Тот же формат, что и колонка
 * `month` в sale_sku.csv (см. src/parsers/saleSku.js), только со стороны
 * query-параметра ?month= в вебе, а не CSV-строки -- отдельная маленькая
 * функция, а не общий импорт из парсера, чтобы не тянуть CSV-парсинг в
 * веб-слой ради одного regexp.
 */
function parseMonthKey(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Список месяцев (Date, первое число месяца, по убыванию), для которых
 * есть данные SaleSku -- используется и селектором месяца на карточке
 * клиента (PHA-88 Блок 3), и позже вкладкой "Отчёты" (Блок 2, ТЗ прямо
 * просит "список месяцев -- из имеющихся в данных" в обоих местах),
 * поэтому вынесено в общий модуль, а не задублировано на каждый экран.
 *
 * Реальный текущий календарный месяц всегда включён в список, даже если
 * для него ещё нет продаж (ТЗ "по умолчанию текущий месяц") -- иначе
 * дефолтное значение <select> на экране не совпадало бы ни с одним
 * <option>.
 */
async function getAvailableMonths() {
  const agg = await prisma.saleSku.aggregate({ _min: { month: true }, _max: { month: true } });
  const currentMonth = startOfMonth(new Date());
  let minMonth = agg._min.month || currentMonth;
  let maxMonth = agg._max.month || currentMonth;
  if (currentMonth > maxMonth) maxMonth = currentMonth;
  if (currentMonth < minMonth) minMonth = currentMonth;

  const months = [];
  let cur = maxMonth;
  while (cur >= minMonth) {
    months.push(cur);
    cur = addMonths(cur, -1);
  }
  return months;
}

module.exports = { getAvailableMonths, startOfMonth, addMonths, parseMonthKey, monthKey };
