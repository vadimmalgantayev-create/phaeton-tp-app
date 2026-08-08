'use strict';

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const { findSourceFile } = require('./lib/findSourceFile');
const { parsePriceList } = require('./parsers/priceList');
const { parseDiscounts } = require('./parsers/discounts');
const { parseDebt } = require('./parsers/debt');
const { parseAddresses } = require('./parsers/addresses');
const { parseMissingInvoices } = require('./parsers/missingInvoices');
const { streamSaleSkuRows, isRealManager } = require('./parsers/saleSku');
const { parsePlan } = require('./parsers/plan');
const { ValidationCollector } = require('./lib/validation');

const BATCH_SIZE = 500;

async function chunkedCreateMany(model, rows) {
  // Note: skipDuplicates is not supported by Prisma's SQLite connector, so
  // callers are responsible for ensuring the rows they pass don't collide
  // with a unique constraint (parsers already de-dupe article+brand etc.).
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await model.createMany({ data: rows.slice(i, i + BATCH_SIZE) });
  }
}

/** Persists a DataLoad row + its ValidationErrors; returns the DataLoad id. */
async function recordLoad(prisma, sourceFile, collector) {
  const dataLoad = await prisma.dataLoad.create({
    data: {
      sourceFile: path.basename(sourceFile),
      sourceType: collector.sourceType,
      rowsTotal: collector.rowsTotal,
      rowsOk: collector.rowsOk,
      rowsError: collector.errors.filter((e) => !e.message.startsWith('Инфо:')).length,
      status: collector.status,
    },
  });
  if (collector.errors.length) {
    await chunkedCreateMany(prisma.validationError, collector.errors.map((e) => ({ ...e, dataLoadId: dataLoad.id })));
  }
  return dataLoad;
}

/** Name-keyed client resolver shared across discounts/debt/sales/missing-invoices,
 * since only the addresses file carries the authoritative "Код клиента". */
function makeClientResolver(prisma, cache, managerCache, defaultRegionId, defaultRegionName) {
  return async function resolveClient(name, managerName, collector, rowNumber) {
    const key = name.trim();
    if (cache.has(key)) return cache.get(key);

    let managerId = null;
    if (managerName) {
      const mgrKey = managerName.trim();
      if (managerCache.has(mgrKey)) {
        managerId = managerCache.get(mgrKey);
      } else {
        // PHA-88: см. isRealManager -- этот файл несёт свой, гораздо более
        // широкий ростер менеджеров компании, а не только 8 Phaeton ТП, так
        // что isServiceAccount тут почти всегда true (и это ожидаемо).
        const isServiceAccount = !isRealManager(mgrKey, defaultRegionName);
        const manager = await prisma.manager.upsert({
          where: { name_regionId: { name: mgrKey, regionId: defaultRegionId } },
          update: { isServiceAccount },
          create: { name: mgrKey, regionId: defaultRegionId, isServiceAccount },
        });
        managerCache.set(mgrKey, manager.id);
        managerId = manager.id;
      }
    }

    const client = await prisma.client.create({ data: { name: key, managerId } });
    cache.set(key, client.id);
    if (collector) collector.note(rowNumber, 'Клиент', `Клиент "${key}" не найден в адресах — создана запись без кода/адреса`, key);
    return client.id;
  };
}

/** Name-keyed client resolver for the SaleSku load (see below): unlike
 * makeClientResolver, the manager association is passed in already resolved
 * (region-correct managerId) instead of being looked up against
 * `defaultRegionId` -- that hardcoded default is exactly what caused the
 * "Кар-Сити попадает в цифры Алматы" bug this task fixes (ТЗ Блок 1.2), so
 * the sale-sku step must not go through the same path. Shares the same
 * `cache` (keyed by client name) as makeClientResolver so a client already
 * known from the addresses file (with its real "Код клиента") is matched by
 * name here too, instead of getting a second stub record. */
function makeSaleSkuClientResolver(prisma, cache) {
  return async function resolveClientForSaleSku(name, managerId, collector, rowNumber) {
    const key = name.trim();
    if (cache.has(key)) return cache.get(key);
    const client = await prisma.client.create({ data: { name: key, managerId } });
    cache.set(key, client.id);
    if (collector) collector.note(rowNumber, 'Клиент', `Клиент "${key}" не найден в адресах — создана запись без кода/адреса`, key);
    return client.id;
  };
}

async function loadAll(inputDir, outDir) {
  const prisma = new PrismaClient();
  const report = { loadedAt: new Date().toISOString(), sources: [] };
  const clientCache = new Map(); // name -> id
  const managerCache = new Map(); // name -> id
  let defaultRegionId = null;

  try {
    // 1. Addresses: authoritative source for Region/Manager/Client/Code + delivery addresses.
    const addressesFile = findSourceFile(inputDir, 'addresses');
    if (addressesFile) {
      const { records, collector } = parseAddresses(addressesFile);
      await prisma.clientAddress.deleteMany({});
      for (const rec of records) {
        const region = await prisma.region.upsert({
          where: { name: rec.city || 'Не указан' },
          update: {},
          create: { name: rec.city || 'Не указан' },
        });
        if (!defaultRegionId) defaultRegionId = region.id;

        let managerId = null;
        if (rec.manager) {
          const mgrKey = rec.manager.trim();
          if (managerCache.has(mgrKey)) {
            managerId = managerCache.get(mgrKey);
          } else {
            // PHA-88: этот файл несёт свой, отдельный от sale_sku.csv ростер
            // менеджеров (см. isRealManager) -- почти все здесь служебные.
            const isServiceAccount = !isRealManager(mgrKey, region.name);
            const manager = await prisma.manager.upsert({
              where: { name_regionId: { name: mgrKey, regionId: region.id } },
              update: { isServiceAccount },
              create: { name: mgrKey, regionId: region.id, isServiceAccount },
            });
            managerCache.set(mgrKey, manager.id);
            managerId = manager.id;
          }
        }

        const client = await prisma.client.upsert({
          where: { code: rec.clientCode },
          update: { name: rec.clientName, managerId, route: rec.route },
          create: { code: rec.clientCode, name: rec.clientName, managerId, route: rec.route },
        });
        clientCache.set(rec.clientName.trim(), client.id);

        await prisma.clientAddress.create({
          data: {
            clientId: client.id,
            city: rec.city || 'Не указан',
            deliveryAddress: rec.address,
            isPrimary: rec.isPrimary,
            deliveryType: rec.deliveryType,
            phone: rec.phone,
            latitude: rec.latitude,
            longitude: rec.longitude,
          },
        });
      }
      report.sources.push(await recordLoad(prisma, addressesFile, collector));
    }

    if (!defaultRegionId) {
      const region = await prisma.region.upsert({ where: { name: 'Алматы' }, update: {}, create: { name: 'Алматы' } });
      defaultRegionId = region.id;
    }
    // Имя дефолтного региона для isRealManager (см. makeClientResolver /
    // ensureManager) -- отдельный запрос, а не переиспользование локальной
    // `region` из веток выше, т.к. они объявлены в разных блоках/циклах.
    const defaultRegion = await prisma.region.findUnique({ where: { id: defaultRegionId } });
    const defaultRegionName = defaultRegion.name;
    const resolveClient = makeClientResolver(prisma, clientCache, managerCache, defaultRegionId, defaultRegionName);

    // 2. Price list -> Products + Stock (full daily replace). Bulk-loaded:
    // ~31k rows, so per-row create() round trips would be far slower than
    // createMany + a follow-up id lookup keyed by the (article, brand)
    // unique constraint.
    const priceListFile = findSourceFile(inputDir, 'price_list');
    if (priceListFile) {
      const { items, collector } = parsePriceList(priceListFile);
      await prisma.stock.deleteMany({});
      await prisma.product.deleteMany({});
      await chunkedCreateMany(
        prisma.product,
        items.map((item) => ({
          article: item.article,
          brand: item.brand,
          name: item.name,
          tnved: item.tnved,
          packQty: item.packQty,
          priceGross: item.priceGross,
          generalDiscountPct: item.generalDiscountPct,
          priceNet: item.priceNet,
          application: item.application,
          article1c: item.article1c,
          isServiceRow: item.isServiceRow,
        })),
      );
      const savedProducts = await prisma.product.findMany({ select: { id: true, article: true, brand: true } });
      const productIdByKey = new Map(savedProducts.map((p) => [`${p.article} ${p.brand}`, p.id]));
      const stockRows = [];
      for (const item of items) {
        const productId = productIdByKey.get(`${item.article} ${item.brand}`);
        for (const s of item.stocks) stockRows.push({ productId, warehouse: s.warehouse, quantity: s.quantity });
      }
      await chunkedCreateMany(prisma.stock, stockRows);
      report.sources.push(await recordLoad(prisma, priceListFile, collector));
    }

    // 3. Discounts -> Discount (region defaults + per-client overrides).
    const discountsFile = findSourceFile(inputDir, 'discounts');
    if (discountsFile) {
      const { regionDefaults, clientDiscounts, collector } = parseDiscounts(discountsFile);
      await prisma.discount.deleteMany({});
      await chunkedCreateMany(
        prisma.discount,
        regionDefaults.map((d) => ({ regionId: defaultRegionId, brand: d.brand, percent: d.percent, validUntil: d.validUntil })),
      );
      const clientDiscountRows = [];
      for (const d of clientDiscounts) {
        const clientId = await resolveClient(d.client, null, collector, null);
        clientDiscountRows.push({ clientId, brand: d.brand, percent: d.percent, validUntil: d.validUntil });
      }
      await chunkedCreateMany(prisma.discount, clientDiscountRows);
      report.sources.push(await recordLoad(prisma, discountsFile, collector));
    }

    // 4. Debt -> per-client aggregate.
    const debtFile = findSourceFile(inputDir, 'debt');
    if (debtFile) {
      const { records, collector } = await parseDebt(debtFile);
      await prisma.debt.deleteMany({});
      for (const rec of records) {
        const clientId = await resolveClient(rec.client, null, collector, null);
        await prisma.debt.create({
          data: {
            clientId,
            totalDebt: rec.totalDebt,
            limitAmount: rec.limitAmount,
            nearestPaymentDate: rec.nearestPaymentDate,
            overdueTotal: rec.overdueTotal,
            bucketUnder3d: rec.bucketUnder3d,
            bucket3to7d: rec.bucket3to7d,
            bucket7to14d: rec.bucket7to14d,
            bucket14to30d: rec.bucket14to30d,
            bucket30to60d: rec.bucket30to60d,
            bucket60to90d: rec.bucket60to90d,
            bucket90to180d: rec.bucket90to180d,
            bucket180dTo1y: rec.bucket180dTo1y,
            bucket1to2y: rec.bucket1to2y,
            bucket2to3y: rec.bucket2to3y,
            bucketOver3y: rec.bucketOver3y,
            isOverdue: rec.isOverdue,
          },
        });
      }
      report.sources.push(await recordLoad(prisma, debtFile, collector));
    }

    // 5. Missing invoices.
    const missingInvoicesFile = findSourceFile(inputDir, 'missing_invoices');
    if (missingInvoicesFile) {
      const { records, collector } = parseMissingInvoices(missingInvoicesFile);
      await prisma.missingInvoice.deleteMany({});
      const rows = [];
      for (const rec of records) {
        const clientId = await resolveClient(rec.client, rec.manager, collector, null);
        const managerId = rec.manager ? managerCache.get(rec.manager.trim()) : null;
        rows.push({ clientId, managerId, orderRef: rec.orderRef, deliveryVariant: rec.deliveryVariant });
      }
      await chunkedCreateMany(prisma.missingInvoice, rows);
      report.sources.push(await recordLoad(prisma, missingInvoicesFile, collector));
    }

    // 6. Plan (3 sheets in one workbook).
    const planFile = findSourceFile(inputDir, 'plan');
    if (planFile) {
      const { brandGroupPlans, totalPlans, acbPlans, collector } = parsePlan(planFile);
      await prisma.plan.deleteMany({});
      await prisma.acbPlan.deleteMany({});

      const planRows = [];
      for (const p of brandGroupPlans) {
        const managerId = await ensureManager(prisma, managerCache, p.manager, defaultRegionId, defaultRegionName);
        planRows.push({ managerId, taskType: 'BRAND_GROUP', productGroup: p.productGroup, planValue: p.planValue, unit: p.unit, weightPct: p.weightPct });
      }
      for (const p of totalPlans) {
        const managerId = await ensureManager(prisma, managerCache, p.manager, defaultRegionId, defaultRegionName);
        planRows.push({ managerId, taskType: 'TOTAL', productGroup: null, planValue: p.planValue, unit: 'EUR', weightPct: p.weightPct });
      }
      await chunkedCreateMany(prisma.plan, planRows);

      for (const a of acbPlans) {
        const managerId = await ensureManager(prisma, managerCache, a.manager, defaultRegionId, defaultRegionName);
        await prisma.acbPlan.upsert({
          where: { managerId },
          update: { acbTotal: a.acbTotal, acbOil: a.acbOil, weightPct: a.weightPct },
          create: { managerId, acbTotal: a.acbTotal, acbOil: a.acbOil, weightPct: a.weightPct },
        });
      }
      report.sources.push(await recordLoad(prisma, planFile, collector));
    }

    // 7. SaleSku -- продажи уровня артикул (ТЗ PHA-88, заменяет старый файл
    // продаж и его outlineLevel-эвристику, см. schema.prisma "модель
    // SaleSku"). Читается потоково (streamSaleSkuRows), поэтому обработка
    // идёт батчами прямо здесь, а не через промежуточный массив "все факты
    // в памяти", как раньше у sales_facts -- 437 620 строк этого не
    // выдержали бы на Render free tier (512МБ).
    //
    // region/manager резолвятся из данных построчно (не через
    // defaultRegionId) -- это и есть фикс "Кар-Сити попадает в цифры
    // Алматы": region/managerCache здесь свои, отдельные от остальных
    // источников, ключ менеджера -- name+regionId, а не просто name.
    const saleSkuFile = findSourceFile(inputDir, 'sale_sku');
    if (saleSkuFile) {
      await prisma.saleSku.deleteMany({});
      const sskCollector = new ValidationCollector('sale_sku');
      const sskRegionCache = new Map(); // region name -> id
      const sskManagerCache = new Map(); // `${name}|${regionId}` -> id
      const resolveSaleSkuClient = makeSaleSkuClientResolver(prisma, clientCache);
      // QA PHA-88 (Критично): resolveSaleSkuClient только СОЗДАЁТ клиента с
      // managerId из первой встреченной строки -- если клиент уже был в
      // clientCache (пришёл из адресов/скидок/ДЗ/нет-накладных, которые
      // грузятся раньше, шаги 1/3-5), его Client.managerId так и оставался
      // старым, даже когда sale_sku.csv однозначно говорит про другого
      // менеджера. Реальные продажи -- самый свежий и авторитетный источник
      // "кто сейчас ведёт клиента" (это тот же принцип, что и фикс региона
      // в ТЗ 1.2), поэтому здесь копится "менеджер по последнему месяцу
      // продаж" на клиента и после стрима applies как реконсиляция --
      // а не "кто первый в файле", т.к. порядок строк в CSV внутри клиента
      // не гарантированно хронологический.
      const clientLatestManager = new Map(); // clientId -> { managerId, month }

      await streamSaleSkuRows(saleSkuFile, sskCollector, async (batch) => {
        const data = [];
        for (const row of batch) {
          let regionId = sskRegionCache.get(row.region);
          if (regionId === undefined) {
            const region = await prisma.region.upsert({ where: { name: row.region }, update: {}, create: { name: row.region } });
            regionId = region.id;
            sskRegionCache.set(row.region, regionId);
          }

          const mgrCacheKey = `${row.manager}|${regionId}`;
          let managerId = sskManagerCache.get(mgrCacheKey);
          if (managerId === undefined) {
            const isServiceAccount = !isRealManager(row.manager, row.region);
            const manager = await prisma.manager.upsert({
              where: { name_regionId: { name: row.manager, regionId } },
              update: { isServiceAccount },
              create: { name: row.manager, regionId, isServiceAccount },
            });
            managerId = manager.id;
            sskManagerCache.set(mgrCacheKey, managerId);
          }

          const clientId = await resolveSaleSkuClient(row.client, managerId, sskCollector, null);

          const latest = clientLatestManager.get(clientId);
          if (!latest || row.month > latest.month) {
            clientLatestManager.set(clientId, { managerId, month: row.month });
          }

          data.push({
            regionId,
            managerId,
            clientId,
            productGroup: row.productGroup,
            brand: row.brand,
            sku: row.sku,
            month: row.month,
            volumeL: row.volumeL,
            revenueKzt: row.revenueKzt,
            revenueEur: row.revenueEur,
          });
        }
        // ТЗ: батчи createMany по ~2000-5000 записей -- вставляем сразу
        // весь батч потока (batchSize=2000 в streamSaleSkuRows, см. её
        // комментарий про пиковый RSS), а не через chunkedCreateMany с его
        // BATCH_SIZE=500 для остальных источников.
        if (data.length > 0) {
          await prisma.saleSku.createMany({ data });
        }
      });

      // Реконсиляция Client.managerId (см. комментарий выше): один bulk
      // findMany по всем клиентам, встретившимся в sale_sku.csv (~2-3
      // тысячи, не 437 620 -- дёшево), затем точечный update только там,
      // где менеджер по последним продажам реально разошёлся с тем, что
      // на Client сейчас (из адресов/старой ассоциации).
      const involvedIds = [...clientLatestManager.keys()];
      const currentClients = await prisma.client.findMany({
        where: { id: { in: involvedIds } },
        select: { id: true, managerId: true },
      });
      let reconciled = 0;
      for (const c of currentClients) {
        const latest = clientLatestManager.get(c.id);
        if (latest && latest.managerId !== c.managerId) {
          await prisma.client.update({ where: { id: c.id }, data: { managerId: latest.managerId } });
          reconciled += 1;
        }
      }
      if (reconciled > 0) {
        sskCollector.note(
          null,
          'Client.managerId',
          `${reconciled} клиент(ов): Client.managerId переприсвоен на менеджера по последнему месяцу продаж в sale_sku.csv (был другой менеджер из адресов/скидок/ДЗ/нет-накладных)`,
          null
        );
      }

      report.sources.push(await recordLoad(prisma, saleSkuFile, sskCollector));
    }

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'load_report.json'), JSON.stringify(report, null, 2));
    }
    return report;
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureManager(prisma, managerCache, name, defaultRegionId, defaultRegionName) {
  const key = name.trim();
  if (managerCache.has(key)) return managerCache.get(key);
  const isServiceAccount = !isRealManager(key, defaultRegionName);
  const manager = await prisma.manager.upsert({
    where: { name_regionId: { name: key, regionId: defaultRegionId } },
    update: { isServiceAccount },
    create: { name: key, regionId: defaultRegionId, isServiceAccount },
  });
  managerCache.set(key, manager.id);
  return manager.id;
}

module.exports = { loadAll };
