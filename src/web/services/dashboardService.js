'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Пока нет экрана входа (PHA-75 явно исключает логин из своей области —
// см. "ГРАНИЦЫ" в задаче), дашборд показывает данные одного ТП по
// фиксированному managerId. Это временное допущение: как только появится
// авторизация, currentManagerId должен браться из сессии пользователя, а не
// быть константой.
const PLACEHOLDER_MANAGER_ID = 11;

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

async function getDashboardData(managerId = PLACEHOLDER_MANAGER_ID) {
  const month = startOfMonth(new Date());

  const manager = await prisma.manager.findUnique({ where: { id: managerId } });

  const [revenueAgg, totalPlan, weightedTasks, acbPlan, overdueDebts] = await Promise.all([
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
  ]);

  const turnover = {
    actual: revenueAgg._sum.revenueEur || 0,
    plan: totalPlan ? totalPlan.planValue : null,
    unit: totalPlan ? totalPlan.unit : 'EUR',
  };
  turnover.percent = turnover.plan ? Math.round((turnover.actual / turnover.plan) * 100) : null;

  // "Оплачиваемые задачи" = строки плана с ненулевым весом в бонусе
  // (weightPct) — задачи с весом 0 в KPI не участвуют. Показываем цель и
  // вес каждой задачи (реальные данные из Plan/AcbPlan). Процент
  // фактического выполнения по бренд-группам здесь не считаем: это
  // требует бизнес-правил сопоставления productGroup ("Мультибренд",
  // "Масло" и т.п.) с конкретными брендами в продажах, которых в ТЗ нет —
  // открытый продуктовый вопрос, а не то, что можно додумать в коде.
  const paidTasks = weightedTasks.map((t) => ({
    name: t.productGroup,
    weightPct: t.weightPct,
    planValue: t.planValue,
    unit: t.unit,
  }));
  if (acbPlan) {
    paidTasks.push({
      name: 'АЦБ (активная клиентская база)',
      weightPct: acbPlan.weightPct,
      planValue: acbPlan.acbTotal,
      unit: 'клиентов',
    });
  }

  const attention = overdueDebts.map((d) => ({
    clientName: d.client.name,
    totalDebt: d.totalDebt,
    nearestPaymentDate: d.nearestPaymentDate,
  }));

  return {
    managerName: manager ? manager.name : null,
    month,
    turnover,
    paidTasks,
    attention,
  };
}

module.exports = { getDashboardData, PLACEHOLDER_MANAGER_ID };
