'use strict';

// ⚑ Допущение (нет поля "регион" у Руководителя в ТЗ/данных): Руководитель
// и Администратор видят все регионы/менеджеров — деления кабинета
// руководителя по региону в MVP нет, весь портфель показывается целиком.
// Если потребуется region-scoped Руководитель, нужно добавить User.regionId
// и сузить этот helper — предположение, подлежащее подтверждению заказчиком.
function visibleManagerIds(user) {
  if (user.role === 'TP') return user.managerId ? [user.managerId] : [];
  return null; // null = без фильтра по менеджеру (RUKOVODITEL/ADMIN)
}

module.exports = { visibleManagerIds };
