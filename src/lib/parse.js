'use strict';

// Small, dependency-free parsing helpers shared by every source parser.
// Kept separate from validate.js so parsers can call these without pulling
// in the ValidationError bookkeeping.

/**
 * 1C exports dates as plain "DD.MM.YYYY" text cells (not Excel date serials)
 * in every source file we received. Returns a Date at UTC midnight, or null.
 */
function parseRuDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null; // e.g. 31.02.2026
  }
  return date;
}

/**
 * "Заказ клиента PH00-0374172 от 23.06.2026 16:53:09" -> Date, or null.
 * Used for the debt file's order rows (finest-grain payment date).
 */
function parseRuDateTimeFromText(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return parseRuDate(`${m[1]}.${m[2]}.${m[3]}`);
}

/**
 * Numeric cells in these files are read with {raw:true}, so xlsx already
 * gives back a JS number for genuine numeric cells (the "17,716" you see in
 * a raw:false dump is only the display format's thousands separator, the
 * underlying value is 17716). This helper is for the rare case a numeric
 * column arrives as text (e.g. a blank formatted as string, or stray
 * whitespace), and normalizes those without reinterpreting real numbers.
 */
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === '') return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Coordinates arrive as text with mixed decimal separators — "43,304144"
 * and "43.321121" both appear in the same column (ТЗ 4.4 flags this
 * explicitly). Normalizes to a float and range-checks against Kazakhstan's
 * bounding box; returns null (not a throw) for out-of-range/unparseable
 * input so callers can turn it into a validation error with row context.
 */
function parseCoordinate(value, kind) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim().replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const bounds = kind === 'lat' ? [40, 56] : [46, 88];
  if (n < bounds[0] || n > bounds[1]) return null;
  return n;
}

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

module.exports = {
  parseRuDate,
  parseRuDateTimeFromText,
  toNumberOrNull,
  parseCoordinate,
  cleanString,
};
