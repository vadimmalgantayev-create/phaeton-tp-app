'use strict';

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { getTodayRoute, checkIn } = require('../services/routeService');
const { visibleManagerIds } = require('../auth/scope');

const prisma = new PrismaClient();
const router = express.Router();

router.get('/route', async (req, res, next) => {
  try {
    if (req.user.role !== 'TP') return res.status(403).send('Маршрут доступен только для роли ТП');
    const stops = await getTodayRoute(req.user.managerId);
    res.render('route', { stops, user: req.user });
  } catch (err) {
    next(err);
  }
});

// PHA-81 QA: без этой проверки любой ТП мог отметиться по чужому clientId
// (портфель другого менеджера) -- отчёт руководителя (ч.2 ТЗ) как раз должен
// ловить недобросовестные отметки, а не принимать их как честные "далеко от
// клиента". Та же проверка портфеля, что и в orders.js assertClientAccess.
router.post('/route/:clientId/checkin', express.json(), async (req, res, next) => {
  try {
    if (req.user.role !== 'TP') return res.status(403).json({ error: 'forbidden' });
    const clientId = Number(req.params.clientId);
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    const managerIds = visibleManagerIds(req.user);
    if (!client || (managerIds && !managerIds.includes(client.managerId))) {
      return res.status(403).json({ error: 'Клиент не в портфеле этого ТП' });
    }
    const { latitude, longitude } = req.body;
    await checkIn(req.user.managerId, clientId, latitude ?? null, longitude ?? null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
