/**
 * Read the first sheet of an Excel (.xlsx) or CSV file into rows of text, in the
 * browser, with no extra package. An .xlsx file is a zip of XML files; the browser's
 * DecompressionStream inflates them.
 */

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** name -> file bytes for the files we need from the zip. */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    out.set(name, method === 0 ? raw : await inflate(raw));
  }
  return out;
}

const xml = (bytes: Uint8Array | undefined) =>
  bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml') : null;
const all = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => (n.startsWith('xl/') && n.endsWith('.xml')) || n.endsWith('.rels'));
  // First sheet in the workbook, through its relationship id.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = xml(files.get('xl/workbook.xml'));
  const rels = xml(files.get('xl/_rels/workbook.xml.rels'));
  const first = wb ? all(wb, 'sheet')[0] : undefined;
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = rels && rid ? all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') : null;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;

  const shared = xml(files.get('xl/sharedStrings.xml'));
  const strings = shared ? all(shared, 'si').map((si) => all(si, 't').map((t) => t.textContent ?? '').join('')) : [];
  const sheet = xml(files.get(sheetPath));
  if (!sheet) throw new Error('The first sheet could not be read');

  const rows: string[][] = [];
  for (const row of all(sheet, 'row')) {
    const cells: string[] = [];
    all(row, 'c').forEach((c, i) => {
      const ref = c.getAttribute('r');
      const idx = ref ? colIndex(ref) : i;
      const t = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      let text = v;
      if (t === 's') text = strings[Number(v)] ?? '';
      else if (t === 'inlineStr') text = all(c, 't').map((x) => x.textContent ?? '').join('');
      cells[idx] = text.trim();
    });
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}

function readCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

export async function readSheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return readCsv(await file.text());
  if (name.endsWith('.xlsx')) return readXlsx(await file.arrayBuffer());
  throw new Error('Choose an Excel (.xlsx) or CSV file. Old .xls files: open in Excel and Save As .xlsx.');
}

/** Excel stores dates as a day count from 1899-12-30; show them as YYYY-MM-DD. */
export function excelDate(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) return value;
  const n = Number(value);
  if (n < 20000 || n > 80000) return value;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return d.toISOString().slice(0, 10);
}
