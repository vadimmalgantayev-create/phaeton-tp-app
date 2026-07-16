'use strict';

const express = require('express');
const { listClients, getClientDetail, addNote } = require('../services/clientService');
const { visibleManagerIds } = require('../auth/scope');
const { requireRole } = require('../auth/middleware');

const router = express.Router();

const COLOR_VALUES = ['green', 'orange', 'red'];

// QA PHA-83: список /clients существует только для ТП (нет пункта меню и
// экрана под RUKOVODITEL/ADMIN -- см. partials/nav.ejs), но раньше не имел
// проверки роли на сервере. listClients грузит в память весь набор клиентов
// под `where` (не постранично из БД -- цвет/сортировка считаются из
// planFacts, не из колонки БД), а для RUKOVODITEL/ADMIN visibleManagerIds()
// возвращает null (без фильтра по менеджеру) -- то есть весь портфель
// компании (5488+ клиентов на реальных данных) на каждый запрос. requireRole
// закрывает доступ по URL для этих ролей вместо того, чтобы городить
// отдельную DB-агрегацию ради экрана, которым они не пользуются.
router.get('/clients', requireRole('TP'), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = (req.query.q || '').trim() || null;
    const color = COLOR_VALUES.includes(req.query.color) ? req.query.color : null;
    const data = await listClients({ managerIds: visibleManagerIds(req.user), q, page, color });
    res.render('clients', { ...data, q, color, user: req.user });
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
