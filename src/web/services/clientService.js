'use strict';

const { PrismaClient } = require('@prisma/client');
const { getClientPlanFacts } = require('./clientPlanService');
const { addMonths } = require('./salesMonths');
const { OIL_BRANDS } = require('./taskBrandMapping');

const prisma = new PrismaClient();
const PAGE_SIZE = 30;

// ТЗ PHA-88 3.3: окно и порог "регулярности" SKU.
const DROPPED_SKU_WINDOW_MONTHS = 6;
const DROPPED_SKU_MIN_MONTHS = 4;

// PHA-85: фиксированный набор меток заметки -- строго эти три, не выдумывать
// новые (см. ТЗ задачи). Порядок здесь -- порядок в select на форме.
const NOTE_TAGS = ['Задолженность', 'Договорённость', 'Витрина'];

// PHA-83: цвет строго по факту закупа текущего месяца (EUR), не по % плана.
function getFactColor(factEur) {
  if (factEur > 100) return 'green';
  if (factEur > 0) return 'orange';
  return 'red';
}

async function listClients({ managerIds, q, page = 1, color = null } = {}) {
  const where = {};
  if (managerIds) where.managerId = { in: managerIds };
  if (q) {
    where.OR = [{ name: { contains: q } }, { code: { contains: q } }];
  }

  const [clients, planFacts] = await Promise.all([
    prisma.client.findMany({
      where,
      include: { manager: true, debt: true, _count: { select: { missingInvoices: true } } },
    }),
    getClientPlanFacts(managerIds),
  ]);

  const colored = clients.map((c) => {
    const planEur = planFacts.planByClient.has(c.id) ? planFacts.planByClient.get(c.id) : null;
    // QA PHA-83: чистый возврат (сумма revenueEur за месяц отрицательна) --
    // это business-эквивалент "не закупал", а не отрицательная сумма. Клэмп
    // до 0 здесь, а не только в шаблоне, чтобы бейдж, цвет и % от плана были
    // согласованы (иначе бейдж показал бы "0 EUR", а % плана -- отрицательным).
    const factEur = Math.max(0, planFacts.factByClient.get(c.id) || 0);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      managerName: c.manager ? c.manager.name : null,
      isOverdue: c.debt ? c.debt.isOverdue : false,
      hasMissingInvoice: c._count.missingInvoices > 0,
      planEur,
      factEur,
      percent: planEur ? Math.round((factEur / planEur) * 100) : null,
      color: getFactColor(factEur),
    };
  });

  // Сортировка по убыванию факта закупа (PHA-83 п.2) и фильтр по цвету (п.3)
  // применяются до пагинации, т.к. цвет/факт считаются из planFacts, а не из
  // самой БД-выборки клиентов.
  const filtered = color ? colored.filter((c) => c.color === color) : colored;
  filtered.sort((a, b) => b.factEur - a.factEur);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return {
    items,
    month: planFacts.month,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  };
}

// ТЗ 6.4: реквизиты, скидки, статус ДЗ, сигнал "нет накладных", заметки.
// Индивидуальный план/факт клиента (PHA-79 п.3, расчётный -- см.
// clientPlanService.js) показывается в списке /clients, а не здесь: карточка
// клиента остаётся историей продаж, чтобы не дублировать один и тот же
// расчёт на двух экранах.
//
// Скидки на карточке -- только индивидуальные скидки ЭТОГО клиента
// (client.discounts, clientId != null в "Действующие скидки"). Региональная
// база (Discount с clientId: null) сюда намеренно не подмешивается: это
// одни и те же ~130 строк для всех клиентов региона, и раньше они
// перекрывали единичные индивидуальные скидки в списке, из-за чего на
// любой карточке было видно один и тот же набор "по региону 10%" (PHA-80,
// баг 1). Региональная база остаётся источником фолбэка для цены заказа
// (см. resolveDiscountPercent в pricing.js/catalogService.js/orderService.js)
// -- там её убирать нельзя, это отдельный экран/расчёт.
//
// PHA-88 Блок 3: раздел "История продаж" (плоский список месяц+бренд за
// текущий календарный год) заменён на "Продажи по брендам" -- см.
// getBrandYoyComparison/getDroppedSkus ниже, они читаются отдельно в роуте
// (не отсюда), т.к. зависят от выбранного в карточке месяца (query-параметр
// ?month=), а не от даты запроса.
async function getClientDetail(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      manager: true,
      addresses: true,
      discounts: true,
      debt: true,
      missingInvoices: true,
    },
  });
  if (!client) return null;

  // Помечаем истёкшие индивидуальные скидки (validUntil < сегодня), а не
  // просто выводим их как активные: `resolveDiscountPercent` в pricing.js
  // отбрасывает такие при расчёте цены заказа по той же логике
  // (`!validUntil || validUntil >= asOf`), так что без пометки карточка
  // расходилась бы с тем, что реально применится к заказу (QA PHA-80).
  // Активные -- сверху, истёкшие -- внизу, чтобы актуальное было видно сразу.
  const now = new Date();
  const isActive = (d) => !d.validUntil || d.validUntil >= now;
  client.discounts = client.discounts
    .map((d) => ({ ...d, isExpired: !isActive(d) }))
    .sort((a, b) => Number(a.isExpired) - Number(b.isExpired));

  return { client };
}

// ТЗ PHA-88 3.1: продажи по брендам для выбранного месяца карточки клиента,
// с сравнением к тому же месяцу прошлого года. `hasBase` -- есть ли вообще
// данные за месяц-год-назад (для месяцев 2025 года пары за 2024 нет, ТЗ
// прямо просит показать "нет базы", а не 0/100% отставания). Определяется
// по реальному минимуму месяца в SaleSku, а не хардкодом "2025" -- если ETL
// когда-нибудь подгрузит более раннюю историю, порог сдвинется сам.
//
// Список брендов в строке -- объединение брендов текущего месяца и брендов
// того же месяца год назад (а не "все бренды когда-либо купленные"), чтобы
// таблица отражала именно два сравниваемых периода, как просит ТЗ.
//
// PHA-89: масляные бренды (OIL_BRANDS, тот же список что и в PHA-84/2.1
// отчёте 2.2) дополнительно показывают объём в литрах за оба периода --
// у остальных брендов currentVolumeL/lastYearVolumeL остаются null (пусто).
// Сравнение/отклонение и фильтр Прирост/Отставание по-прежнему считаются
// только по EUR -- литры здесь чисто справочные, без своего % отклонения.
async function getBrandYoyComparison(clientId, month) {
  const lastYearMonth = addMonths(month, -12);

  const [minMonthAgg, currentRows] = await Promise.all([
    prisma.saleSku.aggregate({ _min: { month: true } }),
    prisma.saleSku.groupBy({ by: ['brand'], where: { clientId, month }, _sum: { revenueEur: true, volumeL: true } }),
  ]);
  const hasBase = !!minMonthAgg._min.month && lastYearMonth >= minMonthAgg._min.month;

  const lastYearRows = hasBase
    ? await prisma.saleSku.groupBy({
        by: ['brand'],
        where: { clientId, month: lastYearMonth },
        _sum: { revenueEur: true, volumeL: true },
      })
    : [];

  const currentByBrand = new Map(currentRows.map((r) => [r.brand, { eur: r._sum.revenueEur || 0, volumeL: r._sum.volumeL || 0 }]));
  const lastYearByBrand = new Map(lastYearRows.map((r) => [r.brand, { eur: r._sum.revenueEur || 0, volumeL: r._sum.volumeL || 0 }]));
  const brands = new Set([...currentByBrand.keys(), ...lastYearByBrand.keys()]);

  const rows = [...brands].map((brand) => {
    const isOilBrand = OIL_BRANDS.includes(brand);
    const currentEur = currentByBrand.get(brand)?.eur || 0;
    const currentVolumeL = isOilBrand ? currentByBrand.get(brand)?.volumeL || 0 : null;
    if (!hasBase) {
      return {
        brand,
        currentEur,
        currentVolumeL,
        lastYearEur: null,
        lastYearVolumeL: null,
        deviationEur: null,
        deviationPercent: null,
        isNew: false,
        direction: null,
      };
    }
    const lastYearEur = lastYearByBrand.get(brand)?.eur || 0;
    const lastYearVolumeL = isOilBrand ? lastYearByBrand.get(brand)?.volumeL || 0 : null;
    const deviationEur = currentEur - lastYearEur;
    // ТЗ 3.1: прошлый год = 0 -> "новый" вместо %. ТЗ 3.2: "новые" бренды
    // (не было в прошлом году) считаются приростом.
    const isNew = lastYearEur === 0 && currentEur > 0;
    const deviationPercent = lastYearEur !== 0 ? (deviationEur / lastYearEur) * 100 : null;
    const direction = deviationEur > 0 ? 'up' : deviationEur < 0 ? 'down' : null;
    return { brand, currentEur, currentVolumeL, lastYearEur, lastYearVolumeL, deviationEur, deviationPercent, isNew, direction };
  });

  rows.sort((a, b) => b.currentEur - a.currentEur);
  return { rows, hasBase, month, lastYearMonth };
}

// ТЗ PHA-88 3.3: "выпавшие" регулярные SKU клиента на выбранный месяц
// карточки. Регулярный = закуп (revenueEur > 0) в >= 4 из 6 полных месяцев
// перед выбранным (окно НЕ включает сам выбранный месяц). Выпавший =
// регулярный SKU без закупа в выбранном месяце. Потеря = средний закуп по
// месяцам окна, где он был (не по всем 6 -- иначе "средний закуп" занижался
// бы для SKU с меньшим числом закупов внутри порога регулярности).
async function getDroppedSkus(clientId, month) {
  const windowStart = addMonths(month, -DROPPED_SKU_WINDOW_MONTHS);
  const windowEnd = addMonths(month, -1); // последний полный месяц перед выбранным

  const windowRows = await prisma.saleSku.groupBy({
    by: ['sku', 'brand', 'productGroup', 'month'],
    where: { clientId, month: { gte: windowStart, lte: windowEnd } },
    _sum: { revenueEur: true },
  });

  // QA PHA-88 (Мелочь): brand/productGroup берутся из строки с самым
  // поздним month внутри окна для этого SKU, а не из первой попавшейся --
  // на ~0.05% SKU в реальных данных 1С меняет brand/productGroup у того же
  // артикула между месяцами (пересортировка номенклатуры), и карточка
  // должна показывать актуальную метку, а не произвольную из ответа БД
  // (groupBy не гарантирует порядок строк). На сумму потери/число месяцев
  // закупа это не влияет -- они считаются по revenueEur/month, не по
  // group/brand.
  const bySku = new Map(); // sku -> { brand, productGroup, labelMonth, purchases: [{month, revenueEur}] }
  for (const r of windowRows) {
    const revenueEur = r._sum.revenueEur || 0;
    if (revenueEur <= 0) continue; // "покупал" -- закуп строго > 0
    if (!bySku.has(r.sku)) {
      bySku.set(r.sku, { brand: r.brand, productGroup: r.productGroup, labelMonth: r.month, purchases: [] });
    }
    const entry = bySku.get(r.sku);
    if (r.month > entry.labelMonth) {
      entry.brand = r.brand;
      entry.productGroup = r.productGroup;
      entry.labelMonth = r.month;
    }
    entry.purchases.push({ month: r.month, revenueEur });
  }

  const regularSkus = [...bySku.entries()].filter(([, v]) => v.purchases.length >= DROPPED_SKU_MIN_MONTHS);
  if (regularSkus.length === 0) return { rows: [] };

  const currentMonthRows = await prisma.saleSku.groupBy({
    by: ['sku'],
    where: { clientId, month, sku: { in: regularSkus.map(([sku]) => sku) } },
    _sum: { revenueEur: true },
  });
  const currentBySku = new Map(currentMonthRows.map((r) => [r.sku, r._sum.revenueEur || 0]));

  const dropped = regularSkus
    .filter(([sku]) => (currentBySku.get(sku) || 0) <= 0)
    .map(([sku, v]) => {
      const totalRevenue = v.purchases.reduce((sum, p) => sum + p.revenueEur, 0);
      const lossEur = totalRevenue / v.purchases.length;
      const lastMonth = v.purchases.reduce((max, p) => (p.month > max ? p.month : max), v.purchases[0].month);
      return {
        sku,
        brand: v.brand,
        productGroup: v.productGroup,
        monthsBought: v.purchases.length,
        lastMonth,
        lossEur,
      };
    });

  dropped.sort((a, b) => b.lossEur - a.lossEur);
  return { rows: dropped };
}

// Лёгкая выборка клиента без тяжёлых include -- для заголовка экрана заметок
// и для проверки прав доступа (managerId), без загрузки скидок/ДЗ/истории.
async function getClientBasic(clientId) {
  return prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, code: true, managerId: true },
  });
}

// PHA-85 п.2 / PHA-87 п.4: невыполненные -- сверху, выполненные -- вниз (вне
// зависимости от pinned/даты), внутри каждой группы -- закреплённые сверху,
// затем по дате создания (новые сверху). SQLite сортирует boolean как 0/1,
// поэтому 'desc' кладёт true (1) перед false (0); done сортируется по
// возрастанию (false=0 перед true=1), чтобы невыполненные шли первыми.
//
// QA PHA-85: author.manager подтягивается вложенно, чтобы шаблон мог
// показать имя менеджера, а не технический username (author.manager
// пусто для RUKOVODITEL/ADMIN -- у них его и нет; шаблон делает фолбэк
// на username для этого случая).
async function getClientNotes(clientId) {
  return prisma.note.findMany({
    where: { clientId },
    include: { author: { include: { manager: true } } },
    orderBy: [{ done: 'asc' }, { pinned: 'desc' }, { createdAt: 'desc' }],
  });
}

async function addNote(clientId, authorId, text, tag, pinned) {
  return prisma.note.create({
    data: {
      clientId,
      authorId,
      text,
      tag: NOTE_TAGS.includes(tag) ? tag : null,
      pinned: !!pinned,
    },
  });
}

// PHA-86: удаление не привязано к автору -- право проверяется на уровне
// роута через checkClientAccess (клиент относится к менеджеру), а не здесь.
// `clientId` в where -- защита от удаления чужой заметки по id, если noteId
// подобран/подставлен для другого клиента.
async function deleteNote(clientId, noteId) {
  const result = await prisma.note.deleteMany({ where: { id: noteId, clientId } });
  return result.count > 0;
}

// PHA-87: право на переключение "выполнено" -- то же самое, что и на
// удаление (проверяется на уровне роута через checkClientAccess), не
// привязано к автору заметки. `clientId` в where -- та же защита от
// подмены noteId чужого клиента, что и в deleteNote.
async function setNoteDone(clientId, noteId, done) {
  const result = await prisma.note.updateMany({ where: { id: noteId, clientId }, data: { done } });
  return result.count > 0;
}

module.exports = {
  listClients,
  getClientDetail,
  getClientBasic,
  getClientNotes,
  addNote,
  deleteNote,
  setNoteDone,
  NOTE_TAGS,
  getBrandYoyComparison,
  getDroppedSkus,
};
