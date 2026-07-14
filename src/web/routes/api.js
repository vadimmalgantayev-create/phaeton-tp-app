'use strict';

// ТЗ 3.3: локальное кэширование каталога/скидок/ДЗ/адресов/планов для
// офлайн-режима. Отдаёт JSON-снимок данных текущего ТП, который клиент
// (offline.js) кладёт в IndexedDB через Dexie. Не постраничный: сколько бы
// ни было позиций каталога, отдаём всё сразу -- одноразовая синхронизация
// по Wi-Fi/явному нажатию, а не постоянный трафик.
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { visibleManagerIds } = require('../auth/scope');

const prisma = new PrismaClient();
const router = express.Router();

router.get('/api/sync', async (req, res, next) => {
  try {
    if (req.user.role !== 'TP') return res.status(403).json({ error: 'Офлайн-синхронизация доступна только роли ТП' });
    const managerIds = visibleManagerIds(req.user);

    const [products, clients, plans, acbPlan] = await Promise.all([
      prisma.product.findMany({
        where: { isServiceRow: false },
        include: { stocks: true },
      }),
      prisma.client.findMany({
        where: { managerId: { in: managerIds } },
        include: { addresses: true, discounts: true, debt: true, missingInvoices: true, manager: true },
      }),
      prisma.plan.findMany({ where: { managerId: { in: managerIds } } }),
      prisma.acbPlan.findFirst({ where: { managerId: { in: managerIds } } }),
    ]);

    const manager = req.user.managerId ? await prisma.manager.findUnique({ where: { id: req.user.managerId } }) : null;
    const regionDefaults = manager
      ? await prisma.discount.findMany({ where: { regionId: manager.regionId, clientId: null } })
      : [];

    res.json({
      generatedAt: new Date().toISOString(),
      products: products.map((p) => ({
        id: p.id,
        article: p.article,
        brand: p.brand,
        name: p.name,
        priceGross: p.priceGross,
        priceNet: p.priceNet,
        stocks: p.stocks.map((s) => ({ warehouse: s.warehouse, quantity: s.quantity })),
      })),
      regionDefaults: regionDefaults.map((d) => ({ brand: d.brand, percent: d.percent, validUntil: d.validUntil })),
      clients: clients.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        route: c.route,
        addresses: c.addresses,
        discounts: c.discounts.map((d) => ({ brand: d.brand, percent: d.percent, validUntil: d.validUntil })),
        debt: c.debt,
        missingInvoiceCount: c.missingInvoices.length,
      })),
      plans,
      acbPlan,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
