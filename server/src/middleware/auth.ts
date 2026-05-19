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
