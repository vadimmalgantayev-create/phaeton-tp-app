'use strict';

const { readSheetRows } = require('../lib/workbook');
const { parseCoordinate, cleanString } = require('../lib/parse');
const { ValidationCollector } = require('../lib/validation');

const COL = {
  city: 0,
  manager: 1,
  clientCode: 4,
  clientName: 6,
  route: 7,
  address: 8,
  isPrimary: 9,
  deliveryType: 10,
  phone: 11,
  lat: 12,
  lon: 13,
};
const HEADER_ROWS = 3; // row0 "Отбор:" filter note, row1 blank, row2 column header

/**
 * Адреса доставки клиентов с координатами -> one row per delivery address.
 * This file is also the authoritative source for Код клиента <-> Клиент
 * <-> Основной менеджер (no other source file carries the client code),
 * so callers use it to seed/attach Client + Manager records before loading
 * discounts/debt/sales, which only reference clients by name.
 * Coordinate normalization per ТЗ 4.4 (mixed "," / "." decimal separators)
 * happens in lib/parse.js#parseCoordinate.
 */
function parseAddresses(filePath, sheetName) {
  const rows = readSheetRows(filePath, sheetName);
  const collector = new ValidationCollector('addresses');
  const records = [];

  for (let i = HEADER_ROWS; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
    const rowNumber = i + 1;
    collector.countRow();

    const clientCode = cleanString(row[COL.clientCode]);
    const clientName = cleanString(row[COL.clientName]);
    const address = cleanString(row[COL.address]);

    if (!clientCode) {
      collector.fail(rowNumber, 'Код клиента', 'Пустой код клиента — строка пропущена', row[COL.clientCode]);
      continue;
    }
    if (!clientName) {
      collector.fail(rowNumber, 'Клиент', 'Пустое наименование клиента — строка пропущена', row[COL.clientName]);
      continue;
    }
    if (!address) {
      collector.fail(rowNumber, 'Адрес доставки', `Пустой адрес доставки для клиента "${clientName}" — строка пропущена`, row[COL.address]);
      continue;
    }

    const latRaw = row[COL.lat];
    const lonRaw = row[COL.lon];
    const latitude = parseCoordinate(latRaw, 'lat');
    const longitude = parseCoordinate(lonRaw, 'lon');
    if (latRaw && latitude === null) {
      collector.fail(rowNumber, 'Координата X (широта)', `Координата вне диапазона РК или нераспознана для "${clientName}"`, latRaw);
    }
    if (lonRaw && longitude === null) {
      collector.fail(rowNumber, 'Координата Y (долгота)', `Координата вне диапазона РК или нераспознана для "${clientName}"`, lonRaw);
    }

    records.push({
      city: cleanString(row[COL.city]),
      manager: cleanString(row[COL.manager]),
      clientCode,
      clientName,
      route: cleanString(row[COL.route]),
      address,
      isPrimary: cleanString(row[COL.isPrimary]) === 'Да',
      deliveryType: cleanString(row[COL.deliveryType]),
      phone: cleanString(row[COL.phone]),
      latitude,
      longitude,
    });
  }

  return { records, collector };
}

module.exports = { parseAddresses };
