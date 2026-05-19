import type { Telegraf } from 'telegraf';
import { prisma } from '../../db.js';
import { bus } from '../../realtime/bus.js';
import { resolveCargo } from '../resolveCargo.js';
import { resolveTelegramUser } from '../user.js';

const SLOT_FREEING = new Set(['IN_CHECKING_AREA', 'CLEARED', 'MARKED_FOR_DISPOSAL']);

type StatusCmd = {
  command: string;
  status: 'CHECKED_FOR_AUCTION' | 'IN_CHECKING_AREA' | 'CLEARED' | 'MARKED_FOR_DISPOSAL';
  label: string;
};

const COMMANDS: StatusCmd[] = [
  { command: 'auction', status: 'CHECKED_FOR_AUCTION', label: 'checked for auction' },
  { command: 'checking', status: 'IN_CHECKING_AREA', label: 'moved to Checking Area' },
  { command: 'cleared', status: 'CLEARED', label: 'cleared (rack slot unassigned)' },
  { command: 'disposal', status: 'MARKED_FOR_DISPOSAL', label: 'marked for disposal (rack slot unassigned)' },
];

export function registerStatusCommands(bot: Telegraf) {
  for (const c of COMMANDS) {
    bot.command(c.command, async (ctx) => {
      const text = ctx.message.text ?? '';
      const parts = text.split(/\s+/).slice(1);
      if (parts.length < 1) {
        return ctx.reply(`Usage: /${c.command} <containerNo|cargoId>`);
      }
      const identifier = parts[0];
      const actor = await resolveTelegramUser(ctx);
      if (!actor) return ctx.reply('Your Telegram username is not linked to an active Smart Rack user.');

      const cargo = await resolveCargo(identifier);
      if (!cargo) return ctx.reply(`Cargo not found: ${identifier}`);
      if (cargo.portions.length > 0) {
        return ctx.reply('This cargo is split into package portions. Update it from the Smart Rack app so each portion keeps the correct rack status.');
      }

      const movedBy = actor.displayName;
      const fromSlotId = cargo.currentSlotId;
      const freeSlot = SLOT_FREEING.has(c.status);

      if (freeSlot && fromSlotId) {
        await prisma.$transaction([
          prisma.cargo.update({
            where: { id: cargo.id },
            data: { status: c.status, currentSlotId: null },
          }),
          prisma.moveLog.create({
            data: { cargoId: cargo.id, fromSlotId, toSlotId: null, movedBy, userId: actor.userId, source: 'TELEGRAM' },
          }),
        ]);
        bus.emitEvent({ type: 'cargo:moved', cargoId: cargo.id, fromSlot: fromSlotId, toSlot: null });
      } else {
        await prisma.cargo.update({ where: { id: cargo.id }, data: { status: c.status } });
      }
      bus.emitEvent({ type: 'cargo:updated', cargoId: cargo.id });
      return ctx.reply(`${cargo.containerNo}: ${c.label}.${fromSlotId && freeSlot ? ` Rack slot ${fromSlotId} is now unassigned.` : ''}`);
    });
  }
}
