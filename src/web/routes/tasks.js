'use strict';

const express = require('express');
const { getTaskClientsScreen } = require('../services/taskClientsService');

const router = express.Router();

// Кликабельные оплачиваемые задачи (PHA-79 п.2) доступны только ТП по
// собственным данным -- на дашборде руководителя (manager.js/manager.ejs)
// таких задач нет, это отдельный, командный экран план/факт.
router.get('/tasks/:taskKey', async (req, res, next) => {
  try {
    if (req.user.role !== 'TP' || !req.user.managerId) {
      return res.status(403).send('Доступно только для торговых представителей');
    }
    const data = await getTaskClientsScreen(req.user.managerId, req.params.taskKey);
    if (!data) return res.status(404).send('Задача не найдена');
    res.render('taskClients', { ...data, user: req.user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
