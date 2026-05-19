import assert from 'node:assert/strict';
import { buildCargoWhereForTest } from './cargo.js';

const byVesselAndArrival = buildCargoWhereForTest({
  q: undefined,
  statuses: [],
  unassigned: false,
  vesselName: 'Sea Angel',
  arrivalDate: '2026-05-17',
});

assert.equal(byVesselAndArrival.vesselName, 'Sea Angel');
assert.deepEqual(byVesselAndArrival.dateOfArrival, {
  gte: new Date('2026-05-17T00:00:00.000Z'),
  lt: new Date('2026-05-18T00:00:00.000Z'),
});

const unassigned = buildCargoWhereForTest({
  q: undefined,
  statuses: [],
  unassigned: true,
  vesselName: undefined,
  arrivalDate: undefined,
});

assert.equal(unassigned.currentSlotId, null);

console.log('cargo filter tests passed');
