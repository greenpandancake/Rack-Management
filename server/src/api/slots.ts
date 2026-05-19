import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { bus } from '../realtime/bus.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export const slotsRouter = Router();
slotsRouter.use(requireAuth);

slotsRouter.get('/', async (_req, res) => {
  const slots = await prisma.rackSlot.findMany({
    orderBy: [{ row: 'asc' }, { level: 'asc' }, { slot: 'asc' }],
    include: {
      cargos: { select: { id: true, containerNo: true, blNo: true, consigneeName: true, isOverdue: true, status: true } },
      portions: {
        select: {
          id: true,
          label: true,
          quantity: true,
          pkgsType: true,
          status: true,
          cargo: { select: { id: true, containerNo: true, blNo: true, consigneeName: true, isOverdue: true, status: true } },
        },
      },
    },
  });
  res.json(slots);
});

const patchSchema = z.object({ isActive: z.boolean() });

slotsRouter.patch('/:id', requireSuperAdmin, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const slot = await prisma.rackSlot.update({ where: { id: req.params.id }, data: parsed.data });
  bus.emitEvent({ type: 'config:updated' });
  res.json(slot);
});

slotsRouter.delete('/:id', requireSuperAdmin, async (req, res) => {
  const slot = await prisma.rackSlot.findUnique({ where: { id: req.params.id } });
  if (!slot) return res.status(404).json({ error: 'not_found' });
  const [cargoOccupants, portionOccupants] = await prisma.$transaction([
    prisma.cargo.count({ where: { currentSlotId: slot.id } }),
    prisma.cargoPortion.count({ where: { currentSlotId: slot.id } }),
  ]);
  const occupants = cargoOccupants + portionOccupants;
  if (occupants > 0) {
    return res.status(409).json({ error: 'slot_in_use', occupants });
  }
  await prisma.$transaction([
    prisma.moveLog.updateMany({ where: { fromSlotId: slot.id }, data: { fromSlotId: null } }),
    prisma.moveLog.updateMany({ where: { toSlotId: slot.id }, data: { toSlotId: null } }),
    prisma.rackSlot.delete({ where: { id: slot.id } }),
  ]);
  bus.emitEvent({ type: 'config:updated' });
  res.json({ ok: true });
});
