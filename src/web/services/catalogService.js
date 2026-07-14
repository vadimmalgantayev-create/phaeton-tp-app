'use strict';

const { PrismaClient } = require('@prisma/client');
const { resolveDiscountPercent, computeClientPrice } = require('../../pricing');

const prisma = new PrismaClient();
const PAGE_SIZE = 50;

async function getClientDiscountContext(clientId) {
  if (!clientId) return null;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { manager: true, discounts: true },
  });
  if (!client) return null;
  const regionDefaults = client.manager
    ? await prisma.discount.findMany({ where: { regionId: client.manager.regionId, clientId: null } })
    : [];
  return { client, clientDiscounts: client.discounts, regionDefaults };
}

// ТЗ 6.3: поиск/фильтры по каталогу, скрытие служебных строк (нет цены),
// цена клиента (если передан clientId) vs цена без скидки, остатки по складам.
async function listProducts({ q, brand, clientId, page = 1 } = {}) {
  const where = { isServiceRow: false };
  if (brand) where.brand = brand;
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { article: { contains: q } },
      { article1c: { contains: q } },
    ];
  }

  const [total, products, discountCtx] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { stocks: true },
      orderBy: { name: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getClientDiscountContext(clientId),
  ]);

  const items = products.map((p) => {
    let clientPrice = null;
    let discountPercent = null;
    if (discountCtx) {
      discountPercent = resolveDiscountPercent(discountCtx.clientDiscounts, discountCtx.regionDefaults, p.brand);
      clientPrice = computeClientPrice(p, discountPercent);
    }
    return {
      id: p.id,
      article: p.article,
      brand: p.brand,
      name: p.name,
      priceGross: p.priceGross,
      priceNet: p.priceNet,
      discountPercent,
      clientPrice,
      stocks: p.stocks.map((s) => ({ warehouse: s.warehouse, quantity: s.quantity })),
    };
  });

  return {
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    clientName: discountCtx ? discountCtx.client.name : null,
  };
}

async function listBrands() {
  const rows = await prisma.product.findMany({
    where: { isServiceRow: false },
    distinct: ['brand'],
    select: { brand: true },
    orderBy: { brand: 'asc' },
  });
  return rows.map((r) => r.brand);
}

module.exports = { listProducts, listBrands, getClientDiscountContext };
