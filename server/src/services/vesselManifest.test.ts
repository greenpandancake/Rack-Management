import assert from 'node:assert/strict';
import { isPerishableCommodity, parseManifestRowsForTest, parseManifestText } from './vesselManifest.js';

const sampleText = [
  'Report',
  'Sea Angel, on 17 May 26',
  'Consignee',
  'Mark',
  'Commodity',
  'Qty',
  'Cleared Qty',
  'SEAANGEL/V034/01',
  'MUDUVAALI',
  'MUDUVAALI/MALE',
  'BAG',
  'Tomatoes',
  'SEAANGEL/V034/18',
  'AFCONS INFRASTRUCTURE LIMITED',
  'AFCONS INFRASTRUCTURE LIMITED',
  'PCS',
  'Coupler',
  'SEAANGEL/V034/19',
  'AFCONS INFRASTRUCTURE LIMITED',
  'PCS',
  'Wheel',
  'VB-437/TU/30',
  'RASHEED AND CO',
  'CTN',
  'Eastern garam masala',
  'VB-437/TU/14',
  'MALA FAMILY Pvt Ltd',
  'CTN',
  'milk',
].join('\n');

assert.equal(isPerishableCommodity('Tomatoes'), true);
assert.equal(isPerishableCommodity('milk'), true);
assert.equal(isPerishableCommodity('Cabbage'), true);
assert.equal(isPerishableCommodity('Shallot'), true);
assert.equal(isPerishableCommodity('Drumstick'), true);
assert.equal(isPerishableCommodity('Drum Stick'), true);
assert.equal(isPerishableCommodity('Lemon'), true);
assert.equal(isPerishableCommodity('Coupler'), false);
assert.equal(isPerishableCommodity('Eastern garam masala'), false);

const parsed = parseManifestText(sampleText, 'Sea Angel, on 17 May 26.xls');
const parsedFromPath = parseManifestText(sampleText, '../Warehouse voyage files/Sea Angel, on 17 May 26.xls');

assert.equal(parsed.vesselName, 'Sea Angel');
assert.equal(parsedFromPath.vesselName, 'Sea Angel');
assert.equal(parsed.arrivalDate, '2026-05-17');
assert.deepEqual(
  parsed.eligible.map((row) => row.commodity),
  ['GENERAL CARGO', 'GENERAL CARGO', 'GENERAL CARGO'],
);
assert.deepEqual(
  parsed.eligible.map((row) => row.cargoDescription),
  ['Coupler', 'Wheel', 'Eastern garam masala'],
);
assert.deepEqual(
  parsed.excluded.map((row) => row.cargoDescription),
  ['Tomatoes', 'milk'],
);
assert.equal(parsed.eligible[0].manifestRef, 'SEAANGEL/V034/18');
assert.equal(parsed.eligible[0].consigneeName, 'AFCONS INFRASTRUCTURE LIMITED');
assert.equal(parsed.eligible[0].mark, 'AFCONS INFRASTRUCTURE LIMITED');
assert.equal(parsed.eligible[0].commodity, 'GENERAL CARGO');
assert.equal(parsed.eligible[0].cargoDescription, 'Coupler');
assert.equal(parsed.eligible[0].pkgsType, 'PCS');
assert.equal(parsed.eligible[0].noOfPkgs, 0);

const parsedGrid = parseManifestRowsForTest([
  ['Cargo Report'],
  ['Ebenezer, on 06 May 26'],
  ['B/L No', 'Consignee', 'Mark', 'Commodity', 'Package Type', 'Qty', 'Cleared Qty'],
  ['1', 'MAZZO Pvt Ltd', 'KAASANFARU MALE', 'Cutting Wheel', 'PKG', '26', ''],
  ['OGLMLE2026274', 'MFAR KUDAVILLINGILI Pvt Ltd', 'AS PER B/L', 'Marine Plywood', 'PKG', '4', ''],
  ['FD/TUT-MV/26-27/005A', 'MRAC Pvt Ltd', 'ULLAANEE FALHU RESORT', 'SIKACERAM', 'PKG', '250', ''],
], 'Ebenezer, on 06 May 26.xls');

assert.deepEqual(
  parsedGrid.eligible.map((row) => row.manifestRef),
  ['1', 'OGLMLE2026274', 'FD/TUT-MV/26-27/005A'],
);
assert.deepEqual(
  parsedGrid.eligible.map((row) => row.cargoDescription),
  ['Cutting Wheel', 'Marine Plywood', 'SIKACERAM'],
);
assert.equal(parsedGrid.eligible[0].noOfPkgs, 26);

console.log('vesselManifest tests passed');
