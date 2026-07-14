'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const PAGE_SIZE = 30;

async function listClients({ managerIds, q, page = 1 } = {}) {
  const where = {};
  if (managerIds) where.managerId = { in: managerIds };
  if (q) {
    where.OR = [{ name: { contains: q } }, { code: { contains: q } }];
  }

  const [total, clients] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      include: { manager: true, debt: true, _count: { select: { missingInvoices: true } } },
      orderBy: { name: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return {
    items: clients.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      managerName: c.manager ? c.manager.name : null,
      isOverdue: c.debt ? c.debt.isOverdue : false,
      hasMissingInvoice: c._count.missingInvoices > 0,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

// ТЗ 6.4: реквизиты, скидки, статус ДЗ, сигнал "нет накладных", история
// продаж, заметки. Клиент-специфичного плана в данных нет (Plan/AcbPlan
// хранятся только на уровне менеджера) -- показываем факт (историю продаж),
// а не план/факт по клиенту: додумывать несуществующий клиентский план
// было бы додумыванием бизнес-данных, которых нет ни в ТЗ, ни в источниках.
async function getClientDetail(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      manager: true,
      addresses: true,
      discounts: true,
      debt: true,
      missingInvoices: true,
      notes: { include: { author: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!client) return null;

  const regionDefaults = client.manager
    ? await prisma.discount.findMany({ where: { regionId: client.manager.regionId, clientId: null } })
    : [];

  const salesHistory = await prisma.salesFact.findMany({
    where: { clientId },
    orderBy: { month: 'desc' },
    take: 12,
  });

  return { client, regionDefaults, salesHistory };
}

async function addNote(clientId, authorId, text) {
  return prisma.note.create({ data: { clientId, authorId, text } });
}

module.exports = { listClients, getClientDetail, addNote };
