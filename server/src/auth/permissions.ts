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
