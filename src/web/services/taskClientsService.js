'use strict';

const { getTaskConfigByKey } = require('./taskBrandMapping');
const { getTaskClientBreakdown } = require('./taskFacts');

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// ТЗ PHA-79 п.2: клик по оплачиваемой задаче -> какие клиенты закупились по
// ней в текущем месяце и сколько каждый (в EUR или литрах, по задаче).
async function getTaskClientsScreen(managerId, taskKey) {
  const config = getTaskConfigByKey(taskKey);
  if (!config) return null;

  const month = startOfMonth(new Date());
  const items = await getTaskClientBreakdown(managerId, month, config);
  const unit = config.metric === 'volumeL' ? 'LITERS' : 'EUR';

  return { config, month, unit, items };
}

module.exports = { getTaskClientsScreen };
