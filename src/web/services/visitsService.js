'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ТЗ PHA-81 ч.2: порог "на месте" -- ориентир из ТЗ, не согласованное с
// заказчиком точное значение SLA.
const DISTANCE_OK_THRESHOLD_M = 150;

const PERIODS = ['day', 'week', 'month'];

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diffFromMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diffFromMonday);
  return d;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function periodRange(period, now = new Date()) {
  if (period === 'day') {
    const start = startOfDay(now);
    return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
  }
  if (period === 'week') {
    const start = startOfWeek(now);
    return { start, end: new Date(start.getTime() + 7 * 24 * 3600 * 1000) };
  }
  const start = startOfMonth(now);
  return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
}

// Общий фильтр для экрана и Excel-выгрузки (ч.2/ч.3 ТЗ должны видеть
// одинаковые строки под одними и теми же фильтрами/периодом).
async function queryVisits({ period, regionId, managerId, clientId } = {}) {
  const validPeriod = PERIODS.includes(period) ? period : 'month';
  const { start, end } = periodRange(validPeriod);

  const where = { day: { gte: start, lt: end }, visitedAt: { not: null } };
  if (managerId) where.managerId = managerId;
  else if (regionId) where.manager = { regionId };
  if (clientId) where.clientId = clientId;

  const visits = await prisma.routeVisit.findMany({
    where,
    include: { manager: { include: { region: true } }, client: true },
    orderBy: [{ day: 'desc' }, { visitedAt: 'desc' }],
  });

  const rows = visits.map((v) => ({
    id: v.id,
    regionName: v.manager.region ? v.manager.region.name : 'Без региона',
    managerName: v.manager.name,
    managerId: v.managerId,
    clientName: v.client.name,
    clientId: v.clientId,
    day: v.day,
    visitedAt: v.visitedAt,
    hasGeo: v.hasGeo,
    distanceM: v.distanceM,
  }));

  return { rows, period: validPeriod, start, end };
}

// Ч.2: иерархия фильтров Бизнес-регион -> ТП -> Клиент. Списки для
// выпадающих меню сужаются по уже выбранным родительским уровням.
async function getFilterOptions({ regionId, managerId } = {}) {
  const [regions, managers, clients] = await Promise.all([
    prisma.region.findMany({ orderBy: { name: 'asc' } }),
    prisma.manager.findMany({ where: regionId ? { regionId } : {}, orderBy: { name: 'asc' } }),
    prisma.client.findMany({
      where: managerId ? { managerId } : regionId ? { manager: { regionId } } : {},
      orderBy: { name: 'asc' },
      take: 1000,
    }),
  ]);
  return { regions, managers, clients };
}

async function getVisitsReport(filters = {}) {
  const [{ rows, period, start, end }, options] = await Promise.all([
    queryVisits(filters),
    getFilterOptions(filters),
  ]);
  return { rows, period, start, end, ...options, filters };
}

module.exports = { getVisitsReport, queryVisits, DISTANCE_OK_THRESHOLD_M, PERIODS };
