#!/usr/bin/env node
'use strict';

const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { loadAll } = require('./load');
const { exportOrderToTemplate } = require('./exportOrderTemplate');
const { resolveDiscountPercent, computeClientPrice } = require('./pricing');

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (cmd === 'load') {
    const inputDir = args[0] || path.join(__dirname, '..', 'samples');
    const outDir = args[1] || path.join(__dirname, '..', 'out');
    const report = await loadAll(inputDir, outDir);
    console.log(`Загрузка завершена. Источников обработано: ${report.sources.length}`);
    for (const s of report.sources) {
      console.log(`  - ${s.sourceFile}: ${s.status}, строк ${s.rowsOk}/${s.rowsTotal} (ошибок: ${s.rowsError})`);
    }
    console.log(`Полный отчёт: ${path.join(outDir, 'load_report.json')}`);
    return;
  }

  if (cmd === 'demo') {
    await runDemo(args[0] || path.join(__dirname, '..', 'out', 'demo_order.xlsx'));
    return;
  }

  console.error('Использование: node src/cli.js load [inputDir] [outDir] | demo [outputXlsxPath]');
  process.exitCode = 1;
}

/**
 * Demonstrates the "формирование заказа -> выгрузка в шаблон" scenario
 * (ТЗ 6.5/4.8) end-to-end against real loaded data: pick a client with an
 * active discount, price a couple of catalog lines for them, and write the
 * order-template xlsx.
 */
async function runDemo(outputPath) {
  const prisma = new PrismaClient();
  try {
    const client = await prisma.client.findFirst({
      where: { discounts: { some: {} } },
      include: { discounts: true },
    });
    if (!client) {
      console.error('Нет клиентов со скидками в базе — сначала выполните `npm run load`.');
      process.exitCode = 1;
      return;
    }
    const regionDefaults = await prisma.discount.findMany({ where: { clientId: null } });
    const brands = [...new Set(client.discounts.map((d) => d.brand))].slice(0, 2);
    const products = await prisma.product.findMany({
      where: { brand: { in: brands }, isServiceRow: false, priceNet: { not: null } },
      take: 3,
    });

    const lines = products.map((p) => {
      const pct = resolveDiscountPercent(client.discounts, regionDefaults, p.brand);
      const clientPrice = computeClientPrice(p, pct);
      return {
        brand: p.brand,
        article: p.article,
        quantity: 1,
        clientPrice,
        supplierPrice: p.priceGross,
      };
    });

    exportOrderToTemplate(lines, outputPath);
    console.log(`Демо-заказ для клиента "${client.name}" выгружен в ${outputPath}`);
    console.table(lines);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
