'use strict';

const express = require('express');
const {
  buildReportWhere,
  getReportManagerOptions,
  getClientsPage,
  isClientInReportScope,
  isInReportScope,
  getGroupBreakdown,
  getBrandBreakdown,
  getSkuBreakdown,
  getClientsExportRows,
  getBrandsPage,
  getBrandClientBreakdown,
  getBrandClientSkuBreakdown,
  getBrandsExportRows,
  buildDebtReportWhere,
  getDebtPage,
  getDebtExportRows,
} = require('../services/reportsService');
const { getAvailableMonths, getDefaultMonth, parseMonthKey, monthKey } = require('../services/salesMonths');
const { buildClientsReportWorkbookBuffer } = require('../../exportClientsReport');
const { buildBrandsReportWorkbookBuffer } = require('../../exportBrandsReport');
const { buildDebtReportWorkbookBuffer } = require('../../exportDebtReport');

const router = express.Router();

// ТЗ PHA-88 Блок 2: все три отчёта (2.1/2.2/2.3) реализованы; /reports
// по-прежнему ведёт на 2.1 как отчёт по умолчанию, а не на страницу-хаб --
// ТЗ хаб не запрашивала, три отчёта уже равноправно доступны через
// `partials/reportsSubnav.ejs` наверху каждого экрана.
router.get('/reports', (req, res) => {
  res.redirect('/reports/clients');
});

// Общий разбор фильтров экрана и Excel-выгрузки (тот же принцип, что
// parseVisitsFilters в manager.js: одна функция для обоих роутов, чтобы
// страница и выгрузка не могли разойтись по строкам).
// PHA-90: без ?month= -- последний месяц с данными SaleSku (getDefaultMonth),
// не текущий календарный, поэтому функция стала асинхронной.
async function parseReportFilters(query, user) {
  const month = parseMonthKey(query.month) || (await getDefaultMonth());
  const queryManagerId = query.managerId ? Number(query.managerId) : null;
  const where = buildReportWhere(user, month, queryManagerId);
  return { month, queryManagerId, where };
}

router.get('/reports/clients', async (req, res, next) => {
  try {
    const { month, queryManagerId, where } = await parseReportFilters(req.query, req.user);
    const page = Math.max(1, Number(req.query.page) || 1);

    const [availableMonths, managerOptions, data] = await Promise.all([
      getAvailableMonths(),
      getReportManagerOptions(req.user),
      getClientsPage(where, page),
    ]);

    res.render('reportClients', {
      user: req.user,
      month,
      monthKey,
      availableMonths,
      managerOptions,
      queryManagerId,
      ...data,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/reports/clients/export.xlsx', async (req, res, next) => {
  try {
    const { month, where } = await parseReportFilters(req.query, req.user);
    const rows = await getClientsExportRows(where);
    const buffer = buildClientsReportWorkbookBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="clients-${monthKey(month)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// AJAX-раскрытие одного уровня дерева (ТЗ 2: "ленивое, НЕ рендерить всё
// дерево сразу"). Отдаёт HTML-фрагмент (partials/reportLevelRows), а не
// JSON -- в проекте нет клиентского шаблонизатора, только простой
// fetch()+innerHTML (см. route.ejs), рендерить разметку эффективнее и
// последовательнее прямо на сервере тем же EJS, что и всю остальную вёрстку.
router.get('/reports/clients/expand', async (req, res, next) => {
  try {
    const { month, where } = await parseReportFilters(req.query, req.user);
    const clientId = Number(req.query.clientId);
    const level = req.query.level; // 'group' | 'brand' | 'sku'

    if (!Number.isInteger(clientId) || !['group', 'brand', 'sku'].includes(level)) {
      return res.status(400).send('Некорректные параметры раскрытия');
    }
    if (!(await isClientInReportScope(where, clientId))) {
      return res.status(403).send('Недостаточно прав для просмотра этого клиента');
    }

    const qs = `clientId=${clientId}&month=${monthKey(month)}${req.query.managerId ? `&managerId=${req.query.managerId}` : ''}`;

    if (level === 'group') {
      const rows = await getGroupBreakdown(clientId, month);
      return res.render('partials/reportLevelRows', {
        rows: rows.map((r) => ({
          key: r.productGroup,
          label: r.productGroup,
          revenueEur: r.revenueEur,
          volumeL: null,
          nextUrl: `/reports/clients/expand?level=brand&${qs}&productGroup=${encodeURIComponent(r.productGroup)}`,
        })),
      });
    }

    const productGroup = req.query.productGroup;
    if (level === 'brand') {
      const rows = await getBrandBreakdown(clientId, productGroup, month);
      return res.render('partials/reportLevelRows', {
        rows: rows.map((r) => ({
          key: r.brand,
          label: r.brand,
          revenueEur: r.revenueEur,
          volumeL: r.showLiters ? r.volumeL : null,
          nextUrl: `/reports/clients/expand?level=sku&${qs}&productGroup=${encodeURIComponent(productGroup)}&brand=${encodeURIComponent(r.brand)}`,
        })),
      });
    }

    // level === 'sku' -- лист, дальше раскрывать нечего.
    const brand = req.query.brand;
    const rows = await getSkuBreakdown(clientId, productGroup, brand, month);
    res.render('partials/reportLevelRows', {
      rows: rows.map((r) => ({ key: r.sku, label: r.sku, revenueEur: r.revenueEur, volumeL: r.showLiters ? r.volumeL : null, nextUrl: null })),
    });
  } catch (err) {
    next(err);
  }
});

// ТЗ 2.2: "Продажи по брендам" -- бренд -> клиенты -> артикулы (см.
// reportsService.js: getBrandsPage и комментарий над ней про то, чем 2.2
// отличается от 2.1).
router.get('/reports/brands', async (req, res, next) => {
  try {
    const { month, queryManagerId, where } = await parseReportFilters(req.query, req.user);
    const page = Math.max(1, Number(req.query.page) || 1);

    const [availableMonths, managerOptions, data] = await Promise.all([
      getAvailableMonths(),
      getReportManagerOptions(req.user),
      getBrandsPage(where, page),
    ]);

    res.render('reportBrands', {
      user: req.user,
      month,
      monthKey,
      availableMonths,
      managerOptions,
      queryManagerId,
      ...data,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/reports/brands/export.xlsx', async (req, res, next) => {
  try {
    const { month, where } = await parseReportFilters(req.query, req.user);
    const rows = await getBrandsExportRows(where);
    const buffer = buildBrandsReportWorkbookBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="brands-${monthKey(month)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// AJAX-раскрытие для 2.2: level=client (бренд -> клиенты) или level=sku
// (клиент внутри бренда -> артикулы). RBAC той же схемой, что и у 2.1
// (isInReportScope против того же `where`, что и видимый список) --
// level=client проверяет brand, level=sku проверяет brand+clientId вместе,
// а не по отдельности (независимые проверки безопасны, но комбинированная
// точнее отражает то, что реально запрашивается).
router.get('/reports/brands/expand', async (req, res, next) => {
  try {
    const { month, where } = await parseReportFilters(req.query, req.user);
    const brand = req.query.brand;
    const level = req.query.level; // 'client' | 'sku'

    if (!brand || !['client', 'sku'].includes(level)) {
      return res.status(400).send('Некорректные параметры раскрытия');
    }
    if (!(await isInReportScope(where, { brand }))) {
      return res.status(403).send('Недостаточно прав для просмотра этого бренда');
    }

    const qs = `brand=${encodeURIComponent(brand)}&month=${monthKey(month)}${req.query.managerId ? `&managerId=${req.query.managerId}` : ''}`;

    if (level === 'client') {
      const rows = await getBrandClientBreakdown(where, brand);
      return res.render('partials/reportLevelRows', {
        rows: rows.map((r) => ({
          key: r.clientId,
          label: r.name,
          revenueEur: r.revenueEur,
          volumeL: r.volumeL,
          nextUrl: `/reports/brands/expand?level=sku&${qs}&clientId=${r.clientId}`,
        })),
      });
    }

    // level === 'sku' -- лист.
    const clientId = Number(req.query.clientId);
    if (!Number.isInteger(clientId) || !(await isInReportScope(where, { brand, clientId }))) {
      return res.status(403).send('Недостаточно прав для просмотра этого клиента');
    }
    const rows = await getBrandClientSkuBreakdown(where, brand, clientId);
    res.render('partials/reportLevelRows', {
      rows: rows.map((r) => ({ key: r.sku, label: r.sku, revenueEur: r.revenueEur, volumeL: r.volumeL, nextUrl: null })),
    });
  } catch (err) {
    next(err);
  }
});

// ТЗ 2.3: "Дебиторская задолженность" -- в отличие от 2.1/2.2 источник это
// Debt (снимок 1С, без помесячной истории, см. reportsService.js), поэтому
// свой parseFilters без month/monthKey и без AJAX-раскрытия -- модель Debt
// не хранит документный уровень (см. комментарий над getDebtPage).
function parseDebtFilters(query, user) {
  const queryManagerId = query.managerId ? Number(query.managerId) : null;
  const clientWhere = buildDebtReportWhere(user, queryManagerId);
  return { queryManagerId, clientWhere };
}

router.get('/reports/debt', async (req, res, next) => {
  try {
    const { queryManagerId, clientWhere } = parseDebtFilters(req.query, req.user);
    const page = Math.max(1, Number(req.query.page) || 1);

    const [managerOptions, data] = await Promise.all([
      getReportManagerOptions(req.user),
      getDebtPage(clientWhere, page),
    ]);

    res.render('reportDebt', {
      user: req.user,
      managerOptions,
      queryManagerId,
      ...data,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/reports/debt/export.xlsx', async (req, res, next) => {
  try {
    const { clientWhere } = parseDebtFilters(req.query, req.user);
    const rows = await getDebtExportRows(clientWhere);
    const buffer = buildDebtReportWorkbookBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="debt.xlsx"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
