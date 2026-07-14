'use strict';

const { PrismaClient } = require('@prisma/client');
const { getBrandTaskConfig, ACB_TASK_CONFIGS } = require('./taskBrandMapping');
const { computeTaskActual } = require('./taskFacts');

const prisma = new PrismaClient();

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

async function getDashboardData(managerId) {
  const month = startOfMonth(new Date());

  const manager = await prisma.manager.findUnique({ where: { id: managerId } });

  const [revenueAgg, totalPlan, weightedTasks, acbPlan, overdueDebts, missingInvoices] = await Promise.all([
    prisma.salesFact.aggregate({
      _sum: { revenueEur: true },
      where: { managerId, month },
    }),
    prisma.plan.findFirst({
      where: { managerId, taskType: 'TOTAL' },
    }),
    prisma.plan.findMany({
      where: { managerId, taskType: 'BRAND_GROUP', weightPct: { gt: 0 } },
      orderBy: { weightPct: 'desc' },
    }),
    prisma.acbPlan.findUnique({ where: { managerId } }),
    prisma.debt.findMany({
      where: { isOverdue: true, client: { managerId } },
      include: { client: true },
      orderBy: { totalDebt: 'desc' },
      take: 8,
    }),
    prisma.missingInvoice.findMany({
      where: { managerId },
      include: { client: true },
      take: 8,
    }),
  ]);

  const turnover = {
    actual: revenueAgg._sum.revenueEur || 0,
    plan: totalPlan ? totalPlan.planValue : null,
    unit: totalPlan ? totalPlan.unit : 'EUR',
  };
  turnover.percent = turnover.plan ? Math.round((turnover.actual / turnover.plan) * 100) : null;

  // "Оплачиваемые задачи" = строки плана с ненулевым весом в бонусе
  // (weightPct) — задачи с весом 0 в KPI не участвуют. Факт считается по
  // предварительному сопоставлению бренд→задача (см. taskBrandMapping.js,
  // PHA-79) — помечено mappingPreliminary, требует подтверждения владельца.
  const paidTasks = await Promise.all(
    weightedTasks.map(async (t) => {
      const config = getBrandTaskConfig(t.productGroup);
      const actual = config ? await computeTaskActual(managerId, month, config) : null;
      const percent = actual !== null && t.planValue ? Math.round((actual / t.planValue) * 100) : null;
      return {
        name: t.productGroup,
        weightPct: t.weightPct,
        planValue: t.planValue,
        unit: t.unit,
        actual,
        percent,
        taskKey: config ? config.taskKey : null,
        mappingPreliminary: config ? config.preliminary : false,
      };
    })
  );
  if (acbPlan) {
    for (const config of ACB_TASK_CONFIGS) {
      const planValue = config.taskKey === 'acb_total' ? acbPlan.acbTotal : acbPlan.acbOil;
      const actual = await computeTaskActual(managerId, month, config);
      paidTasks.push({
        name: config.name,
        weightPct: acbPlan.weightPct,
        planValue,
        unit: 'клиентов',
        actual,
        percent: planValue ? Math.round((actual / planValue) * 100) : null,
        taskKey: config.taskKey,
        mappingPreliminary: config.preliminary,
      });
    }
  }

  const attention = overdueDebts.map((d) => ({
    clientName: d.client.name,
    totalDebt: d.totalDebt,
    nearestPaymentDate: d.nearestPaymentDate,
  }));

  const missingInvoiceRisks = missingInvoices.map((m) => ({
    clientName: m.client.name,
    orderRef: m.orderRef,
    deliveryVariant: m.deliveryVariant,
  }));

  return {
    managerName: manager ? manager.name : null,
    month,
    turnover,
    paidTasks,
    attention,
    missingInvoiceRisks,
  };
}

module.exports = { getDashboardData };
