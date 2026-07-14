'use strict';

const express = require('express');
const { listClients, getClientDetail, addNote } = require('../services/clientService');
const { visibleManagerIds } = require('../auth/scope');

const router = express.Router();

router.get('/clients', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = (req.query.q || '').trim() || null;
    const data = await listClients({ managerIds: visibleManagerIds(req.user), q, page });
    res.render('clients', { ...data, q, user: req.user });
  } catch (err) {
    next(err);
  }
});

router.get('/clients/:id', async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    const data = await getClientDetail(clientId);
    if (!data) return res.status(404).send('Клиент не найден');

    const managerIds = visibleManagerIds(req.user);
    if (managerIds && !managerIds.includes(data.client.managerId)) {
      return res.status(403).send('Недостаточно прав для просмотра этого клиента');
    }

    res.render('clientDetail', { ...data, user: req.user });
  } catch (err) {
    next(err);
  }
});

router.post('/clients/:id/notes', async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    const data = await getClientDetail(clientId);
    if (!data) return res.status(404).send('Клиент не найден');

    const managerIds = visibleManagerIds(req.user);
    if (managerIds && !managerIds.includes(data.client.managerId)) {
      return res.status(403).send('Недостаточно прав для просмотра этого клиента');
    }

    const text = (req.body.text || '').trim();
    if (text) await addNote(clientId, req.user.sub, text);
    res.redirect(`/clients/${clientId}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
