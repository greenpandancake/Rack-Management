import type { Telegraf } from 'telegraf';
import { prisma } from '../../db.js';
import { bus } from '../../realtime/bus.js';
import { resolveCargo } from '../resolveCargo.js';
import { resolveTelegramUser } from '../user.js';

export function registerMoveCommand(bot: Telegraf) {
  bot.command('move', async (ctx) => {
    const text = ctx.message.text ?? '';
    const parts = text.split(/\s+/).slice(1);
    if (parts.length < 2) {
      return ctx.reply('Usage: /move <containerNo|cargoId> <slotId> [confirm]');
    }
    const [identifier, slotIdRaw, confirmRaw] = parts;
    const slotId = slotIdRaw.toUpperCase();
    const confirmed = ['confirm', 'yes', 'y'].includes((confirmRaw ?? '').toLowerCase());
    const actor = await resolveTelegramUser(ctx);
    if (!actor) return ctx.reply('Your Telegram username is not linked to an active Smart Rack user.');

    const cargo = await resolveCargo(identifier);
    if (!cargo) return ctx.reply(`Cargo not found: ${identifier}`);
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
    if (occupiedBy) {
      if (!confirmed) {
        return ctx.reply(
          `Slot ${slotId} is occupied by ${occupiedBy}. Small items can share a slot. Repeat with:\n/move ${identifier} ${slotId} confirm`,
        );
      }
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
