'use strict';

const express = require('express');
const { getDashboardData } = require('../services/dashboardService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'TP') return res.redirect('/manager');
    const data = await getDashboardData(req.user.managerId);
    res.render('home', { ...data, user: req.user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
