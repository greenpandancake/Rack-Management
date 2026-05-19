# Superadmin Per-User Permissions — Design Spec

**Date:** 2026-05-19  
**App:** MPL Smart Rack System  
**Scope:** Allow SUPER_ADMIN accounts to set granular per-user permissions controlling what each user can and cannot do in the app.

---

## Overview

Currently, all permissions in the app are hardcoded per role (SUPER_ADMIN, ADMIN, CLERK). This feature adds a per-user permissions layer that superadmin can override on a per-user basis. Roles continue to function as default presets; the new system only stores overrides from those defaults.

---

## Data Model

### Change: `User.permissions` column

Add a nullable `Json` column named `permissions` to the `User` model in `server/prisma/schema.prisma`:

```prisma
model User {
  // ... existing fields ...
  permissions Json?   // null = use role defaults
}
```

The column stores a partial `UserPermissions` object — only keys that differ from the role default need to be stored. If `null`, all permissions fall back to role defaults.

### Permission Keys

| Key | Default ADMIN | Default CLERK | Notes |
|-----|:---:|:---:|-------|
| `canViewDashboard` | ✓ | ✓ | Controls access to `/` |
| `canViewIntake` | ✓ | ✓ | Controls access to `/intake` |
| `canViewVesselIntake` | ✓ | ✓ | Controls access to `/vessel-intake` |
| `canViewCleared` | ✓ | ✓ | Controls access to `/cleared` |
| `canViewReports` | ✓ | ✓ | Controls access to `/reports` |
| `canViewSettings` | ✓ | ✗ | Controls access to `/settings` |
| `canMoveCargo` | ✓ | ✓ | Move cargo between rack slots |
| `canChangeCargoStatus` | ✓ | ✓ | Change cargo status |
| `canUploadPhotos` | ✓ | ✓ | Upload photos to cargo records |
| `canAddFieldReports` | ✓ | ✓ | Add field reports to cargo |
| `canCreateUsers` | ✓ | ✗ | Create new users |
| `canEditUsers` | ✓ | ✗ | Edit existing users |
| `canResetPasswords` | ✓ | ✗ | Reset other users' passwords |
| `canConfigureRack` | ✗ | ✗ | Resize rack (rows/levels/slots) |
| `canManageSlots` | ✗ | ✗ | Enable/disable/delete slots |

**SUPER_ADMIN users always have all permissions regardless of this column.**

### Resolution Order

```
explicit override (permissions column) → role default → deny
```

---

## Backend

### New File: `server/src/auth/permissions.ts`

Exports:
- `ROLE_DEFAULTS: Record<Role, UserPermissions>` — the default permission sets per role
- `resolvePermissions(user: { role: string; permissions: unknown }): UserPermissions` — merges role defaults with stored overrides
- `UserPermissions` type — typed object with all 15 permission keys as `boolean`

### Session Enrichment

The existing `/api/auth/me` endpoint and session object will include the resolved `permissions` field. When a user logs in or the session is refreshed, `resolvePermissions` is called and the result is stored on `req.session.user.permissions`.

### New API Endpoint

`PATCH /api/auth/users/:id/permissions`

- Protected: SUPER_ADMIN only
- Body: `Partial<UserPermissions>`
- Validates caller is SUPER_ADMIN
- Rejects if target user is SUPER_ADMIN (their permissions cannot be overridden)
- Merges incoming partial object with existing permissions, or sets from scratch
- A body of `null` resets all overrides (clears the column to role defaults); an empty `{}` is a no-op
- Returns updated user object

### New Middleware: `requirePermission`

```typescript
requirePermission(key: keyof UserPermissions): RequestHandler
```

A middleware factory added to `server/src/middleware/auth.ts`. Used on action-level routes (e.g., move cargo) to check `req.session.user.permissions[key]`. Returns 403 if the permission is false.

Existing `requireAdmin` / `requireSuperAdmin` middleware is unchanged.

### Existing Routes

Action routes that require specific permissions get the `requirePermission` middleware added:
- Move cargo → `requirePermission('canMoveCargo')`
- Change status → `requirePermission('canChangeCargoStatus')`
- Upload photo → `requirePermission('canUploadPhotos')`
- Add field report → `requirePermission('canAddFieldReports')`
- Create user → `requirePermission('canCreateUsers')`
- Edit user → `requirePermission('canEditUsers')`
- Reset password → `requirePermission('canResetPasswords')`
- Rack config → `requirePermission('canConfigureRack')`
- Slot management → `requirePermission('canManageSlots')`

---

## Frontend

### Type Changes (`client/src/api.ts`)

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

// AuthUser gains:
export type AuthUser = {
  // ... existing fields ...
  permissions: UserPermissions;
};
```

### Auth Context (`client/src/auth.tsx`)

The `useAuth()` hook already returns `auth.user`. No structural change needed — `permissions` is simply a new field on `AuthUser`.

### New Hook: `usePermission`

```typescript
function usePermission(key: keyof UserPermissions): boolean
```

Reads `auth.user.permissions[key]`. Returns `false` if user is not logged in.

### Route Gating

Page-level routes in `App.tsx` wrap each route with a permission check using `usePermission`. If a user lacks the page-level permission (e.g., `canViewReports`), they are redirected to the dashboard with a "not authorized" message.

### UI Gating

Action buttons and UI elements check the relevant permission via `usePermission` and are hidden or disabled accordingly (e.g., move cargo button hidden if `!canMoveCargo`).

### Permissions Modal (`client/src/pages/Settings.tsx`)

A new `UserPermissionsModal` component, triggered when a SUPER_ADMIN clicks a user row in the Settings user list.

**Modal layout:**
- Header: user's name and current role
- Toggles grouped into four sections:
  - **Pages** — canViewDashboard, canViewIntake, canViewVesselIntake, canViewCleared, canViewReports, canViewSettings
  - **Cargo Actions** — canMoveCargo, canChangeCargoStatus, canUploadPhotos, canAddFieldReports
  - **User Management** — canCreateUsers, canEditUsers, canResetPasswords
  - **Rack Configuration** — canConfigureRack, canManageSlots
- Each toggle shows a faded label indicating the role default (e.g., "default: on")
- "Reset to role defaults" button — clears all overrides, resets to role defaults visually
- Save button — calls `PATCH /api/auth/users/:id/permissions`
- Cancel button — discards unsaved changes

**Session refresh:** After a successful save, the app re-fetches `/api/auth/me` so if the affected user is currently logged in, their permissions update on their next page navigation.

---

## Constraints & Edge Cases

- SUPER_ADMIN accounts cannot have their permissions overridden — the modal does not open for SUPER_ADMIN users
- `canViewSettings` grants access to the Settings page only; sub-sections within Settings (rack config, slot management) are still individually gated by `canConfigureRack` and `canManageSlots` respectively
- The last active SUPER_ADMIN cannot be demoted (existing guard, unchanged)
- Disabling `canViewDashboard` for a user redirects them to a generic "no access" screen on login, since the dashboard is the default landing page
- Telegram bot command access is not gated by this system — bot commands retain their existing role checks
- Permissions are resolved at login and stored on the session; changes take effect for an affected user on their next login or session refresh

---

## Files to Change

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | Add `permissions Json?` to User model |
| `server/src/auth/permissions.ts` | New file — types, defaults, resolver |
| `server/src/auth/session.ts` | Add `permissions` to session user type |
| `server/src/middleware/auth.ts` | Add `requirePermission` factory |
| `server/src/api/auth.ts` | Enrich session with resolved permissions; add PATCH permissions endpoint |
| `server/src/api/*.ts` | Add `requirePermission` middleware to action routes |
| `client/src/api.ts` | Add `UserPermissions` type, extend `AuthUser` |
| `client/src/auth.tsx` | Expose permissions via auth context |
| `client/src/hooks/usePermission.ts` | New file — `usePermission` hook |
| `client/src/App.tsx` | Gate page routes by permission |
| `client/src/pages/Settings.tsx` | Add `UserPermissionsModal`, open on user row click |
| `client/src/pages/*.tsx` | Hide/disable gated action buttons |
