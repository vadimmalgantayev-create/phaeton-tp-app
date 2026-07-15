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

  // Клиент с чистым возвратом за окно (сумма revenueEur <= 0) не участвует в
  // делении плана -- отрицательная доля не имеет бизнес-смысла (нельзя
  // ставить сотруднику отрицательную цель по клиенту). Такой клиент
  // трактуется как "нет истории продаж" (ниже просто не попадает в
  // planByClient -> planEur = null), а не получает отрицательный/нулевой
  // план (QA PHA-79, репро: managerId=11, clientId=4701).
  const positiveHistory = historySales.filter((row) => (row._sum.revenueEur || 0) > 0);

  const managerTotalSales = new Map();
  for (const row of positiveHistory) {
    managerTotalSales.set(row.managerId, (managerTotalSales.get(row.managerId) || 0) + row._sum.revenueEur);
  }

  // planByClient.set() накапливает (+=), а не перезаписывает: один и тот же
  // clientId может встретиться под разными managerId в окне (клиент сменил
  // менеджера/территорию в течение 4 месяцев) -- вклад каждого менеджера
  // должен суммироваться, иначе один из них тихо теряется (QA PHA-79,
  // актуально для РУКОВОДИТЕЛЬ/АДМИН, где managerIds = null).
  const planByClient = new Map();
  for (const row of positiveHistory) {
    const managerTotal = managerTotalSales.get(row.managerId) || 0;
    if (managerTotal <= 0) continue;
    const share = row._sum.revenueEur / managerTotal;
    const totalPlanValue = managerTotalPlan.get(row.managerId) || 0;
    const contribution = share * totalPlanValue;
    planByClient.set(row.clientId, (planByClient.get(row.clientId) || 0) + contribution);
  }

  const factByClient = new Map(currentSales.map((row) => [row.clientId, row._sum.revenueEur || 0]));

  return { planByClient, factByClient, month, rangeStart, rangeEnd };
}

module.exports = { getClientPlanFacts, startOfMonth };
