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

module.exports = {
  buildReportWhere,
  getReportManagerOptions,
  getClientsPage,
  isClientInReportScope,
  getGroupBreakdown,
  getBrandBreakdown,
  getSkuBreakdown,
  getClientsExportRows,
  PAGE_SIZE,
};
