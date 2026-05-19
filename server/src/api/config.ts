import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { bus } from '../realtime/bus.js';
import { ensureSlotsForConfig, enumerateSlots, parseRows } from '../services/rack.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const configRouter = Router();
configRouter.use(requireAuth);

configRouter.get('/', async (_req, res) => {
  const cfg = await prisma.rackConfig.findUnique({ where: { id: 1 } });
  if (!cfg) return res.json(null);
  res.json({ ...cfg, rows: parseRows(cfg.rows) });
});

const putSchema = z.object({
  rows: z.array(z.string().min(1).max(4)).min(1),
  levels: z.number().int().positive().max(20),
  slotsPerLevel: z.number().int().positive().max(50),
});

configRouter.put('/', requirePermission('canConfigureRack'), async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { ...parsed.data, rows: JSON.stringify(parsed.data.rows) };
  const cfg = await prisma.rackConfig.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  const created = await ensureSlotsForConfig(prisma, cfg);

  const wantedIds = new Set(enumerateSlots(parsed.data).map((s) => s.id));
  const allSlots = await prisma.rackSlot.findMany({ select: { id: true } });
  const outOfRange = allSlots.filter((s) => !wantedIds.has(s.id));

  let removed = 0;
  const retained: string[] = [];
  for (const slot of outOfRange) {
    const [cargoInUse, portionInUse] = await prisma.$transaction([
      prisma.cargo.count({ where: { currentSlotId: slot.id } }),
      prisma.cargoPortion.count({ where: { currentSlotId: slot.id } }),
    ]);
    const inUse = cargoInUse + portionInUse;
    if (inUse === 0) {
      await prisma.$transaction([
        prisma.moveLog.updateMany({ where: { fromSlotId: slot.id }, data: { fromSlotId: null } }),
        prisma.moveLog.updateMany({ where: { toSlotId: slot.id }, data: { toSlotId: null } }),
        prisma.rackSlot.delete({ where: { id: slot.id } }),
      ]);
      removed++;
    } else {
      await prisma.rackSlot.update({ where: { id: slot.id }, data: { isActive: false } });
      retained.push(slot.id);
    }
  }

  bus.emitEvent({ type: 'config:updated' });
  res.json({
    config: { ...cfg, rows: parseRows(cfg.rows) },
    newSlots: created,
    removedSlots: removed,
    retainedSlots: retained,
  });
});

configRouter.delete('/rows/:row', requirePermission('canConfigureRack'), async (req, res) => {
  const row = req.params.row.toUpperCase();
  const cfg = await prisma.rackConfig.findUnique({ where: { id: 1 } });
  if (!cfg) return res.status(404).json({ error: 'config_not_found' });
  const rows = parseRows(cfg.rows);
  if (!rows.includes(row)) return res.status(404).json({ error: 'row_not_in_config' });

  const slotsInRow = await prisma.rackSlot.findMany({ where: { row } });
  const slotIds = slotsInRow.map((s) => s.id);
  const occupied = slotIds.length
    ? [
        ...(await prisma.cargo.findMany({
          where: { currentSlotId: { in: slotIds } },
          select: { id: true, containerNo: true, currentSlotId: true },
        })).map((c) => ({ slotId: c.currentSlotId, containerNo: c.containerNo })),
        ...(await prisma.cargoPortion.findMany({
          where: { currentSlotId: { in: slotIds } },
          select: {
            currentSlotId: true,
            label: true,
            cargo: { select: { containerNo: true, blNo: true } },
          },
        })).map((p) => ({ slotId: p.currentSlotId, containerNo: `${p.cargo.containerNo} ${p.label} (${p.cargo.blNo})` })),
      ]
    : [];

  if (occupied.length > 0) {
    return res.status(409).json({
      error: 'row_in_use',
      occupants: occupied,
    });
  }

  if (slotIds.length > 0) {
    await prisma.$transaction([
      prisma.moveLog.updateMany({ where: { fromSlotId: { in: slotIds } }, data: { fromSlotId: null } }),
      prisma.moveLog.updateMany({ where: { toSlotId: { in: slotIds } }, data: { toSlotId: null } }),
      prisma.rackSlot.deleteMany({ where: { id: { in: slotIds } } }),
    ]);
  }

  const newRows = rows.filter((r) => r !== row);
  const updated = await prisma.rackConfig.update({
    where: { id: 1 },
    data: { rows: JSON.stringify(newRows) },
  });

  bus.emitEvent({ type: 'config:updated' });
  res.json({
    config: { ...updated, rows: parseRows(updated.rows) },
    removedSlots: slotIds.length,
  });
});
