import { useAuth } from '../auth.js';
import type { UserPermissions } from '../api.js';

export function usePermission(key: keyof UserPermissions): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return user.permissions[key];
}
