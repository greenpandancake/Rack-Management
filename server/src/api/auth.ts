import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { resolvePermissions } from '../auth/permissions.js';

export const authRouter = Router();

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

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CLERK'] as const;

function toSessionRole(role: string) {
  return USER_ROLES.includes(role as (typeof USER_ROLES)[number])
    ? (role as (typeof USER_ROLES)[number])
    : 'CLERK';
}

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: toSessionRole(user.role),
    permissions: resolvePermissions({ role: user.role, permissions: user.permissions ? JSON.parse(user.permissions as string) : null }),
  };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  res.json({
    user: req.session.user,
    mustChangePassword: user.mustChangePassword,
  });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mpl.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  req.session.user.permissions = resolvePermissions({ role: user.role, permissions: user.permissions ? JSON.parse(user.permissions as string) : null });
  res.json({
    user: req.session.user,
    mustChangePassword: user.mustChangePassword,
  });
});

const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePwSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const user = await prisma.user.findUnique({ where: { id: req.session.user!.id } });
  if (!user) return res.status(404).json({ error: 'not_found' });
  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  res.json({ ok: true });
});

authRouter.get('/users', requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
    select: USER_SELECT,
  });
  res.json({ users });
});

const userSchema = z.object({
  username: z.string().trim().min(1),
  name: z.string().trim().min(1),
  password: z.string().min(6),
  role: z.enum(USER_ROLES).default('CLERK'),
  telegramUsername: z.string().trim().optional().nullable(),
  isActive: z.boolean().default(true),
  mustChangePassword: z.boolean().default(true),
});

function normalizeTelegramUsername(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^@/, '');
  return trimmed ? trimmed : null;
}

authRouter.post('/users', requireAdmin, async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.role === 'SUPER_ADMIN' && req.session.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'super_admin_only' });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      username: parsed.data.username,
      name: parsed.data.name,
      passwordHash,
      role: parsed.data.role,
      telegramUsername: normalizeTelegramUsername(parsed.data.telegramUsername),
      isActive: parsed.data.isActive,
      mustChangePassword: parsed.data.mustChangePassword,
    },
    select: USER_SELECT,
  });
  res.status(201).json(user);
});

const patchUserSchema = z.object({
  username: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  role: z.enum(USER_ROLES).optional(),
  telegramUsername: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});

authRouter.patch('/users/:id', requireAdmin, async (req, res) => {
  const parsed = patchUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.role === 'SUPER_ADMIN' && req.session.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'super_admin_only' });
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true, isActive: true } });
  if (existing?.role === 'SUPER_ADMIN' && req.session.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'super_admin_only' });
  }
  if (existing?.role === 'SUPER_ADMIN' && existing.isActive) {
    const demoting = parsed.data.role && parsed.data.role !== 'SUPER_ADMIN';
    const deactivating = parsed.data.isActive === false;
    if (demoting || deactivating) {
      const activeSupers = await prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
      if (activeSupers <= 1) {
        return res.status(409).json({ error: 'last_super_admin' });
      }
    }
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      telegramUsername:
        'telegramUsername' in parsed.data
          ? normalizeTelegramUsername(parsed.data.telegramUsername)
          : undefined,
    },
    select: USER_SELECT,
  });
  if (req.session.user?.id === user.id) {
    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: toSessionRole(user.role),
      permissions: resolvePermissions({ role: user.role, permissions: user.permissions ? JSON.parse(user.permissions as string) : null }),
    };
  }
  res.json(user);
});

const resetPasswordSchema = z.object({
  password: z.string().min(6),
  mustChangePassword: z.boolean().default(true),
});

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

authRouter.post('/users/:id/password', requireAdmin, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.update({
    where: { id: req.params.id },
    data: { passwordHash, mustChangePassword: parsed.data.mustChangePassword },
  });
  res.json({ ok: true });
});

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
    data: { permissions: parsed.data ? JSON.stringify(parsed.data) : null },
    select: { ...USER_SELECT, permissions: true },
  });
  res.json(user);
});
