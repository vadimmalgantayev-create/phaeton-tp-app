'use strict';

const fs = require('fs');
const readline = require('readline');
const { ValidationCollector } = require('../lib/validation');

// ТЗ PHA-88 Блок 1.3: только эти 8 пары (ФИО, регион) — реальные ТП, которые
// должны попасть в выпадающий список входа (6 Алматы + 2 Кар-Сити,
// добавленные этой задачей). Белый список, а не чёрный: в файле встречается
// ~13 других имён в колонке manager (Web, web розница26, Разовый клиент,
// Сотрудник, ФИО сотрудников бэк-офиса...), а ТЗ прямо пишет "и т.п." про
// служебные строки — значит их перечень не гарантированно полон.
//
// Пара (имя, регион), а не голое имя: managers.xlsx (адреса/скидки/ДЗ/нет
// накладных) несёт свой отдельный, гораздо более широкий ростер менеджеров
// компании (~50 ФИО из разных регионов/бизнесов), и в нём совпадением
// встречается менеджер с тем же ФИО "Блалов Илияр"/"Жумагулов Айдос", но
// привязанный к другому региону (обнаружено QA-сверкой контрольных сумм
// ТЗ Блок 4 -- см. load.js). Если сверять только по имени, такой
// однофамилец из другого источника тоже пометится как "реальный ТП" и
// продублирует его в списке входа под чужим (нулевым по продажам)
// менеджером. Регион в паре снимает эту неоднозначность.
const REAL_MANAGERS = [
  { name: 'Жумагулов Айдос', region: 'Алматы' },
  { name: 'Азнабаев Медет', region: 'Алматы' },
  { name: 'Есентаев Ернур', region: 'Алматы' },
  { name: 'Агаев Шамиль', region: 'Алматы' },
  { name: 'Есентаев Арнур', region: 'Алматы' },
  { name: 'Садылкин Андрей', region: 'Алматы' },
  { name: 'Блалов Илияр', region: 'Кар-Сити' },
  { name: 'Курбанов Ринат', region: 'Кар-Сити' },
];

function isRealManager(name, regionName) {
  return REAL_MANAGERS.some((m) => m.name === name && m.region === regionName);
}

const EXPECTED_HEADER = [
  'region',
  'manager',
  'client',
  'product_group',
  'brand',
  'sku',
  'month',
  'volume_l',
  'revenue_kzt',
  'revenue_eur',
];

function parseMonth(value) {
  const m = String(value).trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function parseNum(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Разбивает одну строку CSV по ';'. Файл (см. samples/sales_sku.csv) — это
 * плоская построчная выгрузка 1С без кавычек/экранирования (проверено на
 * всех 437 620 строках при написании этого загрузчика: ни одно поле не
 * содержит ';' или переноса строки внутри значения), поэтому простой split
 * достаточен и не тянет csv-parse как зависимость. Если следующая выгрузка
 * 1С начнёт квотировать поля — этот split молча даст неверные колонки,
 * поэтому именно это и есть первое место для проверки, если контрольные
 * суммы (ТЗ Блок 4) перестанут сходиться.
 */
function splitLine(line) {
  return line.split(';');
}

/**
 * Потоково читает sales_sku.csv (ТЗ Блок 0/1.1): 437 620 строк / ~60МБ не
 * должны целиком лежать в памяти на Render free tier (512МБ), поэтому файл
 * читается построчно через readline поверх fs.createReadStream, а не через
 * fs.readFileSync/парсер, который сначала грузит всё содержимое. Разобранные
 * строки складываются в батч и отдаются вызывающему коду через `onBatch`
 * каждые `batchSize` строк (по умолчанию 2000 — нижняя граница диапазона
 * 2000–5000 из ТЗ: замер на реальном файле показал, что более крупные
 * батчи заметно поднимают пиковый RSS процесса, а лимит Render free tier —
 * 512МБ) — так вызывающая сторона может делать `createMany` пачками вместо
 * await на каждую строку, а сам поток при этом не ждёт, пока весь файл
 * окажется в памяти.
 *
 * `collector` пишется вызывающей стороной заранее (см. load.js) и просто
 * заполняется здесь — так его можно передать в резолверы клиента/менеджера
 * внутри `onBatch` ещё до того, как этот проход по файлу завершится.
 */
async function streamSaleSkuRows(filePath, collector, onBatch, batchSize = 2000) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let batch = [];
  let rowNumber = 0;
  let headerChecked = false;

  for await (const rawLine of rl) {
    rowNumber += 1;
    const line = rowNumber === 1 ? rawLine.replace(/^\uFEFF/, '') : rawLine; // BOM only on line 1
    if (line === '') continue; // trailing newline at EOF

    if (!headerChecked) {
      headerChecked = true;
      const header = splitLine(line).map((h) => h.trim());
      const matches = EXPECTED_HEADER.length === header.length && EXPECTED_HEADER.every((h, i) => header[i] === h);
      if (!matches) {
        collector.countRow();
        collector.fail(rowNumber, 'Заголовок', `Неожиданный заголовок CSV (колонки переставлены/переименованы?): "${line}"`, line);
        break; // без правильного заголовка позиции колонок ниже недостоверны
      }
      continue;
    }

    collector.countRow();
    const cols = splitLine(line);
    if (cols.length !== EXPECTED_HEADER.length) {
      collector.fail(rowNumber, 'Колонки', `Ожидалось ${EXPECTED_HEADER.length} колонок через ';', получено ${cols.length}`, line);
      continue;
    }

    const [region, manager, client, productGroup, brand, sku, monthRaw, volumeLRaw, revenueKztRaw, revenueEurRaw] = cols.map((c) =>
      c.trim()
    );
    const month = parseMonth(monthRaw);
    // `brand` НЕ входит в обязательные -- 8 строк реального файла (все с
    // product_group "Набор") приходят с пустым brand, и ТЗ Блок 4 требует
    // ровно 437 620 записей SaleSku (== строк CSV), т.е. такие строки нужно
    // грузить, а не отбрасывать как невалидные (пустая строка — валидное
    // значение String в Prisma).
    if (!region || !manager || !client || !productGroup || !sku || !month) {
      collector.fail(
        rowNumber,
        'Обязательные поля',
        'Пустое или нераспознанное значение в region/manager/client/product_group/sku/month',
        line
      );
      continue;
    }

    batch.push({
      region,
      manager,
      client,
      productGroup,
      brand,
      sku,
      month,
      volumeL: parseNum(volumeLRaw),
      revenueKzt: parseNum(revenueKztRaw),
      revenueEur: parseNum(revenueEurRaw),
    });

    if (batch.length >= batchSize) {
      await onBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) await onBatch(batch);
}

module.exports = { streamSaleSkuRows, REAL_MANAGERS, isRealManager, EXPECTED_HEADER };
