'use strict';

const { PrismaClient } = require('@prisma/client');
const { getClientPlanFacts } = require('./clientPlanService');
const { OIL_BRANDS } = require('./taskBrandMapping');

const prisma = new PrismaClient();
const PAGE_SIZE = 30;

// PHA-85: фиксированный набор меток заметки -- строго эти три, не выдумывать
// новые (см. ТЗ задачи). Порядок здесь -- порядок в select на форме.
const NOTE_TAGS = ['Задолженность', 'Договорённость', 'Витрина'];

// PHA-83: цвет строго по факту закупа текущего месяца (EUR), не по % плана.
function getFactColor(factEur) {
  if (factEur > 100) return 'green';
  if (factEur > 0) return 'orange';
  return 'red';
}

async function listClients({ managerIds, q, page = 1, color = null } = {}) {
  const where = {};
  if (managerIds) where.managerId = { in: managerIds };
  if (q) {
    where.OR = [{ name: { contains: q } }, { code: { contains: q } }];
  }

  const [clients, planFacts] = await Promise.all([
    prisma.client.findMany({
      where,
      include: { manager: true, debt: true, _count: { select: { missingInvoices: true } } },
    }),
    getClientPlanFacts(managerIds),
  ]);

  const colored = clients.map((c) => {
    const planEur = planFacts.planByClient.has(c.id) ? planFacts.planByClient.get(c.id) : null;
    // QA PHA-83: чистый возврат (сумма revenueEur за месяц отрицательна) --
    // это business-эквивалент "не закупал", а не отрицательная сумма. Клэмп
    // до 0 здесь, а не только в шаблоне, чтобы бейдж, цвет и % от плана были
    // согласованы (иначе бейдж показал бы "0 EUR", а % плана -- отрицательным).
    const factEur = Math.max(0, planFacts.factByClient.get(c.id) || 0);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      managerName: c.manager ? c.manager.name : null,
      isOverdue: c.debt ? c.debt.isOverdue : false,
      hasMissingInvoice: c._count.missingInvoices > 0,
      planEur,
      factEur,
      percent: planEur ? Math.round((factEur / planEur) * 100) : null,
      color: getFactColor(factEur),
    };
  });

  // Сортировка по убыванию факта закупа (PHA-83 п.2) и фильтр по цвету (п.3)
  // применяются до пагинации, т.к. цвет/факт считаются из planFacts, а не из
  // самой БД-выборки клиентов.
  const filtered = color ? colored.filter((c) => c.color === color) : colored;
  filtered.sort((a, b) => b.factEur - a.factEur);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return {
    items,
    month: planFacts.month,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  };
}

// ТЗ 6.4: реквизиты, скидки, статус ДЗ, сигнал "нет накладных", история
// продаж, заметки. Индивидуальный план/факт клиента (PHA-79 п.3, расчётный
// -- см. clientPlanService.js) показывается в списке /clients, а не здесь:
// карточка клиента остаётся историей продаж, чтобы не дублировать один и
// тот же расчёт на двух экранах.
//
// Скидки на карточке -- только индивидуальные скидки ЭТОГО клиента
// (client.discounts, clientId != null в "Действующие скидки"). Региональная
// база (Discount с clientId: null) сюда намеренно не подмешивается: это
// одни и те же ~130 строк для всех клиентов региона, и раньше они
// перекрывали единичные индивидуальные скидки в списке, из-за чего на
// любой карточке было видно один и тот же набор "по региону 10%" (PHA-80,
// баг 1). Региональная база остаётся источником фолбэка для цены заказа
// (см. resolveDiscountPercent в pricing.js/catalogService.js/orderService.js)
// -- там её убирать нельзя, это отдельный экран/расчёт.
//
// История продаж -- только текущий календарный год (PHA-80, баг 2): было
// `take: 12` без фильтра по году, что подмешивало старые периоды прошлого
// года для клиентов с менее чем 12 продажами в этом году.
async function getClientDetail(clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      manager: true,
      addresses: true,
      discounts: true,
      debt: true,
      missingInvoices: true,
    },
  });
  if (!client) return null;

  // Помечаем истёкшие индивидуальные скидки (validUntil < сегодня), а не
  // просто выводим их как активные: `resolveDiscountPercent` в pricing.js
  // отбрасывает такие при расчёте цены заказа по той же логике
  // (`!validUntil || validUntil >= asOf`), так что без пометки карточка
  // расходилась бы с тем, что реально применится к заказу (QA PHA-80).
  // Активные -- сверху, истёкшие -- внизу, чтобы актуальное было видно сразу.
  const now = new Date();
  const isActive = (d) => !d.validUntil || d.validUntil >= now;
  client.discounts = client.discounts
    .map((d) => ({ ...d, isExpired: !isActive(d) }))
    .sort((a, b) => Number(a.isExpired) - Number(b.isExpired));

  const currentYear = new Date().getFullYear();
  const salesHistoryRaw = await prisma.salesFact.findMany({
    where: {
      clientId,
      month: { gte: new Date(Date.UTC(currentYear, 0, 1)), lt: new Date(Date.UTC(currentYear + 1, 0, 1)) },
    },
    orderBy: { month: 'desc' },
  });

  // PHA-84: масляные бренды (FUCHS, MaxPro1, AFINOL — тот же список, что и
  // задача "Масло" в taskBrandMapping.js) считаются в литрах, т.к. премия по
  // маслу считается по объёму, а не по обороту. Остальные бренды -- в EUR.
  const salesHistory = salesHistoryRaw.map((s) => {
    const isOil = OIL_BRANDS.includes(s.brand);
    return {
      ...s,
      amount: isOil ? s.volumeL : s.revenueEur,
      unit: isOil ? 'л' : 'EUR',
    };
  });

  return { client, salesHistory };
}

// Лёгкая выборка клиента без тяжёлых include -- для заголовка экрана заметок
// и для проверки прав доступа (managerId), без загрузки скидок/ДЗ/истории.
async function getClientBasic(clientId) {
  return prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, code: true, managerId: true },
  });
}

// PHA-85 п.2 / PHA-87 п.4: невыполненные -- сверху, выполненные -- вниз (вне
// зависимости от pinned/даты), внутри каждой группы -- закреплённые сверху,
// затем по дате создания (новые сверху). SQLite сортирует boolean как 0/1,
// поэтому 'desc' кладёт true (1) перед false (0); done сортируется по
// возрастанию (false=0 перед true=1), чтобы невыполненные шли первыми.
//
// QA PHA-85: author.manager подтягивается вложенно, чтобы шаблон мог
// показать имя менеджера, а не технический username (author.manager
// пусто для RUKOVODITEL/ADMIN -- у них его и нет; шаблон делает фолбэк
// на username для этого случая).
async function getClientNotes(clientId) {
  return prisma.note.findMany({
    where: { clientId },
    include: { author: { include: { manager: true } } },
    orderBy: [{ done: 'asc' }, { pinned: 'desc' }, { createdAt: 'desc' }],
  });
}

async function addNote(clientId, authorId, text, tag, pinned) {
  return prisma.note.create({
    data: {
      clientId,
      authorId,
      text,
      tag: NOTE_TAGS.includes(tag) ? tag : null,
      pinned: !!pinned,
    },
  });
}

// PHA-86: удаление не привязано к автору -- право проверяется на уровне
// роута через checkClientAccess (клиент относится к менеджеру), а не здесь.
// `clientId` в where -- защита от удаления чужой заметки по id, если noteId
// подобран/подставлен для другого клиента.
async function deleteNote(clientId, noteId) {
  const result = await prisma.note.deleteMany({ where: { id: noteId, clientId } });
  return result.count > 0;
}

// PHA-87: право на переключение "выполнено" -- то же самое, что и на
// удаление (проверяется на уровне роута через checkClientAccess), не
// привязано к автору заметки. `clientId` в where -- та же защита от
// подмены noteId чужого клиента, что и в deleteNote.
async function setNoteDone(clientId, noteId, done) {
  const result = await prisma.note.updateMany({ where: { id: noteId, clientId }, data: { done } });
  return result.count > 0;
}

module.exports = { listClients, getClientDetail, getClientBasic, getClientNotes, addNote, deleteNote, setNoteDone, NOTE_TAGS };
