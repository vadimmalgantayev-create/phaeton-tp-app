'use strict';

/**
 * Resolves the discount percent to use for one (client, brand) pair per
 * ТЗ 6.6: индивидуальная скидка клиента -> базовая скидка региона -> без
 * скидки, and drops anything past its "Дата окончания скидки" (ТЗ 4.2/6.6:
 * "Истёкшие скидки... не применяются").
 *
 * @param {{brand:string, percent:number, validUntil:Date|null}[]} clientDiscounts
 * @param {{brand:string, percent:number, validUntil:Date|null}[]} regionDefaults
 * @param {string} brand
 * @param {Date} asOf
 */
function resolveDiscountPercent(clientDiscounts, regionDefaults, brand, asOf = new Date()) {
  const isActive = (d) => !d.validUntil || d.validUntil >= asOf;
  const clientMatch = clientDiscounts.find((d) => d.brand === brand && isActive(d));
  if (clientMatch) return clientMatch.percent;
  const regionMatch = regionDefaults.find((d) => d.brand === brand && isActive(d));
  if (regionMatch) return regionMatch.percent;
  return 0;
}

/**
 * Цена клиента = Цена (после "Общей скидки" прайса) × (1 − Скидка% / 100).
 *
 * ⚑ Открытый вопрос ТЗ 7.1: считать ли от "Цены без скидки" или уже от
 * "Цены" — раздел 4.1 того же документа прямо говорит "Клиентская скидка
 * применяется поверх" уже сниженной "Цены", это и взято здесь как рабочая
 * гипотеза; должно быть подтверждено заказчиком наравне с остальными
 * пунктами раздела 10.
 */
function computeClientPrice(product, discountPercent) {
  const base = product.priceNet ?? product.priceGross;
  if (base === null || base === undefined) return null;
  return round2(base * (1 - discountPercent / 100));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { resolveDiscountPercent, computeClientPrice };
