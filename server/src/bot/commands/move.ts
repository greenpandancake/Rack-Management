import type { Telegraf } from 'telegraf';
import { prisma } from '../../db.js';
import { bus } from '../../realtime/bus.js';
import { resolveCargoBySlotOrIdentifier } from '../resolveCargo.js';
import { resolveTelegramUser } from '../user.js';

export function registerMoveCommand(bot: Telegraf) {
  bot.command('move', async (ctx) => {
    const text = ctx.message.text ?? '';
    const parts = text.split(/\s+/).slice(1);

    // Strip optional "to" keyword: /move A-1-04 to A-1-06
    const filtered = parts.filter((p, i) => !(i === 1 && p.toLowerCase() === 'to'));

    if (filtered.length < 2) {
      return ctx.reply(
        'Usage:\n' +
        '  /move <containerNo|cargoId> <slotId> [confirm]\n' +
        '  /move <fromSlot> <toSlot>',
      );
    }

    const [first, slotIdRaw, confirmRaw] = filtered;
    const slotId = slotIdRaw.toUpperCase();
    const confirmed = ['confirm', 'yes', 'y'].includes((confirmRaw ?? '').toLowerCase());

    const actor = await resolveTelegramUser(ctx);
    if (!actor) return ctx.reply('Your Telegram username is not linked to an active Smart Rack user.');

    const resolved = await resolveCargoBySlotOrIdentifier(first);
    if (resolved.kind === 'not_found') return ctx.reply(`Cargo not found: ${first}`);
    if (resolved.kind === 'empty') return ctx.reply(`No cargo found in slot ${first.toUpperCase()}.`);
    if (resolved.kind === 'ambiguous') {
      const list = resolved.containers.map((c) => `  ${c}`).join('\n');
      return ctx.reply(`Multiple cargo in slot ${resolved.slotId}. Specify by container number:\n${list}`);
    }
    const cargo = resolved.cargo;

    if (cargo.portions.length > 0) {
      return ctx.reply('This cargo is split into package portions. Move each portion from the Smart Rack app so the rack slots stay accurate.');
    }

    const slot = await prisma.rackSlot.findUnique({ where: { id: slotId } });
    if (!slot || !slot.isActive) return ctx.reply(`Slot not available: ${slotId}`);

    const [occupant, portionOccupant] = await Promise.all([
      prisma.cargo.findFirst({
        where: {
          currentSlotId: slotId,
          status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION'] },
          id: { not: cargo.id },
        },
        select: { containerNo: true },
      }),
      prisma.cargoPortion.findFirst({
        where: {
          currentSlotId: slotId,
          status: { in: ['IN_RACK', 'CHECKED_FOR_AUCTION'] },
        },
        select: { label: true, cargo: { select: { containerNo: true } } },
      }),
    ]);
    const occupiedBy = occupant?.containerNo ?? (portionOccupant ? `${portionOccupant.cargo.containerNo} ${portionOccupant.label}` : null);
    if (occupiedBy && !confirmed) {
      return ctx.reply(
        `Slot ${slotId} is occupied by ${occupiedBy}. Small items can share a slot. Repeat with:\n/move ${first} ${slotId} confirm`,
      );
    }

    const fromSlotId = cargo.currentSlotId;
    const keepStatus = cargo.status === 'IN_RACK' || cargo.status === 'CHECKED_FOR_AUCTION';
    await prisma.$transaction([
      prisma.cargo.update({
        where: { id: cargo.id },
        data: {
          currentSlotId: slotId,
          ...(keepStatus ? {} : { status: 'IN_RACK' }),
        },
      }),
      prisma.moveLog.create({
        data: {
          cargoId: cargo.id,
          fromSlotId,
          toSlotId: slotId,
          movedBy: actor.displayName,
          userId: actor.userId,
          source: 'TELEGRAM',
        },
      }),
    ]);

    bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: fromSlotId, toSlot: slotId });
    return ctx.reply(`Moved ${cargo.containerNo}: ${fromSlotId ?? '-'} -> ${slotId}`);
  });
}
