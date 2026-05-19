import { prisma } from '../db.js';

export async function resolveCargo(identifier: string) {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  return prisma.cargo.findFirst({
    where: {
      OR: [
        { id: trimmed },
        { containerNo: trimmed },
        { containerNo: trimmed.toUpperCase() },
        { cssCcdNo: trimmed },
        { blNo: trimmed },
        { blNo: trimmed.toUpperCase() },
      ],
    },
    include: {
      portions: { select: { id: true, label: true, currentSlotId: true } },
    },
  });
}

const SLOT_ID_RE = /^[A-Za-z]+-\d+-\d+$/;

export type SlotResolveResult =
  | { kind: 'cargo'; cargo: NonNullable<Awaited<ReturnType<typeof resolveCargo>>> }
  | { kind: 'empty'; slotId: string }
  | { kind: 'ambiguous'; slotId: string; containers: string[] }
  | { kind: 'not_found' };

/**
 * Resolves an identifier that may be a slot ID (e.g. A-1-06) or a cargo
 * identifier (container number, BL, CSS/CCD, UUID).
 */
export async function resolveCargoBySlotOrIdentifier(identifier: string): Promise<SlotResolveResult> {
  const trimmed = identifier.trim();
  if (!trimmed) return { kind: 'not_found' };

  if (SLOT_ID_RE.test(trimmed)) {
    const slotId = trimmed.toUpperCase();
    const occupants = await prisma.cargo.findMany({
      where: { currentSlotId: slotId },
      include: { portions: { select: { id: true, label: true, currentSlotId: true } } },
    });
    if (occupants.length === 0) return { kind: 'empty', slotId };
    if (occupants.length > 1) {
      return { kind: 'ambiguous', slotId, containers: occupants.map((c) => c.containerNo) };
    }
    return { kind: 'cargo', cargo: occupants[0] };
  }

  const cargo = await resolveCargo(trimmed);
  if (!cargo) return { kind: 'not_found' };
  return { kind: 'cargo', cargo };
}
