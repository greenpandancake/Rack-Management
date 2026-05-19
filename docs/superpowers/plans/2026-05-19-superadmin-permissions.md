# Superadmin Per-User Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow SUPER_ADMIN to set per-user permission toggles that override role defaults, controlling what each user can see and do in the app.

**Architecture:** A `permissions Json?` column is added to the `User` table storing overrides; a server-side resolver merges these with role defaults; the resolved object is stored on the Express session and returned from `/api/auth/me`; a `requirePermission(key)` middleware factory gates action routes; the React client exposes permissions via `useAuth()` and a `usePermission(key)` hook that gates nav, routes, and action buttons; SUPER_ADMIN gets a per-user permissions modal in Settings.

**Tech Stack:** Prisma 5 / SQLite, Express 4, Zod 3, React 18, TypeScript, Tailwind CSS, TanStack Query v5

---

## File Map

**Created:**
- `server/src/auth/permissions.ts` — `UserPermissions` type, `ROLE_DEFAULTS`, `resolvePermissions()`
- `server/src/auth/permissions.test.ts` — unit tests for the resolver
- `client/src/hooks/usePermission.ts` — `usePermission(key)` hook
- `client/src/components/UserPermissionsModal.tsx` — full-screen permissions editor modal

**Modified:**
- `server/prisma/schema.prisma` — add `permissions Json?` to User model
- `server/src/auth/session.ts` — add `permissions` to `SessionData.user`
- `server/src/middleware/auth.ts` — add `requirePermission` factory
- `server/src/api/auth.ts` — enrich login + /me with permissions; gate user-management routes; add PATCH permissions endpoint
- `server/src/api/cargo.ts` — gate move and status routes
- `server/src/api/photos.ts` — gate photo upload
- `server/src/api/config.ts` — replace `requireSuperAdmin` with `requirePermission('canConfigureRack')`
- `server/src/api/slots.ts` — replace `requireSuperAdmin` with `requirePermission('canManageSlots')`
- `client/src/api.ts` — add `UserPermissions` type, extend `AuthUser`/`AdminUser`, add `updateUserPermissions`
- `client/src/App.tsx` — gate routes and nav links with permissions
- `client/src/pages/Settings.tsx` — add Permissions button to user rows; import and use `UserPermissionsModal`
- `client/src/pages/CargoDetail.tsx` — gate move/status/upload buttons

---

## Task 1: Add permissions column to schema and migrate

**Files:**
- Modify: `server/prisma/schema.prisma:112-127`

- [ ] **Step 1: Write the failing test (manual check — no automated test for migrations)**

  Verify the column does not exist yet:
  ```bash
  cd server && npx prisma db pull --print 2>&1 | grep permissions
  ```
  Expected: no output (column doesn't exist).

- [ ] **Step 2: Add the column to the schema**

  In `server/prisma/schema.prisma`, add `permissions Json?` after `lastLoginAt`:
  ```prisma
  model User {
    id                 String    @id @default(uuid())
    username           String    @unique
    name               String
    passwordHash       String
    role               String    @default("CLERK")
    isActive           Boolean   @default(true)
    telegramUsername   String?   @unique
    mustChangePassword Boolean   @default(false)
    createdAt          DateTime  @default(now())
    updatedAt          DateTime  @updatedAt
    lastLoginAt        DateTime?
    permissions        Json?
    moveLogs           MoveLog[]

    @@index([telegramUsername])
  }
  ```

- [ ] **Step 3: Run the migration**

  ```bash
  cd server && npx prisma migrate dev --name add-user-permissions
  ```
  Expected output: `The following migration(s) have been applied: .../add_user_permissions`

- [ ] **Step 4: Verify the column exists**

  ```bash
  cd server && npx prisma db pull --print 2>&1 | grep permissions
  ```
  Expected: line containing `permissions`.

- [ ] **Step 5: Commit**

  ```bash
  git add server/prisma/schema.prisma server/prisma/migrations/
  git commit -m "feat: add permissions Json column to User model"
  ```

---

## Task 2: Create permissions module and test

**Files:**
- Create: `server/src/auth/permissions.ts`
- Create: `server/src/auth/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `server/src/auth/permissions.test.ts`:
  ```typescript
  import assert from 'node:assert/strict';
  import { resolvePermissions, ROLE_DEFAULTS } from './permissions.js';

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
  ```

- [ ] **Step 2: Run the test (expect failure — module not found)**

  ```bash
  cd server && npx tsx src/auth/permissions.test.ts
  ```
  Expected: error `Cannot find module './permissions.js'`

- [ ] **Step 3: Create the permissions module**

  Create `server/src/auth/permissions.ts`:
  ```typescript
  export type UserPermissions = {
    canViewDashboard: boolean;
    canViewIntake: boolean;
    canViewVesselIntake: boolean;
    canViewCleared: boolean;
    canViewReports: boolean;
    canViewSettings: boolean;
    canMoveCargo: boolean;
    canChangeCargoStatus: boolean;
    canUploadPhotos: boolean;
    canAddFieldReports: boolean;
    canCreateUsers: boolean;
    canEditUsers: boolean;
    canResetPasswords: boolean;
    canConfigureRack: boolean;
    canManageSlots: boolean;
  };

  const ALL_ON: UserPermissions = {
    canViewDashboard: true,
    canViewIntake: true,
    canViewVesselIntake: true,
    canViewCleared: true,
    canViewReports: true,
    canViewSettings: true,
    canMoveCargo: true,
    canChangeCargoStatus: true,
    canUploadPhotos: true,
    canAddFieldReports: true,
    canCreateUsers: true,
    canEditUsers: true,
    canResetPasswords: true,
    canConfigureRack: true,
    canManageSlots: true,
  };

  export const ROLE_DEFAULTS: Record<string, UserPermissions> = {
    SUPER_ADMIN: ALL_ON,
    ADMIN: {
      canViewDashboard: true,
      canViewIntake: true,
      canViewVesselIntake: true,
      canViewCleared: true,
      canViewReports: true,
      canViewSettings: true,
      canMoveCargo: true,
      canChangeCargoStatus: true,
      canUploadPhotos: true,
      canAddFieldReports: true,
      canCreateUsers: true,
      canEditUsers: true,
      canResetPasswords: true,
      canConfigureRack: false,
      canManageSlots: false,
    },
    CLERK: {
      canViewDashboard: true,
      canViewIntake: true,
      canViewVesselIntake: true,
      canViewCleared: true,
      canViewReports: true,
      canViewSettings: false,
      canMoveCargo: true,
      canChangeCargoStatus: true,
      canUploadPhotos: true,
      canAddFieldReports: true,
      canCreateUsers: false,
      canEditUsers: false,
      canResetPasswords: false,
      canConfigureRack: false,
      canManageSlots: false,
    },
  };

  export function resolvePermissions(user: { role: string; permissions: unknown }): UserPermissions {
    if (user.role === 'SUPER_ADMIN') return { ...ALL_ON };
    const defaults = ROLE_DEFAULTS[user.role] ?? ROLE_DEFAULTS['CLERK'];
    if (!user.permissions || typeof user.permissions !== 'object' || Array.isArray(user.permissions)) {
      return { ...defaults };
    }
    return { ...defaults, ...(user.permissions as Partial<UserPermissions>) };
  }
  ```

- [ ] **Step 4: Run the test (expect pass)**

  ```bash
  cd server && npx tsx src/auth/permissions.test.ts
  ```
  Expected: `permissions tests passed`

- [ ] **Step 5: Commit**

  ```bash
  git add server/src/auth/permissions.ts server/src/auth/permissions.test.ts
  git commit -m "feat: add UserPermissions type, role defaults, and resolver"
  ```

---

## Task 3: Update session type to include permissions

**Files:**
- Modify: `server/src/auth/session.ts`

- [ ] **Step 1: Update the SessionData type**

  Replace the `declare module 'express-session'` block in `server/src/auth/session.ts` (lines 10–19):
  ```typescript
  import type { UserPermissions } from '../auth/permissions.js';

  declare module 'express-session' {
    interface SessionData {
      user?: {
        id: string;
        username: string;
        name: string;
        role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
        permissions: UserPermissions;
      };
    }
  }
  ```

  The full updated file `server/src/auth/session.ts`:
  ```typescript
  import session from 'express-session';
  import SQLiteStoreFactory from 'connect-sqlite3';
  import crypto from 'node:crypto';
  import path from 'node:path';
  import fs from 'node:fs';
  import { env } from '../env.js';
  import type { UserPermissions } from './permissions.js';

  const SQLiteStore = SQLiteStoreFactory(session);

  declare module 'express-session' {
    interface SessionData {
      user?: {
        id: string;
        username: string;
        name: string;
        role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
        permissions: UserPermissions;
      };
    }
  }

  function resolveSessionDir(): string {
    if (env.SESSION_DIR) return env.SESSION_DIR;
    return path.dirname(path.resolve(env.UPLOADS_DIR));
  }

  function resolveSecret(): string {
    if (env.SESSION_SECRET) return env.SESSION_SECRET;
    const dir = resolveSessionDir();
    fs.mkdirSync(dir, { recursive: true });
    const secretFile = path.join(dir, '.session-secret');
    if (fs.existsSync(secretFile)) {
      return fs.readFileSync(secretFile, 'utf-8').trim();
    }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }

  export function buildSessionMiddleware() {
    const dir = resolveSessionDir();
    fs.mkdirSync(dir, { recursive: true });
    const store = new SQLiteStore({ dir, db: 'sessions.sqlite' }) as session.Store;
    return session({
      name: 'mpl.sid',
      secret: resolveSecret(),
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 1000 * 60 * 60 * 12,
      },
    });
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd server && npx tsc --noEmit
  ```
  Expected: TypeScript errors about `permissions` missing on `req.session.user` assignments in `auth.ts` — these will be fixed in Task 4.

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/auth/session.ts
  git commit -m "feat: add permissions field to session user type"
  ```

---

## Task 4: Enrich login and /me with resolved permissions

**Files:**
- Modify: `server/src/api/auth.ts`

- [ ] **Step 1: Add the import at the top of auth.ts**

  In `server/src/api/auth.ts`, add the import after the existing imports:
  ```typescript
  import { resolvePermissions } from '../auth/permissions.js';
  ```

- [ ] **Step 2: Update the login endpoint to include permissions**

  In `server/src/api/auth.ts`, replace the session assignment in the `POST /login` handler (around line 43):

  Replace:
  ```typescript
  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: toSessionRole(user.role),
  };
  ```
  With:
  ```typescript
  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: toSessionRole(user.role),
    permissions: resolvePermissions(user),
  };
  ```

- [ ] **Step 3: Update the /me endpoint to refresh permissions from DB**

  In `server/src/api/auth.ts`, replace the full `GET /me` handler (lines 64–75):
  ```typescript
  authRouter.get('/me', async (req, res) => {
    if (!req.session.user) return res.json({ user: null });
    const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
    if (!user || !user.isActive) {
      req.session.destroy(() => {});
      return res.json({ user: null });
    }
    req.session.user.permissions = resolvePermissions(user);
    res.json({
      user: req.session.user,
      mustChangePassword: user.mustChangePassword,
    });
  });
  ```

- [ ] **Step 4: Update the PATCH /users/:id handler to refresh session permissions if editing self**

  In `server/src/api/auth.ts`, the `PATCH /users/:id` handler ends with (around line 182):
  ```typescript
  if (req.session.user?.id === user.id) {
    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: toSessionRole(user.role),
    };
  }
  ```
  Replace with:
  ```typescript
  if (req.session.user?.id === user.id) {
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: toSessionRole(user.role),
      permissions: resolvePermissions(fresh ?? user),
    };
  }
  ```

- [ ] **Step 5: Verify TypeScript compiles**

  ```bash
  cd server && npx tsc --noEmit
  ```
  Expected: no errors (or only errors from not-yet-updated middleware).

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/api/auth.ts
  git commit -m "feat: enrich session with resolved permissions on login and /me refresh"
  ```

---

## Task 5: Add requirePermission middleware

**Files:**
- Modify: `server/src/middleware/auth.ts`

- [ ] **Step 1: Write the failing test**

  Create `server/src/middleware/auth.test.ts`:
  ```typescript
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
  ```

- [ ] **Step 2: Run the test (expect failure)**

  ```bash
  cd server && npx tsx src/middleware/auth.test.ts
  ```
  Expected: error `requirePermission is not a function` (not exported yet).

- [ ] **Step 3: Add requirePermission to middleware/auth.ts**

  Replace the entire `server/src/middleware/auth.ts` with:
  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import type { UserPermissions } from '../auth/permissions.js';

  export function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (req.session?.user) return next();
    return res.status(401).json({ error: 'unauthorized' });
  }

  export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'admin_only' });
    }
    return next();
  }

  export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'super_admin_only' });
    return next();
  }

  export function requirePermission(key: keyof UserPermissions) {
    return (req: Request, res: Response, next: NextFunction) => {
      const user = req.session?.user;
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      if (!user.permissions[key]) return res.status(403).json({ error: 'permission_denied' });
      return next();
    };
  }
  ```

- [ ] **Step 4: Run the test (expect pass)**

  ```bash
  cd server && npx tsx src/middleware/auth.test.ts
  ```
  Expected: `requirePermission tests passed`

- [ ] **Step 5: Commit**

  ```bash
  git add server/src/middleware/auth.ts server/src/middleware/auth.test.ts
  git commit -m "feat: add requirePermission middleware factory"
  ```

---

## Task 6: Add PATCH permissions endpoint

**Files:**
- Modify: `server/src/api/auth.ts`

- [ ] **Step 1: Add the Zod schema for permissions body at the top of auth.ts (after existing schemas)**

  In `server/src/api/auth.ts`, add after `const resetPasswordSchema = ...`:
  ```typescript
  const permissionsBodySchema = z.object({
    canViewDashboard: z.boolean().optional(),
    canViewIntake: z.boolean().optional(),
    canViewVesselIntake: z.boolean().optional(),
    canViewCleared: z.boolean().optional(),
    canViewReports: z.boolean().optional(),
    canViewSettings: z.boolean().optional(),
    canMoveCargo: z.boolean().optional(),
    canChangeCargoStatus: z.boolean().optional(),
    canUploadPhotos: z.boolean().optional(),
    canAddFieldReports: z.boolean().optional(),
    canCreateUsers: z.boolean().optional(),
    canEditUsers: z.boolean().optional(),
    canResetPasswords: z.boolean().optional(),
    canConfigureRack: z.boolean().optional(),
    canManageSlots: z.boolean().optional(),
  }).nullable();
  ```

- [ ] **Step 2: Update the top import in auth.ts to add requireSuperAdmin**

  Find the existing import at the top of `server/src/api/auth.ts`:
  ```typescript
  import { requireAdmin, requireAuth } from '../middleware/auth.js';
  ```
  Replace with:
  ```typescript
  import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
  ```

- [ ] **Step 3: Add the PATCH endpoint at the bottom of auth.ts**

  Append to `server/src/api/auth.ts`:
  ```typescript
  authRouter.patch('/users/:id/permissions', requireSuperAdmin, async (req, res) => {
    const parsed = permissionsBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (target.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'super_admin_immutable' });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { permissions: parsed.data ?? null },
      select: { ...USER_SELECT, permissions: true },
    });
    res.json(user);
  });
  ```

- [ ] **Step 4: Update USER_SELECT to expose permissions on GET /users**

  In `server/src/api/auth.ts`, find `const USER_SELECT = {` (around line 9) and add `permissions: true`:
  ```typescript
  const USER_SELECT = {
    id: true,
    username: true,
    name: true,
    role: true,
    isActive: true,
    telegramUsername: true,
    mustChangePassword: true,
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
    permissions: true,
  } as const;
  ```

- [ ] **Step 5: Verify TypeScript compiles**

  ```bash
  cd server && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/api/auth.ts
  git commit -m "feat: add PATCH /api/auth/users/:id/permissions endpoint; expose permissions in USER_SELECT"
  ```

---

## Task 7: Gate user management routes

**Files:**
- Modify: `server/src/api/auth.ts`

The import line at the top of auth.ts currently has `requireAdmin, requireAuth`. Add `requirePermission`:

- [ ] **Step 1: Update the import in auth.ts to also add requirePermission**

  The import should now be (Task 6 already added requireSuperAdmin):
  ```typescript
  import { requireAdmin, requireAuth, requireSuperAdmin, requirePermission } from '../middleware/auth.js';
  ```

- [ ] **Step 2: Replace requireAdmin on GET /users with requirePermission('canViewSettings')**

  Find:
  ```typescript
  authRouter.get('/users', requireAdmin, async (_req, res) => {
  ```
  Replace with:
  ```typescript
  authRouter.get('/users', requirePermission('canViewSettings'), async (_req, res) => {
  ```

- [ ] **Step 3: Replace requireAdmin on POST /users with requirePermission('canCreateUsers')**

  Find:
  ```typescript
  authRouter.post('/users', requireAdmin, async (req, res) => {
  ```
  Replace with:
  ```typescript
  authRouter.post('/users', requirePermission('canCreateUsers'), async (req, res) => {
  ```

- [ ] **Step 4: Replace requireAdmin on PATCH /users/:id with requirePermission('canEditUsers')**

  Find:
  ```typescript
  authRouter.patch('/users/:id', requireAdmin, async (req, res) => {
  ```
  Replace with:
  ```typescript
  authRouter.patch('/users/:id', requirePermission('canEditUsers'), async (req, res) => {
  ```

- [ ] **Step 5: Replace requireAdmin on POST /users/:id/password with requirePermission('canResetPasswords')**

  Find:
  ```typescript
  authRouter.post('/users/:id/password', requireAdmin, async (req, res) => {
  ```
  Replace with:
  ```typescript
  authRouter.post('/users/:id/password', requirePermission('canResetPasswords'), async (req, res) => {
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd server && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add server/src/api/auth.ts
  git commit -m "feat: gate user management routes with requirePermission"
  ```

---

## Task 8: Gate cargo move and status routes

**Files:**
- Modify: `server/src/api/cargo.ts`

- [ ] **Step 1: Add requirePermission to the import in cargo.ts**

  Find:
  ```typescript
  import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
  ```
  Replace with:
  ```typescript
  import { requireAuth, requireSuperAdmin, requirePermission } from '../middleware/auth.js';
  ```

- [ ] **Step 2: Gate POST /:id/move with canMoveCargo**

  Find (around line 755):
  ```typescript
  cargoRouter.post('/:id/move', async (req, res) => {
  ```
  Replace with:
  ```typescript
  cargoRouter.post('/:id/move', requirePermission('canMoveCargo'), async (req, res) => {
  ```

- [ ] **Step 3: Gate POST /:id/portions/:portionId/move with canMoveCargo**

  Find (around line 692):
  ```typescript
  cargoRouter.post('/:id/portions/:portionId/move', async (req, res) => {
  ```
  Replace with:
  ```typescript
  cargoRouter.post('/:id/portions/:portionId/move', requirePermission('canMoveCargo'), async (req, res) => {
  ```

- [ ] **Step 4: Gate POST /:id/status with canChangeCargoStatus**

  Find (around line 818):
  ```typescript
  cargoRouter.post('/:id/status', async (req, res) => {
  ```
  Replace with:
  ```typescript
  cargoRouter.post('/:id/status', requirePermission('canChangeCargoStatus'), async (req, res) => {
  ```

- [ ] **Step 5: Verify TypeScript compiles**

  ```bash
  cd server && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/api/cargo.ts
  git commit -m "feat: gate cargo move and status routes with requirePermission"
  ```

---

## Task 9: Gate photo upload, slots, and config routes

**Files:**
- Modify: `server/src/api/photos.ts`
- Modify: `server/src/api/slots.ts`
- Modify: `server/src/api/config.ts`

- [ ] **Step 1: Gate photo upload with canUploadPhotos**

  In `server/src/api/photos.ts`, change the import:
  ```typescript
  import { requireAuth, requirePermission } from '../middleware/auth.js';
  ```

  Then change the upload route:
  ```typescript
  photosRouter.post('/cargo/:cargoId', requirePermission('canUploadPhotos'), upload.single('photo'), async (req, res) => {
  ```

- [ ] **Step 2: Gate slots PATCH and DELETE with canManageSlots**

  In `server/src/api/slots.ts`, change the import:
  ```typescript
  import { requireAuth, requirePermission } from '../middleware/auth.js';
  ```

  Change the PATCH route:
  ```typescript
  slotsRouter.patch('/:id', requirePermission('canManageSlots'), async (req, res) => {
  ```

  Change the DELETE route:
  ```typescript
  slotsRouter.delete('/:id', requirePermission('canManageSlots'), async (req, res) => {
  ```

- [ ] **Step 3: Gate config PUT and DELETE /rows/:row with canConfigureRack**

  In `server/src/api/config.ts`, change the import:
  ```typescript
  import { requireAuth, requirePermission } from '../middleware/auth.js';
  ```

  Change the PUT route:
  ```typescript
  configRouter.put('/', requirePermission('canConfigureRack'), async (req, res) => {
  ```

  Change the DELETE /rows/:row route:
  ```typescript
  configRouter.delete('/rows/:row', requirePermission('canConfigureRack'), async (req, res) => {
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd server && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add server/src/api/photos.ts server/src/api/slots.ts server/src/api/config.ts
  git commit -m "feat: gate photo upload, slot, and config routes with requirePermission"
  ```

---

## Task 10: Update client types and API

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add UserPermissions type after the existing type definitions**

  In `client/src/api.ts`, add after the `import` statements (before `export type CargoStatus`):
  ```typescript
  export type UserPermissions = {
    canViewDashboard: boolean;
    canViewIntake: boolean;
    canViewVesselIntake: boolean;
    canViewCleared: boolean;
    canViewReports: boolean;
    canViewSettings: boolean;
    canMoveCargo: boolean;
    canChangeCargoStatus: boolean;
    canUploadPhotos: boolean;
    canAddFieldReports: boolean;
    canCreateUsers: boolean;
    canEditUsers: boolean;
    canResetPasswords: boolean;
    canConfigureRack: boolean;
    canManageSlots: boolean;
  };

  export const ROLE_PERMISSION_DEFAULTS: Record<string, UserPermissions> = {
    SUPER_ADMIN: {
      canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
      canViewCleared: true, canViewReports: true, canViewSettings: true,
      canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
      canAddFieldReports: true, canCreateUsers: true, canEditUsers: true,
      canResetPasswords: true, canConfigureRack: true, canManageSlots: true,
    },
    ADMIN: {
      canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
      canViewCleared: true, canViewReports: true, canViewSettings: true,
      canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
      canAddFieldReports: true, canCreateUsers: true, canEditUsers: true,
      canResetPasswords: true, canConfigureRack: false, canManageSlots: false,
    },
    CLERK: {
      canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
      canViewCleared: true, canViewReports: true, canViewSettings: false,
      canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
      canAddFieldReports: true, canCreateUsers: false, canEditUsers: false,
      canResetPasswords: false, canConfigureRack: false, canManageSlots: false,
    },
  };

  export function resolveClientPermissions(user: { role: string; permissions: UserPermissions | null }): UserPermissions {
    if (user.role === 'SUPER_ADMIN') return { ...ROLE_PERMISSION_DEFAULTS['SUPER_ADMIN'] };
    const defaults = ROLE_PERMISSION_DEFAULTS[user.role] ?? ROLE_PERMISSION_DEFAULTS['CLERK'];
    if (!user.permissions) return { ...defaults };
    return { ...defaults, ...user.permissions };
  }
  ```

- [ ] **Step 2: Extend AuthUser with permissions**

  Find (around line 105):
  ```typescript
  export type AuthUser = {
    id: string;
    username: string;
    name: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
  };
  ```
  Replace with:
  ```typescript
  export type AuthUser = {
    id: string;
    username: string;
    name: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
    permissions: UserPermissions;
  };
  ```

- [ ] **Step 3: Redefine AdminUser as a standalone type (not extending AuthUser)**

  `AdminUser` cannot extend `AuthUser` for permissions because `AuthUser.permissions` is non-null (resolved)
  while `AdminUser.permissions` is nullable (raw stored value). Replace:
  ```typescript
  export type AdminUser = AuthUser & {
    isActive: boolean;
    telegramUsername: string | null;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
  };
  ```
  With:
  ```typescript
  export type AdminUser = {
    id: string;
    username: string;
    name: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
    isActive: boolean;
    telegramUsername: string | null;
    mustChangePassword: boolean;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
    permissions: UserPermissions | null;
  };
  ```

- [ ] **Step 4: Add updateUserPermissions to the api object**

  In the `api` object in `client/src/api.ts`, add after `resetUserPassword`:
  ```typescript
  updateUserPermissions: (id: string, permissions: UserPermissions | null) =>
    http<AdminUser>(`/api/auth/users/${id}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(permissions),
    }),
  ```

- [ ] **Step 5: Verify TypeScript compiles in client**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: TypeScript errors about places that use `AuthUser` without `permissions` — these will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/api.ts
  git commit -m "feat: add UserPermissions type and updateUserPermissions API to client"
  ```

---

## Task 11: Create usePermission hook

**Files:**
- Create: `client/src/hooks/usePermission.ts`

- [ ] **Step 1: Create the hook**

  Create `client/src/hooks/usePermission.ts`:
  ```typescript
  import { useAuth } from '../auth.js';
  import type { UserPermissions } from '../api.js';

  export function usePermission(key: keyof UserPermissions): boolean {
    const { user } = useAuth();
    if (!user) return false;
    return user.permissions[key];
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: errors still exist from `auth.tsx` and `App.tsx` using old `AuthUser` shape — fine, will fix next.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/hooks/usePermission.ts
  git commit -m "feat: add usePermission hook"
  ```

---

## Task 12: Update App.tsx — gate routes and nav links

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace the full App.tsx**

  Replace `client/src/App.tsx` with:
  ```typescript
  import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
  import { Dashboard } from './pages/Dashboard.js';
  import { Intake } from './pages/Intake.js';
  import { CargoDetail } from './pages/CargoDetail.js';
  import { Settings } from './pages/Settings.js';
  import { Cleared } from './pages/Cleared.js';
  import { Reports } from './pages/Reports.js';
  import { VesselIntake } from './pages/VesselIntake.js';
  import { useSocketBridge } from './hooks/useSocket.js';
  import { useTheme } from './hooks/useTheme.js';
  import { usePermission } from './hooks/usePermission.js';
  import { ChangePasswordPage, LoginPage, useAuth } from './auth.js';

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md transition ${
      isActive
        ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100'
    }`;

  function NoAccess() {
    return (
      <main className="min-h-full grid place-items-center text-sm text-slate-600 dark:text-slate-400">
        You don't have access to this page. Contact your administrator.
      </main>
    );
  }

  export function App() {
    useSocketBridge();
    const auth = useAuth();
    const { theme, toggle } = useTheme();
    const canViewDashboard = usePermission('canViewDashboard');
    const canViewIntake = usePermission('canViewIntake');
    const canViewVesselIntake = usePermission('canViewVesselIntake');
    const canViewCleared = usePermission('canViewCleared');
    const canViewReports = usePermission('canViewReports');
    const canViewSettings = usePermission('canViewSettings');

    if (auth.loading) return <div className="min-h-full grid place-items-center text-sm text-slate-600 dark:text-slate-400">Loading...</div>;
    if (!auth.user) return <LoginPage />;
    if (auth.mustChangePassword) return <ChangePasswordPage />;

    return (
      <div className="min-h-full flex flex-col bg-slate-100 dark:bg-slate-950">
        <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm dark:bg-slate-900/95 dark:border-slate-700">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3">
              <span className="grid place-items-center h-9 w-9 rounded-lg bg-slate-900 text-white font-bold dark:bg-slate-100 dark:text-slate-900">M</span>
              <span>
                <span className="block font-bold leading-tight">MPL Smart Rack</span>
                <span className="block text-xs text-slate-500 leading-tight dark:text-slate-400">Warehouse rack control</span>
              </span>
            </Link>
            <nav className="flex gap-1 ml-auto text-sm items-center">
              {canViewDashboard && <NavLink to="/" end className={linkClass}>Dashboard</NavLink>}
              {canViewIntake && <NavLink to="/intake" className={linkClass}>CFS intake</NavLink>}
              {canViewVesselIntake && <NavLink to="/vessel-intake" className={linkClass}>Vessel Intake</NavLink>}
              {canViewCleared && <NavLink to="/cleared" className={linkClass}>Intakes</NavLink>}
              {canViewReports && <NavLink to="/reports" className={linkClass}>Reports</NavLink>}
              {canViewSettings && <NavLink to="/settings" className={linkClass}>Settings</NavLink>}
              <button
                onClick={toggle}
                aria-label="Toggle dark mode"
                className="px-2 py-2 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              >
                {theme === 'dark' ? '☀' : '🌙'}
              </button>
              <button onClick={auth.logout} className="px-3 py-2 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100">
                Sign out
              </button>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1">
          <Routes>
            <Route path="/" element={canViewDashboard ? <Dashboard /> : <NoAccess />} />
            <Route path="/intake" element={canViewIntake ? <Intake /> : <NoAccess />} />
            <Route path="/vessel-intake" element={canViewVesselIntake ? <VesselIntake /> : <NoAccess />} />
            <Route path="/cargo/:id" element={<CargoDetail />} />
            <Route path="/cleared" element={canViewCleared ? <Cleared /> : <NoAccess />} />
            <Route path="/reports" element={canViewReports ? <Reports /> : <NoAccess />} />
            <Route path="/settings" element={canViewSettings ? <Settings /> : <Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: errors from `auth.tsx` still (permissions field missing) — will be fixed next.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/App.tsx
  git commit -m "feat: gate App.tsx routes and nav links with permission hooks"
  ```

---

## Task 13: Update auth.tsx to handle permissions in context

**Files:**
- Modify: `client/src/auth.tsx`

The `AuthUser` type now includes `permissions`. The `useAuth()` hook already returns `auth.user` — no structural changes needed. However, the `login()` function sets `user` from the API response, and the API now returns `permissions` on `AuthUser`, so it just works.

- [ ] **Step 1: Verify the existing auth.tsx compiles with the new AuthUser type**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: no errors from `auth.tsx` itself (the `permissions` field is part of `AuthUser` returned from the API).

  If TypeScript complains that `res.user` may not have `permissions`, it means the API hasn't started returning it yet (expected until server is running). Confirm the types are structurally consistent.

- [ ] **Step 2: Commit (no code change needed if tsc passes)**

  If no changes were needed:
  ```bash
  git commit --allow-empty -m "chore: verify auth.tsx compatible with extended AuthUser"
  ```

---

## Task 14: Build UserPermissionsModal component

**Files:**
- Create: `client/src/components/UserPermissionsModal.tsx`

- [ ] **Step 1: Create the component**

  Create `client/src/components/UserPermissionsModal.tsx`:
  ```typescript
  import { useState } from 'react';
  import { AdminUser, api, resolveClientPermissions, ROLE_PERMISSION_DEFAULTS, UserPermissions } from '../api.js';
  import { useQueryClient } from '@tanstack/react-query';

  type Section = {
    label: string;
    keys: (keyof UserPermissions)[];
  };

  const SECTIONS: Section[] = [
    {
      label: 'Pages',
      keys: ['canViewDashboard', 'canViewIntake', 'canViewVesselIntake', 'canViewCleared', 'canViewReports', 'canViewSettings'],
    },
    {
      label: 'Cargo Actions',
      keys: ['canMoveCargo', 'canChangeCargoStatus', 'canUploadPhotos', 'canAddFieldReports'],
    },
    {
      label: 'User Management',
      keys: ['canCreateUsers', 'canEditUsers', 'canResetPasswords'],
    },
    {
      label: 'Rack Configuration',
      keys: ['canConfigureRack', 'canManageSlots'],
    },
  ];

  const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
    canViewDashboard: 'View Dashboard',
    canViewIntake: 'View CFS Intake',
    canViewVesselIntake: 'View Vessel Intake',
    canViewCleared: 'View Intakes (Cleared)',
    canViewReports: 'View Reports',
    canViewSettings: 'View Settings',
    canMoveCargo: 'Move Cargo',
    canChangeCargoStatus: 'Change Cargo Status',
    canUploadPhotos: 'Upload Photos',
    canAddFieldReports: 'Add Field Reports',
    canCreateUsers: 'Create Users',
    canEditUsers: 'Edit Users',
    canResetPasswords: 'Reset Passwords',
    canConfigureRack: 'Configure Rack',
    canManageSlots: 'Manage Slots',
  };

  type Props = {
    user: AdminUser;
    onClose: () => void;
  };

  export function UserPermissionsModal({ user, onClose }: Props) {
    const qc = useQueryClient();
    const roleDefaults = ROLE_PERMISSION_DEFAULTS[user.role] ?? ROLE_PERMISSION_DEFAULTS['CLERK'];
    const [draft, setDraft] = useState<UserPermissions>(() => resolveClientPermissions(user));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function toggle(key: keyof UserPermissions) {
      setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    function resetToDefaults() {
      setDraft({ ...roleDefaults });
    }

    async function save() {
      setBusy(true);
      setError(null);
      try {
        await api.updateUserPermissions(user.id, draft);
        qc.invalidateQueries({ queryKey: ['users'] });
        onClose();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }

    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto p-4">
        <div className="w-full max-w-2xl app-panel p-6 space-y-6 my-8">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold">{user.name}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                @{user.username} · {user.role.replace('_', ' ')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none"
            >
              ×
            </button>
          </div>

          {SECTIONS.map((section) => (
            <div key={section.label} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {section.label}
              </h3>
              <div className="space-y-1">
                {section.keys.map((key) => {
                  const isDefault = roleDefaults[key];
                  return (
                    <label
                      key={key}
                      className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      <span className="text-sm">
                        {PERMISSION_LABELS[key]}
                        <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                          default: {isDefault ? 'on' : 'off'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={draft[key]}
                        onChange={() => toggle(key)}
                        disabled={busy}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 dark:border-slate-600"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={resetToDefaults}
              disabled={busy}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-50"
            >
              Reset to role defaults
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="border rounded px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {busy ? 'Saving...' : 'Save permissions'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: no errors from this file.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/components/UserPermissionsModal.tsx
  git commit -m "feat: add UserPermissionsModal component"
  ```

---

## Task 15: Wire UserPermissionsModal into Settings

**Files:**
- Modify: `client/src/pages/Settings.tsx`

- [ ] **Step 1: Add import and permissionsUser state to Settings**

  At the top of `client/src/pages/Settings.tsx`, add the import:
  ```typescript
  import { UserPermissionsModal } from '../components/UserPermissionsModal.js';
  ```

  Inside the `Settings` function, add state after the existing state declarations:
  ```typescript
  const [permissionsUser, setPermissionsUser] = useState<AdminUser | null>(null);
  ```

- [ ] **Step 2: Add a Permissions button to each non-SUPER_ADMIN user row**

  In the user table in `Settings.tsx`, find the last `<td>` in the user row (the one with the Reset password button):
  ```tsx
  <td className="py-2 pr-3 text-right">
    <button disabled={busy} onClick={() => resetPassword(u)} className="border rounded px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300">Reset password</button>
  </td>
  ```
  Replace with:
  ```tsx
  <td className="py-2 pr-3 text-right space-x-2">
    <button disabled={busy} onClick={() => resetPassword(u)} className="border rounded px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300">Reset password</button>
    {isSuperAdmin && u.role !== 'SUPER_ADMIN' && (
      <button onClick={() => setPermissionsUser(u)} className="border rounded px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300">Permissions</button>
    )}
  </td>
  ```

- [ ] **Step 3: Render the modal at the bottom of the Settings return**

  At the very end of the `return (...)` in `Settings`, just before the closing `</div>`, add:
  ```tsx
  {permissionsUser && (
    <UserPermissionsModal
      user={permissionsUser}
      onClose={() => setPermissionsUser(null)}
    />
  )}
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add client/src/pages/Settings.tsx
  git commit -m "feat: wire UserPermissionsModal into Settings user table"
  ```

---

## Task 16: Gate action buttons in CargoDetail

**Files:**
- Modify: `client/src/pages/CargoDetail.tsx`

- [ ] **Step 1: Import usePermission in CargoDetail**

  In `client/src/pages/CargoDetail.tsx`, add to the imports:
  ```typescript
  import { usePermission } from '../hooks/usePermission.js';
  ```

- [ ] **Step 2: Declare permission booleans at the top of CargoDetail()**

  Inside the `CargoDetail` function, after the `useQuery` hooks, add:
  ```typescript
  const canMoveCargo = usePermission('canMoveCargo');
  const canChangeCargoStatus = usePermission('canChangeCargoStatus');
  const canUploadPhotos = usePermission('canUploadPhotos');
  ```

- [ ] **Step 3: Find and gate the move button**

  In the JSX, find where the Move button/trigger is rendered (look for `setMovePickerOpen(true)` and the move picker UI around lines 400–430). Wrap or disable these controls with `canMoveCargo`:

  Find any button that calls `setMovePickerOpen(true)` or triggers move actions and add `disabled={!canMoveCargo}` to it, or wrap the section with `{canMoveCargo && ...}`.

  Example pattern to apply (find the move trigger button):
  ```tsx
  {canMoveCargo && (
    <button onClick={() => setMovePickerOpen(true)} ...>
      Move
    </button>
  )}
  ```
  And in the move picker itself (the slot selection UI), guard its rendering:
  ```tsx
  {movePickerOpen && canMoveCargo && (
    // ... slot picker JSX
  )}
  ```

- [ ] **Step 4: Find and gate the status change buttons**

  The status buttons call `handleStatus(status)`. Find where they're rendered (search for `handleStatus` in the JSX) and wrap with `{canChangeCargoStatus && ...}` or add `disabled={!canChangeCargoStatus}`.

- [ ] **Step 5: Find and gate the photo upload input**

  The photo upload is triggered via `handleUpload`. Find the file input (search for `handleUpload` in the JSX) and conditionally render it:
  ```tsx
  {canUploadPhotos && (
    <label ...>
      <input type="file" onChange={handleUpload} ... />
      Upload photo
    </label>
  )}
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd client && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add client/src/pages/CargoDetail.tsx
  git commit -m "feat: gate move/status/upload action buttons in CargoDetail with permissions"
  ```

---

## Task 17: End-to-end smoke test

- [ ] **Step 1: Start the dev server**

  ```bash
  cd server && npm run dev
  ```
  In a separate terminal:
  ```bash
  cd client && npm run dev
  ```

- [ ] **Step 2: Log in as SUPER_ADMIN and verify full access**

  - All nav links visible
  - Settings page opens
  - User table shows "Permissions" button for non-SUPER_ADMIN users
  - Click "Permissions" for a CLERK user — modal opens showing all 15 toggles with defaults

- [ ] **Step 3: Restrict a CLERK's permissions**

  - Disable `canViewReports` and `canMoveCargo` for a CLERK user
  - Save
  - Log in as that CLERK user
  - Verify "Reports" nav link is hidden and Reports page shows NoAccess
  - Open a cargo detail page — Move button should be hidden/disabled

- [ ] **Step 4: Reset permissions to defaults**

  - Log back in as SUPER_ADMIN
  - Open the CLERK's Permissions modal
  - Click "Reset to role defaults"
  - Save
  - Log in as CLERK again — full CLERK access restored

- [ ] **Step 5: Commit final verification**

  ```bash
  git add -p
  git commit -m "feat: superadmin per-user permissions — complete implementation"
  ```
