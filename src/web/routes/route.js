'use strict';

const express = require('express');
const { getTodayRoute, checkIn } = require('../services/routeService');

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

router.post('/route/:clientId/checkin', express.json(), async (req, res, next) => {
  try {
    if (req.user.role !== 'TP') return res.status(403).json({ error: 'forbidden' });
    const { latitude, longitude } = req.body;
    await checkIn(req.user.managerId, Number(req.params.clientId), latitude ?? null, longitude ?? null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
