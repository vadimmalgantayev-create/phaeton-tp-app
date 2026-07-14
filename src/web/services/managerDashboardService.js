'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ТЗ 6.11 (базовый уровень MVP): сводный план/факт по команде + ДЗ по
// региону. RUKOVODITEL/ADMIN видят весь портфель (см. допущение в scope.js
// про отсутствие региона у пользователя-руководителя).
async function getManagerDashboard() {
  const month = startOfMonth(new Date());

  const managers = await prisma.manager.findMany({ include: { region: true }, orderBy: { name: 'asc' } });

  const [revenueByManager, plansByManager, debtsByRegion] = await Promise.all([
    prisma.salesFact.groupBy({ by: ['managerId'], where: { month }, _sum: { revenueEur: true } }),
    prisma.plan.findMany({ where: { taskType: 'TOTAL' } }),
    prisma.debt.findMany({
      where: { isOverdue: true },
      include: { client: { include: { manager: { include: { region: true } } } } },
    }),
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
  };
}

module.exports = { getManagerDashboard };
