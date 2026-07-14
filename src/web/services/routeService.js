'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ТЗ 6.9: "маршрут на день". Источники данных (ETL из PHA-73) не содержат
// файла с плановым списком визитов на конкретный день -- только адреса
// клиентов с координатами и текстовое поле Client.route (территория/маршрут,
// например "ALM - Верх 5"). Открытый вопрос: как формируется дневной план
// визитов -- здесь взято рабочее допущение "весь портфель клиентов ТП с
// геокоординатами, сгруппированный по route", а не выдуманное расписание.
async function getTodayRoute(managerId) {
  const day = startOfDay(new Date());

  const clients = await prisma.client.findMany({
    where: { managerId, addresses: { some: { latitude: { not: null }, longitude: { not: null } } } },
    include: { addresses: true },
    orderBy: { route: 'asc' },
  });

  const visits = await prisma.routeVisit.findMany({ where: { managerId, day } });
  const visitByClient = new Map(visits.map((v) => [v.clientId, v]));

  return clients.map((c) => {
    const primaryAddress = c.addresses.find((a) => a.isPrimary) || c.addresses[0];
    const visit = visitByClient.get(c.id);
    return {
      clientId: c.id,
      clientName: c.name,
      route: c.route,
      city: primaryAddress ? primaryAddress.city : null,
      address: primaryAddress ? primaryAddress.deliveryAddress : null,
      latitude: primaryAddress ? primaryAddress.latitude : null,
      longitude: primaryAddress ? primaryAddress.longitude : null,
      visitedAt: visit ? visit.visitedAt : null,
    };
  });
}

async function checkIn(managerId, clientId, latitude, longitude) {
  const day = startOfDay(new Date());
  return prisma.routeVisit.upsert({
    where: { managerId_clientId_day: { managerId, clientId, day } },
    update: { visitedAt: new Date(), latitude, longitude },
    create: { managerId, clientId, day, visitedAt: new Date(), latitude, longitude },
  });
}

module.exports = { getTodayRoute, checkIn };
