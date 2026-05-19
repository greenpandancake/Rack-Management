import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const CARGO_STATUSES = [
  'IN_RACK',
  'CHECKED_FOR_AUCTION',
  'IN_CHECKING_AREA',
  'CLEARED',
  'MARKED_FOR_DISPOSAL',
  'DAMAGED',
] as const;

const rangeSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
});

function endOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function countBy<T extends string>(values: T[], keys: readonly T[]) {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function isCargoLocationUnassigned(cargo: { currentSlotId: string | null; portions?: Array<{ currentSlotId: string | null }> }) {
  if (!cargo.portions || cargo.portions.length === 0) return cargo.currentSlotId == null;
  return cargo.portions.some((portion) => portion.currentSlotId == null);
}

reportsRouter.get('/rack', async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const start = parsed.data.start;
  const end = endOfDay(parsed.data.end);
  if (end < start) return res.status(400).json({ error: 'invalid_range' });

  const [slots, cargoAll, intakes, moves, freedCargo, fieldReports] = await prisma.$transaction([
    prisma.rackSlot.findMany({
      orderBy: [{ row: 'asc' }, { level: 'asc' }, { slot: 'asc' }],
      include: {
        cargos: {
          where: { status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION'] } },
          select: { id: true, containerNo: true, status: true, isOverdue: true },
        },
        portions: {
          where: { status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION'] } },
          select: {
            id: true,
            status: true,
            cargo: { select: { isOverdue: true } },
          },
        },
      },
    }),
    prisma.cargo.findMany({
      select: {
        status: true,
        isOverdue: true,
        currentSlotId: true,
        portions: { select: { currentSlotId: true } },
      },
    }),
    prisma.cargo.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        cssCcdNo: true,
        containerNo: true,
        blNo: true,
        consigneeName: true,
        vesselName: true,
        noOfPkgs: true,
        cbm: true,
        detainedByCustoms: true,
        detainedByHealth: true,
        currentSlotId: true,
        status: true,
        createdAt: true,
        portions: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, label: true, quantity: true, pkgsType: true, currentSlotId: true, status: true },
        },
      },
    }),
    prisma.moveLog.findMany({
      where: { movedAt: { gte: start, lte: end } },
      orderBy: { movedAt: 'asc' },
      include: {
        cargo: { select: { cssCcdNo: true, containerNo: true, blNo: true, consigneeName: true } },
        portion: { select: { label: true, quantity: true, pkgsType: true } },
        fromSlot: { select: { id: true } },
        toSlot: { select: { id: true } },
        user: { select: { username: true, name: true } },
      },
    }),
    prisma.cargo.findMany({
      where: {
        updatedAt: { gte: start, lte: end },
        status: { in: ['IN_CHECKING_AREA', 'CLEARED', 'MARKED_FOR_DISPOSAL', 'DAMAGED'] },
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        cssCcdNo: true,
        containerNo: true,
        blNo: true,
        consigneeName: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.report.findMany({
      where: { reportedAt: { gte: start, lte: end } },
      orderBy: { reportedAt: 'asc' },
      include: {
        cargo: { select: { cssCcdNo: true, containerNo: true, blNo: true, consigneeName: true } },
      },
    }),
  ]);

  const activeSlots = slots.filter((s) => s.isActive);
  const occupiedSlots = activeSlots.filter((s) => s.cargos.length > 0 || s.portions.length > 0);
  const rowSummary = Array.from(
    slots.reduce((acc, slot) => {
      const row = acc.get(slot.row) ?? { row: slot.row, total: 0, active: 0, occupied: 0, overdue: 0 };
      const hasOccupant = slot.cargos.length > 0 || slot.portions.length > 0;
      const hasOverdueOccupant = slot.cargos.some((c) => c.isOverdue) || slot.portions.some((p) => p.cargo.isOverdue);
      row.total++;
      if (slot.isActive) row.active++;
      if (slot.isActive && hasOccupant) row.occupied++;
      if (slot.isActive && hasOverdueOccupant) row.overdue++;
      acc.set(slot.row, row);
      return acc;
    }, new Map<string, { row: string; total: number; active: number; occupied: number; overdue: number }>()),
  ).map(([, value]) => value);

  const statusCounts = countBy(
    cargoAll.map((c) => c.status as (typeof CARGO_STATUSES)[number]),
    CARGO_STATUSES,
  );
  const intakeTotals = intakes.reduce(
    (acc, cargo) => {
      acc.items += cargo.noOfPkgs;
      acc.cbm += Number(cargo.cbm);
      if (cargo.detainedByCustoms) acc.customsHeld++;
      if (cargo.detainedByHealth) acc.healthHeld++;
      return acc;
    },
    { items: 0, cbm: 0, customsHeld: 0, healthHeld: 0 },
  );

  res.json({
    generatedAt: new Date(),
    range: { start, end },
    summary: {
      totalSlots: slots.length,
      activeSlots: activeSlots.length,
      disabledSlots: slots.length - activeSlots.length,
      occupiedSlots: occupiedSlots.length,
      emptyActiveSlots: Math.max(0, activeSlots.length - occupiedSlots.length),
      totalCargo: cargoAll.length,
      overdueCargo: cargoAll.filter((c) => c.isOverdue).length,
      unassignedCargo: cargoAll.filter(isCargoLocationUnassigned).length,
      intakes: intakes.length,
      intakeItems: intakeTotals.items,
      intakeCbm: Number(intakeTotals.cbm.toFixed(3)),
      intakeCustomsHeld: intakeTotals.customsHeld,
      intakeHealthHeld: intakeTotals.healthHeld,
      moves: moves.length,
      freedCargo: freedCargo.length,
      fieldReports: fieldReports.length,
      statusCounts,
    },
    rowSummary,
    intakes,
    moves: moves.map((m) => ({
      id: m.id,
      movedAt: m.movedAt,
      cargo: m.cargo,
      portion: m.portion,
      fromSlotId: m.fromSlot?.id ?? null,
      toSlotId: m.toSlot?.id ?? null,
      movedBy: m.user ? `${m.user.name} (${m.user.username})` : m.movedBy,
      source: m.source,
    })),
    freedCargo,
    fieldReports: fieldReports.map((r) => ({
      id: r.id,
      reportedAt: r.reportedAt,
      reportedBy: r.reportedBy,
      note: r.note,
      cargo: r.cargo,
    })),
  });
});
