'use strict';

const fs = require('fs');
const path = require('path');

// Daily 1C exports get re-dated filenames ("Загрузка_по_ТП_ИЮЛЬ_2026.xlsx"
// today, "...АВГУСТ_2026.xlsx" next month), so the loader locates each
// source by a normalized keyword match rather than an exact filename.
const SOURCE_KEYWORDS = {
  price_list: ['прайслист'],
  discounts: ['действующиескидки'],
  debt: ['задолженость', 'задолженность'],
  addresses: ['адресадоставки'],
  missing_invoices: ['наклодных', 'накладных'],
  // PHA-88: sales_facts.xlsx заменён на sale_sku.csv (см. schema.prisma,
  // модель SaleSku) — ключевое слово для старого источника больше не ищем.
  sale_sku: ['salessku'],
  plan: ['загрузкапотп'],
  order_template: ['шаблонзагрузкиформирование'],
};

function normalize(name) {
  // No NFKD here: it decomposes "й"/"Й" into "и" + a combining breve, which
  // the character-class strip below then drops, silently turning "й" into
  // "и" and breaking every keyword that contains it (e.g. "прайслист").
  return name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
}

function findSourceFile(dir, sourceType) {
  const keywords = SOURCE_KEYWORDS[sourceType];
  if (!keywords) throw new Error(`Unknown source type: ${sourceType}`);
  // PHA-88: sale_sku грузится из .csv (потоковый ETL), остальные источники
  // остаются .xlsx -- фильтр принимает оба расширения.
  const files = fs.readdirSync(dir).filter((f) => /\.(xlsx|csv)$/i.test(f));
  const match = files.find((f) => {
    const n = normalize(f);
    return keywords.some((kw) => n.includes(kw));
  });
  return match ? path.join(dir, match) : null;
}

module.exports = { findSourceFile, SOURCE_KEYWORDS };
