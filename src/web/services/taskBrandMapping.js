'use strict';

// Предварительное сопоставление бренд -> оплачиваемая задача (PHA-79).
// В ТЗ нет явного списка "какие бренды входят в Мультибренд/WINKOD+AKIKA/
// Масло" -- это восстановлено анализом данных, а не выдумано:
//   - Plan.productGroup со weightPct > 0 (реально оплачиваемые задачи из
//     "Шаблон - бренды и группы"): "WINKOD + AKIKA" (EUR), "Масло" (LITERS),
//     "Мультибренд" (EUR).
//   - Бренды "WINKOD"/"AKIKA" в SalesFact.brand совпадают по названию с
//     задачей "WINKOD + AKIKA" напрямую.
//   - Бренды "Масло": среди LITERS-строк плана (FUCHS, TETA, MaxPro1,
//     AFINOL, WINKOD AF, АНТИФРИЗЫ) проверена доля товаров со словом
//     "масло" в названии каталога (Product.name): FUCHS 86/90, MaxPro1 9/9,
//     AFINOL 25/25 -- преимущественно масло, включены. TETA 0/14 масло
//     (11/14 антифриз) -- это охлаждающая жидкость, не масло, исключён.
//     WINKOD AF/АНТИФРИЗЫ (точные строки Plan.productGroup) в каталоге не
//     нашлись -- но реальный бренд антифриза в SalesFact/Product называется
//     "WINKOD_AF" (с подчёркиванием, не пробелом) и оборот у него есть
//     (проверено QA: ~372 776 EUR / ~477 831 л за загруженный период,
//     полностью антифриз/тосол по названиям товаров). Он тоже исключён из
//     OIL_BRANDS -- решение верное (это не масло), просто найден по факту
//     не через строку "WINKOD AF" из плана.
//   - "Мультибренд" -- задача-остаток: 40% (Мультибренд) + 20% (WINKOD+AKIKA)
//     + 20% (Масло) + 20% (АКБ) = 100% веса премии, т.е. по построению
//     покрывает весь EUR-оборот, не попавший в именованные бренд-задачи.
// ВАЖНО: это предположение, подлежащее подтверждению владельцем продукта --
// см. отчёт к PHA-79. Пока не подтверждено, каждый экран, использующий эту
// карту, помечает факт как "предварительный расчёт".
const OIL_BRANDS = ['FUCHS', 'MaxPro1', 'AFINOL'];
const WINKOD_AKIKA_BRANDS = ['WINKOD', 'AKIKA'];
const MULTIBRAND_EXCLUDED_BRANDS = [...WINKOD_AKIKA_BRANDS, ...OIL_BRANDS];

// Задачи, приходящие из Plan.productGroup (ключ -- точная строка из
// источника "Шаблон - бренды и группы").
const BRAND_TASK_CONFIGS = [
  {
    taskKey: 'winkod_akika',
    productGroup: 'WINKOD + AKIKA',
    name: 'WINKOD + AKIKA',
    metric: 'revenueEur',
    brands: WINKOD_AKIKA_BRANDS,
    preliminary: true,
  },
  {
    taskKey: 'oil',
    productGroup: 'Масло',
    name: 'Масло',
    metric: 'volumeL',
    brands: OIL_BRANDS,
    preliminary: true,
  },
  {
    taskKey: 'multibrand',
    productGroup: 'Мультибренд',
    name: 'Мультибренд',
    metric: 'revenueEur',
    excludeBrands: MULTIBRAND_EXCLUDED_BRANDS,
    preliminary: true,
  },
];

// АКБ (активная клиентская база) считается не по Plan.productGroup, а по
// отдельной модели AcbPlan -- задаётся напрямую по фиксированному ключу.
// "АКБ общий" не зависит от сопоставления брендов (считает активность по
// любому бренду), поэтому preliminary: false; "АКБ масло" использует тот же
// предварительный список OIL_BRANDS, что и задача "Масло".
const ACB_TASK_CONFIGS = [
  {
    taskKey: 'acb_total',
    name: 'АКБ общий (активная клиентская база)',
    metric: 'revenueEur',
    brands: null,
    countClients: true,
    preliminary: false,
  },
  {
    taskKey: 'acb_oil',
    name: 'АКБ масло',
    metric: 'volumeL',
    brands: OIL_BRANDS,
    countClients: true,
    preliminary: true,
  },
];

function getBrandTaskConfig(productGroup) {
  return BRAND_TASK_CONFIGS.find((c) => c.productGroup === productGroup) || null;
}

function getTaskConfigByKey(taskKey) {
  return (
    BRAND_TASK_CONFIGS.find((c) => c.taskKey === taskKey) ||
    ACB_TASK_CONFIGS.find((c) => c.taskKey === taskKey) ||
    null
  );
}

module.exports = {
  OIL_BRANDS,
  WINKOD_AKIKA_BRANDS,
  BRAND_TASK_CONFIGS,
  ACB_TASK_CONFIGS,
  getBrandTaskConfig,
  getTaskConfigByKey,
};
