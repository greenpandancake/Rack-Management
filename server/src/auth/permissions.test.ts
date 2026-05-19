import assert from 'node:assert/strict';
import { resolvePermissions } from './permissions.js';

// SUPER_ADMIN gets all permissions regardless of stored overrides
const superAdmin = resolvePermissions({ role: 'SUPER_ADMIN', permissions: null });
assert.equal(superAdmin.canMoveCargo, true);
assert.equal(superAdmin.canConfigureRack, true);
assert.equal(superAdmin.canManageSlots, true);

// ADMIN defaults
const admin = resolvePermissions({ role: 'ADMIN', permissions: null });
assert.equal(admin.canViewDashboard, true);
assert.equal(admin.canViewSettings, true);
assert.equal(admin.canCreateUsers, true);
assert.equal(admin.canConfigureRack, false);
assert.equal(admin.canManageSlots, false);

// CLERK defaults
const clerk = resolvePermissions({ role: 'CLERK', permissions: null });
assert.equal(clerk.canViewDashboard, true);
assert.equal(clerk.canViewSettings, false);
assert.equal(clerk.canCreateUsers, false);
assert.equal(clerk.canMoveCargo, true);

// Override: CLERK with canMoveCargo disabled
const restricted = resolvePermissions({ role: 'CLERK', permissions: { canMoveCargo: false } });
assert.equal(restricted.canMoveCargo, false);
assert.equal(restricted.canViewDashboard, true); // other defaults intact

// Override: CLERK elevated to create users
const elevated = resolvePermissions({ role: 'CLERK', permissions: { canCreateUsers: true } });
assert.equal(elevated.canCreateUsers, true);
assert.equal(elevated.canMoveCargo, true); // base defaults still intact

console.log('permissions tests passed');
