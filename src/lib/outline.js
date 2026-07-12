'use strict';

const fs = require('fs');
const JSZip = require('jszip');

// The debt and sales files are 1C "outline" pivot exports: hierarchy
// (region -> manager -> client -> ... ) is flattened into plain rows, with
// the nesting depth stored as the row's `outlineLevel` attribute in the
// sheet XML. SheetJS's sheet_to_json() only returns cell values, not this
// row metadata, so we read it directly out of the xlsx zip. See
// README.md "Как определяется иерархия строк" for why this is more robust
// than guessing depth from indentation or a hardcoded name whitelist.

async function getSheetXmlPath(zip, sheetName) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetMatch = new RegExp(`<sheet[^>]*name="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*r:id="(rId\\d+)"`).exec(workbookXml);
  if (!sheetMatch) throw new Error(`Sheet "${sheetName}" not found in workbook.xml`);
  const relId = sheetMatch[1];
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relMatch = new RegExp(`<Relationship Id="${relId}"[^>]*Target="([^"]+)"`).exec(relsXml);
  if (!relMatch) throw new Error(`Relationship ${relId} not found for sheet "${sheetName}"`);
  return `xl/${relMatch[1]}`;
}

/**
 * Returns a Map<rowNumberOneBased, outlineLevel> for every row in the sheet
 * that carries an explicit outlineLevel attribute. Rows absent from the map
 * are level 0 (top of the hierarchy).
 */
async function getRowOutlineLevels(filePath, sheetName) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const xmlPath = await getSheetXmlPath(zip, sheetName);
  const xml = await zip.file(xmlPath).async('string');
  const levels = new Map();
  const re = /<row r="(\d+)"[^>]*outlineLevel="(\d+)"[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    levels.set(Number(m[1]), Number(m[2]));
  }
  return levels;
}

module.exports = { getRowOutlineLevels };
