import assert from 'node:assert/strict';

const cargoApi = await import('./cargo.js');
const api = cargoApi as unknown as {
  manualVesselCargoToCargoForTest?: (data: { vesselName: string; arrivalDate: Date }) => Record<string, unknown>;
  buildDistinctVesselItemsForTest?: (rows: Array<{ vesselName: string; dateOfArrival: Date }>) => Array<{
    vesselName: string;
    arrivalDate: string;
  }>;
  vesselRowMergeDataForTest?: (row: {
    manifestRef: string;
    consigneeName: string;
    mark: string;
    commodity: string;
    cargoDescription: string;
    pkgsType: string;
    noOfPkgs: number;
    clearedQty: number;
    remarks: string;
  }) => Record<string, unknown>;
};

assert.equal(typeof api.manualVesselCargoToCargoForTest, 'function');
assert.equal(typeof api.buildDistinctVesselItemsForTest, 'function');
assert.equal(typeof api.vesselRowMergeDataForTest, 'function');

const manualCargo = api.manualVesselCargoToCargoForTest!({
  vesselName: 'VB progress',
  arrivalDate: new Date('2026-05-17'),
});

assert.equal(manualCargo.vesselName, 'VB Progress');
assert.equal(manualCargo.dateOfArrival?.toString(), new Date('2026-05-17').toString());
assert.equal(manualCargo.containerNo, 'VESSEL');
assert.equal(manualCargo.blNo, 'PENDING');
assert.equal(manualCargo.consigneeName, 'Unknown Consignee');
assert.equal(manualCargo.commodity, 'GENERAL CARGO');
assert.equal(manualCargo.cargoDescription, 'Unidentified general cargo');
assert.equal(manualCargo.pkgsType, 'PKG');
assert.equal(manualCargo.noOfPkgs, 0);
assert.equal(manualCargo.reasonOfShifting, 'Manual vessel intake');
assert.equal(manualCargo.currentSlotId, null);

assert.deepEqual(api.buildDistinctVesselItemsForTest!([
  { vesselName: 'VB Progress', dateOfArrival: new Date('2026-05-16') },
  { vesselName: 'VB progress', dateOfArrival: new Date('2026-05-16') },
  { vesselName: '  vb   progress  ', dateOfArrival: new Date('2026-05-16') },
  { vesselName: 'VB Progress', dateOfArrival: new Date('2026-05-17') },
]), [
  { vesselName: 'VB Progress', arrivalDate: '2026-05-16' },
  { vesselName: 'VB Progress', arrivalDate: '2026-05-17' },
]);

const mergeData = api.vesselRowMergeDataForTest!({
  manifestRef: 'SEAANGEL/V034/20',
  consigneeName: 'AFCONS INFRASTRUCTURE LIMITED',
  mark: 'AFCONS / MALE',
  commodity: 'GENERAL CARGO',
  cargoDescription: 'Coupler',
  pkgsType: 'PKG',
  noOfPkgs: 9,
  clearedQty: 0,
  remarks: 'Handle with care',
});

assert.deepEqual(mergeData, {
  blNo: 'SEAANGEL/V034/20',
  consigneeName: 'AFCONS INFRASTRUCTURE LIMITED',
  mark: 'AFCONS / MALE',
  commodity: 'GENERAL CARGO',
  cargoDescription: 'Coupler',
  pkgsType: 'PKG',
  noOfPkgs: 9,
  remarks: '',
  reasonOfShifting: 'Vessel intake',
});

console.log('vessel cargo merge tests passed');
