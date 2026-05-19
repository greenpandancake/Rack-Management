export type VesselManifestRow = {
  manifestRef: string;
  consigneeName: string;
  mark: string;
  commodity: string;
  cargoDescription: string;
  pkgsType: string;
  noOfPkgs: number;
  clearedQty: number;
  remarks: string;
};

export type ParsedVesselManifest = {
  vesselName: string;
  arrivalDate: string;
  eligible: VesselManifestRow[];
  excluded: VesselManifestRow[];
};

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

const PACKAGE_TYPES = new Set([
  'BAG',
  'BAGS',
  'BND',
  'BUN',
  'CTN',
  'CTNS',
  'GNY',
  'PCS',
  'PKG',
  'PKGS',
  'ROLL',
  'ROLLS',
]);

const GENERAL_CARGO = 'GENERAL CARGO';

const SKIP_TOKENS = new Set([
  'Calibri',
  'Report',
  'Consignee',
  'Commodity',
  'Qty',
  'Cleared Qty',
  'Root Entry',
  'SummaryInformation',
  'Workbook',
  'DocumentSummaryInformation',
  'Oh',
  'Voyage Cargo Report',
  'Spreadsheet export',
]);

const PERISHABLE_KEYWORDS = [
  'apple',
  'banana',
  'beans',
  'beet root',
  'bottle gourd',
  'brinjal',
  'cabbage',
  'carrot',
  'cauliflower',
  'chilly',
  'chilli',
  'colocasia',
  'coconut',
  'cucumber',
  'drum stick',
  'drumstick',
  'egg',
  'fruit',
  'garlic',
  'ginger',
  'goose berry',
  'gourd',
  'grape',
  'green chilly',
  'hot chilly',
  'ladies finger',
  'lemon',
  'lettuce',
  'lime',
  'mango',
  'melon',
  'milk',
  'okra',
  'onion',
  'papaya',
  'pineapple',
  'potato',
  'pomegranate',
  'pumpkin',
  'shallot',
  'tomato',
  'vegetable',
  'watermelon',
  'yam',
];

export function isPerishableCommodity(commodity: string): boolean {
  const normalized = commodity.toLowerCase().replace(/\s+/g, ' ').trim();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return PERISHABLE_KEYWORDS.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, ' ').trim();
    const compactKeyword = normalizedKeyword.replace(/[^a-z0-9]/g, '');
    return containsWholeTerm(normalized, normalizedKeyword) || compact.includes(compactKeyword);
  });
}

function containsWholeTerm(value: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(value);
}

export function parseManifestBuffer(buffer: Buffer, fileName: string): ParsedVesselManifest {
  const rows = parseWorkbookRows(buffer);
  if (rows.length > 0) return parseManifestRows(rows, fileName);
  return parseManifestText(extractText(buffer), fileName);
}

export function parseManifestText(text: string, fileName: string): ParsedVesselManifest {
  const tokens = tokenize(text).filter((token) => !SKIP_TOKENS.has(token));
  const vesselName = parseVesselName(fileName, tokens);
  const arrivalDate = parseArrivalDate(fileName, tokens);
  const rows: VesselManifestRow[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const ref = tokens[i];
    if (!isManifestRef(ref)) continue;

    const nextRefIndex = tokens.findIndex((token, index) => index > i && isManifestRef(token));
    const chunk = tokens.slice(i + 1, nextRefIndex === -1 ? tokens.length : nextRefIndex);
    const rowParts = parseManifestChunk(chunk);
    rows.push(...rowParts.map((part) => ({ manifestRef: ref, ...part })));
  }

  const eligible = rows.filter((row) => !isPerishableCommodity(row.cargoDescription));
  const excluded = rows.filter((row) => isPerishableCommodity(row.cargoDescription));
  return { vesselName, arrivalDate, eligible, excluded };
}

function parseManifestRows(grid: string[][], fileName: string): ParsedVesselManifest {
  const flattened = grid.flat().filter(Boolean);
  const vesselName = parseVesselName(fileName, flattened);
  const arrivalDate = parseArrivalDate(fileName, flattened);
  const headerIndex = grid.findIndex((row) => row.some((cell) => normalizeHeader(cell) === 'blno'));
  if (headerIndex === -1) return parseManifestText(flattened.join('\n'), fileName);

  const headers = grid[headerIndex].map(normalizeHeader);
  const col = (...names: string[]) => names.map(normalizeHeader).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const refCol = col('B/L No', 'BL No', 'Manifest Ref');
  const consigneeCol = col('Consignee');
  const markCol = col('Mark');
  const commodityCol = col('Commodity');
  const packageCol = col('Package Type', 'Pkg');
  const qtyCol = col('Qty');
  const clearedCol = col('Cleared Qty');
  const rows: VesselManifestRow[] = [];
  let currentRef = '';
  let currentConsignee = '';
  let currentMark = '';
  let currentPkgsType = 'PKG';

  for (const row of grid.slice(headerIndex + 1)) {
    const ref = cell(row, refCol);
    if (ref) currentRef = ref;
    if (!currentRef) continue;

    const consignee = cell(row, consigneeCol);
    const mark = cell(row, markCol);
    const pkgsType = cell(row, packageCol);
    if (consignee) currentConsignee = consignee;
    if (mark) currentMark = mark;
    if (pkgsType && PACKAGE_TYPES.has(pkgsType.toUpperCase())) currentPkgsType = pkgsType.toUpperCase();

    const cargoDescription = cell(row, commodityCol);
    if (!cargoDescription || !isCommodityToken(cargoDescription)) continue;

    rows.push({
      manifestRef: currentRef,
      consigneeName: currentConsignee || 'Unknown Consignee',
      mark: currentMark,
      commodity: GENERAL_CARGO,
      cargoDescription,
      pkgsType: currentPkgsType,
      noOfPkgs: parseIntegerCell(cell(row, qtyCol)),
      clearedQty: parseIntegerCell(cell(row, clearedCol)),
      remarks: '',
    });
  }

  const eligible = rows.filter((row) => !isPerishableCommodity(row.cargoDescription));
  const excluded = rows.filter((row) => isPerishableCommodity(row.cargoDescription));
  return { vesselName, arrivalDate, eligible, excluded };
}

export const parseManifestRowsForTest = parseManifestRows;

function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : '';
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseIntegerCell(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function extractText(buffer: Buffer): string {
  const utf16 = buffer.toString('utf16le');
  const latin = buffer.toString('latin1');
  return `${utf16}\n${latin}`;
}

function tokenize(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9 /.,:;()#&-]{2,}/g) ?? [];
  return matches.map((token) => token.replace(/\s+/g, ' ').trim()).filter((token) => token.length > 1);
}

function parseVesselName(fileName: string, tokens: string[]): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const source = baseName || tokens.find((token) => /\bon\b/i.test(token)) || '';
  const clean = source.replace(/\.[^.]+$/, '');
  const match = clean.match(/^(.+?),?\s+on\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$/i);
  return (match?.[1] ?? clean).trim() || 'Vessel';
}

function parseArrivalDate(fileName: string, tokens: string[]): string {
  const source = [fileName, ...tokens].join('\n');
  const match = source.match(/\bon\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})\b/i);
  if (!match) return new Date().toISOString().slice(0, 10);
  const day = match[1].padStart(2, '0');
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()] ?? '01';
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return `${year}-${month}-${day}`;
}

function isManifestRef(token: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]*\/[A-Z0-9-]+\/\d+$/i.test(token);
}

function parseManifestChunk(chunk: string[]): Array<Omit<VesselManifestRow, 'manifestRef'>> {
  if (chunk.length < 2) return [];
  const consigneeName = chunk[0] ?? 'Unknown Consignee';
  const hasMark = chunk.length > 2 && !PACKAGE_TYPES.has((chunk[1] ?? '').toUpperCase());
  const mark = hasMark ? chunk[1] : '';
  let cursor = hasMark ? 2 : 1;
  let pkgsType = 'PKG';

  if (PACKAGE_TYPES.has((chunk[cursor] ?? '').toUpperCase())) {
    pkgsType = chunk[cursor].toUpperCase();
    cursor++;
  }

  const cargoDescriptions = chunk.slice(cursor).filter((token) => isCommodityToken(token));
  return cargoDescriptions.map((cargoDescription) => ({
    consigneeName,
    mark,
    commodity: GENERAL_CARGO,
    cargoDescription,
    pkgsType,
    noOfPkgs: 0,
    clearedQty: 0,
    remarks: '',
  }));
}

function parseWorkbookRows(buffer: Buffer): string[][] {
  const workbook = extractWorkbookStream(buffer);
  if (!workbook) return [];
  const sharedStrings = parseSharedStrings(workbook);
  const rows = new Map<number, Map<number, string>>();
  forEachBiffRecord(workbook, (id, payload) => {
    if (id === 0x00fd && payload.length >= 10) {
      setGridCell(rows, payload.readUInt16LE(0), payload.readUInt16LE(2), sharedStrings[payload.readUInt32LE(6)] ?? '');
    } else if (id === 0x0204 && payload.length >= 8) {
      const length = payload.readUInt16LE(6);
      setGridCell(rows, payload.readUInt16LE(0), payload.readUInt16LE(2), payload.toString('latin1', 8, 8 + length));
    } else if (id === 0x027e && payload.length >= 10) {
      setGridCell(rows, payload.readUInt16LE(0), payload.readUInt16LE(2), String(decodeRk(payload.readUInt32LE(6))));
    } else if (id === 0x0203 && payload.length >= 14) {
      setGridCell(rows, payload.readUInt16LE(0), payload.readUInt16LE(2), String(payload.readDoubleLE(6)));
    }
  });
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => {
      const maxCol = Math.max(...cols.keys());
      return Array.from({ length: maxCol + 1 }, (_, index) => cols.get(index) ?? '');
    });
}

function setGridCell(rows: Map<number, Map<number, string>>, row: number, col: number, value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  if (!rows.has(row)) rows.set(row, new Map());
  rows.get(row)!.set(col, clean);
}

function parseSharedStrings(workbook: Buffer): string[] {
  const strings: string[] = [];
  forEachBiffRecord(workbook, (id, payload) => {
    if (id !== 0x00fc || payload.length < 8) return;
    let offset = 8;
    const count = payload.readUInt32LE(4);
    for (let i = 0; i < count && offset < payload.length; i++) {
      const parsed = readXlString(payload, offset);
      if (!parsed) break;
      strings.push(parsed.value);
      offset = parsed.nextOffset;
    }
  });
  return strings;
}

function readXlString(payload: Buffer, offset: number): { value: string; nextOffset: number } | null {
  if (offset + 3 > payload.length) return null;
  const chars = payload.readUInt16LE(offset);
  const flags = payload[offset + 2];
  offset += 3;
  const richTextRuns = flags & 0x08 ? payload.readUInt16LE(offset) : 0;
  if (flags & 0x08) offset += 2;
  const extSize = flags & 0x04 ? payload.readUInt32LE(offset) : 0;
  if (flags & 0x04) offset += 4;
  const byteLength = chars * (flags & 0x01 ? 2 : 1);
  if (offset + byteLength > payload.length) return null;
  const value = flags & 0x01
    ? payload.toString('utf16le', offset, offset + byteLength)
    : payload.toString('latin1', offset, offset + byteLength);
  return { value, nextOffset: offset + byteLength + richTextRuns * 4 + extSize };
}

function forEachBiffRecord(buffer: Buffer, callback: (id: number, payload: Buffer) => void) {
  for (let offset = 0; offset + 4 <= buffer.length;) {
    const id = buffer.readUInt16LE(offset);
    const length = buffer.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + length > buffer.length) break;
    callback(id, buffer.subarray(offset, offset + length));
    offset += length;
  }
}

function decodeRk(raw: number): number {
  let value: number;
  if (raw & 0x02) value = raw >> 2;
  else {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(raw & 0xfffffffc, 4);
    value = bytes.readDoubleLE(0);
  }
  return raw & 0x01 ? value / 100 : value;
}

function extractWorkbookStream(buffer: Buffer): Buffer | null {
  if (buffer.toString('hex', 0, 8) !== 'd0cf11e0a1b11ae1') return null;
  const sectorSize = 1 << buffer.readUInt16LE(30);
  const fatSectorCount = buffer.readUInt32LE(44);
  const firstDirectorySector = buffer.readInt32LE(48);
  const difat = Array.from({ length: 109 }, (_, i) => buffer.readInt32LE(76 + i * 4)).filter((s) => s >= 0);
  const fat: number[] = [];
  for (const sector of difat.slice(0, fatSectorCount)) {
    const start = sectorOffset(sector, sectorSize);
    for (let pos = start; pos < start + sectorSize; pos += 4) fat.push(buffer.readInt32LE(pos));
  }
  const directory = readSectorChain(buffer, fat, firstDirectorySector, sectorSize);
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const entry = directory.subarray(offset, offset + 128);
    const nameLength = entry.readUInt16LE(64);
    const name = entry.toString('utf16le', 0, Math.max(0, nameLength - 2));
    if (name !== 'Workbook' && name !== 'Book') continue;
    const startSector = entry.readInt32LE(116);
    const size = entry.readUInt32LE(120);
    return readSectorChain(buffer, fat, startSector, sectorSize).subarray(0, size);
  }
  return null;
}

function readSectorChain(buffer: Buffer, fat: number[], startSector: number, sectorSize: number): Buffer {
  const chunks: Buffer[] = [];
  const seen = new Set<number>();
  for (let sector = startSector; sector >= 0 && sector !== -2 && !seen.has(sector); sector = fat[sector]) {
    seen.add(sector);
    chunks.push(buffer.subarray(sectorOffset(sector, sectorSize), sectorOffset(sector, sectorSize) + sectorSize));
  }
  return Buffer.concat(chunks);
}

function sectorOffset(sector: number, sectorSize: number): number {
  return (sector + 1) * sectorSize;
}

function isCommodityToken(token: string): boolean {
  if (SKIP_TOKENS.has(token)) return false;
  if (isManifestRef(token)) return false;
  if (PACKAGE_TYPES.has(token.toUpperCase())) return false;
  if (/^\d+(\.\d+)?$/.test(token)) return false;
  if (looksLikeCompanyName(token)) return false;
  return true;
}

function looksLikeCompanyName(token: string): boolean {
  const normalized = token.toLowerCase();
  return /\b(pvt ltd|private limited|limited|plc|and co|investment|investments|enterprise|enterprises|trading|trade|company|brothers|mart|supply|supplies)\b/.test(normalized);
}
