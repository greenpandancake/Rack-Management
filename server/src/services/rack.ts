import type { PrismaClient, RackConfig } from '@prisma/client';

export const defaultConfig = {
  rows: ['A', 'B', 'C', 'D', 'E'] as string[],
  levels: 3,
  slotsPerLevel: 10,
};

export function slotId(row: string, level: number, slot: number): string {
  return `${row}-${level}-${String(slot).padStart(2, '0')}`;
}

export function parseRows(rows: string): string[] {
  try {
    const parsed = JSON.parse(rows);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function enumerateSlots(cfg: { rows: string[]; levels: number; slotsPerLevel: number }) {
  const out: { id: string; row: string; level: number; slot: number }[] = [];
  for (const row of cfg.rows) {
    for (let level = 1; level <= cfg.levels; level++) {
      for (let slot = 1; slot <= cfg.slotsPerLevel; slot++) {
        out.push({ id: slotId(row, level, slot), row, level, slot });
      }
    }
  }
  return out;
}

export async function ensureSlotsForConfig(prisma: PrismaClient, cfg: RackConfig): Promise<number> {
  const rows = parseRows(cfg.rows);
  const wanted = enumerateSlots({ rows, levels: cfg.levels, slotsPerLevel: cfg.slotsPerLevel });
  const existing = await prisma.rackSlot.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((s) => s.id));
  const toCreate = wanted.filter((s) => !existingIds.has(s.id));
  if (toCreate.length > 0) {
    await prisma.rackSlot.createMany({ data: toCreate });
  }
  return toCreate.length;
}
