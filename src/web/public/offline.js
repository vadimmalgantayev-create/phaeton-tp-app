'use strict';

// ТЗ 3.3: офлайн-режим -- локальное кэширование каталога/скидок/ДЗ/адресов/
// планов (через GET /api/sync), офлайн-черновик заказа и буферизация
// GPS-трека. Хранилище -- IndexedDB через Dexie (vendored в
// /vendor/dexie.min.js, без внешнего CDN, чтобы страница грузилась и
// офлайн). Подключается на каждой странице через partials/nav.ejs.
(function () {
  if (typeof Dexie === 'undefined') return;

  var db = new Dexie('phaeton_offline');
  db.version(1).stores({
    products: 'id, brand',
    clients: 'id, name',
    checkinQueue: '++id, clientId',
    orderQueue: '++id, [clientId+productId]',
    meta: 'key',
  });

  // Дублирует логику src/pricing.js -- в браузере нельзя require()
  // CommonJS-модуль сервера без сборщика. При изменении правил скидки в
  // pricing.js нужно синхронизировать и эту копию.
  function resolveDiscountPercent(clientDiscounts, regionDefaults, brand, asOf) {
    asOf = asOf || new Date();
    function isActive(d) { return !d.validUntil || new Date(d.validUntil) >= asOf; }
    var clientMatch = (clientDiscounts || []).find(function (d) { return d.brand === brand && isActive(d); });
    if (clientMatch) return clientMatch.percent;
    var regionMatch = (regionDefaults || []).find(function (d) { return d.brand === brand && isActive(d); });
    if (regionMatch) return regionMatch.percent;
    return 0;
  }

  function computeClientPrice(product, discountPercent) {
    var base = product.priceNet !== null && product.priceNet !== undefined ? product.priceNet : product.priceGross;
    if (base === null || base === undefined) return null;
    return Math.round(base * (1 - discountPercent / 100) * 100) / 100;
  }

  async function cacheSyncData() {
    var res = await fetch('/api/sync', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('sync failed: ' + res.status);
    var data = await res.json();

    await db.transaction('rw', db.products, db.clients, db.meta, async function () {
      await db.products.clear();
      await db.products.bulkPut(data.products);
      await db.clients.clear();
      await db.clients.bulkPut(data.clients);
      await db.meta.put({ key: 'regionDefaults', value: data.regionDefaults });
      await db.meta.put({ key: 'plans', value: data.plans });
      await db.meta.put({ key: 'acbPlan', value: data.acbPlan });
      await db.meta.put({ key: 'lastSync', value: data.generatedAt });
    });

    return data;
  }

  async function getLastSync() {
    var row = await db.meta.get('lastSync');
    return row ? row.value : null;
  }

  async function getClients() {
    return db.clients.toArray();
  }

  async function searchProducts(query, brand, clientId) {
    var q = (query || '').trim().toLowerCase();
    var all = await db.products.toArray();
    var regionDefaultsRow = await db.meta.get('regionDefaults');
    var regionDefaults = regionDefaultsRow ? regionDefaultsRow.value : [];
    var client = clientId ? await db.clients.get(Number(clientId)) : null;

    return all
      .filter(function (p) {
        if (brand && p.brand !== brand) return false;
        if (!q) return true;
        return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.article || '').toLowerCase().indexOf(q) !== -1;
      })
      .slice(0, 100)
      .map(function (p) {
        var discountPercent = client ? resolveDiscountPercent(client.discounts, regionDefaults, p.brand) : 0;
        var clientPrice = client ? computeClientPrice(p, discountPercent) : null;
        return Object.assign({}, p, { discountPercent: discountPercent, clientPrice: clientPrice });
      });
  }

  async function queueCheckin(clientId, payload) {
    return db.checkinQueue.add({
      clientId: Number(clientId),
      latitude: payload.latitude,
      longitude: payload.longitude,
      queuedAt: Date.now(),
    });
  }

  async function queueOrderLine(clientId, productId, quantity, productLabel) {
    clientId = Number(clientId);
    productId = Number(productId);
    var existing = await db.orderQueue.where('[clientId+productId]').equals([clientId, productId]).first();
    if (existing) {
      await db.orderQueue.update(existing.id, { quantity: existing.quantity + quantity });
    } else {
      await db.orderQueue.add({ clientId: clientId, productId: productId, quantity: quantity, productLabel: productLabel || '' });
    }
  }

  async function getQueuedOrders() {
    return db.orderQueue.toArray();
  }

  async function getQueuedCheckins() {
    return db.checkinQueue.toArray();
  }

  async function flushQueues() {
    if (!navigator.onLine) return { checkinsSynced: 0, orderLinesSynced: 0 };

    var checkins = await db.checkinQueue.toArray();
    var checkinsSynced = 0;
    for (var i = 0; i < checkins.length; i++) {
      var c = checkins[i];
      try {
        var r = await fetch('/route/' + c.clientId + '/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: c.latitude, longitude: c.longitude }),
        });
        if (r.ok) {
          await db.checkinQueue.delete(c.id);
          checkinsSynced++;
        }
      } catch (e) { /* остаётся в очереди, попробуем при следующей синхронизации */ }
    }

    var orderLines = await db.orderQueue.toArray();
    var orderLinesSynced = 0;
    for (var j = 0; j < orderLines.length; j++) {
      var line = orderLines[j];
      try {
        var url = '/orders/new?clientId=' + line.clientId + '&productId=' + line.productId + '&quantity=' + line.quantity;
        var resp = await fetch(url, { credentials: 'same-origin' });
        if (resp.ok) {
          await db.orderQueue.delete(line.id);
          orderLinesSynced++;
        }
      } catch (e) { /* остаётся в очереди */ }
    }

    return { checkinsSynced: checkinsSynced, orderLinesSynced: orderLinesSynced };
  }

  window.phaetonOffline = {
    cacheSyncData: cacheSyncData,
    getLastSync: getLastSync,
    getClients: getClients,
    searchProducts: searchProducts,
    queueCheckin: queueCheckin,
    queueOrderLine: queueOrderLine,
    getQueuedOrders: getQueuedOrders,
    getQueuedCheckins: getQueuedCheckins,
    flushQueues: flushQueues,
  };

  window.addEventListener('online', function () {
    flushQueues().catch(function () {});
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
})();
