'use strict';

function visibleManagerIds(user) {
  if (user.role === 'TP') return user.managerId ? [user.managerId] : [];
  return null; // null = без фильтра по менеджеру (RUKOVODITEL/ADMIN)
}

// PHA-82: Руководитель привязан к бизнес-региону (User.regionId, выбран при
// входе -- см. auth.js /login/region), кабинет руководителя скоупится по
// нему. Администратор -- без привязки, видит все регионы (null = без
// фильтра). Если у RUKOVODITEL нет regionId (аккаунт заведён вручную через
// /admin/users без региона, до PHA-82) -- возвращаем несуществующий id (-1),
// чтобы фильтр `where.manager = { regionId }` дал пустой результат, а не
// молча показал весь портфель (id -1 не спутать с "без фильтра" -- 0 здесь
// не годится, т.к. фильтры ниже проверяют regionId через `if (regionId)`,
// и 0 ложно считался бы отсутствием фильтра).
function visibleRegionId(user) {
  if (user.role === 'ADMIN') return null;
  if (user.role === 'RUKOVODITEL') return user.regionId || -1;
  return null;
}

module.exports = { visibleManagerIds, visibleRegionId };
