'use strict';

const express = require('express');
const { getManagerDashboard } = require('../services/managerDashboardService');
const { getVisitsReport, queryVisits, DISTANCE_OK_THRESHOLD_M } = require('../services/visitsService');
const { buildVisitsWorkbookBuffer } = require('../../exportVisitsReport');
const { requireRole } = require('../auth/middleware');
const { visibleRegionId } = require('../auth/scope');

const router = express.Router();

router.get('/manager', requireRole('RUKOVODITEL', 'ADMIN'), async (req, res, next) => {
  try {
    const regionId = visibleRegionId(req.user);
    const data = await getManagerDashboard(regionId);
    const noRegionAssigned = req.user.role === 'RUKOVODITEL' && !req.user.regionId;
    res.render('manager', { ...data, user: req.user, noRegionAssigned });
  } catch (err) {
    next(err);
  }
});

// Разбор общих для экрана и Excel-выгрузки query-фильтров (ч.2/ч.3 ТЗ).
// PHA-82: у RUKOVODITEL regionId зафиксирован его сессией (не query-параметром
// из формы) -- иначе руководитель мог бы подменить ?regionId=... в адресной
// строке и увидеть чужой регион. У ADMIN фильтр остаётся свободным (как был).
function parseVisitsFilters(query, user) {
  const forcedRegionId = visibleRegionId(user);
  return {
    period: query.period,
    regionId: forcedRegionId != null ? forcedRegionId : (query.regionId ? Number(query.regionId) : undefined),
    managerId: query.managerId ? Number(query.managerId) : undefined,
    clientId: query.clientId ? Number(query.clientId) : undefined,
  };
}

router.get('/manager/visits', requireRole('RUKOVODITEL', 'ADMIN'), async (req, res, next) => {
  try {
    const filters = parseVisitsFilters(req.query, req.user);
    const data = await getVisitsReport(filters);
    res.render('managerVisits', { ...data, user: req.user, distanceOkThresholdM: DISTANCE_OK_THRESHOLD_M });
  } catch (err) {
    next(err);
  }
});

router.get('/manager/visits/export.xlsx', requireRole('RUKOVODITEL', 'ADMIN'), async (req, res, next) => {
  try {
    const filters = parseVisitsFilters(req.query, req.user);
    const { rows } = await queryVisits(filters);
    const buffer = buildVisitsWorkbookBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="visits-${filters.period || 'month'}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
