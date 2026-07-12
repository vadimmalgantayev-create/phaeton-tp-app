'use strict';

const XLSX = require('xlsx');

const TEMPLATE_HEADER = ['Бренд', 'Артикул', 'Количество', 'Цена клиента', 'Цена поставщика'];

/**
 * Writes an xlsx matching "шаблон загрузки формирование заказа.xlsx"
 * (ТЗ 4.8/6.5): Бренд, Артикул, Количество, Цена клиента, Цена поставщика.
 *
 * ⚑ Открытый вопрос ТЗ 7.1: у прайса нет явной колонки себестоимости, так
 * что источник "Цены поставщика" не определён документом. Здесь как
 * допущение по умолчанию берётся "Цена без скидки" (priceGross) из
 * прайс-листа — это ближайший доступный аналог оптовой/базовой цены. Нужно
 * заменить на реальную себестоимость после согласования с заказчиком.
 *
 * @param {{brand:string, article:string, quantity:number, clientPrice:number, supplierPrice:number}[]} lines
 * @param {string} outputPath
 */
function exportOrderToTemplate(lines, outputPath) {
  const data = [TEMPLATE_HEADER, ...lines.map((l) => [l.brand, l.article, l.quantity, l.clientPrice, l.supplierPrice])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Лист_1');
  XLSX.writeFile(wb, outputPath);
  return outputPath;
}

module.exports = { exportOrderToTemplate, TEMPLATE_HEADER };
