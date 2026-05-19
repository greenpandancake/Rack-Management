import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from './auth.js';
import type { UserPermissions } from '../auth/permissions.js';

const ALL_TRUE: UserPermissions = {
  canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
  canViewCleared: true, canViewReports: true, canViewSettings: true,
  canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
  canAddFieldReports: true, canCreateUsers: true, canEditUsers: true,
  canResetPasswords: true, canConfigureRack: true, canManageSlots: true,
};

function makeReq(user: { permissions: UserPermissions } | null): Partial<Request> {
  return { session: { user: user ? { id: '1', username: 'u', name: 'U', role: 'CLERK' as const, ...user } : undefined } as any };
}

let calledNext = false;
let statusCode = 0;
const mockRes = { status: (c: number) => { statusCode = c; return { json: () => {} }; } } as unknown as Response;
const next: NextFunction = () => { calledNext = true; };

// No session → 401
calledNext = false; statusCode = 0;
requirePermission('canMoveCargo')(makeReq(null) as Request, mockRes, next);
assert.equal(statusCode, 401);
assert.equal(calledNext, false);

// Permission true → next()
calledNext = false; statusCode = 0;
requirePermission('canMoveCargo')(makeReq({ permissions: { ...ALL_TRUE } }) as Request, mockRes, next);
assert.equal(calledNext, true);

// Permission false → 403
calledNext = false; statusCode = 0;
requirePermission('canMoveCargo')(makeReq({ permissions: { ...ALL_TRUE, canMoveCargo: false } }) as Request, mockRes, next);
assert.equal(statusCode, 403);
assert.equal(calledNext, false);

console.log('requirePermission tests passed');
