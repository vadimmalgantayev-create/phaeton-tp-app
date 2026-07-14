'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const HISTORY_MONTHS = 4;

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ТЗ PHA-79 п.3: план менеджера на текущий месяц делится между клиентами
// пропорционально их доле в продажах менеджера (EUR) за последние 4 полных
// месяца перед текущим (rangeStart..rangeEnd, rangeEnd исключён -- это и
// есть текущий месяц). Клиент без истории продаж в этом окне получает
// planEur = null ("план не рассчитан"), а не 0 -- 0 означало бы "план есть,
// но нулевой", что не то же самое, что "не из чего считать долю".
async function getClientPlanFacts(managerIds, month = startOfMonth(new Date())) {
  const rangeEnd = month;
  const rangeStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - HISTORY_MONTHS, 1));
  const managerFilter = managerIds ? { managerId: { in: managerIds } } : {};

  const [historySales, currentSales, totalPlans] = await Promise.all([
    prisma.salesFact.groupBy({
      by: ['clientId', 'managerId'],
      where: { ...managerFilter, month: { gte: rangeStart, lt: rangeEnd } },
      _sum: { revenueEur: true },
    }),
    prisma.salesFact.groupBy({
      by: ['clientId'],
      where: { ...managerFilter, month },
      _sum: { revenueEur: true },
    }),
    prisma.plan.findMany({ where: { ...managerFilter, taskType: 'TOTAL' } }),
  ]);

  const managerTotalPlan = new Map(totalPlans.map((p) => [p.managerId, p.planValue]));
  const managerTotalSales = new Map();
  for (const row of historySales) {
    managerTotalSales.set(row.managerId, (managerTotalSales.get(row.managerId) || 0) + (row._sum.revenueEur || 0));
  }

  const planByClient = new Map();
  for (const row of historySales) {
    const managerTotal = managerTotalSales.get(row.managerId) || 0;
    if (managerTotal <= 0) continue;
    const share = (row._sum.revenueEur || 0) / managerTotal;
    const totalPlanValue = managerTotalPlan.get(row.managerId) || 0;
    planByClient.set(row.clientId, share * totalPlanValue);
  }

  const factByClient = new Map(currentSales.map((row) => [row.clientId, row._sum.revenueEur || 0]));

  return { planByClient, factByClient, month, rangeStart, rangeEnd };
}

module.exports = { getClientPlanFacts, startOfMonth };
