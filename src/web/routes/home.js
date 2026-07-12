'use strict';

const express = require('express');
const { getDashboardData } = require('../services/dashboardService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await getDashboardData();
    res.render('home', data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
