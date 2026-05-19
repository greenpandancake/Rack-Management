import type { Telegraf } from 'telegraf';
import { prisma } from '../../db.js';

export function registerGetIdCommand(bot: Telegraf) {
  bot.command(['getid', 'GetId'], async (ctx) => {
    const text = ctx.message.text ?? '';
    const parts = text.split(/\s+/).slice(1);
    if (parts.length < 1) {
      return ctx.reply('Usage: /getid <containerNo|blNo|consigneeName>');
    }
    const q = parts.join(' ').trim();
    const matches = await prisma.cargo.findMany({
      where: {
        OR: [
          { containerNo: { contains: q } },
          { containerNo: { contains: q.toUpperCase() } },
          { blNo: { contains: q } },
          { blNo: { contains: q.toUpperCase() } },
          { consigneeName: { contains: q } },
          { cssCcdNo: { contains: q } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        cssCcdNo: true,
        containerNo: true,
        consigneeName: true,
        currentSlotId: true,
        status: true,
        portions: { select: { currentSlotId: true } },
      },
    });

    if (matches.length === 0) return ctx.reply(`No cargo matching "${q}".`);

    const lines = matches.map((m) => {
      const loc = rackLocationLabel(m);
      return `${m.cssCcdNo} - ${m.containerNo} - ${m.consigneeName} - ${loc}`;
    });
    const header = matches.length === 10 ? '(showing first 10)\n' : '';
    return ctx.reply(header + lines.join('\n'));
  });
}

function rackLocationLabel(cargo: { currentSlotId: string | null; status: string; portions?: { currentSlotId: string | null }[] }) {
  const portions = cargo.portions ?? [];
  if (portions.length === 0) return cargo.currentSlotId ?? (cargo.status === 'IN_RACK' ? 'unassigned' : cargo.status.replace(/_/g, ' '));

  const assigned = portions.map((portion) => portion.currentSlotId).filter(Boolean);
  if (assigned.length === 0) return 'unassigned';
  if (assigned.length < portions.length) return 'partially assigned';

  const uniqueSlots = [...new Set(assigned)];
  return uniqueSlots.length === 1 ? uniqueSlots[0] : `${uniqueSlots.length} rack slots`;
}
