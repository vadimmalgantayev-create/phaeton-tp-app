'use strict';

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { listProducts, listBrands } = require('../services/catalogService');
const { visibleManagerIds } = require('../auth/scope');

const prisma = new PrismaClient();
const router = express.Router();

router.get('/catalog', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = (req.query.q || '').trim() || null;
    const brand = (req.query.brand || '').trim() || null;
    let clientId = req.query.clientId ? Number(req.query.clientId) : null;

    if (clientId) {
      const managerIds = visibleManagerIds(req.user);
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client || (managerIds && !managerIds.includes(client.managerId))) {
        clientId = null; // клиент не найден или не принадлежит текущему ТП — игнорируем параметр
      }
    }

    const [data, brands] = await Promise.all([
      listProducts({ q, brand, clientId, page }),
      listBrands(),
    ]);

    res.render('catalog', { ...data, q, brand, clientId, brands, user: req.user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
