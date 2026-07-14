'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ТЗ 6.8: центр уведомлений -- "нет накладных" и просрочка. Оба сигнала уже
// материализованы в БД (MissingInvoice/Debt.isOverdue), отдельная таблица
// уведомлений/read-статуса в MVP не заведена: показываем текущее состояние
// как есть, а не журнал прочитанных оповещений (открытый продуктовый вопрос).
async function listNotifications(managerIds) {
  const managerFilter = managerIds ? { managerId: { in: managerIds } } : {};
  const clientManagerFilter = managerIds ? { client: { managerId: { in: managerIds } } } : {};

  const [overdueDebts, missingInvoices] = await Promise.all([
    prisma.debt.findMany({
      where: { isOverdue: true, ...clientManagerFilter },
      include: { client: true },
      orderBy: { totalDebt: 'desc' },
    }),
    prisma.missingInvoice.findMany({
      where: managerFilter,
      include: { client: true },
    }),
  ]);

  const items = [
    ...overdueDebts.map((d) => ({
      type: 'overdue_debt',
      title: 'Просроченная задолженность',
      clientId: d.clientId,
      clientName: d.client.name,
      detail: `${Math.round(d.totalDebt).toLocaleString('ru-RU')}${d.nearestPaymentDate ? ', ближайший платёж ' + new Intl.DateTimeFormat('ru-RU').format(d.nearestPaymentDate) : ''}`,
    })),
    ...missingInvoices.map((m) => ({
      type: 'missing_invoice',
      title: 'Нет накладных',
      clientId: m.clientId,
      clientName: m.client.name,
      detail: m.orderRef,
    })),
  ];

  return items;
}

module.exports = { listNotifications };
