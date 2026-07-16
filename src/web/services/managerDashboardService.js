'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ТЗ 6.11 (базовый уровень MVP) + PHA-82: сводный план/факт по команде + ДЗ
// по региону. regionId === null -> без фильтра (ADMIN, весь портфель);
// regionId задан -> только ТП этого региона (RUKOVODITEL, см. scope.js).
async function getManagerDashboard(regionId = null) {
  const month = startOfMonth(new Date());

  const managers = await prisma.manager.findMany({
    where: regionId != null ? { regionId } : {},
    include: { region: true },
    orderBy: { name: 'asc' },
  });
  const managerIds = managers.map((m) => m.id);

  const [revenueByManager, plansByManager, debtsByRegion, clientsWithoutRegion] = await Promise.all([
    prisma.salesFact.groupBy({ by: ['managerId'], where: { month, managerId: { in: managerIds } }, _sum: { revenueEur: true } }),
    prisma.plan.findMany({ where: { taskType: 'TOTAL', managerId: { in: managerIds } } }),
    prisma.debt.findMany({
      where: { isOverdue: true, client: { managerId: { in: managerIds } } },
      include: { client: { include: { manager: { include: { region: true } } } } },
    }),
    // ТЗ PHA-82 "не терять молча": клиенты без менеджера (а значит и без
    // региона) не попадают ни в один region-scoped кабинет руководителя --
    // показываем счётчик в общем (нефильтрованном, т.е. ADMIN) виде, а не
    // прячем факт их существования.
    regionId == null ? prisma.client.count({ where: { managerId: null } }) : Promise.resolve(null),
  ]);

  const revenueMap = new Map(revenueByManager.map((r) => [r.managerId, r._sum.revenueEur || 0]));
  const planMap = new Map(plansByManager.map((p) => [p.managerId, p]));

  const team = managers.map((m) => {
    const actual = revenueMap.get(m.id) || 0;
    const plan = planMap.get(m.id);
    const planValue = plan ? plan.planValue : null;
    return {
      managerId: m.id,
      managerName: m.name,
      regionName: m.region ? m.region.name : null,
      actual,
      plan: planValue,
      unit: plan ? plan.unit : 'EUR',
      percent: planValue ? Math.round((actual / planValue) * 100) : null,
    };
  });

  const regionDebt = new Map();
  for (const d of debtsByRegion) {
    const regionName = d.client.manager && d.client.manager.region ? d.client.manager.region.name : 'Без региона';
    regionDebt.set(regionName, (regionDebt.get(regionName) || 0) + d.totalDebt);
  }

  const teamTotals = {
    actual: team.reduce((sum, t) => sum + t.actual, 0),
    plan: team.reduce((sum, t) => sum + (t.plan || 0), 0),
  };
  teamTotals.percent = teamTotals.plan ? Math.round((teamTotals.actual / teamTotals.plan) * 100) : null;

  return {
    month,
    team,
    teamTotals,
    regionDebt: Array.from(regionDebt.entries()).map(([regionName, total]) => ({ regionName, total })),
    clientsWithoutRegion,
  };
}

module.exports = { getManagerDashboard };
