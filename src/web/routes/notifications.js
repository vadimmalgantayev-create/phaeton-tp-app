'use strict';

const express = require('express');
const { listNotifications } = require('../services/notificationsService');
const { visibleManagerIds } = require('../auth/scope');

const router = express.Router();

router.get('/notifications', async (req, res, next) => {
  try {
    const items = await listNotifications(visibleManagerIds(req.user));
    res.render('notifications', { items, user: req.user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
