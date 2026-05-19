import assert from 'node:assert/strict';

const cargoApi = await import('./cargo.js');
const vesselRowToCargo = (cargoApi as unknown as {
  vesselRowToCargoForTest?: (
    data: { vesselName: string; arrivalDate: Date },
    row: {
      manifestRef: string;
      consigneeName: string;
      mark: string;
      commodity: string;
      cargoDescription: string;
      pkgsType: string;
      noOfPkgs: number;
      clearedQty: number;
      remarks: string;
    },
  ) => Record<string, unknown>;
}).vesselRowToCargoForTest;

assert.equal(typeof vesselRowToCargo, 'function');

const cargo = vesselRowToCargo!(
  { vesselName: 'vb progress', arrivalDate: new Date('2026-05-17') },
  {
    manifestRef: 'SEAANGEL/V034/20',
    consigneeName: 'AFCONS INFRASTRUCTURE LIMITED',
    mark: 'AFCONS / MALE',
    commodity: 'GENERAL CARGO',
    cargoDescription: 'Coupler',
    pkgsType: 'PKG',
    noOfPkgs: 9,
    clearedQty: 0,
    remarks: 'Handle with care',
  },
);

assert.equal(cargo.vesselName, 'VB Progress');
assert.equal(cargo.mark, 'AFCONS / MALE');
assert.equal(cargo.commodity, 'GENERAL CARGO');
assert.equal(cargo.cargoDescription, 'Coupler');
assert.equal(cargo.remarks, '');

const cargoWithoutRemarks = vesselRowToCargo!(
  { vesselName: 'Sea Angel', arrivalDate: new Date('2026-05-17') },
  {
    manifestRef: 'SEAANGEL/V034/20',
    consigneeName: 'AFCONS INFRASTRUCTURE LIMITED',
    mark: 'AFCONS / MALE',
    commodity: 'GENERAL CARGO',
    cargoDescription: 'Coupler',
    pkgsType: 'PKG',
    noOfPkgs: 9,
    clearedQty: 4,
    remarks: '',
  },
);

assert.equal(cargoWithoutRemarks.remarks, '');

const manualDetailedCargo = vesselRowToCargo!(
  { vesselName: 'sea angel', arrivalDate: new Date('2026-05-17') },
  {
    manifestRef: 'SEAANGEL/V034/31',
    consigneeName: 'MPL STORES',
    mark: 'MPL / MALE',
    commodity: 'GENERAL CARGO',
    cargoDescription: 'Steel bracket',
    pkgsType: 'PCS',
    noOfPkgs: 12,
    clearedQty: 0,
    remarks: 'Manual vessel detail',
  },
);

assert.equal(manualDetailedCargo.vesselName, 'Sea Angel');
assert.equal(manualDetailedCargo.blNo, 'SEAANGEL/V034/31');
assert.equal(manualDetailedCargo.consigneeName, 'MPL STORES');
assert.equal(manualDetailedCargo.mark, 'MPL / MALE');
assert.equal(manualDetailedCargo.cargoDescription, 'Steel bracket');
assert.equal(manualDetailedCargo.pkgsType, 'PCS');
assert.equal(manualDetailedCargo.noOfPkgs, 12);
assert.equal(manualDetailedCargo.reasonOfShifting, 'Vessel intake');

console.log('vessel cargo mapping tests passed');
