// Test helpers: builds small .xlsx files in memory, shaped like the park's CMS export.
// Lives outside scraper/test/ so `node --test` doesn't run it as a test file.
import { deflateRawSync } from 'node:zlib';

/** A zip of [name, text, deflate] entries (no CRCs: readXlsx doesn't check them). */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(deflate ? 8 : 0, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(head, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

export const WORKBOOK = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="sheet 1" sheetId="1" r:id="rId1"/></sheets></workbook>';
export const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = i => String.fromCharCode(65 + i); // A–Z is enough for the export's 9 columns

/** A one-sheet workbook of inline strings, like the CMS export. '' becomes a missing cell. */
export function xlsxOf(rows) {
  const cells = (r, y) => r.map((v, x) => (v === '' ? '' : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, y) => `<row r="${y + 1}">${cells(r, y)}</row>`).join('')}</sheetData></worksheet>`;
  return zip([['xl/workbook.xml', WORKBOOK, true], ['xl/_rels/workbook.xml.rels', RELS, false], ['xl/worksheets/sheet1.xml', sheet, true]]);
}
