'use strict';

const { PrismaClient } = require('@prisma/client');
const { OIL_BRANDS } = require('./taskBrandMapping');
const { visibleManagerIds, visibleRegionId } = require('../auth/scope');

const prisma = new PrismaClient();
const PAGE_SIZE = 30;

// ТЗ PHA-88 Блок 2: "Отчёты" доступны ТП (свои данные) и руководителю (свой
// регион, с выбором менеджера или "все"). Собирает `where` для SaleSku ровно
// той же AND-комбинацией managerId/regionId, что уже устоялась в проекте
// для аналогичных экранов руководителя (см. QA PHA-82 в visitsService.js:
// managerId и regionId должны сужать выборку ОДНОВРЕМЕННО, а не через
// `else if`, иначе подставленный managerId в query мог бы обойти скоуп
// региона).
//
// TP: managerId всегда его собственный (visibleManagerIds -> [id]),
// query-параметр managerId игнорируется -- ТП не может выбирать чужого
// менеджера. RUKOVODITEL/ADMIN: managerId необязателен ("все" = не задан),
// regionId у RUKOVODITEL принудительно из сессии (visibleRegionId), у ADMIN
// свободен (не ограничен).
function buildReportWhere(user, month, queryManagerId) {
  const where = { month };
  const ownManagerIds = visibleManagerIds(user);
  if (ownManagerIds) {
    where.managerId = { in: ownManagerIds };
  } else if (queryManagerId) {
    where.managerId = queryManagerId;
  }
  const regionId = visibleRegionId(user);
  // Служебные "менеджеры" (Web, Разовый клиент, Сотрудник и т.п.,
  // Manager.isServiceAccount из PHA-88 Блок 1) не должны попадать в отчёт
  // "все ТП" -- иначе их продажи задваивают итог руководителя выше суммы
  // его настоящих ТП (нашлось на реальных данных: "Сотрудник" с продажами
  // числится в регионе Кар-Сити наравне с двумя реальными ТП). ТП сюда не
  // попадает в принципе -- войти под служебным менеджером нельзя (см.
  // auth.js: isServiceAccount проверяется на /login), поэтому фильтр нужен
  // только в ветке "нет собственного managerId", т.е. для RUKOVODITEL/ADMIN.
  if (!ownManagerIds) {
    where.manager = { isServiceAccount: false, ...(regionId ? { regionId } : {}) };
  }
  return where;
}

// Список менеджеров для выпадающего фильтра (только RUKOVODITEL/ADMIN --
// ТП не выбирает менеджера, см. buildReportWhere). Служебные учётки
// (Manager.isServiceAccount, PHA-88 Блок 1) исключены -- это не сотрудники.
async function getReportManagerOptions(user) {
  const ownManagerIds = visibleManagerIds(user);
  if (ownManagerIds) return [];
  const regionId = visibleRegionId(user);
  return prisma.manager.findMany({
    where: { isServiceAccount: false, ...(regionId ? { regionId } : {}) },
    orderBy: { name: 'asc' },
  });
}

// ТЗ 2.1: таблица клиентов за месяц, сортировка по EUR убыв., с пагинацией
// (тот же PAGE_SIZE=30, что и у /clients) -- "все" у руководителя по всему
// региону может дать тысячи клиентов, отдавать их одним списком нельзя.
async function getClientsPage(where, page = 1) {
  const skip = (page - 1) * PAGE_SIZE;
  const [rows, distinctClients, totalAgg] = await Promise.all([
    prisma.saleSku.groupBy({
      by: ['clientId'],
      where,
      _sum: { revenueEur: true },
      orderBy: { _sum: { revenueEur: 'desc' } },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.saleSku.findMany({ where, distinct: ['clientId'], select: { clientId: true } }),
    prisma.saleSku.aggregate({ where, _sum: { revenueEur: true } }),
  ]);

  const clients = await prisma.client.findMany({
    where: { id: { in: rows.map((r) => r.clientId) } },
    select: { id: true, name: true, code: true, manager: { select: { name: true } } },
  });
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const items = rows.map((r) => {
    const c = clientById.get(r.clientId);
    return {
      clientId: r.clientId,
      name: c ? c.name : `Клиент #${r.clientId}`,
      code: c ? c.code : null,
      managerName: c && c.manager ? c.manager.name : null,
      revenueEur: r._sum.revenueEur || 0,
    };
  });

  const total = distinctClients.length;
  return {
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    managerTotalEur: totalAgg._sum.revenueEur || 0,
  };
}

/** Проверяет, что clientId реально попадает в текущий скоуп отчёта (тот же
 * `where`, что и у видимого списка) -- используется в /reports/clients/expand,
 * чтобы нельзя было раскрыть детализацию по чужому клиенту, подставив
 * произвольный clientId в query (RBAC для AJAX-эндпоинта, не только для
 * страницы). Завязано на тот же `where`, что и getClientsPage, а не на
 * отдельную параллельную проверку -- меньше шансов разойтись.
 */
async function isClientInReportScope(where, clientId) {
  const count = await prisma.saleSku.count({ where: { ...where, clientId } });
  return count > 0;
}

/** Обобщённая версия isClientInReportScope для отчёта 2.2 (бренды): та же
 * идея (RBAC AJAX-раскрытия завязан на тот же `where`, что и видимый
 * список, а не на отдельную проверку), но параметризуемая -- 2.2 раскрывает
 * и по brand (уровень 1->2), и по brand+clientId одновременно (уровень
 * 2->3), а не только по clientId, как 2.1.
 */
async function isInReportScope(where, extra) {
  const count = await prisma.saleSku.count({ where: { ...where, ...extra } });
  return count > 0;
}

function withLiters(rows, key) {
  return rows.map((r) => ({ ...r, showLiters: OIL_BRANDS.includes(r[key]) }));
}

// Уровень 2: номенклатурные группы внутри клиента (ТЗ "клиент -> номенклатурная
// группа -> бренд -> артикул"). Группа агрегирует НЕСКОЛЬКО брендов --
// литры здесь не показываем (см. brandRows ниже), это было бы смешением
// единиц измерения разных брендов в одной сумме.
async function getGroupBreakdown(clientId, month) {
  const rows = await prisma.saleSku.groupBy({
    by: ['productGroup'],
    where: { clientId, month },
    _sum: { revenueEur: true },
    orderBy: { _sum: { revenueEur: 'desc' } },
  });
  return rows.map((r) => ({ productGroup: r.productGroup, revenueEur: r._sum.revenueEur || 0 }));
}

// Уровень 3: бренды внутри клиента+группы. Здесь строка -- уже один
// конкретный бренд, поэтому литры показываем для FUCHS/MaxPro1/AFINOL
// (ТЗ 2.1: "действующее правило приложения", то же самое, что PHA-84).
async function getBrandBreakdown(clientId, productGroup, month) {
  const rows = await prisma.saleSku.groupBy({
    by: ['brand'],
    where: { clientId, productGroup, month },
    _sum: { revenueEur: true, volumeL: true },
    orderBy: { _sum: { revenueEur: 'desc' } },
  });
  return withLiters(
    rows.map((r) => ({ brand: r.brand, revenueEur: r._sum.revenueEur || 0, volumeL: r._sum.volumeL || 0 })),
    'brand'
  );
}

// Уровень 4 (лист): артикулы внутри клиента+группы+бренда.
async function getSkuBreakdown(clientId, productGroup, brand, month) {
  const rows = await prisma.saleSku.groupBy({
    by: ['sku'],
    where: { clientId, productGroup, brand, month },
    _sum: { revenueEur: true, volumeL: true },
    orderBy: { _sum: { revenueEur: 'desc' } },
  });
  return withLiters(
    rows.map((r) => ({ sku: r.sku, brand, revenueEur: r._sum.revenueEur || 0, volumeL: r._sum.volumeL || 0 })),
    'brand'
  );
}

// Плоская выгрузка для Excel (ТЗ "Выгрузить в Excel", формирование в
// памяти) -- одна строка на (клиент, группа, бренд, артикул), а не свёрнутое
// дерево, каким его в моменте видит пользователь: раскрытое состояние
// экрана -- это UI-состояние конкретной сессии, а не то, что нужно
// зафиксировать в выгрузке; выгрузка должна быть полной и самодостаточной.
async function getClientsExportRows(where) {
  const rows = await prisma.saleSku.groupBy({
    by: ['clientId', 'productGroup', 'brand', 'sku'],
    where,
    _sum: { revenueEur: true, volumeL: true },
    orderBy: [{ clientId: 'asc' }],
  });
  const clients = await prisma.client.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } },
    select: { id: true, name: true, manager: { select: { name: true } } },
  });
  const clientById = new Map(clients.map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = clientById.get(r.clientId);
    return {
      managerName: c && c.manager ? c.manager.name : '—',
      clientName: c ? c.name : `Клиент #${r.clientId}`,
      productGroup: r.productGroup,
      brand: r.brand,
      sku: r.sku,
      revenueEur: r._sum.revenueEur || 0,
      volumeL: OIL_BRANDS.includes(r.brand) ? r._sum.volumeL || 0 : null,
    };
  });
}

// ТЗ 2.2: "Продажи по брендам" -- та же логика 2.1 (сортировка EUR убыв.,
// пагинация, ленивое раскрытие), но верхний уровень -- бренд, и без уровня
// "номенклатурная группа" (ТЗ 2.2 сама даёт только "бренд -> клиенты ->
// артикулы", в отличие от 4 уровней 2.1). Дополнительная колонка -- "доля
// бренда в обороте менеджера, %": знаменатель -- managerTotalEur, т.е.
// сумма по ВСЕМУ текущему скоупу `where` (менеджер/регион/месяц), а не по
// отдельному клиенту -- ТЗ прямо говорит "доля... в обороте МЕНЕДЖЕРА".
async function getBrandsPage(where, page = 1) {
  const skip = (page - 1) * PAGE_SIZE;
  const [rows, distinctBrands, totalAgg] = await Promise.all([
    prisma.saleSku.groupBy({
      by: ['brand'],
      where,
      _sum: { revenueEur: true, volumeL: true },
      orderBy: { _sum: { revenueEur: 'desc' } },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.saleSku.findMany({ where, distinct: ['brand'], select: { brand: true } }),
    prisma.saleSku.aggregate({ where, _sum: { revenueEur: true } }),
  ]);

  const managerTotalEur = totalAgg._sum.revenueEur || 0;
  const items = withLiters(
    rows.map((r) => {
      const revenueEur = r._sum.revenueEur || 0;
      return {
        brand: r.brand,
        revenueEur,
        volumeL: r._sum.volumeL || 0,
        percent: managerTotalEur ? (revenueEur / managerTotalEur) * 100 : null,
      };
    }),
    'brand'
  );

  const total = distinctBrands.length;
  return {
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    managerTotalEur,
  };
}

// Уровень 2 (ТЗ 2.2): клиенты внутри бренда, в рамках того же `where`, что
// и видимый список брендов (месяц/менеджер/регион) -- не "клиенты вообще",
// а именно те, что купили этот бренд в этом скоупе.
async function getBrandClientBreakdown(where, brand) {
  const rows = await prisma.saleSku.groupBy({
    by: ['clientId'],
    where: { ...where, brand },
    _sum: { revenueEur: true, volumeL: true },
    orderBy: { _sum: { revenueEur: 'desc' } },
  });
  const clients = await prisma.client.findMany({
    where: { id: { in: rows.map((r) => r.clientId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const showLiters = OIL_BRANDS.includes(brand);
  return rows.map((r) => ({
    clientId: r.clientId,
    name: nameById.get(r.clientId) || `Клиент #${r.clientId}`,
    revenueEur: r._sum.revenueEur || 0,
    volumeL: showLiters ? r._sum.volumeL || 0 : null,
  }));
}

// Уровень 3 (лист, ТЗ 2.2): артикулы внутри бренда+клиента, в рамках того
// же `where`, что и видимый список (не через productGroup -- 2.2 не
// раскрывает по группе, в отличие от 2.1).
async function getBrandClientSkuBreakdown(where, brand, clientId) {
  const rows = await prisma.saleSku.groupBy({
    by: ['sku'],
    where: { ...where, brand, clientId },
    _sum: { revenueEur: true, volumeL: true },
    orderBy: { _sum: { revenueEur: 'desc' } },
  });
  const showLiters = OIL_BRANDS.includes(brand);
  return rows.map((r) => ({
    sku: r.sku,
    revenueEur: r._sum.revenueEur || 0,
    volumeL: showLiters ? r._sum.volumeL || 0 : null,
  }));
}

// Плоская выгрузка для 2.2 (тот же принцип, что getClientsExportRows) --
// одна строка на (бренд, клиент, артикул).
async function getBrandsExportRows(where) {
  const rows = await prisma.saleSku.groupBy({
    by: ['brand', 'clientId', 'sku'],
    where,
    _sum: { revenueEur: true, volumeL: true },
    orderBy: [{ brand: 'asc' }],
  });
  const clients = await prisma.client.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } },
    select: { id: true, name: true, manager: { select: { name: true } } },
  });
  const clientById = new Map(clients.map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = clientById.get(r.clientId);
    return {
      managerName: c && c.manager ? c.manager.name : '—',
      brand: r.brand,
      clientName: c ? c.name : `Клиент #${r.clientId}`,
      sku: r.sku,
      revenueEur: r._sum.revenueEur || 0,
      volumeL: OIL_BRANDS.includes(r.brand) ? r._sum.volumeL || 0 : null,
    };
  });
}

// ТЗ 2.3: "Дебиторская задолженность" -- скоуп строится по Client, а не по
// SaleSku, как у 2.1/2.2: у Debt нет колонки `month` (см. `src/parsers/debt.js`
// и README "Известные ограничения") -- это текущий снимок 1С на момент
// последней загрузки, а не помесячная история, поэтому здесь нет и не может
// быть селектора месяца, в отличие от общего требования ТЗ Блок 2. То же
// самое (снимок, не помесячно) уже опирается вся остальная работа с долгами
// в проекте -- карточка клиента и дашборд руководителя/ТП (см.
// `dashboardService.js`, `managerDashboardService.js`, `clientDetail.ejs`) --
// поэтому это не новое допущение, а согласованность с уже принятым в
// продукте использованием этих данных.
function buildDebtReportWhere(user, queryManagerId) {
  const clientWhere = {};
  const ownManagerIds = visibleManagerIds(user);
  if (ownManagerIds) {
    clientWhere.managerId = { in: ownManagerIds };
  } else if (queryManagerId) {
    clientWhere.managerId = queryManagerId;
  }
  const regionId = visibleRegionId(user);
  if (!ownManagerIds) {
    clientWhere.manager = { isServiceAccount: false, ...(regionId ? { regionId } : {}) };
  }
  return clientWhere;
}

// Суммы бакетов старения (`src/parsers/debt.js: BUCKET_COLUMNS`) -- это
// ровно то, что 1С считает просроченной задолженностью (колонка "Итого" в
// исходном файле, `OVERDUE_TOTAL_COL`); значение этой колонки не хранится
// отдельным полем в Prisma-модели `Debt` (в отличие от `isOverdue`,
// производного от него флага), поэтому пересчитывается суммой бакетов --
// те же данные, что уже легли в БД, без новой бизнес-логики.
const DEBT_BUCKET_FIELDS = [
  'bucketUnder3d',
  'bucket3to7d',
  'bucket7to14d',
  'bucket14to30d',
  'bucket30to60d',
  'bucket60to90d',
  'bucket90to180d',
  'bucket180dTo1y',
  'bucket1to2y',
  'bucket2to3y',
  'bucketOver3y',
];

function overdueEurOf(debt) {
  return DEBT_BUCKET_FIELDS.reduce((sum, field) => sum + (debt[field] || 0), 0);
}

// ТЗ 2.3: клиенты текущего менеджера с задолженностью, сортировка по сумме
// убыв., итог. Раскрытие до документов не реализуется -- модель `Debt`
// хранит только клиентский уровень (`src/parsers/debt.js`: строки уровня
// "договор"/"заказ" читаются исключительно ради ближайшей даты платежа, их
// суммы никуда не сохраняются), документного уровня в данных нет -- ровно
// тот случай, который ТЗ само оговаривает ("если нет -- только клиентский
// список"). Клиенты без записи `Debt` (нет долга вообще) в список не
// попадают -- показывать сотни строк с нулём было бы шумом в отчёте про
// задолженность.
async function getDebtPage(clientWhere, page = 1) {
  const skip = (page - 1) * PAGE_SIZE;
  const debtWhere = { client: clientWhere };
  const [rows, total, totalAgg] = await Promise.all([
    prisma.debt.findMany({
      where: debtWhere,
      include: { client: { select: { id: true, name: true, code: true, manager: { select: { name: true } } } } },
      orderBy: { totalDebt: 'desc' },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.debt.count({ where: debtWhere }),
    prisma.debt.aggregate({ where: debtWhere, _sum: { totalDebt: true } }),
  ]);

  const items = rows.map((d) => ({
    clientId: d.client.id,
    name: d.client.name,
    code: d.client.code,
    managerName: d.client.manager ? d.client.manager.name : null,
    totalDebt: d.totalDebt,
    overdueEur: overdueEurOf(d),
    isOverdue: d.isOverdue,
    nearestPaymentDate: d.nearestPaymentDate,
  }));

  return {
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    managerTotalDebtEur: totalAgg._sum.totalDebt || 0,
  };
}

// Плоская выгрузка для 2.3 (тот же принцип, что getClientsExportRows/
// getBrandsExportRows) -- полный список по текущему скоупу, не только
// текущая страница.
async function getDebtExportRows(clientWhere) {
  const rows = await prisma.debt.findMany({
    where: { client: clientWhere },
    include: { client: { select: { name: true, manager: { select: { name: true } } } } },
    orderBy: { totalDebt: 'desc' },
  });
  return rows.map((d) => ({
    managerName: d.client.manager ? d.client.manager.name : '—',
    clientName: d.client.name,
    totalDebt: d.totalDebt,
    overdueEur: overdueEurOf(d),
    isOverdue: d.isOverdue,
    nearestPaymentDate: d.nearestPaymentDate,
  }));
}

module.exports = {
  buildReportWhere,
  getReportManagerOptions,
  getClientsPage,
  isClientInReportScope,
  isInReportScope,
  getGroupBreakdown,
  getBrandBreakdown,
  getSkuBreakdown,
  getClientsExportRows,
  getBrandsPage,
  getBrandClientBreakdown,
  getBrandClientSkuBreakdown,
  getBrandsExportRows,
  buildDebtReportWhere,
  getDebtPage,
  getDebtExportRows,
  PAGE_SIZE,
};
