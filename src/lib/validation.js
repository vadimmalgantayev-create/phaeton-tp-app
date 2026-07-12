'use strict';

// Collects validation problems for one source file load without throwing,
// so a handful of bad rows don't abort the whole daily load (ТЗ 6.12:
// "отчёт об ошибках/пропусках до применения"). Rows with errors are skipped
// from the DB write but still counted, so rowsOk + rowsError == rowsTotal.

class ValidationCollector {
  constructor(sourceType) {
    this.sourceType = sourceType;
    this.errors = [];
    this.rowsTotal = 0;
    this.rowsError = 0;
  }

  countRow() {
    this.rowsTotal += 1;
  }

  /** Marks the row just counted as failed and records why. */
  fail(rowNumber, field, message, rawValue) {
    this.rowsError += 1;
    this.errors.push({
      sheet: this.sourceType,
      rowNumber: rowNumber ?? null,
      field: field ?? null,
      message,
      rawValue: rawValue === undefined || rawValue === null ? null : String(rawValue).slice(0, 500),
    });
  }

  /**
   * Records a non-blocking observation (e.g. a client referenced by name in
   * this file but absent from the addresses master list, so a stub was
   * created) — visible in the load's error report for traceability, but
   * does not count against rowsError/status since the row itself was well
   * formed.
   */
  note(rowNumber, field, message, rawValue) {
    this.errors.push({
      sheet: this.sourceType,
      rowNumber: rowNumber ?? null,
      field: field ?? null,
      message: `Инфо: ${message}`,
      rawValue: rawValue === undefined || rawValue === null ? null : String(rawValue).slice(0, 500),
    });
  }

  get rowsOk() {
    return this.rowsTotal - this.rowsError;
  }

  get status() {
    if (this.rowsTotal === 0) return 'failed';
    if (this.rowsError === 0) return 'success';
    if (this.rowsError === this.rowsTotal) return 'failed';
    return 'partial';
  }
}

module.exports = { ValidationCollector };
