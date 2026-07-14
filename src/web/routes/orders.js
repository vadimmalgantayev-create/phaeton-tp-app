'use strict';

const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { getOrCreateDraftOrder, addLine, setLineQuantity, getOrderDetail } = require('../services/orderService');
const { exportOrderToTemplate } = require('../../exportOrderTemplate');
const { visibleManagerIds } = require('../auth/scope');

const prisma = new PrismaClient();
const router = express.Router();

async function assertClientAccess(req, res, clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  const managerIds = visibleManagerIds(req.user);
  if (!client || (managerIds && !managerIds.includes(client.managerId))) {
    res.status(403).send('Недостаточно прав для этого клиента');
    return null;
  }
  return client;
}

async function assertOrderAccess(req, res, orderId) {
  const data = await getOrderDetail(orderId);
  if (!data) {
    res.status(404).send('Заказ не найден');
    return null;
  }
  const managerIds = visibleManagerIds(req.user);
  if (managerIds && !managerIds.includes(data.order.client.managerId)) {
    res.status(403).send('Недостаточно прав для этого заказа');
    return null;
  }
  return data;
}

router.get('/orders/new', async (req, res, next) => {
  try {
    const clientId = Number(req.query.clientId);
    const client = await assertClientAccess(req, res, clientId);
    if (!client) return;

    const order = await getOrCreateDraftOrder(clientId, req.user.sub);
    if (req.query.productId) {
      const quantity = Math.max(1, Number(req.query.quantity) || 1);
      await addLine(order.id, Number(req.query.productId), quantity);
    }
    res.redirect(`/orders/${order.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const data = await assertOrderAccess(req, res, Number(req.params.id));
    if (!data) return;
    res.render('orderDetail', { ...data, user: req.user });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:orderId/lines/:lineId', async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    const data = await assertOrderAccess(req, res, orderId);
    if (!data) return;
    const quantity = Number(req.body.quantity) || 0;
    await setLineQuantity(Number(req.params.lineId), quantity);
    res.redirect(`/orders/${orderId}`);
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id/export', async (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const data = await assertOrderAccess(req, res, orderId);
    if (!data) return;
    if (data.lines.length === 0) return res.status(400).send('В заказе нет позиций');

    const lines = data.lines.map((l) => ({
      brand: l.brand,
      article: l.article,
      quantity: l.quantity,
      clientPrice: l.clientPrice,
      supplierPrice: l.supplierPrice,
    }));

    const outputPath = path.join(os.tmpdir(), `order-${orderId}-${Date.now()}.xlsx`);
    exportOrderToTemplate(lines, outputPath);

    await prisma.order.update({ where: { id: orderId }, data: { status: 'exported', exportedAt: new Date() } });

    res.download(outputPath, `order-${orderId}.xlsx`, (err) => {
      fs.unlink(outputPath, () => {});
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
