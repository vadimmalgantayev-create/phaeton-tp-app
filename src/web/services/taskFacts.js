'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function saleSkuWhere(managerId, month, config) {
  const where = { managerId, month };
  if (config.brands) where.brand = { in: config.brands };
  else if (config.excludeBrands) where.brand = { notIn: config.excludeBrands };
  return where;
}

// Факт по оплачиваемой задаче за месяц: сумма revenueEur/volumeL (для
// денежных/литровых задач) или число уникальных активных клиентов (для АКБ,
// countClients: true -- "активная клиентская база" считается по клиентам,
// у которых есть ненулевые продажи в подходящих под задачу брендах).
//
// PHA-88: `quantity` (штучное количество) было полем SalesFact, но
// sale_sku.csv его не содержит (только объём/выручка, см. schema.prisma) --
// критерий "активный клиент" здесь остался на revenueEur/volumeL.
async function computeTaskActual(managerId, month, config) {
  const where = saleSkuWhere(managerId, month, config);

  if (config.countClients) {
    const rows = await prisma.saleSku.groupBy({
      by: ['clientId'],
      where,
      _sum: { revenueEur: true, volumeL: true },
    });
    return rows.filter((r) => (r._sum.revenueEur || 0) > 0 || (r._sum.volumeL || 0) > 0).length;
  }

  const agg = await prisma.saleSku.aggregate({ where, _sum: { revenueEur: true, volumeL: true } });
  return config.metric === 'volumeL' ? agg._sum.volumeL || 0 : agg._sum.revenueEur || 0;
}

// Разбивка факта задачи по клиентам за месяц (для экрана "кто закупился").
async function getTaskClientBreakdown(managerId, month, config) {
  const where = saleSkuWhere(managerId, month, config);
  const rows = await prisma.saleSku.groupBy({ by: ['clientId'], where, _sum: { revenueEur: true, volumeL: true } });

  const nonZero = rows.filter((r) => (r._sum.revenueEur || 0) > 0 || (r._sum.volumeL || 0) > 0);
  const clients = await prisma.client.findMany({
    where: { id: { in: nonZero.map((r) => r.clientId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(clients.map((c) => [c.id, c.name]));

  return nonZero
    .map((r) => ({
      clientId: r.clientId,
      clientName: nameById.get(r.clientId) || `Клиент #${r.clientId}`,
      amount: config.metric === 'volumeL' ? r._sum.volumeL || 0 : r._sum.revenueEur || 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

module.exports = { computeTaskActual, getTaskClientBreakdown };
