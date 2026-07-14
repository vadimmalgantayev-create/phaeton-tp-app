'use strict';

const express = require('express');
const { getManagerDashboard } = require('../services/managerDashboardService');
const { requireRole } = require('../auth/middleware');

const router = express.Router();

router.get('/manager', requireRole('RUKOVODITEL', 'ADMIN'), async (req, res, next) => {
  try {
    const data = await getManagerDashboard();
    res.render('manager', { ...data, user: req.user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
