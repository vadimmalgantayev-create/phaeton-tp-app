'use strict';

const { PrismaClient } = require('@prisma/client');
const { resolveDiscountPercent, computeClientPrice } = require('../../pricing');
const { getClientDiscountContext } = require('./catalogService');

const prisma = new PrismaClient();

async function getOrCreateDraftOrder(clientId, createdById) {
  let order = await prisma.order.findFirst({ where: { clientId, createdById, status: 'draft' } });
  if (!order) {
    order = await prisma.order.create({ data: { clientId, createdById, status: 'draft' } });
  }
  return order;
}

// ТЗ 6.5: автоматический расчёт скидки на момент добавления в заказ
// (переиспользует pricing.js, как и каталог).
async function addLine(orderId, productId) {
  const [product, order] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.order.findUnique({ where: { id: orderId } }),
  ]);
  if (!product || !order) return null;

  const existing = await prisma.orderLine.findFirst({ where: { orderId, productId } });
  if (existing) {
    return prisma.orderLine.update({ where: { id: existing.id }, data: { quantity: existing.quantity + 1 } });
  }

  const ctx = await getClientDiscountContext(order.clientId);
  const discountPercent = ctx ? resolveDiscountPercent(ctx.clientDiscounts, ctx.regionDefaults, product.brand) : 0;
  const clientPrice = computeClientPrice(product, discountPercent) || 0;
  // ⚑ Открытый вопрос (тот же, что в exportOrderTemplate.js): "Цена
  // поставщика" не определена ТЗ явно, берём priceGross как ближайший аналог.
  const supplierPrice = product.priceGross ?? 0;

  return prisma.orderLine.create({
    data: { orderId, productId, quantity: 1, discountPercent, clientPrice, supplierPrice },
  });
}

async function setLineQuantity(lineId, quantity) {
  if (quantity <= 0) return prisma.orderLine.delete({ where: { id: lineId } });
  return prisma.orderLine.update({ where: { id: lineId }, data: { quantity } });
}

async function getOrderDetail(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      client: { include: { debt: true } },
      lines: { include: { product: { include: { stocks: true } } }, orderBy: { id: 'asc' } },
    },
  });
  if (!order) return null;

  const lines = order.lines.map((l) => {
    const totalStock = l.product.stocks.reduce((sum, s) => sum + s.quantity, 0);
    return {
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      brand: l.product.brand,
      article: l.product.article,
      quantity: l.quantity,
      discountPercent: l.discountPercent,
      clientPrice: l.clientPrice,
      supplierPrice: l.supplierPrice,
      lineTotal: l.clientPrice * l.quantity,
      totalStock,
      insufficientStock: l.quantity > totalStock,
    };
  });

  const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  return { order, lines, total };
}

module.exports = { getOrCreateDraftOrder, addLine, setLineQuantity, getOrderDetail };
