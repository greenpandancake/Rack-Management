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
